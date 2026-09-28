// The harness compiles, for every spec and target, without an LLM: every generated file that does not
// depend on the model's code (spec.ts, Spec.elm, the runtime and the glue) is type-checked or
// compiled with the build's own settings. A harness bug (a DOM name in a service, a cast TypeScript
// rejects) fails here, in npm test, instead of in a paid build.
import { spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";
const ROOT = join(dirname(fileURLToPath(import.meta.url)), "../..");
process.chdir(ROOT);
const R = join(ROOT, "compiler") + "/";
const { load } = await import(R + "load.ts");
const gen = await import(R + "gen.ts");
const { scaffoldApi } = await import(R + "api.ts");

const specs: string[] = [];
const walk = (d: string) => { for (const f of readdirSync(d)) { const p = join(d, f); if (statSync(p).isDirectory()) walk(p); else if (p.endsWith(".intent")) specs.push(p); } };
walk("apps");
// Layers are built apart (their code is the model's); a build that uses one gets a stand-in here.
const fake = mkdtempSync(join(tmpdir(), "compile-layer-"));
for (const f of ["layer.ts", "spec.ts", "http.ts", "fmt.ts"]) writeFileSync(join(fake, f), "export {};\n");
const layerDirs = new Proxy({}, { get: () => fake });
const tsc = join(ROOT, "node_modules/.bin/tsc"), elm = join(ROOT, "node_modules/.bin/elm");
// Files that need the model's code or a layer's build: everything else must compile on its own.
const MODEL = /from\s+"\.\/(app|main|test-entry|job|through|layers|pipeline|server)(\.ts)?"/;
const SKIP = new Set(["app.ts", "main.ts", "test-entry.ts", "job.ts", "through.ts", "layers.ts", "pipeline.ts", "server.ts"]);

type Job = { spec: string; target: string; dir: string; ts: string[]; elm: boolean };
const jobs: Job[] = [];
for (const spec of specs.sort()) {
  const { app } = load(spec, { ignoreLock: true });
  if (!app) throw new Error(`${spec} does not load`);
  if (app.kind === "contract" || app.kind === "layer" || app.kind === "bundle") continue;
  const api = app.profile === "api";
  for (const target of api ? ["ts"] : ["elm", "ts"]) {
    const dir = mkdtempSync(join(tmpdir(), "compile-"));
    if (api) scaffoldApi(app, dir, layerDirs);
    else gen.scaffold(app, target, dir, layerDirs);
    const ts = readdirSync(dir).filter((f) => f.endsWith(".ts") && !SKIP.has(f) && !MODEL.test(readFileSync(join(dir, f), "utf8")));
    jobs.push({ spec, target, dir, ts, elm: target === "elm" && existsSync(join(dir, "src/Spec.elm")) });
  }
}

const run = (cmd: string, args: string[], cwd: string) => new Promise<{ ok: boolean; out: string }>((done) => {
  const r = spawnSync(cmd, args, { cwd, encoding: "utf8" });
  done({ ok: r.status === 0, out: `${r.stdout ?? ""}${r.stderr ?? ""}`.trim() });
});
let failures = 0;
const check = async (j: Job) => {
  if (j.ts.length) {
    // The build's own tsconfig (DOM or not, strictness), limited to the files that stand alone.
    writeFileSync(join(j.dir, "tsconfig.harness.json"), JSON.stringify({ extends: "./tsconfig.json", include: [], files: j.ts }));
    const r = existsSync(join(j.dir, "tsconfig.json")) ? await run(tsc, ["--noEmit", "-p", "tsconfig.harness.json"], j.dir) : { ok: true, out: "" };
    if (!r.ok) (failures++, console.log(`${j.spec} ${j.target}: harness TypeScript does not compile\n${r.out.split("\n").slice(0, 8).join("\n")}`));
  }
  if (j.elm) {
    const r = await run(elm, ["make", "src/Spec.elm", "--output=/dev/null"], j.dir);
    if (!r.ok) (failures++, console.log(`${j.spec} ${j.target}: Spec.elm does not compile\n${r.out.split("\n").slice(0, 12).join("\n")}`));
  }
  rmSync(j.dir, { recursive: true, force: true });
};
for (let i = 0; i < jobs.length; i += 4) await Promise.all(jobs.slice(i, i + 4).map(check));
rmSync(fake, { recursive: true, force: true });
console.log(failures ? `${failures} harness compile failure(s)` : `harness compiles: ${jobs.length} builds (${jobs.filter((j) => j.elm).length} Elm), every file that does not need the model's code`);
process.exit(failures ? 1 : 0);
