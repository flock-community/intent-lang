// Access control (v70): the decision an api's `access` block makes, for every request and every
// event, as the harness runs it. The block is compiled into a plan (data, `accessPlan.ts` in a build,
// `access.json` for the drivers); this module is the one reading of that plan, shared by every build
// and tested once (tests/access.test.ts). The LLM never writes an access check.
//
// The decision is Cedar's: collect the rules for this endpoint (or event) that hold; a forbid that
// holds refuses, whatever permits; else a permit that holds allows; else deny (default deny).
// Conditions are three-valued: a condition that reads nothing — a `T or nothing` field that is
// nothing, an absent param, a reference to a row that is gone, a request without a key — cannot be
// decided, and then a permit does not hold and a forbid does (fail securely, ASVS 4.1.5). This is the
// one place where Kotlin's `==` on nothing (§9.12) does not apply: `is not the @caller` on nothing is
// undecided, not true. A request
// whose own row (the `ref` param's key) finds no row has nothing to protect: its row conditions do
// not refuse (a permit's hold, a forbid's do not), and the endpoint answers for the missing row.

/** One step of a path through a row: a field, and, when the field holds a reference, where its row lives. */
export type Hop = { field: string; ref?: { list: string; key: string } };

export type Cond =
  // `that ticket's @assignee is (not) the @caller`, `the @caller is (not) in that project's @members`,
  // and the same about an event's payload (`its body's @assignee is the @caller`).
  | { k: "caller"; from: "row" | "body"; record?: string; path: Hop[]; in: boolean; not: boolean }
  // `that ticket's @status is (not) @Archived`: the row's choice field holds that value.
  | { k: "value"; record: string; field: string; value: string; not: boolean }
  // `@amount is at most 100000`, `@amount is at most @approvalLimit`: a request param against a literal or a state field.
  | { k: "param"; param: string; op: "eq" | "ne" | "le" | "ge" | "lt" | "gt"; value: { lit: unknown } | { state: string } };

export type Who = { k: "anyone" } | { k: "caller" } | { k: "roles"; roles: string[] } | { k: "all" };

export interface Rule {
  source: string; // file:line of the rule
  text: string; // the rule as written
  effect: "permit" | "forbid";
  who: Who;
  on: "call" | "hear";
  targets: string[]; // endpoint or event names
  conds: Cond[];
  message?: string; // the refusal's `{"error": …}`
}

export interface Plan {
  source: string; // file:line of the `access` block
  auth: string; // the layer (its alias) that provides `caller`
  roles?: { list: string; who: string; role: string }; // the grants: a state list (data field), its `who` and role fields
  rules: Rule[];
  /** Per endpoint and record: the `ref` param that names "that <record>", and where the record's rows live. */
  rows: Record<string, Record<string, { param: string; list: string; key: string }>>;
  actsAs?: ActsAs; // how a test acts as a caller (`call x as "Ann"`)
}

/** How a test acts as a caller: the header the key layer reads, and the key that belongs to them. */
export type ActsAs = { header: string; secret: string; owner: string } & ({ keys: Record<string, unknown>[] } | { state: string });

export type Input =
  | { kind: "call"; endpoint: string; caller: string; request: Record<string, unknown>; data: unknown }
  | { kind: "hear"; event: string; caller: string; body: unknown; data: unknown };

export interface Decision {
  allowed: boolean;
  status?: 401 | 403; // on a refusal
  message?: string;
  rules: string[]; // the determining rules (file:line); none for a default denial
  forbid?: boolean; // refused by a forbid (not only for want of a permit)
  /**
   * Allowed only because the request's own row was not there (its row conditions had nothing to
   * protect): those rows. The harness then refuses an answer that succeeds on such a row after all
   * (the handler made it, or found it): the conditions were never decided for it.
   */
  missing?: MissingRow[];
}

/** A request's own row that was not there when access was decided: its list, key field and key. */
export type MissingRow = { list: string; key: string; value: unknown };

/** Is a row that was missing there now? */
export const rowThere = (data: unknown, m: MissingRow) => !!rowIn(data, m.list, m.key, m.value);

/** One entry of the audit: every refusal, and every permitted request with a non-safe method. Never a key's secret. */
export interface AuditEntry {
  at: string;
  caller: string;
  endpoint: string;
  decision: "allowed" | "refused";
  rules: string[];
  status: number;
  key?: string; // the idempotency key, when there is one
}

