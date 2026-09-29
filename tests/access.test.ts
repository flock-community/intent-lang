// Access control (v70), without an LLM. The decision (runtime/ts/access.ts) on its own: default deny,
// a forbid wins, a condition that cannot be decided refuses, a missing row has nothing to protect,
// an anonymous caller is nobody, events per listener. Then the harness around a stand-in app module
// for apps/api/desk-api.intent (a real build's module is the model's; the layers are stand-ins too):
// every example passes, the audit has its fields and no secret, grants are read per request and
// before a remembered answer is replayed, a planted pipeline that runs a refused request is caught by
// the built-in "a refusal changes nothing", random sessions call as each caller, events reach only the
// streams whose caller may hear them, and rule mutation finds no surviving mutant of the call rules.
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { decide, anyoneMay, actingAs, type Plan } from "../runtime/ts/access.ts";
import { load } from "../compiler/load.ts";
import { parseSyntax } from "../compiler/parse.ts";
import { printApp } from "../compiler/print.ts";
import { accessPlan, mutants, ruleText } from "../compiler/access.ts";
import { apiTraces, callText, runApiJobs, scaffoldApi } from "../compiler/api.ts";
import { scaffoldLayer } from "../compiler/layer.ts";
import { targetModule } from "../compiler/targets/index.ts";

