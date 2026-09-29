// One build of a spec in tests/harness/names (run by tests/harness/compile.ts, a process per build):
// the harness's generated files with the hand-written app module in stubs/, compiled, and its examples
// run. Exits 0 when it compiles and every example passes.
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
const ROOT = join(dirname(fileURLToPath(import.meta.url)), "../../..");
process.chdir(ROOT);
const R = join(ROOT, "compiler") + "/";
const { load } = await import(R + "load.ts");
const gen = await import(R + "gen.ts");
const { scaffoldApi, runApiJobs } = await import(R + "api.ts");
const { targetModule } = await import(R + "targets/index.ts");
const { runJobsIsolated } = await import(R + "exec.ts");
const { typeDescOf } = await import(R + "targets/ts-service.ts");
const { wireType } = await import(R + "calls.ts");

const [spec, target] = process.argv.slice(2);
const { app } = load(spec, { ignoreLock: true });
const base = spec.replace(/^.*\//, "").replace(/\.intent$/, "");
const stub = join(ROOT, "tests/harness/names/stubs", `${base}.${target === "elm" ? "App.elm" : "app.ts.stub"}`);
const dir = mkdtempSync(join(tmpdir(), "names-"));
let result: { pass?: boolean; name?: string }[] | { error: string };
if (target === "api") {
  scaffoldApi(app, dir, {});
  writeFileSync(join(dir, "app.ts"), readFileSync(stub, "utf8"));
  writeFileSync(join(dir, "endpoints.json"), JSON.stringify((app.endpoints ?? []).map((e: any) => ({ name: e.name, method: e.method, path: e.path, params: e.params.map((p: any) => ({ in: p.in, name: p.name, ...(wireType(app, p.type) ? { type: typeDescOf(app, p.type) } : {}) })) }))));
  const err = await targetModule("ts").service!.compileApi(dir);
  result = err ? { error: err } : await runApiJobs(dir, app.examples.map((example: unknown) => ({ kind: "api-example", example })));
} else {
  gen.scaffold(app, target, dir, {});
  writeFileSync(join(dir, target === "elm" ? "src/App.elm" : "app.ts"), readFileSync(stub, "utf8"));
  const err = await targetModule(target).compile(dir);
  result = err ? { error: err } : await runJobsIsolated(dir, target, app.examples.map((example: unknown) => ({ kind: "example", example })));
}
rmSync(dir, { recursive: true, force: true });
const bad = "error" in result ? [result.error] : result.filter((x) => !x.pass).map((x) => JSON.stringify(x).slice(0, 600));
const passed = "error" in result ? 0 : result.length;
if (bad.length) {
  console.log(bad.join("\n"));
  process.exit(1);
}
console.log(`${spec} ${target}: ${passed} example(s) pass`);
process.exit(0);
