// Diagnostics a `# expect:` spec cannot show (tests/checker/run.ts loads with `ignoreLock` in this
// repository): the lock (LOCK, LANGUAGE, BASE_CHANGED), refinement one level deep (NOT_YET), a
// contract endpoint left out (CONTRACT), a base's proof about an override (OVERRIDES_PROOF), and
// JUDGEMENT (off by default). Projects with their own intent.lock and lib/ are temporary folders;
// the project is the folder a command runs in, so those checks run in a child process there.
// Last: every code the compiler emits is expected by some test and listed in docs/TOOLS.md (§6).
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readdirSync, readFileSync, realpathSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { load } from "../compiler/load.ts";
import { applyQuality } from "../compiler/quality.ts";
import stdQuality from "../compiler/quality/std.ts";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
type D = { level: string; code: string; line: number; file: string; message: string };

/** Run `fn` (the body of a module, with `load` and `writeLock` in scope) in a project folder; it prints JSON. */
const inProject = (dir: string, body: string): any => {
  const script = `import { load, writeLock } from ${JSON.stringify(join(ROOT, "compiler/load.ts"))};\n${body}`;
  const r = spawnSync(process.execPath, ["--input-type=module", "-e", script], { cwd: dir, encoding: "utf8" });
  if (r.status !== 0) throw new Error(`the child failed: ${r.stderr}`);
  return JSON.parse(r.stdout.trim().split("\n").pop()!);
};
const check = (dir: string, file: string): D[] => inProject(dir, `console.log(JSON.stringify(load(${JSON.stringify(join(dir, file))}).diagnostics));`);
const lock = (dir: string, file: string) => inProject(dir, `writeLock([${JSON.stringify(join(dir, file))}]); console.log("[]");`);
const has = (ds: D[], code: string, line?: number, file?: string) => ds.some((d) => d.code === code && (line === undefined || d.line === line) && (file === undefined || d.file === file));
const codes = (ds: D[]) => ds.map((d) => `${d.file}:${d.line} ${d.code}`).join(", ");

// A project: a bundle, a published app, an app that refines it, and one that refines the refinement.
const dir = realpathSync(mkdtempSync(join(tmpdir(), "diagnostics-"))); // the real path: the project is where the child runs
mkdirSync(join(dir, "lib/shop"), { recursive: true });
writeFileSync(join(dir, "intent.project"), "project shop\n");
writeFileSync(join(dir, "lib/shop/items.intent"), `bundle shop.items {\n  "Items for sale."\n}\n\nrecord Item {\n  name: Text\n  price: Int\n}\n`);
const base = (title: string, footer: string) => `app Base {
  "A shop page."
}

state {
  count: Int = 0
}

screen {
  text title = "${title}"
  text footer = "${footer}"
  text count
  button up "Up"
}

on click up {
  - increase @count by 1
}

example "counting" {
  click up
  see count = 1
  see title = "${title}"
}
`;
writeFileSync(join(dir, "lib/shop/base.intent"), base("Shop", "Open daily"));
writeFileSync(join(dir, "lib/shop/mid.intent"), `app Mid {\n  "A refinement that is published itself."\n}\nextends shop.base\n\noverride text title = "Mid"\n`);
writeFileSync(join(dir, "child.intent"), `app Child {
  "Our shop."
}
extends shop.base

override text title = "Our shop"

drop example "counting"

example "our title" {
  see title = "Our shop"
}
`);
writeFileSync(join(dir, "grandchild.intent"), `app Grandchild {\n  "Two levels deep."\n}\nextends shop.mid\n\noverride text footer = "Closed"\n`);
writeFileSync(join(dir, "uses.intent"), `app UsesItems {
  "An app that imports a bundle."
}
language v1
import shop.items

state {
  items: List Item = []
}

screen {
  list items of Item {
    text name
  }
}

example "empty" {
  see items has 0 rows
}
`);