// ---------------------------------------------------------------- the decision
{
  const plan: Plan = {
    source: "t.intent:1",
    auth: "auth",
    roles: { list: "grants", who: "who", role: "role" },
    rows: { solve: { Ticket: { param: "id", list: "tickets", key: "id" } }, note: { Ticket: { param: "id", list: "tickets", key: "id" } } },
    rules: [
      { source: "t:2", text: "anyone may call @health", effect: "permit", who: { k: "anyone" }, on: "call", targets: ["health"], conds: [] },
      { source: "t:3", text: "an @Agent may call @solve when …", effect: "permit", who: { k: "roles", roles: ["Agent"] }, on: "call", targets: ["solve"], conds: [{ k: "caller", from: "row", record: "Ticket", path: [{ field: "assignee" }], in: false, not: false }], message: "Only the assignee" },
      { source: "t:4", text: "a @Lead may call @solve", effect: "permit", who: { k: "roles", roles: ["Lead"] }, on: "call", targets: ["solve", "note"], conds: [] },
      { source: "t:5", text: "no one may call @solve when that ticket is @Archived", effect: "forbid", who: { k: "all" }, on: "call", targets: ["solve"], conds: [{ k: "value", record: "Ticket", field: "status", value: "Archived", not: false }], message: "Archived tickets stay closed" },
      // Through a reference: the project's members (a project that is gone cannot be decided).
      { source: "t:6", text: "an @Agent may call @note when the @caller is in that ticket's @project's @members", effect: "permit", who: { k: "roles", roles: ["Agent"] }, on: "call", targets: ["note"], conds: [{ k: "caller", from: "row", record: "Ticket", path: [{ field: "project", ref: { list: "projects", key: "id" } }, { field: "members" }], in: true, not: false }] },
      { source: "t:7", text: "no one may call @note when that ticket's @project's @owner is not the @caller", effect: "forbid", who: { k: "all" }, on: "call", targets: ["note"], conds: [{ k: "caller", from: "row", record: "Ticket", path: [{ field: "project", ref: { list: "projects", key: "id" } }, { field: "owner" }], in: false, not: true }] },
      { source: "t:8", text: "a @Clerk may call @pay when @amount is at most @limit", effect: "permit", who: { k: "roles", roles: ["Clerk"] }, on: "call", targets: ["pay"], conds: [{ k: "param", param: "amount", op: "le", value: { state: "limit" } }] },
      { source: "t:9", text: "an @Agent may hear @moved when its body's @assignee is the @caller", effect: "permit", who: { k: "roles", roles: ["Agent"] }, on: "hear", targets: ["moved"], conds: [{ k: "caller", from: "body", path: [{ field: "assignee" }], in: false, not: false }] },
    ],
  };
  const data = {
    grants: [{ who: "Ann", role: "Agent" }, { who: "Sam", role: "Agent" }, { who: "Lin", role: "Lead" }, { who: "Cy", role: "Clerk" }],
    tickets: [{ id: 1, assignee: "Ann", status: "Open", project: 10 }, { id: 2, assignee: "Sam", status: "Archived", project: 11 }, { id: 3, assignee: "", status: "Open", project: 99 }],
    projects: [{ id: 10, owner: "Ann", members: ["Ann", "Sam"] }, { id: 11, owner: "Lin", members: ["Lin"] }],
    limit: 500,
  };
  const call = (endpoint: string, caller: string, request: Record<string, unknown> = {}, d: unknown = data) => decide(plan, { kind: "call", endpoint, caller, request, data: d });
  // Permit only; the condition's message when a covering permit does not hold.
  assert.deepEqual(call("solve", "Ann", { id: 1 }), { allowed: true, rules: ["t:3"] });
  assert.deepEqual(call("solve", "Sam", { id: 1 }), { allowed: false, status: 403, message: "Only the assignee", rules: ["t:3"] });
  // No rule: default deny, "Not allowed", no determining rule (a key without a role).
  assert.deepEqual(call("solve", "Eve", { id: 1 }), { allowed: false, status: 403, message: "Not allowed", rules: [] });
  assert.deepEqual(call("delete", "Lin", {}), { allowed: false, status: 403, message: "Not allowed", rules: [] }, "an endpoint no rule names is refused, even to a lead");
  // Anonymous: 401, and an anonymous caller equals nothing (a blank assignee is not "the caller").
  assert.equal(call("solve", "", { id: 3 }).status, 401);
  assert.equal(call("health", "").allowed, true);
  // A forbid wins over a permit.
  assert.deepEqual(call("solve", "Lin", { id: 2 }), { allowed: false, status: 403, message: "Archived tickets stay closed", rules: ["t:5"], forbid: true });
  assert.deepEqual(call("solve", "Lin", { id: 1 }), { allowed: true, rules: ["t:4"] });
  // The request's own row is not there: nothing to protect; the role still applies.
  assert.equal(call("solve", "Sam", { id: 42 }).allowed, true, "a missing row: the endpoint answers 404 itself");
  assert.equal(call("solve", "Eve", { id: 42 }).allowed, false, "but only for a caller the role part covers");
  assert.deepEqual(call("solve", "Sam", { id: 42 }).missing, [{ list: "tickets", key: "id", value: 42 }], "the decision says it relied on the missing row");
  assert.equal(call("solve", "Lin", { id: 42 }).missing, undefined, "a permit that holds without it relies on nothing");
  // Through a reference: decided when the project is there; refused when it is gone (fail securely).
  assert.equal(call("note", "Ann", { id: 1 }).allowed, true);
  assert.equal(call("note", "Sam", { id: 1 }).allowed, false, "a member, but the forbid holds: not the project's owner");
  const gone = call("note", "Lin", { id: 3 });
  assert.equal(gone.allowed, false, "the project is gone: the forbid cannot be decided, so it holds, whatever permits (Lin is a lead)");
  assert.deepEqual(gone.rules, ["t:7"]);
  // A param against a state field, read per request.
  assert.equal(call("pay", "Cy", { amount: 500 }).allowed, true);
  assert.equal(call("pay", "Cy", { amount: 501 }).allowed, false);
  assert.equal(call("pay", "Cy", { amount: null }).allowed, false, "a missing param cannot be decided: the permit does not hold");
  assert.equal(call("pay", "Cy", { amount: 100 }, { ...data, limit: 50 }).allowed, false, "the limit is read on every request");
  // The data cannot be read (no rows at all): the forbid about the row cannot be decided and holds.
  assert.deepEqual(call("solve", "Lin", { id: 1 }, {}), { allowed: false, status: 403, message: "Archived tickets stay closed", rules: ["t:5"], forbid: true }, "no data: fail closed");
  // Grants are data, read on every request: a revoked role takes effect at once.
  assert.equal(call("solve", "Ann", { id: 1 }, { ...data, grants: data.grants.filter((g) => g.who !== "Ann") }).allowed, false);
  // Events, per listener.
  const hear = (caller: string, body: unknown) => decide(plan, { kind: "hear", event: "moved", caller, body, data }).allowed;
  assert.equal(hear("Ann", { assignee: "Ann" }), true);
  assert.equal(hear("Sam", { assignee: "Ann" }), false);
  assert.equal(hear("", { assignee: "" }), false, "an anonymous stream hears nothing a rule does not open to anyone");
  // What needs no key: the route's shape.
  const eps = [{ name: "health", method: "GET", path: "/health" }, { name: "solve", method: "POST", path: "/tickets/{id}/solve" }];
  assert.equal(anyoneMay(plan, eps, "GET", "/health", false), true);
  assert.equal(anyoneMay(plan, eps, "POST", "/tickets/1/solve", false), false);
  assert.equal(anyoneMay(plan, eps, "POST", "/health", false), false, "the method is part of it");
  assert.equal(anyoneMay(plan, eps, "GET", "/events", true), false, "no event is anyone's: the stream needs a key");
  // Acting as a caller: the key layer's header with the key that is theirs.
  assert.deepEqual(actingAs({ header: "x-api-key", secret: "secret", owner: "owner", keys: [{ secret: "k-1", owner: "Ann" }] }, "Ann"), { "x-api-key": "k-1" });
  assert.equal(actingAs({ header: "x-api-key", secret: "secret", owner: "owner", keys: [] }, "Zed"), undefined);
}

