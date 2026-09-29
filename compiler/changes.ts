// Change rules (v67): `always` sentences that relate the data before a step to the data after it.
// The named forms (`never changes`, `never goes down/up`, `only changes from @A to @B`, `is never
// removed`) need no judgement: the harness reads them here and checks them itself, on every event
// the app handles (exec.ts, api.ts). The general form (`@x before`, `was`, `the new @xs`, `the
// removed @xs`) goes to the invariants stage (invariants.ts) with its probe, like one-moment
// sentences. Kept apart from the checker (fit.ts types the forms) so the drivers can use it.
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import type { App, Type } from "./ast.ts";
import { stable } from "./diff.ts";
import { homeOf, innerHomes } from "./homes.ts";

// ---------------------------------------------------------------- reading the forms

/** What a named form is about: a state field (or a field of one), a field of every row of a record, or the rows of a record. */
export type Subject =
  | { k: "state"; name: string; hops: string[] }
  | { k: "field"; record: string; field: string; list?: string }
  | { k: "rows"; record: string; list?: string; cond?: string; when?: "was" | "is" };

export type NamedForm =
  | { form: "frozen"; subject: Subject }
  | { form: "order"; dir: "down" | "up"; subject: Subject } // `never goes down`: after ≥ before
  | { form: "transitions"; subject: Subject; pairs: [string, string][] } // values as written: `Approved`, `true`, `nothing`
  | { form: "kept"; subject: Subject };

const QREF = "@[a-z][\\w.]*";
/** `@x before` (the value before the step): a reference, or a chain of fields, followed by `before` where a value ends. */
export const BEFORE_RE = new RegExp(`(?:\\bits\\s+)?(${QREF}(?:['’]s\\s+@[a-z]\\w*)*)\\s+before(?=\\s*$|\\s*[,;.)]|\\s+(?:plus|minus|times|divided|and|or|is|are|was|when|while|otherwise|unless)\\b)`, "g");
/** `@status was @Approved`, `whose @status was …`: `is` in the state before the step. */
export const WAS_RE = new RegExp(`${QREF}(?:['’]s\\s+@[a-z]\\w*)*\\s+was\\b`, "g");
/** `the new @xs`, `the removed @xs`: the rows added or removed by the step. */
export const DELTA_RE = /\bthe\s+(new|removed)\s+@([a-z][\w.]*)/g;

const outsideStrings = (text: string) => text.replace(/"(?:[^"\\]|\\.)*"/g, '""');
/** A sentence without its strings, but with a template's holes (`"{@count before}"` reads a value). */
const codeOf = (text: string) => text.replace(/"(?:[^"\\]|\\.)*"/g, (s) => ` ${[...s.matchAll(/\{([^{}]*)\}/g)].map((h) => h[1]).join(" ; ")} `);

/** The general form's words in a sentence (`@x before`, `was`, `the new @xs`, `the removed @xs`), as written. */
export function changeWords(text: string): string[] {
  const t = codeOf(text);
  return [...[...t.matchAll(BEFORE_RE)].map((m) => `${m[1]} before`), ...[...t.matchAll(WAS_RE)].map((m) => m[0]), ...[...t.matchAll(DELTA_RE)].map((m) => m[0])];
}

/**
 * The same words written more loosely, for a condition outside \`always\` (held-out round 4, K9): a
 * row's field without its \`@\` (\`that item's done was true\`, \`that item was done\`), \`used to be\`,
 * \`the previous @x\`. Only \`always\` reads the state before a step, so each is a \`CHANGE\` there.
 */