try {
  // LOCK: nothing locked yet.
  let ds = check(dir, "uses.intent");
  assert.ok(has(ds, "LOCK", 5), `an unlocked bundle is a LOCK error at its import (got ${codes(ds)})`);
  assert.ok(ds.some((d) => d.code === "LOCK" && d.level === "error"), "LOCK on a bundle is an error");
  // LANGUAGE: `language v1` is from before language 1 (it reads as `language 1`).
  assert.ok(has(ds, "LANGUAGE", 4), `a pre-1 \`language\` line is a LANGUAGE warning on that line (got ${codes(ds)})`);
  assert.equal(ds.find((d) => d.code === "LANGUAGE")?.level, "warning");

  // Locked: no LOCK. Then the bundle changes: LOCK again, with both digests.
  lock(dir, "uses.intent");
  ds = check(dir, "uses.intent");
  assert.ok(!has(ds, "LOCK"), `a locked, unchanged bundle is no LOCK (got ${codes(ds)})`);
  writeFileSync(join(dir, "lib/shop/items.intent"), readFileSync(join(dir, "lib/shop/items.intent"), "utf8").replace("price: Int", "price: Int\n  stock: Int = 0"));
  ds = check(dir, "uses.intent");
  assert.ok(has(ds, "LOCK", 5) && /changed since it was locked/.test(ds.find((d) => d.code === "LOCK")!.message), `a changed bundle is a LOCK error (got ${codes(ds)})`);
  lock(dir, "uses.intent");

  // The language reference changed since the lock: a LOCK warning on line 1 (the build reads the new one).
  writeFileSync(join(dir, "intent.lock"), readFileSync(join(dir, "intent.lock"), "utf8").replace(/^@language (\S+) sha256:[0-9a-f]+/m, "@language $1 sha256:0000000000000000"));
  ds = check(dir, "uses.intent");
  assert.ok(ds.some((d) => d.code === "LOCK" && d.level === "warning" && d.line === 1 && /language reference changed/.test(d.message)), `a changed language reference is a LOCK warning (got ${codes(ds)})`);
  lock(dir, "uses.intent");
  // LANGUAGE is silent for the current version.
  const current = readFileSync(join(ROOT, "docs/LANGUAGE.md"), "utf8").match(/language reference \((\d+(?:\.\d+)?)\)/)![1];
  assert.equal(current, "1", "the reference is language 1");
  writeFileSync(join(dir, "uses.intent"), readFileSync(join(dir, "uses.intent"), "utf8").replace("language v1", `language ${current}`));
  ds = check(dir, "uses.intent");
  assert.ok(!has(ds, "LANGUAGE") && !has(ds, "LOCK"), `the current language and a fresh lock: neither LANGUAGE nor LOCK (got ${codes(ds)})`);
  // NEWER_LANGUAGE: the line is the lowest version the spec needs; a newer one needs a newer compiler.
  writeFileSync(join(dir, "uses.intent"), readFileSync(join(dir, "uses.intent"), "utf8").replace(`language ${current}`, "language 1.1"));
  ds = check(dir, "uses.intent");
  assert.ok(ds.some((d) => d.code === "NEWER_LANGUAGE" && d.level === "error" && d.line === 4 && /needs language 1\.1; this compiler reads language 1/.test(d.message)), `a spec that needs 1.1 is an error for a 1 compiler (got ${codes(ds)})`);
  writeFileSync(join(dir, "uses.intent"), readFileSync(join(dir, "uses.intent"), "utf8").replace("language 1.1", `language ${current}`));

  // BASE_CHANGED: the refinement is locked with a fingerprint of each part it overrides.
  ds = check(dir, "child.intent");
  assert.ok(has(ds, "LOCK", 4), `an unlocked base is a LOCK error at \`extends\` (got ${codes(ds)})`);
  lock(dir, "child.intent");
  ds = check(dir, "child.intent");
  assert.ok(!has(ds, "LOCK") && !has(ds, "BASE_CHANGED"), `a locked base: no LOCK, no BASE_CHANGED (got ${codes(ds)})`);
  // The base changes a part the child does not override: LOCK, but no BASE_CHANGED.
  writeFileSync(join(dir, "lib/shop/base.intent"), base("Shop", "Open on weekdays"));
  ds = check(dir, "child.intent");
  assert.ok(has(ds, "LOCK", 4) && !has(ds, "BASE_CHANGED"), `a base change elsewhere: LOCK only (got ${codes(ds)})`);
  // The base changes the overridden parts (the title, and the example that sees it): BASE_CHANGED
  // on the override's line and on the `drop`'s.
  writeFileSync(join(dir, "lib/shop/base.intent"), base("The shop", "Open on weekdays"));
  ds = check(dir, "child.intent");
  assert.ok(has(ds, "BASE_CHANGED", 6, "child.intent") && has(ds, "BASE_CHANGED", 8, "child.intent"), `the base changed overridden parts: BASE_CHANGED at each (got ${codes(ds)})`);
  assert.ok(has(ds, "LOCK", 4) && /2 part\(s\) you override/.test(ds.find((d) => d.code === "LOCK")!.message), "and LOCK says how many overridden parts changed");

  // NOT_YET: refinement is one level deep.
  ds = check(dir, "grandchild.intent");
  assert.ok(has(ds, "NOT_YET", 4, "grandchild.intent"), `a base that extends another spec is NOT_YET (got ${codes(ds)})`);
  assert.ok(!has(check(dir, "child.intent"), "NOT_YET"), "one level deep is fine");
} finally {
  rmSync(dir, { recursive: true, force: true });
}

// CONTRACT: an endpoint of the contract left out is reported at `implements`.
const tmp = mkdtempSync(join(tmpdir(), "contract-"));
try {
  const file = join(tmp, "partial.intent");
  writeFileSync(file, `app Partial {\n  "Only half of the alerts api."\n}\n\nimport notify.alerts\n\nimplements notify.alertsApi\n\nstate {\n  alerts: List Alert = []\n}\n\nendpoint raise {\n  answer 201 with an @Alert with @id = 1, the given @text and the given @level\n}\n`);
  const ds = load(file, { ignoreLock: true }).diagnostics as D[];
  assert.ok(ds.some((d) => d.code === "CONTRACT" && d.line === 7 && /`listAlerts` of the contract is not implemented/.test(d.message)), `a missing endpoint is CONTRACT at \`implements\` (got ${codes(ds)})`);
} finally {
  rmSync(tmp, { recursive: true, force: true });
}

