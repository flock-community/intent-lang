// The Anthropic API provider (compiler/providers/anthropic.ts): the request, the text, the cost and
// the errors (a cut-off or refused answer too), with fetch stubbed so no network is touched.
import assert from "node:assert/strict";
import { anthropic } from "../compiler/providers/anthropic.ts";
import { openai } from "../compiler/providers/openai.ts";

const realFetch = globalThis.fetch;
const stub = (body: unknown, ok = true, status = 200) => {
  globalThis.fetch = (async () => ({ ok, status, json: async () => body })) as unknown as typeof fetch;
};

delete process.env.ANTHROPIC_API_KEY;
let r = await anthropic("claude-sonnet-5").complete("sys", "user");
assert.match(r.error ?? "", /ANTHROPIC_API_KEY/, "no key is an error, not a call");

process.env.ANTHROPIC_API_KEY = "k-test";
stub({ content: [{ type: "text", text: "hello" }], usage: { input_tokens: 1_000_000, output_tokens: 1_000_000 } });
r = await anthropic("claude-sonnet-5").complete("sys", "user");
assert.equal(r.text, "hello", "the text blocks are joined");
assert.equal(r.costUsd, 12, "1M in at 2 + 1M out at 10");
assert.equal(r.error, undefined);

stub({ error: { message: "bad model" } }, false, 400);
r = await anthropic("claude-sonnet-5").complete("sys", "user");
assert.match(r.error ?? "", /bad model/, "an API error comes back as the error");

stub({ content: [{ type: "text", text: "x" }], usage: { input_tokens: 100, output_tokens: 100 } });
r = await anthropic("mystery").complete("sys", "user");
assert.equal(r.costUsd, 0, "an unknown model costs 0");
assert.equal(r.unpriced, true, "and says its price is unknown (a budget cannot hold over it)");

stub({ content: [{ type: "text", text: "half a fi" }], stop_reason: "max_tokens", usage: { input_tokens: 1, output_tokens: 1 } });
r = await anthropic("claude-sonnet-5").complete("sys", "user");
assert.match(r.error ?? "", /cut off/, "a cut-off answer is an error, not code");
assert.equal(r.text, "");
stub({ content: [], stop_reason: "refusal", usage: { input_tokens: 1, output_tokens: 0 } });
r = await anthropic("claude-sonnet-5").complete("sys", "user");
assert.match(r.error ?? "", /declined/, "a refusal is an error");

// The OpenAI-compatible provider.
delete process.env.OPENAI_API_KEY;
r = await openai("gpt-4o-mini").complete("sys", "user");
assert.match(r.error ?? "", /OPENAI_API_KEY/, "no key is an error, not a call");
process.env.OPENAI_API_KEY = "k-test";
stub({ choices: [{ message: { content: "hi" } }], usage: { prompt_tokens: 1_000_000, completion_tokens: 1_000_000 } });
r = await openai("gpt-4o-mini").complete("sys", "user");
assert.equal(r.text, "hi", "the first choice's message is the text");
assert.equal(Math.round(r.costUsd * 100) / 100, 0.75, "1M in at 0.15 + 1M out at 0.6");
stub({ error: { message: "no such model" } }, false, 404);
r = await openai("gpt-4o-mini").complete("sys", "user");
assert.match(r.error ?? "", /no such model/, "an API error comes back as the error");
stub({ choices: [{ message: { content: "half" }, finish_reason: "length" }], usage: { prompt_tokens: 1, completion_tokens: 1 } });
r = await openai("gpt-4o-mini").complete("sys", "user");
assert.match(r.error ?? "", /cut off/, "a cut-off answer is an error, not code");

globalThis.fetch = realFetch;

