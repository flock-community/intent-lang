// Held-out round 4 (runs/r1-held-out-4/report.md): the checker's findings K1–K9 and the gaps the
// language closed (G3 an order, G4 `for each` in an endpoint, G6 time in words, G14 a key never
// reused), each as a spec that got the wrong diagnostic before, and the near misses that must stay
// quiet. Specs that need the loader (a contract, a provider) are written to a folder in this
// repository, since `tested with` and `lib/` are the project's. No LLM.
import assert from "node:assert/strict";
import { mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { parse } from "../compiler/parse.ts";
import { load } from "../compiler/load.ts";
import { fixText } from "../compiler/fix.ts";
import { renderReport } from "../compiler/converge.ts";

type D = { level: string; code: string; line: number; message: string; file?: string };
const lineOf = (src: string, text: string) => src.split("\n").findIndex((l) => l.includes(text)) + 1;
const at = (ds: D[], code: string, line: number) => ds.filter((d) => d.code === code && d.line === line);
const head = (name: string, purpose = "x") => `app ${name} {\n  "${purpose}"\n}\nlanguage 1\n`;

// ---------------------------------------------------------------- K1: the hint names the working form
{
  const src = `${head("K1")}
record Item {
  id: Int
  due: Date or nothing = nothing
}

state {
  items: List Item = []
}

screen {
  list items of Item {
    text due = "{its @due as a date}" {
      visible when its @due exists
    }
    text due2 = "{its @due as a date}" {
      visible when there is a @due
    }
  }
}
`;
  const ds = parse(src).diagnostics as D[];
  const [k1] = at(ds, "TYPE", lineOf(src, "text due = "));
  assert.ok(k1, "`its @due exists` on a `Date or nothing` is refused");
  assert.match(k1.message, /write `there is a @due`/, "and the hint names the form that works");
  assert.doesNotMatch(k1.message, /there is a its/, "never `there is a its @due`");
  assert.equal(at(ds, "TYPE", lineOf(src, "text due2 = ")).length + at(ds, "NOTHING", lineOf(src, "text due2 = ")).length, 0, "`there is a @due` in a row: the row's field, cast");
}

// ---------------------------------------------------------------- K2 / R1: a disabled button is not clicked in an example
{
  const src = `${head("K2")}
record Item {
  id: Int
  title: Text
  done: Bool = false
}

state {
  draft: Text = ""
  items: List Item = table {
    id | title | done
    1  | "A"   | false
    2  | "B"   | true
  }
}

screen {
  field draft "New"
  button add "Add" {
    enabled when @draft is not blank
  }
  list items of Item {
    checkbox done
    text title
    button remove "Remove" {
      enabled when its @done is false
    }
  }
}

on click add {
  - add an @Item to the end of @items with @id = 9, @title = @draft
  - clear @draft
}

on click remove {
  - remove that item from @items
}

example "nothing typed" {
  click add
}

example "typed, then again" {
  type "C" into draft
  click add
  click add
}

example "a done row" {
  click remove on row with "B"
}

example "ticked, then removed" {
  toggle done on row 1
  click remove on row 1
}

example "an open row" {
  see remove on row 2 is disabled
  click remove on row 1
}
`;
  const ds = parse(src).diagnostics as D[];
  const lines = src.split("\n");
  const clicks = (from: string) => {
    const start = lineOf(src, from);
    return lines.slice(start).map((l, i) => ({ l: l.trim(), n: start + i + 1 })).filter((x) => x.l.startsWith("click"));
  };
  const step = (ex: string, k: number) => clicks(`example "${ex}"`)[k].n;
  assert.equal(at(ds, "STEP", step("nothing typed", 0)).length, 1, "clicking Add with nothing typed: the button is disabled");
  assert.match(at(ds, "STEP", step("nothing typed", 0))[0].message, /see add is disabled/, "and the message says how to prove it");
  assert.equal(at(ds, "STEP", step("typed, then again", 0)).length, 0, "typed: enabled");
  assert.equal(at(ds, "STEP", step("typed, then again", 1)).length, 0, "after the handler cleared it: not decided here, left to the harness");
  assert.equal(at(ds, "STEP", step("a done row", 0)).length, 1, "a seeded done row");
  assert.equal(at(ds, "STEP", step("ticked, then removed", 0)).length, 1, "a row ticked by the example");
  assert.equal(at(ds, "STEP", step("an open row", 0)).length, 0, "an open row may be clicked");
}

// ---------------------------------------------------------------- K9: `was` outside `always`; an order on nothing in a filter
{
  const src = `${head("K9")}
record Item {
  id: Int
  due: Date or nothing = nothing
  done: Bool = false
}

state {
  items: List Item = []
  flag: Bool = false
}

derive {
  overdue = the @items whose @done is false and @due is before @today
  asked = the @items whose there is a @due and @due is before @today
}

screen {
  button go "Go"
  list items of Item {
    button finish "Finish" {
      enabled when its @done used to be false
    }
  }
}

on click go {
  if the previous @flag is true {
    stop
  }
  - set @flag to true
}

on click finish {
  if that item was done {
    stop
  }
  if that item's done was true {
    stop
  }
  - set that item's @done to true
}
`;
  const ds = parse(src).diagnostics as D[];
  assert.equal(at(ds, "NOTHING", lineOf(src, "overdue =")).length, 1, "an order on a `Date or nothing` in a filter is NOTHING");
  assert.match(at(ds, "NOTHING", lineOf(src, "overdue ="))[0].message, /whose there is a @due and @due is before @today/);
  assert.equal(at(ds, "NOTHING", lineOf(src, "asked =")).length, 0, "asked first in the filter: typed");
  for (const t of ["button finish", "the previous @flag", "that item was done", "that item's done was true"]) assert.equal(at(ds, "CHANGE", lineOf(src, t)).length, 1, `\`${t}\` outside \`always\` is CHANGE`);
}

// ---------------------------------------------------------------- K8, G6: time in words, typed
{
  const src = `${head("K8")}
record Booking {
  id: Int
  start: DateTime
  day: Date
  ends: DateTime or nothing = nothing
}

state {
  bookings: List Booking = table {
    id | start            | day
    1  | 2026-01-06 09:00 | 2026-01-06
  }
  late: Bool = false
  n: Int = 0
  when: DateTime = 2026-01-05 09:00
}

screen {
  button check "Check"
  list bookings of Booking {
    button cancel "Cancel"
  }
}

on click check {
  - set @n to the minutes between @now and @when
  - set @n to the hours between @now and @when
  - set @n to the days between @today and @when
  - set @when to 3 hours after @now
  - set @when to 2 hours after @today
  - set @when to 2 days after @now
}

on click cancel {
  if the minutes between @now and that booking's @start is below 1440 {
    - set @late to true
  }
  if the hours between @now and that booking's @ends is below 24 {
    - set @late to true
  }
  - set @n to the days between @today and that booking's @day
}
`;
  const ds = parse(src).diagnostics as D[];
  const l = (t: string) => lineOf(src, t);
  assert.equal(ds.filter((d) => d.level === "error" && d.line === l("the minutes between @now and that booking's @start")).length, 0, "`the minutes between A and B is below N`: the minutes are compared, not B (K8)");
  for (const t of ["the minutes between @now and @when", "the hours between @now and @when", "3 hours after @now", "2 days after @now", "the days between @today and that booking's @day"]) assert.equal(ds.filter((d) => d.level === "error" && d.line === l(t)).length, 0, `\`${t}\` is typed`);
  assert.match(at(ds, "TYPE", l("the days between @today and @when"))[0]?.message ?? "", /two days \(Date\)/, "days between two moments: say hours or minutes");
  assert.match(at(ds, "TYPE", l("2 hours after @today"))[0]?.message ?? "", /moves a moment/, "hours after a day");
  assert.equal(at(ds, "NOTHING", l("that booking's @ends is below 24")).length, 1, "a moment that may be nothing");
  // A day number of the app's own (held-out-2's library: `today: Int`) stays judgement, not an error.
  const lib = load("apps/held-out-2/library.intent", { ignoreLock: true });
  assert.equal(lib.diagnostics.filter((d) => d.level === "error").length, 0, "`14 days after @today` with an Int of the app's own is left alone");
}

// ---------------------------------------------------------------- G3: an order, typed (`sorted by`); the other spelling rewritten
{
  const src = `${head("G3")}
record Item {
  id: Int
  title: Text
  due: Date or nothing = nothing
}

state {
  items: List Item = []
}

derive {
  a = @items sorted by @due, earliest first, then by @id
  b = @items sorted by @title, earliest first
  c = @items sorted by @title, A to Z, then by @id, highest first
  e = @items sorted by @id, Z to A
  g = @items sorted by @size
  f = the @items, earliest @due first, then lowest @id first
}

screen {
  list a of Item {
    text title
  }
}

example "x" {
  see a has 0 rows
}
`;
  const ds = parse(src).diagnostics as D[];
  const l = (t: string) => lineOf(src, t);
  assert.equal(ds.filter((d) => d.level === "error" && [l("  a = "), l("  c = ")].includes(d.line)).length, 0, "a typed order; a field that may be nothing sorts it last");
  assert.match(at(ds, "TYPE", l("  b = "))[0]?.message ?? "", /earliest \/ latest order days and moments.*sorted by @title, A to Z/);
  assert.match(at(ds, "TYPE", l("  e = "))[0]?.message ?? "", /A to Z orders text/);
  assert.ok(ds.some((d) => d.level === "error" && d.line === l("  g = ")), `a key that is no field of the rows: ${JSON.stringify(ds.map((d) => `${d.line}:${d.code}`))} ${l("  g = ")}`);
  const sp = at(ds, "SPELLING", l("  f = "))[0];
  assert.match(sp?.message ?? "", /is written ` sorted by @due, earliest first, then by @id, lowest first`/);
  const fixed = fixText(src.replace(/  [beg] = .*\n/g, ""));
  assert.match(fixed.out, /f = the @items sorted by @due, earliest first, then by @id, lowest first\n/, "`intent fix` rewrites it");
}

// ---------------------------------------------------------------- G4: `for each` at the top of an endpoint, over a row's inner list
{
  const src = `${head("G4")}
profile api

record Step {
  id: Int
  done: Bool = false
}

record Chore {
  id: Int
  steps: List Step = []
}

state {
  stored chores: List Chore = []
}

endpoint reset POST "/chores/{id}/reset" {
  path id: ref Chore
  answers 200 Chore
  answers 404 Problem
  if that chore does not exist {
    answer 404 "No such chore"
  }
  for each @step in that chore's @steps {
    - set @step's @done to false
  }
  answer 200 with that chore
}

endpoint finishAll POST "/finish" {
  answers 200 List Chore
  for each @chore in @chores {
    - set the @done of every step in @chore's @steps to true
  }
  answer 200 with @chores
}

example "x" {
  call reset with id = 1
  see reset.status = 404
  call finishAll
  see finishAll.status = 200
}
`;
  const ds = parse(src).diagnostics as D[];
  assert.deepEqual(ds.filter((d) => d.level === "error").map((d) => `${d.line}:${d.code} ${d.message}`), [], "`for each` is a step of an endpoint, also over a row's inner list");
}

// ---------------------------------------------------------------- K6: UNSTEERED only for a value this example drew; K5 GUESSABLE for a contract's param
{
  const clinic = load("apps/held-out-4/clinic-api.intent", { ignoreLock: true });
  assert.ok(!clinic.diagnostics.some((d) => d.code === "UNSTEERED"), "a seeded booking's code was never drawn: no UNSTEERED");
  const g = clinic.diagnostics.find((d) => d.code === "GUESSABLE");
  assert.ok(g && /in the contract of endpoint/.test(g.message), "a drawn code the contract takes back as input: GUESSABLE at the implementation's endpoint");
  const src = `${head("K6")}
profile api

type Code = Text of 6 digits

record Ticket {
  key code: Code
  owner: Text
}

state {
  stored tickets: List Ticket = table {
    code     | owner
    "111111" | "Ann"
  }
}

derive {
  freeCode = a random @Code not among the @code of @tickets
}

endpoint issue POST "/tickets" {
  body owner: Text
  answers 201 Ticket
  answers 409 Problem
  if there is no @freeCode {
    answer 409 "No code is free"
  }
  - add a @Ticket to the end of @tickets with @code = @freeCode, @owner = @owner
  answer 201 with the new ticket
}

endpoint list GET "/tickets" {
  answers 200 List Ticket
  answer 200 with @tickets
}

example "the seeded ticket, then a new one" {
  call list
  see list.body[1].code = "111111"
  call issue with owner = "Bob"
  see issue.body.code = "222222"
}
`;
  const ds = parse(src).diagnostics as D[];
  assert.equal(at(ds, "UNSTEERED", lineOf(src, 'see list.body[1].code = "111111"')).length, 0, "a seeded code: not UNSTEERED");
  assert.equal(at(ds, "UNSTEERED", lineOf(src, 'see issue.body.code = "222222"')).length, 1, "a drawn one compared with a literal: UNSTEERED");
}

// ---------------------------------------------------------------- K7: UNENFORCED reads a marked role
{
  const src = `${head("K7", "A list of items.")}
record Item {
  id: Int
  owner: Text
}

state {
  items: List Item = []
}

screen {
  list items of Item {
    text owner
  }
}

rules {
  - only the @owner of an item may delete it
}

example "x" {
  see items has 0 rows
}
`;
  assert.ok((parse(src).diagnostics as D[]).some((d) => d.code === "UNENFORCED"), "`only the @owner … may` in rules is a promise a screen cannot keep");
}

// ---------------------------------------------------------------- G14: a key never reused
{
  const src = `${head("G14")}
record Item {
  id: Int
  title: Text
}

state {
  items: List Item = []
  lastDeleted: Item or nothing = nothing
}

screen {
  button add "Add"
  list items of Item {
    button remove "Remove"
  }
}

on click add {
  - add an @Item to the end of @items with @id = the highest @id in @items + 1, or 1 when there is none, @title = "x"
}

on click remove {
  - set @lastDeleted to that item
  - remove that item from @items
}

example "x" {
  click add
  see items has 1 row
}
`;
  const ds = parse(src).diagnostics as D[];
  assert.match(at(ds, "REUSED_KEY", lineOf(src, "the highest @id in @items + 1"))[0]?.message ?? "", /Keep a counter/, "a removed row's id handed out again, while an undo keeps the row: REUSED_KEY");
  const quiet = parse(src.replace("  lastDeleted: Item or nothing = nothing\n", "").replace("  - set @lastDeleted to that item\n", "")).diagnostics as D[];
  assert.ok(!quiet.some((d) => d.code === "REUSED_KEY"), "nothing keeps a removed row's id: quiet");
}

// ---------------------------------------------------------------- G13: every case of `A when C; B when D` is said; one namespace for values and types
{
  const src = `${head("G13")}
choice F: A | B | C

type Level = Int from 1 to 3

choice Role: Member | Level

state {
  f: F = A
  n: Int = 0
}

derive {
  x: Int = 1 when @f is @A; 2 when @f is @B
  all = 1 when @f is @A; 2 when @f is @B; 3 when @f is @C
  y = 1 when @n is above 3; 2 when @n is below 1
  z = 1 when @n is above 3, otherwise 2
}

screen {
  text x
  text all
  text y
  text z
}
`;
  const ds = parse(src).diagnostics as D[];
  const l = (t: string) => lineOf(src, t);
  assert.match(at(ds, "TYPE", l("  x: Int = "))[0]?.message ?? "", /say nothing for @C/, "a choice's value left out");
  assert.equal(at(ds, "TYPE", l("  all = ")).length, 0, "every value named: complete");
  assert.match(at(ds, "TYPE", l("  y = "))[0]?.message ?? "", /end with `, otherwise …`/, "conditions that need not cover every case");
  assert.equal(at(ds, "TYPE", l("  z = ")).length, 0);
  assert.match(at(ds, "DUPLICATE", l("choice Role"))[0]?.message ?? "", /`Level` clashes with a type name/, "a choice value named like a refined type");
}

// ---------------------------------------------------------------- G11: `any caller with a role`
{
  const dir = join("tests", ".tmp-heldout4-g11");
  rmSync(dir, { recursive: true, force: true });
  mkdirSync(dir, { recursive: true });
  try {
    const spec = (rule: string, roles = true) => `${head("Desk")}
profile api

layer auth = std.http.apiKey {
  keys = table {
    secret      | owner
    "k-ann-1"   | "Ann"
    "k-zed-2"   | "Zed"
  }
}

choice Role: Agent | Lead

record Grant {
  who: Text
  role: Role
}

state {
  stored grants: List Grant = table {
    who   | role
    "Ann" | Agent
  }
}

access {
${roles ? "  roles = grants\n" : ""}  - ${rule}
}

endpoint me GET "/me" {
  answers 200 Text
  answers 401 Problem
  answers 403 Problem
  answer 200 with the @caller
}

example "a caller with a role, and one without" {
  call me as "Ann"
  see me.status = 200
  call me as "Zed"
  see me.status = 403
}
`;
    const ok = load((writeFileSync(join(dir, "a.intent"), spec("any caller with a role may call @me")), join(dir, "a.intent")), { ignoreLock: true });
    assert.deepEqual(ok.diagnostics.filter((d) => d.level === "error").map((d) => `${d.line}:${d.code} ${d.message}`), [], "`any caller with a role` is a permit");
    assert.deepEqual(ok.app!.access!.rules[0].who, { k: "roles", roles: ["Agent", "Lead"] }, "every role of the grants' choice");
    const none = load((writeFileSync(join(dir, "b.intent"), spec("any caller with a role may call @me", false)), join(dir, "b.intent")), { ignoreLock: true });
    assert.match(none.diagnostics.find((d) => d.code === "ACCESS")?.message ?? "", /reads the grants: say where they are/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

// ---------------------------------------------------------------- K3, K4: where a contract lives; no cascade from a provider with errors
const tmp = join("tests", ".tmp-heldout4");
rmSync(tmp, { recursive: true, force: true });
mkdirSync(tmp, { recursive: true });
try {
  const write = (name: string, text: string) => (writeFileSync(join(tmp, name), text), join(tmp, name));
  const synt = (text: string) => parse(text).diagnostics as D[];
  const implFile = synt(`${head("A")}\nprofile api\nimplements "./chores-contract.intent"\n`);
  assert.match(implFile.find((d) => d.code === "SYNTAX" && d.message.startsWith("`implements`"))?.message ?? "", /`implements` takes a contract's name, not a file: `implements <area>\.<name>`\. A contract lives in `lib\/<area>\/<name>\.intent`/);
  const usesFile = synt(`${head("B")}\nuses "lib/raffle/raffleApi.intent" as raffle\n`);
  assert.match(usesFile.find((d) => d.code === "SYNTAX" && d.message.startsWith("`uses`"))?.message ?? "", /`uses raffle\.raffleApi as <alias>`/, "a path in lib/ names the contract it would be");
  assert.match(synt(`${head("B2")}\nuses raffle.raffleApi\n`).find((d) => d.code === "SYNTAX" && d.message.startsWith("`uses`"))?.message ?? "", /uses raffle\.raffleApi as <alias>/);
  const imported = load(write("imports-contract.intent", `${head("C")}\nimport raffle.raffleApi\nuses raffle.raffleApi as raffle\n\nstate {\n  rows: List Entry = []\n}\n\nscreen {\n  heading "x"\n}\n`), { ignoreLock: true }).diagnostics as D[];
  assert.match(imported.find((d) => d.code === "BAD_BINDING")?.message ?? "", /is a contract, not a bundle: .*`uses raffle\.raffleApi as <alias>`.*drop this `import`/);
  const missing = load(write("missing.intent", `${head("D")}\nuses home.chores as chores\n\nscreen {\n  heading "x"\n}\n`), { ignoreLock: true }).diagnostics as D[];
  assert.match(missing.find((d) => d.code === "UNKNOWN_NAME")?.message ?? "", /a contract lives in `lib\/<area>\/<name>\.intent` and starts with `contract home\.chores`/);
  // K3: a provider with errors: PROVIDER, and no ACCESS about keys that cannot be known.
  write("bad-provider.intent", `${head("BadProvider")}\nimplements raffle.raffleApi\n\nstate {\n  stored entries: List Entry = []\n}\n\nendpoint listEntries {\n  answer 200 with @nothingHere\n}\n`);
  const screen = load(write("screen.intent", `${head("S")}\nuses raffle.raffleApi as raffle {\n  tested with "${tmp}/bad-provider.intent"\n}\n\nscreen {\n  heading "x"\n}\n\nexample "someone else enters" {\n  call raffle.enter as "Bob" with name = "Bob"\n}\n`), { ignoreLock: true }).diagnostics as D[];
  assert.ok(screen.some((d) => d.code === "PROVIDER"), "the provider's errors are said");
  assert.ok(!screen.some((d) => d.code === "ACCESS"), "and nothing about who the provider's keys belong to (K3)");
} finally {
  rmSync(tmp, { recursive: true, force: true });
}

// ---------------------------------------------------------------- converge: the cost column counts the builds an app is tested against
{
  const report = { app: "Raffle", file: "apps/38-raffle.intent", builds: [{ id: "ts-1", ok: true, attempts: 1, costUsd: 1.5, seconds: 1 }], agreement: {}, matchMajority: {}, codeSimilarity: {}, divergences: [], violations: {}, traces: 0, depsCostUsd: 2.25 };
  const md = renderReport([report as never], { builds: 1, targets: ["ts"], traces: 1, length: 1, tag: "t", out: "", styled: false, kit: false, concurrency: 1 } as never);
  assert.match(md, /\| \$3\.75 \|/, "a provider's and a layer's twin builds are in the app's cost");
}

// The held-out round 4 specs themselves: every file checks clean in this repository (their contracts live in lib/).
for (const f of ["chores-api", "chores", "clinic-api", "clinic", "todo-api", "todo"]) {
  const errs = load(`apps/held-out-4/${f}.intent`, { ignoreLock: false }).diagnostics.filter((d) => d.level === "error" || ["LANGUAGE", "SPELLING", "LOCK"].includes(d.code));
  assert.deepEqual(errs.map((d) => `${d.line}:${d.code}`), [], `apps/held-out-4/${f}.intent checks clean`);
}
void readFileSync;

console.log("ok held-out round 4: K1–K9, R1, G3 (a typed order), G4 (for each in an endpoint), G6 (time in words), G14 (a key never reused), where a contract lives, the converge cost");