export function looseChangeWords(text: string): string[] {
  const t = codeOf(text);
  const out = changeWords(text);
  for (const m of t.matchAll(/\b(?:that|this|its)\s+@?[a-z]\w*(?:['’]s\s+@?[a-z]\w*)*\s+was\b/g)) out.push(m[0]);
  for (const m of t.matchAll(/(?:@?[a-z][\w.]*(?:['’]s\s+@?[a-z]\w*)*\s+)?used\s+to\s+be\b/g)) out.push(m[0].trim());
  for (const m of t.matchAll(/\bthe\s+previous\s+@?[a-z][\w.]*/g)) out.push(m[0]);
  return [...new Set(out)];
}

const NAMED = /^(.+?)\s+(never\s+changes|never\s+goes\s+(down|up)|only\s+changes\s+from\s+(.+)|(?:is|are)\s+never\s+removed)$/;

/** A sentence's change form: a named one (with its parts), or the general form, or none (a one-moment rule). */
export function parseChange(raw: string): { named?: NamedForm; subjectText?: string } | { general: true } | undefined {
  const text = raw.trim().replace(/[.;]$/, "").trim();
  const m = outsideStrings(text).match(NAMED) ? text.match(NAMED) : null;
  if (m) {
    const subject = parseSubject(m[1].trim());
    const verb = m[2];
    if (subject) {
      if (/^never\s+changes$/.test(verb)) return { named: { form: "frozen", subject }, subjectText: m[1].trim() };
      if (m[3]) return { named: { form: "order", dir: m[3] as "down" | "up", subject }, subjectText: m[1].trim() };
      if (m[4] !== undefined) return { named: { form: "transitions", subject, pairs: parsePairs(m[4]) }, subjectText: m[1].trim() };
      return { named: { form: "kept", subject }, subjectText: m[1].trim() };
    }
    // A named verb on a subject the forms do not know (a derived value's field, an expression): the general form reads it.
    return { general: true };
  }
  return changeWords(text).length ? { general: true } : undefined;
}

function parseSubject(s: string): Subject | undefined {
  let m: RegExpMatchArray | null;
  // @score, the @score, @order's @total
  if ((m = s.match(/^(?:the\s+)?@([a-z][\w.]*)((?:['’]s\s+@[a-z]\w*)*)$/))) return { k: "state", name: m[1], hops: [...m[2].matchAll(/@([a-z]\w*)/g)].map((h) => h[1]) };
  // a @Ticket's @id / a @Ticket in @tickets's @id / a @Ticket's @id in @tickets
  if ((m = s.match(/^(?:a|an|every|each)\s+@([A-Z]\w*)(?:\s+in\s+@([a-z][\w.]*))?['’]s\s+@([a-z]\w*)(?:\s+in\s+@([a-z][\w.]*))?$/))) return { k: "field", record: m[1], field: m[3], list: m[2] ?? m[4] };
  // an @Expense (in @expenses) (whose … was / is …)
  if ((m = s.match(/^(?:a|an|every|each)\s+@([A-Z]\w*)(?:\s+in\s+@([a-z][\w.]*))?(?:\s+(?:whose|where)\s+(.+))?$/))) {
    const cond = m[3]?.trim();
    const was = cond ? /(?:^|\s)was\b/.test(outsideStrings(cond)) : false;
    return { k: "rows", record: m[1], list: m[2], ...(cond ? { cond, when: was ? "was" : "is" } : {}) };
  }
  return undefined;
}

/** `@Pending to @Approved or @Rejected, from @Approved to @Paid`: the listed pairs, in order. */
export function parsePairs(text: string): [string, string][] {
  const out: [string, string][] = [];
  const parts = text.split(/\s*(?:,\s*(?:and\s+)?|\s+and\s+)from\s+/);
  for (const p of parts) {
    const m = p.trim().match(/^(\S+)\s+to\s+(.+)$/);
    if (!m) {
      out.push([p.trim(), ""]); // malformed: the checker says so
      continue;
    }
    for (const to of m[2].split(/\s*(?:,\s*|\s+)or\s+|\s*,\s*/)) if (to.trim()) out.push([value(m[1]), value(to)]);
  }
  return out;
}
const value = (v: string) => v.trim().replace(/^@/, "");

/** Is this `always` sentence a change rule? */
export const isChange = (text: string) => !!parseChange(text);

// ---------------------------------------------------------------- what the harness checks

/** A named form as the harness checks it, on the app's data (`changes.json` in a build). */
export interface ChangeCheck {
  line: number;
  text: string;
  form: NamedForm["form"];
  dir?: "down" | "up";
  pairs?: [unknown, unknown][]; // JSON values, as the data holds them
  subject:
    | { k: "state"; path: string[]; name: string }
    | { k: "field"; list: string; key: string; field: string; record: string; inner?: Inner }
    | { k: "rows"; list: string; key: string; record: string; when?: "was" | "is"; conds?: { field: string; not: boolean; value: unknown }[]; inner?: Inner };
}

/**
 * Rows inside the rows of a state list (a list inside a row): `list` is the outer list, `field` the
 * outer row's list, and a row is matched by its path of keys (the outer row's, then its own).
 */
export interface Inner {
  field: string;
  outerKey: string;
  outer: string; // the outer record, for messages
}

export interface ChangePlan {
  named: ChangeCheck[]; // checked by the harness
  general: { line: number; text: string }[]; // compiled by the invariants stage (with the probe)
}

const dataField = (name: string) => name.replace(/\.([a-z])/g, (_, c: string) => c.toUpperCase());

/**
 * The change rules of an app: the named forms the harness checks itself, and the sentences the
 * invariants stage compiles (the general form, and a named form it cannot read without judgement:
 * a derived subject, a condition that is not `@f was/is <value>`). Assumes the checker passed.
 */
export function changePlan(app: App): ChangePlan {
  const plan: ChangePlan = { named: [], general: [] };
  for (const inv of app.invariants ?? []) {
    const c = parseChange(inv.text);
    if (!c) continue;
    const check = "named" in c && c.named ? harnessCheck(app, c.named, inv.line, inv.text) : undefined;
    if (check) plan.named.push(check);
    else plan.general.push({ line: inv.line, text: inv.text });
  }
  return plan;
}

/** The one-moment sentences of `always` (the stage's `invariants`). */
export const oneMoment = (app: App) => (app.invariants ?? []).filter((i) => !isChange(i.text));

export const hasChangeRules = (app: App) => (app.invariants ?? []).some((i) => isChange(i.text));

function keyOf(app: App, record: string): string | undefined {
  const r = app.records.find((x) => x.name === record);
  return r?.fields.find((f) => f.name === (r.key ?? "id"))?.name;
}

function literal(app: App, v: string): { ok: boolean; value?: unknown } {
  if (v === "nothing") return { ok: true, value: null };
  if (v === "true" || v === "false") return { ok: true, value: v === "true" };
  if (/^-?\d+(\.\d+)?$/.test(v)) return { ok: true, value: Number(v) };
  if (/^"(?:[^"\\]|\\.)*"$/.test(v)) return { ok: true, value: JSON.parse(v) };
  const name = v.replace(/^@/, "");
  if (app.choices.some((c) => c.values.includes(name))) return { ok: true, value: name };
  return { ok: false };
}

function harnessCheck(app: App, f: NamedForm, line: number, text: string): ChangeCheck | undefined {
  const s = f.subject;
  const base = { line, text, form: f.form, ...(f.form === "order" ? { dir: f.dir } : {}) };
  const pairs = f.form === "transitions" ? f.pairs.map(([a, b]) => [literal(app, a), literal(app, b)]) : [];
  if (pairs.some(([a, b]) => !a.ok || !b.ok)) return undefined;
  const pairValues = pairs.length ? { pairs: pairs.map(([a, b]) => [a.value, b.value] as [unknown, unknown]) } : {};
  if (s.k === "state") {
    // A state field (not a derived value: the harness does not compute those), and fields of records through it.
    const field = app.state.find((x) => x.name === s.name);
    if (!field) return undefined;
    let t: Type = field.type;
    for (const h of s.hops) {
      const inner = t.k === "Maybe" ? t.of : t;
      const rec = inner.k === "Named" ? app.records.find((r) => r.name === inner.name) : undefined;
      const hf = rec?.fields.find((x) => x.name === h);
      if (!hf) return undefined;
      t = hf.type;
    }
    return { ...base, ...pairValues, subject: { k: "state", path: [dataField(s.name), ...s.hops], name: s.name } };
  }
  let list = homeOf(app, s.record, s.list).list;
  const key = keyOf(app, s.record);
  // A record whose rows live only inside the rows of one state list: matched by the path of keys.
  const nested = !list && !s.list && !app.state.some((f) => f.type.k === "List" && f.type.of.k === "Named" && f.type.of.name === s.record) ? innerHomes(app, s.record) : [];
  let inner: Inner | undefined;
  if (nested.length === 1 && nested[0].outerKey) {
    list = nested[0].list;
    inner = { field: nested[0].field, outerKey: nested[0].outerKey, outer: nested[0].outer };
  }
  if (!list || !key) return undefined;
  const within = inner ? { inner } : {};
  if (s.k === "field") return { ...base, ...pairValues, subject: { k: "field", list: dataField(list), key, field: s.field, record: s.record, ...within } };
  if (!s.cond) return { ...base, subject: { k: "rows", list: dataField(list), key, record: s.record, ...within } };
  // `whose @status was @Approved (and @kind is not @Draft)`: one row's fields against values.
  const conds: { field: string; not: boolean; value: unknown }[] = [];
  for (const part of s.cond.split(/\s+and\s+(?:whose\s+)?/)) {
    const m = part.trim().match(/^@([a-z]\w*)\s+(?:was|is)\s+(not\s+)?(.+)$/);
    const rec = app.records.find((r) => r.name === s.record);
    if (!m || !rec?.fields.some((x) => x.name === m[1])) return undefined;
    const v = literal(app, m[3].trim());
    if (!v.ok) return undefined;
    conds.push({ field: m[1], not: !!m[2], value: v.value });
  }
  // `was` and `is` in one condition: the stage reads it.
  if (/\bwas\b/.test(s.cond) && /\bis\b/.test(s.cond)) return undefined;
  return { ...base, subject: { k: "rows", list: dataField(list), key, record: s.record, when: s.when, conds, ...within } };
}

// ---------------------------------------------------------------- checking a step

const at = (d: any, path: string[]) => path.reduce((v, p) => (v === null || v === undefined ? v : v[p]), d);
const rowsOf = (d: any, list: string): any[] => (Array.isArray(d?.[list]) ? d[list] : []);
const byKey = (rows: any[], key: string) => new Map(rows.map((r) => [stable(r?.[key]), r]));
/** The rows a rule reads, by key: a state list's rows, or every inner row of every outer row, by its path of keys (`1/2`). */
const keyed = (d: any, s: { list: string; key: string; inner?: Inner }): Map<string, any> =>
  s.inner ? new Map(rowsOf(d, s.list).flatMap((o) => (Array.isArray(o?.[s.inner!.field]) ? o[s.inner!.field] : []).map((r: any) => [`${stable(o?.[s.inner!.outerKey])}/${stable(r?.[s.key])}`, r] as [string, any]))) : byKey(rowsOf(d, s.list), s.key);
const show = (v: unknown) => (v === null || v === undefined ? "nothing" : typeof v === "string" ? v : JSON.stringify(v));
const lower = (s: string) => s[0].toLowerCase() + s.slice(1);
const covers = (c: ChangeCheck["subject"] & { k: "rows" }, row: any) => (c.conds ?? []).every((x) => (stable(row?.[x.field]) === stable(x.value)) !== x.not);
const ordered = (a: unknown, b: unknown, dir: "down" | "up") => {
  if (a === null || a === undefined || b === null || b === undefined) return true; // the checker keeps nothing out of an order
  return dir === "down" ? (b as number | string) >= (a as number | string) : (b as number | string) <= (a as number | string);
};
const allowed = (c: ChangeCheck, a: unknown, b: unknown) => stable(a) === stable(b) || (c.pairs ?? []).some(([x, y]) => stable(x) === stable(a) && stable(y) === stable(b));
/** What a row's fields did: `amount 45 → 50, status Approved → Pending`. */
const changedFields = (a: any, b: any) =>
  [...new Set([...Object.keys(a ?? {}), ...Object.keys(b ?? {})])]
    .filter((k) => stable(a?.[k]) !== stable(b?.[k]))
    .map((k) => `${k} ${show(a?.[k])} → ${show(b?.[k])}`)
    .join(", ");

/**
 * One named rule on one step: why it does not hold (a short difference), or undefined. `made`
 * collects the transitions the step made (for coverage: which declared pairs sessions reach).
 */
export function checkStep(c: ChangeCheck, before: unknown, after: unknown, made?: (from: unknown, to: unknown) => void): string | undefined {
  const s = c.subject;
  const one = (a: unknown, b: unknown, what: string): string | undefined => {
    if (c.form === "frozen") return stable(a) === stable(b) ? undefined : `${what}: ${show(a)} → ${show(b)}`;
    if (c.form === "order") return ordered(a, b, c.dir!) ? undefined : `${what} went ${c.dir}: ${show(a)} → ${show(b)}`;
    if (c.form === "transitions") {
      if (stable(a) !== stable(b)) made?.(a, b);
      return allowed(c, a, b) ? undefined : `${what}: ${show(a)} → ${show(b)} is not a declared change`;
    }
  };
  if (s.k === "state") return c.form === "kept" ? undefined : one(at(before, s.path), at(after, s.path), `@${[s.name, ...s.path.slice(1)].join("'s @")}`);
  const was = keyed(before, s);
  const now = keyed(after, s);
  const name = (k: string) => (s.inner ? `${lower(s.record)} ${s.key} ${k.slice(k.indexOf("/") + 1)} of ${lower(s.inner.outer)} ${s.inner.outerKey} ${k.slice(0, k.indexOf("/"))}` : `${lower(s.record)} ${s.key} ${k}`);
  if (s.k === "field") {
    for (const [k, a] of was) {
      if (!now.has(k)) continue; // a field rule compares rows that are there before and after
      const why = one(a?.[s.field], now.get(k)?.[s.field], `${name(k)}'s ${s.field}`);
      if (why) return why;
    }
    return;
  }
  const cond = s.conds?.length ? ` (${s.conds.map((x) => `${x.field} ${s.when === "is" ? "is" : "was"}${x.not ? " not" : ""} ${show(x.value)}`).join(", ")})` : "";
  if (c.form === "frozen" && s.when === "is") {
    // `whose … is …`: the rows the condition covers after the step, that were there before.
    for (const [k, b] of now) if (covers(s, b) && was.has(k) && stable(was.get(k)) !== stable(b)) return `${name(k)}${cond}: ${changedFields(was.get(k), b)}`;
    return;
  }
  // No condition, or `whose … was …` (a removal can only be read before): the rows covered before the step.
  for (const [k, a] of was) {
    if (s.conds?.length && !covers(s, a)) continue;
    if (!now.has(k)) return `${name(k)}${cond} was removed`;
    if (c.form === "frozen" && stable(a) !== stable(now.get(k))) return `${name(k)}${cond}: ${changedFields(a, now.get(k))}`;
  }
}

/** The keys of the rows a rule freezes or keeps, now: the rows random sessions should try to touch. */
export function coveredKeys(checks: ChangeCheck[], data: unknown): Set<string> {
  const out = new Set<string>();
  for (const c of checks) {
    const s = c.subject;
    if (s.k !== "rows" || !s.conds?.length) continue;
    // An inner row is named by its path of keys (the outer row's key, then its own), as the fuzzer names it.
    if (s.inner) for (const o of rowsOf(data, s.list)) for (const r of Array.isArray(o?.[s.inner.field]) ? o[s.inner.field] : []) (covers(s, r) && out.add(`${String(o?.[s.inner.outerKey])}/${String(r?.[s.key])}`));
    else for (const r of rowsOf(data, s.list)) if (covers(s, r)) out.add(String(r?.[s.key]));
  }
  return out;
}

// ---------------------------------------------------------------- in a build

type General = { line: number; holds: (before: unknown, after: unknown, clock: unknown) => boolean };

/** The first broken change rule: its line, its sentence, and what changed. */
export interface ChangeBroken {
  line: number;
  text: string;
  detail: string;
  ambiguous?: boolean;
  before: unknown;
  after: unknown;
}

/** The change rules of a build, ready for a driver: `step` after every event the app handles. */
export interface ChangeWatch {
  checks: ChangeCheck[];
  /** One step: before and after its event. A step that changes nothing passes every rule (stuttering). */
  step(before: unknown, after: unknown, clock: unknown): ChangeBroken | undefined;
  /** Per rule line, the transitions steps made ("Pending → Approved"). */
  made: Map<number, Set<string>>;
}

/** A build's change rules (`changes.json`, and the stage's `changes` in invariants.mjs), or undefined. */
export async function loadChanges(dir: string): Promise<ChangeWatch | undefined> {
  if (!existsSync(join(dir, "changes.json"))) return undefined;
  const plan: ChangePlan = JSON.parse(readFileSync(join(dir, "changes.json"), "utf8"));
  const load = async (file: string): Promise<General[] | undefined> =>
    existsSync(join(dir, file)) ? ((await import(pathToFileURL(join(dir, file)).href + `?t=${Date.now()}`)).changes as General[] | undefined) : undefined;
  const general = plan.general.length ? ((await load("invariants.mjs")) ?? []) : [];
  const probes = plan.general.length ? await load("invariants-probe.mjs") : undefined;
  return watch(plan, general, probes);
}

/** The watch over a plan, with the stage's general checks (and the probe's second reading). */
export function watch(plan: ChangePlan, general: General[] = [], probes?: General[]): ChangeWatch {
  const made = new Map<number, Set<string>>();
  return {
    checks: plan.named,
    made,
    step(before, after, clock) {
      if (stable(before) === stable(after)) return; // stuttering: nothing changed, every rule holds
      for (const c of plan.named) {
        const detail = checkStep(c, before, after, (a, b) => {
          if (!made.has(c.line)) made.set(c.line, new Set());
          made.get(c.line)!.add(`${show(a)} → ${show(b)}`);
        });
        if (detail) return { line: c.line, text: c.text, detail, before, after };
      }
      for (const [i, g] of general.entries()) {
        const text = plan.general.find((x) => x.line === g.line)?.text ?? "";
        const run = (x: General | undefined) => {
          try {
            return !!x!.holds(before, after, clock);
          } catch {
            return false;
          }
        };
        const a = run(g);
        const b = probes?.[i] ? run(probes[i]) : a;
        if (a !== b) return { line: g.line, text, detail: `the check for "${text}" is inconclusive: a second, independent reading disagrees (one holds, the other does not); make the sentence precise`, ambiguous: true, before, after };
        if (!a) return { line: g.line, text, detail: "it does not hold across this step", before, after };
      }
    },
  };
}

/** The declared pairs of the transition rules, and which of them steps made: for the coverage note. */
export function transitionCoverage(checks: ChangeCheck[], made: Record<number, string[]>): { line: number; text: string; missing: string[] }[] {
  return checks
    .filter((c) => c.form === "transitions")
    .map((c) => ({ line: c.line, text: c.text, missing: (c.pairs ?? []).map(([a, b]) => `${show(a)} → ${show(b)}`).filter((p) => !(made[c.line] ?? []).includes(p)) }))
    .filter((x) => x.missing.length);
}