// ---------------------------------------------------------------- v73: nothing in a condition is undecided
// A value that is nothing (a `T or nothing` field, an absent param, a gone row, a request without a
// key) makes a condition undecided, not false: a permit does not hold and a forbid does. The one place
// Kotlin's `==` on nothing does not apply: `is not the @caller` on an unassigned ticket is not true.
{
  const assignee = (not: boolean) => [{ k: "caller" as const, from: "row" as const, record: "Ticket", path: [{ field: "assignee" }], in: false, not }];
  const plan: Plan = {
    source: "t.intent:1",
    auth: "auth",
    rows: { take: { Ticket: { param: "id", list: "tickets", key: "id" } }, solve: { Ticket: { param: "id", list: "tickets", key: "id" } }, drop: { Ticket: { param: "id", list: "tickets", key: "id" } }, tag: { Ticket: { param: "id", list: "tickets", key: "id" } } },
    rules: [
      { source: "t:2", text: "any caller may call @take when that ticket's @assignee is not the @caller", effect: "permit", who: { k: "caller" }, on: "call", targets: ["take"], conds: assignee(true), message: "Already yours" },
      { source: "t:3", text: "any caller may call @solve when that ticket's @assignee is the @caller", effect: "permit", who: { k: "caller" }, on: "call", targets: ["solve"], conds: assignee(false) },
      { source: "t:4", text: "any caller may call @drop", effect: "permit", who: { k: "caller" }, on: "call", targets: ["drop"], conds: [] },
      { source: "t:5", text: "no one may call @drop when that ticket's @assignee is not the @caller", effect: "forbid", who: { k: "all" }, on: "call", targets: ["drop"], conds: assignee(true), message: "Not yours" },
      { source: "t:6", text: "any caller may call @tag when that ticket's @status is not @Archived", effect: "permit", who: { k: "caller" }, on: "call", targets: ["tag"], conds: [{ k: "value", record: "Ticket", field: "status", value: "Archived", not: true }] },
    ],
  };
  const data = { tickets: [{ id: 1, assignee: "Ann", status: "Open" }, { id: 2, assignee: null, status: null }, { id: 3, status: "Open" }] };
  const call = (endpoint: string, caller: string, id: number) => decide(plan, { kind: "call", endpoint, caller, request: { id }, data });
  assert.equal(call("take", "Sam", 1).allowed, true, "assigned to someone else: `is not the @caller` holds");
  assert.equal(call("take", "Ann", 1).allowed, false);
  assert.deepEqual(call("take", "Sam", 2), { allowed: false, status: 403, message: "Already yours", rules: ["t:2"] }, "an unassigned ticket (null): `is not the @caller` is undecided, the permit does not hold");
  assert.equal(call("take", "Sam", 3).allowed, false, "a field left out is nothing too");
  assert.equal(call("solve", "Sam", 2).allowed, false, "`is the @caller` on nothing: undecided, refused");
  assert.equal(call("drop", "Ann", 1).allowed, true, "the forbid does not hold for the assignee");
  assert.deepEqual(call("drop", "Sam", 2), { allowed: false, status: 403, message: "Not yours", rules: ["t:5"], forbid: true }, "a forbid on nothing is undecided: it holds");
  assert.equal(call("tag", "Sam", 1).allowed, true);
  assert.equal(call("tag", "Sam", 2).allowed, false, "a choice field that is nothing: `is not @Archived` is undecided, refused");
  // The missing-root exception stays: the request's own row is not there, the endpoint answers 404.
  assert.equal(call("take", "Sam", 42).allowed, true, "a missing row: nothing to protect");
  assert.equal(call("drop", "Sam", 42).allowed, true, "a forbid about a missing row does not refuse");
  // A request without a key: no caller, undecided (and 401 for want of a permit).
  assert.equal(call("take", "", 1).status, 401);
}

