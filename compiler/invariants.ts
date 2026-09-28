// Checks over the app's data: the `- sentence` lines in `always`. A separate compiler stage writes
// them, once per spec, apart from the app's code, so the app's compiler cannot bend a check to its
// own reading. Every build of the spec (both targets, twin builds) runs the same checks, after every
// step of every example and session, on the data the app hands over (`data(model)`).
//
// A check is only as right as its reading of the sentence (v36 review §9). So the stage compiles a
// second, independent reading (the probe) and the driver compares the two on the app's real data:
// where they disagree, the sentence is ambiguous and the build stops instead of trusting one reading.
import { copyFileSync, cpSync, existsSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import type { App } from "./ast.ts";
import { PROJECT_ROOT, ROOT, tsData, tsDomain } from "./gen.ts";
import { complete, extractCode } from "./llm.ts";
import { compilerPins, sha } from "./load.ts";
import { run as proc } from "./proc.ts";
import { changePlan, oneMoment } from "./changes.ts";
import { publish, stagingFor, withLock } from "./cachedir.ts";

const SYSTEM = `You are a stage of the Intent compiler. You turn sentences that must always hold into boolean checks over an app's data. Be literal: check exactly what each sentence says, nothing more. Reply with one TypeScript module in a single fenced code block and nothing else.`;

const bin = (name: string) => join(ROOT, "node_modules/.bin", name);

/** Two helpers for change rules, in the stage's Fmt: no reading has to invent how rows are matched. */
export const CHANGE_HELPERS = `
/** \`the new @xs\`: the rows of \`after\` whose key was not in \`before\` (in \`after\`'s order). Without a key (a list of plain values), a multiset difference. */
export function added<T>(before: T[], after: T[], key?: keyof T & string): T[] {
  const id = (v: T) => JSON.stringify(key ? v[key] : v);
  if (key) {
    const had = new Set(before.map(id));
    return after.filter((r) => !had.has(id(r)));
  }
  const left = new Map<string, number>();
  for (const v of before) left.set(id(v), (left.get(id(v)) ?? 0) + 1);
  return after.filter((v) => {
    const n = left.get(id(v)) ?? 0;
    if (n > 0) return left.set(id(v), n - 1), false;
    return true;
  });
}

/** \`the removed @xs\`: the rows of \`before\` whose key is not in \`after\` (in \`before\`'s order). Without a key, a multiset difference. */
export function removed<T>(before: T[], after: T[], key?: keyof T & string): T[] {
  return added(after, before, key);
}
`;

/** The sentences the stage compiles: the one-moment ones (\`invariants\`) and the change rules only it can read (\`changes\`). */
export function stageSentences(app: App): { invariants: { line: number; text: string }[]; changes: { line: number; text: string }[] } {
  return { invariants: oneMoment(app).map((i) => ({ line: i.line, text: i.text })), changes: changePlan(app).general };
}

/** The stage's first prompt, for the harness snapshot. */
export const invariantsPrompt = (app: App, specText: string) => prompt(app, specText, `// Generated from ${app.name}.intent — the app's data, as the checks see it.\n${tsDomain(app)}${tsData(app)}`);

function prompt(app: App, specText: string, dataModule: string, previous?: { code: string; problems: string }, first?: string): string {
  const { invariants, changes } = stageSentences(app);
  const list = invariants.map((i) => `- line ${i.line}: ${i.text}`).join("\n");
  const changeList = changes.map((i) => `- line ${i.line}: ${i.text}`).join("\n");
  const changePart = changes.length
    ? `
/** One check per change rule, in order: does it hold across one step (the data before the step, and after it)? */
export const changes: { line: number; holds: (before: Data, after: Data, clock: Clock) => boolean }[] = [
  { line: …, holds: (before, after, clock) => … },
];`
    : "";
  const changeRules = changes.length
    ? `- A change rule relates the data before one step (\`before\`) to the data after it (\`after\`). A reference without \`before\` is its value after the step; \`@x before\` is its value in \`before\`; \`was\` is \`is\` in \`before\`.
- \`the new @xs\` is \`Fmt.added(before.xs, after.xs, "<key>")\`, \`the removed @xs\` is \`Fmt.removed(before.xs, after.xs, "<key>")\`, with the record's key field; for a list of plain values leave the key out (a multiset difference).
- A row that was not there before the step has no fields before it: its \`@f before\` is nothing, \`was @X\` is false for it and \`was not @X\` true. Rows are matched by their key, never by position.
- A derived value used with \`before\` is computed from \`before\` as the spec says, and without it from \`after\`. \`clock\` is the time after the step.
`
    : "";
  return `# The spec, as the compiler reads it

\`\`\`intent
${specText}
\`\`\`

# The sentences to check (from \`always\`)

${list || "(none: export an empty list)"}
${changes.length ? `\n# The change rules to check (from \`always\`): each is about one step\n\n${changeList}\n` : ""}
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
];${changePart}
\`\`\`

- One entry per sentence above, in the same order, with its line number.
${changeRules}- A sentence may use derived values from the spec (\`derive\`): compute them from the data exactly as the spec's sentence says.
- \`@today\` / \`@now\` are \`clock.today\` / \`clock.now\`. Dates are "YYYY-MM-DD" and moments "YYYY-MM-DDTHH:MM" strings; use Fmt for arithmetic (addDays, daysBetween, addMinutes, minutesBetween, …).
- Pure functions: no I/O, no Date, no randomness. Strict TypeScript. Import with explicit extensions.
${first ? `\n# A first reading of these sentences\n\n\`\`\`ts\n${first}\`\`\`\n\nTake a different reading wherever a sentence leaves room for one (a boundary included or not, "at most" as \`<\` or \`<=\`, a tie order, what a phrase refers to); where the sentence is precise, keep the same. Reply with the complete module.\n` : ""}${previous ? `\n# Your previous attempt\n\n\`\`\`ts\n${previous.code}\`\`\`\n\n# Problems with it\n\n${previous.problems}\n\nFix these problems. Reply with the complete module.\n` : ""}`;
}

