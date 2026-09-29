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

// Change rules (v67): a handler that writes what a rule freezes, with no condition before it that
// could exclude the frozen rows (BREAKS_RULE); a declared transition no example makes (TRANSITION_UNPROVEN).
{
  const spec = `app Desk {
  "Tickets whose ids never change."
}

choice Status: Open | Solved | Closed
choice Decision: Pending | Approved

record Ticket {
  id: Int
  subject: Text
  status: Status
}

record Expense {
  id: Int
  amount: Decimal
  status: Decision
}

state {
  tickets: List Ticket = table {
    id | subject | status
    1  | "A"     | Open
  }
  expenses: List Expense = table {
    id | amount | status
    1  | 10     | Pending
  }
}

screen {
  list tickets of Ticket {
    text subject
    button renumber "Renumber"
    button solve "Solve"
  }
  list expenses of Expense {
    text amount
    button bump "Bump"
    button safeBump "Bump safely"
    button approve "Approve"
  }
}

on click renumber {
  - set that ticket's @subject to "Z"
}

on click solve {
  - set the @status of that ticket to @Solved
}

on click bump {
  - set the @amount of that expense to 99
}

on click safeBump {
  if that expense's @status is @Approved {
    stop
  }
  - set the @amount of that expense to 99
}

on click approve {
  - set its @status to @Approved
}

always {
  - a @Ticket's @subject never changes
  - a @Ticket's @status only changes from @Open to @Solved, from @Solved to @Closed
  - an @Expense whose @status was @Approved never changes
}

example "solving" {
  click solve on row 1
  see subject on row 1 = "A"
}
`;
  const { app: desk, diagnostics: dd } = parse(spec);
  assert.ok(desk, dd.filter((d) => d.level === "error").map((d) => d.message).join("; "));
  const at = (code: string) => dd.filter((d) => d.code === code).map((d) => d.line);
  const lineOf = (text: string) => spec.split("\n").findIndex((l) => l.includes(text)) + 1;
  assert.deepEqual(at("BREAKS_RULE"), [lineOf("set that ticket's @subject to \"Z\""), lineOf("set the @amount of that expense to 99"), lineOf("set its @status to @Approved")].sort((a, b) => a - b), `BREAKS_RULE: the subject write, the unguarded amount write and the approval (got ${at("BREAKS_RULE")})`);
  // (the guarded write in `safeBump`, after `if that expense's @status is @Approved { stop }`, is not among them)
  assert.deepEqual(at("TRANSITION_UNPROVEN"), [lineOf("only changes from @Open to @Solved")], "one pair unproven");
  assert.match(dd.find((d) => d.code === "TRANSITION_UNPROVEN")!.message, /from Solved to Closed/, "Solved → Closed is the one no example makes");
}

// Access (v70): an api that knows who calls but not what they may do (NO_ACCESS); a refusal by hand
// next to an access block (HAND_ACCESS); a rule no example proves both ways (ACCESS_UNPROVEN); a
// screen-only app that promises who may do what (UNENFORCED, on the held-out approvals app, unedited).
{
  const at = (file: string, code: string) => load(file, { ignoreLock: true }).diagnostics.filter((d) => d.code === code);
  const unenforced = at("apps/held-out-3/approvals.intent", "UNENFORCED");
  assert.equal(unenforced.length, 1, "the approvals screen promises that a manager approves, and nothing can keep it");
  assert.equal(unenforced[0].level, "warning");
  assert.match(unenforced[0].message, /a manager approves/);
  assert.equal(at("apps/20-approval.intent", "UNENFORCED").length, 0, "a screen that calls a service is not UNENFORCED");
  assert.equal(at("apps/02-todo.intent", "UNENFORCED").length, 0, "a screen that promises nothing about who is not UNENFORCED");
  assert.equal(at("apps/api/members-api.intent", "NO_ACCESS").length + at("apps/api/members-api.intent", "ACCESS_UNPROVEN").length, 0, "members-api says what callers may do (keys in state count as callers)");
  assert.equal(at("apps/api/desk-api.intent", "NO_ACCESS").length + at("apps/api/desk-api.intent", "ACCESS_UNPROVEN").length + at("apps/api/desk-api.intent", "HAND_ACCESS").length, 0, "the desk api says what callers may do, proves every rule, and checks nothing by hand");
  const dir = mkdtempSync(join(tmpdir(), "access-quality-"));
  const spec = (hand: string, extra = "", language = "") => `app Hand {\n  "Tickets behind keys."\n}\n${language}\nprofile api\n\nlayer auth = std.http.apiKey {\n  keys = table {\n    secret    | owner\n    "k-ann-1" | "Ann"\n    "k-sam-2" | "Sam"\n  }\n}\n\nrecord Ticket {\n  id: Int\n  assignee: Text\n}\n\nstate {\n  tickets: List Ticket = table {\n    id | assignee\n    1  | "Sam"\n  }\n}\n${extra}\nendpoint solve POST "/tickets/{id}/solve" {\n  path id: ref Ticket\n  if that ticket does not exist {\n    answer 404 "No such ticket"\n  }\n${hand}  answer 200 with the ticket\n}\n\nexample "solving" {\n  call solve as "Sam" with id = 1\n  see solve.status = 200\n  call solve as "Ann" with id = 1\n  see solve.status = 403\n}\n`;
  const block = "\naccess {\n  - any caller may call @solve\n}\n";
  const write = (name: string, text: string) => (writeFileSync(join(dir, name), text), join(dir, name));
  const byHand = write("hand.intent", spec(`  if that ticket's @assignee is not the @caller {\n    answer 403 "Only the assignee"\n  }\n`, block));
  assert.equal(at(byHand, "HAND_ACCESS").length, 1, "a 403 on a condition about the caller, next to an access block");
  const conflict = write("conflict.intent", spec(`  if that ticket's @assignee is not the @caller {\n    answer 404 "No such ticket"\n  }\n`, block));
  assert.equal(at(conflict, "HAND_ACCESS").length, 0, "near miss: a condition on the caller that answers something else is the endpoint's own business");
  // Without the block the same api gets NO_ACCESS: the compiler's error in language 1, with a
  // \`language 1\` line, without one (it means \`language 1\`), and with a pre-1 line (read as \`language 1\`).
  const bare = write("bare.intent", spec(""));
  assert.deepEqual(at(bare, "NO_ACCESS").map((d) => [d.level, d.line]), [["error", 7]], "no language line: language 1, an error (once)");
  const one = write("one.intent", spec("", "", "language 1\n"));
  assert.deepEqual(at(one, "NO_ACCESS").map((d) => [d.level, d.line]), [["error", 8]], "language 1: an error at the key layer");
  const old = write("old.intent", spec("", "", "language v60\n"));
  assert.deepEqual(at(old, "NO_ACCESS").map((d) => [d.level, d.line]), [["error", 8]], "a pre-1 line reads as language 1: an error, never a hint");
  // ACCESS_UNPROVEN: \`any caller may call @solve\` is proven the permitted way only (Ann's 403 is the hand check's).
  const unproven = at(byHand, "ACCESS_UNPROVEN");
  assert.equal(unproven.length, 1, `one rule, unproven one way (got ${unproven.map((d) => d.message).join("; ")})`);
  assert.match(unproven[0].message, /a call it refuses/);
}

console.log("ok quality: change rules (BREAKS_RULE, TRANSITION_UNPROVEN), access (NO_ACCESS, HAND_ACCESS, ACCESS_UNPROVEN, UNENFORCED), std.quality by default, levels per rule, a team's rule set, compiler checks kept");
