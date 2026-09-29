// Bundle versions are computed (STABILITY.md §6): `apiOf` is the surface, `nextVersion` compares it
// with the last release. Removing or changing an entry is a major version: a record field's type (in
// every bundle, not only a contract), a choice value's wire name, a bundle's `always` and change rules,
// a contract's events. Adding one is a minor; neither is a patch. And `intent publish` refuses a spec
// without a `language` line.
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { parseSyntax } from "../compiler/parse.ts";
import { apiOf, nextVersion, publish } from "../compiler/registry.ts";

const api = (src: string) => apiOf(parseSyntax(src).app);
const entry = (src: string) => ({ sha: "x", file: "x", requires: {}, published: "", api: api(src), examples: [] as string[] });
/** The version after 1.0.0 of `before`, when `after` is published. */
const bump = (before: string, after: string) => nextVersion(entry(before), "1.0.0", api(after), []);

const bundle = (body: string) => `bundle shop.items {\n  "Items for sale."\n}\nlanguage 1\n\n${body}\n`;
const items = `choice Size: Small = "s" | Large = "l"

record Item {
  id: Int
  name: Text
  size: Size
}

state {
  items: List Item = []
}

always {
  - an @Item is never removed
  - an @Item's @name never changes
}`;

// The surface holds what the promise names.
const surface = api(bundle(items));
for (const e of ["field Item.name: Text", "field Item.size: Size", "wire Size.Small = s", "wire Size.Large = l", "always an @Item is never removed", "always an @Item's @name never changes"])
  assert.ok(surface.includes(e), `the surface has \`${e}\` (got ${surface.join("; ")})`);

// Unchanged: a patch.
assert.equal(bump(bundle(items), bundle(items)).version, "1.0.1");

// A record field's type changed in a (non-contract) bundle: major.
let r = bump(bundle(items), bundle(items.replace("name: Text", "name: Int")));
assert.equal(r.version, "2.0.0", `a field type change is major (${r.why})`);
assert.ok(r.why.some((w) => w === "removed: field Item.name: Text"));

// A choice value's wire name changed: major.
r = bump(bundle(items), bundle(items.replace('Large = "l"', 'Large = "large"')));
assert.equal(r.version, "2.0.0", `a wire name change is major (${r.why})`);
assert.ok(r.why.includes("removed: wire Size.Large = l"));
// A wire name given where the value was its own: also major (the JSON changes).
r = bump(bundle(items.replace('Small = "s"', "Small")), bundle(items));
assert.equal(r.version, "2.0.0");

// An `always` rule removed, or a change rule changed: major.
r = bump(bundle(items), bundle(items.replace("  - an @Item is never removed\n", "")));
assert.equal(r.version, "2.0.0", `a removed change rule is major (${r.why})`);
r = bump(bundle(items), bundle(items.replace("an @Item's @name never changes", "an @Item's @size never changes")));
assert.equal(r.version, "2.0.0", `a changed change rule is major (${r.why})`);
// A `see` rule too.
const seen = `${items}\n\nscreen {\n  list shown of Item {\n    text name\n  }\n}`.replace("always {\n", "always {\n  see shown has at most 5 rows\n");
r = bump(bundle(seen), bundle(seen.replace("at most 5 rows", "at most 6 rows")));
assert.equal(r.version, "2.0.0", `a changed \`see\` rule is major (${r.why})`);

// Adding a field, a choice value or a rule: minor.
r = bump(bundle(items), bundle(items.replace("  size: Size\n", "  size: Size\n  note: Text = \"\"\n")));
assert.equal(r.version, "1.1.0", `an added field is minor (${r.why})`);
r = bump(bundle(items), bundle(items.replace("  - an @Item is never removed\n", "  - an @Item is never removed\n  - an @Item's @size never changes\n")));
assert.equal(r.version, "1.1.0", `an added rule is minor (${r.why})`);

// A contract's events: removing one, or changing its payload, is major; adding one is minor.
const contract = (events: string) => `contract shop.itemsApi {\n  "Items over HTTP."\n}\nlanguage 1\n\nrecord Item {\n  id: Int\n  name: Text\n}\n\n${events}\n\nendpoint listItems GET "/items" {\n  answers 200 List Item\n}\n`;
const two = "event itemAdded: Item\nevent itemGone: Item";
assert.ok(api(contract(two)).includes("event itemAdded: Item"));
r = bump(contract(two), contract("event itemAdded: Item"));
assert.equal(r.version, "2.0.0", `a removed event is major (${r.why})`);
assert.ok(r.why.includes("removed: event itemGone: Item"));
r = bump(contract(two), contract("event itemAdded: Item\nevent itemGone: Int"));
assert.equal(r.version, "2.0.0", `a changed event payload is major (${r.why})`);
r = bump(contract("event itemAdded: Item"), contract(two));
assert.equal(r.version, "1.1.0", `an added event is minor (${r.why})`);

// The bundles of lib/ compute a surface with every kind of entry they have.
const alerts = api(readFileSync(new URL("../lib/notify/alerts.intent", import.meta.url), "utf8"));
assert.ok(alerts.includes("wire Level.Urgent = urgent") && alerts.includes("field Alert.level: Level"), alerts.join("; "));
const alertsApi = api(readFileSync(new URL("../lib/notify/alertsApi.intent", import.meta.url), "utf8"));
assert.ok(alertsApi.includes("event alertRaised: Alert"), alertsApi.join("; "));

// `intent publish` needs the `language` line.
const dir = mkdtempSync(join(tmpdir(), "registry-test-"));
const file = join(dir, "items.intent");
writeFileSync(file, bundle(items).replace("language 1\n", ""));
await assert.rejects(publish(file, join(dir, "registry"), () => "sha", []), /has no `language` line: a published spec says the language version it needs \(`intent fix` adds `language 1`\)/);
writeFileSync(file, bundle(items));
const p = await publish(file, join(dir, "registry"), () => "sha", []);
assert.equal(p.version, "1.0.0");

console.log("ok registry: field types, wire names, always and change rules, and a contract's events are part of a bundle's version; publish needs a `language` line");
