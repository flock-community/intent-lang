// Recorded edits applied incrementally, to measure the incremental build
// (docs/design/incremental.md, "How it is measured"). It needs an LLM, so it is not part of
// `npm test`: run it with the compiler's provider set, e.g.
//
//   INTENT_LLM=openai INTENT_MODEL=deepseek-chat OPENAI_API_KEY=… node tests/incremental/edits.ts
//
// It builds an app from scratch (the seed), then applies each recorded edit and builds again with
// `incremental auto` + `cleanCheck always`, and reports the cost, whether the app code or a clean
// region was reused, and whether the twin (with the from-scratch check) confirmed it.
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { load } from "../../compiler/load.ts";
import { compileApp, CACHE } from "../../compiler/twin.ts";
import { forgetIncremental } from "../../compiler/incremental.ts";

interface Edit {
  what: string;
  apply: (spec: string) => string;
}

// Self-contained apps (no imports), with edits recorded by hand. Each edit must leave the spec
// valid and its examples passing.
const CASES: { app: string; edits: Edit[] }[] = [
  {
    app: "apps/01-counter.intent",
    edits: [
      { what: "a new example (no code change)", apply: (s) => `${s}\nexample "counting to three" {\n  click up\n  click up\n  click up\n  see count = 3\n}\n` },
      { what: "a changed handler", apply: (s) => s.replace("- increase @count by 1", "- increase @count by 1, but never above 99") },
      { what: "a changed element label", apply: (s) => s.replace('button up "+"', 'button up "++"') },
    ],
  },
];

const dir = mkdtempSync(join(tmpdir(), "intent-edits-"));
const log = (m: string) => process.stderr.write(`  ${m}\n`);
// A measurement, not a build: start with an empty verified-build cache, so each edit really takes
// its path (an app-code reuse, a region rewrite, or a full build).
rmSync(CACHE, { recursive: true, force: true });

const build = async (specFile: string, text: string, out: string, _seed: boolean) => {
  const { app, diagnostics } = load(specFile, { ignoreLock: true });
  if (!app) throw new Error(`${specFile}: ${diagnostics.map((d) => d.message).join("; ")}`);
  const t = Date.now();
  const r = await compileApp(app, specFile, text, "ts", out, {
    twin: "always", // bypass the verified-build cache, so each edit's path is measured
    incremental: true,
    cleanCheck: true,
    log,
  });
  const a = r.builds[0];
  return { ok: r.ok, verified: r.verified, cost: r.costUsd, ms: Date.now() - t, aCost: a?.costUsd ?? 0, aIncremental: !!a?.incremental, aFree: (a?.costUsd ?? 0) === 0 };
};

const rows: string[] = ["| app | edit | ok | verified | reused | A cost | total | ms |", "|---|---|---|---|---|---|---|---|"];
let pass = 0;
let total = 0;
for (const c of CASES) {
  const original = readFileSync(c.app, "utf8");
  const name = c.app.split("/").pop()!.replace(".intent", "");
  const seedFile = join(dir, `${name}-0.intent`);
  writeFileSync(seedFile, original);
  // Start from nothing: forget any resume state a previous run left for this app.
  const seedApp = load(seedFile, { ignoreLock: true }).app;
  if (seedApp) {
    forgetIncremental(seedApp, "ts", "main");
    forgetIncremental(seedApp, "ts", "probe");
  }
  process.stderr.write(`\n${name}: seeding\n`);
  const seed = await build(seedFile, original, join(dir, `${name}-out-0`), true);
  if (!seed.ok) throw new Error(`${name}: the seed build did not verify`);
  let prev = original;
  for (const [i, e] of c.edits.entries()) {
    const text = e.apply(prev);
    const file = join(dir, `${name}-${i + 1}.intent`);
    writeFileSync(file, text);
    process.stderr.write(`\n${name}: edit ${i + 1} — ${e.what}\n`);
    const r = await build(file, text, join(dir, `${name}-out-${i + 1}`), false);
    const reused = r.aIncremental ? "regions" : r.aFree ? "app code" : "no";
    total++;
    if (r.ok) pass++;
    rows.push(`| ${name} | ${e.what} | ${r.ok ? "yes" : "no"} | ${r.verified} | ${reused} | $${r.aCost.toFixed(3)} | $${r.cost.toFixed(3)} | ${r.ms} |`);
    prev = text;
  }
}
rmSync(dir, { recursive: true, force: true });
const report = `# Incremental builds: recorded edits\n\nThe compiler is the one in this run; each row is an edit of ${CASES[0].app} applied after the previous one.\n\n${rows.join("\n")}\n\n${pass}/${total} edits kept a verified build.\n`;
writeFileSync("runs/incremental-edits.md", report);
process.stdout.write(`${report}\n`);
if (pass !== total) process.exit(1);
