// The checker's time grows with the spec, not with its square or cube (v72). Each shape once took
// seconds to minutes, or overflowed the stack: a step of many parts (`clear @a and clear @a and …`,
// cubic), a long condition on a line with a SYNTAX error, a long `or`, a long sum, many `A when C;`
// alternatives, and many clicks in one example. Generous bounds: they catch a return to quadratic.
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { load } from "../compiler/load.ts";

const N = 2000;
const app = (name: string, state: string, screen: string, handler: string, example: string) =>
  `app ${name} {\n  "A generated app with one very long sentence."\n}\nstate {\n${state}\n}\nscreen {\n${screen}\n}\non click go {\n${handler}\n}\nexample "e" {\n${example}\n}\n`;
const shapes: [string, string][] = [
  ["a step of 2,000 parts", app("Steps", `  draft: Text = ""`, `  field draft\n  button go "Go"`, `  - ${Array(N).fill("clear @draft").join(" and ")}`, `  type "a" into draft\n  click go\n  see draft = ""`)],
  ["a condition of 16,000 parts on a line with a SYNTAX error", app("Broken", `  name: Text = ""`, `  field name\n  button go "Go"`, `  if @name is blank { ${Array(8 * N).fill("phase;").join(" ")}\n    stop\n  }`, `  click go\n  see name = ""`)],
  ["an `or` of 2,000 conditions", app("Ors", `  name: Text = ""`, `  field name\n  button go "Go"`, `  if ${Array(N).fill("@name is blank").join(" or ")} {\n    stop\n  }`, `  click go\n  see name = ""`)],
  ["a sum of 2,000 parts", app("Sum", `  count: Int = 0`, `  text shown = @count\n  button go "Go"`, `  - set @count to ${Array(N).fill("1").join(" plus ")}`, `  click go\n  see shown = "${N}"`)],
  ["2,000 alternatives", app("Alts", `  count: Int = 0\n  label: Text = ""`, `  text shown = @label\n  button go "Go"`, `  - set @label to ${Array.from({ length: N }, (_, i) => `"${i}" when @count is ${i}`).join("; ")}; otherwise "many"`, `  click go\n  see shown = "0"`)],
  ["an example of 4,000 clicks", app("Clicks", `  count: Int = 0`, `  text shown = @count\n  button go "Go"`, `  - increase @count by 1`, `${Array(2 * N).fill("  click go").join("\n")}\n  see shown = "${2 * N}"`)],
];
const dir = mkdtempSync(join(tmpdir(), "perf-"));
const times: string[] = [];
for (const [what, src] of shapes) {
  const file = join(dir, `${what.replace(/\W+/g, "-")}.intent`);
  writeFileSync(file, src);
  const t = performance.now();
  const r = load(file, { ignoreLock: true }); // a stack overflow throws here
  const ms = performance.now() - t;
  assert.ok(r.diagnostics.every((d) => d.code !== "SYNTAX") || /SYNTAX/.test(what), `${what}: an unexpected SYNTAX error: ${r.diagnostics.find((d) => d.code === "SYNTAX")?.message}`);
  assert.ok(ms < 2000, `${what}: checked in ${Math.round(ms)} ms (at most 2,000)`);
  times.push(`${what} ${Math.round(ms)} ms`);
}
console.log(`ok perf: ${times.join(", ")}`);