const pending = new Map<string, Promise<{ costUsd: number; error?: string }>>();

/**
 * The checks for this spec: from the cache, or compiled now (the normal reading and the probe,
 * once, also when several builds ask at the same time). Copies `invariants.mjs` (and the probe,
 * when it compiles) and `invariants.json` into `into`.
 */
export async function prepareInvariants(app: App, specText: string, into: string, log: (m: string) => void): Promise<{ costUsd: number; error?: string }> {
  // The checks depend only on the sentences, the derived values they may use, the data shape and
  // the platforms they name — not on examples, screens or handlers. Keying on those reuses them
  // when only an unrelated part of the spec changed (a small, safe increment).
  const key = sha(
    JSON.stringify({
      // The stage's sentences: the one-moment ones, and the change rules only it reads (the harness checks the named forms).
      invariants: stageSentences(app).invariants.map((i) => `${i.line}:${i.text}`),
      changes: stageSentences(app).changes.length ? stageSentences(app).changes.map((i) => `${i.line}:${i.text}`) : undefined,
      derive: app.derive.map((d) => d.sentence),
      domain: tsDomain(app),
      data: tsData(app),
      platforms: (app.platforms ?? []).map((p) => p.name),
      compiler: compilerPins(),
      stage: "invariants",
      // The stage itself: its prompt and system text (this module) and the Fmt its checks import.
      harness: sha(readFileSync(new URL(import.meta.url), "utf8") + readFileSync(join(ROOT, "runtime/ts/fmt.ts"), "utf8")),
    }),
  );
  if (!pending.has(key)) pending.set(key, compileInvariants(app, specText, key, log));
  const r = await pending.get(key)!;
  if (r.error) return r;
  const dir = join(PROJECT_ROOT, ".intent/invariants", key);
  await withLock(dir, () => {
    copyFileSync(join(dir, "invariants.mjs"), join(into, "invariants.mjs"));
    copyFileSync(join(dir, "invariants.json"), join(into, "invariants.json"));
    if (existsSync(join(dir, "invariants-probe.mjs"))) copyFileSync(join(dir, "invariants-probe.mjs"), join(into, "invariants-probe.mjs"));
  });
  return r;
}

/**
 * Compile the checks into their cache directory, under its lock, whole: the work is done in a
 * staging directory and renamed into place, so a crash or another process never leaves (or sees) a
 * directory with a module and no list of sentences, or a half-written probe.
 */
async function compileInvariants(app: App, specText: string, key: string, log: (m: string) => void): Promise<{ costUsd: number; error?: string }> {
  const dir = join(PROJECT_ROOT, ".intent/invariants", key);
  const first = (d: string) => existsSync(join(d, "invariants.mjs")) && existsSync(join(d, "invariants.json"));
  const probed = (d: string) => existsSync(join(d, "invariants-probe.mjs")) || existsSync(join(d, "invariants-probe.skip"));
  return withLock(dir, async () => {
    if (first(dir) && probed(dir)) return { costUsd: 0 };
    const stage = stagingFor(dir);
    try {
      if (first(dir)) cpSync(dir, stage, { recursive: true }); // the first reading is kept; only the probe is missing
      const r = await compileInto(app, specText, stage, log);
      if (r.error) {
        rmSync(stage, { recursive: true, force: true });
        return r;
      }
      publish(stage, dir);
      return r;
    } catch (e) {
      rmSync(stage, { recursive: true, force: true });
      throw e;
    }
  });
}

