// A click on a disabled button in an example (held-out round 4, K2 and R1). A disabled button cannot
// be clicked (LANGUAGE.md §4): the harness refuses the step, so no build could ever pass the example,
// and before this check the spec only failed when built (SPEC CONFLICT in every build). An example
// proves a disabled button with `see x is disabled`; it may not click it.
//
// Where it is decidable, the checker says so first: it follows the example's steps over what it
// knows of the state (the defaults and the seeded rows, a field typed into, a select chosen, a box
// ticked) and forgets whatever a step may change otherwise (every state name a handler that runs
// mentions; everything, for a step it cannot follow). A button's `enabled when` is evaluated only
// in its typed forms, over names it still knows; anything else is left to the harness.
import { LINE_BASE, type App, type Element, type Example, type Field, type Handler, type Literal, type RowRef, type Stmt } from "./ast.ts";

type Err = (line: number, code: string, message: string) => void;
type V = string | number | boolean | null | V[] | { [k: string]: V };
const UNKNOWN = Symbol("unknown");
type Known = Map<string, V | typeof UNKNOWN>;

/** A literal as a value (a table as its rows, each with the record's defaults). */
function valueOf(app: App, l: Literal | undefined, type?: Field["type"]): V | typeof UNKNOWN {
  if (!l) return UNKNOWN;
  switch (l.k) {
    case "text":
      return l.v;
    case "number":
      return l.v;
    case "bool":
      return l.v;
    case "nothing":
      return null;
    case "emptyList":
      return [];
    case "value":
      return l.v;
    case "date":
    case "dateTime":
      return l.v;
    case "list":
      return UNKNOWN;
    case "record":
      return UNKNOWN;
    case "table": {
      const recName = type?.k === "List" && type.of.k === "Named" ? type.of.name : undefined;
      const rec = app.records.find((r) => r.name === recName);
      if (!rec) return UNKNOWN;
      const rows: V[] = [];
      for (const cells of l.rows) {
        const row: Record<string, V> = {};
        for (const f of rec.fields) {
          const at = l.columns.indexOf(f.name);
          const v = valueOf(app, at >= 0 ? cells[at] : f.default, f.type);
          if (v === UNKNOWN) row[f.name] = null;
          else row[f.name] = v;
        }
        rows.push(row);
      }
      return rows;
    }
  }
}

/** Every state name a body mentions with `@` (in its steps and conditions). */
function mentions(body: Stmt[] | undefined, steps: string[] = []): Set<string> {
  const out = new Set<string>();
  const add = (t: string) => {
    for (const m of t.matchAll(/@([a-z]\w*)/g)) out.add(m[1]);
  };
  const walk = (b?: Stmt[]) => {
    for (const s of b ?? []) {
      if (s.k === "step" || s.k === "answer") add(s.text);
      else if (s.k === "if") for (const br of s.branches) (add(br.cond ?? ""), walk(br.body));
      else if (s.k === "for") (add(s.list), add(s.where ?? ""), walk(s.body));
    }
  };
  walk(body);
  for (const s of steps) add(s);
  return out;
}

const calls = (h: Handler) => h.steps.some((s) => /\b(?:call|undo)\s+@/.test(s));

/** The element a step names, and the list rows it is in (outermost first). */
function find(els: Element[], name: string, lists: Element[] = []): { el: Element; lists: Element[] } | undefined {
  for (const e of els) {
    if (e.name === name && e.kind !== "section") return { el: e, lists };
    const inner = find(e.children, name, e.kind === "list" ? [...lists, e] : lists);
    if (inner) return inner;
  }
}

/** The value a condition's name reads: a state field, or a field of the row. */
type Read = (name: string) => V | typeof UNKNOWN;

/** Whether a typed `enabled when` holds, or undefined when it cannot be decided here. */
export function holds(cond: string, read: Read, row?: Record<string, V>): boolean | undefined {
  const parts = cond.trim().split(/\s+and\s+/);
  let all = true;
  for (const p of parts) {
    const one = holdsOne(p.trim(), read, row);
    if (one === false) return false;
    if (one === undefined) all = false;
  }
  return all ? true : undefined;
}

