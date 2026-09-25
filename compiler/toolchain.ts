// Compile a scaffolded build directory with the real target toolchain.
import type { Target } from "./gen.ts";
import { targetModule } from "./targets/index.ts";
import { bin, clean, run } from "./tools.ts";

/** Returns compiler errors (empty string when the build compiled). */
export const compile = (target: Target, dir: string): Promise<string> => targetModule(target).compile(dir);

/** Styled builds: the browser bundle with the LLM-written Look, plus Tailwind. */
export async function compileStyled(target: Target, dir: string): Promise<string> {
  const built = await targetModule(target).compileStyled(dir);
  if (built) return built;
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

/** A layer: type-check, then bundle its test entry (the layer around a stub app). */
export async function compileLayer(dir: string): Promise<string> {
  const t = await run(bin("tsc"), ["-p", "."], dir);
  if (!t.ok) return clean(t.out);
  const b = await run(bin("esbuild"), ["test-entry.ts", "--bundle", "--format=esm", "--platform=node", "--outfile=test.mjs", "--log-level=error"], dir);
  return b.ok ? "" : clean(b.out);
}
