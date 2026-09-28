// Regression test for the checker: every `# expect: CODE` comment must produce that diagnostic
// on that line, and no other errors may appear; a `# expect-not: CODE` comment (a near miss) must
// not produce it on that line. Valid apps in apps/ must have no errors.
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { parse } from "../../compiler/parse.ts";
import { load } from "../../compiler/load.ts";

let failures = 0;
const dir = new URL(".", import.meta.url).pathname;
// A diagnostic is reported once: the same code and message twice on one line is a checker bug.
const twice = (ds: { line: number; code: string; message: string; file?: string }[]) => ds.map((d) => `${d.file ?? ""}:${d.line}:${d.code} ${d.message}`).filter((k, i, all) => all.indexOf(k) !== i);
// A message names what it is about: never `undefined` or `[object Object]` (unless the spec itself says it).
const unset = (ds: { line: number; code: string; message: string }[], src: string) => ds.filter((d) => (d.message.match(/\bundefined\b|\[object Object\]|\bNaN\b/g) ?? []).some((w) => !src.includes(w))).map((d) => `${d.line}:${d.code} ${d.message}`);
const marks = (src: string, word: string) => src.split("\n").flatMap((l, i) => [...l.matchAll(new RegExp(`# ${word}: ([A-Z_]+)`, "g"))].map((m) => `${i + 1}:${m[1]}`));
for (const f of readdirSync(dir).filter((f) => f.endsWith(".intent"))) {
  const src = readFileSync(join(dir, f), "utf8");
  const expected = marks(src, "expect");
  const got = parse(src).diagnostics.map((d) => `${d.line}:${d.code}`);
  for (const k of twice(parse(src).diagnostics)) (failures++, console.log(`${f}: reported twice: ${k}`));
  for (const k of unset(parse(src).diagnostics, src)) (failures++, console.log(`${f}: a message shows a missing value: ${k}`));
  for (const e of expected) if (!got.includes(e)) (failures++, console.log(`${f}: missing ${e}`));
  for (const e of marks(src, "expect-not")) if (got.includes(e)) (failures++, console.log(`${f}: ${e} is reported, but this line is a near miss that must not raise it`));
  for (const d of parse(src).diagnostics) if (d.level === "error" && !expected.includes(`${d.line}:${d.code}`)) (failures++, console.log(`${f}: unexpected ${d.line}:${d.code} ${d.message}`));
}
// Specs that need the loader (imports, contracts, clients): the same \`# expect:\` comments, checked through load().
for (const f of readdirSync(join(dir, "load")).filter((f) => f.endsWith(".intent"))) {
  const src = readFileSync(join(dir, "load", f), "utf8");
  const expected = marks(src, "expect");
  // Only this file's own lines: a diagnostic in an imported spec has that spec's file and line numbers.
  const loaded = load(join(dir, "load", f), { ignoreLock: true });
  const diags = loaded.diagnostics.filter((d) => d.file === loaded.sources[0].file);
  for (const k of twice(loaded.diagnostics)) (failures++, console.log(`load/${f}: reported twice: ${k}`));
  for (const k of unset(loaded.diagnostics, src)) (failures++, console.log(`load/${f}: a message shows a missing value: ${k}`));
  const got = diags.map((d) => `${d.line}:${d.code}`);
  for (const e of expected) if (!got.includes(e)) (failures++, console.log(`load/${f}: missing ${e}`));
  for (const e of marks(src, "expect-not")) if (got.includes(e)) (failures++, console.log(`load/${f}: ${e} is reported, but this line is a near miss that must not raise it`));
  for (const d of diags) if (d.level === "error" && !expected.includes(`${d.line}:${d.code}`)) (failures++, console.log(`load/${f}: unexpected ${d.line}:${d.code} ${d.message}`));
  for (const d of loaded.diagnostics) if (d.level === "error" && d.file !== loaded.sources[0].file) (failures++, console.log(`load/${f}: unexpected error in ${d.file}:${d.line}: ${d.code} ${d.message}`));
}
// Every spec in apps/ (services and held-out specs too) and every bundle in lib/ checks without errors.
const specs = (d: string): string[] => readdirSync(d, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? specs(join(d, e.name)) : e.name.endsWith(".intent") ? [join(d, e.name)] : []));
for (const root of ["apps", "lib"])
  for (const f of specs(join(dir, "../..", root)).filter((f) => !f.includes("/lib/profile/"))) { // profiles: tests/profile.test.ts
    const errs = load(f).diagnostics.filter((d) => d.level === "error");
    if (errs.length) (failures++, console.log(`${f.slice(f.indexOf(root))}: ${errs.length} error(s): ${errs.map((e) => `${e.line}:${e.code}`).join(", ")}`));
  }
// The profile is the source of truth; the language reference (the compiler's prompt) must agree.
const { uiProfile } = await import("../../compiler/profile.ts");
const doc = readFileSync(join(dir, "../../docs/LANGUAGE.md"), "utf8");
const table = doc.slice(doc.indexOf("Built-in presentations"), doc.indexOf("## 4b."));
for (const e of uiProfile().elements)
  for (const pr of e.presentations)
    if (!table.includes(`\`${pr.name}\``)) (failures++, console.log(`profile presentation ${e.kind} as ${pr.name} is missing from the reference's presentation table`));
console.log(failures ? `${failures} failure(s)` : "checker tests pass");
process.exit(failures ? 1 : 0);
