// The `@spec` regions in a generated module (compiler/regions.ts, docs/design/incremental.md): the
// marks are checked like examples, and an incremental build keeps clean regions byte-identical.
import assert from "node:assert/strict";
import { extractRegions, checkRegions, outsideRegions, checkIncremental } from "../compiler/regions.ts";

const ts = `import type { Msg } from "./spec.ts";
export type Model = { n: number };
export function update(msg: Msg, model: Model): Model {
  switch (msg.tag) {
// @spec on click add
    case "AddClicked": return { ...model, n: model.n + 1 };
// @end
  }
  return model;
}
export function view(model: Model) {
// @spec derive total
  const total = model.n * 2;
// @end
  return total;
}
`;

const r = extractRegions(ts, "ts");
assert.equal(r.problem, undefined, "the marks are well formed");
assert.deepEqual(r.regions.map((x) => x.key), ["on click add", "derive total"], "both regions are found");
assert.match(r.regions[0].body, /AddClicked/, "the body is between the markers");
assert.ok(!r.regions[0].body.includes("@spec"), "the marker is not in the body");

assert.deepEqual(checkRegions(ts, "ts", ["on click add", "derive total"]), [], "every unit is marked once");
assert.deepEqual(checkRegions(ts, "ts", ["on click add", "derive total", "on click remove"]), ["no region marked `on click remove`"], "a missing mark is a problem");
assert.deepEqual(checkRegions(ts, "ts", ["on click add"]), ["a region marked `derive total`, which is not a unit to mark"], "an unknown mark is a problem");
assert.ok(checkRegions(ts.replace("// @spec derive total", "// @spec on click add"), "ts", ["on click add", "derive total"]).some((p) => /marked in 2 places/.test(p)), "a doubled mark is a problem");
assert.equal(extractRegions("x\n// @end\ny", "ts").problem, "an `@end` without a `@spec`", "a stray @end is a problem");
assert.equal(extractRegions("// @spec a\nx", "ts").problem, "a region is never closed", "an unclosed region is a problem");

// The interface around the regions, without the markers or the bodies.
const outside = outsideRegions(ts, "ts");
assert.match(outside, /export type Model/, "the interface stays outside");
assert.ok(!outside.includes("AddClicked") && !outside.includes("model.n * 2"), "the region bodies are removed");

// Incremental: the same code outside, and every clean region unchanged.
assert.deepEqual(checkIncremental(ts, ts, "ts", [], ["on click add", "derive total"]), [], "an identical module is acceptable");
const handlerEdit = ts.replace("model.n + 1", "model.n + 2");
assert.deepEqual(checkIncremental(ts, handlerEdit, "ts", ["on click add"], ["on click add", "derive total"]), [], "a dirty region may change");
assert.match(checkIncremental(ts, handlerEdit, "ts", [], ["on click add", "derive total"])[0], /`on click add` is not dirty/, "a clean region may not change");
const outsideEdit = ts.replace("export type Model = { n: number };", "export type Model = { n: number; extra: boolean };");
assert.match(checkIncremental(ts, outsideEdit, "ts", ["on click add"], ["on click add", "derive total"])[0], /outside the regions changed/, "the outside may not change");

// Planted problems, both refused: a compiler that edits a clean region, and one that leaves a
// removed unit's region behind (the unit is gone from the spec, so it must not be marked).
const leftover = ts.replace("// @spec derive total", "// @spec derive gone");
assert.ok(checkIncremental(ts, leftover, "ts", ["on click add"], ["on click add"]).some((p) => /not a unit to mark/.test(p)), "a removed unit's code left behind is refused");
assert.ok(checkIncremental(ts, ts.replace("model.n + 1", "model.n + 5"), "ts", [], ["on click add", "derive total"]).some((p) => /not dirty, but its region changed/.test(p)), "a compiler that edits a clean region is refused");

// Elm uses `--` markers.
const elm = `module App exposing (..)
-- @spec derive total
total : Int
total = 1
-- @end
`;
assert.deepEqual(checkRegions(elm, "elm", ["derive total"]), [], "Elm marks are read");

console.log("ok regions: marks are checked, and an incremental edit keeps the clean regions");