function holdsOne(c: string, read: Read, row?: Record<string, V>): boolean | undefined {
  // `its @f` and a bare `@f` in a row read the row's field; else a state field.
  const val = (ref: string): V | typeof UNKNOWN => {
    const m = ref.match(/^(its\s+)?@([a-z]\w*)$/);
    if (!m) return UNKNOWN;
    if (row && (m[1] || m[2] in row)) return m[2] in row ? row[m[2]] : UNKNOWN;
    if (m[1]) return UNKNOWN;
    return read(m[2]);
  };
  const lit = (x: string): V | typeof UNKNOWN => {
    const t = x.trim();
    if (/^-?\d+(?:\.\d+)?$/.test(t)) return Number(t);
    if (/^"(?:[^"\\]|\\.)*"$/.test(t)) return JSON.parse(t);
    if (t === "true" || t === "false") return t === "true";
    if (t === "nothing") return null;
    const v = t.match(/^@([A-Z]\w*)$/);
    if (v) return v[1];
    return val(t);
  };
  const REF = "((?:its\\s+)?@[a-z]\\w*)";
  let m: RegExpMatchArray | null;
  if ((m = c.match(new RegExp(`^there\\s+is\\s+(a|an|no)\\s+${REF}$`)))) {
    const v = val(m[2]);
    return v === UNKNOWN ? undefined : (v !== null) === (m[1] !== "no");
  }
  if ((m = c.match(new RegExp(`^${REF}\\s+is\\s+(not\\s+)?(blank|empty)$`)))) {
    const v = val(m[1]);
    if (v === UNKNOWN) return undefined;
    const e = typeof v === "string" ? (m[3] === "blank" ? v.trim() === "" : v === "") : Array.isArray(v) ? v.length === 0 : undefined;
    return e === undefined ? undefined : e !== !!m[2];
  }
  if ((m = c.match(new RegExp(`^${REF}\\s+is\\s+(not\\s+)?(above|below|at least|at most|more than|less than)\\s+(-?\\d+(?:\\.\\d+)?)$`)))) {
    const v = val(m[1]);
    if (typeof v !== "number") return undefined;
    const n = Number(m[4]);
    const r = m[3] === "above" || m[3] === "more than" ? v > n : m[3] === "below" || m[3] === "less than" ? v < n : m[3] === "at least" ? v >= n : v <= n;
    return r !== !!m[2];
  }
  if ((m = c.match(new RegExp(`^${REF}\\s+is\\s+(not\\s+)?(.+)$`)))) {
    const v = val(m[1]);
    const w = lit(m[3]);
    if (v === UNKNOWN || w === UNKNOWN) return undefined;
    if ((typeof v === "object" && v !== null) || (typeof w === "object" && w !== null)) return undefined;
    return (v === w) !== !!m[2];
  }
  if ((m = c.match(new RegExp(`^(not\\s+)?${REF}$`)))) {
    const v = val(m[2]);
    return typeof v === "boolean" ? v !== !!m[1] : undefined;
  }
  return undefined;
}

/** A row a step names, when it can be known: a list shown as it is kept in state. */
function rowAt(list: Element, at: RowRef | undefined, known: Known): Record<string, V> | undefined {
  if (!at || at.parent || (at.list && at.list !== list.name) || list.expr || list.visibleWhen) return undefined;
  const rows = known.get(list.name);
  if (!Array.isArray(rows)) return undefined;
  if (at.with !== undefined) {
    // What the row shows by name: its plain text elements (`text title` shows the field title).
    const shown = list.children.filter((c) => c.kind === "text" && !c.expr).map((c) => c.name);
    const hit = rows.find((r) => r && typeof r === "object" && !Array.isArray(r) && shown.some((f) => String((r as Record<string, V>)[f]) === at.with));
    return hit as Record<string, V> | undefined;
  }
  const r = rows[at.row - 1];
  return r && typeof r === "object" && !Array.isArray(r) ? (r as Record<string, V>) : undefined;
}