type V = "T" | "F" | "U" | "V"; // holds, does not hold, cannot be decided, vacuous (the request's own row is not there)

const obj = (x: unknown): Record<string, unknown> | undefined => (x && typeof x === "object" && !Array.isArray(x) ? (x as Record<string, unknown>) : undefined);
const same = (a: unknown, b: unknown) => a !== undefined && a !== null && b !== undefined && b !== null && JSON.stringify(a) === JSON.stringify(b);

/** The row a key finds in a list of the data, or undefined. */
function rowIn(data: unknown, list: string, key: string, value: unknown): Record<string, unknown> | undefined {
  const rows = obj(data)?.[list];
  if (!Array.isArray(rows)) return undefined;
  return rows.map(obj).find((r) => r && same(r[key], value));
}

/** The value at the end of a path: undefined when a reference on the way finds no row (cannot be decided). */
function follow(start: Record<string, unknown>, path: Hop[], data: unknown): { v: unknown } | undefined {
  let cur: unknown = start;
  for (const [i, h] of path.entries()) {
    const o = obj(cur);
    if (!o) return undefined; // a record on the way is nothing: cannot be decided
    const v = o[h.field];
    if (i === path.length - 1) return { v };
    if (h.ref) {
      if (v === null || v === undefined) return undefined;
      const row = rowIn(data, h.ref.list, h.ref.key, v);
      if (!row) return undefined; // the row it points at is gone
      cur = row;
    } else cur = v;
  }
  return { v: cur };
}

const none = (v: unknown) => v === null || v === undefined;

function evalCond(c: Cond, input: Input, plan: Plan): V {
  const data = input.data;
  if (c.k === "param") {
    if (input.kind !== "call") return "U";
    const x = input.request[c.param];
    const y = "lit" in c.value ? c.value.lit : obj(data)?.[c.value.state];
    if (x === null || x === undefined || y === null || y === undefined) return "U";
    const r = c.op === "eq" ? same(x, y) : c.op === "ne" ? !same(x, y) : typeof x !== typeof y || (typeof x !== "number" && typeof x !== "string") ? undefined : c.op === "le" ? x <= y : c.op === "ge" ? x >= y : c.op === "lt" ? x < y : x > y;
    return r === undefined ? "U" : r ? "T" : "F";
  }
  let start: Record<string, unknown> | undefined;
  if (c.k === "caller" && c.from === "body") {
    if (input.kind !== "hear") return "U";
    start = obj(input.body);
    if (!start) return "U";
  } else {
    // "that <record>": the request's own row, found by the `ref` param's key.
    if (input.kind !== "call") return "U";
    const r = plan.rows[input.endpoint]?.[c.record ?? ""];
    if (!r) return "U";
    const key = input.request[r.param];
    if (key === null || key === undefined) return "V";
    // The list itself cannot be read (the app did not hand its data over): cannot be decided, never "not there".
    if (!Array.isArray(obj(data)?.[r.list])) return "U";
    start = rowIn(data, r.list, r.key, key);
    if (!start) return "V";
  }
  if (c.k === "value") {
    const v = start[c.field];
    if (none(v)) return "U";
    return v === c.value !== c.not ? "T" : "F";
  }
  const got = follow(start, c.path, data);
  if (!got) return "U";
  // Nothing to compare (no caller: a request without a key; a field or list that is nothing): undecided.
  if (input.caller === "" || none(got.v) || (c.in && !Array.isArray(got.v))) return "U";
  const holds = c.in ? (got.v as unknown[]).includes(input.caller) : got.v === input.caller;
  return holds !== c.not ? "T" : "F";
}

/** The roles the caller holds now: read from the grants in the data on every request (ASVS 8.3.2). */
export function rolesOf(plan: Plan, caller: string, data: unknown): string[] {
  if (!plan.roles || caller === "") return [];
  const grants = obj(data)?.[plan.roles.list];
  if (!Array.isArray(grants)) return [];
  return grants.map(obj).filter((g) => g && g[plan.roles!.who] === caller).map((g) => String(g![plan.roles!.role]));
}

const whoMatches = (w: Who, caller: string, roles: string[]) => (w.k === "anyone" || w.k === "all" ? true : w.k === "caller" ? caller !== "" : caller !== "" && w.roles.some((r) => roles.includes(r)));

/** Does a rule hold? A permit holds when every condition holds (its own missing row counts as holding); a forbid unless one surely does not. */
function holds(r: Rule, input: Input, plan: Plan): boolean {
  return held(r, input, plan).holds;
}

