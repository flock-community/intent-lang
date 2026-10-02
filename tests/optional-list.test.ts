// An optional list (language 1.1): `Maybe List T` is a list that may be absent; `List T or nothing`
// is a list whose items may be nothing (`or nothing` binds to the type word right before it).
// `intent check` does not suggest rewriting `Maybe List T` (it would change the meaning), and
// `intent fix` leaves it as it is.
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { parse } from "../compiler/parse.ts";
import { load } from "../compiler/load.ts";
import { fixSource } from "../compiler/fix.ts";
import { typeDescOf } from "../compiler/targets/ts-service.ts";
import { route, toWire } from "../runtime/ts/api.ts";

const src = `app Notes {
  "Notes with tags that may be absent."
}
language 1.1

profile api

record Note {
  key id: Int
  tags: Maybe List Text
}

state {
  stored notes: List Note = []
  maybeTags: Maybe List Text = nothing
  someTags: List Text or nothing = []
  maybeMap: Maybe Map Int = nothing
  mapOfSome: Map Int or nothing = {}
  one: Maybe Text = nothing
}

endpoint create POST "/notes" {
  body tags: Maybe List Text
  body loose: List Text or nothing
  answers 201 Note
  - add a @Note to the end of @notes with @id = the number of @notes plus 1 and @tags = @tags
  answer 201 with the new note
}

example "a note without tags" {
  call create with loose = []
  see create.status = 201
  see create.body.tags = nothing
}
`;

// 1. How each spelling parses.
const { app, diagnostics } = parse(src);
assert.ok(app, diagnostics.map((d) => `${d.line}:${d.code} ${d.message}`).join("; "));
const typeOf = (name: string) => app.state.find((s) => s.name === name)?.type;
assert.deepEqual(typeOf("maybeTags"), { k: "Maybe", of: { k: "List", of: { k: "Text" } } }, "`Maybe List Text` is an optional list");
assert.deepEqual(typeOf("someTags"), { k: "List", of: { k: "Maybe", of: { k: "Text" } } }, "`List Text or nothing` is a list of `Text or nothing`");
assert.deepEqual(typeOf("maybeMap"), { k: "Maybe", of: { k: "Map", of: { k: "Int" } } }, "`Maybe Map Int` is an optional map");
assert.deepEqual(typeOf("mapOfSome"), { k: "Map", of: { k: "Maybe", of: { k: "Int" } } }, "`Map Int or nothing` is a map of `Int or nothing`");
assert.deepEqual(typeOf("one"), { k: "Maybe", of: { k: "Text" } });

// 2. The checker: no errors; SPELLING only on `Maybe Text`, with a rewrite that keeps the meaning.
const dir = mkdtempSync(join(tmpdir(), "optional-list-"));
const file = join(dir, "notes.intent");
writeFileSync(file, src);
const loaded = load(file, { ignoreLock: true });
assert.deepEqual(loaded.diagnostics.filter((d) => d.level === "error").map((d) => `${d.line}:${d.code} ${d.message}`), []);
const spelling = loaded.diagnostics.filter((d) => d.code === "SPELLING").map((d) => `${d.line}: ${d.message}`);
assert.deepEqual(spelling, ["19: `Maybe Text` is written `Text or nothing`: a value that may be absent is `T or nothing` (`intent fix` rewrites it)"], "`Maybe List` / `Maybe Map` get no SPELLING suggestion");

// 3. `intent fix` rewrites `Maybe Text` and leaves `Maybe List Text` / `Maybe Map Int` as they are.
const fixed = fixSource(src, "");
assert.deepEqual(fixed.fixes.map((f) => `${f.line}: ${f.what}`), ["19: Maybe Text → Text or nothing"]);
assert.match(fixed.out, /^  tags: Maybe List Text$/m);
assert.match(fixed.out, /^  maybeTags: Maybe List Text = nothing$/m);
assert.match(fixed.out, /^  maybeMap: Maybe Map Int = nothing$/m);
assert.match(fixed.out, /^  one: Text or nothing = nothing$/m);
assert.match(fixed.out, /^  body tags: Maybe List Text$/m);

// 4. On the wire: an absent optional list is nothing (`null`), its items are never nothing; a list of
//    `Text or nothing` takes a `null` item.
const ep = app.endpoints!.find((e) => e.name === "create")!;
const desc = [{ name: ep.name, method: ep.method, path: ep.path, params: ep.params.map((p) => ({ in: p.in, name: p.name, type: typeDescOf(app, p.type) })) }];
assert.deepEqual(desc[0].params.find((p) => p.name === "tags")!.type, { k: "Maybe", of: { k: "List", of: { k: "Text" } } });
const post = (body: unknown) => route(desc, "POST", "/notes", {}, body);
assert.deepEqual(post({ loose: [] }), { request: { endpoint: "create", tags: null, loose: [] } }, "a missing optional list is nothing");
assert.deepEqual(post({ tags: null, loose: [] }), { request: { endpoint: "create", tags: null, loose: [] } }, "`null` is nothing");
assert.deepEqual(post({ tags: [], loose: [] }), { request: { endpoint: "create", tags: [], loose: [] } }, "an empty list is a list, not nothing");
assert.deepEqual(post({ tags: ["a", "b"], loose: [] }), { request: { endpoint: "create", tags: ["a", "b"], loose: [] } });
assert.deepEqual(post({ tags: ["a", null], loose: [] }), { response: { status: 400, body: { error: "tags[2] must be text" } } }, "an item of an optional list of Text is never nothing");
assert.deepEqual(post({ tags: ["a"] }), { response: { status: 400, body: { error: "loose is required" } } }, "a list of `Text or nothing` is itself required");
assert.deepEqual(post({ loose: ["a", null] }), { request: { endpoint: "create", tags: null, loose: ["a", null] } }, "a list of `Text or nothing` takes a null item");
const note = typeDescOf(app, { k: "Named", name: "Note" });
assert.deepEqual(toWire({ id: 1 }, note), { id: 1, tags: null }, "an absent optional list is written as null");
assert.deepEqual(toWire({ id: 2, tags: ["x"] }, note), { id: 2, tags: ["x"] });

console.log("ok optional list: `Maybe List T` / `Maybe Map T` are optional, `List T or nothing` is a list of optional items, no SPELLING rewrite that changes the meaning, fix leaves them, absent → null, a null item refused");
