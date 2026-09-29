// The units of a spec and what an incremental build must rewrite (compiler/units.ts,
// docs/design/incremental.md): a stable digest per named unit, the names it depends on, and the
// dirty set when some units change.
import assert from "node:assert/strict";
import { parse } from "../compiler/parse.ts";
import { units, diffUnits } from "../compiler/units.ts";
import { orderByDirty } from "../compiler/fuzz.ts";
import { explainIncremental, forgetIncremental, loadIncremental, planIncremental, saveIncremental, storeKey } from "../compiler/incremental.ts";
import { load } from "../compiler/load.ts";

const app = (src: string) => {
  const { app, diagnostics } = parse(src);
  assert.ok(app, `the spec parses: ${diagnostics.map((d) => `${d.line}:${d.code} ${d.message}`).join("; ")}`);
  return app!;
};

// The same app, with the record's `subject` a Text or an Int, and the state fields in either order.
const spec = (subject: string, order = false) => `app Units {
  "A tiny app for testing units."
}
language 1

record Ticket {
  id: Int
  subject: ${subject}
}

state {
${order ? `  picked: Text = ""
  count: Int = 0` : `  count: Int = 0
  picked: Text = ""`}
  tickets: List Ticket = []
}

derive {
  total = the number of @tickets
}

screen {
  text total = @total
  button up "+"
}

on click up {
  - increase @count by 1
}

example "up" {
  see total = "0"
  click up
  see total = "0"
}
`;

const a = units(app(spec("Text")));
const keys = a.map((u) => u.key);
for (const k of ["record Ticket", "state tickets", "state count", "derive total", "on click up", "element total", "example up"])
  assert.ok(keys.includes(k), `units include \`${k}\``);
const behaviour = a.filter((u) => ["element", "derive", "on", "endpoint", "every", "through", "layer"].includes(u.kind)).map((u) => u.key).sort();

// A unit's dependencies are the names it reads or uses.
assert.deepEqual(a.find((u) => u.key === "state tickets")?.depends, ["Ticket"], "state tickets uses Ticket");
assert.deepEqual(a.find((u) => u.key === "derive total")?.depends, ["tickets"], "derive total reads tickets");
assert.deepEqual(a.find((u) => u.key === "element total")?.depends, ["total"], "element total reads total");

// The same spec has no dirty units.
assert.deepEqual(diffUnits(a, units(app(spec("Text")))), { dirty: [], removed: [], clean: behaviour }, "an unchanged spec is clean");

// Moving a unit (reordering the state fields) is no change.
assert.deepEqual(diffUnits(a, units(app(spec("Text", true)))), { dirty: [], removed: [], clean: behaviour }, "moving a unit is no change");

// Changing a record's field type dirties the record, the state that uses it, and what reads that.
const d = diffUnits(a, units(app(spec("Int"))));
for (const k of ["derive total", "element total"])
  assert.ok(d.dirty.includes(k), `changing Ticket.subject dirties \`${k}\``);
assert.ok(d.clean.includes("on click up"), "`on click up` is untouched");

// Removing a unit dirties what depended on it.
const removed = diffUnits(a, units(app(spec("Text").replace("  total = the number of @tickets\n", ""))));
assert.ok(removed.removed.includes("derive total"), "the gone derive is reported removed");
assert.ok(removed.dirty.includes("element total"), "the element that read it is dirty");

// The twin's sessions are ordered so the ones touching a dirty unit run first.
const trace = (target: string) => [{ on: "click" as const, target }];
const ordered = orderByDirty([trace("a"), trace("b"), trace("c")], ["element c"]);
assert.equal(ordered[0][0].target, "c", "a session touching a dirty element runs first");
assert.deepEqual(ordered.slice(1).map((t) => t[0].target), ["a", "b"], "the rest keep their order");
assert.equal(orderByDirty([trace("a"), trace("up")], ["on click up"])[0][0].target, "up", "a handler's target element counts as dirty");

// An incremental rewrite is only for region units: an element or other behaviour unit without a
// region (a label change) needs a full build, so nothing changes silently.
const elementEdit = app(spec("Text").replace('button up "+"', 'button up "++"'));
assert.equal(planIncremental(elementEdit, { code: "", units: a }), undefined, "an element change needs a full build");
const handlerEdit = app(spec("Text").replace("- increase @count by 1", "- increase @count by 2"));
assert.ok(planIncremental(handlerEdit, { code: "", units: a }), "a handler change can be rewritten in place");

// A rule is prose the compiler reads for everything: changing one rewrites all behaviour.
const ruled = (word: string) => `app Ruled {
  "Rules."
}

state {
  count: Int = 0
}

screen {
  text count
  button up "+"
}

rules {
  - the count is shown at the ${word} of the page
}

on click up {
  - increase @count by 1
}
`;
const rd = diffUnits(units(app(ruled("end"))), units(app(ruled("start"))));
assert.deepEqual(rd.dirty, ["element count", "element up", "on click up"], "a changed rule dirties every behaviour unit");

// Several screens may reuse a name: each screen's element is its own unit (`about/title`).
const screens = units(app(`app Screens {
  "Two screens."
}

screen home "/" {
  text title = "Home"
  button back "Back"
}

screen about "/about" {
  text title = "About"
  button back "Back"
}

on click back {
  - go back
}
`));
assert.deepEqual(screens.filter((u) => u.kind === "element").map((u) => u.key), ["element home/title", "element home/back", "element about/title", "element about/back"], "one unit per screen's element");

// Held-out round 4 (H2): the store is the spec file's, not the app's name. Two specs that both say
// \`app Todo\` never reuse each other's build, and a build says why it reuses nothing.
{
  const one = load("apps/02-todo.intent", { ignoreLock: true }).app!;
  const two = load("apps/held-out-4/todo.intent", { ignoreLock: true }).app!;
  assert.equal(one.name, two.name, "both are app Todo");
  assert.notEqual(storeKey(one), storeKey(two), "one store per spec file");
  forgetIncremental(one, "ts", "probe");
  forgetIncremental(two, "ts", "probe");
  try {
    saveIncremental(one, "ts", "probe", "app.ts", "// apps/02-todo's code");
    assert.equal(loadIncremental(two, "ts", "probe", "app.ts"), undefined, "another spec named Todo finds nothing to reuse");
    assert.equal(loadIncremental(one, "ts", "probe", "app.ts")?.code, "// apps/02-todo's code", "the same spec finds its own");
    const why = explainIncremental(two, undefined);
    assert.ok("why" in why && /no previous verified build of .*held-out-4\/todo\.intent/.test(why.why), "and the build says why it reuses nothing");
  } finally {
    forgetIncremental(one, "ts", "probe");
  }
}

console.log("ok units: canonical digests, dependencies, the dirty set, and the session order; the incremental store is per spec file");
