// The expanded spec (what the compiler reads, printed by compiler/print.ts) says what the spec says:
// every example's steps, printed and read back, are the same steps. (`choose … on row 1` once lost
// its row in print, and two compilers rightly called the examples a conflict.)
import assert from "node:assert/strict";
import { readdirSync, statSync } from "node:fs";
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
console.log(`ok print: ${steps} example steps in ${specs.length} specs read back the same`);
