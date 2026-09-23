// Compile a scaffolded build directory with the real target toolchain.
import { run as proc } from "./proc.ts";
import { copyFileSync } from "node:fs";
import { join } from "node:path";
import { ROOT, type Target } from "./gen.ts";

const bin = (name: string) => join(ROOT, "node_modules/.bin", name);

async function run(cmd: string, args: string[], cwd: string): Promise<{ ok: boolean; out: string }> {
  const r = await proc(cmd, args, { cwd, timeoutMs: 180_000 });
  return { ok: r.ok, out: `${r.stdout}${r.stderr}`.trim() };
}

/** Returns compiler errors (empty string when the build compiled). */
export async function compile(target: Target, dir: string): Promise<string> {
  if (target === "elm") {
    const w = await run(bin("elm"), ["make", "src/Worker.elm", "--optimize", "--output=worker.js"], dir);
    if (!w.ok) return clean(w.out);
    copyFileSync(join(dir, "worker.js"), join(dir, "worker.cjs"));
    const m = await run(bin("elm"), ["make", "src/Main.elm", "--optimize", "--output=main.js"], dir);
    return m.ok ? "" : clean(m.out);
  }
  const t = await run(bin("tsc"), ["-p", "."], dir);
  if (!t.ok) return clean(t.out);
  const b1 = await run(bin("esbuild"), ["main.ts", "--bundle", "--format=iife", "--outfile=main.js", "--log-level=error"], dir);
  if (!b1.ok) return clean(b1.out);
  const b2 = await run(bin("esbuild"), ["test-entry.ts", "--bundle", "--format=esm", "--platform=node", "--outfile=test.mjs", "--log-level=error"], dir);
  return b2.ok ? "" : clean(b2.out);
}

// Drop progress noise, keep the messages.
function clean(s: string): string {
  return s
    .split("\n")
    .filter((l) => !/^(Compiling|Success|Dependencies|Starting|Verifying|Building)/.test(l.trim()))
    .join("\n")
    .trim()
    .slice(0, 6000);
}

/** Styled builds: the browser bundle with the LLM-written Look, plus Tailwind. */
export async function compileStyled(target: Target, dir: string): Promise<string> {
  if (target === "elm") {
    const m = await run(bin("elm"), ["make", "src/Main.elm", "--optimize", "--output=main.js"], dir);
    if (!m.ok) return clean(m.out);
  } else {
    const t = await run(bin("tsc"), ["-p", "."], dir);
    if (!t.ok) return clean(t.out);
    const b = await run(bin("esbuild"), ["main.tsx", "--bundle", "--format=iife", "--outfile=main.js", "--log-level=error"], dir);
    if (!b.ok) return clean(b.out);
  }
  const tw = await run(bin("tailwindcss"), ["-i", "theme.css", "-o", "style.css"], dir);
  return tw.ok ? "" : clean(tw.out);
}

/** api profile: type-check, then bundle the test client and the server. */
export async function compileApi(dir: string): Promise<string> {
  const t = await run(bin("tsc"), ["-p", "."], dir);
  if (!t.ok) return clean(t.out);
  for (const [entry, out] of [["test-entry.ts", "test.mjs"], ["server.ts", "server.mjs"]]) {
    const b = await run(bin("esbuild"), [entry, "--bundle", "--format=esm", "--platform=node", `--outfile=${out}`, "--log-level=error"], dir);
    if (!b.ok) return clean(b.out);
  }
  return "";
}
