// Provider: the Claude Code CLI (`claude -p`). No tools, no settings, no session, a neutral cwd.
// It uses the CLI's own sign-in: `claude login`, or ANTHROPIC_API_KEY in the environment.
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { run } from "../proc.ts";
import type { LlmResult, Provider } from "../llm.ts";

export function claudeCli(model: string): Provider {
  return {
    name: "claude-cli",
    model,
    async complete(system: string, prompt: string): Promise<LlmResult> {
      const cwd = mkdtempSync(join(tmpdir(), "intent-llm-"));
      const t0 = Date.now();
      try {
        const args = ["-p", "--model", model, "--tools", "", "--strict-mcp-config", "--mcp-config", '{"mcpServers":{}}', "--no-session-persistence", "--setting-sources", "", "--system-prompt", system, "--output-format", "json"];
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
    },
  };
}