// OVERRIDES_PROOF: a base example about a part the refinement overrides, reported in the base's file.
{
  const ds = load(join(ROOT, "apps/14-supportdesk.intent"), { ignoreLock: true }).diagnostics as D[];
  const proof = ds.filter((d) => d.code === "OVERRIDES_PROOF");
  assert.ok(proof.length >= 2 && proof.every((d) => d.file === "lib/support/helpdesk.intent" && d.level === "warning"), `OVERRIDES_PROOF on the base's examples (got ${codes(ds)})`);
  assert.ok(proof.some((d) => /checks `sort`/.test(d.message)) && proof.some((d) => /checks `pageTitle`/.test(d.message)), "for both overridden parts");
  // Near miss: dropped examples are not reported.
  assert.ok(!proof.some((d) => /"paging"|"the inbox at a glance"/.test(d.message)), "a dropped base example is not reported");
}

// JUDGEMENT: off by default; at `warning`, each sentence left untyped is listed.
{
  const loaded = load(join(ROOT, "apps/06-expenses.intent"), { quality: false });
  const judged = (level?: "warning") => applyQuality("x", loaded.app, [], [stdQuality], { use: ["std.quality"], levels: level ? { JUDGEMENT: level } : {} }).filter((d) => d.code === "JUDGEMENT");
  assert.equal(judged().length, 0, "JUDGEMENT is off by default");
  const on = judged("warning");
  assert.ok(on.length > 0 && on.every((d) => d.level === "warning" && /left to judgement/.test(d.message)), "at `warning`, each untyped sentence is listed");
}

// Every code the compiler emits is expected by a test and listed in docs/TOOLS.md's §6.
{
  const files: string[] = [];
  const walk = (d: string, keep: (f: string) => boolean) => readdirSync(d).forEach((f) => (statSync(join(d, f)).isDirectory() ? walk(join(d, f), keep) : keep(f) && files.push(join(d, f))));
  walk(join(ROOT, "compiler"), (f) => f.endsWith(".ts"));
  const emitted = new Set<string>();
  const HTTP = new Set(["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS", "HEAD"]);
  for (const f of files.filter((f) => !/\/(targets|providers)\/|\/(cli|exec)\.ts$/.test(f))) {
    const s = readFileSync(f, "utf8");
    // `err(line, "CODE", "message")`, `{ code: "CODE" }`, a rule's `id: "CODE"` and std.quality's `hint("CODE", …)`.
    for (const re of [/"([A-Z][A-Z_]{2,})"\s*,\s*(?:[`"'(]|[a-z])/g, /\bcode:\s*"([A-Z][A-Z_]{2,})"/g, /\bid:\s*"([A-Z][A-Z_]{2,})"/g, /\bhint\("([A-Z][A-Z_]{2,})"/g])
      for (const m of s.matchAll(re)) if (!HTTP.has(m[1])) emitted.add(m[1]);
  }
  const specs: string[] = [];
  const walkSpecs = (d: string) => readdirSync(d).forEach((f) => (statSync(join(d, f)).isDirectory() ? walkSpecs(join(d, f)) : specs.push(join(d, f))));
  walkSpecs(join(ROOT, "tests"));
  const expectedBySpec = new Set(specs.filter((f) => f.endsWith(".intent")).flatMap((f) => [...readFileSync(f, "utf8").matchAll(/# expect: ([A-Z_]+)/g)].map((m) => m[1])));
  const tsTests = specs.filter((f) => f.endsWith(".ts") && !f.endsWith("diagnostics.test.ts") && !f.includes("/harness/")).map((f) => readFileSync(f, "utf8")).join("\n");
  const here = readFileSync(fileURLToPath(import.meta.url), "utf8").split("// Every code the compiler emits")[0];
  // The codes are tooling: docs/TOOLS.md lists them (§6), out of the compiler's prompt.
  const doc = readFileSync(join(ROOT, "docs/TOOLS.md"), "utf8");
  const section7 = doc.slice(doc.indexOf("## 6. The checker and its codes"));
  const untested = [...emitted].filter((c) => !expectedBySpec.has(c) && !new RegExp(`["'\`]${c}["'\`:]`).test(tsTests + here));
  const undocumented = [...emitted].filter((c) => !section7.includes(`| \`${c}\` |`));
  assert.deepEqual(untested, [], `codes no test expects: ${untested.join(", ")}`);
  assert.deepEqual(undocumented, [], `codes missing from docs/TOOLS.md's code tables (§6): ${undocumented.join(", ")}`);
  assert.ok(emitted.size > 40, `the scan finds the codes (${emitted.size})`);
}

console.log("ok diagnostics: LOCK, LANGUAGE, BASE_CHANGED, NOT_YET (two levels), CONTRACT, OVERRIDES_PROOF, JUDGEMENT; every code tested and documented");