// The twin's probe compiler can come from another vendor: `probeLlm`/`probeModel` (a second,
// independent reading, not just a second prompt on the same model).
process.env.INTENT_LLM = "openai";
process.env.INTENT_MODEL = "deepseek-chat";
process.env.INTENT_PROBE_LLM = "anthropic";
process.env.INTENT_PROBE_MODEL = "claude-sonnet-5";
const { config } = await import("../compiler/config.ts");
const { provider } = await import("../compiler/llm.ts");
assert.equal(provider().name, "openai", "the main build uses `llm`");
assert.equal(provider().model, "deepseek-chat");
const probe = provider(config().probeLlm, config().probeModel || config().model);
assert.equal(probe.name, "anthropic", "the probe can be another vendor");
assert.equal(probe.model, "claude-sonnet-5");

console.log("ok providers: anthropic and openai map content, usage and errors; the probe can be another vendor");

// Replay (compiler/providers/replay.ts): a call is answered by the response recorded for exactly its
// prompt, from a build's log (prompt-N.md / response-N.md, look-…) or from INTENT_RECORD's files;
// a prompt with no recording is an error that names its hash. Recording (llm.ts, INTENT_RECORD)
// writes every answered call, so a recorded run replays without a model.
{
  const { mkdtempSync, mkdirSync, readdirSync, rmSync, writeFileSync } = await import("node:fs");
  const { tmpdir } = await import("node:os");
  const { join } = await import("node:path");
  const { replay, promptHash } = await import("../compiler/providers/replay.ts");
  const dir = mkdtempSync(join(tmpdir(), "replay-"));
  try {
    mkdirSync(join(dir, "elm/log"), { recursive: true });
    writeFileSync(join(dir, "elm/log/prompt-1.md"), "build me");
    writeFileSync(join(dir, "elm/log/response-1.md"), "```elm\nmain = 1\n```");
    writeFileSync(join(dir, "elm/log/look-prompt-1.md"), "style me");
    writeFileSync(join(dir, "elm/log/look-response-1.md"), "styled");
    writeFileSync(join(dir, "elm/log/prompt-2.md"), "no answer was logged");
    process.env.INTENT_REPLAY = dir;
    const p = replay("m");
    assert.equal((await p.complete("sys", "build me")).text, "```elm\nmain = 1\n```", "a build log's prompt-N/response-N pair");
    assert.equal((await p.complete("other sys", "style me")).text, "styled", "a look log's pair; the system prompt does not matter");
    const miss = await p.complete("sys", "no answer was logged");
    assert.match(miss.error ?? "", new RegExp(`no recording for this prompt \\(hash ${promptHash("no answer was logged")}\\)`), "a prompt without a response is a miss, named by its hash");
    assert.equal(miss.costUsd, 0);

    // Record with a stubbed provider, then replay the same call from the recording.
    const rec = join(dir, "rec");
    process.env.INTENT_RECORD = rec;
    process.env.INTENT_LLM = "openai";
    process.env.OPENAI_API_KEY = "k-test";
    stub({ choices: [{ message: { content: "recorded answer" }, finish_reason: "stop" }], usage: { prompt_tokens: 1, completion_tokens: 1 } });
    const { complete } = await import("../compiler/llm.ts");
    assert.equal((await complete("sys", "a new prompt")).text, "recorded answer");
    assert.deepEqual(readdirSync(rec).sort(), [`${promptHash("a new prompt")}.prompt.md`, `${promptHash("a new prompt")}.response.md`], "the call is recorded by its prompt's hash");
    delete process.env.INTENT_RECORD;
    process.env.INTENT_REPLAY = rec;
    assert.equal((await replay("m").complete("sys", "a new prompt")).text, "recorded answer", "and replays from the recording");
  } finally {
    delete process.env.INTENT_REPLAY;
    delete process.env.INTENT_RECORD;
    delete process.env.INTENT_LLM;
    globalThis.fetch = realFetch;
    rmSync(dir, { recursive: true, force: true });
  }
  console.log("ok providers: replay answers from build logs and recordings by prompt; INTENT_RECORD records every answered call");
}
