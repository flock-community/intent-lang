// `intent fix` (compiler/fix.ts): the mechanical fixes — an old `Maybe T`, an unmarked declared
// name, and the `language vN` line. The source is only rewritten when it does not add errors.
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { markWord, fixSource, fixFile } from "../compiler/fix.ts";
import { load } from "../compiler/load.ts";

assert.equal(markWord("- set count to 1", "count"), "- set @count to 1", "a bare name is marked");
assert.equal(markWord("- set @count to 1", "count"), undefined, "an already marked name is left");
assert.equal(markWord('text x = "count"', "count"), undefined, "a word inside a string is not a name");
assert.equal(markWord('text x = "{count}"', "count"), 'text x = "{@count}"', "a template hole is a sentence");

const src = 'app A {\n  "keep Maybe here"\n}\n\nstate {\n  x: Maybe Item = nothing\n}\n';
const fixed = fixSource(src, "v39");
assert.match(fixed.out, /"keep Maybe here"/, "a Maybe in prose is left alone");
assert.match(fixed.out, /x: Item or nothing = nothing/, "an old Maybe type is rewritten");
assert.match(fixed.out, /^language v39$/m, "the language line is added");
assert.equal(fixed.fixes.length, 2, "both fixes are reported");

const dir = mkdtempSync(join(tmpdir(), "fix-test-"));
const file = join(dir, "fixme.intent");
writeFileSync(file, readFileSync(new URL("./fix/fixme.intent", import.meta.url), "utf8"));
const r = fixFile(file);
assert.ok(r.fixes.some((f) => f.code === "UNMARKED" && f.what === "marked @count"), "the unmarked name is fixed");
assert.match(r.out, /increase @count by 1/);
assert.match(r.out, /maybe: Item or nothing = nothing/);
const out = join(dir, "fixed.intent");
writeFileSync(out, r.out);
assert.equal(load(out, { ignoreLock: true }).diagnostics.filter((d) => d.level === "error").length, 0, "the fixed spec has no errors");
assert.equal(r.left.filter((d) => d.level === "error").length, 0);

console.log("ok fix: Maybe T, @unmarked names and the language line, only when no error is added");