async function compileInto(app: App, specText: string, dir: string, log: (m: string) => void): Promise<{ costUsd: number; error?: string }> {
  const { invariants: texts, changes } = stageSentences(app);
  let costUsd = 0;
  const dataFile = join(dir, "data.ts");
  if (!existsSync(join(dir, "invariants.json"))) {
    // Change rules get two helpers in the stage's Fmt (added, removed); the app's Fmt is not touched.
    writeFileSync(join(dir, "fmt.ts"), readFileSync(join(ROOT, "runtime/ts/fmt.ts"), "utf8") + (changes.length ? CHANGE_HELPERS : ""));
    const dataModule = `// Generated from ${app.name}.intent — the app's data, as the checks see it.\n${tsDomain(app)}${tsData(app)}`;
    writeFileSync(dataFile, dataModule);
    writeFileSync(join(dir, "tsconfig.json"), JSON.stringify({ compilerOptions: { strict: true, noEmit: true, target: "es2022", module: "esnext", moduleResolution: "bundler", allowImportingTsExtensions: true, lib: ["es2022"], skipLibCheck: true }, include: ["*.ts"] }));
    const a = await compileCheck(app, specText, dir, "invariants", texts, changes, dataModule, undefined, log);
    costUsd += a.costUsd;
    if (a.error) return { costUsd, error: "the checks for `always` did not compile" };
    // Written last: its presence says the first reading is complete.
    writeFileSync(join(dir, "invariants.json"), JSON.stringify(texts, null, 2));
  }
  // The probe: a second reading, compared on the app's data. Best-effort: a probe that will not
  // compile leaves the build with the one check, as before.
  if (!existsSync(join(dir, "invariants-probe.mjs")) && !existsSync(join(dir, "invariants-probe.skip"))) {
    const first = readFileSync(join(dir, "invariants.ts"), "utf8");
    const b = await compileCheck(app, specText, dir, "invariants-probe", texts, changes, readFileSync(dataFile, "utf8"), first, log);
    costUsd += b.costUsd;
    if (b.error) {
      rmSync(join(dir, "invariants-probe.mjs"), { force: true });
      writeFileSync(join(dir, "invariants-probe.skip"), b.error);
    }
  }
  return { costUsd };
}

/** Generate, compile and check one reading. `first` (the normal reading) makes this the probe. */
async function compileCheck(app: App, specText: string, dir: string, base: string, texts: { line: number; text: string }[], changes: { line: number; text: string }[], dataModule: string, first: string | undefined, log: (m: string) => void): Promise<{ costUsd: number; error?: string }> {
  const what = base === "invariants" ? "checks for `always`" : "checks for `always` (probe)";
  let costUsd = 0;
  let previous: { code: string; problems: string } | undefined;
  for (let attempt = 1; attempt <= 3; attempt++) {
    const r = await complete(SYSTEM, prompt(app, specText, dataModule, previous, first), first !== undefined);
    costUsd += r.costUsd;
    if (r.error) return { costUsd, error: r.error };
    const code = extractCode(r.text);
    writeFileSync(join(dir, `${base}.ts`), code);
    const t = await proc(bin("tsc"), ["-p", "."], { cwd: dir, timeoutMs: 120_000 });
    const b = t.ok ? await proc(bin("esbuild"), [`${base}.ts`, "--bundle", "--format=esm", "--platform=node", `--outfile=${base}.mjs`, "--log-level=error"], { cwd: dir, timeoutMs: 120_000 }) : t;
    if (!b.ok) {
      previous = { code, problems: `It does not compile:\n\n\`\`\`\n${(b.stdout + b.stderr).slice(0, 4000)}\n\`\`\`` };
      log(`${what}: attempt ${attempt}: compile errors`);
      continue;
    }
    const mod = await import(pathToFileURL(join(dir, `${base}.mjs`)).href + `?t=${Date.now()}`);
    const lines = (mod.invariants ?? []).map((i: { line: number }) => i.line);
    if (JSON.stringify(lines) !== JSON.stringify(texts.map((t) => t.line))) {
      previous = { code, problems: `It must export one check per sentence, in order, with lines ${JSON.stringify(texts.map((t) => t.line))}; it has ${JSON.stringify(lines)}.` };
      continue;
    }
    const changeLines = (mod.changes ?? []).map((i: { line: number }) => i.line);
    if (changes.length && JSON.stringify(changeLines) !== JSON.stringify(changes.map((t) => t.line))) {
      previous = { code, problems: `It must export \`changes\`: one check per change rule, in order, with lines ${JSON.stringify(changes.map((t) => t.line))}; it has ${JSON.stringify(changeLines)}.` };
      continue;
    }
    log(`${what}: attempt ${attempt}: ok`);
    return { costUsd };
  }
  return { costUsd, error: "it did not compile" };
}
