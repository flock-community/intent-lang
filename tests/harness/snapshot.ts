// Everything the harness generates without an LLM, for every spec and target: each scaffold file
// and each prompt (first attempt, probe, repair), as a digest. A change to the harness that should
// not change what builds get (a refactor) must leave this unchanged; one that should is reviewed
// by its diff: `node tests/harness/snapshot.ts --update` rewrites snapshot.txt.
import { createHash } from "node:crypto";
import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
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

const specs: string[] = [];
const walk = (d: string) => { for (const f of readdirSync(d)) { const p = join(d, f); if (statSync(p).isDirectory()) walk(p); else if (p.endsWith(".intent")) specs.push(p); } };
walk("apps"); walk("lib/std/http"); specs.push("lib/support/ticketsApi.intent", "lib/pay/paymentsApi.intent");
const fake = mkdtempSync(join(tmpdir(), "snap-layer-"));
for (const f of ["layer.ts", "spec.ts", "http.ts", "fmt.ts"]) writeFileSync(join(fake, f), "x");
const layerDirs = new Proxy({}, { get: () => fake });
const h = (s: string) => createHash("sha256").update(s).digest("hex").slice(0, 12);
const out: string[] = [];
const files = (dir: string) => { const r: string[] = []; const w = (d: string) => { for (const f of readdirSync(d).sort()) { const p = join(d, f); if (statSync(p).isDirectory()) w(p); else r.push(p); } }; w(dir); return r; };
for (const spec of specs.sort()) {
  const { app } = load(spec, { ignoreLock: true });
  if (!app) { out.push(`${spec} (does not load)`); continue; }
  const text = printApp(app);
  const layer = app.kind === "layer", api = app.profile === "api" && !layer;
  if (app.kind === "contract") { out.push(`${spec} client ${h(genClient(app))}`); continue; }
  for (const target of layer || api ? ["ts"] : ["elm", "ts"]) {
    const dir = mkdtempSync(join(tmpdir(), "snap-"));
    try {
      const { specSource } = layer ? scaffoldLayer(app, dir) : api ? scaffoldApi(app, dir, layerDirs) : gen.scaffold(app, target, dir, layerDirs);
      for (const f of files(dir)) out.push(`${spec} ${target} ${relative(dir, f)} ${h(readFileSync(f, "utf8"))}`);
      for (const probe of [false, true]) {
        const p = layer ? layerPrompt(spec, text, specSource, probe, !!app.beforeCall) : buildPrompt(target, spec, text, specSource, probe, api, hasClients(app), hasThrough(app), usesClock(app), gen.hasData(app), gen.hasStored(app));
        out.push(`${spec} ${target} prompt${probe ? "-probe" : ""} ${h(p)} repair ${h(repairPrompt(p, target, "code", "problems"))}`);
      }
    } catch (e) { out.push(`${spec} ${target} ERROR ${(e as Error).message}`); }
    rmSync(dir, { recursive: true, force: true });
  }
}
rmSync(fake, { recursive: true, force: true });
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
