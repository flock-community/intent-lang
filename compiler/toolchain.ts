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
