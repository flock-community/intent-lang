// Checks over the app's data: the `- sentence` lines in `always`. A separate compiler stage writes
// them, once per spec, apart from the app's code, so the app's compiler cannot bend a check to its
// own reading. Every build of the spec (both targets, twin builds) runs the same checks, after every
// step of every example and session, on the data the app hands over (`data(model)`).
import { copyFileSync, existsSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import type { App } from "./ast.ts";
import { PROJECT_ROOT, ROOT, tsData, tsDomain } from "./gen.ts";
import { complete, extractCode } from "./llm.ts";
import { compilerPins, sha } from "./load.ts";
import { run as proc } from "./proc.ts";

const SYSTEM = `You are a stage of the Intent compiler. You turn sentences that must always hold into boolean checks over an app's data. Be literal: check exactly what each sentence says, nothing more. Reply with one TypeScript module in a single fenced code block and nothing else.`;

const bin = (name: string) => join(ROOT, "node_modules/.bin", name);

function prompt(app: App, specText: string, dataModule: string, previous?: { code: string; problems: string }): string {
  const list = (app.invariants ?? []).map((i) => `- line ${i.line}: ${i.text}`).join("\n");
  return `# The spec, as the compiler reads it

\`\`\`intent
${specText}
\`\`\`

# The sentences to check (from \`always\`)

${list}

# The app's data (data.ts)

\`\`\`ts
${dataModule}\`\`\`

# Write invariants.ts

\`\`\`ts
import type { Clock, Data } from "./data.ts";
import * as Fmt from "./fmt.ts";

/** One check per sentence, in order: does the sentence hold for this data (at this moment)? */
export const invariants: { line: number; holds: (d: Data, clock: Clock) => boolean }[] = [
  { line: …, holds: (d, clock) => … },
];
\`\`\`

- One entry per sentence above, in the same order, with its line number.
- A sentence may use derived values from the spec (\`derive\`): compute them from the data exactly as the spec's sentence says.
- \`@today\` / \`@now\` are \`clock.today\` / \`clock.now\`. Dates are "YYYY-MM-DD" and moments "YYYY-MM-DDTHH:MM" strings; use Fmt for arithmetic (addDays, daysBetween, addMinutes, minutesBetween, …).
- Pure functions: no I/O, no Date, no randomness. Strict TypeScript. Import with explicit extensions.
${previous ? `\n# Your previous attempt\n\n\`\`\`ts\n${previous.code}\`\`\`\n\n# Problems with it\n\n${previous.problems}\n\nFix these problems. Reply with the complete module.\n` : ""}`;
}

const pending = new Map<string, Promise<{ costUsd: number; error?: string }>>();

/** The checks for this spec: from the cache, or compiled now (once, also when several builds ask at the same time). Copies invariants.mjs and invariants.json into `into`. */
export async function prepareInvariants(app: App, specText: string, into: string, log: (m: string) => void): Promise<{ costUsd: number; error?: string }> {
  const key = sha(JSON.stringify({ specText, compiler: compilerPins(), stage: "invariants" }));
  if (!pending.has(key)) pending.set(key, compileInvariants(app, specText, key, log));
  const r = await pending.get(key)!;
  if (r.error) return r;
  const dir = join(PROJECT_ROOT, ".intent/invariants", key);
  copyFileSync(join(dir, "invariants.mjs"), join(into, "invariants.mjs"));
  copyFileSync(join(dir, "invariants.json"), join(into, "invariants.json"));
  return { costUsd: pending.get(key) === undefined ? 0 : r.costUsd };
}

async function compileInvariants(app: App, specText: string, key: string, log: (m: string) => void): Promise<{ costUsd: number; error?: string }> {
  const dir = join(PROJECT_ROOT, ".intent/invariants", key);
  const texts = (app.invariants ?? []).map((i) => ({ line: i.line, text: i.text }));
  let costUsd = 0;
  if (!existsSync(join(dir, "invariants.mjs"))) {
    mkdirSync(dir, { recursive: true });
    copyFileSync(join(ROOT, "runtime/ts/fmt.ts"), join(dir, "fmt.ts"));
    const dataModule = `// Generated from ${app.name}.intent — the app's data, as the checks see it.\n${tsDomain(app)}${tsData(app)}`;
    writeFileSync(join(dir, "data.ts"), dataModule);
    writeFileSync(join(dir, "tsconfig.json"), JSON.stringify({ compilerOptions: { strict: true, noEmit: true, target: "es2022", module: "esnext", moduleResolution: "bundler", allowImportingTsExtensions: true, lib: ["es2022"], skipLibCheck: true }, include: ["*.ts"] }));
    let previous: { code: string; problems: string } | undefined;
    for (let attempt = 1; attempt <= 3; attempt++) {
      const r = await complete(SYSTEM, prompt(app, specText, dataModule, previous));
      costUsd += r.costUsd;
      if (r.error) return { costUsd, error: r.error };
      const code = extractCode(r.text);
      writeFileSync(join(dir, "invariants.ts"), code);
      const t = await proc(bin("tsc"), ["-p", "."], { cwd: dir, timeoutMs: 120_000 });
      const b = t.ok ? await proc(bin("esbuild"), ["invariants.ts", "--bundle", "--format=esm", "--platform=node", "--outfile=invariants.mjs", "--log-level=error"], { cwd: dir, timeoutMs: 120_000 }) : t;
      if (!b.ok) {
        previous = { code, problems: `It does not compile:\n\n\`\`\`\n${(b.stdout + b.stderr).slice(0, 4000)}\n\`\`\`` };
        log(`checks for \`always\`: attempt ${attempt}: compile errors`);
        continue;
      }
      const mod = await import(pathToFileURL(join(dir, "invariants.mjs")).href + `?t=${Date.now()}`);
      const lines = (mod.invariants ?? []).map((i: { line: number }) => i.line);
      if (JSON.stringify(lines) !== JSON.stringify(texts.map((t) => t.line))) {
        previous = { code, problems: `It must export one check per sentence, in order, with lines ${JSON.stringify(texts.map((t) => t.line))}; it has ${JSON.stringify(lines)}.` };
        continue;
      }
      log(`checks for \`always\`: attempt ${attempt}: ok`);
      writeFileSync(join(dir, "invariants.json"), JSON.stringify(texts, null, 2));
      break;
    }
    if (!existsSync(join(dir, "invariants.json"))) return { costUsd, error: "the checks for `always` did not compile" };
  }
  return { costUsd };
}
