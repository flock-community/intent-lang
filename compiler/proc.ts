// Async child-process helper with timeout.
import { spawn } from "node:child_process";

export function run(cmd: string, args: string[], opts: { cwd?: string; input?: string; timeoutMs?: number; env?: NodeJS.ProcessEnv } = {}): Promise<{ ok: boolean; code: number | null; stdout: string; stderr: string; timedOut: boolean }> {
  return new Promise((resolve) => {
    const p = spawn(cmd, args, { cwd: opts.cwd, env: opts.env ?? process.env });
    let stdout = "";
    let stderr = "";
    let timedOut = false;
    const timer = opts.timeoutMs ? setTimeout(() => ((timedOut = true), p.kill("SIGKILL")), opts.timeoutMs) : undefined;
    p.stdout.on("data", (d) => (stdout += d));
    p.stderr.on("data", (d) => (stderr += d));
    p.on("close", (code) => {
      if (timer) clearTimeout(timer);
      resolve({ ok: code === 0 && !timedOut, code, stdout, stderr, timedOut });
    });
    p.stdin.end(opts.input ?? "");
  });
}
