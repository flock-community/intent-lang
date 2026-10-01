// Provider: answers from recorded calls, without a model (CI, a host that replays a build it
// recorded). A call is answered by its prompt: the response recorded for exactly that prompt text.
// Recordings are read from INTENT_REPLAY (a folder, default `.intent/recordings`), recursively, in
// two forms: a build's own log (`log/prompt-N.md` with `log/response-N.md`, `look-prompt-N.md` with
// `look-response-N.md`), and what `INTENT_RECORD=<folder>` writes for every call
// (`<hash>.prompt.md` with `<hash>.response.md`, see llm.ts). A prompt with no recording is an error
// that names its hash, never a guess. Choose it with `llm replay` (INTENT_LLM, --llm).
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join, resolve } from "node:path";
import { createHash } from "node:crypto";
import type { LlmResult, Provider } from "../llm.ts";

export const promptHash = (prompt: string): string => createHash("sha256").update(prompt).digest("hex").slice(0, 16);

/** The response file next to a prompt file, by the names a build log and a recording use. */
const responseName = (f: string): string | undefined => {
  if (/^(look-)?prompt-\d+\.md$/.test(f)) return f.replace("prompt-", "response-");
  if (/^[0-9a-f]{16}\.prompt\.md$/.test(f)) return f.replace(".prompt.md", ".response.md");
  return undefined;
};

const indexes = new Map<string, Map<string, string>>();
/** Every recorded prompt under a folder, by hash → the file with its response. */
export function recordings(dir: string): Map<string, string> {
  const root = resolve(dir);
  const known = indexes.get(root);
  if (known) return known;
  const index = new Map<string, string>();
  const walk = (d: string) => {
    for (const f of readdirSync(d).sort()) {
      const p = join(d, f);
      if (statSync(p).isDirectory()) walk(p);
      else {
        const r = responseName(f);
        if (r && existsSync(join(d, r))) index.set(promptHash(readFileSync(p, "utf8")), join(d, r));
      }
    }
  };
  if (existsSync(root)) walk(root);
  indexes.set(root, index);
  return index;
}

export function replay(model: string): Provider {
  return {
    name: "replay",
    model,
    async complete(_system: string, prompt: string): Promise<LlmResult> {
      const dir = process.env.INTENT_REPLAY || ".intent/recordings";
      const hash = promptHash(prompt);
      const file = recordings(dir).get(hash);
      if (!file) return { text: "", costUsd: 0, ms: 0, error: `no recording for this prompt (hash ${hash}) in ${dir}` };
      return { text: readFileSync(file, "utf8"), costUsd: 0, ms: 0 };
    },
  };
}