/** A rule's verdict, and the missing rows a permit held for (conditions it held on because their row was not there). */
function held(r: Rule, input: Input, plan: Plan): { holds: boolean; missing: MissingRow[] } {
  const vs = r.conds.map((c) => evalCond(c, input, plan));
  if (r.effect !== "permit") return { holds: vs.every((v) => v === "T" || v === "U"), missing: [] };
  const ok = vs.every((v) => v === "T" || v === "V");
  const missing: MissingRow[] = [];
  if (ok && input.kind === "call")
    r.conds.forEach((c, i) => {
      if (vs[i] !== "V" || c.k === "param" || (c.k === "caller" && c.from === "body")) return;
      const row = plan.rows[input.endpoint]?.[c.record ?? ""];
      if (row && !missing.some((m) => m.list === row.list && m.key === row.key)) missing.push({ list: row.list, key: row.key, value: input.request[row.param] });
    });
  return { holds: ok, missing };
}

/** The decision for one request or one event. */
export function decide(plan: Plan, input: Input): Decision {
  const target = input.kind === "call" ? input.endpoint : input.event;
  const roles = rolesOf(plan, input.caller, input.data);
  const rules = plan.rules.filter((r) => r.on === input.kind && r.targets.includes(target) && whoMatches(r.who, input.caller, roles));
  const forbids = rules.filter((r) => r.effect === "forbid" && holds(r, input, plan));
  if (forbids.length) return { allowed: false, status: 403, message: forbids.find((r) => r.message)?.message ?? "Not allowed", rules: forbids.map((r) => r.source), forbid: true };
  const verdicts = rules.filter((r) => r.effect === "permit").map((r) => ({ r, v: held(r, input, plan) })).filter((x) => x.v.holds);
  const permits = verdicts.map((x) => x.r);
  // Relied on a missing row only when no permit holds without one.
  const missing = verdicts.every((x) => x.v.missing.length) ? verdicts.flatMap((x) => x.v.missing).filter((m, i, all) => all.findIndex((n) => n.list === m.list && n.key === m.key) === i) : [];
  if (permits.length) return { allowed: true, rules: permits.map((r) => r.source), ...(missing.length ? { missing } : {}) };
  // Refused for want of a permit. A permit that covers the caller but whose condition does not hold says why.
  const why = rules.find((r) => r.effect === "permit" && r.message);
  return { allowed: false, status: input.caller === "" ? 401 : 403, message: why?.message ?? "Not allowed", rules: why ? [why.source] : [] };
}

const anyone = (plan: Plan, on: "call" | "hear") => plan.rules.filter((r) => r.effect === "permit" && r.who.k === "anyone" && r.on === on).flatMap((r) => r.targets);

/**
 * Is this route (method and path) one `anyone may call`, or the event stream while some event is one
 * `anyone may hear`? Then a request without a key gets through the key layer (the harness binds its
 * `public` from these rules). Only the path's shape is matched: the key layer runs before the input is read.
 */
export function anyoneMay(plan: Plan, endpoints: { name: string; method: string; path: string }[], method: string, path: string, stream: boolean): boolean {
  if (stream) return anyone(plan, "hear").length > 0;
  const parts = path.split("/").filter(Boolean);
  const hit = endpoints.find((e) => {
    const segs = e.path.split("/").filter(Boolean);
    return e.method === method && segs.length === parts.length && segs.every((s, i) => /^\{\w+\}$/.test(s) || s === parts[i]);
  });
  return !!hit && anyone(plan, "call").includes(hit.name);
}

/** The header a test sends to act as a caller (`call x as "Ann"`), from the key layer's keys: undefined when no key is theirs. */
export function actingAs(acts: ActsAs, who: string, data?: unknown): Record<string, string> | undefined {
  const keys = "keys" in acts ? acts.keys : obj(data)?.[acts.state];
  if (!Array.isArray(keys)) return undefined;
  const k = keys.map(obj).find((x) => x && x[acts.owner] === who);
  return k && typeof k[acts.secret] === "string" ? { [acts.header]: k[acts.secret] as string } : undefined;
}

/** Where a decision comes from, for `x-intent-source` (INTENT_TRACE=1): its rules, or the block that denies by default. */
export const decisionSource = (plan: Plan, d: Decision) => (d.rules.length ? `${d.rules.join(", ")} (access)` : `no rule permits this: access block at ${plan.source}`);
