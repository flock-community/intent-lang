// The toolchains a build uses (elm, tsc, esbuild, tailwindcss), from the Intent installation.
import { join } from "node:path";
import { run as proc } from "./proc.ts";
import { ROOT } from "./targets/shared.ts";

export const bin = (name: string) => join(ROOT, "node_modules/.bin", name);

// A build may live anywhere (a project outside the installation): packages the runtime needs (preact,
// Node's types) come from the installation, so nothing depends on where the build directory is.
export const env = { ...process.env, NODE_PATH: [join(ROOT, "node_modules"), process.env.NODE_PATH].filter(Boolean).join(":") };

export async function run(cmd: string, args: string[], cwd: string): Promise<{ ok: boolean; out: string }> {
  const r = await proc(cmd, args, { cwd, timeoutMs: 180_000, env });
  return { ok: r.ok, out: `${r.stdout}${r.stderr}`.trim() };
}

// Drop progress noise, keep the messages.
export function clean(s: string): string {
  return s
    .split("\n")
    .filter((l) => !/^(Compiling|Success|Dependencies|Starting|Verifying|Building)/.test(l.trim()))
    .join("\n")
    .trim()
    .slice(0, 6000);
}

