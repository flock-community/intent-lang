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
