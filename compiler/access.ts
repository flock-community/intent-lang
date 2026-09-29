// Access control (v70): an api's `access` block. Who may call which endpoint and hear which event,
// as declared, default-deny rules the harness enforces on the server (runtime/ts/access.ts), before
// the endpoint runs. Here: the rule grammar (a closed set of typed forms, so no condition is left to
// judgement), the checks (ACCESS, UNGRANTED, and the existing UNKNOWN_NAME, TYPE, NO_ROW, HOME,
// CONTRACT), the plan a build runs with (`access.json`, `accessPlan.ts`), what the source map says,
// how a test acts as a caller, and the rule mutants that measure whether the examples prove the rules.
import { LINE_BASE, type AccessBlock, type AccessCond, type AccessRule, type App, type Endpoint, type Literal, type Step, type Type } from "./ast.ts";
import { homeOf } from "./homes.ts";
import { parseString, suggest, typeToString } from "./words.ts";
import type { ActsAs, Cond, Hop, Plan, Rule } from "../runtime/ts/access.ts";

type Err = (l: number, c: string, m: string, col?: number) => void;

const STR = '"(?:[^"\\\\]|\\\\.)*"';
const PATH = "@[a-z]\\w*(?:['’]s\\s+@[a-z]\\w*)*";
const hops = (p: string) => [...p.matchAll(/@([a-z]\w*)/g)].map((m) => m[1]);

/** The typed forms a condition may take (for the ACCESS message). */
export const ACCESS_FORMS = "`that ticket's @assignee is (not) the @caller`, `the @caller is (not) in that project's @members`, `that ticket's @status is (not) @Archived`, `@amount is at most 100000` (or a state field: `@amount is at most @limit`), `its body's @assignee is the @caller` (an event's payload)";

// ---------------------------------------------------------------- the grammar