// ---------------------------------------------------------------- v73: the checker: orders on nothing, the spelling of values and `anyone`
{
  const dir = mkdtempSync(join(tmpdir(), "access-v73-"));
  const spec = (access: string, extra = "") => `app A {\n  "t"\n}\nprofile api\n\nrecord Ticket {\n  id: Int\n  assignee: Text or nothing = nothing\n  status: Status = Open\n}\nchoice Status: Open | Archived\n\nstate {\n  tickets: List Ticket = []\n  limit: Int or nothing = nothing\n}\n\nlayer auth = std.http.apiKey {\n  keys = table {\n    secret | owner\n    "k-ann" | "Ann"\n  }\n}\n${extra}\naccess {\n${access}\n}\n\nendpoint health GET "/health" {\n  answer 200 with "ok"\n}\n\nendpoint take POST "/tickets/{id}/take" {\n  path id: ref Ticket\n  query amount: Int or nothing\n  answer 200 with "ok"\n}\n`;
  const check = (access: string) => {
    const f = join(dir, `a${Math.random().toString(36).slice(2)}.intent`);
    writeFileSync(f, spec(access));
    return load(f, { ignoreLock: true }).diagnostics;
  };
  try {
    const order = check("  - anyone, without a key, may call @health\n  - any caller may call @take when @amount is at most 100");
    assert.ok(order.some((d) => d.code === "NOTHING" && /amount/.test(d.message)), "an order on a `T or nothing` param is NOTHING");
    const orderState = check("  - anyone, without a key, may call @health\n  - any caller may call @take when @id is at most @limit");
    assert.ok(orderState.some((d) => d.code === "NOTHING" && /limit/.test(d.message)), "an order on a `T or nothing` state field is NOTHING");
    const eq = check("  - anyone, without a key, may call @health\n  - any caller may call @take when that ticket's @assignee is not the @caller and that ticket's @status is not @Archived");
    assert.deepEqual(eq.filter((d) => d.level === "error").map((d) => `${d.code}: ${d.message}`), [], "`is not the @caller` on a `T or nothing` and the field form check clean");
    assert.ok(!eq.some((d) => d.code === "SPELLING"));
    const old = check("  - anyone may call @health\n  - any caller may call @take when that ticket is not @Archived");
    assert.deepEqual(old.filter((d) => d.level === "error").map((d) => d.code), [], "the old spellings still read");
    const sp = old.filter((d) => d.code === "SPELLING").map((d) => d.message);
    assert.ok(sp.some((m) => m.startsWith("`anyone may call` is written `anyone, without a key, may call`") && /`intent fix` rewrites it\)$/.test(m)), sp.join("\n"));
    assert.ok(sp.some((m) => m.startsWith("`that ticket is not @Archived` is written `that ticket's @status is not @Archived`")), sp.join("\n"));
    const { fixText } = await import("../compiler/fix.ts");
    const fixed = fixText(spec("  - anyone may call @health\n  - any caller may call @take when that ticket is not @Archived"));
    assert.match(fixed.out, /- anyone, without a key, may call @health\n/);
    assert.match(fixed.out, /when that ticket's @status is not @Archived\n/);
    assert.equal(fixText(fixed.out).out, fixed.out, "fix is idempotent");
    const wrong = check("  - anyone, without a key, may call @health\n  - any caller may call @take when that ticket's @assignee is @Archived");
    assert.ok(wrong.some((d) => d.code === "TYPE" && /not a choice/.test(d.message)), "the field form needs a choice field");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

// ---------------------------------------------------------------- the canonical print reads back the same block
{
  const app = load("apps/api/desk-api.intent", { ignoreLock: true }).app!;
  const back = parseSyntax(printApp(app)).app;
  const strip = (x: unknown) => JSON.parse(JSON.stringify(x, (k, v) => (k === "line" || k === "record" ? undefined : v)));
  assert.deepEqual(strip(back.access), strip(app.access), "the access block prints and reads back the same");
  assert.equal(ruleText(app.access!.rules[2]), 'an @Agent may call @solveTicket when that ticket\'s @assignee is the @caller: "Only the assignee can solve this ticket"');
}

// ---------------------------------------------------------------- a refinement's rules are checked, and a plan never drops a condition
{
  // The child adds rules to the base's block (which keeps the base's line): each is checked on its own line.
  const proj = mkdtempSync(join(tmpdir(), "access-extends-"));
  try {
    const { mkdirSync, copyFileSync } = await import("node:fs");
    writeFileSync(join(proj, "intent.project"), "");
    mkdirSync(join(proj, "lib/base"), { recursive: true });
    mkdirSync(join(proj, "lib/expenses"), { recursive: true });
    copyFileSync("apps/api/expenses-api.intent", join(proj, "lib/base/expensesApp.intent"));
    for (const f of ["expenses.intent", "expensesApi.intent"]) copyFileSync(join("lib/expenses", f), join(proj, "lib/expenses", f));
    const child = (rules: string) => `app MyExpenses {\n  "Our expenses api."\n}\nlanguage 1\nextends base.expensesApp\n\naccess {\n${rules}\n}\n`;
    writeFileSync(join(proj, "child.intent"), child('  - any caller may call @approveExpense when that expence\'s @submitter is the @caller\n  - an @Employee may call @rejectExpense when that expense\'s @submiter is the @caller'));
    // The project root is where a process starts: load the child from there.
    const { execFileSync } = await import("node:child_process");
    const here = new URL("..", import.meta.url).pathname;
    const run = () => JSON.parse(execFileSync(process.execPath, ["--input-type=module", "-e", `
      import { load } from ${JSON.stringify(here + "compiler/load.ts")};
      import { accessPlan } from ${JSON.stringify(here + "compiler/access.ts")};
      const l = load("child.intent", { ignoreLock: true });
      let plan, thrown;
      try { plan = l.app && accessPlan(l.app); } catch (e) { thrown = e.message; }
      console.log(JSON.stringify({ errs: l.diagnostics.filter((d) => d.level === "error" && d.file === l.sources[0].file).map((d) => d.line + ":" + d.code), all: l.diagnostics.filter((d) => d.level === "error").length, last: plan?.rules.at(-1), thrown }));
    `], { cwd: proj, encoding: "utf8" }));
    const bad = run();
    assert.deepEqual(bad.errs, ["8:UNKNOWN_NAME", "9:UNKNOWN_NAME"], "a refinement's misspelt conditions are errors on their own lines");
    writeFileSync(join(proj, "child.intent"), child("  - an @Employee may call @rejectExpense when that expense's @submitter is the @caller"));
    const good = run();
    assert.equal(good.all, 0);
    assert.deepEqual(good.last.conds, [{ k: "caller", from: "row", record: "Expense", path: [{ field: "submitter" }], in: false, not: false }]);
  } finally {
    rmSync(proj, { recursive: true, force: true });
  }
  // A `hear` rule reading the payload is compiled per event: each event its own payload record.
  const desk = load("apps/api/desk-api.intent", { ignoreLock: true }).app!;
  const { compileRule } = await import("../compiler/access.ts");
  const hear = desk.access!.rules.find((r) => r.on === "hear" && r.conds.length)!;
  assert.deepEqual((compileRule(desk, hear) as { groups: unknown[] }).groups, [{ targets: ["ticketAssigned", "ticketSolved"], conds: [{ k: "caller", from: "body", path: [{ field: "assignee" }], in: false, not: false }] }]);
  // One of its events now carries a Comment (no @assignee): not read as the other event's Ticket.
  const other = { ...desk, events: desk.events!.map((e) => (e.name === "ticketSolved" ? { ...e, type: { k: "Named", name: "Comment" } as const } : e)) };
  const c = compileRule(other, hear);
  assert.ok("problems" in c && /event ticketSolved/.test(c.problems[0].message), `the second event's payload is checked on its own: ${JSON.stringify(c)}`);
  assert.throws(() => accessPlan(other), /cannot be enforced/);
}

// ---------------------------------------------------------------- the harness, around stand-ins
const STAND_IN_KEY = `import type { Before, Config, HttpRequest, HttpResponse } from "./spec.ts";
import { header, refuse, sameSecret } from "./http.ts";

export function before(req: HttpRequest, config: Config): Before {
  if (req.method === "OPTIONS") return { pass: { caller: "" } };
  const matches = (e: string) => {
    const m = e.match(/^([A-Z]+) (.*)$/);
    const path = m ? m[2] : e;
    if (m && m[1] !== req.method) return false;
    return path.endsWith("/*") ? req.path.startsWith(path.slice(0, -1)) : req.path === path;
  };
  if (config.public.some(matches)) return { pass: { caller: "" } };
  const v = header(req, config.keyHeader);
  if (v === undefined || v.trim() === "") return { answer: refuse(401, "Missing API key", { "www-authenticate": "ApiKey" }) };
  const k = config.keys.find((x) => sameSecret(v, x.secret));
  return k ? { pass: { caller: k.owner } } : { answer: refuse(401, "Unknown API key", { "www-authenticate": "ApiKey" }) };
}

export function after(req: HttpRequest, res: HttpResponse): HttpResponse {
  return res;
}
`;
const STAND_IN_SECURE = `import type { Before, HttpRequest, HttpResponse } from "./spec.ts";
import { withHeaders } from "./http.ts";

export function before(): Before {
  return { pass: {} };
}

export function after(req: HttpRequest, res: HttpResponse): HttpResponse {
  return withHeaders(res, { "x-content-type-options": "nosniff", "x-frame-options": "DENY", "referrer-policy": "no-referrer", "cache-control": "no-store", "content-security-policy": "default-src 'none'; frame-ancestors 'none'" });
}
`;
const STAND_IN_CORS = `import type { Before, Config, HttpRequest, HttpResponse } from "./spec.ts";
import { header, respond, withHeaders } from "./http.ts";

export function before(req: HttpRequest, config: Config): Before {
  const origin = header(req, "origin");
  if (req.method === "OPTIONS" && origin && config.origins.includes(origin)) return { answer: respond(204, null, { "access-control-allow-origin": origin, "access-control-allow-methods": "GET, POST, PUT, PATCH, DELETE", "access-control-allow-headers": config.headers.join(", "), vary: "origin" }) };
  return { pass: {} };
}

export function after(req: HttpRequest, res: HttpResponse, config: Config): HttpResponse {
  const origin = header(req, "origin");
  return origin && config.origins.includes(origin) ? withHeaders(res, { "access-control-allow-origin": origin, vary: "origin" }) : res;
}
`;
const STAND_IN_DESK = `import type { Comment, Data, Grant, Handlers, Stored, Ticket } from "./spec.ts";
import { grantsInitial, ticketsInitial } from "./spec.ts";
import { answer, fail } from "./api.ts";

export type Model = { grants: Grant[]; tickets: Ticket[]; comments: Comment[] };

export function init(): Model {
  return { grants: grantsInitial, tickets: ticketsInitial, comments: [] };
}

export const data = (m: Model): Data => ({ grants: m.grants, tickets: m.tickets, comments: m.comments });
export const restore = (saved: Stored, m: Model): Model => ({ ...m, grants: saved.grants });

export const handlers: Handlers<Model> = {
  health: (req, model) => ({ model, response: answer(200, { status: "ok" }) }),
  myTickets: (req, model) => ({ model, response: answer(200, model.tickets.filter((t) => t.assignee === req.caller).sort((a, b) => b.id - a.id)) }),
  takeTicket: (req, model) => {
    const t = model.tickets.find((x) => x.id === req.id);
    if (!t) return { model, response: fail(404, "No such ticket") };
    if (t.assignee !== null && t.assignee !== req.caller) return { model, response: fail(409, \`Already taken by \${t.assignee}\`) };
    const next = { ...t, assignee: req.caller };
    return { model: { ...model, tickets: model.tickets.map((x) => (x.id === t.id ? next : x)) }, response: answer(200, next), publish: [{ event: "ticketAssigned", body: next }] };
  },
  solveTicket: (req, model) => {
    const t = model.tickets.find((x) => x.id === req.id);
    if (!t) return { model, response: fail(404, "No such ticket") };
    if (t.status === "Solved") return { model, response: fail(409, "Already solved") };
    const next: Ticket = { ...t, status: "Solved" };
    return { model: { ...model, tickets: model.tickets.map((x) => (x.id === t.id ? next : x)) }, response: answer(200, next), publish: [{ event: "ticketSolved", body: next }] };
  },
  addComment: (req, model) => {
    if (!model.tickets.some((x) => x.id === req.id)) return { model, response: fail(404, "No such ticket") };
    if (req.text.trim() === "") return { model, response: fail(400, "Comment is empty") };
    const c = { ticket: req.id, author: req.caller, body: req.text.trim() };
    return { model: { ...model, comments: [...model.comments, c] }, response: answer(201, c) };
  },
};
`;

const root = mkdtempSync(join(tmpdir(), "access-"));
try {
  const desk = load("apps/api/desk-api.intent", { ignoreLock: true }).app!;
  const layerDirs: Record<string, string> = {};
  for (const l of desk.layers!) {
    const d = join(root, "layer-" + l.alias);
    scaffoldLayer(l.spec!, d);
    writeFileSync(join(d, "layer.ts"), l.layer === "std.http.apiKey" ? STAND_IN_KEY : l.layer === "std.http.cors" ? STAND_IN_CORS : STAND_IN_SECURE);
    layerDirs[l.alias] = d;
  }
  const dir = join(root, "desk");
  scaffoldApi(desk, dir, layerDirs);
  writeFileSync(join(dir, "app.ts"), STAND_IN_DESK);
  writeFileSync(join(dir, "endpoints.json"), JSON.stringify((desk.endpoints ?? []).map((e) => ({ name: e.name, method: e.method, path: e.path, params: e.params.map((p) => ({ in: p.in, name: p.name })) }))));
  const { actsAsOf } = await import("../compiler/access.ts");
  writeFileSync(join(dir, "acting.json"), JSON.stringify(actsAsOf(desk)));
  writeFileSync(join(dir, "access.json"), JSON.stringify(accessPlan(desk)));
  writeFileSync(join(dir, "stored.json"), JSON.stringify([{ field: "grants", line: 1 }]));
  assert.ok(!readFileSync(join(dir, "accessPlan.ts"), "utf8").includes("k-ann-7f3a"), "the server's plan holds no key (how a test acts as a caller is the drivers')");
  const svc = targetModule("ts").service!;
  const problems = await svc.compileApi(dir);
  assert.equal(problems, "", `the stand-in and the harness compile: ${problems}`);

  // Every example passes, through the access decision.
  const results = (await runApiJobs(dir, desk.examples.map((example) => ({ kind: "api-example" as const, example, always: desk.always })))) as { name: string; pass: boolean; failure?: { message: string } }[];
  for (const r of results) assert.ok(r.pass, `example "${r.name}": ${r.failure?.message}`);

  // The test client: the audit, events per listener, grants per request, the order with a remembered answer.
  const mod = await import(pathToFileURL(join(dir, "test.mjs")).href + `?t=${Date.now()}`);
  const c = mod.start();
  const as = (who: string) => ({ "x-api-key": { Ann: "k-ann-7f3a", Sam: "k-sam-91bc", Lin: "k-lin-44d0", Eve: "k-eve-0b1e" }[who]! });
  const r1 = c.send("POST", "/tickets/4/take", {}, undefined, { ...as("Sam"), "idempotency-key": "k1" });
  assert.equal(r1.status, 200);
  assert.deepEqual(r1.access, { decision: "allowed", rules: ["apps/api/desk-api.intent:55"] });
  const r2 = c.send("POST", "/tickets/4/solve", {}, undefined, as("Ann"));
  assert.equal(r2.status, 403);
  assert.equal(r2.source, "apps/api/desk-api.intent:56 (access)", "x-intent-source names the determining rule");
  const r3 = c.send("GET", "/tickets/mine", {}, undefined, as("Eve"));
  assert.equal(r3.status, 403);
  assert.match(r3.source, /^no rule permits this: access block at apps\/api\/desk-api\.intent:52/);
  c.send("GET", "/tickets/mine", {}, undefined, as("Ann")); // a permitted read: not audited
  const audit = c.audit();
  assert.deepEqual(audit.map((e: any) => [e.caller, e.endpoint, e.decision, e.status]), [["Sam", "takeTicket", "allowed", 200], ["Ann", "solveTicket", "refused", 403], ["Eve", "myTickets", "refused", 403]]);
  assert.deepEqual(Object.keys(audit[0]).sort(), ["at", "caller", "decision", "endpoint", "key", "rules", "status"]);
  assert.equal(audit[0].key, "k1");
  assert.ok(!JSON.stringify(audit).includes("k-sam-91bc") && !JSON.stringify(audit).includes("k-ann-7f3a"), "no key's secret in the audit");
  // Events per listener: Sam's stream hears Sam's ticket, Ann's does not, a lead's hears every one, none without a key.
  const ev = r1.events[0];
  assert.equal(c.hear(as("Sam"), {}, ev), true);
  assert.equal(c.hear(as("Ann"), {}, ev), false);
  assert.equal(c.hear(as("Lin"), {}, ev), true);
  assert.equal(c.hear({}, {}, ev), false, "a stream without a key does not open: no event is anyone's");
  assert.equal(c.hear(as("Eve"), {}, ev), false, "a key without a grant opens the stream and hears nothing");
  // Grants are read on every request: Sam's role is revoked (a restart with other stored grants) and
  // his remembered request is checked again before it is replayed: refused, not replayed.
  c.restart({ grants: [{ who: "Ann", role: "Agent" }, { who: "Lin", role: "Lead" }] });
  const replay = c.send("POST", "/tickets/4/take", {}, undefined, { ...as("Sam"), "idempotency-key": "k1" });
  assert.equal(replay.status, 403, "a revoked caller does not get the remembered answer back");
  assert.notEqual(replay.headers["idempotent-replayed"], "true");
  assert.equal(c.send("GET", "/tickets/mine", {}, undefined, as("Sam")).status, 403, "and is refused from the next request on");
  const ann = c.send("POST", "/tickets/4/take", {}, undefined, { ...as("Ann"), "idempotency-key": "k1" });
  assert.deepEqual([ann.status, ann.headers["idempotent-replayed"]], [200, undefined], "the same key from another caller is another request (tickets are not stored: after the restart ticket 4 is free again)");
  // Anonymous: the key layer's own 401 where no rule opens the endpoint; health answers, with or without a key, even a wrong one.
  assert.deepEqual([c.send("GET", "/tickets/mine", {}, undefined, {}).status, c.send("GET", "/tickets/mine", {}, undefined, {}).body.error], [401, "Missing API key"]);
  assert.equal(c.send("GET", "/health", {}, undefined, {}).status, 200);
  assert.equal(c.send("GET", "/health", {}, undefined, { "x-api-key": "nonsense" }).status, 200);
  // The key layer's refusals are audited too (anonymous, the layer's line), never with the key sent.
  assert.equal(c.send("POST", "/tickets/4/take", {}, undefined, { "x-api-key": "k-guess-secret" }).status, 401);
  const refusedByKey = c.audit().slice(-2);
  assert.deepEqual(refusedByKey.map((e: any) => [e.caller, e.endpoint, e.decision, e.status]), [["", "myTickets", "refused", 401], ["", "takeTicket", "refused", 401]]);
  assert.match(refusedByKey[1].rules[0], /desk-api\.intent:\d+$/, "the key layer's `use` line");
  assert.ok(!JSON.stringify(c.audit()).includes("k-guess-secret"), "no key in the audit");

  // Random sessions act as each caller: the examples' callers, a key without a grant, and anonymously.
  const traces = apiTraces(desk, 12, 20, 7);
  const texts = traces.flat().map(callText);
  for (const who of ['as "Ann"', 'as "Sam"', 'as "Lin"', 'as "Eve"']) assert.ok(texts.some((t) => t.includes(who)), `random sessions call ${who}`);
  const runs = (await runApiJobs(dir, traces.map((calls) => ({ kind: "api-trace" as const, calls, always: desk.always })))) as { steps: string[]; violation?: { message: string }; error?: string }[];
  assert.ok(runs.every((r) => !r.error && !r.violation), `the sessions hold every rule: ${runs.map((r) => r.error ?? r.violation?.message).filter(Boolean).join("; ")}`);
  assert.ok(runs.some((r) => r.steps.some((s) => JSON.parse(s).audit?.some((e: any) => e.decision === "refused"))), "and meet refusals, which the sessions compare between builds");

  // A planted pipeline that runs the endpoint before refusing: "a refusal changes nothing" catches it.
  const planted = join(root, "planted");
  scaffoldApi(desk, planted, layerDirs);
  writeFileSync(join(planted, "app.ts"), STAND_IN_DESK);
  for (const f of ["endpoints.json", "acting.json", "access.json", "stored.json"]) writeFileSync(join(planted, f), readFileSync(join(dir, f)));
  const pipe = readFileSync(join(planted, "pipeline.ts"), "utf8");
  const bug = pipe.replace("      else if (decision && !decision.allowed) {", "      else if (decision && !decision.allowed) {\n        model = (App.handlers as any)[r.request.endpoint as string]({ ...r.request, ...provided }, model).model;");
  assert.notEqual(bug, pipe, "the bug is planted");
  writeFileSync(join(planted, "pipeline.ts"), bug);
  assert.equal(await svc.compileApi(planted), "");
  const caught = (await runApiJobs(planted, desk.examples.map((example) => ({ kind: "api-example" as const, example })))) as { name: string; pass: boolean; failure?: { message: string } }[];
  const refusal = caught.find((r) => r.name === "a refusal changes nothing");
  assert.ok(refusal && !refusal.pass && /a refused request changed the data/.test(refusal.failure!.message), `the planted bug is caught: ${refusal?.failure?.message}`);
  // A permit that held only because the row was missing, and a handler that then succeeds on that row
  // (here: it makes the ticket): refused, and nothing it did is kept.
  const upsert = join(root, "upsert");
  scaffoldApi(desk, upsert, layerDirs);
  writeFileSync(join(upsert, "app.ts"), STAND_IN_DESK.replace('if (!t) return { model, response: fail(404, "No such ticket") };\n    if (t.status === "Solved")', 'if (!t) { const made = { id: req.id, subject: "made", customer: "", priority: "Low", status: "Solved", assignee: req.caller } as Ticket; return { model: { ...model, tickets: [...model.tickets, made] }, response: answer(200, made) }; }\n    if (t.status === "Solved")'));
  for (const f of ["endpoints.json", "acting.json", "access.json", "stored.json"]) writeFileSync(join(upsert, f), readFileSync(join(dir, f)));
  assert.equal(await svc.compileApi(upsert), "");
  const um = await import(pathToFileURL(join(upsert, "test.mjs")).href + `?t=${Date.now()}`);
  const uc = um.start();
  const made = uc.send("POST", "/tickets/42/solve", {}, undefined, as("Sam"));
  assert.equal(made.status, 403, "a success on a row that was not there when access was decided is refused");
  assert.ok(!uc.data().tickets.some((t: { id: number }) => t.id === 42), "and the row it made is not kept");
  assert.equal(uc.audit().at(-1).decision, "refused");
  assert.equal(uc.send("POST", "/tickets/43/solve", {}, undefined, as("Lin")).status, 200, "a lead's permit holds without the row: the endpoint decides");

  // A raw `request` step is checked like a call: the same planted bug is caught through it too.
  const raw = { name: "a raw request that is refused", line: 1, steps: [{ do: "request" as const, method: "POST", path: "/tickets/1/solve", args: [{ in: "header" as const, name: "x-api-key", value: { k: "text" as const, v: "k-ann-7f3a" } }], line: 2 }] };
  const [viaRequest] = (await runApiJobs(planted, [{ kind: "api-example" as const, example: raw as any }])) as { pass: boolean; failure?: { message: string } }[];
  assert.ok(!viaRequest.pass && /a refused request changed the data/.test(viaRequest.failure!.message), `a raw request goes through the refusal check: ${viaRequest.failure?.message}`);
  const [clean] = (await runApiJobs(dir, [{ kind: "api-example" as const, example: raw as any }])) as { pass: boolean; failure?: { message: string } }[];
  assert.ok(clean.pass, `and passes on the real pipeline: ${clean.failure?.message}`);

  // Rule mutation (intent mutate): every mutant of a call rule fails some example; the hear rules are
  // proven by a screen's examples (the desk's screen, in a real build), not by the api's own.
  const { mutateAccess } = await import("../compiler/mutate.ts");
  const mutated = await mutateAccess(desk, dir);
  assert.equal(mutated.length, mutants(accessPlan(desk)!).length);
  const survivors = mutated.filter((m) => !m.caughtBy.length).map((m) => m.what);
  assert.deepEqual(survivors.filter((s) => !/may hear/.test(s)), [], "no mutant of a call rule survives the examples");
  assert.equal(survivors.length, 3, `the three hear mutants (two rules, one condition) survive the api's own examples: ${survivors.join("; ")}`);
  assert.ok(mutated.find((m) => /without its condition/.test(m.what) && /solveTicket/.test(m.what))!.caughtBy.includes("api: taking and solving: only the assignee solves; a lead solves any ticket"), "the assignee condition is proven by the example that says so");
} finally {
  rmSync(root, { recursive: true, force: true });
}

console.log("ok access: the decision (default deny, forbid wins, undecidable refuses, missing row, anonymous, per listener), the print, the harness (examples, audit, grants per request, replay order, 401s, random callers, a planted refusal that writes, rule mutation)");