export function checkDisabledClicks(app: App, err: Err) {
  if (app.profile === "api" || app.profile === "job" || app.kind === "contract" || app.kind === "bundle" || app.kind === "layer") return;
  const own = (ex: Example) => ex.line < LINE_BASE;
  const initial = (): Known => new Map(app.state.map((f) => [f.name, valueOf(app, f.default, f.type)]));
  const handlers = (verb: Handler["verb"], target?: string) => app.handlers.filter((h) => h.verb === verb && (target === undefined || h.target === target));
  const forget = (known: Known, names: Iterable<string>) => {
    for (const n of names) if (known.has(n)) known.set(n, UNKNOWN);
  };
  const forgetAll = (known: Known) => {
    for (const k of known.keys()) known.set(k, UNKNOWN);
  };
  // A handler runs: what it mentions may change; a row it names (\`that item\`, a lookup, a loop) may be
  // in any list; a call's answers and events may change anything.
  const lists = app.state.filter((f) => f.type.k === "List").map((f) => f.name);
  const run = (known: Known, hs: Handler[]) => {
    for (const h of hs) {
      forget(known, mentions(h.body, h.steps));
      if (h.steps.some((t) => /\b(?:that|this|the\s+new)\s+[a-z]\w*|\bwhose\b|\bwhere\b|\bits\s+@|\bfor\s+each\b/.test(t)) || JSON.stringify(h.body ?? []).includes('"k":"for"')) forget(known, lists);
      if (calls(h)) forgetAll(known);
    }
  };
  // A row's own field changes (typed into, chosen, ticked): the known row changes with it.
  const setInRow = (known: Known, list: Element, at: RowRef | undefined, field: string, to: (v: V) => V | typeof UNKNOWN) => {
    const row = rowAt(list, at, known);
    const rows = known.get(list.name);
    if (!row || !Array.isArray(rows) || !(field in row)) return forget(known, [list.name]);
    const next = to(row[field]);
    if (next === UNKNOWN) return forget(known, [list.name]);
    known.set(list.name, rows.map((r) => (r === row ? { ...row, [field]: next } : r)));
  };
  for (const ex of app.examples.filter(own)) {
    const known = initial();
    run(known, [...handlers("start"), ...handlers("open")]);
    for (const s of ex.steps) {
      if (s.do === "see" || s.do === "snapshot" || s.do === "random" || s.do === "steer") continue;
      const hit = "target" in s && typeof s.target === "string" ? find(app.screen, s.target) : undefined;
      const list = hit?.lists[hit.lists.length - 1];
      if (s.do === "click" && hit?.el.kind === "button" && hit.el.enabledWhen) {
        const row = list ? rowAt(list, s.at, known) : undefined;
        const decided = list && !row ? undefined : holds(hit.el.enabledWhen, (n) => (known.has(n) ? known.get(n)! : UNKNOWN), row);
        if (decided === false) {
          const where = s.at ? ` on row ${s.at.with !== undefined ? `with ${JSON.stringify(s.at.with)}` : s.at.row}` : "";
          err(s.line, "STEP", `\`click ${s.target}${where}\`: the button is disabled here (\`enabled when ${hit.el.enabledWhen}\` does not hold), and a disabled button cannot be clicked, so no build can pass this step. Prove it with \`see ${s.target}${where} is disabled\` instead`);
          break;
        }
      }
      const nested = !!list && hit!.lists.length > 1;
      if (s.do === "type" && hit) {
        if (list) nested ? forget(known, hit.lists.map((l) => l.name)) : setInRow(known, list, s.at, hit.el.name, () => s.text);
        else if (hit.el.kind === "field") known.set(hit.el.name, s.text);
        run(known, handlers("type", s.target));
      } else if (s.do === "choose" && hit) {
        if (list) nested ? forget(known, hit.lists.map((l) => l.name)) : setInRow(known, list, s.at, hit.el.name, () => s.value);
        else known.set(hit.el.name, s.value);
        run(known, handlers("choose", s.target));
      } else if (s.do === "toggle" && hit) {
        const cur = known.get(hit.el.name);
        if (list) nested ? forget(known, hit.lists.map((l) => l.name)) : setInRow(known, list, s.at, hit.el.name, (v) => (typeof v === "boolean" ? !v : UNKNOWN));
        else known.set(hit.el.name, typeof cur === "boolean" ? !cur : UNKNOWN);
        run(known, handlers("toggle", s.target));
      } else if (s.do === "click" && hit) {
        if (list) forget(known, hit.lists.map((l) => l.name));
        run(known, handlers("click", s.target));
      } else if (s.do === "tick") {
        run(known, handlers("tick"));
      } else if (s.do === "restart") {
        const fresh = initial();
        for (const f of app.state) if (!f.stored) known.set(f.name, fresh.get(f.name)!);
        run(known, [...handlers("start"), ...handlers("open")]);
      } else if (s.do === "size") continue;
      else forgetAll(known); // open, back, another client's call, a request: not followed here
    }
  }
}
