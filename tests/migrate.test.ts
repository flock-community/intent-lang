// Migrating kept data to the current types (runtime/ts/api.ts migrate): a record change in the spec
// must not silently reset what the user had. A removed field is dropped, a new `T or nothing` field
// becomes nothing, a new list an empty list; only a stored field that cannot be migrated at all
// keeps the spec's default.
import assert from "node:assert/strict";
import { migrate, type TypeDesc } from "../runtime/ts/api.ts";

const note = (fields: { name: string; type: TypeDesc }[]): TypeDesc => ({ k: "Record", name: "Note", fields: [{ name: "id", type: { k: "Int" } }, ...fields] });
const list = (of: TypeDesc): TypeDesc => ({ k: "List", of });

// A field removed from the record: the extra one is dropped, the rest stays.
assert.deepEqual(
  migrate({ notes: [{ id: 1, text: "a", old: true }] }, { notes: list(note([{ name: "text", type: { k: "Text" } }])) }),
  { data: { notes: [{ id: 1, text: "a" }] }, dropped: [] },
  "an extra field is dropped",
);
// A new `T or nothing` field becomes nothing; a new list an empty list.
assert.deepEqual(
  migrate({ notes: [{ id: 1, text: "a" }] }, { notes: list(note([{ name: "text", type: { k: "Text" } }, { name: "note", type: { k: "Maybe", of: { k: "Text" } } }, { name: "tags", type: { k: "List", of: { k: "Text" } } }])) }),
  { data: { notes: [{ id: 1, text: "a", note: null, tags: [] }] }, dropped: [] },
  "a new nothing and list field are filled",
);
// A new required field with no default: only that stored field keeps the spec's default.
assert.deepEqual(
  migrate({ notes: [{ id: 1, text: "a" }] }, { notes: list(note([{ name: "text", type: { k: "Text" } }, { name: "kind", type: { k: "Text" } }])) }),
  { data: {}, dropped: ["notes"] },
  "an unmigratable stored field is dropped (its default is used)",
);
// A stored field the current spec no longer has, and a value that changed type.
assert.deepEqual(migrate({ notes: [], gone: [1, 2] }, { notes: list(note([{ name: "text", type: { k: "Text" } }])) }), { data: { notes: [] }, dropped: [] }, "a removed stored field is ignored");
assert.deepEqual(migrate({ count: "many" }, { count: { k: "Int" } }), { data: {}, dropped: ["count"] }, "a value that no longer fits keeps the default");
// Missing data: nothing to migrate, everything dropped.
assert.deepEqual(migrate(undefined, { notes: list(note([{ name: "text", type: { k: "Text" } }])) }), { data: {}, dropped: ["notes"] }, "nothing saved: the defaults");

console.log("ok migrate: extra fields, new nothing/list fields, and unmigratable fields keep the default");
