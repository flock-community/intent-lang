// Everything the harness generates without an LLM, for every spec and target: each scaffold file
// and each prompt (first attempt, probe, repair), as a digest. A change to the harness that should
// not change what builds get (a refactor) must leave this unchanged; one that should is reviewed
// by its diff: `node tests/harness/snapshot.ts --update` rewrites snapshot.txt.
import { createHash } from "node:crypto";
import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";
const ROOT = join(dirname(fileURLToPath(import.meta.url)), "../..");
process.chdir(ROOT);
const R = join(ROOT, "compiler") + "/";
const { load } = await import(R + "load.ts");
const { printApp } = await import(R + "print.ts");
const gen = await import(R + "gen.ts");
const { buildPrompt, layerPrompt, repairPrompt } = await import(R + "prompt.ts");
const { scaffoldApi, genApiSpec, genClient } = await import(R + "api.ts");
const { scaffoldLayer } = await import(R + "layer.ts");
const { hasClients, hasThrough } = await import(R + "calls.ts");
const { usesClock } = await import(R + "refs.ts");
const { usesDraws } = await import(R + "draws.ts");
const { mangledNames } = await import(R + "targets/shared.ts");
const { changePlan, hasChangeRules } = await import(R + "changes.ts");
const { invariantsPrompt, stageSentences } = await import(R + "invariants.ts");

const specs: string[] = [];
const walk = (d: string) => { for (const f of readdirSync(d)) { const p = join(d, f); if (statSync(p).isDirectory()) walk(p); else if (p.endsWith(".intent")) specs.push(p); } };
walk("apps"); walk("lib/std/http"); specs.push("lib/support/ticketsApi.intent", "lib/pay/paymentsApi.intent", "lib/std/actions.intent");
const fake = mkdtempSync(join(tmpdir(), "snap-layer-"));
for (const f of ["layer.ts", "spec.ts", "http.ts", "fmt.ts"]) writeFileSync(join(fake, f), "x");
const layerDirs = new Proxy({}, { get: () => fake });
const h = (s: string) => createHash("sha256").update(s).digest("hex").slice(0, 12);
const out: string[] = [];
const placed: string[] = []; // generated files that name a path on this machine
const files = (dir: string) => { const r: string[] = []; const w = (d: string) => { for (const f of readdirSync(d).sort()) { const p = join(d, f); if (statSync(p).isDirectory()) w(p); else r.push(p); } }; w(dir); return r; };
for (const spec of specs.sort()) {
  const { app } = load(spec, { ignoreLock: true });
  // A spec that stops loading is a regression, never a new snapshot: fail, even with --update.
  if (!app) {
    console.error(`${spec} does not load: fix it (intent check ${spec}) before the snapshot can be taken`);
    process.exit(1);
  }
  const text = printApp(app);
  const layer = app.kind === "layer", api = app.profile === "api" && !layer;
  if (app.kind === "contract") { out.push(`${spec} client ${h(genClient(app))}`); continue; }
  // The checks of \`always\`: the change rules the harness reads itself, and the stage's prompt (one-moment and general sentences).
  if (!layer && hasChangeRules(app)) out.push(`${spec} changes.json ${h(JSON.stringify(changePlan(app), null, 2))}`);
  const stage = stageSentences(app);
  if (!layer && (stage.invariants.length || stage.changes.length)) out.push(`${spec} invariants-prompt ${h(invariantsPrompt(app, text))}`);
  for (const target of layer || api ? ["ts"] : ["elm", "ts"]) {
    const dir = mkdtempSync(join(tmpdir(), "snap-"));
    try {
      const { specSource } = layer ? scaffoldLayer(app, dir) : api ? scaffoldApi(app, dir, layerDirs) : gen.scaffold(app, target, dir, layerDirs);
      for (const f of files(dir)) {
        const text = readFileSync(f, "utf8");
        // A generated file is the same bytes on every machine: it never names where the installation,
        // the checkout or the home directory is (a tsconfig.json once held the absolute typeRoots).
        for (const where of [ROOT, homedir(), tmpdir()]) if (where.length > 1 && text.includes(where)) placed.push(`${spec} ${target} ${relative(dir, f)} names ${where}`);
        out.push(`${spec} ${target} ${relative(dir, f)} ${h(text)}`);
      }
      for (const probe of [false, true]) {
        const p = layer ? layerPrompt(spec, text, specSource, probe, !!app.beforeCall) : buildPrompt(target, spec, text, specSource, probe, api, hasClients(app), hasThrough(app), usesClock(app), gen.hasData(app), gen.hasStored(app), undefined, undefined, undefined, usesDraws(app), !!app.access, mangledNames(app, api ? "ts" : target), gen.startsAfterRestore(app));
        for (const where of [ROOT, homedir()]) if (p.includes(where)) placed.push(`${spec} ${target} prompt names ${where}`);
        out.push(`${spec} ${target} prompt${probe ? "-probe" : ""} ${h(p)} repair ${h(repairPrompt(p, target, "code", "problems"))}`);
      }
    } catch (e) {
      // A scaffold that throws is a regression, never a snapshot entry.
      console.error(`${spec} ${target}: the harness cannot scaffold it: ${(e as Error).message}`);
      process.exit(1);
    }
    rmSync(dir, { recursive: true, force: true });
  }
}
rmSync(fake, { recursive: true, force: true });
if (placed.length) {
  console.error(`generated files name a path on this machine (they must not):\n  ${placed.slice(0, 20).join("\n  ")}`);
  process.exit(1);
}
const file = join(ROOT, "tests/harness/snapshot.txt");
const now = out.join("\n") + "\n";
if (process.argv.includes("--update") || !existsSync(file)) {
  writeFileSync(file, now);
  console.log(`harness snapshot written: ${out.length} entries`);
} else {
  const before = readFileSync(file, "utf8").split("\n");
  const after = now.split("\n");
  const changed = after.filter((l) => !before.includes(l));
  const gone = before.filter((l) => !after.includes(l));
  if (!changed.length && !gone.length) console.log(`harness snapshot: ${out.length} entries unchanged`);
  else {
    console.log(`harness snapshot changed (${changed.length} new or different, ${gone.length} gone). If intended: node tests/harness/snapshot.ts --update`);
    for (const l of changed.slice(0, 20)) console.log("  now:    " + l);
    for (const l of gone.slice(0, 20)) console.log("  before: " + l);
    process.exit(1);
  }
}
