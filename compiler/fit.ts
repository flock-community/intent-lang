// References fit where they are used. A sentence is English, but its `@references` are declared
// names with types, and the phrases the language knows put them in relations: `set @x to @y`,
// `increase @x`, `@x is @y`, `@x is above @y`, `@a's @b`, `the @b of the ticket`, `the ticket whose
// @id is @y`, `add a @Ticket with @title = @y`, `add @y to @xs`, `call … with @p = @y`. The checker
// holds every such pair to its types, and relations to their records: a `ref Ticket` is compared
// with a Ticket's key and nothing else, is looked up and not read like a record, and seeded rows
// point at rows that exist. The English between references stays free. A reference whose type
// cannot be known is left alone: this check never guesses.
import { LINE_BASE, type App, type Element, type Literal, type Stmt, type Type } from "./ast.ts";
import { typeToString } from "./parse.ts";
import { homeLists, homeOf, innerHomes, referencedHomes, refTypes } from "./homes.ts";
import { changeWords, DELTA_RE, parseChange } from "./changes.ts";
import { DRAW_FORMS, drawSpace, findDraws, spaceSize, strayDraw, type DrawFact } from "./draws.ts";
export { homeLists, homeOf, referencedHomes, refTypes };

type Err = (l: number, c: string, m: string, col?: number) => void;

/** What a reference is: a value of a type (and, for a record's key field, whose key it is), a choice value, or unknown. */
type Fit = { k: "type"; t: Type; keyOf?: string } | { k: "value"; choices: string[] } | { k: "unknown" };

const UNKNOWN: Fit = { k: "unknown" };
const REF = "@([A-Za-z]\\w*(?:\\.[A-Za-z]\\w*)*)";
// A reference ends a phrase here; one followed by words that compute ("plus 1", ", trimmed") is not checked whole.
const END = "(?=\\s*(?:$|[,)]|\\band\\b|\\bor\\b|\\bto the\\b|\\bat the\\b|\\bfrom\\b|\\bwhen\\b|\\bthen\\b))";
// A comparison's subject begins its clause: `if @x is …`, `, @x is …`, `@c's @x is …`. A reference in
// the middle of a phrase (`the @check of the given @source is …`) is an argument, not the subject.
const SUBJECT = "(?:^|(?<=\\b(?:if|when|and|or|unless|while|not)\\s)|(?<=[,(]\\s?)|(?<=['’]s\\s))";
// A row's field: `its @newItem`, `that task's @items` (a row's inner list, where records are added and removed).
const ROW_FIELD = "(?:its|(?:that|this)\\s+[a-z]\\w*['’]s)\\s+@[a-z]\\w*";
// A list records are added to: a state list (`@xs`) or a row's inner list.
const LIST_AT = `(?:@[a-z]\\w*|${ROW_FIELD})`;
const NUM_CMP = "(?:above|below|at least|at most|more than|less than|at or before|at or after|after|before|later than|earlier than|greater than|smaller than)";

export interface Coverage {
  line: number;
  where: string;
  text: string;
  typed: boolean;
}

/** Every sentence with a reference in this app, and whether it is typed whole (`intent check --typed`). */
export function typedCoverage(app: App): Coverage[] {
  return checkFit(app, () => {});
}

/** A read through a reference (`its @ticket's @subject`): where, what it follows, and how its none case is said. */
export interface Navigation {
  line: number;
  where: string;
  chain: string;
  follows: string[]; // "Comment.ticket in tickets": each reference followed, and its home
  fallback: boolean; // the sentence says what then (`, or … when there is none`)
  guarded: boolean; // inside `if … exists { }` (or after `if … does not exist { stop }`)
  condition: boolean; // compared or asked: false when there is none (§9)
  list: boolean; // through a list: the rows whose reference finds nothing are left out
}

