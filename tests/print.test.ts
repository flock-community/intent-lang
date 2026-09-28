// The expanded spec (what the compiler reads, printed by compiler/print.ts) says what the spec says:
// every example's steps, printed and read back, are the same steps. (`choose … on row 1` once lost
// its row in print, and two compilers rightly called the examples a conflict.)
import assert from "node:assert/strict";
import { mkdtempSync, readdirSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { load } from "../compiler/load.ts";
import { parseSyntax } from "../compiler/parse.ts";
import { printApp, stepText } from "../compiler/print.ts";

const specs: string[] = [];
const walk = (d: string) => { for (const f of readdirSync(d)) { const p = join(d, f); if (statSync(p).isDirectory()) walk(p); else if (p.endsWith(".intent")) specs.push(p); } };
walk(new URL("../apps", import.meta.url).pathname);
let steps = 0;
for (const spec of specs) {
  const { app } = load(spec, { ignoreLock: true });
  if (!app) continue;
  const again = parseSyntax(printApp(app)).app;
  for (const ex of app.examples) {
    const back = again.examples.find((e) => e.name === ex.name);
    assert.ok(back, `${spec}: example "${ex.name}" is lost in print`);
    assert.deepEqual(back!.steps.map(stepText), ex.steps.map(stepText), `${spec}: example "${ex.name}" changes in print`);
    const strip = (x: unknown) => JSON.parse(JSON.stringify(x, (k, v) => (k === "line" ? undefined : v)));
    assert.deepEqual(strip(back!.steps), strip(ex.steps), `${spec}: example "${ex.name}" reads back differently`);
    steps += ex.steps.length;
  }
}

// The expanded spec is what the compiler reads, so it must say everything the spec says, and read back
// clean (v72): every spec in apps/ and lib/ that checks clean, printed (`intent expand`), checks clean
// again. It once lost every endpoint's `answers`, a platform's functions and the platforms an app
// imports, printed a client's endpoints as lines the parser rejects, and re-declared what a `uses`
// brings back; a component's qualified names (`pager.next`) did not read back at all.
const all: string[] = [];
const walkAll = (d: string) => { for (const f of readdirSync(d)) { const p = join(d, f); if (statSync(p).isDirectory()) walkAll(p); else if (p.endsWith(".intent")) all.push(p); } };
walkAll(new URL("../apps", import.meta.url).pathname);
walkAll(new URL("../lib", import.meta.url).pathname);
const dir = mkdtempSync(join(tmpdir(), "print-test-"));
let printed = 0;
for (const spec of all) {
  const { app } = load(spec, { ignoreLock: true });
  if (!app) continue; // a profile (checked apart), not a spec
  const out = join(dir, `${printed}.intent`);
  writeFileSync(out, printApp(app));
  const again = load(out, { ignoreLock: true });
  const errors = again.diagnostics.filter((d) => d.level === "error");
  assert.deepEqual(errors.map((d) => `${d.file === again.sources[0].file ? "" : `${d.file}:`}${d.line} ${d.code}: ${d.message}`), [], `${spec}: its expanded form (${out}) does not check clean`);
  printed++;
}
assert.ok(printed >= 80, `only ${printed} specs were printed`);

// An empty label is printed as it was given: `button add ""` (a button without one is an error).
const empty = join(dir, "empty.intent");
writeFileSync(empty, 'app EmptyLabel {\n  "A button with an empty label."\n}\nstate {\n  count: Int = 0\n}\nscreen {\n  text shown = @count\n  button add ""\n}\non click add {\n  - increase @count by 1\n}\nexample "e" {\n  click add\n  see shown = "1"\n}\n');
const e = load(empty, { ignoreLock: true }).app!;
assert.match(printApp(e), /button add ""/, "an empty label survives print");

console.log(`ok print: ${steps} example steps in ${specs.length} specs read back the same; ${printed} expanded specs (apps/, lib/) check clean again`);
