// One pure LLM call: `claude -p`, no tools, no settings, no session, a neutral cwd.
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { run } from "./proc.ts";

export const MODEL = process.env.INTENT_MODEL ?? "claude-opus-5-5";

export interface LlmResult {
  text: string;
  costUsd: number;
  ms: number;
  error?: string;
}

export async function complete(system: string, prompt: string): Promise<LlmResult> {
  const cwd = mkdtempSync(join(tmpdir(), "intent-llm-"));
  const t0 = Date.now();
  try {
    const args = ["-p", "--model", MODEL, "--tools", "", "--strict-mcp-config", "--mcp-config", '{"mcpServers":{}}', "--no-session-persistence", "--setting-sources", "", "--system-prompt", system, "--output-format", "json"];
    for (let attempt = 1; ; attempt++) {
      const r = await run("claude", args, { cwd, input: prompt, timeoutMs: 15 * 60_000 });
      try {
        const j = JSON.parse(r.stdout);
        if (j.is_error) throw new Error(String(j.result ?? j.subtype));
        return { text: String(j.result ?? ""), costUsd: j.total_cost_usd ?? 0, ms: Date.now() - t0 };
      } catch (e) {
        if (attempt >= 3) return { text: "", costUsd: 0, ms: Date.now() - t0, error: `${(e as Error).message} ${r.stderr.slice(0, 500)}`.trim() };
        await new Promise((res) => setTimeout(res, 5000 * attempt));
      }
    }
  } finally {
    rmSync(cwd, { recursive: true, force: true });
  }
}

/** The code inside the last fenced block (or the whole text when there is none). */
export function extractCode(text: string): string {
  const blocks = [...text.matchAll(/```[a-zA-Z]*\n([\s\S]*?)```/g)];
  const code = blocks.length ? blocks[blocks.length - 1][1] : text;
  return code.trimEnd() + "\n";
}