/** One condition in its typed form, or undefined when it is not one of them. */
export function parseCond(raw: string): AccessCond | undefined {
  const text = raw.trim();
  let m: RegExpMatchArray | null;
  if ((m = text.match(new RegExp(`^that\\s+([a-z]\\w*)['’]s\\s+(${PATH})\\s+is\\s+(not\\s+)?the\\s+@caller$`)))) return { k: "caller", from: "row", word: m[1], path: hops(m[2]), in: false, not: !!m[3], text };
  if ((m = text.match(new RegExp(`^the\\s+@caller\\s+is\\s+(not\\s+)?in\\s+that\\s+([a-z]\\w*)['’]s\\s+(${PATH})$`)))) return { k: "caller", from: "row", word: m[2], path: hops(m[3]), in: true, not: !!m[1], text };
  if ((m = text.match(new RegExp(`^its\\s+body['’]s\\s+(${PATH})\\s+is\\s+(not\\s+)?the\\s+@caller$`)))) return { k: "caller", from: "body", path: hops(m[1]), in: false, not: !!m[2], text };
  if ((m = text.match(new RegExp(`^the\\s+@caller\\s+is\\s+(not\\s+)?in\\s+its\\s+body['’]s\\s+(${PATH})$`)))) return { k: "caller", from: "body", path: hops(m[2]), in: true, not: !!m[1], text };
  if ((m = text.match(/^that\s+([a-z]\w*)['’]s\s+@([a-z]\w*)\s+is\s+(not\s+)?@([A-Z]\w*)$/))) return { k: "value", word: m[1], field: m[2], value: m[4], not: !!m[3], text };
  if ((m = text.match(/^that\s+([a-z]\w*)\s+is\s+(not\s+)?@([A-Z]\w*)$/))) return { k: "value", word: m[1], value: m[3], not: !!m[2], text };
  if ((m = text.match(new RegExp(`^@([a-z]\\w*)\\s+is\\s+(not\\s+)?(?:(at\\s+most|at\\s+least|above|below)\\s+)?(-?\\d+(?:\\.\\d+)?|${STR}|true|false|@[A-Za-z]\\w*)$`)))) {
    if (m[1] === "caller") return undefined;
    const base = ({ "at most": "le", "at least": "ge", above: "gt", below: "lt" } as const)[(m[3] ?? "").replace(/\s+/g, " ") as "above"] ?? "eq";
    const flip = { eq: "ne", ne: "eq", le: "gt", gt: "le", ge: "lt", lt: "ge" } as const;
    const op = m[2] ? flip[base] : base;
    const v = m[4];
    const value: Literal | { k: "state"; name: string } = /^@[a-z]/.test(v)
      ? { k: "state", name: v.slice(1) }
      : /^@[A-Z]/.test(v)
        ? { k: "value", v: v.slice(1) }
        : v.startsWith('"')
          ? { k: "text", v: parseString(v)! }
          : v === "true" || v === "false"
            ? { k: "bool", v: v === "true" }
            : { k: "number", v: Number(v), raw: v };
    return { k: "param", param: m[1], op, value, text };
  }
  return undefined;
}

/** Split a condition at its `and`s, outside strings. */
function splitAnd(s: string): string[] {
  const out: string[] = [];
  let cur = "";
  let inStr = false;
  for (let i = 0; i < s.length; i++) {
    if (s[i] === '"' && s[i - 1] !== "\\") inStr = !inStr;
    if (!inStr && s.startsWith(" and ", i)) {
      out.push(cur);
      cur = "";
      i += 4;
      continue;
    }
    cur += s[i];
  }
  out.push(cur);
  return out.map((x) => x.trim()).filter(Boolean);
}

/** A rule line (`- …` in the block) in its typed form, or what is wrong with it. */
export function parseRule(raw: string, line: number): { rule: AccessRule } | { code: string; message: string } {
  let text = raw.trim();
  let message: string | undefined;
  const mm = text.match(new RegExp(`^(.*?)\\s*:\\s*(${STR})\\s*$`));
  if (mm) {
    text = mm[1];
    message = parseString(mm[2]);
  }
  const m = text.match(/^(.+?)\s+may\s+(call|hear)\s+(.+?)(?:\s+when\s+(.+))?$/);
  if (!m) return { code: "SYNTAX", message: "an access rule is `<who> may call <endpoints> [when <condition>][: \"message\"]` (or `may hear <events>`): `- an @Agent may call @takeTicket`, `- no one may call @reopen when that ticket's @status is @Archived: \"Archived tickets stay closed\"`" };
  const [, whoText, verb, targetText, condText] = m;
  let who: AccessRule["who"];
  let effect: AccessRule["effect"] = "permit";
  if (whoText === "anyone" || /^anyone,\s*without\s+a\s+key\s*,?$/.test(whoText)) who = { k: "anyone" };
  else if (whoText === "any caller") who = { k: "caller" };
  // `any caller with a role` (held-out round 4, G11): a caller who holds any grant; the checker puts every role in.
  else if (/^any\s+caller\s+with\s+a\s+role$/.test(whoText)) who = { k: "roles", roles: [ANY_ROLE] };
  else if (whoText === "no one") (who = { k: "all" }), (effect = "forbid");
  else {
    const parts = whoText.split(/\s*,\s*|\s+or\s+/);
    const roles = parts.map((p) => p.match(/^an?\s+@([A-Z]\w*)$/)?.[1]);
    if (roles.some((r) => !r)) return { code: "SYNTAX", message: `\`${whoText}\`: who may is \`anyone, without a key,\` (no key needed), \`any caller\` (any known key), \`any caller with a role\` (a key whose owner holds a grant), \`a @Role\` (\`a @Clerk or an @Approver\`, \`a @Clerk, an @Approver or a @Lead\`), or \`no one\` (a forbid, with \`when …\`)` };
    who = { k: "roles", roles: roles as string[] };
  }
  const on = verb as "call" | "hear";
  let targets: AccessRule["targets"];
  const every = targetText.match(/^every\s+(endpoint|event)$/);
  if (every) {
    if ((every[1] === "endpoint") !== (on === "call")) return { code: "ACCESS", message: `\`may ${on} every ${every[1]}\`: an endpoint is called and an event is heard (\`may call every endpoint\`, \`may hear every event\`)` };
    targets = "every";
  } else {
    const names = targetText.split(/\s*,\s*|\s+and\s+/).map((x) => x.trim());
    if (names.some((n) => !/^@[a-z]\w*$/.test(n))) return { code: "SYNTAX", message: `\`${targetText}\`: name the ${on === "call" ? "endpoints" : "events"} with @ (\`@a\`, \`@a and @b\`, \`@a, @b and @c\`), or \`every ${on === "call" ? "endpoint" : "event"}\`` };
    targets = names.map((n) => n.slice(1));
  }
  const conds: AccessCond[] = [];
  for (const part of condText ? splitAnd(condText) : []) {
    const c = parseCond(part);
    if (!c) return { code: "ACCESS", message: `\`${part}\`: an access condition is typed whole, so the harness can enforce it; it is one of ${ACCESS_FORMS}, joined with \`and\` (for "or", write a second rule)` };
    conds.push(c);
  }
  return { rule: { effect, who, on, targets, conds, ...(condText ? { condText } : {}), ...(message !== undefined ? { message } : {}), text: raw.trim(), line } };
}

/** A rule back in words (the canonical print). */
export function ruleText(r: AccessRule): string {
  const roles = r.who.k === "roles" ? r.who.roles.map((x) => `${/^[AEIOU]/.test(x) ? "an" : "a"} @${x}`) : [];
  const who = r.who.k === "anyone" ? "anyone, without a key," : r.who.k === "caller" ? "any caller" : r.who.k === "all" ? "no one" : r.who.roles.includes(ANY_ROLE) ? "any caller with a role" : roles.length > 2 ? `${roles.slice(0, -1).join(", ")} or ${roles[roles.length - 1]}` : roles.join(" or ");
  const targets = r.targets === "every" ? `every ${r.on === "call" ? "endpoint" : "event"}` : r.targets.length === 1 ? `@${r.targets[0]}` : `${r.targets.slice(0, -1).map((t) => `@${t}`).join(", ")} and @${r.targets[r.targets.length - 1]}`;
  return `${who} may ${r.on} ${targets}${r.conds.length ? ` when ${r.conds.map((c) => c.text).join(" and ")}` : ""}${r.message !== undefined ? `: ${JSON.stringify(r.message)}` : ""}`;
}

// ---------------------------------------------------------------- what the rules are about

const lowerFirst = (s: string) => s[0].toLowerCase() + s.slice(1);
const dataField = (name: string) => name.replace(/\.([a-z])/g, (_, c: string) => c.toUpperCase());
const strip = (t: Type): Type => (t.k === "Maybe" ? t.of : t);

/** The record a word names (`ticket` → Ticket). */
const recordNamed = (app: App, word: string) => app.records.find((r) => lowerFirst(r.name) === word || r.name.toLowerCase() === word)?.name;

/** The endpoints (or events) a rule covers. */
/** The refusals the access block can give an endpoint: 403 (a caller the rules do not permit), 401 (no key). */
export function refusalsOf(app: App, endpoint: string): number[] {
  const a = app.access;
  if (!a) return [];
  const rules = a.rules.filter((r) => r.on === "call" && covered(app, r).includes(endpoint));
  const open = rules.some((r) => r.effect === "permit" && r.who.k === "anyone");
  const anyKnown = rules.some((r) => r.effect === "permit" && (r.who.k === "anyone" || r.who.k === "caller") && !r.conds.length);
  const refusesKnown = !anyKnown || rules.some((r) => r.effect === "forbid");
  return [...(refusesKnown ? [403] : []), ...(!open ? [401] : [])];
}

export const covered = (app: App, r: AccessRule): string[] => (r.targets === "every" ? (r.on === "call" ? (app.endpoints ?? []).map((e) => e.name) : (app.events ?? []).map((e) => e.name)) : r.targets);

/** The layer that provides `caller` (the authenticating layer). */
export const authLayer = (app: App) => (app.layers ?? []).find((l) => l.spec?.provides?.some((p) => p.name === "caller"));

/** An endpoint's `ref` params, per record: "that ticket" is the row the param's key finds. */
const refParams = (ep: Endpoint) => ep.params.filter((p) => p.type.k === "Ref").map((p) => ({ param: p.name, record: (p.type as { name: string }).name, in: (p.type as { in?: string }).in }));

/** A layer param's bound value as JSON (literals, a list of them, or a table), or its default. */
function bound(app: App, alias: string, param: string): { value?: unknown; state?: string } {
  const l = app.layers?.find((x) => x.alias === alias);
  const b = l?.bindings.find((x) => x.name === param);
  const lit = (v: Literal): unknown => (v.k === "text" || v.k === "value" || v.k === "date" || v.k === "dateTime" ? v.v : v.k === "number" || v.k === "bool" ? v.v : v.k === "emptyList" ? [] : v.k === "table" ? v.rows.map((r) => Object.fromEntries(v.columns.map((c, i) => [c, lit(r[i])]))) : null);
  const p = l?.spec?.params?.find((x) => x.name === param);
  if (b?.state) return { state: b.state };
  const v = b?.value ?? p?.default;
  if (v === undefined) return {};
  if (Array.isArray(v)) return { value: v.map(lit) };
  const x = lit(v);
  return { value: p?.type.k === "List" && !Array.isArray(x) ? [x] : x };
}

/** The key owners a test may act as: the owners in the key layer's bound keys (a literal table, or the seeded rows of the state it is bound to). */
export function keyOwners(app: App): { owners?: string[]; problem?: string } {
  const l = authLayer(app);
  if (!l) return { problem: "no layer provides `caller` (use `std.http.apiKey`)" };
  const acts = l.spec?.actsAs;
  if (!acts) return { problem: `the layer ${l.layer} does not say how a test acts as a caller (\`acts as …\`)` };
  const b = bound(app, l.alias, acts.list);
  let rows: unknown = b.value;
  if (b.state) {
    const st = app.state.find((f) => f.name === b.state);
    const d = st?.default;
    rows = d?.k === "table" ? d.rows.map((r) => Object.fromEntries(d.columns.map((c, i) => [c, (r[i] as { v?: unknown }).v]))) : [];
  }
  return { owners: Array.isArray(rows) ? rows.map((r) => (r as Record<string, unknown>)?.[acts.owner]).filter((x): x is string => typeof x === "string") : [] };
}

/** How a test acts as a caller, as the drivers read it (`access.json`, the provider's too). */
export function actsAsOf(app: App): ActsAs | undefined {
  const l = authLayer(app);
  const acts = l?.spec?.actsAs;
  if (!l || !acts) return undefined;
  const header = bound(app, l.alias, acts.header).value;
  const keys = bound(app, l.alias, acts.list);
  if (typeof header !== "string") return undefined;
  const base = { header: header.toLowerCase(), secret: acts.secret, owner: acts.owner };
  return keys.state ? { ...base, state: dataField(keys.state) } : { ...base, keys: (keys.value as Record<string, unknown>[]) ?? [] };
}

// ---------------------------------------------------------------- checks

const isTextish = (app: App, t: Type) => {
  const s = strip(t);
  return s.k === "Text" || (s.k === "Named" && (app.refined ?? []).some((r) => r.name === s.name && r.base === "Text"));
};
const isNumber = (app: App, t: Type) => {
  const s = strip(t);
  return s.k === "Int" || s.k === "Decimal" || (s.k === "Named" && (app.refined ?? []).some((r) => r.name === s.name && r.base !== "Text"));
};
const isTime = (t: Type) => ["Date", "DateTime"].includes(strip(t).k);

/**
 * Walk a path of fields from a record: each hop but the last is a reference (followed in its record's
 * home list) or a record; the last must be text (`is the @caller`) or a list of text (`the @caller is in`).
 */
function walkPath(app: App, rec: string, path: string[], asList: boolean): { hops?: Hop[]; problem?: { code: string; message: string } } {
  let cur = rec;
  const out: Hop[] = [];
  for (const [i, f] of path.entries()) {
    const r = app.records.find((x) => x.name === cur);
    const field = r?.fields.find((x) => x.name === f);
    if (!field) return { problem: { code: "UNKNOWN_NAME", message: `${cur} has no field \`${f}\`${suggest(f, r?.fields.map((x) => x.name) ?? [])}` } };
    const t = strip(field.type);
    if (i === path.length - 1) {
      const ok = asList ? t.k === "List" && isTextish(app, t.of) : isTextish(app, t);
      if (!ok) return { problem: { code: "TYPE", message: asList ? `\`the @caller is in …'s @${f}\`: ${cur}.${f} is ${typeToString(field.type)}, not a list of text (the callers)` : `\`…'s @${f} is the @caller\`: ${cur}.${f} is ${typeToString(field.type)}; the caller is a text (a key's owner)` } };
      out.push({ field: f });
      continue;
    }
    if (t.k === "Ref") {
      const home = homeOf(app, t.name, t.in);
      if (!home.list) return { problem: { code: "HOME", message: `\`@${f}\` refers to a ${t.name}, and the rule follows it: ${home.problem}; name it on the field (\`${f}: ref ${t.name} in <list>\`)` } };
      const target = app.records.find((x) => x.name === t.name);
      out.push({ field: f, ref: { list: dataField(home.list), key: target?.key ?? "id" } });
      cur = t.name;
    } else if (t.k === "Named" && app.records.some((x) => x.name === t.name)) {
      out.push({ field: f });
      cur = t.name;
    } else return { problem: { code: "TYPE", message: `\`@${f}\` is ${typeToString(field.type)}: only a reference (or a record) is followed with \`'s\`` } };
  }
  return { hops: out };
}

/** The checks of an `access` block (and of `as "…"` and `see audit…` in examples). */
/** `any caller with a role`, until the checker knows the roles (every value of the grants' choice). */
const ANY_ROLE = "*any role*";

export function checkAccess(app: App, err: Err, warn: Err) {
  const own = (line: number) => line < LINE_BASE;
  checkActing(app, err);
  const a = app.access;
  // An api that says who calls also says what they may do: without an \`access\` block every key
  // holder may call every endpoint.
  if (!a && app.profile === "api" && app.kind !== "contract" && app.kind !== "layer") {
    const auth = authLayer(app);
    if (auth && own(auth.line)) err(auth.line, "NO_ACCESS", `\`${auth.alias}\` says who is calling, but nothing says what they may do: every key holder may call every endpoint. Say it in an \`access\` block (default deny): \`access { - any caller may call @… }\``);
  }
  if (!a) return;
  // A refinement (`extends`) adds its rules to the base's block, which keeps the base's line: the
  // merged block is checked rule by rule, each on its own line, and the block itself where this spec
  // says it (the base's own rules were checked with the base).
  const mine = a.rules.filter((r) => own(r.line));
  if (!own(a.line) && !mine.length && !(a.roles && own(a.roles.line))) return;
  const blockLine = own(a.line) ? a.line : (a.roles && own(a.roles.line) ? a.roles.line : mine[0].line);
  if (app.kind === "contract" || app.kind === "layer" || app.kind === "bundle") return err(blockLine, "ACCESS", `a ${app.kind} cannot hold an \`access\` block: access is decided by the app that serves the endpoints`);
  if (app.profile !== "api") return err(blockLine, "ACCESS", "a screen cannot enforce access (whoever controls the browser controls the screen): put the rule on the service it calls, in that api's `access` block");
  const auths = (app.layers ?? []).filter((l) => l.spec?.provides?.some((p) => p.name === "caller"));
  if (!auths.length) err(blockLine, "ACCESS", "an `access` block needs a layer that says who is calling (`provides caller`): `layer auth = std.http.apiKey { … }`");
  if (auths.length > 1) err(auths[1].line, "ACCESS", `two layers provide \`caller\` (${auths.map((l) => l.alias).join(", ")}): an \`access\` block decides on one caller`);
  const auth = auths[0];
  // One spelling for "public": the harness binds the key layer's `public` from the `anyone` rules.
  const pub = auth?.bindings.find((b) => b.name === "public");
  if (pub) err(pub.line, "ACCESS", "in an app with an `access` block, what needs no key is said once, as `- anyone, without a key, may call @…` in the block (the harness binds `public` from it): drop `public` here");
  const anyone = a.rules.some((r) => r.who.k === "anyone");
  if (anyone && auth && !auth.spec?.params?.some((p) => p.name === "public")) err(blockLine, "ACCESS", `\`anyone, without a key, may …\` lets a request through without a key, but the layer ${auth.layer} has no \`public\` param to let it through`);

  // The grants: a state list whose record has `who: Text` and one choice field (the roles).
  let roleChoice: string | undefined;
  if (a.roles) {
    const st = app.state.find((f) => f.name === a.roles!.list);
    const rec = st && st.type.k === "List" && st.type.of.k === "Named" ? app.records.find((r) => r.name === (st.type as { of: { name: string } }).of.name) : undefined;
    if (!st) err(a.roles.line, "UNKNOWN_NAME", `no state \`${a.roles.list}\` to read the grants from${suggest(a.roles.list, app.state.map((f) => f.name))}`);
    else if (!rec) err(a.roles.line, "ACCESS", `\`roles = ${a.roles.list}\`: the grants are a state list of records with \`who: Text\` and a role (a choice); \`${a.roles.list}\` is ${typeToString(st.type)}`);
    else {
      const who = rec.fields.find((f) => f.name === "who");
      const choices = rec.fields.filter((f) => strip(f.type).k === "Named" && app.choices.some((c) => c.name === (strip(f.type) as { name: string }).name));
      if (!who || !isTextish(app, who.type) || who.type.k === "Maybe") err(a.roles.line, "ACCESS", `\`roles = ${a.roles.list}\`: a grant says who holds it, so ${rec.name} needs \`who: Text\` (a caller, as the key layer names them)`);
      if (choices.length !== 1) err(a.roles.line, "ACCESS", `\`roles = ${a.roles.list}\`: ${rec.name} needs exactly one field whose type is a choice (the roles)${choices.length ? `; it has ${choices.map((f) => f.name).join(", ")}` : ""}`);
      else roleChoice = (strip(choices[0].type) as { name: string }).name;
    }
  }

  // `any caller with a role`: every role of the grants' choice.
  for (const r of a.rules)
    if (r.who.k === "roles" && r.who.roles.includes(ANY_ROLE)) {
      if (!roleChoice) {
        if (own(r.line)) err(r.line, "ACCESS", "`any caller with a role` reads the grants: say where they are, `roles = <a state list of grants>` in the block");
      } else r.who = { k: "roles", roles: app.choices.find((c) => c.name === roleChoice)!.values };
    }

  const eps = new Map((app.endpoints ?? []).map((e) => [e.name, e]));
  const evs = new Map((app.events ?? []).map((e) => [e.name, e]));
  for (const r of mine) {
    let said = false;
    const say = (code: string, message: string) => ((said = true), err(r.line, code, message));
    if (r.targets !== "every")
      for (const t of r.targets) {
        const known = r.on === "call" ? eps.has(t) : evs.has(t);
        if (!known) say("UNKNOWN_NAME", r.on === "call" ? (evs.has(t) ? `\`@${t}\` is an event: an event is heard (\`may hear @${t}\`)` : `no endpoint \`${t}\`${suggest(t, [...eps.keys()])}`) : eps.has(t) ? `\`@${t}\` is an endpoint: an endpoint is called (\`may call @${t}\`)` : `no event \`${t}\`${suggest(t, [...evs.keys()])}`);
      }
    if (r.who.k === "roles") {
      for (const role of r.who.roles.filter((x) => x !== ANY_ROLE)) {
        const owner = (roleChoice ? app.choices.find((c) => c.name === roleChoice && c.values.includes(role)) : undefined) ?? app.choices.find((c) => c.values.includes(role));
        if (!owner) say("UNKNOWN_NAME", `no role \`${role}\`${suggest(role, roleChoice ? app.choices.find((c) => c.name === roleChoice)!.values : app.choices.flatMap((c) => c.values))}`);
        else if (!a.roles) say("ACCESS", `\`@${role}\` is a role: say where the grants are, \`roles = <a state list of grants>\` in the block`);
        else if (roleChoice && owner.name !== roleChoice) say("TYPE", `\`@${role}\` is a ${owner.name}, not a role (${roleChoice}: ${app.choices.find((c) => c.name === roleChoice)!.values.join(", ")})`);
      }
    }
    if (r.effect === "forbid" && !r.conds.length) say("ACCESS", `a forbid always has a condition (\`no one may ${r.on} … when …\`): ${r.on === "call" ? "an endpoint no one may ever call is an endpoint to drop" : "an event no one may ever hear is an event to drop"}`);
    const oldAnyone = r.text.match(/^anyone\s+may\s+(call|hear)\b/);
    if (r.who.k === "anyone" && oldAnyone) warn(r.line, "SPELLING", `\`${oldAnyone[0]}\` is written \`anyone, without a key, may ${oldAnyone[1]}\`: it is the one permit that needs no key, and \`any caller\` is any key holder (\`intent fix\` rewrites it)`);
    if (r.who.k === "anyone" && r.conds.length) say("ACCESS", "`anyone, without a key, may …` needs no key, so it is decided before the caller is known: give it no condition (for a condition, write `any caller may … when …`)");
    const targets = covered(app, r);
    for (const c of r.conds) {
      if (c.k === "param") {
        if (r.on === "hear") {
          say("ACCESS", `\`${c.text}\`: an event has no request params; an event's rule reads its payload (\`its body's @f is the @caller\`)`);
          continue;
        }
        for (const t of targets) {
          const ep = eps.get(t);
          const p = ep?.params.find((x) => x.name === c.param);
          if (!ep) continue;
          if (!p) {
            say("UNKNOWN_NAME", `endpoint ${t} has no param \`${c.param}\`${suggest(c.param, ep.params.map((x) => x.name))}`);
            continue;
          }
          const order = c.op !== "eq" && c.op !== "ne";
          if (order && p.type.k === "Maybe") say("NOTHING", `\`${c.text}\`: \`${c.param}\` is ${typeToString(p.type)}, and an order needs a value: when it is nothing the condition cannot be decided (a permit does not hold, a forbid does). Make the param a \`${typeToString(p.type.of)}\`, or compare with \`is\``);
          if (order && c.value.k === "state") {
            const st = app.state.find((f) => f.name === (c.value as { name: string }).name);
            if (st?.type.k === "Maybe") say("NOTHING", `\`${c.text}\`: \`${st.name}\` is ${typeToString(st.type)}, and an order needs a value: when it is nothing the condition cannot be decided (a permit does not hold, a forbid does). Declare it a \`${typeToString(st.type.of)}\``);
          }
          if (order && !isNumber(app, p.type) && !isTime(p.type)) say("TYPE", `\`${c.text}\`: \`${c.param}\` is ${typeToString(p.type)}; an order needs a number or a moment`);
          if (c.value.k === "state") {
            const st = app.state.find((f) => f.name === (c.value as { name: string }).name);
            if (!st) say("UNKNOWN_NAME", `no state \`${c.value.name}\` to compare \`${c.param}\` with${suggest(c.value.name, app.state.map((f) => f.name))}`);
            else if (order ? !(isNumber(app, st.type) && isNumber(app, p.type)) && !(isTime(st.type) && isTime(p.type)) : typeToString(strip(st.type)) !== typeToString(strip(p.type)) && !(isNumber(app, st.type) && isNumber(app, p.type))) say("TYPE", `\`${c.text}\`: \`${c.param}\` is ${typeToString(p.type)}, \`${c.value.name}\` is ${typeToString(st.type)}`);
          } else {
            const v = c.value;
            const t2 = strip(p.type);
            const choice = t2.k === "Named" ? app.choices.find((x) => x.name === t2.name) : undefined;
            const fits = v.k === "number" ? isNumber(app, p.type) : v.k === "text" ? isTextish(app, p.type) || isTime(p.type) : v.k === "bool" ? t2.k === "Bool" : v.k === "value" ? !!choice?.values.includes(v.v) : false;
            if (!fits) say("TYPE", `\`${c.text}\`: \`${c.param}\` is ${typeToString(p.type)}, which ${v.k === "value" ? `is never @${v.v}` : `cannot be compared with ${v.k === "text" ? JSON.stringify(v.v) : String((v as { v: unknown }).v)}`}`);
          }
        }
        continue;
      }
      if (c.k === "caller" && c.from === "body") {
        if (r.on === "call") {
          say("ACCESS", `\`${c.text}\`: \`its body\` is an event's payload; a request's row is \`that <record>\` (its \`ref\` param)`);
          continue;
        }
        for (const t of targets) {
          const ev = evs.get(t);
          const pt = ev ? strip(ev.type) : undefined;
          const rec = pt?.k === "Named" ? app.records.find((x) => x.name === pt.name) : undefined;
          if (!ev) continue;
          if (!rec) {
            say("TYPE", `\`${c.text}\`: the payload of ${t} is ${typeToString(ev.type)}, not a record`);
            continue;
          }
          const w = walkPath(app, rec.name, c.path, c.in);
          if (w.problem) say(w.problem.code, `\`${c.text}\` (event ${t}): ${w.problem.message}`);
        }
        continue;
      }
      // "that <record>": the row the endpoint's `ref <Record>` param names.
      const rec = recordNamed(app, c.word!);
      if (!rec) {
        say("UNKNOWN_NAME", `\`that ${c.word}\`: no record \`${c.word}\`${suggest(c.word!, app.records.map((x) => lowerFirst(x.name)))}`);
        continue;
      }
      c.record = rec;
      if (r.on === "hear") {
        say("NO_ROW", `\`${c.text}\`: an event names no row; its payload is \`its body\` (\`its body's @f is the @caller\`)`);
        continue;
      }
      for (const t of targets) {
        const ep = eps.get(t);
        if (!ep) continue;
        const refs = refParams(ep).filter((p) => p.record === rec);
        if (!refs.length) say("NO_ROW", `\`that ${c.word}\` in a rule for ${t}: the endpoint has no \`ref ${rec}\` param to name it (\`path id: ref ${rec}\`)`);
        else if (refs.length > 1) say("NO_ROW", `\`that ${c.word}\` in a rule for ${t}: ${refs.map((p) => p.param).join(" and ")} both refer to a ${rec}; which one is \`that ${c.word}\`?`);
        else {
          const home = homeOf(app, rec, refs[0].in);
          if (!home.list) say("HOME", `\`that ${c.word}\` (endpoint ${t}): ${home.problem}; name it on the param (\`ref ${rec} in <list>\`)`);
        }
      }
      if (c.k === "value" && c.field) {
        const recDecl = app.records.find((x) => x.name === rec)!;
        const f = recDecl.fields.find((x) => x.name === c.field);
        const ft = f ? strip(f.type) : undefined;
        const ch = ft?.k === "Named" ? app.choices.find((x) => x.name === ft.name) : undefined;
        if (!f) say("UNKNOWN_NAME", `\`${c.text}\`: ${rec} has no field \`${c.field}\`${suggest(c.field, recDecl.fields.map((x) => x.name))}`);
        else if (!ch) say("TYPE", `\`${c.text}\`: ${rec}.${c.field} is ${typeToString(f.type)}, not a choice`);
        else if (!ch.values.includes(c.value)) say(app.choices.some((x) => x.values.includes(c.value)) ? "TYPE" : "UNKNOWN_NAME", `\`${c.text}\`: ${rec}.${c.field} is a ${ch.name} (${ch.values.join(", ")}), never @${c.value}`);
      } else if (c.k === "value") {
        const recDecl = app.records.find((x) => x.name === rec)!;
        const fields = recDecl.fields.filter((f) => {
          const t = strip(f.type);
          return t.k === "Named" && !!app.choices.find((ch) => ch.name === t.name)?.values.includes(c.value);
        });
        if (!fields.length) say(app.choices.some((ch) => ch.values.includes(c.value)) ? "TYPE" : "UNKNOWN_NAME", `\`${c.text}\`: a ${rec} has no field that can be @${c.value}`);
        else if (fields.length > 1) say("ACCESS", `\`${c.text}\`: ${fields.map((f) => f.name).join(" and ")} can both be @${c.value}; say which: \`that ${c.word}'s @${fields[0].name} is ${c.not ? "not " : ""}@${c.value}\``);
        else {
          const to = `that ${c.word}'s @${fields[0].name} is ${c.not ? "not " : ""}@${c.value}`;
          warn(r.line, "SPELLING", `\`${c.text}\` is written \`${to}\`: a condition names the field it reads (\`intent fix\` rewrites it)`);
        }
      } else {
        const w = walkPath(app, rec, c.path, c.in);
        if (w.problem) say(w.problem.code, `\`${c.text}\`: ${w.problem.message}`);
      }
    }
    // What the checks above let through must compile for the harness (the one compile step): a
    // condition the plan cannot enforce is an error here, never a condition dropped from the plan.
    if (!said) {
      const c = compileRule(app, r);
      if ("problems" in c) for (const p of c.problems) say(p.code, p.message);
    }
  }

  // UNGRANTED: with an `access` block, what no rule permits is refused to everyone.
  const permits = a.rules.filter((r) => r.effect === "permit");
  for (const ep of app.endpoints ?? [])
    if (!permits.some((r) => r.on === "call" && covered(app, r).includes(ep.name))) warn(own(ep.line) ? ep.line : blockLine, "UNGRANTED", `no rule permits \`${ep.name}\`: with an \`access\` block, nobody can call it (add \`- a @Role may call @${ep.name}\`, or drop the endpoint)`);
  for (const ev of app.events ?? [])
    if (!permits.some((r) => r.on === "hear" && covered(app, r).includes(ev.name))) warn(own(ev.line) ? ev.line : blockLine, "UNGRANTED", `no rule permits hearing \`${ev.name}\`: with an \`access\` block, no event stream gets it (add \`- a @Role may hear @${ev.name}\`)`);

  // CONTRACT: a restricted endpoint declares the refusals it can give.
  for (const ep of app.endpoints ?? []) {
    if (!ep.answers?.length) continue;
    const has = (s: number) => ep.answers!.some((x) => x.status === s);
    const missing = refusalsOf(app, ep.name).filter((s) => !has(s));
    if (missing.length) err(own(ep.line) ? ep.line : blockLine, "CONTRACT", `endpoint ${ep.name} can be refused (${missing.map((s) => (s === 403 ? "403: a caller the rules do not permit" : "401: without a key")).join("; ")}), but its contract does not declare ${missing.join(" and ")}: add \`answers ${missing[0]} Problem\` (or \`every endpoint answers ${missing[0]} Problem\`)`);
  }
}

/** `call x as "Ann"`: a key belongs to Ann in the key layer (the provider's, in a screen's example); `see audit…` needs an access block. */
function checkActing(app: App, err: Err) {
  const AUDIT_FIELDS = ["at", "caller", "endpoint", "decision", "rules", "status", "key"];
  for (const ex of [...app.examples, { name: "(always)", steps: app.always, line: 0 }])
    for (const s of ex.steps as Step[]) {
      if (s.line >= LINE_BASE) continue;
      if (s.do === "call" && s.as !== undefined) {
        if (s.headers?.some((h) => /key|authorization/i.test(h.name))) err(s.line, "STEP", `\`as ${JSON.stringify(s.as)}\` already sends ${s.as}'s key: give the call one caller (\`as …\`, or a key header to test a wrong key)`);
        const other = s.endpoint.includes(".") ? app.clients?.find((c) => c.alias === s.endpoint.split(".")[0]) : undefined;
        // Another client's call whose api or provider did not load: that error is said already (UNKNOWN_NAME,
        // PROVIDER, LOCK, STEP); who the provider's keys belong to cannot be known, so nothing more is said here.
        if (s.endpoint.includes(".") && (!other || !other.testedWith || !other.providerDigest)) continue;
        const owners = other ? { owners: other.providerCallers, problem: other.providerCallers ? undefined : `the provider of \`${other.alias}\` has no key layer that says how a test acts as a caller` } : keyOwners(app);
        if (owners.problem) err(s.line, "ACCESS", `\`as ${JSON.stringify(s.as)}\`: ${owners.problem}`);
        else if (!owners.owners!.includes(s.as)) err(s.line, "ACCESS", `\`as ${JSON.stringify(s.as)}\`: no key belongs to ${s.as} (${owners.owners!.length ? `the keys are ${owners.owners!.join(", ")}'s` : "there are no keys"})${suggest(s.as, owners.owners!)}`);
      }
      if (s.do === "see" && /^audit\b/.test(s.target) && app.profile === "api") {
        if (!app.access) err(s.line, "STEP", "`see audit…` reads the access audit, and this api has no `access` block");
        const m = s.target.match(/^audit(?:\[(\d+)\])?(?:\.([a-z]\w*))?$/);
        if (!m || (m[2] && !m[1])) err(s.line, "STEP", "the audit is a list: `see audit has 3 rows`, `see audit[1].caller = \"Ann\"` (entries count from 1)");
        else if (m[2] && !AUDIT_FIELDS.includes(m[2])) err(s.line, "UNKNOWN_NAME", `an audit entry has ${AUDIT_FIELDS.join(", ")}; not \`${m[2]}\`${suggest(m[2], AUDIT_FIELDS)}`);
        else if (m[2] === "decision" && s.check.is === "eq" && !["allowed", "refused"].includes(s.check.value)) err(s.line, "STEP", `an audit entry's decision is "allowed" or "refused", never ${JSON.stringify(s.check.value)}`);
      }
    }
}

// ---------------------------------------------------------------- the plan the harness runs

const lineOf = (app: App, line: number) => `${app.sources?.[Math.floor(line / LINE_BASE)]?.file ?? `${app.name}.intent`}:${line % LINE_BASE}`;

type Problem = { code: string; message: string };

/**
 * One rule compiled for the harness: its conditions per group of targets (a `hear` rule whose
 * conditions read the payload is compiled per event, as each event has its own payload record; the
 * events whose conditions compile the same share a group), or every reason it cannot be enforced.
 * The one compile step: the checker reports its problems (checkAccess) and the plan refuses to build
 * with any (accessPlan), so a condition is never silently dropped (which would widen a permit).
 */
export function compileRule(app: App, r: AccessRule): { groups: { targets: string[]; conds: Cond[] }[] } | { problems: Problem[] } {
  const problems: Problem[] = [];
  const targets = covered(app, r);
  const perTarget = targets.map((t) => {
    const conds: Cond[] = [];
    for (const c of r.conds) {
      const x = compileCond(app, r, c, t);
      if ("problem" in x) problems.push(x.problem);
      else conds.push(x.cond);
    }
    return { t, conds };
  });
  if (problems.length) return { problems: problems.filter((p, i) => problems.findIndex((q) => q.message === p.message) === i) };
  const groups: { targets: string[]; conds: Cond[] }[] = [];
  for (const { t, conds } of perTarget) {
    const g = groups.find((x) => JSON.stringify(x.conds) === JSON.stringify(conds));
    if (g) g.targets.push(t);
    else groups.push({ targets: [t], conds });
  }
  if (!groups.length) groups.push({ targets: [], conds: [] });
  return { groups };
}

/** One condition of a rule, for one of its targets (an endpoint, or an event). */
function compileCond(app: App, r: AccessRule, c: AccessCond, target: string): { cond: Cond } | { problem: Problem } {
  const fail = (message: string, code = "ACCESS") => ({ problem: { code, message: `\`${c.text}\`: ${message}` } });
  if (c.k === "param") {
    if (r.on !== "call") return fail("an event has no request params");
    const ep = (app.endpoints ?? []).find((e) => e.name === target);
    if (!ep?.params.some((p) => p.name === c.param)) return fail(`endpoint ${target} has no param \`${c.param}\``, "UNKNOWN_NAME");
    if (c.value.k === "state" && !app.state.some((f) => f.name === (c.value as { name: string }).name)) return fail(`no state \`${c.value.name}\``, "UNKNOWN_NAME");
    return { cond: { k: "param", param: c.param, op: c.op, value: c.value.k === "state" ? { state: dataField(c.value.name) } : { lit: "v" in c.value ? c.value.v : null } } };
  }
  if (c.k === "caller" && c.from === "body") {
    if (r.on !== "hear") return fail("`its body` is an event's payload");
    const t = app.events?.find((e) => e.name === target)?.type;
    const rec = t && strip(t).k === "Named" ? app.records.find((x) => x.name === (strip(t) as { name: string }).name)?.name : undefined;
    if (!rec) return fail(`the payload of ${target} is not a record`, "TYPE");
    const w = walkPath(app, rec, c.path, c.in);
    if (!w.hops) return fail(`(event ${target}) ${w.problem!.message}`, w.problem!.code);
    return { cond: { k: "caller", from: "body", path: w.hops, in: c.in, not: c.not } };
  }
  // "that <record>": the row the endpoint's one `ref <Record>` param names.
  const rec = c.record ?? recordNamed(app, c.word ?? "");
  if (!rec) return fail(`no record \`${c.word}\``, "UNKNOWN_NAME");
  if (r.on !== "call") return fail("an event names no row", "NO_ROW");
  const ep = (app.endpoints ?? []).find((e) => e.name === target);
  const refs = ep ? refParams(ep).filter((p) => p.record === rec) : [];
  if (refs.length !== 1) return fail(`endpoint ${target} needs exactly one \`ref ${rec}\` param to name that ${c.word}`, "NO_ROW");
  if (!homeOf(app, rec, refs[0].in).list) return fail(`no home list for ${rec}`, "HOME");
  if (c.k === "value" && c.field) {
    const f = app.records.find((x) => x.name === rec)?.fields.find((x) => x.name === c.field);
    const ft = f ? strip(f.type) : undefined;
    if (!f || ft?.k !== "Named" || !app.choices.find((ch) => ch.name === ft.name)?.values.includes(c.value)) return fail(`a ${rec}'s \`${c.field}\` cannot be @${c.value}`, "TYPE");
    return { cond: { k: "value", record: rec, field: c.field, value: c.value, not: c.not } };
  }
  if (c.k === "value") {
    const fields = (app.records.find((x) => x.name === rec)?.fields ?? []).filter((f) => strip(f.type).k === "Named" && !!app.choices.find((ch) => ch.name === (strip(f.type) as { name: string }).name)?.values.includes(c.value));
    if (fields.length !== 1) return fail(fields.length ? `${fields.map((f) => f.name).join(" and ")} can both be @${c.value}` : `a ${rec} has no field that can be @${c.value}`, fields.length ? "ACCESS" : "TYPE");
    return { cond: { k: "value", record: rec, field: fields[0].name, value: c.value, not: c.not } };
  }
  const w = walkPath(app, rec, c.path, c.in);
  if (!w.hops) return fail(w.problem!.message, w.problem!.code);
  return { cond: { k: "caller", from: "row", record: rec, path: w.hops, in: c.in, not: c.not } };
}

/** Where the grants are: the state list, its \`who\` field and its role field. */
function grantsOf(app: App): Plan["roles"] {
  const a = app.access;
  if (!a?.roles) return undefined;
  const st = app.state.find((f) => f.name === a.roles!.list);
  const rec = st?.type.k === "List" && st.type.of.k === "Named" ? app.records.find((r) => r.name === (st.type as { of: { name: string } }).of.name) : undefined;
  const role = rec?.fields.find((f) => strip(f.type).k === "Named" && app.choices.some((c) => c.name === (strip(f.type) as { name: string }).name));
  return rec && role ? { list: dataField(a.roles.list), who: "who", role: role.name } : undefined;
}

/** The access block as data, for the harness (runtime/ts/access.ts reads it). */
export function accessPlan(app: App): Plan | undefined {
  const a = app.access;
  const auth = authLayer(app);
  if (!a || !auth) return undefined;
  const roles = grantsOf(app);
  const rows: Plan["rows"] = {};
  for (const ep of app.endpoints ?? [])
    for (const p of refParams(ep)) {
      const home = homeOf(app, p.record, p.in).list;
      const rec = app.records.find((r) => r.name === p.record);
      if (home && rec) (rows[ep.name] ??= {})[p.record] = { param: p.param, list: dataField(home), key: rec.key ?? "id" };
    }
  const rules: Rule[] = [];
  for (const r of a.rules) {
    const c = compileRule(app, r);
    if ("problems" in c) throw new Error(`access rule at ${lineOf(app, r.line)} cannot be enforced: ${c.problems.map((p) => p.message).join("; ")}`);
    const who = (r.who.k === "roles" ? { k: "roles", roles: [...r.who.roles] } : r.who) as Rule["who"];
    for (const g of c.groups) rules.push({ source: lineOf(app, r.line), text: ruleText(r), effect: r.effect, who, on: r.on, targets: g.targets, conds: g.conds, ...(r.message !== undefined ? { message: r.message } : {}) });
  }
  const acts = actsAsOf(app);
  return { source: lineOf(app, a.line), auth: auth.alias, ...(roles ? { roles } : {}), rules, rows, ...(acts ? { actsAs: acts } : {}) };
}

/** Per endpoint (and event), the rules that govern it (file:line): for the source map. */
export function rulesByTarget(app: App): Record<string, string[]> {
  const out: Record<string, string[]> = {};
  for (const r of app.access?.rules ?? []) for (const t of covered(app, r)) (out[`${r.on === "call" ? "endpoint" : "event"} ${t}`] ??= []).push(lineOf(app, r.line));
  return out;
}

/** The source map's entries for the block: each rule with its line and what it covers. */
export function accessSources(app: App): { key: string; line: number; covers: string[]; effect: string }[] {
  return (app.access?.rules ?? []).map((r) => ({ key: `access ${lineOf(app, r.line)}`, line: r.line, covers: covered(app, r).map((t) => `${r.on === "call" ? "endpoint" : "event"} ${t}`), effect: r.effect }));
}

// ---------------------------------------------------------------- rule mutation

/**
 * The mutants of a plan: each rule dropped, and each condition of a rule dropped (a permit that
 * widens, a forbid that narrows or widens). Examples that pass on a mutant do not prove that rule:
 * the dynamic half of ACCESS_UNPROVEN, at no LLM cost (access is harness code).
 */
export function mutants(plan: Plan): { what: string; source: string; plan: Plan }[] {
  const out: { what: string; source: string; plan: Plan }[] = [];
  plan.rules.forEach((r, i) => {
    out.push({ what: `without the rule \`${r.text}\``, source: r.source, plan: { ...plan, rules: plan.rules.filter((_, j) => j !== i) } });
    if (r.conds.length > 1 || (r.conds.length === 1 && r.effect === "permit"))
      r.conds.forEach((_, k) => out.push({ what: `\`${r.text}\` without its condition ${r.conds.length > 1 ? `${k + 1} ` : ""}`.trim(), source: r.source, plan: { ...plan, rules: plan.rules.map((x, j) => (j === i ? { ...x, conds: x.conds.filter((_, n) => n !== k) } : x)) } }));
  });
  return out;
}

// ---------------------------------------------------------------- the static half of ACCESS_UNPROVEN

/** Who each example call is made as: `as "Ann"`, the owner of the key it sends, or "" (anonymous). */
function callerOf(app: App, s: Extract<Step, { do: "call" }>): string | undefined {
  if (s.as !== undefined) return s.as;
  const acts = actsAsOf(app);
  const h = s.headers?.find((x) => x.name === acts?.header);
  if (!h) return "";
  const secret = (h.value as { v?: unknown }).v;
  // The keys: bound as a table, or a state list (its seeded rows; the example may add keys to it).
  const keys = acts && "keys" in acts ? acts.keys : seededKeys(app);
  const k = keys.find((x) => x[acts!.secret] === secret);
  if (k) return String(k[acts!.owner]);
  // A key the example made (keys in state): someone, with no seeded role. A key in a bound table that is not there: a 401, nobody.
  return acts && "state" in acts ? "\u0000a key made in the example" : undefined;
}

/** The seeded rows of the state list the key layer's keys are bound to. */
function seededKeys(app: App): Record<string, unknown>[] {
  const l = authLayer(app);
  const acts = l?.spec?.actsAs;
  const b = l && acts ? bound(app, l.alias, acts.list) : {};
  const d = b.state ? app.state.find((f) => f.name === b.state)?.default : undefined;
  return d?.k === "table" ? d.rows.map((r) => Object.fromEntries(d.columns.map((c, i) => [c, (r[i] as { v?: unknown }).v]))) : [];
}

/** The roles each caller is granted in the seeded grants (examples may change them; this is a first reading). */
function seededRoles(app: App): Map<string, string[]> {
  const out = new Map<string, string[]>();
  const a = app.access;
  const st = a?.roles ? app.state.find((f) => f.name === a.roles!.list) : undefined;
  const d = st?.default;
  const grants = grantsOf(app);
  if (d?.k !== "table" || !grants) return out;
  const wi = d.columns.indexOf("who");
  const ri = d.columns.indexOf(grants.role);
  for (const row of d.rows) {
    const who = (row[wi] as { v?: unknown })?.v;
    const role = (row[ri] as { v?: unknown })?.v;
    if (typeof who === "string" && typeof role === "string") out.set(who, [...(out.get(who) ?? []), role]);
  }
  return out;
}

/**
 * A rule some example proves both ways: one call it permits (as a caller it covers, answered neither
 * 401 nor 403), and one call it refuses (answered 401 or 403; for a forbid with a message, that message).
 * Static and approximate (the seeded grants; an example that changes them is read as seeded), like
 * STATUS_UNPROVEN: the dynamic half is the rule mutation run.
 */
export function accessUnproven(app: App, warn: (line: number, code: string, message: string) => void) {
  const a = app.access;
  if (!a || a.line >= LINE_BASE || app.profile !== "api") return;
  const roles = seededRoles(app);
  const covers = (r: AccessRule, caller: string | undefined) => caller !== undefined && (r.who.k === "anyone" || r.who.k === "all" || (r.who.k === "caller" && caller !== "") || (r.who.k === "roles" && caller !== "" && r.who.roles.some((x) => (roles.get(caller) ?? []).includes(x))));
  type Seen = { endpoint: string; caller?: string; status: number; errors: string[] };
  const seen: Seen[] = [];
  for (const ex of app.examples) {
    const last = new Map<string, Seen>();
    for (const s of ex.steps) {
      if (s.do === "call" && !s.endpoint.includes(".")) {
        const x: Seen = { endpoint: s.endpoint, caller: callerOf(app, s), status: 0, errors: [] };
        last.set(s.endpoint, x);
        seen.push(x);
      } else if (s.do === "see" && s.check.is === "eq") {
        const m = s.target.match(/^([a-z]\w*)\.(status|body\.error)$/);
        const x = m && last.get(m[1]);
        if (x && m![2] === "status") x.status = Number(s.check.value);
        if (x && m![2] === "body.error") x.errors.push(s.check.value);
      }
      // A check on an answer's body (not its error) sees it answered, as STATUS_UNPROVEN reads it.
      if (s.do === "see" && !s.every) {
        const b = s.target.match(/^([a-z]\w*)\.body(?![.]error$)/);
        const x = b && last.get(b[1]);
        if (x && !x.status) x.status = 200;
      }
    }
  }
  for (const r of a.rules) {
    if (r.on !== "call" || r.line >= LINE_BASE) continue;
    const eps = covered(app, r);
    const calls = seen.filter((x) => eps.includes(x.endpoint) && x.status);
    const refused = (x: Seen) => x.status === 401 || x.status === 403;
    const permitted = calls.some((x) => !refused(x) && covers(r, x.caller));
    // An `anyone` permit refuses nobody: it is proven by a call without a key that is answered.
    if (r.who.k === "anyone") {
      if (!calls.some((x) => !refused(x) && x.caller === "")) warn(r.line, "ACCESS_UNPROVEN", `no example calls ${eps.map((e) => `@${e}`).join(", ")} without a key and sees it answered: \`${ruleText(r)}\` is not proven`);
      continue;
    }
    const refusedBy = calls.some((x) => refused(x) && (r.effect === "forbid" ? (r.message === undefined ? x.status === 403 : x.errors.includes(r.message)) : r.conds.length ? covers(r, x.caller) || x.errors.includes(r.message ?? "\u0000") : !covers(r, x.caller)));
    const missing = [...(permitted ? [] : [`a call it ${r.effect === "forbid" ? "lets through" : "permits"} (${r.effect === "forbid" ? "a covered endpoint" : "as a caller it covers"}, answered neither 401 nor 403)`]), ...(refusedBy ? [] : [`a call it refuses (answered ${r.effect === "forbid" ? `403${r.message !== undefined ? ` with ${JSON.stringify(r.message)}` : ""}` : "401 or 403"})`])];
    if (missing.length) warn(r.line, "ACCESS_UNPROVEN", `no example proves \`${ruleText(r)}\` both ways: it lacks ${missing.join(", and ")}; add an example with \`call … as "…"\``);
  }
}

export type { AccessBlock };
