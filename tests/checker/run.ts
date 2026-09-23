// Regression test for the checker: every `# expect: CODE` comment must produce that diagnostic
// on that line, and no other errors may appear. Valid apps in apps/ must have no errors.
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { parse } from "../../compiler/parse.ts";

let failures = 0;
const dir = new URL(".", import.meta.url).pathname;
for (const f of readdirSync(dir).filter((f) => f.endsWith(".intent") && f !== "broken.intent")) {
  const src = readFileSync(join(dir, f), "utf8");
  const expected = src.split("\n").flatMap((l, i) => [...l.matchAll(/# expect: ([A-Z_]+)/g)].map((m) => `${i + 1}:${m[1]}`));
  const got = parse(src).diagnostics.map((d) => `${d.line}:${d.code}`);
  for (const e of expected) if (!got.includes(e)) (failures++, console.log(`${f}: missing ${e}`));
  for (const d of parse(src).diagnostics) if (d.level === "error" && !expected.includes(`${d.line}:${d.code}`)) (failures++, console.log(`${f}: unexpected ${d.line}:${d.code} ${d.message}`));
}
const apps = join(dir, "../../apps");
for (const f of readdirSync(apps).filter((f) => f.endsWith(".intent"))) {
  const errs = parse(readFileSync(join(apps, f), "utf8")).diagnostics.filter((d) => d.level === "error");
  if (errs.length) (failures++, console.log(`apps/${f}: ${errs.length} error(s)`));
}
console.log(failures ? `${failures} failure(s)` : "checker tests pass");
process.exit(failures ? 1 : 0);
