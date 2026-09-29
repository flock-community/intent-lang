// `intent fix` (compiler/fix.ts): the mechanical fixes — an old `Maybe T`, an unmarked declared
// name, and the `language 1` line. The source is only rewritten when it does not add errors.
import assert from "node:assert/strict";
import { mkdtempSync, readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { markWord, fixSource, fixFile, fixText, newErrors } from "../compiler/fix.ts";
import { load } from "../compiler/load.ts";

assert.equal(markWord("- set count to 1", "count"), "- set @count to 1", "a bare name is marked");
assert.equal(markWord("- set @count to 1", "count"), undefined, "an already marked name is left");
assert.equal(markWord('text x = "count"', "count"), undefined, "a word inside a string is not a name");
assert.equal(markWord('text x = "{count}"', "count"), 'text x = "{@count}"', "a template hole is a sentence");

const src = 'app A {\n  "keep Maybe here"\n}\n\nstate {\n  x: Maybe Item = nothing\n}\n';
const fixed = fixSource(src, "1");
assert.match(fixed.out, /"keep Maybe here"/, "a Maybe in prose is left alone");
assert.match(fixed.out, /x: Item or nothing = nothing/, "an old Maybe type is rewritten");
assert.match(fixed.out, /^language 1$/m, "the language line is added");
assert.equal(fixed.fixes.length, 2, "both fixes are reported");

const dir = mkdtempSync(join(tmpdir(), "fix-test-"));
const file = join(dir, "fixme.intent");
writeFileSync(file, readFileSync(new URL("./fix/fixme.intent", import.meta.url), "utf8"));
const r = fixFile(file);
assert.ok(r.fixes.some((f) => f.code === "UNMARKED" && f.what === "marked @count"), "the unmarked name is fixed");
assert.match(r.out, /increase @count by 1/);
assert.match(r.out, /maybe: Item or nothing = nothing/);
assert.match(r.out, /first = the item whose @id is 1/, "a lookup's `where` becomes `whose`");
const out = join(dir, "fixed.intent");
writeFileSync(out, r.out);
assert.equal(load(out, { ignoreLock: true }).diagnostics.filter((d) => d.level === "error").length, 0, "the fixed spec has no errors");
assert.equal(r.left.filter((d) => d.level === "error").length, 0);

// A lookup of a reference's own row becomes following the reference (SPELLING); nothing is invented.
const nav = join(dir, "navfix.intent");
writeFileSync(nav, readFileSync(new URL("./fix/navfix.intent", import.meta.url), "utf8"));
const n = fixFile(nav);
assert.match(n.out, /title = @chosen's @subject, or "" when there is none/, "a derived lookup by a reference becomes navigation");
assert.match(n.out, /text about = its @ticket's @subject, or "\(removed\)" when there is none/, "a row's lookup becomes navigation");
assert.match(n.out, /if that comment's @ticket does not exist \{/, "asking for the lookup's row becomes `does not exist`");
assert.equal(n.fixes.filter((f) => f.code === "SPELLING").length, 3);
assert.equal(n.left.filter((d) => d.level === "error").length, 0, "the navigation checks clean");
assert.ok(!n.left.some((d) => d.code === "SPELLING"), "no lookup of a reference's own row is left");

// A change rule in other words becomes the language's (SPELLING); the result checks clean.
const ch = join(dir, "changefix.intent");
writeFileSync(ch, readFileSync(new URL("./fix/changefix.intent", import.meta.url), "utf8"));
const c = fixFile(ch);
assert.match(c.out, /- @count never goes down\n/, "`only goes up` → `never goes down`");
assert.match(c.out, /- @low never goes up\n/, "`can only decrease` → `never goes up`");
assert.match(c.out, /- a @Ticket's @subject never changes\n/, "`stays the same` → `never changes`");
assert.match(c.out, /- a @Ticket is never removed\n/, "`is never deleted` → `is never removed`");
assert.match(c.out, /- @count is at least @count before\n/, "`the previous @count` → `@count before`");
assert.equal(c.fixes.filter((f) => f.code === "SPELLING").length, 5);
assert.equal(c.left.filter((d) => d.level === "error").length, 0, "the change rules check clean");
assert.ok(!c.left.some((d) => d.code === "SPELLING"), "no other spelling is left");

// `@newToken` is a draw (SPELLING): used once in its endpoint it becomes `a random @Token` (and std.text
// is imported for the type); used twice it is one value in two places, which needs the author.
const tk = join(dir, "tokenfix.intent");
writeFileSync(tk, readFileSync(new URL("./fix/tokenfix.intent", import.meta.url), "utf8"));
const t = fixFile(tk);
assert.match(t.out, /with @secret = a random @Token and @owner = @owner\n  answer 201 with @owner/, "the endpoint that uses it once draws a Token");
assert.equal((t.out.match(/@newToken/g) ?? []).length, 2, "the endpoint that uses it twice is left alone");
assert.match(t.out, /^import std\.text$/m, "std.text gives the Token type");
assert.equal(t.left.filter((d) => d.level === "error").length, 0, "the fixed spec checks clean");
assert.equal(t.left.filter((d) => d.code === "SPELLING").length, 2, "the two uses left say what to do");
assert.match(t.left.find((d) => d.code === "SPELLING")!.message, /draw it once where it is stored/);

// v72: `intent fix` is trustworthy. Only references get their `@`: never the name a line declares.
const decl = join(dir, "marks-declaration.intent");
writeFileSync(decl, readFileSync(new URL("./fix/marks-declaration.intent", import.meta.url), "utf8"));
const d1 = fixFile(decl);
assert.match(d1.out, /^  text total = @total as money$/m, "the element's name stays a name; its value's `total` is marked");
assert.ok(!/text @total/.test(d1.out), "a declaration is never marked");
assert.equal(d1.left.filter((d) => d.level === "error").length, 0);

// A judgement is reported, not guessed: `whose id is id` in an endpoint with a path param `id`.
const pv = join(dir, "param-vs-field.intent");
writeFileSync(pv, readFileSync(new URL("./fix/param-vs-field.intent", import.meta.url), "utf8"));
const p1 = fixFile(pv);
assert.match(p1.out, /remove every note in @notes whose id is id$/m, "`notes` is marked; neither `id` is guessed");
assert.equal(p1.judgements.filter((j) => /ambiguous: `id` — the request's `@path\.id`, or the declared `@id`\?/.test(j.what)).length, 2, "both lines are reported as ambiguous");

// Never a silent refusal: a fix that would add an error is left out and said, with the error it would
// add; the safe ones are kept (here the language line, a `Maybe`, and marks that need another first).
const rf = join(dir, "refuse.intent");
writeFileSync(rf, readFileSync(new URL("./fix/refuse.intent", import.meta.url), "utf8"));
const r1 = fixFile(rf);
assert.match(r1.out, /^language 1$/m, "the language line is written");
assert.match(r1.out, /note: Text or nothing = nothing/);
assert.match(r1.out, /enabled when @current is not @Solved/, "`@current` is kept once `@Solved` is marked (the order does not matter)");
assert.match(r1.out, /- increase @count by 1/);
assert.match(r1.out, /text next = chosen plus 1/, "the mark that adds an error is not applied");
assert.equal(r1.refused.length, 1);
assert.equal(r1.refused[0].what, "marked @chosen");
assert.match(r1.refused[0].why[0], /NOTHING: `@chosen plus 1`/, "the refusal says which error it would add");
assert.equal(r1.left.filter((d) => d.level === "error").length, 0);

// A pre-1 line (`language v69`) reads as `language 1`, and fix rewrites it. An api behind keys with
// no \`access\` block is an error in language 1 whatever the line says: fix leaves it to the author.
const na = join(dir, "noaccess.intent");
writeFileSync(na, readFileSync(new URL("./fix/noaccess.intent", import.meta.url), "utf8"));
const n1 = fixFile(na);
assert.ok(n1.fixes.some((f) => f.what === "language v69 → 1"), "the pre-1 language line is rewritten");
assert.deepEqual(n1.left.filter((d) => d.level === "error").map((d) => d.code), ["NO_ACCESS"]);
// A `language 1.x` line stays (it is the lowest version the spec needs); a second run changes nothing.
assert.equal(fixSource('app H {\n  "p"\n}\nlanguage 1.2\n', "1").out, 'app H {\n  "p"\n}\nlanguage 1.2\n');
assert.equal(fixText(n1.out).fixes.length, 0, "fix is idempotent on the rewritten line");

// A fix may not trade one error for another: errors are compared as (file, line, code), not counted.
assert.deepEqual(newErrors([{ level: "error", code: "TYPE", line: 3, col: 1, message: "x" }], [{ level: "error", code: "NOTHING", line: 5, col: 1, message: "y" }]).map((d) => d.code), ["NOTHING"], "one error removed and another added is a new error");
assert.deepEqual(newErrors([{ level: "error", code: "TYPE", line: 3, col: 1, message: "x" }], [{ level: "error", code: "TYPE", line: 3, col: 1, message: "x" }]), []);

// The language line goes after the header, also in the older indentation syntax (never inside it).
assert.equal(fixSource('app H\n  "purpose"\n\nstate\n  x: Int = 0\n', "1").out, 'app H\n  "purpose"\nlanguage 1\n\nstate\n  x: Int = 0\n');
assert.equal(fixSource('# a note\napp H {\n  "p"\n}', "1").out, '# a note\napp H {\n  "p"\n}\nlanguage 1\n');

// Nothing on the wire is null: `is absent` on a declared `T or nothing` (an answer's, an event's) is a
// STEP error that names its rewrite, `= nothing`; `is absent` on an event stays.
const ab = join(dir, "absent.intent");
writeFileSync(ab, readFileSync(new URL("./fix/absent.intent", import.meta.url), "utf8"));
const a1 = fixFile(ab);
assert.match(a1.out, /see note\.body\.due = nothing\n/, "an answer's nothing is `= nothing`");
assert.match(a1.out, /see noteMade\.body\.due = nothing\n/, "an event's nothing is `= nothing`");
assert.match(a1.out, /see noteMade is absent\n/, "`is absent` on an event stays");
assert.equal(a1.fixes.filter((f) => f.what === "`is absent` → `= nothing`").length, 2);
assert.equal(a1.left.filter((d) => d.level === "error").length, 0, "the rewritten examples check clean");

// v73: one spelling per form. Each old form is a SPELLING warning that names its rewrite; the result
// checks clean, with no SPELLING left, on a screen (nothing, fallbacks, sizes, dates, a select's
// none) and on an api (layers, access, answers, the endpoint's row, loops).
for (const [name, expect] of [
  ["v73.intent", [/^sizes Compact \| Standard$/m, /payer: Text or nothing = nothing/, /nextId = the highest @id in @people \+ 1, or 1 when there is none$/m, /shown = @picked plus 1, or 0 when there is none$/m, /- set @payer to nothing/, /if there is a @picked \{/, /14 days after @today/, /^  size Standard$/m]],
  ["v73-api.intent", [/^layer auth = std\.http\.apiKey \{/m, /- anyone, without a key, may call @health/, /when that notice's @status is not @Archived/, /^  answers 200 Text$/m, /^  answers 201 Notice\n  answers 400 Problem\n  answers 401 Problem$/m, /if that notice does not exist \{/, /for each @notice in @notices whose @expiresAt is at or before @now \{/, /- set @notice's @status to @Archived/]],
] as const) {
  const f = join(dir, name);
  writeFileSync(f, readFileSync(new URL(`./fix/${name}`, import.meta.url), "utf8"));
  const r = fixFile(f);
  for (const re of expect) assert.match(r.out, re, `${name}: ${re}`);
  assert.equal(r.left.filter((d) => d.level === "error").length, 0, `${name}: the rewritten spec checks clean (${r.left.filter((d) => d.level === "error").map((d) => `${d.line} ${d.code} ${d.message}`).join("; ")})`);
  assert.ok(!r.left.some((d) => d.code === "SPELLING"), `${name}: no old spelling is left (${r.left.filter((d) => d.code === "SPELLING").map((d) => d.message).join("; ")})`);
  assert.deepEqual(r.refused, [], `${name}: nothing refused`);
}

// Idempotent: a second run changes nothing, on every spec here, on the fixtures above, and on old specs
// (tests/fix/old: this repository's apps as they were at v20 and v29, in the indentation syntax).
const all: string[] = [];
const walk = (d: string) => { for (const f of readdirSync(d).sort()) { const x = join(d, f); if (statSync(x).isDirectory()) walk(x); else if (x.endsWith(".intent") && !x.includes("/profile/")) all.push(x); } };
walk(new URL("../apps", import.meta.url).pathname);
walk(new URL("../lib", import.meta.url).pathname);
walk(new URL("./fix", import.meta.url).pathname);
for (const f of all) {
  const once = fixText(readFileSync(f, "utf8"));
  const twice = fixText(once.out);
  assert.equal(twice.out, once.out, `${f}: a second \`intent fix\` changes it again`);
  assert.deepEqual(twice.fixes, [], `${f}: a second \`intent fix\` still fixes something`);
}

console.log(`ok fix: the v73 spellings (nothing, fallbacks, loops, answers, layers, access, the endpoint's row, sizes, dates, a select's none), @newToken as a draw, change rules in other words, Maybe T, @unmarked names, a lookup's where, a lookup of a reference's row as navigation, and the language line, only when no error is added; never a declaration, judgements reported, refusals said with their error, errors compared by line and code, idempotent on ${all.length} specs`);