/** `skip`: lines with a SYNTAX error, whose sentences are not typed (what the parser read of them is not what was meant). */
export function checkFit(app: App, err: Err, skip: Set<number> = new Set()): Coverage[] {
  const records = new Map(app.records.map((r) => [r.name, r]));
  const refined = new Map((app.refined ?? []).map((r) => [r.name, r]));
  const choiceOf = new Map<string, string[]>(); // value → the choices it belongs to
  for (const c of app.choices) for (const v of c.values) choiceOf.set(v, [...(choiceOf.get(v) ?? []), c.name]);
  const isChoice = (name: string) => app.choices.some((c) => c.name === name);
  const state = new Map(app.state.map((f) => [f.name, f.type]));
  const params = new Map((app.params ?? []).map((p) => [p.name, p.type]));
  const keyOf = (r: string) => records.get(r)?.fields.find((f) => f.name === (records.get(r)!.key ?? "id"))?.name;
  // A bare field name (`@status`): its type when every record that has it agrees.
  const fieldTypes = new Map<string, Type | null>();
  for (const r of app.records)
    for (const f of r.fields) {
      const before = fieldTypes.get(f.name);
      fieldTypes.set(f.name, before === undefined ? f.type : before && same(before, f.type) ? before : null);
    }
  const recordNamed = (word: string) => {
    const one = (w: string) => [...records.keys()].find((r) => r[0].toLowerCase() + r.slice(1) === w || r.toLowerCase() === w);
    return one(word) ?? (word.endsWith("s") ? one(word.slice(0, -1)) : undefined); // "the tickets whose …"
  };
  const strip = (t: Type): Type => (t.k === "Maybe" ? t.of : t);
  const recordOf = (t: Type | undefined): string | undefined => {
    const inner = t && strip(t);
    return inner?.k === "Named" && records.has(inner.name) ? inner.name : undefined;
  };
  const listItem = (t: Type | undefined): Type | undefined => {
    const inner = t && strip(t);
    return inner?.k === "List" ? inner.of : undefined;
  };
  const base = (t: Type): Type => (t.k === "Named" && refined.has(t.name) ? { k: refined.get(t.name)!.base } : t);
  /** A type a value can be drawn from: a choice, an `Int from a to b`, a code (`Text of 6 digits`); its bits. */
  const drawable = (name: string): { t: Type; bits: number } | undefined => {
    const sp = drawSpace(app, name);
    return sp ? { t: { k: "Named", name }, bits: Math.log2(spaceSize(sp)) } : undefined;
  };
  // A key is an Int or a Text (compiler/parse.ts says so when it is not). A key that is itself a
  // reference (`key id: ref Item`) is that error, never a chain to follow: it would never end.
  const keyType = (r: string): Type => {
    const t = records.get(r)?.fields.find((f) => f.name === keyOf(r))?.type ?? { k: "Int" };
    return t.k === "Ref" || (t.k === "Maybe" && t.of.k === "Ref") ? { k: "Int" } : t;
  };
  const show = (t: Type) => typeToString(t);
  const declaredField = (name: string) => fieldTypes.has(name) || state.has(name) || derivedTypes.has(name);

  // ---------------------------------------------------------------- types of derived values
  // Declared (`total: Decimal = …`), or read from the forms the language knows.
  const derivedTypes = new Map<string, Type | undefined>();
  for (const d of app.derive) derivedTypes.set(d.name, d.type);
  const infer = (sentence: string): Type | undefined => {
    const s = sentence.trim();
    let m: RegExpMatchArray | null;
    if (/^"(?:[^"\\]|\\.)*"$/.test(s)) return { k: "Text" };
    if (/^(the number of|how many)\b/.test(s)) return { k: "Int" };
    if ((m = s.match(/^@([a-z]\w*)$/))) return typeOfName(m[1]);
    // the @xs whose … / that … / sorted …: the same list
    if ((m = s.match(/^(?:the\s+)?@([a-z]\w*)\s*,?\s+(?:whose|where|that|which|sorted|in\b|with\b|without\b|not\b)/))) {
      const t = typeOfName(m[1]);
      if (t && strip(t).k === "List") return strip(t);
    }
    // the @field of the ticket whose …, or <default>: the field's type
    if ((m = s.match(/^the\s+@([a-z]\w*)\s+of\s+the\s+([a-z]\w*)\s+(?:whose|where)\b/))) {
      const rec = recordNamed(m[2]);
      const f = rec ? records.get(rec)!.fields.find((x) => x.name === m![1]) : undefined;
      if (f) return /,\s*or\s+nothing\b/.test(s) || !/,\s*or\s+/.test(s) ? (f.type.k === "Maybe" ? f.type : { k: "Maybe", of: f.type }) : strip(f.type);
    }
    // the ticket whose …: one row, which may be missing
    if ((m = s.match(/^the\s+([a-z]\w*)\s+(?:whose|where)\b/))) {
      const rec = recordNamed(m[1]);
      if (rec) return { k: "Maybe", of: { k: "Named", name: rec } };
    }
    return undefined;
  };
  // Values the app's layers provide (`@caller`), and a fresh secret in an api (`@newToken`).
  const provided = new Map<string, Type>((app.layers ?? []).flatMap((l) => (l.spec?.provides ?? []).map((f) => [f.name, f.type] as [string, Type])));
  if (app.profile === "api") provided.set("newToken", { k: "Text" });
  const typeOfName = (name: string): Type | undefined => state.get(name) ?? params.get(name) ?? derivedTypes.get(name) ?? provided.get(name);
  for (let pass = 0; pass < 3; pass++)
    for (const d of app.derive) if (!d.type && !derivedTypes.get(d.name)) derivedTypes.set(d.name, infer(d.sentence));

  /** Can a value of type `from` go where `to` is wanted? A reference holds its record's key and fits only it. */
  function fits(to: Type, from: Type): boolean {
    if (to.k === "Maybe") return from.k === "Maybe" ? fits(to.of, from.of) : fits(to.of, from);
    if (from.k === "Maybe") return false;
    if (to.k === "Ref" && from.k === "Ref") return to.name === from.name;
    if (to.k === "Ref") return fits(keyType(to.name), from);
    if (from.k === "Ref") return fits(to, keyType(from.name));
    const a = base(to);
    const b = base(from);
    if (a.k === "Decimal" && b.k === "Int") return true;
    if (a.k === "List" && b.k === "List") return fits(a.of, b.of);
    if (a.k === "Named" && b.k === "Named") return a.name === b.name;
    return a.k === b.k;
  }
  /** Can two values be compared (`@x is @y`)? */
  const comparable = (a: Type, b: Type) => fits(strip(a), strip(b)) || fits(strip(b), strip(a));
  const valueFits = (to: Type, v: string[]) => {
    const inner = strip(to);
    return inner.k !== "Named" || !isChoice(inner.name) || v.includes(inner.name);
  };
  const numeric = (t: Type) => ["Int", "Decimal"].includes(base(strip(t)).k);
  const temporal = (t: Type) => ["Date", "DateTime"].includes(base(strip(t)).k);
  const literalType = (lit: string): Type | undefined => (/^-?\d+$/.test(lit) ? { k: "Int" } : /^-?\d+\.\d+$/.test(lit) ? { k: "Decimal" } : /^"/.test(lit) ? { k: "Text" } : /^(true|false)$/.test(lit) ? { k: "Bool" } : undefined);

  /** The fit of a reference, in a scope (loop rows, endpoint params) and a row (a list's record). */
  const fitOf = (ref: string, scope: Map<string, Type>, row?: string): Fit => {
    if (ref.includes(".") && scope.has(ref)) return { k: "type", t: scope.get(ref)! }; // smart-cast (`if there is a @toast.message`)
    if (ref.includes(".")) {
      const [part, name] = ref.split(".");
      if (["path", "query", "body"].includes(part) && scope.has(name)) return { k: "type", t: scope.get(name)! };
      const rowOf2 = recordOf(scope.get(part));
      const loopField = rowOf2 ? records.get(rowOf2)!.fields.find((f) => f.name === name) : undefined;
      if (loopField) return { k: "type", t: loopField.type }; // a loop row's field (`@notice.expiresAt`)
      const own = typeOfName(ref); // a component instance's state or derived value (`toast.message`)
      if (own) return { k: "type", t: own };
      return UNKNOWN; // an alias's endpoint, a component's untyped name
    }
    if (scope.has(ref)) return { k: "type", t: scope.get(ref)! };
    // Inside a row, a field of the row's record wins over an app-level name (SHADOWED).
    const inRow = row ? records.get(row)?.fields.find((f) => f.name === ref) : undefined;
    if (inRow) return { k: "type", t: inRow.type, ...(keyOf(row!) === ref ? { keyOf: row } : {}) };
    const t = typeOfName(ref);
    if (t) return { k: "type", t };
    if (derivedTypes.has(ref)) return UNKNOWN; // a derived value whose type is not known
    if (ref === "now") return { k: "type", t: { k: "DateTime" } };
    if (ref === "today") return { k: "type", t: { k: "Date" } };
    if (ref === "size" && app.sizes) return { k: "type", t: { k: "Named", name: "Size" } };
    if (choiceOf.has(ref)) return { k: "value", choices: choiceOf.get(ref)! };
    const rowField = row ? records.get(row)?.fields.find((f) => f.name === ref) : undefined;
    if (rowField) return { k: "type", t: rowField.type, ...(keyOf(row!) === ref ? { keyOf: row } : {}) };
    const ft = fieldTypes.get(ref);
    return ft ? { k: "type", t: ft } : UNKNOWN;
  };

  /** A reference compared with a record's key: it must refer to that record. */
  const relation = (a: Fit, b: Fit): string | undefined => {
    for (const [x, y] of [[a, b], [b, a]] as const) {
      if (x.k !== "type" || y.k !== "type") continue;
      const r = strip(x.t);
      if (r.k === "Ref" && y.keyOf && y.keyOf !== r.name) return `refers to a ${r.name}, but is compared with a ${y.keyOf}'s key`;
    }
    if (a.k === "type" && b.k === "type" && a.keyOf && b.keyOf && a.keyOf !== b.keyOf) return `is a ${a.keyOf}'s key, the other a ${b.keyOf}'s`;
    return undefined;
  };

  // ---------------------------------------------------------------- the typer
  // The common operators, each with a typing rule (the inventory of every spec: they carry most
  // sentences with references). A value built from forms it does not know is untyped — left to
  // judgement, and counted as such — never guessed.
  type Value = Fit | { k: "nothing" } | { k: "error"; msg: string } | undefined;
  const T = (t: Type): Value => ({ k: "type", t });
  const wrong = (msg: string): Value => ({ k: "error", msg });
  const balanced = (x: string) => {
    let d = 0, q = false;
    for (let i = 0; i < x.length; i++) {
      if (x[i] === '"' && x[i - 1] !== "\\") q = !q;
      if (q) continue;
      if (x[i] === "(") d++;
      if (x[i] === ")" && --d < 0) return false;
    }
    return d === 0 && !q;
  };
  /** The last place one of `ops` occurs outside strings and brackets (so operators group to the left). */
  const topLevel = (x: string, ops: string[]): { at: number; op: string } | undefined => {
    let d = 0, q = false, hit: { at: number; op: string } | undefined;
    for (let i = 0; i < x.length; i++) {
      if (x[i] === '"' && x[i - 1] !== "\\") q = !q;
      if (q) continue;
      if (x[i] === "(") d++;
      else if (x[i] === ")") d--;
      else if (d === 0 && i > 0) for (const op of ops) if (x.startsWith(op, i)) hit = { at: i, op };
    }
    return hit;
  };
  /** Every place `topLevel` would find, from the right, in `x` and then in what is before each hit
   *  (`x.slice(0, hit.at)`), left to right: one pass instead of one pass per hit. */
  const chainOf = (x: string, ops: string[]): { at: number; op: string }[] => {
    const hits: { at: number; op: string }[] = [];
    let d = 0, q = false;
    for (let i = 0; i < x.length; i++) {
      if (x[i] === '"' && x[i - 1] !== "\\") q = !q;
      if (q) continue;
      if (x[i] === "(") d++;
      else if (x[i] === ")") d--;
      else if (d === 0 && i > 0) for (const op of ops) if (x.startsWith(op, i)) hits.push({ at: i, op });
    }
    // From the right, each hit ends where the one after it was found (the text before a hit is what is searched next).
    const chain: { at: number; op: string }[] = [];
    let end = x.length;
    for (let k = hits.length - 1; k >= 0; k--) if (hits[k].at + hits[k].op.length <= end) (chain.push(hits[k]), (end = hits[k].at));
    return chain.reverse();
  };
  const typeOfValue = (v: Value): Type | undefined => (v?.k === "type" ? v.t : undefined);
  // Nothing-safety (Kotlin's null safety): a `T or nothing` is not a `T`. Where a T is needed, a value
  // that may be nothing is an error (NOTHING, marked ∅ in the message until it is said), unless the
  // sentence says what then (an elvis: `…, or X when there is none`, under which nothing propagates:
  // `safe`), or a guard has smart-cast it (`if there is a @x { … }`).
  let safe = 0;
  const NOTHING_HOW = "say what then (`…, or … when there is none`), or ask first (`if there is a …`, `if … exists`)";
  const nothingErr = (what: string, t: Type | { k: "nothing" }): Value => wrong(`∅${what}, and the value ${t.k === "nothing" ? "is nothing" : `may be nothing (${show(t as Type)})`}: ${NOTHING_HOW}`);
  const maybe = (t: Type): Type => (t.k === "Maybe" ? t : { k: "Maybe", of: t });
  const needs = (inner: Value, ok: (t: Type) => boolean, what: string, result: Type | undefined): Value => {
    if (inner?.k === "error") return inner;
    if (inner?.k === "nothing") return safe ? (result ? T(maybe(result)) : undefined) : nothingErr(what, inner);
    const t = typeOfValue(inner);
    if (t && !ok(t)) return wrong(`${what}, not ${show(t)}`);
    if (t?.k === "Maybe") return safe ? (result ? T(maybe(result)) : undefined) : nothingErr(what, t);
    return result ? T(result) : undefined;
  };
  const isText = (t: Type) => base(strip(t)).k === "Text";
  let inText = false; // typing a template's hole: every value is shown as text
  let it: string | undefined; // the record "its @f" and "that ticket" mean in the sentence being checked

  // ---------------------------------------------------------------- following a reference
  // A chain of fields: `@c's @body`, `its @ticket's @subject`, `that comment's @ticket's @status`.
  // A `ref R` followed by `'s @f` reads the field of the row it points at (in R's home list): the
  // value is `T or nothing` (the row may be gone), unless the chain starts from a list, whose rows
  // with a missing target are left out. `guards` are the parts that are references followed (their
  // keys, as `exists` names them), `follows` the references (`Comment.ticket`), `homes` where each is looked up.
  type Chain = { t?: Type; first: Fit; hops: string[]; list: boolean; guards: string[]; follows: string[]; homes: { rec: string; list?: string; problem?: string }[]; missing?: { rec: string; field: string } };
  const CHAIN_SRC = "(?:\\b(its)\\s+|\\b(that|this|the)\\s+([a-z]\\w*)['’]s\\s+)?@([a-z]\\w*(?:\\.[a-z]\\w*)*)((?:['’]s\\s+@[a-z]\\w*)*)";
  const chainInfo = (text: string, scope: Map<string, Type>, row?: string): Chain | undefined => {
    const m = text.trim().match(new RegExp(`^${CHAIN_SRC}$`));
    if (!m) return undefined;
    const hops = [...m[5].matchAll(/@([a-z]\w*)/g)].map((y) => y[1]);
    let first: Fit;
    let owner: string; // the start, as a guard names it: `~ticket` for the row's field (its / that comment's / a bare row field)
    let holder: string; // what holds the current value: `Comment.ticket`, or a state field's name
    if (m[1] || m[2]) {
      const rec = m[1] ? (row ?? it) : recordNamed(m[3]);
      const f = rec ? records.get(rec)?.fields.find((y) => y.name === m[4]) : undefined;
      if (!f) return rec && declaredField(m[4]) ? { first: UNKNOWN, hops, list: false, guards: [], follows: [], homes: [], missing: { rec, field: m[4] } } : undefined;
      first = { k: "type", t: f.type };
      owner = `~${m[4]}`;
      holder = `${rec}.${m[4]}`;
    } else {
      first = fitOf(m[4], scope, row);
      const inRow = row && !scope.has(m[4]) && records.get(row)?.fields.some((f) => f.name === m[4]);
      owner = inRow ? `~${m[4]}` : `@${m[4]}`;
      const fieldOf = !inRow && !scope.has(m[4]) && !state.has(m[4]) && !derivedTypes.has(m[4]) ? app.records.find((r) => r.fields.some((f) => f.name === m[4]))?.name : undefined;
      holder = inRow ? `${row}.${m[4]}` : fieldOf ? `${fieldOf}.${m[4]}` : m[4];
    }
    if (first.k !== "type") return { first, hops, list: false, guards: [], follows: [], homes: [] };
    let t: Type = first.t;
    const list = !!listItem(t);
    let optional = false;
    const guards: string[] = [];
    const follows: string[] = [];
    const homes: Chain["homes"] = [];
    for (let i = 0; i < hops.length; i++) {
      const item = listItem(t);
      let cur = strip(item ?? t);
      // `'s` is a safe call (Kotlin's `?.`): from a value that may be nothing, the result may be nothing.
      if (!item && t.k === "Maybe") optional = true;
      if (cur.k === "Ref") {
        const home = homeOf(app, cur.name, cur.in);
        homes.push({ rec: cur.name, ...home });
        follows.push(`${holder}${home.list ? ` in ${home.list}` : ""}`);
        const key = [owner, ...hops.slice(0, i)].join("/");
        // Inside `if … exists { }` the row is there (a smart cast); otherwise it may be gone.
        if (!item && !scope.has(`∃${key}`)) optional = true;
        guards.push(key);
        cur = { k: "Named", name: cur.name };
      }
      const rec = recordOf(cur);
      const f = rec ? records.get(rec)!.fields.find((y) => y.name === hops[i]) : undefined;
      if (!f) return { first, hops, list, guards, follows, homes, ...(rec ? { missing: { rec, field: hops[i] } } : {}) };
      holder = `${rec}.${hops[i]}`;
      // Through a list, a field that is a list itself flattens: `@orders's @lines` is every line of
      // every order, in order (a join), not a list of lists.
      t = item ? (listItem(f.type) ? strip(f.type) : { k: "List", of: f.type }) : f.type;
    }
    if (optional && t.k !== "Maybe") t = { k: "Maybe", of: t };
    return { t, first, hops, list, guards, follows, homes };
  };
  /** The key a guard (`… exists`) gives the reference it names: the row's field is `~ticket` however it is said. */
  const guardKey = (text: string, scope: Map<string, Type>, row?: string): string | undefined => {
    const m = text.trim().match(new RegExp(`^${CHAIN_SRC}$`));
    if (!m) return undefined;
    const inRow = !m[1] && !m[2] && row && !scope.has(m[4]) && records.get(row)?.fields.some((f) => f.name === m[4]);
    return [m[1] || m[2] || inRow ? `~${m[4]}` : `@${m[4]}`, ...[...m[5].matchAll(/@([a-z]\w*)/g)].map((y) => y[1])].join("/");
  };
  /** A guard key back in words: `~ticket/customer` → `its @ticket's @customer`. */
  const spellKey = (g: string) => {
    const [o, ...rest] = g.split("/");
    return [o.startsWith("~") ? `its @${o.slice(1)}` : o, ...rest.map((r) => `@${r}`)].join("'s ");
  };

  // ---------------------------------------------------------------- smart casts
  // Like Kotlin's: a condition that asks whether a value is there makes it a `T` where it holds —
  // inside `if there is a @x { … }`, after `if there is no @x { stop }`, in the `else` of `if there is
  // no @x`, in the rest of `there is a @x and …`, in the other alternatives of `…, or X when there is
  // no @x`. `@x is not nothing` / `is set` / `is nothing` ask the same. `… exists` / `does not exist`
  // do it for the row a reference points at (`∃key` in the scope, with the home list it lives in).
  // In the scope, `⊢x` keeps x's type before the cast: a step that may change @x ends it.
  /** One condition, masked: an "or" or "and" inside a phrase ("at or before", "3 or more", "or nothing") does not join two. */
  const maskJoins = (c: string) => c.replace(/"(?:[^"\\]|\\.)*"/g, '""').replace(/\b(at|or) or (before|after|more|less|fewer|higher|lower|nothing)\b|\b(\d+(?:\.\d+)?) or (more|less|fewer|higher|lower)\b|,? or nothing\b/g, (x) => x.replace(/ /g, "_"));
  /** The names a condition asks to be there (`holds`), or asks to be absent (when it does not hold, they are there). */
  const presentNames = (cond: string, holds: boolean): string[] => {
    const c = maskJoins(cond);
    if ((holds ? /\sor\s/ : /\sand\s/).test(c)) return [];
    const re = holds ? /\bthere\s+is\s+(?:a|an)\s+@([a-z][\w.]*)|(?<!['’]s\s)@([a-z][\w.]*)\s+(?:is\s+(?:not\s+nothing|set)\b|exists\b)/g : /\bthere\s+is\s+no\s+@([a-z][\w.]*)|(?<!['’]s\s)@([a-z][\w.]*)\s+(?:is\s+nothing\b|does\s+not\s+exist\b)/g;
    return [...c.matchAll(re)].map((m) => m[1] ?? m[2]);
  };
  /** The references whose row a condition asks to be there (`holds`), or asks to be gone. */
  const existKeys = (cond: string, holds: boolean, sc: Map<string, Type>, row?: string): { key: string; home?: string }[] => {
    if ((holds ? /\sor\s/ : /\sand\s/).test(maskJoins(cond))) return [];
    const out: { key: string; home?: string }[] = [];
    for (const m of cond.matchAll(new RegExp(`(${CHAIN_SRC})\\s+${holds ? "exists" : "does\\s+not\\s+exist"}\\b`, "g"))) {
      const key = guardKey(m[1], sc, row);
      const t = typeOfValue(typeExpr(m[1], sc, row));
      const r = t && strip(t);
      if (key) out.push({ key, home: r?.k === "Ref" ? homeOf(app, r.name, r.in).list : undefined });
    }
    return out;
  };
  /** The scope where `cond` holds (or, with `holds` false, where it does not). */
  const narrowBy = (sc: Map<string, Type>, cond: string | undefined, holds: boolean, row?: string): Map<string, Type> => {
    if (!cond) return sc;
    const out = new Map(sc);
    for (const n of presentNames(cond, holds)) {
      const f = fitOf(n, sc, row);
      if (f.k !== "type" || f.t.k !== "Maybe") continue;
      if (!out.has(`⊢${n}`)) out.set(`⊢${n}`, f.t);
      out.set(n, f.t.of);
    }
    for (const k of existKeys(cond, holds, sc, row)) out.set(`∃${k.key}`, { k: "Named", name: k.home ?? "" });
    // `if there is no locker in @empty whose @size is … { answer 409 }`: after it, that list has a row,
    // so its highest / lowest is there (until any step changes state: a list may be derived).
    const c = maskJoins(cond).trim();
    let m: RegExpMatchArray | null;
    if ((m = c.match(/^there\s+is\s+(a|an|no)\s+[a-z]\w*\s+in\s+(@[a-z][\w.]*(?:\s+(?:whose|where)\s+.+)?)$/)) && (m[1] === "no") !== holds) out.set(`∃rows:${rowsKey(cond.trim().replace(/^there\s+is\s+(?:a|an|no)\s+[a-z]\w*\s+in\s+/, ""))}`, { k: "Bool" });
    if ((m = c.match(/^(@[a-z][\w.]*)\s+is\s+(not\s+)?empty$/)) && !!m[2] === holds) out.set(`∃rows:${rowsKey(m[1])}`, { k: "Bool" });
    return out;
  };
  const rowsKey = (list: string) => list.trim().replace(/^the\s+/, "").replace(/\s+/g, " ");
  /** The state a step may change: `set @x`, `clear @x`, `add … to @xs`, `remove … from @xs`, `increase @n`. */
  const writes = (text: string): Set<string> => {
    const out = new Set<string>();
    const t = text.replace(/"(?:[^"\\]|\\.)*"/g, '""');
    for (const m of t.matchAll(/\b(?:set|increase|decrease|reset)\s+(?:its\s+|the\s+)?@([a-z][\w.]*)/g)) out.add(m[1]);
    for (const m of t.matchAll(/(?:,|\band)\s+@([a-z][\w.]*)\s+to\b/g)) out.add(m[1]);
    for (const m of t.matchAll(/\bclear\s+([^;]+)/g)) for (const r of m[1].matchAll(/@([a-z][\w.]*)/g)) out.add(r[1]);
    for (const m of t.matchAll(/\b(?:add|remove|put|insert|append|move)\b[^;]*?\b(?:to|from|into|at)\s+(?:the\s+(?:end|start)\s+of\s+)?@([a-z][\w.]*)/g)) out.add(m[1]);
    for (const m of t.matchAll(/\bremove\s+from\s+@([a-z][\w.]*)/g)) out.add(m[1]);
    return out;
  };
  /** The scope after a step that changes `names`: their casts end (Kotlin does not keep a smart cast across a possible write). */
  const unsettle = (sc: Map<string, Type>, names: Set<string>): Map<string, Type> => {
    if (!names.size) return sc;
    const out = new Map(sc);
    for (const [k, v] of sc) {
      if (k.startsWith("⊢") && names.has(k.slice(1))) {
        out.set(k.slice(1), v);
        out.delete(k);
      }
      if (k.startsWith("∃rows:")) out.delete(k);
      else if (k.startsWith("∃")) {
        const root = k.slice(2).split("/")[0];
        if (names.has(root) || (v.k === "Named" && names.has(v.name))) out.delete(k);
      }
    }
    return out;
  };

  /**
   * A value that depends on a condition: `A when C; B when D`, `A when C, otherwise B`, and the elvis
   * `A, or B when there is none` (also `A (B when there are none)`): under it, what A reads may be
   * nothing (it propagates), and B is what the value is then. `…, or B when there is no @x` smart-casts
   * @x in the other alternatives; each alternative sees its own condition hold, and the conditions
   * before it not.
   */
  const NONE_COND = /^(?:there\s+(?:is|are)\s+(?:none|nothing|no\s+(?:such\s+)?[a-z]\w*)|none|it\s+is\s+(?:nothing|empty|blank)|there\s+is\s+no\s+@[a-z][\w.]*|@[a-z][\w.]*\s+is\s+nothing|.+\s+does\s+not\s+exist)$/;
  const alternatives = (parts: { v: string; cond?: string }[], scope: Map<string, Type>, row?: string): Value => {
    const isNone = (c?: string) => !!c && NONE_COND.test(c);
    const elvis = parts.some((p) => isNone(p.cond));
    let untyped = false;
    let optional = false;
    const types: Type[] = [];
    let before = scope; // where the conditions of the alternatives before this one do not hold
    for (const p of parts) {
      if (p.cond) {
        const c = typeCond(p.cond, before, row);
        if (c) return wrong(c);
        if (c === undefined) untyped = true;
      }
      let sc = narrowBy(before, p.cond, true, row);
      // `…, or 0 when there is no @n`: where the others apply, @n is there.
      if (!isNone(p.cond)) for (const q of parts) if (q !== p && isNone(q.cond)) sc = narrowBy(sc, q.cond, false, row);
      const under = elvis && !isNone(p.cond);
      if (under) safe++;
      const v = typeExpr(p.v, sc, row);
      if (under) safe--;
      before = narrowBy(before, p.cond, false, row);
      if (v?.k === "error") return v;
      if (v?.k === "nothing") {
        optional = true;
        continue;
      }
      const t = typeOfValue(v) ?? (v?.k === "value" && v.choices.length === 1 ? ({ k: "Named", name: v.choices[0] } as Type) : undefined);
      if (!t) {
        untyped = true;
        continue;
      }
      if (t.k === "Maybe" && !under) optional = true;
      types.push(under ? strip(t) : t);
    }
    if (untyped || !types.length) return undefined;
    // In a template every alternative is shown as text; elsewhere they share one type.
    if (inText) return T(optional ? { k: "Maybe", of: { k: "Text" } } : { k: "Text" });
    const first = strip(types[0]);
    if (!types.every((t) => comparable(t, first))) return wrong(`the alternatives are ${types.map(show).join(" and ")}: one value has one type`);
    const one = strip(types.find((t) => base(strip(t)).k === "Decimal") ?? first);
    return T(optional ? { k: "Maybe", of: one } : one);
  };

  const typeExpr =(raw: string, scope: Map<string, Type>, row?: string): Value => {
    let x = raw.trim().replace(/[;.,]$/, "").trim();
    while (/^\(.*\)$/.test(x) && balanced(x.slice(1, -1))) x = x.slice(1, -1).trim();
    const at = (e: string) => typeExpr(e, scope, row);
    let m: RegExpMatchArray | null;
    if (x === "nothing") return { k: "nothing" };
    // A template: each hole is shown as text, and what is shown is not nothing.
    if (/^".*"$/s.test(x) && /^"(?:[^"\\]|\\.)*"$/.test(x.replace(/\{[^{}]*\}/g, "")) && /\{[^{}]*@[^{}]*\}/.test(x)) {
      const was = inText;
      inText = true;
      try {
        for (const h of [...x.matchAll(/\{([^{}]*)\}/g)].map((y) => y[1]).filter((y) => /@/.test(y))) {
          const v = typeExpr(h, scope, row);
          if (v?.k === "error") return v;
          if (!safe && (v?.k === "nothing" || (v?.k === "type" && v.t.k === "Maybe"))) return nothingErr(`\`{${h.trim()}}\` is shown as text`, v.k === "nothing" ? v : v.t);
        }
      } finally {
        inText = was;
      }
      return T({ k: "Text" });
    }
    if (/^"(?:[^"\\]|\\.)*"$/.test(x) || /^-?\d+(?:\.\d+)?$/.test(x) || /^(true|false)$/.test(x)) return T(literalType(x)!);
    // A trailing note in brackets (`+ 1 (1 when there are none)`) says what happens at the edges; the value is before it.
    // A note that says what the value is when there is none is an elvis over all of it.
    if (/\)$/.test(x) && !/^\(/.test(x)) {
      const open = x.lastIndexOf(" (");
      if (open > 0 && balanced(x.slice(open + 1))) {
        const e = x.slice(open + 2, -1).match(/^(.+?)\s+(?:when|if)\s+there\s+(?:is|are)\s+(?:none|no\b.*|nothing)$/);
        return e ? alternatives([{ v: x.slice(0, open), cond: undefined }, { v: e[1], cond: "there is none" }], scope, row) : at(x.slice(0, open));
      }
    }
    // `…, rounded down` / `…, trimmed`: after a comma, a postfix word applies to everything before it.
    const post = topLevel(x, [", rounded", ", trimmed", ", in capitals"]);
    if (post) return at(`(${x.slice(0, post.at)})${x.slice(post.at + 1)}`);
    // Tails that keep the type: an order (`, highest @id first`, `, in list order`) or a bound (`, but at least 0`).
    if ((m = x.match(/^(.+?),\s+(?:(?:highest|lowest|newest|oldest|latest|earliest|largest|smallest)\s+@[a-z]\w*\s+first|in\s+(?:list|their|its|the\s+same)\s+order|in\s+the\s+order\s+of\s+.+|sorted\s+by\s+.+|but\s+at\s+(?:least|most)\s+.+)$/))) return at(m[1]);
    // A value that depends on a condition: `A when C; B when D`, `A when C, otherwise B`, `A while C, otherwise B`.
    const alts: string[] = [];
    {
      const cuts = chainOf(x, ["; ", ", otherwise ", " otherwise ", ", or "]);
      cuts.forEach((c, i) => alts.push((i === 0 ? x.slice(0, c.at) : x.slice(cuts[i - 1].at + cuts[i - 1].op.length, c.at)).trim()));
      alts.push((cuts.length ? x.slice(cuts[cuts.length - 1].at + cuts[cuts.length - 1].op.length) : x).trim());
    }
    if (alts.length > 1 || topLevel(x, [" when ", " while "])) {
      return alternatives(alts.map((a) => {
        const w = topLevel(a, [" when ", " while "]);
        return { v: w ? a.slice(0, w.at).trim() : a, cond: w ? a.slice(w.at + w.op.length).trim() : undefined };
      }), scope, row);
    }
    // the sum of <a value of each row> over <a list> (as money): the value is read in each row, so
    // `the sum of @qty times @price over its @lines` adds up qty × price per line (before `times` splits it).
    if ((m = x.match(/^(?:the\s+)?sum\s+of\s+(?!the\s+@)(.+?)\s+over\s+(.+?)(\s+as\s+money)?$/)) && /\s(?:plus|minus|times|divided by|[-+×*\/])\s/.test(m[1])) {
      const list = at(m[2]);
      if (list?.k === "error") return list;
      const rec = recordOf(listItem(typeOfValue(list)));
      if (!rec) return undefined;
      const each = typeExpr(m[1], scope, rec);
      if (each?.k === "error") return each;
      const t = typeOfValue(each);
      if (!t) return undefined;
      if (!numeric(t)) return wrong(`\`the sum of … over …\` adds numbers, and ${m[1].trim()} is ${show(t)}`);
      if (t.k === "Maybe" && !safe) return nothingErr("`the sum of … over …` adds numbers", t);
      return T(m[3] ? { k: "Text" } : strip(t));
    }
    // Arithmetic: numbers in, a number out (a division, or any Decimal, gives a Decimal).
    // Left to right (`a minus b plus c` is `(a minus b) plus c`), folded in one pass: a long sum is not a deep recursion.
    for (const ops of [[" plus ", " minus ", " + ", " - "], [" times ", " × ", " * ", " divided by ", " / "]]) {
      const cuts = chainOf(x, ops);
      if (!cuts.length) continue;
      const parts = [x.slice(0, cuts[0].at), ...cuts.map((c, i) => x.slice(c.at + c.op.length, i + 1 < cuts.length ? cuts[i + 1].at : undefined))];
      // Time arithmetic (`@due plus 3 days`) is not typed here: from the last such part on, nothing is.
      const TIME = /\b(days?|hours?|minutes?|weeks?|months?|years?)\b/;
      let from = 0;
      for (let j = parts.length - 1; j >= 1; j--)
        if (TIME.test(parts[j])) {
          if (j === parts.length - 1) return undefined;
          from = j;
          break;
        }
      let acc: Value = from ? undefined : at(parts[0]);
      for (let j = from + 1; j < parts.length; j++) {
        const [l, r] = [acc, at(parts[j])];
        const op = cuts[j - 1].op.trim();
        acc = ((): Value => {
          if (l?.k === "error") return l;
          if (r?.k === "error") return r;
          const [lt, rt] = [typeOfValue(l), typeOfValue(r)];
          for (const [side, t] of [["left", lt], ["right", rt]] as const) if (t && !numeric(t)) return wrong(`\`${op}\` needs numbers, but the ${side} side is ${show(t)}`);
          const none = [l, r].find((v) => v?.k === "nothing" || (v?.k === "type" && v.t.k === "Maybe"));
          if (none && !safe) return nothingErr(`\`${op}\` needs numbers`, none.k === "nothing" ? none : (none as { t: Type }).t);
          if (!lt || !rt) return undefined;
          const dec = op === "divided by" || op === "/" || base(strip(lt)).k === "Decimal" || base(strip(rt)).k === "Decimal";
          return T(none ? { k: "Maybe", of: { k: dec ? "Decimal" : "Int" } } : { k: dec ? "Decimal" : "Int" });
        })();
      }
      return acc;
    }
    if ((m = x.match(/^(.+?),?\s+trimmed$/))) return needs(at(m[1]), isText, "`trimmed` needs text", { k: "Text" });
    if ((m = x.match(/^(.+?),?\s+in\s+(?:capitals|upper case|lower case)$/))) return needs(at(m[1]), isText, "a case change needs text", { k: "Text" });
    if ((m = x.match(/^(.+?),?\s+rounded\b(.*)$/))) {
      const inner = at(m[1]);
      const whole = !/cents/.test(m[2]) && (/whole number|down|up/.test(m[2]) || (typeOfValue(inner) && base(strip(typeOfValue(inner)!)).k === "Int"));
      return needs(inner, numeric, "`rounded` needs a number", { k: whole ? "Int" : "Decimal" });
    }
    // `@x read as a decimal` is the number; whether the text reads as one is asked apart (`@x reads as a decimal`).
    if ((m = x.match(/^(.+?)\s+read\s+as\s+(?:an?\s+)?(whole number|decimal|number)(?:\s*\([^)]*\))?$/)))
      return needs(at(m[1]), isText, "`read as` needs text", { k: m[2] === "whole number" ? "Int" : "Decimal" });
    if ((m = x.match(/^(.+?)\s+as\s+(?:money|a date|a moment|a clock)$/))) return needs(at(m[1]), (t) => numeric(t) || temporal(t), "`as …` needs a number or a moment", { k: "Text" });
    if ((m = x.match(/^(?:the\s+)?number\s+of\s+(.+)$/))) return needs(at(m[1]), (t) => !!listItem(t), "`the number of` counts a list", { k: "Int" });
    if ((m = x.match(/^(?:the\s+)?sum\s+of\s+(?:all\s+)?(?!@[a-z]\w*\s+over\s)(?!the\s+@[a-z]\w*\s+of\s)(.+)$/))) {
      const inner = at(m[1]);
      if (inner?.k === "error") return inner;
      const t = typeOfValue(inner);
      if (!t) return undefined;
      const item = listItem(t);
      return item && numeric(item) ? T(strip(item)) : wrong(`\`the sum of\` adds up a list of numbers, not ${show(t)}`);
    }
    if ((m = x.match(/^the\s+(highest|lowest|largest|smallest|greatest|latest|earliest)\s+@([a-z]\w*)\s+(?:in|of|among)\s+(.+)$/))) {
      const list = at(m[3]);
      const rec = recordOf(listItem(typeOfValue(list)));
      const f = rec ? records.get(rec)!.fields.find((y) => y.name === m![2]) : undefined;
      if (rec && !f && declaredField(m[2])) return wrong(`${rec} has no field \`${m[2]}\``);
      // An empty list has no highest: it may be nothing, unless a guard said the list has a row.
      return f ? T(scope.has(`∃rows:${rowsKey(m[3])}`) ? strip(f.type) : maybe(strip(f.type))) : undefined;
    }
    if ((m = x.match(/^not\s+(.+)$/))) return needs(at(m[1]), (t) => base(strip(t)).k === "Bool", "`not` needs a yes/no", { k: "Bool" });
    // `@x before` (a change rule's): the value before the step, of @x's type. A state field or derived
    // value was there before; a row's field may belong to a row that is new: then it is nothing.
    if ((m = x.match(/^((?:its\s+)?@([a-z][\w.]*)(?:['’]s\s+@[a-z]\w*)*)\s+before$/))) {
      const v = at(m[1]);
      const t = typeOfValue(v);
      if (!t) return v?.k === "error" ? v : undefined;
      const rowField = !!row && !!records.get(row)?.fields.some((f) => f.name === m![2]);
      const whole = !/^its\s/.test(m[1]) && !scope.has(m[2]) && !rowField && (state.has(m[2]) || derivedTypes.has(m[2]));
      return T(whole ? t : maybe(t));
    }
    // the new @xs / the removed @xs (a change rule's): rows of the list, so the list's type
    if ((m = x.match(/^the\s+(?:new|removed)\s+@([a-z][\w.]*)$/))) {
      const t = typeOfValue(at("@" + m[1]));
      return t ? (listItem(t) ? T(strip(t)) : wrong(`\`${x}\` is for a list, and @${m[1]} is ${show(t)}`)) : undefined;
    }
    // Draws (v69): a value from a type that lists its values; a list's item or order.
    // `the first 5 of @deck shuffled` is the first five of the shuffled deck: `the first` binds last.
    if ((m = x.match(/^the\s+first\s+(\d+|@[a-z][\w.]*)\s+(?:of|in)\s+(.+)$/))) {
      const t = typeOfValue(at(m[2]));
      return t && listItem(t) ? T(strip(t)) : at(m[2])?.k === "error" ? at(m[2]) : undefined;
    }
    if ((m = x.match(/^a\s+random\s+@([A-Z]\w*)\s+not\s+among\s+(.+)$/))) {
      const d = drawable(m[1]);
      if (!d) return undefined; // RANDOM (compiler/draws.ts)
      const list = at(m[2]);
      if (list?.k === "error") return list;
      // A space that can run out in a real app (under 2^64 values) may have none left.
      return T(d.bits >= 64 ? d.t : maybe(d.t));
    }
    if ((m = x.match(/^a\s+random\s+@([A-Z]\w*)$/))) {
      const d = drawable(m[1]);
      return d ? T(d.t) : undefined;
    }
    if ((m = x.match(/^(\d+|@[a-z][\w.]*)\s+random\s+@([A-Z]\w*)$/))) {
      const d = drawable(m[2]);
      return d ? T({ k: "List", of: d.t }) : undefined;
    }
    if ((m = x.match(/^a\s+random\s+one\s+of\s+(.+)$/))) {
      const list = at(m[1]);
      if (list?.k === "error") return list;
      const item = listItem(typeOfValue(list));
      // An empty list has none: it may be nothing.
      return item ? T(maybe(strip(item))) : undefined;
    }
    if ((m = x.match(/^(.+?),?\s+shuffled$/))) {
      const list = at(m[1]);
      if (list?.k === "error") return list;
      const t = typeOfValue(list);
      return t && listItem(t) ? T(strip(t)) : undefined;
    }
    // A reference, or a chain of fields (`@c's @body`, `its @ticket's @subject`): a list's field is a
    // list of that field; a field read through a reference may be nothing (chainInfo).
    if ((m = x.match(/^@([a-z]\w*(?:\.[a-z]\w*)*)((?:['’]s\s+@[a-z]\w*)*)$/)) || (m = x.match(/^(?:its|(?:that|this|the)\s+[a-z]\w*['’]s)\s+@[a-z]\w*(?:['’]s\s+@[a-z]\w*)+$/))) {
      const c = chainInfo(x, scope, row);
      if (!c) return undefined;
      if (c.first.k !== "type") return c.first.k === "unknown" ? undefined : c.first;
      if (!c.t) return undefined; // a missing field: reported where the chain is checked
      return c.first.keyOf && !c.hops.length ? c.first : T(c.t);
    }
    if ((m = x.match(/^@([A-Z]\w*)$/))) {
      const v = fitOf(m[1], scope, row);
      return v.k === "value" ? v : undefined;
    }
    // its body (an answer's or event's), the error (an answer that failed), its @f (the row's field)
    if (/^its\s+body$/.test(x)) return scope.has("its body") ? T(scope.get("its body")!) : undefined;
    if ((m = x.match(/^its\s+body['’]s\s+@([a-z]\w*)$/))) {
      const rec = recordOf(scope.get("its body"));
      const f = rec ? records.get(rec)!.fields.find((y) => y.name === m![1]) : undefined;
      return f ? T(f.type) : undefined;
    }
    // a @Member with @name = …: a new record, its fields checked
    if ((m = x.match(/^(?:an?|the new)\s+@([A-Z]\w*)\s+with\s+(.+)$/))) {
      const rec = records.get(m[1]);
      if (!rec) return undefined;
      return checkPairs(m[2], (f) => rec.fields.find((y) => y.name === f)?.type, `a @${rec.name}`, () => false, scope, row, () => {}) ? T({ k: "Named", name: rec.name }) : undefined;
    }
    // the sum of the @f of (all) (the) @xs …: a number field over a list
    if ((m = x.match(/^(?:the\s+)?sum\s+of\s+the\s+@([a-z]\w*)\s+of\s+(?:all\s+)?(.+)$/))) {
      const rec = recordOf(listItem(typeOfValue(at(m[2]))));
      const f = rec ? records.get(rec)!.fields.find((y) => y.name === m![1]) : undefined;
      if (!f) return undefined;
      return numeric(f.type) ? T(strip(f.type)) : wrong(`\`the sum of @${m[1]}\` adds numbers, but ${rec}.${m[1]} is ${show(f.type)}`);
    }
    if (/^the\s+error(?:\s+in\s+its\s+body)?$/.test(x)) return T({ k: "Text" });
    if ((m = x.match(/^its\s+@([a-z]\w*)$/))) {
      if (scope.has(m[1])) return T(scope.get(m[1])!); // smart-cast (`visible when there is a @rating`)
      const whose = row ?? it;
      const f = whose ? records.get(whose)?.fields.find((y) => y.name === m![1]) : undefined;
      return f ? T(f.type) : undefined;
    }
    // the @f of that ticket / of this habit: a field of the row this step is about
    if ((m = x.match(/^the\s+@([a-z]\w*)\s+of\s+(?:that|this|the)\s+([a-z]\w*)$/))) {
      const rec = recordNamed(m[2]);
      const f = rec ? records.get(rec)!.fields.find((y) => y.name === m![1]) : undefined;
      if (rec && !f && declaredField(m[1])) return wrong(`${rec} has no field \`${m[1]}\``);
      return f ? T(f.type) : undefined;
    }
    // the sum of @f over @xs (…): a number field of the list's records
    if ((m = x.match(/^(?:the\s+)?sum\s+of\s+@([a-z]\w*)\s+over\s+(.+)$/))) {
      const rec = recordOf(listItem(typeOfValue(at(m[2]))));
      const f = rec ? records.get(rec)!.fields.find((y) => y.name === m![1]) : undefined;
      if (!f) return undefined;
      return numeric(f.type) ? T(strip(f.type)) : wrong(`\`the sum of @${m[1]}\` adds numbers, but ${rec}.${m[1]} is ${show(f.type)}`);
    }
    // the @Won @deals: a list filtered by a value
    if ((m = x.match(/^(?:the\s+|all\s+)?(?:@[A-Z]\w*\s+)+@([a-z]\w*)$/))) {
      const t = typeOfValue(at("@" + m[1]));
      if (t && listItem(t)) return T(strip(t));
    }
    // the label of @page / the text users see for @page: a choice value's text
    if ((m = x.match(/^the\s+(?:label|text\s+users\s+see)\s+(?:of|for)\s+@([a-z][\w.]*)\b/))) {
      const t = typeOfValue(at("@" + m[1]));
      return t && strip(t).k === "Named" && isChoice((strip(t) as { name: string }).name) ? T({ k: "Text" }) : undefined;
    }
    // `the @caller` is @caller; `the ticket` / `that ticket` is the row this step is about.
    if ((m = x.match(/^the\s+(@[a-z]\w*(?:\.[a-z]\w*)*)$/))) return at(m[1]);
    if ((m = x.match(/^(?:the|that|this|the new|its)\s+([a-z]\w*)$/))) {
      const rec = recordNamed(m[1]);
      return rec ? T({ k: "Named", name: rec }) : undefined;
    }
    // that ticket's @f  /  @f of @x  /  the @f of @x: a field of that record
    if ((m = x.match(/^(?:that|this|the)\s+([a-z]\w*)['’]s\s+@([a-z]\w*)$/))) {
      const rec = recordNamed(m[1]);
      const f = rec ? records.get(rec)!.fields.find((y) => y.name === m![2]) : undefined;
      return f ? T(f.type) : undefined;
    }
    // the @subject of @comment's @ticket / of its @ticket / of @chosen (a reference): followed, as `…'s @subject`
    if ((m = x.match(new RegExp(`^the\\s+@([a-z]\\w*)\\s+of\\s+(${CHAIN_SRC})$`)))) {
      const owner = typeOfValue(at(m[2]));
      if (owner && strip(owner).k === "Ref") return at(`${m[2]}'s @${m[1]}`);
    }
    if ((m = x.match(/^(?:the\s+)?@([a-z]\w*)\s+of\s+(@[a-z]\w*(?:\.[a-z]\w*)*)$/))) {
      // `the @code of @waiting`: of a list, the field of every row (a list), as `@waiting's @code`.
      const whole = typeOfValue(at(m[2]));
      const each = recordOf(listItem(whole));
      const g = each ? records.get(each)!.fields.find((y) => y.name === m![1]) : undefined;
      if (g) return T(listItem(g.type) ? strip(g.type) : { k: "List", of: g.type });
      const rec = recordOf(whole);
      const f = rec ? records.get(rec)!.fields.find((y) => y.name === m![1]) : undefined;
      return f ? T(typeOfValue(at(m[2]))!.k === "Maybe" ? { k: "Maybe", of: strip(f.type) } : f.type) : undefined;
    }
    // the ticket in @tickets whose …: one row of that list, which may be missing
    // (also in a row's inner list, or one read through a row that may be nothing: `in @chosen's @lines`)
    if ((m = x.match(/^the\s+([a-z]\w*)\s+in\s+((?:its\s+|(?:that|this)\s+[a-z]\w*['’]s\s+)?@[a-z]\w*(?:['’]s\s+@[a-z]\w*)*)\s+(?:whose|where)\b/))) {
      const item = recordOf(listItem(typeOfValue(at(m[2]))));
      return item ? T({ k: "Maybe", of: { k: "Named", name: item } }) : undefined;
    }
    // the @Confirmed @signups whose …: a filtered list, the same list type
    if ((m = x.match(/^(?:the\s+|all\s+)?(?:@[A-Z]\w*\s+)?@([a-z]\w*)\s+(?:whose|where|that|which|with|without|not)\b/))) {
      const t = typeOfValue(at("@" + m[1]));
      if (t && listItem(t)) return T(strip(t));
    }
    // its @items whose … / that task's @items that …: a row's inner list, filtered: the same list type
    if ((m = x.match(/^((?:its|(?:that|this|the)\s+[a-z]\w*['’]s)\s+@[a-z]\w*)\s+(?:whose|where|that|which|with|without|not)\b/))) {
      const t = typeOfValue(at(m[1]));
      if (t && listItem(t)) return T(strip(t));
    }
    const inferred = infer(x);
    return inferred ? T(inferred) : undefined;
  };
  /** Does a value fit where a `to` is wanted? The message when not; "" when it fits; undefined when the value is untyped. */
  const fitsValue = (to: Type, v: Value): string | undefined => {
    if (!v) return undefined;
    if (v.k === "error") return v.msg;
    if (v.k === "nothing") return to.k === "Maybe" ? "" : `∅nothing, but it is ${show(to)} (no \`or nothing\`)`;
    if (v.k === "value") return valueFits(to, v.choices) ? "" : `a value of ${v.choices.join(" / ")}, but it is ${show(to)}`;
    if (v.k === "type" && v.t.k === "Maybe" && to.k !== "Maybe" && fits(to, v.t.of)) return `∅${show(v.t)}, but it is ${show(to)}: ${NOTHING_HOW}`;
    if (v.k === "type") return fits(to, v.t) ? "" : `${show(v.t)}, but it is ${show(to)}`;
    return undefined;
  };
  const MAX_JOINS = 100;
  /** A condition: yes/no forms over typed values. "" when typed and right, a message when wrong, undefined when untyped. */
  const typeCond = (raw: string, scope: Map<string, Type>, row?: string): string | undefined => {
    // `was` (a change rule's) is `is` in the state before the step: the same types.
    const x = raw.trim().replace(/[;.]$/, "").trim().replace(/(@[a-z][\w.]*(?:['’]s\s+@[a-z]\w*)*)\s+was\b/g, "$1 is");
    const at = (e: string) => typeExpr(e, scope, row);
    let m0: RegExpMatchArray | null;
    // `@x is 3 or more`: one comparison (before "or" is taken to join two conditions)
    // A value that may be nothing, where a condition needs a T (an order, a text, a list): NOTHING (∅).
    const none = (v: Value, what: string): string | undefined => (v?.k === "nothing" || (v?.k === "type" && v.t.k === "Maybe") ? ((nothingErr(what, v.k === "nothing" ? v : (v as { t: Type }).t) as { msg: string }).msg) : undefined);
    if ((m0 = x.match(/^(.+?)\s+is\s+(?:not\s+)?(-?\d+(?:\.\d+)?)\s+or\s+(?:more|less|fewer|higher|lower)$/))) {
      const v = at(m0[1]);
      const t = typeOfValue(v);
      return t ? (numeric(t) ? (none(v, `\`is ${m0[2]} or …\` needs a number`) ?? "") : `\`is ${m0[2]} or …\` needs a number, not ${show(t)}`) : undefined;
    }
    // "at or before", "3 or more", "or nothing": an "or" inside a phrase does not join two conditions.
    const masked = x.replace(/\b(at|or) or (before|after|more|less|fewer|higher|lower|nothing)\b|\b(\d+(?:\.\d+)?) or (more|less|fewer|higher|lower)\b|,? or nothing\b/g, (m0) => m0.replace(/ /g, "_"));
    const joins = chainOf(masked, [" and ", " or "]);
    // A condition of more parts than anyone reads is left to judgement (LONG_SENTENCE asks to name its
    // parts in `derive`): typing it would take time and stack in proportion to its parts, squared.
    if (joins.length > MAX_JOINS) return undefined;
    const both = joins[joins.length - 1];
    if (both) {
      // `there is a @x and @x is above 3`: the right side sees the left hold (`and`), or not hold (`or`).
      const rightScope = narrowBy(scope, x.slice(0, both.at), both.op === " and ", row);
      const [l, r] = [typeCond(x.slice(0, both.at), scope, row), typeCond(x.slice(both.at + both.op.length), rightScope, row)];
      // `@duration is below 1 or above 1440`: the second condition has the first one's subject.
      const right = x.slice(both.at + both.op.length).trim();
      const subject = x.slice(0, both.at).match(/^(.+?)\s+is\s/)?.[1];
      if (subject && new RegExp(`^(?:is\\s|${NUM_CMP}\\s)`).test(right)) {
        const r2 = typeCond(`${subject} ${/^is\s/.test(right) ? right : `is ${right}`}`, rightScope, row);
        return l ? l : r2 ? r2 : l === "" && r2 === "" ? "" : undefined;
      }
      // `is "SAVE10" or "FIVER"`, `401, 403 or 409`: the "or" joins values, not conditions.
      if (!/\b(is|are|has|have|contains|there)\b/.test(right)) return undefined;
      return l ? l : r ? r : l === "" && r === "" ? "" : undefined;
    }
    let m: RegExpMatchArray | null;
    // what an optional value or a lookup does when there is none: the words of the language
    if (/^(?:there\s+is\s+none|there\s+are\s+none|it\s+is\s+(?:empty|blank|nothing)|none)$/.test(x)) return "";
    if ((m = x.match(/^not\s+(.+)$/))) return typeCond(m[1], scope, row);
    if ((m = x.match(/^there\s+is\s+(?:a|an|no)\s+@([a-z][\w.]*)$/))) {
      const f = fitOf(m[1], scope, row);
      if (f.k === "type" && f.t.k === "Ref") return `@${m[1]} is a reference: its key is always there; ask whether its row is: \`@${m[1]} ${/\bno\b/.test(x) ? "does not exist" : "exists"}\``;
      return f.k === "type" ? "" : undefined;
    }
    // @comment's @ticket exists / does not exist: whether the row a reference points at is there
    if ((m = x.match(/^(.+?)\s+(exists|does\s+not\s+exist)$/))) {
      const t = typeOfValue(at(m[1]));
      if (!t) return undefined;
      if (strip(t).k === "Ref") return "";
      return `\`${m[2]}\` asks whether the row a reference points at is there, and ${m[1].trim()} is ${show(t)}${t.k === "Maybe" ? `: write \`there is a ${m[1].trim()}\`` : ", not a reference"}`;
    }
    // every @Parcel's @locker is the @number of a locker in @lockers: a relation — the two fields fit
    // (a reference is compared with its record's key)
    if ((m = x.match(/^every\s+@([A-Z]\w*)['’]s\s+@([a-z]\w*)\s+is\s+the\s+@([a-z]\w*)\s+of\s+(?:a|an|some)\s+([a-z]\w*)\s+in\s+@([a-z][\w.]*)$/))) {
      const from = records.get(m[1])?.fields.find((y) => y.name === m![2]);
      const rec = recordNamed(m[4]) ?? recordOf(listItem(typeOfValue(at("@" + m[5]))));
      const to = rec ? records.get(rec)!.fields.find((y) => y.name === m![3]) : undefined;
      if (!from || !to || !rec) return undefined;
      const rel = relation({ k: "type", t: from.type }, { k: "type", t: to.type, ...(keyOf(rec) === to.name ? { keyOf: rec } : {}) });
      return rel ? `one ${rel}` : comparable(from.type, to.type) ? "" : `${m[1]}.${m[2]} is ${show(from.type)}, ${rec}.${m[3]} is ${show(to.type)}`;
    }
    // every @amount in @expenses is …: the condition on each item's field
    // (also over a row's inner list, `in that task's @items`, and through lists, `in @tasks's @items`)
    if ((m = x.match(/^every\s+@([a-z]\w*)\s+(?:in|of)\s+(?:the\s+(?:new|removed)\s+)?((?:its\s+|(?:that|this)\s+[a-z]\w*['’]s\s+)?@[a-z][\w.]*(?:['’]s\s+@[a-z]\w*)*)\s+(?!['’]s\s)(.+)$/))) {
      const rec = recordOf(listItem(typeOfValue(at(m[2]))));
      const f = rec ? records.get(rec)!.fields.find((y) => y.name === m![1]) : undefined;
      if (!f) return rec && declaredField(m[1]) ? `${rec} has no field \`${m[1]}\`` : undefined;
      return typeCond(`@${m[1]} ${m[3]}`, new Map([...scope, [m[1], f.type]]), row);
    }
    // no two @expenses have the same @id: a field of the list's records
    if ((m = x.match(/^no\s+two\s+@([a-z][\w.]*)\s+have\s+the\s+same\s+@([a-z]\w*)/))) {
      const rec = recordOf(listItem(typeOfValue(at("@" + m[1]))));
      return rec ? (records.get(rec)!.fields.some((y) => y.name === m![2]) ? "" : `${rec} has no field \`${m[2]}\``) : undefined;
    }
    // no @Expense in @expenses has a blank @description
    if ((m = x.match(/^(?:no|every|each)\s+@([A-Z]\w*)\s+in\s+@([a-z][\w.]*)\s+(?:has|have)\s+(?:a|an)\s+(blank|empty)\s+@([a-z]\w*)$/))) {
      const f = records.get(m[1])?.fields.find((y) => y.name === m![4]);
      if (!f) return records.has(m[1]) && declaredField(m[4]) ? `${m[1]} has no field \`${m[4]}\`` : undefined;
      return isText(f.type) || listItem(f.type) ? "" : `\`${m[3]}\` is for text or a list, not ${show(f.type)}`;
    }
    // @x reads as a decimal (above 0): whether text reads as a number (then compared as one)
    if ((m = x.match(/^(.+?)\s+(?:does\s+not\s+read|reads)\s+as\s+(?:an?\s+)?(whole number|decimal|number)(?:\s+(.+))?$/))) {
      const v = at(m[1]);
      const t = typeOfValue(v);
      if (!t) return undefined;
      if (!isText(t)) return `\`reads as\` is for text, not ${show(t)}`;
      const n = none(v, "`reads as` needs text");
      if (n) return n;
      return m[3] ? typeCond(`${m[1]} read as a ${m[2]} is ${m[3]}`, scope, row) : "";
    }
    // there are no / 3 / at least 2 @cards (in @Doing): a list
    if ((m = x.match(/^there\s+are\s+(?:no|\d+|at\s+least\s+\d+|at\s+most\s+\d+|more\s+than\s+\d+|fewer\s+than\s+\d+|less\s+than\s+\d+)\s+@([a-z][\w.]*)\b/))) {
      const t = typeOfValue(at("@" + m[1]));
      return t ? (listItem(t) ? "" : `\`there are … @${m[1]}\` counts a list, not ${show(t)}`) : undefined;
    }
    // @x is a valid @Email: text checked against a refined type
    if ((m = x.match(/^(.+?)\s+is\s+(?:not\s+)?a\s+valid\s+@([A-Z]\w*)$/))) {
      if (!refined.has(m[2])) return `\`a valid @${m[2]}\`: ${m[2]} is not a refined type`;
      const v = at(m[1]);
      const t = typeOfValue(v);
      return t ? (base(strip(t)).k === base({ k: "Named", name: m[2] }).k ? (none(v, `\`is a valid @${m[2]}\` needs text`) ?? "") : `\`is a valid @${m[2]}\` needs ${show(base({ k: "Named", name: m[2] }))}, not ${show(t)}`) : undefined;
    }
    // there is a ticket (in @tickets) whose @id is @y: the lookup's field and value
    // (also in a row's inner list: `there is no line in that order's @lines whose @id is @chosenLine`)
    if ((m = x.match(/^there\s+is\s+(?:a|an|no)\s+([a-z]\w*)(?:\s+in\s+((?:its\s+|(?:that|this)\s+[a-z]\w*['’]s\s+)?@[a-z][\w.]*(?:['’]s\s+@[a-z]\w*)*))?\s+(?:whose|where)\s+@([a-z]\w*)\s+is\s+(?:not\s+)?(.+)$/))) {
      const rec = recordNamed(m[1]) ?? (m[2] ? recordOf(listItem(typeOfValue(at(m[2])))) : undefined);
      m = [m[0], m[1], m[3], m[4]] as unknown as RegExpMatchArray;
      const f = rec ? records.get(rec)!.fields.find((y) => y.name === m![2]) : undefined;
      if (!rec || !f) return rec && declaredField(m[2]) ? `${rec} has no field \`${m[2]}\`` : undefined;
      const v = at(m[3]);
      if (v?.k === "error") return v.msg;
      if (v?.k === "value") return valueFits(f.type, v.choices) ? "" : `${rec}.${m[2]} is never ${m[3]}`;
      const t = typeOfValue(v);
      if (!t) return undefined;
      const rel = relation({ k: "type", t: f.type, ...(keyOf(rec) === f.name ? { keyOf: rec } : {}) }, v as Fit);
      return rel ? `one ${rel}` : comparable(f.type, t) ? "" : `${rec}.${m[2]} is ${show(f.type)}, the value ${show(t)}`;
    }
    // no ticket has that @id / a ticket in @tickets has … / some @signups have …: a row with that field exists
    if ((m = x.match(/^(?:no|a|an|some|any)\s+([a-z]\w*)(?:\s+in\s+(@[a-z][\w.]*))?\s+(?:has|have)\s+(?:that|this|the|its)?\s*@([a-z]\w*)\b/))) {
      // `no row in @rows has …`: the row is the list's record
      const rec = recordNamed(m[1]) ?? (m[2] ? recordOf(listItem(typeOfValue(at(m[2])))) : undefined);
      m = [m[0], m[1], m[3]] as unknown as RegExpMatchArray;
      if (!rec) return undefined;
      return records.get(rec)!.fields.some((f) => f.name === m![2]) || !declaredField(m[2]) ? "" : `${rec} has no field \`${m[2]}\``;
    }
    // that ticket is @Solved: a value of one of the row's choice fields
    if ((m = x.match(/^(?:that|this|the)\s+([a-z]\w*)\s+is\s+(?:not\s+)?@([A-Z]\w*)$/))) {
      const rec = recordNamed(m[1]);
      const v = choiceOf.get(m[2]);
      if (!rec || !v) return undefined;
      return records.get(rec)!.fields.some((f) => valueFits(f.type, v) && strip(f.type).k === "Named" && isChoice((strip(f.type) as { name: string }).name)) ? "" : `a ${rec} has no field that can be ${m[2]}`;
    }
    if ((m = x.match(/^(.+?)\s+is\s+(?:not\s+)?(empty|blank)$/))) {
      const v = at(m[1]);
      const t = typeOfValue(v);
      if (!t) return undefined;
      return isText(t) || listItem(t) ? (none(v, `\`is ${m[2]}\` needs text or a list`) ?? "") : `\`is ${m[2]}\` is for text or a list, not ${show(t)}`;
    }
    if ((m = x.match(/^(.+?)\s+is\s+(?:not\s+)?(nothing|set)$/))) {
      const t = typeOfValue(at(m[1]));
      return t ? (t.k === "Maybe" ? "" : `\`is ${m[2]}\` is for a value that may be nothing, not ${show(t)}`) : undefined;
    }
    if ((m = x.match(new RegExp(`^(.+?)\\s+is\\s+(?:not\\s+)?${NUM_CMP}\\s+(.+)$`)))) {
      const [l, r] = [at(m[1]), at(m[2])];
      if (l?.k === "error") return l.msg;
      if (r?.k === "error") return r.msg;
      const [lt, rt] = [typeOfValue(l), typeOfValue(r)];
      if (!lt || !rt) return undefined;
      if (!((numeric(lt) && numeric(rt)) || (temporal(lt) && temporal(rt)))) return `${show(lt)} and ${show(rt)} cannot be ordered against each other`;
      return none(l, "an order needs a value on the left") ?? none(r, "an order needs a value on the right") ?? "";
    }
    if ((m = x.match(/^(.+?)\s+contains\s+(.+)$/))) {
      const v = at(m[1]);
      const t = typeOfValue(v);
      return t ? (isText(t) || listItem(t) ? (none(v, "`contains` needs text or a list") ?? "") : `\`contains\` is for text or a list, not ${show(t)}`) : undefined;
    }
    if ((m = x.match(/^(.+?)\s+is\s+(?:not\s+)?(?:equal\s+to\s+|the\s+same\s+as\s+)?(.+)$/))) {
      const [l, r] = [at(m[1]), at(m[2])];
      if (l?.k === "error") return l.msg;
      if (r?.k === "error") return r.msg;
      if (l?.k === "type" && r?.k === "value") return valueFits(l.t, r.choices) ? "" : `${show(l.t)} is never ${m[2]}`;
      if (l?.k === "type" && r?.k === "nothing") return l.t.k === "Maybe" ? "" : `${show(l.t)} is never nothing`;
      if (l?.k === "type" && r?.k === "type") return relation(l, r) ? `one ${relation(l, r)}` : comparable(l.t, r.t) ? "" : `${show(l.t)} and ${show(r.t)} cannot be compared`;
      return undefined;
    }
    // A bare reference as a condition must be a yes/no; any other shape is prose, left to judgement.
    if (!new RegExp(`^${CHAIN_SRC}$`).test(x)) return undefined;
    const v = at(x);
    const t = typeOfValue(v);
    return t ? (base(strip(t)).k === "Bool" ? (none(v, "a condition needs a yes/no") ?? "") : `a condition is a yes/no, not ${show(t)}`) : undefined;
  };

  // Derived values typed by the typer too (after the forms above), and a declared type checked against it.
  for (let pass = 0; pass < 3; pass++)
    for (const d of app.derive) if (!derivedTypes.get(d.name)) derivedTypes.set(d.name, typeOfValue(typeExpr(d.sentence, new Map())) ?? (typeCond(d.sentence, new Map()) === "" ? { k: "Bool" } : undefined));
  for (const d of app.derive) {
    if (!d.type || d.line >= LINE_BASE) continue;
    const got = typeExpr(d.sentence, new Map());
    const msg = fitsValue(d.type, got);
    if (msg) err(d.line, msg.includes("∅") ? "NOTHING" : "TYPE", `\`${d.name}\` is declared ${show(d.type)}, but the sentence gives ${msg.replace(/∅/g, "").replace(/, but it is .*$/, "")}${msg.includes("∅") ? `: ${NOTHING_HOW}` : ""}`);
  }

  /** `@f = value, @g @Value, the given @h, @i trimmed`: named values for a record or a call. */
const checkPairs = (list: string, field: (f: string) => Type | undefined, owner: string, known: (f: string) => boolean, scope: Map<string, Type>, row: string | undefined, say: (code: string, msg: string) => void): boolean => {
  const value = (v: string) => typeExpr(v, scope, row);
    let all = true;
    let rest = list.trim();
    while (rest) {
      // Split only where the next part starts a new name (`, @f`, `and @f`, `and the given`).
      let cutAt: { at: number; op: string } | undefined;
      for (let probe = rest; ; ) {
        const hit = topLevel(probe, [", ", " and "]);
        if (!hit) break;
        const after = probe.slice(hit.at + hit.op.length).trimStart();
        if (/^(?:and\s+)?(?:the\s+given\s+)?@[a-z]/.test(after) && !/^@[a-z]\w*['’]s/.test(after)) {
          // the first qualifying split from the left
          cutAt = hit;
        }
        probe = probe.slice(0, hit.at);
      }
      const part = (cutAt ? rest.slice(0, cutAt.at) : rest).trim().replace(/^and\s+/, "");
      rest = cutAt ? rest.slice(cutAt.at + cutAt.op.length).trim() : "";
      let m: RegExpMatchArray | null;
      if ((m = part.match(/^@([a-z]\w*)\s*=\s*(.+)$/))) {
        const t = field(m[1]);
        if (!t) {
          if (declaredField(m[1]) && !known(m[1])) say("UNKNOWN_NAME", `\`${owner} with @${m[1]} …\`: it has no \`${m[1]}\``);
          all = false;
          continue;
        }
        const v = value(m[2]);
        const msg = fitsValue(t, v);
        if (msg) say("TYPE", `\`${owner} with @${m[1]} = ${m[2].trim()}\`: ${v?.k === "error" ? msg : `the value is ${msg}`}`);
        if (msg === undefined) all = false;
      } else if ((m = part.match(/^@([a-z]\w*)\s+@([A-Z]\w*)$/))) {
        const t = field(m[1]);
        const v = fitOf(m[2], scope, row);
        if (t && v.k === "value" && !valueFits(t, v.choices)) say("TYPE", `\`${owner} with @${m[1]} @${m[2]}\`: ${m[1]} is ${show(t)}, and ${m[2]} is a value of ${v.choices.join(" / ")}`);
        if (!t && declaredField(m[1]) && !known(m[1])) say("UNKNOWN_NAME", `\`${owner} with @${m[1]} …\`: it has no \`${m[1]}\``);
        if (!t) all = false;
      } else if ((m = part.match(/^(?:the\s+given\s+)?@([a-z]\w*)(?:,?\s+trimmed)?$/))) {
        if (!field(m[1])) {
          if (/^the\s+given/.test(part) && declaredField(m[1]) && !known(m[1])) say("UNKNOWN_NAME", `\`${owner} with @${m[1]}\`: it has no \`${m[1]}\``);
          all = false;
        }
      } else all = false;
    }
    return all;
  };

  // Coverage: every sentence with a reference, and whether the typer typed it whole.
  const coverage: { line: number; where: string; text: string; typed: boolean }[] = [];
  const cover = (text: string, line: number, where: string, typed: boolean) => {
    if (line < LINE_BASE && /@[A-Za-z]/.test(text)) coverage.push({ line, where, text, typed });
  };

  // Draws (v69): each draw phrase, where it is, and the types of the lists and counts it reads (compiler/draws.ts).
  const drawFacts = new Map<string, DrawFact>();
  let loops = 0; // how many `for each` the sentence being checked is inside
  let answering = false; // the sentence is an `answer …` step
  const noteDraws = (text: string, line: number, where: string, scope: Map<string, Type>, row?: string) => {
    for (const d of findDraws(text)) {
      const key = `${line}|${where}|${d.at}|${text}`;
      if (drawFacts.has(key)) continue;
      const listType = d.list ? typeOfValue(typeExpr(d.list, scope, row)) : undefined;
      const countType = d.count && !/^\d/.test(d.count) ? typeOfValue(typeExpr(d.count, scope, row)) : undefined;
      drawFacts.set(key, { ...d, line, where, loops, ...(listType ? { listType } : {}), ...(countType ? { countType } : {}), ...(answering || /^answer\b/.test(text.trim()) ? { inAnswer: true } : {}) });
    }
  };

  // Derived values a checked phrase uses but whose type is not known: a hint to declare it.
  const untyped = new Map<string, string>();
  // Reads through references (for the hints, the source map and the expanded spec), and lookups that are one.
  const navs: Navigation[] = [];
  const spellings: { line: number; from: string; to: string }[] = [];
  type Kind = "step" | "cond" | "derive" | "value" | "always" | "rules";
  const check = (text: string, line: number, where: string, scope: Map<string, Type>, row?: string, body?: Type[], kind: Kind = "step") => {
    if (skip.has(line)) return; // a line with a SYNTAX error: one error is enough
    noteDraws(text, line, where, scope, row);
    if (line >= LINE_BASE) return; // from a bundle: checked there
    const at = (ref: string) => {
      const f = fitOf(ref, scope, row);
      if (f.k === "unknown" && derivedTypes.has(ref) && !untyped.has(ref)) untyped.set(ref, where);
      return f;
    };
    // One report per kind of problem per sentence: two checks that see the same mistake say it once.
    const said = new Set<string>();
    const say = (code: string, msg: string) => {
      // A value that may be nothing where a T is needed (marked ∅ by the typer): NOTHING.
      if (msg.includes("∅")) (code = "NOTHING"), (msg = msg.replace(/∅/g, ""));
      if (said.has(code)) return;
      said.add(code);
      err(line, code, `${msg} (${where})`);
    };
    const nothingAt = (what: string, x: Fit) => x.k === "type" && x.t.k === "Maybe" && say("NOTHING", `${what}: the value may be nothing (${show(x.t)}); ${NOTHING_HOW}`);

    // A draw is one of the five forms; \`random\` or \`shuffled\` anywhere else would be judgement (v69).
    if (kind !== "always" && kind !== "rules") {
      const stray = strayDraw(text);
      if (stray) say("RANDOM", `\`${stray}\` in \`${text.trim()}\` is not a draw the language knows: a random value is ${DRAW_FORMS} (the type lists its values: \`type Die = Int from 1 to 6\`)`);
    }
    // A change form (`@x before`, `… was …`, `the new @xs`) reads the state before a step and after it:
    // only a rule in `always` sees both. A handler, a derived value or a screen reads one state.
    if (kind !== "always" && kind !== "rules") {
      const w = changeWords(text);
      if (w.length) say("CHANGE", `\`${w[0]}\` reads the state before a step, which only a rule in \`always\` can: ${kind === "derive" ? "a derived value is computed from one state" : /^(on|endpoint|every|before|after)\b/.test(where) ? "a handler runs in one state" : "the screen shows one state"}; name the old value first (\`set @previous to @x\` before the step that changes it)`);
    }
    // `the new @xs` / `the removed @xs`: rows are matched by their key before and after the step.
    if (kind === "always")
      for (const m of text.matchAll(DELTA_RE)) {
        const rec = recordOf(listItem(typeOfValue(typeExpr("@" + m[2], scope, row))));
        if (rec && !keyOf(rec)) say("NO_KEY", `\`the ${m[1]} @${m[2]}\`: ${rec} has no key, so its rows cannot be matched before and after a step: name its key field \`id\`, or mark one \`key code: Text\``);
      }

    // increase / decrease @x by …: a number
    for (const m of text.matchAll(new RegExp(`\\b(increase|decrease)\\s+${REF}\\b`, "g"))) {
      const x = at(m[2]);
      if (x.k === "type" && !numeric(x.t)) say("TYPE", `\`${m[1]} @${m[2]}\`: @${m[2]} is ${show(x.t)}, not a number`);
      else nothingAt(`\`${m[1]} @${m[2]}\``, x);
    }
    // @x is (not) @y — a value of its choice, or a value it can be compared with (a reference with its record's key)
    for (const m of text.matchAll(new RegExp(`${SUBJECT}${REF}\\s+is\\s+(?:not\\s+)?(?:equal\\s+to\\s+|the\\s+same\\s+as\\s+)?${REF}(?![\\w.'’])${END}`, "g"))) {
      const [x, y] = [at(m[1]), at(m[2])];
      if (x.k === "type" && y.k === "value" && !valueFits(x.t, y.choices)) say("TYPE", `\`@${m[1]} is @${m[2]}\`: @${m[1]} is ${show(x.t)}, and ${m[2]} is a value of ${y.choices.join(" / ")}`);
      if (x.k === "type" && y.k === "type") {
        const rel = relation(x, y);
        if (rel) say("TYPE", `\`@${m[1]} is @${m[2]}\`: one ${rel}`);
        else if (!comparable(x.t, y.t)) say("TYPE", `\`@${m[1]} is @${m[2]}\`: ${show(x.t)} and ${show(y.t)} cannot be compared`);
      }
    }
    // @x is above / below / at least … @y (or a number): both numbers, or both moments
    for (const m of text.matchAll(new RegExp(`${SUBJECT}${REF}\\s+is\\s+(?:not\\s+)?${NUM_CMP}\\s+(?:${REF}|(-?\\d+(?:\\.\\d+)?))${END}`, "g"))) {
      const x = at(m[1]);
      const y: Fit = m[2] ? at(m[2]) : { k: "type", t: literalType(m[3])! };
      if (x.k !== "type") continue;
      if (!numeric(x.t) && !temporal(x.t)) say("TYPE", `\`@${m[1]} is … ${m[2] ? `@${m[2]}` : m[3]}\`: @${m[1]} is ${show(x.t)}, which has no order`);
      else if (y.k === "type" && !((numeric(x.t) && numeric(y.t)) || (temporal(x.t) && temporal(y.t)))) say("TYPE", `\`@${m[1]} is … ${m[2] ? `@${m[2]}` : m[3]}\`: ${show(x.t)} and ${show(y.t)} cannot be ordered against each other`);
    }
    // A reference followed (`@ticket's @subject`, `the @subject of @ticket`): its record has a home to
    // look the key up in, and the field is the target record's.
    const follow = (ref: { name: string; in?: string }, shown: string, b: string) => {
      const home = homeOf(app, ref.name, ref.in);
      if (home.problem && !ref.in) say("HOME", `\`${shown}\` follows a ref ${ref.name}, but ${home.problem}: say which list it points into on the field (\`ref ${ref.name} in ${homeLists(app, ref.name)[0] ?? "…"}\`)`);
      const target = records.get(ref.name);
      if (target && declaredField(b) && !target.fields.some((f) => f.name === b)) say("UNKNOWN_NAME", `\`${shown}\`: ${ref.name} has no field \`${b}\` (${target.fields.map((f) => f.name).join(", ")})`);
    };
    // @a's @b: a field of a's record, or of the row a reference points at
    for (const m of text.matchAll(new RegExp(`${REF}['’]s\\s+(?=${REF})`, "g"))) { // overlapping: @c's @ticket's @title
      const a = at(m[1]);
      if (a.k !== "type") continue;
      const b = m[2].split(".")[0];
      if (strip(a.t).k === "Ref") {
        follow(strip(a.t) as { name: string; in?: string }, `@${m[1]}'s @${b}`, b);
        continue;
      }
      const rec = recordOf(a.t) ?? recordOf(listItem(a.t));
      if (rec && declaredField(b) && !records.get(rec)!.fields.some((f) => f.name === b)) say("UNKNOWN_NAME", `\`@${m[1]}'s @${b}\`: ${rec} has no field \`${b}\` (${records.get(rec)!.fields.map((f) => f.name).join(", ")})`);
    }
    // its body's @b (an answer or an event): a field of the body's record
    if (body?.length)
      for (const m of text.matchAll(new RegExp(`\\bits\\s+body['’]s\\s+${REF}`, "g"))) {
        const recs = body.map(recordOf).filter((r): r is string => !!r);
        if (recs.length === body.length && declaredField(m[1]) && !recs.some((r) => records.get(r)!.fields.some((f) => f.name === m[1]))) say("UNKNOWN_NAME", `\`its body's @${m[1]}\`: the body (${recs.join(" or ")}) has no field \`${m[1]}\``);
      }
    // the @b of the ticket / of @a: a field of that record; a reference is looked up first
    for (const m of text.matchAll(new RegExp(`\\bthe\\s+${REF}\\s+of\\s+(?:(?:the|that|this|each|every)\\s+([a-z]\\w*)\\b(?!['’]s)|${REF}(?![\\w.]|['’]s)|((?:its\\s+|(?:that|this|the)\\s+[a-z]\\w*['’]s\\s+)@[a-z]\\w*(?:['’]s\\s+@[a-z]\\w*)*|@[a-z]\\w*(?:['’]s\\s+@[a-z]\\w*)+))`, "g"))) {
      const b = m[1];
      if (m[4]) {
        // the @subject of @comment's @ticket / of its @ticket: the chain's value, a record or a reference
        const t = typeOfValue(typeExpr(m[4], scope, row));
        if (t && strip(t).k === "Ref") follow(strip(t) as { name: string; in?: string }, `the @${b} of ${m[4]}`, b);
        continue;
      }
      if (m[3]) {
        const a = at(m[3]);
        if (a.k === "type" && strip(a.t).k === "Ref") {
          follow(strip(a.t) as { name: string; in?: string }, `the @${b} of @${m[3]}`, b);
          continue;
        }
        const rec = a.k === "type" ? recordOf(a.t) : undefined;
        if (rec && declaredField(b) && !records.get(rec)!.fields.some((f) => f.name === b)) say("UNKNOWN_NAME", `\`the @${b} of @${m[3]}\`: ${rec} has no field \`${b}\``);
        continue;
      }
      const rec = recordNamed(m[2]);
      if (rec && declaredField(b) && !records.get(rec)!.fields.some((f) => f.name === b)) say("UNKNOWN_NAME", `\`the @${b} of the ${m[2]}\`: ${rec} has no field \`${b}\` (${records.get(rec)!.fields.map((f) => f.name).join(", ")})`);
    }
    // Lookups: the ticket / the @tickets whose @field is (not) @y / a literal — the field is the record's,
    // and the value fits it; a reference is compared with the key of the record it refers to.
    for (const m of text.matchAll(new RegExp(`\\b(?:the|a|an|no|any|every|each)\\s+(?:@([a-z]\\w*)|([a-z]\\w*))\\s+(?:whose|where)\\s+${REF}\\s+is\\s+(?:not\\s+)?(?:${REF}|(-?\\d+(?:\\.\\d+)?|"(?:[^"\\\\]|\\\\.)*"|true|false))${END}`, "g"))) {
      const rec = m[1] ? recordOf(listItem(fitOf(m[1], scope, row).k === "type" ? (fitOf(m[1], scope, row) as { t: Type }).t : undefined)) : recordNamed(m[2]);
      if (!rec) continue;
      const field = records.get(rec)!.fields.find((f) => f.name === m[3]);
      if (!field) {
        say("UNKNOWN_NAME", `\`${m[1] ? `the @${m[1]}` : `the ${m[2]}`} whose @${m[3]} …\`: ${rec} has no field \`${m[3]}\` (${records.get(rec)!.fields.map((f) => f.name).join(", ")})`);
        continue;
      }
      const x: Fit = { k: "type", t: field.type, ...(keyOf(rec) === field.name ? { keyOf: rec } : {}) };
      if (m[4]) {
        const y = at(m[4]);
        if (y.k === "value" && !valueFits(field.type, y.choices)) say("TYPE", `\`whose @${m[3]} is @${m[4]}\`: ${rec}.${m[3]} is ${show(field.type)}, and ${m[4]} is a value of ${y.choices.join(" / ")}`);
        if (y.k === "type") {
          const rel = relation(x, y);
          if (rel) say("TYPE", `\`${m[1] ? `the @${m[1]}` : `the ${m[2]}`} whose @${m[3]} is @${m[4]}\`: one ${rel}`);
          else if (!comparable(field.type, y.t)) say("TYPE", `\`whose @${m[3]} is @${m[4]}\`: ${rec}.${m[3]} is ${show(field.type)}, @${m[4]} is ${show(y.t)}`);
        }
      } else if (m[5]) {
        const lt = literalType(m[5]);
        if (lt && !comparable(field.type, lt)) say("TYPE", `\`whose @${m[3]} is ${m[5]}\`: ${rec}.${m[3]} is ${show(field.type)}`);
      }
    }
    // the @books whose @author's @country is "NL": a condition through a reference, typed as the field it reads
    for (const m of text.matchAll(new RegExp(`\\b(?:the|a|an|no|any|every|each|some)\\s+(?:@([a-z]\\w*)|([a-z]\\w*))\\s+(?:in\\s+@[a-z][\\w.]*\\s+)?(?:whose|where)\\s+(@[a-z]\\w*(?:['’]s\\s+@[a-z]\\w*)+)\\s+(is\\s+.+?)(?=$|,|;|\\s+and\\s|\\s+or\\s|\\s+when\\s)`, "g"))) {
      const rec = m[1] ? recordOf(listItem(typeOfValue(at(m[1])))) : recordNamed(m[2]);
      if (!rec) continue;
      const msg = typeCond(`${m[3]} ${m[4]}`, scope, rec);
      if (msg) say("TYPE", `\`whose ${m[3]} ${m[4].trim()}\`: ${msg}`);
    }
    // add @y to (the end / the start of) @xs: an item of the list
    for (const m of text.matchAll(new RegExp(`\\badd\\s+${REF}\\s+(?:to|at)\\s+(?:the\\s+(?:end|start)\\s+of\\s+)?${REF}${END}`, "g"))) {
      const [y, xs] = [at(m[1]), at(m[2])];
      const item = xs.k === "type" ? listItem(xs.t) : undefined;
      if (item && y.k === "type" && y.t.k === "Maybe" && item.k !== "Maybe" && fits(item, y.t.of)) nothingAt(`\`add @${m[1]} to @${m[2]}\``, y);
      else if (item && y.k === "type" && !fits(item, y.t)) say("TYPE", `\`add @${m[1]} to @${m[2]}\`: @${m[2]} holds ${show(item)}, @${m[1]} is ${show(y.t)}`);
      if (item && y.k === "value" && !valueFits(item, y.choices)) say("TYPE", `\`add @${m[1]} to @${m[2]}\`: @${m[2]} holds ${show(item)}, and ${m[1]} is a value of ${y.choices.join(" / ")}`);
    }
    // add a @Ticket … to @xs: the list holds that record
    for (const m of text.matchAll(new RegExp(`\\badd\\s+(?:an?|the new)\\s+@([A-Z]\\w*)\\s+to\\s+(?:the\\s+(?:end|start)\\s+of\\s+)?${REF}`, "g"))) {
      const xs = at(m[2]);
      const item = xs.k === "type" ? listItem(xs.t) : undefined;
      if (item && records.has(m[1]) && !(item.k === "Named" && item.name === m[1])) say("TYPE", `\`add a @${m[1]} to @${m[2]}\`: @${m[2]} holds ${show(item)}`);
    }

    // ---------------------------------------------------------------- whole sentences, typed
    const value = (v: string) => typeExpr(v, scope, row);
    const typedValue = (v: string) => {
      const t = value(v);
      if (t?.k === "error") say("TYPE", `\`${v.trim()}\`: ${t.msg}`);
      return !!t;
    };
    const pairs = (list: string, field: (f: string) => Type | undefined, owner: string, known: (f: string) => boolean) => checkPairs(list, field, owner, known, scope, row, say);
    const typeOne = (step: string): boolean => {
      const x = step.trim().replace(/[.;]$/, "").trim();
      let m: RegExpMatchArray | null;
      if (/^(stop|go back|nothing happens|do nothing)$/.test(x)) return true;
      // set @x to …  /  set its @f to …  /  set the @f of that ticket to …
      // set @a to …, @b to … and @c to …: several assignments, each checked
      if ((m = x.match(/^set\s+(@[a-z][\w.]*\s+to\s+.+)$/))) {
        const parts: string[] = [];
        let rest = m[1];
        for (;;) {
          let cut: { at: number; op: string } | undefined;
          for (let probe = rest; ; ) {
            const h = topLevel(probe, [", ", " and "]);
            if (!h) break;
            if (/^(?:and\s+)?@[a-z][\w.]*\s+to\s/.test(probe.slice(h.at + h.op.length).trimStart())) cut = h;
            probe = probe.slice(0, h.at);
          }
          if (!cut) break;
          parts.push(rest.slice(0, cut.at));
          rest = rest.slice(cut.at + cut.op.length).replace(/^and\s+/, "");
        }
        parts.push(rest);
        if (parts.length > 1) return parts.map((p2) => typeOne(`set ${p2.trim()}`)).every(Boolean);
      }
      // `set that expense's @status to …` is `set the @status of that expense to …`
      const poss = x.match(/^set\s+(?:that|this|the)\s+([a-z]\w*)['’]s\s+@([a-z]\w*)\s+to\s+(.+)$/);
      if (poss) return typeOne(`set the @${poss[2]} of that ${poss[1]} to ${poss[3]}`);
      if ((m = x.match(/^set\s+(?:@([a-z][\w.]*)|its\s+@([a-z]\w*)|the\s+@([a-z]\w*)\s+of\s+(?:that|this|the)\s+([a-z]\w*))\s+to\s+(.+)$/))) {
        let target: Type | undefined;
        if (m[1]) target = scope.get(`⊢${m[1]}`) ?? typeOfValue(fitOf(m[1], scope, row)); // a write goes to the declared type, not a smart cast
        else {
          const rec = m[4] ? recordNamed(m[4]) : (row ?? it);
          target = rec ? records.get(rec)?.fields.find((f) => f.name === (m![2] ?? m![3]))?.type : (fieldTypes.get(m[2] ?? m[3]) ?? undefined);
        }
        const v = value(m[5]);
        if (!target) return false;
        const msg = fitsValue(target, v);
        if (msg) say("TYPE", `\`set ${m[1] ? `@${m[1]}` : m[2] ? `its @${m[2]}` : `the @${m[3]} of that ${m[4]}`} to ${m[5].trim()}\`: ${v?.k === "error" ? msg : `the value is ${msg}`}`);
        return msg !== undefined;
      }
      if ((m = x.match(/^(increase|decrease)\s+(?:the\s+|its\s+)?@([a-z][\w.]*)(?:\s+of\s+(?:that|this|the)\s+[a-z]\w*)?(?:\s+by\s+(.+))?$/))) {
        const t = typeOfValue(fitOf(m[2], scope, row));
        if (!m[3]) return !!t;
        const v = value(m[3]);
        if (v?.k === "error") say("TYPE", `\`${m[1]} @${m[2]} by ${m[3].trim()}\`: ${v.msg}`);
        else if (typeOfValue(v) && !numeric(typeOfValue(v)!)) say("TYPE", `\`${m[1]} @${m[2]} by ${m[3].trim()}\`: the amount is ${show(typeOfValue(v)!)}, not a number`);
        else if (v?.k === "type" || v?.k === "nothing") nothingAt(`\`${m[1]} @${m[2]} by ${m[3].trim()}\``, v.k === "nothing" ? { k: "type", t: { k: "Maybe", of: { k: "Int" } } } : v);
        return !!t && !!v;
      }
      // A state field, a row's field (`its @newItem`, `that task's @newItem`): what `clear` empties.
      if ((m = x.match(/^clear\s+(.+)$/))) return m[1].split(/\s*(?:,|\band\b)\s*/).filter(Boolean).every((r) => (/^@[a-z][\w.]*$/.test(r) ? fitOf(r.slice(1), scope, row).k === "type" : new RegExp(`^${ROW_FIELD}$`).test(r) && !!typeOfValue(value(r))));
      // The list a record is added to or removed from: `@xs`, or a row's inner list (`that task's @items`, `its @items`).
      const listAt = (target: string): Type | undefined => (target.startsWith("@") ? typeOfValue(fitOf(target.slice(1), scope, row)) : typeOfValue(value(target)));
      const holds = (rec: string, target: string) => {
        const item = listItem(listAt(target));
        if (item && strip(item).k === "Named" && (strip(item) as { name: string }).name !== rec && records.has((strip(item) as { name: string }).name)) say("TYPE", `\`add a @${rec} to ${target}\`: ${target} holds ${show(item)}`);
      };
      // add a @Ticket (to …) with …  /  add <value> to (the end of) @xs
      if ((m = x.match(new RegExp(`^add\\s+(?:an?|the new)\\s+@([A-Z]\\w*)\\s+(?:to|at)\\s+(?:the\\s+(?:end|start)\\s+of\\s+)?(${LIST_AT})(?:\\s+with\\s+(.+))?$`)))) {
        const rec = records.get(m[1]);
        if (!rec) return false;
        holds(rec.name, m[2]);
        return (m[2].startsWith("@") || !!listAt(m[2])) && (!m[3] || pairs(m[3], (f) => rec.fields.find((y) => y.name === f)?.type, `a @${rec.name}`, () => false));
      }
      if ((m = x.match(new RegExp(`^add\\s+(?:an?|the new)\\s+@([A-Z]\\w*)\\s+with\\s+(.+?)\\s+(?:to|at)\\s+(?:the\\s+(?:end|start)\\s+of\\s+)?(${LIST_AT})$`)))) {
        const rec = records.get(m[1]);
        if (rec) holds(rec.name, m[3]);
        return !!rec && (m[3].startsWith("@") || !!listAt(m[3])) && pairs(m[2], (f) => rec.fields.find((y) => y.name === f)?.type, `a @${rec.name}`, () => false);
      }
      if ((m = x.match(/^add\s+(?!(?:an?|the new)\s+@[A-Z])(.+?)\s+(?:to|at)\s+(?:the\s+(?:end|start)\s+of\s+)?@([a-z]\w*)$/))) {
        const item = listItem(typeOfValue(fitOf(m[2], scope, row)));
        const v = value(m[1]);
        const msg = item ? fitsValue(item, v) : undefined;
        if (msg) say("TYPE", `\`add ${m[1].trim()} to @${m[2]}\`: @${m[2]} holds ${show(item!)}; ${v?.k === "error" ? msg : `the value is ${msg}`}`);
        return msg !== undefined;
      }
      if ((m = x.match(/^remove\s+(?:that\s+[a-z]\w*|@[a-z]\w*|its\s+[a-z]\w*|the\s+[a-z]\w*\s+whose\s+.+|every\s+[a-z]\w*\s+whose\s+.+|the\s+@[a-z]\w*\s+whose\s+.+)\s+from\s+@([a-z]\w*)$/))) return !!listItem(typeOfValue(fitOf(m[1], scope, row)));
      // remove that item from that task's @items: a row of a row's inner list
      if ((m = x.match(new RegExp(`^remove\\s+(?:that|this)\\s+([a-z]\\w*)\\s+from\\s+(${ROW_FIELD})$`)))) {
        const item = recordOf(listItem(listAt(m[2])));
        const rec = recordNamed(m[1]);
        if (item && rec && item !== rec) say("TYPE", `\`${x}\`: ${m[2]} holds ${item}s, and that ${m[1]} is a ${rec}`);
        return !!item;
      }
      // remove from @xs every ticket whose …
      if ((m = x.match(/^remove\s+from\s+@([a-z]\w*)\s+(?:every|each|the|any)\s+([a-z]\w*)\s+(?:whose|where)\s+(.+)$/))) {
        const item = recordOf(listItem(typeOfValue(fitOf(m[1], scope, row))));
        if (!item) return false;
        const cond = typeCond(m[3].replace(/^@/, "@"), new Map([...scope]), item);
        if (cond) say("TYPE", `\`${x}\`: ${cond}`);
        return cond !== undefined;
      }
      if ((m = x.match(/^call\s+@?([a-z]\w*)\.([a-z]\w*)(?:\s+with\s+(.+))?$/))) {
        const ep = app.clients?.find((c) => c.alias === m![1])?.contract.endpoints?.find((e) => e.name === m![2]);
        if (!ep) return false;
        return !m[3] || pairs(m[3], (f) => ep.params.find((p) => p.name === f)?.type, `call ${m[1]}.${m[2]}`, () => false);
      }
      if ((m = x.match(/^publish\s+@([a-z]\w*)(?:\s+with\s+(.+))?$/))) return !m[2] || typedValue(m[2]);
      if ((m = x.match(/^undo\s+@([a-z]\w*)\.([a-z]\w*)$/))) return true;
      if ((m = x.match(/^go\s+to\s+@([a-z]\w*)(?:\s+with\s+(.+))?$/))) return !m[2] || /@/.test(m[2]) === false || m[2].split(/\s*(?:,|\band\b)\s*/).every((p) => !/=/.test(p) || typedValue(p.split("=")[1]));
      if ((m = x.match(/^(?:answer\s+)?\d{3}(?:\s+with\s+(.+)|\s+("(?:[^"\\]|\\.)*"))?$/))) return !m[1] || typedValue(m[1]);
      return false;
    };
    /** Several steps in one sentence: `…; …` and `…, and set …`. One pass: the separators outside
     *  strings and brackets, walked from the right as `topLevel` finds them (each before the last),
     *  cut where the next words start a step (`; ` always). Linear in the sentence. */
    const steps = (t: string): string[] => {
      const OPS = ["; ", ", and ", " and "];
      const hits: { at: number; op: string }[] = [];
      let d = 0, q = false;
      for (let i = 0; i < t.length; i++) {
        if (t[i] === '"' && t[i - 1] !== "\\") q = !q;
        if (q) continue;
        if (t[i] === "(") d++;
        else if (t[i] === ")") d--;
        else if (d === 0 && i > 0) for (const op of OPS) if (t.startsWith(op, i)) hits.push({ at: i, op });
      }
      // From the right, each separator ends before the next one found starts (they never overlap).
      const chain: { at: number; op: string }[] = [];
      let end = t.length;
      for (let k = hits.length - 1; k >= 0; k--) if (hits[k].at + hits[k].op.length <= end) (chain.push(hits[k]), (end = hits[k].at));
      chain.reverse();
      const out: string[] = [];
      let start = 0;
      for (const h of chain) {
        if (h.at <= start) continue; // a separator at the very start of what is left is not one
        const after = t.slice(h.at + h.op.length).trimStart();
        if (h.op === "; " || /^(set|clear|add|call|increase|decrease|remove|publish|go|undo|answer|stop)\b/.test(after)) {
          out.push(t.slice(start, h.at));
          start = h.at + h.op.length;
        }
      }
      return [...out, t.slice(start)];
    };
    // Conditions whose two sides are single references are reported by the checks above; the typer
    // reports what they cannot see (expressions, emptiness, containment).
    const simple = (c: string) => new RegExp(`^${REF}\\s+is\\s+(?:not\\s+)?(?:${NUM_CMP}\\s+)?(?:${REF}|-?\\d+(?:\\.\\d+)?)$`).test(c.trim());
    let typed = true; // the sentence is typed whole (otherwise the rule below keeps nothing from escaping)
    if (kind === "step") cover(text, line, where, (typed = steps(text).map(typeOne).every(Boolean)));
    else if (kind === "cond" || kind === "always") {
      const msg = typeCond(text, scope, row);
      if (msg && (!simple(text) || msg.includes("∅"))) say("TYPE", `\`${text.trim()}\`: ${msg}`);
      cover(text, line, where, (typed = msg !== undefined));
    } else if (kind === "value") {
      // An element's value: a template (its holes typed), or a value. What is shown is a T: a value
      // that may be nothing says what then (a select's value may be nothing: it shows no choice).
      const template = /^"/.test(text.trim());
      const holes = template ? [...text.matchAll(/\{([^{}]*)\}/g)].map((h) => h[1]) : [text];
      inText = template;
      typed = holes.every((h) => {
        if (!/@/.test(h)) return true;
        const v = value(h);
        if (v?.k === "error") say("TYPE", `\`${h.trim()}\`: ${v.msg}`);
        else if (v?.k === "type" && v.t.k === "Maybe" && !/^select\s/.test(where)) say("NOTHING", `\`${h.trim()}\` is shown, and it may be nothing (${show(v.t)}): ${NOTHING_HOW}`);
        return !!v;
      });
      cover(text, line, where, typed);
      inText = false;
    } else if (kind === "derive") {
      // A derived value may be `T or nothing`; what it reads may not be nothing where a T is needed.
      const v = value(text);
      if (v?.k === "error" && v.msg.includes("∅")) say("NOTHING", `\`${text.trim()}\`: ${v.msg}`);
      if (!v) {
        const c = typeCond(text, scope, row);
        if (c?.includes("∅")) say("NOTHING", `\`${text.trim()}\`: ${c}`);
        typed = c !== undefined;
      }
    }

    // ---------------------------------------------------------------- reads and writes through references
    if (kind === "rules") return;
    // `the @subject of its @ticket` is `its @ticket's @subject`: one form to look at.
    const flat = text.replace(new RegExp(`\\bthe\\s+@([a-z]\\w*)\\s+of\\s+((?:its\\s+|(?:that|this)\\s+[a-z]\\w*['’]s\\s+)?@[a-z][\\w.]*(?:['’]s\\s+@[a-z]\\w*)*)`, "g"), (all, f: string, owner: string) => {
      const t = typeOfValue(typeExpr(owner, scope, row));
      return t && strip(t).k === "Ref" ? `${owner}'s @${f}` : all;
    });
    const fallback = /\bwhen there (?:is|are) (?:none|no)\b|\bor nothing\b|\bwhen none\b/.test(flat);
    const residue: string[] = []; // reads through references with no fallback or guard, for an untyped sentence
    const guarded = (c: Chain) => c.guards.every((g) => scope.has(`∃${g}`));
    for (const m of flat.matchAll(new RegExp(CHAIN_SRC, "g"))) {
      if (!m[5]) continue;
      const c = chainInfo(m[0], scope, row);
      if (!c?.follows.length) continue;
      const after = flat.slice(m.index! + m[0].length);
      const condition = kind === "cond" || kind === "always" || /^\s+(?:is|are|contains|has|have|does|exists|includes)\b/.test(after);
      navs.push({ line, where, chain: m[0], follows: c.follows, fallback, guarded: guarded(c), condition, list: c.list });
      const target = /\b(?:set|increase|decrease|clear)\s+$/.test(flat.slice(0, m.index!)); // a write: NAV_WRITE's
      if (!fallback && !guarded(c) && !c.list && !target && !(condition && /^\s+(?:is|are|exists|does)\b/.test(after) && !new RegExp(`^\\s+is\\s+(?:not\\s+)?(?:${NUM_CMP}|empty|blank)\\b`).test(after))) residue.push(m[0]);
    }
    // A write through a reference needs the row: only inside `if … exists { }` (or after `… does not exist { stop }`).
    if (kind === "step")
      for (const st of steps(flat)) {
        const s0 = st.trim().replace(/[.;]$/, "");
        const w = s0.match(new RegExp(`^(?:set|increase|decrease|clear)\\s+(${CHAIN_SRC})(?=\\s+(?:to|by)\\b|\\s*$)`)) ?? s0.match(new RegExp(`^(?:add|remove)\\s+.+?\\s+(?:to|from)\\s+(?:the\\s+(?:end|start)\\s+of\\s+)?(${CHAIN_SRC})$`));
        if (!w?.[6]) continue;
        const c = chainInfo(w[1], scope, row);
        if (!c?.follows.length || c.list || guarded(c)) continue;
        const g = c.guards.find((x) => !scope.has(`∃${x}`))!;
        const target = c.homes[c.guards.indexOf(g)]?.rec ?? "row";
        say("NAV_WRITE", `\`${s0}\` writes through a reference, and the ${target[0].toLowerCase() + target.slice(1)} it points at may be gone: ask first (\`if ${spellKey(g)} does not exist { … stop }\`, or \`if ${spellKey(g)} exists { … }\`), then write to that ${target[0].toLowerCase() + target.slice(1)}`);
      }
    // `the @subject of the ticket whose @id is its @ticket`: a lookup of a reference's own row is navigation (a hint).
    for (const m of text.matchAll(new RegExp(`\\b(?:the\\s+@([a-z]\\w*)\\s+of\\s+the|there\\s+is\\s+(a|an|no))\\s+([a-z]\\w*)\\s+(?:in\\s+@([a-z]\\w*)\\s+)?whose\\s+@([a-z]\\w*)\\s+is\\s+(${CHAIN_SRC})(?![\\w.'’])`, "g"))) {
      const rec = recordNamed(m[3]);
      if (!rec || keyOf(rec) !== m[5]) continue;
      const v = typeOfValue(typeExpr(m[6], scope, row));
      const r = v && strip(v);
      if (r?.k !== "Ref" || r.name !== rec) continue;
      const home = homeOf(app, rec, r.in);
      if (!home.list || (m[4] && m[4] !== home.list)) continue;
      if (m[2] && m[0].length !== text.trim().length) continue; // `there is …` as the whole condition only
      spellings.push({ line, from: m[0], to: m[1] ? `${m[6]}'s @${m[1]}` : `${m[6]} ${m[2] === "no" ? "does not exist" : "exists"}` });
    }

    // ---------------------------------------------------------------- nothing escapes
    // A sentence the typer does not type whole may still read a value that may be nothing: then it
    // must say what happens (an elvis, a guard), as a typed one must. Conservative, like Kotlin: a
    // value of unknown use that may be nothing is an error until the sentence handles it.
    if (typed) return;
    const says = /\bwhen there (?:is|are) (?:none|no|nothing)\b|\bor nothing\b|\bwhen none\b|\bif there is no\b|\bwhen it is nothing\b/.test(text);
    if (says) return;
    const code = (kind === "value" && /^"/.test(text.trim()) ? [...text.matchAll(/\{([^{}]*)\}/g)].map((h) => h[1]).join(" ") : text).replace(/"(?:[^"\\]|\\.)*"/g, '""');
    const esc = (x: string) => x.replace(/\./g, "\\.");
    const handled = (x: string) =>
      new RegExp(`there\\s+(?:is|are)\\s+(?:a\\s+|an\\s+|no\\s+)?@${esc(x)}\\b|\\bno\\s+@${esc(x)}\\b|@${esc(x)}\\s+is\\s+(?:not\\s+)?(?:nothing|set)\\b|without\\s+(?:a\\s+|an\\s+)?@${esc(x)}\\b|\\b(?:set|clear)\\s+@${esc(x)}\\b|@${esc(x)}\\s*=\\s|@${esc(x)}\\s+(?:exists|does\\s+not\\s+exist)\\b`).test(code);
    const optional = [...new Set([...code.matchAll(/(?<!['’]s\s)@([a-z][\w.]*)/g)].map((m) => m[1]))].filter((x) => {
      const f = fitOf(x, scope, row);
      return f.k === "type" && f.t.k === "Maybe" && !handled(x);
    });
    const lookup = [...code.matchAll(/\b(?<!there\s+is\s+(?:a|an|no)\s+)the\s+([a-z]\w*)\s+(?:in\s+@[a-z][\w.]*\s+)?(?:whose|where)\b/g)].some((m) => !!recordNamed(m[1]) && !/s$/.test(m[1]) && !(app.state.some((f) => f.name === m[1]) || derivedTypes.has(m[1])));
    const what = [...optional.map((x) => `@${x} may be nothing`), ...residue.map((c) => `\`${c}\` reads through a reference`), ...(lookup ? ["a lookup (`the … whose …`) may find nothing"] : [])];
    if (what.length) say("NOTHING", `${what.join("; ")}, and this sentence does not say what happens then: ${NOTHING_HOW}`);
  };

  // ---------------------------------------------------------------- change rules (v67)
  // A named form (`never changes`, `never goes down/up`, `only changes from @A to @B`, `is never
  // removed`) is typed whole here: its subject, its record's key and home, its condition, and what
  // the form needs of the subject's type. The general form is typed as any `always` sentence, with
  // `@x before`, `was` and `the new @xs` in the typer. Returns false for a one-moment sentence.
  const changeRule = (text: string, line: number): boolean => {
    const c = parseChange(text);
    if (!c) return false;
    if (line >= LINE_BASE) return true; // from a bundle: checked there
    if (!("named" in c) || !c.named) {
      check(text, line, "always", new Map(), undefined, undefined, "always");
      return true;
    }
    const f = c.named;
    const s = f.subject;
    const said = new Set<string>();
    const say = (code: string, msg: string) => {
      if (said.has(code)) return;
      said.add(code);
      err(line, code, `${msg} (always)`);
    };
    const words = { frozen: "never changes", order: `never goes ${f.form === "order" ? f.dir : ""}`, transitions: "only changes from … to …", kept: "is never removed" }[f.form];
    let t: Type | undefined; // the subject's value (a field, a state value); undefined for rows, or untyped
    let typed = true;
    if (s.k === "state") {
      const v = typeExpr(`@${s.name}${s.hops.map((h) => `'s @${h}`).join("")}`, new Map());
      if (v?.k === "error") say(v.msg.includes("∅") ? "NOTHING" : "TYPE", `\`${c.subjectText}\`: ${v.msg.replace(/∅/g, "")}`);
      t = typeOfValue(v);
      if (!t) typed = false;
    } else {
      const rec = records.get(s.record);
      if (!rec) typed = false;
      else {
        if (!keyOf(s.record)) say("NO_KEY", `\`${c.subjectText} ${words}\`: ${s.record} has no key, so its rows cannot be matched before and after a step: name its key field \`id\`, or mark one \`key code: Text\``);
        const lists = homeLists(app, s.record);
        if (s.list && !lists.includes(s.list)) say("TYPE", `\`in @${s.list}\`: ${state.has(s.list) ? `@${s.list} is ${show(state.get(s.list)!)}` : `@${s.list} is not a state field`}, not a state list of ${s.record}${lists.length ? ` (${lists.map((l) => `@${l}`).join(", ")} ${lists.length > 1 ? "are" : "is"})` : ""}`);
        const home = homeOf(app, s.record);
        // Rows inside the rows of one state list (a list inside a row): matched by the path of keys.
        const inner = !lists.length && innerHomes(app, s.record).length === 1 && !!innerHomes(app, s.record)[0].outerKey;
        if (!s.list && home.problem && !inner) say("HOME", `\`${c.subjectText}\` reads the rows of the state list of ${s.record}s, but ${home.problem}: name it (\`a @${s.record} in @${lists[0] ?? "…"}\`)`);
        if (s.k === "field" && s.field === keyOf(s.record))
          say("CHANGE", `\`${c.subjectText} ${words}\`: rows are matched by their key before and after a step, so a row whose ${s.field} changes reads as one row removed and another added, and this rule would never see it: say \`a @${s.record} is never removed\` (keys stay, rows stay), or give the rule to another field`);
        if (s.k === "field") {
          const fld = rec.fields.find((x) => x.name === s.field);
          if (!fld) {
            if (declaredField(s.field)) say("UNKNOWN_NAME", `\`${c.subjectText}\`: ${s.record} has no field \`${s.field}\` (${rec.fields.map((x) => x.name).join(", ")})`);
            typed = false;
          } else t = fld.type;
        } else if (s.cond) {
          const msg = typeCond(s.cond, new Map(), s.record);
          if (msg) say(msg.includes("∅") ? "NOTHING" : "TYPE", `\`whose ${s.cond}\`: ${msg.replace(/∅/g, "")}`);
          if (msg === undefined) typed = false;
        }
      }
    }
    const rows = s.k === "rows";
    if (f.form === "order") {
      if (rows) say("TYPE", `\`${words}\` orders a number or a moment, and a row is neither: name its field (\`a @${s.record}'s @… ${words}\`)`);
      else if (t && !numeric(t) && !temporal(t)) say("TYPE", `\`${c.subjectText} ${words}\`: it is ${show(t)}, which has no order (a number or a moment has)`);
      else if (t?.k === "Maybe") say("NOTHING", `\`${c.subjectText} ${words}\`: it may be nothing (${show(t)}), and an order needs a value before and after the step: keep it a ${show(t.of)}, or say what then in the general form (\`… is at least … before, or … when there is none\`)`);
    } else if (f.form === "transitions") {
      const inner = t && strip(t);
      const choice = inner?.k === "Named" ? app.choices.find((x) => x.name === inner.name) : undefined;
      if (rows) say("TYPE", `\`${words}\` is about a field: name it (\`a @${s.record}'s @status only changes from …\`)`);
      else if (t && !choice && inner?.k !== "Bool") say("TYPE", `\`${c.subjectText} ${words}\`: it is ${show(t)}; a transition table is for a choice or a yes/no`);
      else if (t) {
        const fitsValue = (v: string) => (v === "nothing" ? t!.k === "Maybe" : choice ? choice.values.includes(v) : v === "true" || v === "false");
        const seen = new Set<string>();
        for (const [a, b] of f.pairs) {
          if (!b) {
            say("TYPE", `\`${words}\`: expected \`from @A to @B\` (\`or @C\` for more targets, \`, from @D to @E\` for more pairs)`);
            continue;
          }
          const bad = [a, b].find((v) => !fitsValue(v));
          if (bad) say("TYPE", `\`${c.subjectText} ${words}\`: ${bad === "nothing" ? `it is ${show(t)}, never nothing` : `\`${bad}\` is not a value of ${choice ? choice.name : "a yes/no"}${choiceOf.has(bad) ? ` (it is a ${choiceOf.get(bad)!.join(" / ")})` : ""}`}`);
          else if (a === b) say("TYPE", `\`from @${a} to @${b}\` is not a change: every value may stay as it is`);
          else if (seen.has(`${a}→${b}`)) say("DUPLICATE", `\`from @${a} to @${b}\` is listed twice`);
          seen.add(`${a}→${b}`);
        }
      }
    } else if (f.form === "kept" && !rows) say("TYPE", `\`${words}\` is about rows (\`a @Ticket is never removed\`); a value is never removed, it changes (\`${c.subjectText} never changes\`)`);
    cover(text, line, "always", typed);
    return true;
  };

  // ---------------------------------------------------------------- which row "that ticket" / "its" means
  // A step may speak of "that ticket", "this habit", "the new charge" or "its @f" only when a record of
  // that kind was introduced before it: the clicked row, a loop row, a lookup (`if no ticket has that
  // @id …`, `the ticket whose …`), or a new record (`add a @Charge …`). Anything else leaves two
  // compilers to pick a row each: an error (NO_ROW).
  const introduces = (text: string, rows: string[]): string[] => {
    const out = [...rows];
    const add = (r: string | undefined) => r && !out.includes(r) && out.push(r);
    for (const m of text.matchAll(/\b(?:the|a|an|no|any|some|every|each|one)\s+([a-z]\w*)\s+(?:in\s+@[a-z][\w.]*\s+)?(?:whose|where|has|have|with|for|that|which)\b/g)) add(recordNamed(m[1]));
    for (const m of text.matchAll(/\b(?:the|a|an|no|any|some|one)\s+(?:row|item|entry|one)\s+in\s+@([a-z][\w.]*)/g)) add(recordOf(listItem(typeOfValue(fitOf(m[1], new Map())))));
    for (const m of text.matchAll(/\badd\s+(?:an?|the new)\s+@([A-Z]\w*)/g)) add(records.has(m[1]) ? m[1] : undefined);
    for (const m of text.matchAll(/\b(?:the|a|an|no|any|some|every|each|one)\s+@([A-Z]\w*)\s+(?:in\s+@[a-z][\w.]*\s+)?(?:whose|where|has|have|with|for|that|which)\b/g)) add(records.has(m[1]) ? m[1] : undefined);
    for (const m of text.matchAll(/\bthere\s+(?:is|are)\s+(?:a|an|no)\s+([a-z]\w*)\b/g)) add(recordNamed(m[1]));
    for (const m of text.matchAll(/\bfind\s+the\s+([a-z]\w*)\b/g)) add(recordNamed(m[1]));
    for (const m of text.matchAll(/^for\s+(?:a|an|each)\s+([a-z]\w*)\s*:/g)) add(recordNamed(m[1]));
    // `if that comment's @ticket exists`: that ticket is there (inside, or after `does not exist { stop }`)
    for (const m of text.matchAll(new RegExp(`(${CHAIN_SRC})\\s+(?:exists|does\\s+not\\s+exist)\\b`, "g"))) {
      const last = m[6] ? [...m[6].matchAll(/@([a-z]\w*)/g)].pop()![1] : m[5];
      const t = (m[6] || m[2] || m[3] ? fieldTypes.get(last) : undefined) ?? typeOfName(last) ?? fieldTypes.get(last);
      const inner = t && strip(t);
      if (inner?.k === "Ref") add(inner.name);
    }
    return out;
  };
  const uses = (raw: string, rows: string[], line: number, where: string, answerOrEvent: boolean) => {
    if (line >= LINE_BASE) return;
    const text = raw.replace(/"(?:[^"\\]|\\.)*"/g, '""'); // what a string says is not a reference
    const said = new Set<string>(); // `that task's @a and that task's @b`: one missing row, said once
    const say = (what: string, rec: string) =>
      !said.has(what) && said.add(what) &&
      err(line, "NO_ROW", `\`${what}\` (${where}): no ${rec[0].toLowerCase() + rec.slice(1)} is chosen or found before this step; find it first (\`the ${rec[0].toLowerCase() + rec.slice(1)} whose @${keyOf(rec) ?? "id"} is …\`), or say which one`);
    for (const m of text.matchAll(/\b(that|this|the\s+new)\s+([a-z]\w*)\b/g)) {
      const rec = recordNamed(m[2]);
      if (rec && !rows.includes(rec)) say(`${m[1]} ${m[2]}`, rec);
    }
    // `its @f`: the row this step is about (in an answer's or event's handler, `its` is the answer or event)
    if (!answerOrEvent && !rows.length)
      for (const m of text.matchAll(/\bits\s+(@?[a-z]\w*)/g)) if (!/^(own|way|turn|place|order|full|new|next|previous)$/.test(m[1]) && !said.has(`its ${m[1]}`) && said.add(`its ${m[1]}`)) err(line, "NO_ROW", `\`its ${m[1]}\` (${where}): nothing before this step says whose; find the row first, or name it`);
  };

  // Bodies, with what is in scope: loop rows, endpoint params, the answer's or event's body types.
  const walk = (b: Stmt[] | undefined, steps: string[], lines: number[] | undefined, fallback: number, where: string, scope: Map<string, Type>, bodyTypes?: Type[], row?: string, rows: string[] = row ? [row] : [], answerOrEvent = false) => {
    const sentence = (text: string, line: number, kind: Kind, sc = scope) => {
      rows = introduces(text, rows);
      uses(text, rows, line, where, answerOrEvent);
      // "its @f" means the row introduced last, unless the sentence also speaks of something that is not a record ("that result").
      const other = [...text.replace(/"(?:[^"\\]|\\.)*"/g, "").matchAll(/\b(?:that|this)\s+([a-z]\w*)\b/g)].some((m) => !recordNamed(m[1]));
      it = other ? undefined : (row ?? rows[rows.length - 1]);
      check(text, line, where, sc, row, bodyTypes, kind);
      it = undefined;
    };
    if (!b) {
      steps.forEach((s, i) => sentence(s, lines?.[i] ?? fallback, "step"));
      return;
    }
    // What the steps in some statements may change (their smart casts end after them).
    const writtenIn = (stmts: Stmt[]): Set<string> => {
      const out = new Set<string>();
      const go = (ss: Stmt[]) =>
        ss.forEach((x) => {
          if (x.k === "step" || x.k === "answer") writes(x.text).forEach((n) => out.add(n));
          else if (x.k === "if") x.branches.forEach((br) => go(br.body));
          else if (x.k === "for") go(x.body);
        });
      go(stmts);
      return out;
    };
    const exits = (body: Stmt[]) => {
      const last = body[body.length - 1];
      return !!last && (last.k === "stop" || last.k === "answer");
    };
    for (const s of b) {
      if (s.k === "step" || s.k === "answer") {
        answering = s.k === "answer";
        sentence(s.text, s.line, "step");
        answering = false;
        scope = unsettle(scope, writes(s.text));
      } else if (s.k === "if") {
        // Smart casts: each branch sees its condition hold and the conditions before it not (an
        // `else` sees none hold). A lookup in a condition introduces its row for the branch and after.
        let rest = scope;
        for (const br of s.branches) {
          if (br.cond) sentence(br.cond, br.line, "cond", rest);
          walk(br.body, [], undefined, br.line, where, narrowBy(rest, br.cond, true, row), bodyTypes, row, [...rows], answerOrEvent);
          rest = narrowBy(rest, br.cond, false, row);
        }
        // After `if there is no @x { stop }` (every branch with a condition exits): none of them held.
        const fallsThrough = s.branches.filter((br) => !exits(br.body));
        if (s.branches.every((br) => br.cond === undefined || exits(br.body))) scope = rest;
        scope = unsettle(scope, writtenIn(fallsThrough.flatMap((br) => br.body)));
      } else if (s.k === "for") {
        const lt = typeOfValue(typeExpr(s.list, scope, row));
        const f: Fit = lt ? { k: "type", t: lt } : UNKNOWN;
        if (f.k === "type" && f.t.k === "Maybe" && s.line < LINE_BASE) err(s.line, "NOTHING", `\`for each @${s.name} in ${s.list}\`: the list may be nothing (${show(f.t)}); ${NOTHING_HOW} (${where})`);
        const inner = new Map(scope);
        const item = f.k === "type" ? listItem(f.t) : undefined;
        if (item) inner.set(s.name, item);
        else inner.delete(s.name);
        const loopRows = item && recordOf(item) ? [...rows, recordOf(item)!] : rows;
        if (s.where) check(s.where, s.line, where, inner, row, bodyTypes, "cond");
        noteDraws(s.list, s.line, where, scope, row); // `for each @card in @deck shuffled`
        loops++;
        try {
          walk(s.body, [], undefined, s.line, where, s.where ? narrowBy(inner, s.where, true, row) : inner, bodyTypes, row, loopRows, answerOrEvent);
        } finally {
          loops--;
        }
        scope = unsettle(scope, writtenIn(s.body));
      }
    }
  };
  // The rows a handler's element sits in (the outer row first): `that ticket` is the row's record,
  // `that task` the outer row's in a row inside a row, and bare fields read from the innermost.
  const rowOf = new Map<string, string[]>();
  // An element is shown only while it is visible (the interface has no value for it otherwise):
  // `visible when there is a @x`, on it or on a section around it, smart-casts @x in its value.
  const elements = (els: Element[], rows: string[] = [], sc: Map<string, Type> = new Map()) => {
    const row = rows[rows.length - 1];
    for (const el of els) {
      if (rows.length && ["button", "checkbox", "field", "select"].includes(el.kind)) rowOf.set(el.name, rows);
      const record = el.kind === "list" && el.of && records.has(el.of) ? el.of : undefined;
      // A list's own sentences read its rows (`whose @status …`); a list inside a row reads the row
      // around it (`= its @items whose @done is false`): `its` is that outer row.
      const inner = record && !rows.length ? record : row;
      const where = `${el.kind} ${el.name}`;
      if (el.visibleWhen) check(el.visibleWhen, el.line, where, sc, inner, undefined, "cond");
      const own = narrowBy(sc, el.visibleWhen, true, inner);
      if (el.expr) check(el.expr, el.line, where, own, inner, undefined, "value");
      if (el.enabledWhen) check(el.enabledWhen, el.line, where, own, inner, undefined, "cond");
      for (const text of [el.expr, el.visibleWhen, el.enabledWhen]) if (text) uses(text, introduces(text, record && !rows.length ? [record] : rows), el.line, where, false);
      // `list items of Item = …`: the value is a list of Items.
      if (el.kind === "list" && el.expr && el.line < LINE_BASE && records.has(el.of ?? "")) {
        const t = typeOfValue(typeExpr(el.expr, own, inner));
        const item = t && listItem(t);
        if (t && !item) err(el.line, "TYPE", `\`list ${el.name} of ${el.of} = …\`: the value is ${show(t)}, not a list (${where})`);
        else if (item && strip(item).k === "Named" && records.has((strip(item) as { name: string }).name) && (strip(item) as { name: string }).name !== el.of) err(el.line, "TYPE", `\`list ${el.name} of ${el.of} = …\`: the value is ${show(t!)}, so its rows are not ${el.of}s (${where})`);
      }
      elements(el.children, record ? [...rows, record] : rows, own);
    }
  };
  elements(app.screen);
  for (const d of app.derive) {
    uses(d.sentence, introduces(d.sentence, []), d.line, `derive ${d.name}`, false);
    check(d.sentence, d.line, `derive ${d.name}`, new Map(), undefined, undefined, "derive");
    cover(d.sentence, d.line, `derive ${d.name}`, !!derivedTypes.get(d.name));
  }
  for (const a of app.invariants ?? []) if (!changeRule(a.text, a.line)) check(a.text, a.line, "always", new Map(), undefined, undefined, "always");
  app.rules.forEach((r, i) => check(r, app.ruleLines?.[i] ?? 0, "rules", new Map(), undefined, undefined, "rules"));
  for (const h of app.handlers) {
    const where = `on ${h.verb}${h.target ? " " + h.target : ""}`;
    let bodyTypes: Type[] | undefined;
    if (h.verb === "event" || h.verb === "answer") {
      const [alias, name] = h.target.split(".");
      const contract = app.clients?.find((c) => c.alias === alias)?.contract;
      bodyTypes =
        h.verb === "event"
          ? [contract?.events?.find((e) => e.name === name)?.type].filter((t): t is Type => !!t)
          : (contract?.endpoints?.find((e) => e.name === name)?.answers ?? []).filter((a) => a.type && a.status < 300).map((a) => a.type!);
    }
    // `its body`: the event's payload, or the answer's success body when every success answer has the same type.
    const scope = new Map<string, Type>();
    if (bodyTypes?.length && bodyTypes.every((t) => same(t, bodyTypes![0]))) scope.set("its body", bodyTypes[0]);
    // The row (and, in a row inside a row, the outer row) the handled element sits in.
    const rows = ["click", "toggle", "type", "choose"].includes(h.verb) ? rowOf.get(h.target) : undefined;
    walk(h.body, h.steps, h.stepLines, h.line, where, scope, bodyTypes, rows?.[rows.length - 1], rows ?? [], h.verb === "answer" || h.verb === "event");
  }
  for (const ep of app.endpoints ?? []) walk(ep.body, ep.steps, ep.stepLines, ep.line, `endpoint ${ep.name}`, new Map(ep.params.map((p) => [p.name, p.type])));
  for (const j of app.jobs ?? []) walk(j.body, j.steps, j.stepLines, j.line, `every ${j.name.slice(5)}`, new Map());

  // Derived values used where their type matters, with none known: a quality rule's to report (UNTYPED).
  app.facts = { ...app.facts, draws: [...drawFacts.values()], navigations: navs, navSpelling: spellings, untypedDerived: [...untyped].filter(([n]) => (app.derive.find((d) => d.name === n)?.line ?? LINE_BASE) < LINE_BASE).map(([name, where]) => ({ name, where })) };

  // Seeded rows refer to rows that exist: a `ref Ticket` in a seeded table holds a seeded Ticket's key.
  const seeded = new Map<string, Set<string>>(); // record → the keys its seeded lists hold
  const hasList = new Set<string>(); // records some state list holds
  for (const f of app.state) {
    const item = listItem(f.type);
    const rec = item?.k === "Named" && records.has(item.name) ? item.name : undefined;
    if (!rec) continue;
    hasList.add(rec);
    const key = keyOf(rec);
    if (f.default?.k !== "table" || !key) continue;
    const col = f.default.columns.indexOf(key);
    const keys = seeded.get(rec) ?? new Set<string>();
    if (col >= 0) for (const r of f.default.rows) keys.add(literalKey(r[col]));
    seeded.set(rec, keys);
  }
  // A reference's home, named on the field (`ref Ticket in tickets`), is a state list of that record.
  for (const r of refTypes(app))
    if (r.t.in && r.line < LINE_BASE && !homeLists(app, r.t.name).includes(r.t.in))
      err(r.line, "TYPE", `\`${r.field}: ref ${r.t.name} in ${r.t.in}\`: ${state.has(r.t.in) ? `@${r.t.in} is ${show(state.get(r.t.in)!)}` : `there is no state field \`${r.t.in}\``}, not a state list of ${r.t.name}${homeLists(app, r.t.name).length ? ` (${homeLists(app, r.t.name).map((l) => `@${l}`).join(", ")} ${homeLists(app, r.t.name).length > 1 ? "are" : "is"})` : ""}`);
  // A home a reference points into has one row per key: two seeded rows with one key are two answers.
  for (const h of referencedHomes(app)) {
    const f = app.state.find((x) => x.name === h.list)!;
    if (f.default?.k !== "table" || f.line >= LINE_BASE) continue;
    const col = f.default.columns.indexOf(h.key);
    const seen = new Map<string, number>();
    f.default.rows.forEach((row, i) => {
      const k = literalKey(row[col]);
      if (col < 0 || !row[col]) return;
      if (seen.has(k)) err(f.line + 2 + i, "DUPLICATE", `\`${h.list}\` row ${i + 1}: ${h.key} ${k} is already row ${seen.get(k)! + 1}'s; a reference to a ${h.record} finds one row by its key`);
      else seen.set(k, i);
    });
  }
  // The keys seeded in each list, for a reference into it.
  const listKeys = new Map<string, Set<string>>();
  for (const f of app.state) {
    const rec = recordOf(listItem(f.type));
    const key = rec ? keyOf(rec) : undefined;
    if (f.default?.k !== "table" || !key) continue;
    const col = f.default.columns.indexOf(key);
    listKeys.set(f.name, new Set(col >= 0 ? f.default.rows.map((r) => literalKey(r[col])) : []));
  }
  for (const f of app.state) {
    const item = listItem(f.type);
    const rec = item?.k === "Named" ? records.get(item.name) : undefined;
    if (!rec || f.default?.k !== "table" || f.line >= LINE_BASE) continue;
    const table = f.default;
    for (const field of rec.fields) {
      const t = strip(field.type);
      if (t.k !== "Ref" || !hasList.has(t.name)) continue;
      const col = table.columns.indexOf(field.name);
      if (col < 0) continue;
      // Its home's seeded keys; with no one home, any list of that record's.
      const home = homeOf(app, t.name, t.in).list;
      const keys = (home ? listKeys.get(home) : undefined) ?? (home ? new Set<string>() : (seeded.get(t.name) ?? new Set<string>()));
      table.rows.forEach((r, i) => {
        const v = r[col];
        if (!v || v.k === "nothing") return;
        if (!keys.has(literalKey(v))) err(f.line, "UNKNOWN_NAME", `\`${f.name}\` row ${i + 1}: \`${field.name}\` is ${literalKey(v)}, but no seeded ${t.name} has that ${keyOf(t.name) ?? "key"}`);
      });
    }
  }
  return coverage;
}

function literalKey(l: Literal | undefined): string {
  return !l ? "" : l.k === "text" || l.k === "value" || l.k === "date" || l.k === "dateTime" ? String(l.v) : l.k === "number" ? String(l.v) : l.k === "bool" ? String(l.v) : "";
}

function same(a: Type, b: Type): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}
