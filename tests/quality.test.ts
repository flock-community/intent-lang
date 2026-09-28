// Quality checks (compiler/quality.ts): rule sets on top of the compiler's checks — std.quality by
// default, a level per rule from the project, a team's own rule set, and the compiler's errors kept.
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { parse } from "../compiler/parse.ts";
import { applyQuality, DEFAULT_QUALITY, loadRuleSets } from "../compiler/quality.ts";
import { readProject } from "../compiler/registry.ts";
import { load } from "../compiler/load.ts";
import stdQuality from "../compiler/quality/std.ts";

const src = `app Shop {
  "A price list. A price is never below zero."
}

record Item {
  name: Text
  price: Decimal
}

state {
  items: List Item = []
  draft: Text = ""
}

screen {
  field draft "Name"
  button add "Add"
  text count = "{the number of @items}"
}

on click add {
  - add an @Item to the end of @items with @name = draft and @price = 0
}
`;
const { app, diagnostics } = parse(src);
assert.ok(app, diagnostics.map((d) => d.message).join("; "));
const codes = (ds: { code: string; level: string }[]) => ds.map((d) => `${d.code}:${d.level}`);

// std.quality by default: the checker's warnings stay, and its own rules add findings.
const std = await loadRuleSets(DEFAULT_QUALITY);
const base = applyQuality("shop.intent", app, diagnostics, std, DEFAULT_QUALITY);
assert.ok(codes(base).includes("NEVER_UNCHECKED:warning"), "a promise in the purpose without an `always` is found");
assert.ok(codes(base).includes("UNMARKED:warning"), "the checker's warnings are std.quality's rules");

// A level per rule: off removes it, error raises it.
const tuned = { use: ["std.quality"], levels: { UNMARKED: "off", NEVER_UNCHECKED: "error" } as Record<string, "off" | "error"> };
const t = applyQuality("shop.intent", app, diagnostics, std, tuned);
assert.ok(!codes(t).some((c) => c.startsWith("UNMARKED")), "UNMARKED off");
assert.ok(codes(t).includes("NEVER_UNCHECKED:error"), "NEVER_UNCHECKED an error");

// The compiler's checks are not a rule set's to switch off.
assert.throws(() => applyQuality("shop.intent", app, diagnostics, std, { use: ["std.quality"], levels: { TYPE: "off" } }), /no rule `TYPE`/);

// A team's own rule set, next to std.quality.
const withTeam = { use: ["std.quality", "examples/quality/team.ts"], levels: {} };
const sets = await loadRuleSets(withTeam, new URL("..", import.meta.url).pathname);
assert.ok(codes(applyQuality("shop.intent", app, diagnostics, sets, withTeam)).includes("MONEY_IN_CENTS:warning"), "the team's rule runs");

// intent.project's `quality` block.
const dir = mkdtempSync(join(tmpdir(), "quality-"));
writeFileSync(join(dir, "intent.project"), "project shop\n\nquality {\n  use std.quality\n  use ./quality/team.ts\n  UNMARKED off\n  MONEY_IN_CENTS error\n}\n");
assert.deepEqual(readProject(join(dir, "intent.project"))?.quality, { use: ["std.quality", "./quality/team.ts"], levels: { UNMARKED: "off", MONEY_IN_CENTS: "error" } });

// The boundary: the compiler alone emits none of std.quality's codes; with it, the hints are back.
const own = new Set(stdQuality.rules.map((r) => r.id));
const specFile = new URL("../apps/06-expenses.intent", import.meta.url).pathname;
const bare = load(specFile, { quality: false }).diagnostics;
assert.ok(!bare.some((d) => own.has(d.code)), `the compiler emits no quality codes (got ${bare.filter((d) => own.has(d.code)).map((d) => d.code).join(", ")})`);
assert.ok(load(specFile).diagnostics.some((d) => d.code === "SHADOWED"), "a load applies std.quality by default");

console.log("ok quality: std.quality by default, levels per rule, a team's rule set, compiler checks kept");
