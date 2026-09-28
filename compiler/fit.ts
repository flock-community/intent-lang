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

export function checkFit(app: App, err: Err): Coverage[] {
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
  const keyType = (r: string): Type => records.get(r)?.fields.find((f) => f.name === keyOf(r))?.type ?? { k: "Int" };
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
  const typeOfValue = (v: Value): Type | undefined => (v?.k === "type" ? v.t : undefined);
  const needs = (inner: Value, ok: (t: Type) => boolean, what: string, result: Type | undefined): Value => {
    if (inner?.k === "error") return inner;
    const t = typeOfValue(inner);
    if (t && !ok(t)) return wrong(`${what}, not ${show(t)}`);
    return result ? T(result) : undefined;
  };
  const isText = (t: Type) => base(strip(t)).k === "Text";
  let inText = false; // typing a template's hole: every value is shown as text
  let it: string | undefined; // the record "its @f" and "that ticket" mean in the sentence being checked
  const typeExpr = (raw: string, scope: Map<string, Type>, row?: string): Value => {
    let x = raw.trim().replace(/[;.,]$/, "").trim();
    while (/^\(.*\)$/.test(x) && balanced(x.slice(1, -1))) x = x.slice(1, -1).trim();
    const at = (e: string) => typeExpr(e, scope, row);
    let m: RegExpMatchArray | null;
    if (x === "nothing") return { k: "nothing" };
    if (/^"(?:[^"\\]|\\.)*"$/.test(x) || /^-?\d+(?:\.\d+)?$/.test(x) || /^(true|false)$/.test(x)) return T(literalType(x)!);
    // A trailing note in brackets (`+ 1 (1 when there are none)`) says what happens at the edges; the value is before it.
    if (/\)$/.test(x) && !/^\(/.test(x)) {
      const open = x.lastIndexOf(" (");
      if (open > 0 && balanced(x.slice(open + 1))) return at(x.slice(0, open));
    }
    // `…, rounded down` / `…, trimmed`: after a comma, a postfix word applies to everything before it.
    const post = topLevel(x, [", rounded", ", trimmed", ", in capitals"]);
    if (post) return at(`(${x.slice(0, post.at)})${x.slice(post.at + 1)}`);
    // Arithmetic: numbers in, a number out (a division, or any Decimal, gives a Decimal).
    for (const ops of [[" plus ", " minus ", " + ", " - "], [" times ", " × ", " * ", " divided by ", " / "]]) {
      const hit = topLevel(x, ops);
      if (!hit) continue;
      const rightText = x.slice(hit.at + hit.op.length);
      if (/\b(days?|hours?|minutes?|weeks?|months?|years?)\b/.test(rightText)) return undefined; // time arithmetic: not typed here
      const [l, r] = [at(x.slice(0, hit.at)), at(rightText)];
      if (l?.k === "error") return l;
      if (r?.k === "error") return r;
      const [lt, rt] = [typeOfValue(l), typeOfValue(r)];
      const op = hit.op.trim();
      for (const [side, t] of [["left", lt], ["right", rt]] as const) if (t && !numeric(t)) return wrong(`\`${op}\` needs numbers, but the ${side} side is ${show(t)}`);
      if (!lt || !rt) return undefined;
      const dec = op === "divided by" || op === "/" || base(strip(lt)).k === "Decimal" || base(strip(rt)).k === "Decimal";
      return T({ k: dec ? "Decimal" : "Int" });
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
      return f ? T(strip(f.type)) : undefined;
    }
    if ((m = x.match(/^not\s+(.+)$/))) return needs(at(m[1]), (t) => base(strip(t)).k === "Bool", "`not` needs a yes/no", { k: "Bool" });
    // A reference, or a chain of fields (`@c's @body`): a list's field is a list of that field.
    if ((m = x.match(/^@([a-z]\w*(?:\.[a-z]\w*)*)((?:['’]s\s+@[a-z]\w*)*)$/))) {
      const first = fitOf(m[1], scope, row);
      if (first.k !== "type") return first.k === "unknown" ? undefined : first;
      let t: Type = first.t;
      for (const step of [...m[2].matchAll(/@([a-z]\w*)/g)].map((y) => y[1])) {
        const item = listItem(t);
        const rec = recordOf(item ?? t);
        const f = rec ? records.get(rec)!.fields.find((y) => y.name === step) : undefined;
        if (!f) return undefined; // a missing field or a reference read like a record: reported where the chain is checked
        t = item ? { k: "List", of: f.type } : f.type;
      }
      return first.keyOf && !m[2] ? first : T(t);
    }
    if ((m = x.match(/^@([A-Z]\w*)$/))) {
      const v = fitOf(m[1], scope, row);
      return v.k === "value" ? v : undefined;
    }
    // Tails that keep the type: an order (`, highest @id first`, `, in list order`) or a bound (`, but at least 0`).
    if ((m = x.match(/^(.+?),\s+(?:(?:highest|lowest|newest|oldest|latest|earliest|largest|smallest)\s+@[a-z]\w*\s+first|in\s+(?:list|their|its|the\s+same)\s+order|in\s+the\s+order\s+of\s+.+|sorted\s+by\s+.+|but\s+at\s+(?:least|most)\s+.+)$/))) return at(m[1]);
    // A value that depends on a condition: `A when C; B when D`, `A when C, otherwise B`, `A while C, otherwise B`.
    const alts: string[] = [];
    for (let rest = x; ; ) {
      const cut = topLevel(rest, ["; ", ", otherwise ", " otherwise ", ", or "]);
      if (!cut) {
        alts.unshift(rest.trim());
        break;
      }
      alts.unshift(rest.slice(cut.at + cut.op.length).trim());
      rest = rest.slice(0, cut.at);
    }
    if (alts.length > 1 || topLevel(x, [" when ", " while "])) {
      const types: Type[] = [];
      for (const a of alts) {
        const w = topLevel(a, [" when ", " while "]);
        const v = at(w ? a.slice(0, w.at) : a);
        if (v?.k === "error") return v;
        const cond = w ? typeCond(a.slice(w.at + w.op.length), scope, row) : "";
        if (cond) return wrong(cond);
        const t = typeOfValue(v) ?? (v?.k === "value" && v.choices.length === 1 ? ({ k: "Named", name: v.choices[0] } as Type) : undefined);
        if (!t || cond === undefined) return undefined;
        types.push(t);
      }
      // In a template every alternative is shown as text; elsewhere they share one type. An alternative
      // for the none case (`, or "" when there is none`) makes the value not optional.
      if (inText) return T({ k: "Text" });
      const first = types.find((t) => t.k !== "Maybe") ?? types[0];
      const optional = types.every((t) => t.k === "Maybe");
      if (types.every((t) => comparable(t, first))) {
        const one = strip(types.find((t) => base(strip(t)).k === "Decimal") ?? first);
        return T(optional ? { k: "Maybe", of: one } : one);
      }
      return wrong(`the alternatives are ${types.map(show).join(" and ")}: one value has one type`);
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
    if ((m = x.match(/^(?:the\s+)?@([a-z]\w*)\s+of\s+(@[a-z]\w*(?:\.[a-z]\w*)*)$/))) {
      const rec = recordOf(typeOfValue(at(m[2])));
      const f = rec ? records.get(rec)!.fields.find((y) => y.name === m![1]) : undefined;
      return f ? T(typeOfValue(at(m[2]))!.k === "Maybe" ? { k: "Maybe", of: strip(f.type) } : f.type) : undefined;
    }
    // the ticket in @tickets whose …: one row of that list, which may be missing
    if ((m = x.match(/^the\s+([a-z]\w*)\s+in\s+@([a-z]\w*)\s+(?:whose|where)\b/))) {
      const item = recordOf(listItem(typeOfValue(at("@" + m[2]))));
      return item ? T({ k: "Maybe", of: { k: "Named", name: item } }) : undefined;
    }
    // the @Confirmed @signups whose …: a filtered list, the same list type
    if ((m = x.match(/^(?:the\s+|all\s+)?(?:@[A-Z]\w*\s+)?@([a-z]\w*)\s+(?:whose|where|that|which|with|without|not)\b/))) {
      const t = typeOfValue(at("@" + m[1]));
      if (t && listItem(t)) return T(strip(t));
    }
    const inferred = infer(x);
    return inferred ? T(inferred) : undefined;
  };
  /** Does a value fit where a `to` is wanted? The message when not; "" when it fits; undefined when the value is untyped. */
  const fitsValue = (to: Type, v: Value): string | undefined => {
    if (!v) return undefined;
    if (v.k === "error") return v.msg;
    if (v.k === "nothing") return to.k === "Maybe" ? "" : `nothing, but it is ${show(to)} (no \`or nothing\`)`;
    if (v.k === "value") return valueFits(to, v.choices) ? "" : `a value of ${v.choices.join(" / ")}, but it is ${show(to)}`;
    if (v.k === "type") return fits(to, v.t) ? "" : `${show(v.t)}, but it is ${show(to)}`;
    return undefined;
  };
  /** A condition: yes/no forms over typed values. "" when typed and right, a message when wrong, undefined when untyped. */
  const typeCond = (raw: string, scope: Map<string, Type>, row?: string): string | undefined => {
    const x = raw.trim().replace(/[;.]$/, "").trim();
    const at = (e: string) => typeExpr(e, scope, row);
    let m0: RegExpMatchArray | null;
    // `@x is 3 or more`: one comparison (before "or" is taken to join two conditions)
    if ((m0 = x.match(/^(.+?)\s+is\s+(?:not\s+)?(-?\d+(?:\.\d+)?)\s+or\s+(?:more|less|fewer|higher|lower)$/))) {
      const t = typeOfValue(at(m0[1]));
      return t ? (numeric(t) ? "" : `\`is ${m0[2]} or …\` needs a number, not ${show(t)}`) : undefined;
    }
    // "at or before", "3 or more", "or nothing": an "or" inside a phrase does not join two conditions.
    const masked = x.replace(/\b(at|or) or (before|after|more|less|fewer|higher|lower|nothing)\b|\b(\d+(?:\.\d+)?) or (more|less|fewer|higher|lower)\b|,? or nothing\b/g, (m0) => m0.replace(/ /g, "_"));
    const both = topLevel(masked, [" and ", " or "]);
    if (both) {
      const [l, r] = [typeCond(x.slice(0, both.at), scope, row), typeCond(x.slice(both.at + both.op.length), scope, row)];
      // `@duration is below 1 or above 1440`: the second condition has the first one's subject.
      const right = x.slice(both.at + both.op.length).trim();
      const subject = x.slice(0, both.at).match(/^(.+?)\s+is\s/)?.[1];
      if (subject && new RegExp(`^(?:is\\s|${NUM_CMP}\\s)`).test(right)) {
        const r2 = typeCond(`${subject} ${/^is\s/.test(right) ? right : `is ${right}`}`, scope, row);
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
    if ((m = x.match(/^there\s+is\s+(?:a|an|no)\s+@([a-z][\w.]*)$/))) return fitOf(m[1], scope, row).k === "type" ? "" : undefined;
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
    if ((m = x.match(/^every\s+@([a-z]\w*)\s+(?:in|of)\s+@([a-z][\w.]*)\s+(.+)$/))) {
      const rec = recordOf(listItem(typeOfValue(at("@" + m[2]))));
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
      const t = typeOfValue(at(m[1]));
      if (!t) return undefined;
      if (!isText(t)) return `\`reads as\` is for text, not ${show(t)}`;
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
      const t = typeOfValue(at(m[1]));
      return t ? (base(strip(t)).k === base({ k: "Named", name: m[2] }).k ? "" : `\`is a valid @${m[2]}\` needs ${show(base({ k: "Named", name: m[2] }))}, not ${show(t)}`) : undefined;
    }
    // there is a ticket (in @tickets) whose @id is @y: the lookup's field and value
    if ((m = x.match(/^there\s+is\s+(?:a|an|no)\s+([a-z]\w*)(?:\s+in\s+(@[a-z][\w.]*))?\s+(?:whose|where)\s+@([a-z]\w*)\s+is\s+(?:not\s+)?(.+)$/))) {
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
      const t = typeOfValue(at(m[1]));
      if (!t) return undefined;
      return isText(t) || listItem(t) ? "" : `\`is ${m[2]}\` is for text or a list, not ${show(t)}`;
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
      return (numeric(lt) && numeric(rt)) || (temporal(lt) && temporal(rt)) ? "" : `${show(lt)} and ${show(rt)} cannot be ordered against each other`;
    }
    if ((m = x.match(/^(.+?)\s+contains\s+(.+)$/))) {
      const t = typeOfValue(at(m[1]));
      return t ? (isText(t) || listItem(t) ? "" : `\`contains\` is for text or a list, not ${show(t)}`) : undefined;
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
    if (!/^@[a-z]\w*(?:['’]s\s+@[a-z]\w*)*$/.test(x)) return undefined;
    const t = typeOfValue(at(x));
    return t ? (base(strip(t)).k === "Bool" ? "" : `a condition is a yes/no, not ${show(t)}`) : undefined;
  };

  // Derived values typed by the typer too (after the forms above), and a declared type checked against it.
  for (let pass = 0; pass < 3; pass++)
    for (const d of app.derive) if (!derivedTypes.get(d.name)) derivedTypes.set(d.name, typeOfValue(typeExpr(d.sentence, new Map())) ?? (typeCond(d.sentence, new Map()) === "" ? { k: "Bool" } : undefined));
  for (const d of app.derive) {
    if (!d.type || d.line >= LINE_BASE) continue;
    const got = typeExpr(d.sentence, new Map());
    const msg = fitsValue(d.type, got);
    if (msg) err(d.line, "TYPE", `\`${d.name}\` is declared ${show(d.type)}, but the sentence gives ${msg.replace(/, but it is .*$/, "")}`);
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
        if (msg) say("TYPE", `\`${owner} with @${m[1]} = ${m[2].trim()}\`: the value is ${msg}`);
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

  // Derived values a checked phrase uses but whose type is not known: a hint to declare it.
  const untyped = new Map<string, string>();
  type Kind = "step" | "cond" | "derive" | "value" | "always" | "rules";
  const check = (text: string, line: number, where: string, scope: Map<string, Type>, row?: string, body?: Type[], kind: Kind = "step") => {
    if (line >= LINE_BASE) return; // from a bundle: checked there
    const at = (ref: string) => {
      const f = fitOf(ref, scope, row);
      if (f.k === "unknown" && derivedTypes.has(ref) && !untyped.has(ref)) untyped.set(ref, where);
      return f;
    };
    // One report per kind of problem per sentence: two checks that see the same mistake say it once.
    const said = new Set<string>();
    const say = (code: string, msg: string) => {
      if (said.has(code)) return;
      said.add(code);
      err(line, code, `${msg} (${where})`);
    };

    // increase / decrease @x by …: a number
    for (const m of text.matchAll(new RegExp(`\\b(increase|decrease)\\s+${REF}\\b`, "g"))) {
      const x = at(m[2]);
      if (x.k === "type" && !numeric(x.t)) say("TYPE", `\`${m[1]} @${m[2]}\`: @${m[2]} is ${show(x.t)}, not a number`);
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
    // @a's @b: a field of a's record; a reference is looked up first
    for (const m of text.matchAll(new RegExp(`${REF}['’]s\\s+(?=${REF})`, "g"))) { // overlapping: @c's @ticket's @title
      const a = at(m[1]);
      if (a.k !== "type") continue;
      const b = m[2].split(".")[0];
      if (strip(a.t).k === "Ref") {
        const target = (strip(a.t) as { name: string }).name;
        say("TYPE", `\`@${m[1]}'s @${b}\`: @${m[1]} holds a ${target}'s key, not a ${target}; look it up: \`the ${target[0].toLowerCase() + target.slice(1)} whose @${keyOf(target) ?? "id"} is @${m[1]}\` (and say what happens when there is none)`);
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
    for (const m of text.matchAll(new RegExp(`\\bthe\\s+${REF}\\s+of\\s+(?:(?:the|that|this|each|every)\\s+([a-z]\\w*)\\b|${REF})`, "g"))) {
      const b = m[1];
      if (m[3]) {
        const a = at(m[3]);
        if (a.k === "type" && strip(a.t).k === "Ref") {
          const target = (strip(a.t) as { name: string }).name;
          say("TYPE", `\`the @${b} of @${m[3]}\`: @${m[3]} holds a ${target}'s key, not a ${target}; look it up: \`the @${b} of the ${target[0].toLowerCase() + target.slice(1)} whose @${keyOf(target) ?? "id"} is @${m[3]}\``);
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
    // add @y to (the end / the start of) @xs: an item of the list
    for (const m of text.matchAll(new RegExp(`\\badd\\s+${REF}\\s+(?:to|at)\\s+(?:the\\s+(?:end|start)\\s+of\\s+)?${REF}${END}`, "g"))) {
      const [y, xs] = [at(m[1]), at(m[2])];
      const item = xs.k === "type" ? listItem(xs.t) : undefined;
      if (item && y.k === "type" && !fits(item, y.t)) say("TYPE", `\`add @${m[1]} to @${m[2]}\`: @${m[2]} holds ${show(item)}, @${m[1]} is ${show(y.t)}`);
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
        if (m[1]) target = typeOfValue(fitOf(m[1], scope, row));
        else {
          const rec = m[4] ? recordNamed(m[4]) : (row ?? it);
          target = rec ? records.get(rec)?.fields.find((f) => f.name === (m![2] ?? m![3]))?.type : (fieldTypes.get(m[2] ?? m[3]) ?? undefined);
        }
        const v = value(m[5]);
        if (!target) return false;
        const msg = fitsValue(target, v);
        if (msg) say("TYPE", `\`set ${m[1] ? `@${m[1]}` : m[2] ? `its @${m[2]}` : `the @${m[3]} of that ${m[4]}`} to ${m[5].trim()}\`: the value is ${msg}`);
        return msg !== undefined;
      }
      if ((m = x.match(/^(increase|decrease)\s+(?:the\s+|its\s+)?@([a-z][\w.]*)(?:\s+of\s+(?:that|this|the)\s+[a-z]\w*)?(?:\s+by\s+(.+))?$/))) {
        const t = typeOfValue(fitOf(m[2], scope, row));
        if (!m[3]) return !!t;
        const v = value(m[3]);
        if (v?.k === "error") say("TYPE", `\`${m[1]} @${m[2]} by ${m[3].trim()}\`: ${v.msg}`);
        else if (typeOfValue(v) && !numeric(typeOfValue(v)!)) say("TYPE", `\`${m[1]} @${m[2]} by ${m[3].trim()}\`: the amount is ${show(typeOfValue(v)!)}, not a number`);
        return !!t && !!v;
      }
      if ((m = x.match(/^clear\s+(.+)$/))) return m[1].split(/\s*(?:,|\band\b)\s*/).filter(Boolean).every((r) => /^@[a-z][\w.]*$/.test(r) && fitOf(r.slice(1), scope, row).k === "type");
      // add a @Ticket (to …) with …  /  add <value> to (the end of) @xs
      if ((m = x.match(/^add\s+(?:an?|the new)\s+@([A-Z]\w*)\s+(?:to|at)\s+(?:the\s+(?:end|start)\s+of\s+)?@([a-z]\w*)(?:\s+with\s+(.+))?$/))) {
        const rec = records.get(m[1]);
        if (!rec) return false;
        return !m[3] || pairs(m[3], (f) => rec.fields.find((y) => y.name === f)?.type, `a @${rec.name}`, () => false);
      }
      if ((m = x.match(/^add\s+(?:an?|the new)\s+@([A-Z]\w*)\s+with\s+(.+?)\s+(?:to|at)\s+(?:the\s+(?:end|start)\s+of\s+)?@([a-z]\w*)$/))) {
        const rec = records.get(m[1]);
        return !!rec && pairs(m[2], (f) => rec.fields.find((y) => y.name === f)?.type, `a @${rec.name}`, () => false);
      }
      if ((m = x.match(/^add\s+(?!(?:an?|the new)\s+@[A-Z])(.+?)\s+(?:to|at)\s+(?:the\s+(?:end|start)\s+of\s+)?@([a-z]\w*)$/))) {
        const item = listItem(typeOfValue(fitOf(m[2], scope, row)));
        const v = value(m[1]);
        const msg = item ? fitsValue(item, v) : undefined;
        if (msg) say("TYPE", `\`add ${m[1].trim()} to @${m[2]}\`: @${m[2]} holds ${show(item!)}; the value is ${msg}`);
        return msg !== undefined;
      }
      if ((m = x.match(/^remove\s+(?:that\s+[a-z]\w*|@[a-z]\w*|its\s+[a-z]\w*|the\s+[a-z]\w*\s+whose\s+.+|every\s+[a-z]\w*\s+whose\s+.+|the\s+@[a-z]\w*\s+whose\s+.+)\s+from\s+@([a-z]\w*)$/))) return !!listItem(typeOfValue(fitOf(m[1], scope, row)));
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
    /** Several steps in one sentence: `…; …` and `…, and set …`. */
    const steps = (t: string): string[] => {
      const out: string[] = [];
      let rest = t;
      for (;;) {
        let cutAt: { at: number; op: string } | undefined;
        for (let probe = rest; ; ) {
          const h = topLevel(probe, ["; ", ", and ", " and "]);
          if (!h) break;
          const after = probe.slice(h.at + h.op.length).trimStart();
          if (h.op === "; " || /^(set|clear|add|call|increase|decrease|remove|publish|go|undo|answer|stop)\b/.test(after)) cutAt = h;
          probe = probe.slice(0, h.at);
        }
        if (!cutAt) break;
        out.push(rest.slice(0, cutAt.at));
        rest = rest.slice(cutAt.at + cutAt.op.length);
      }
      return [...out, rest];
    };
    // Conditions whose two sides are single references are reported by the checks above; the typer
    // reports what they cannot see (expressions, emptiness, containment).
    const simple = (c: string) => new RegExp(`^${REF}\\s+is\\s+(?:not\\s+)?(?:${NUM_CMP}\\s+)?(?:${REF}|-?\\d+(?:\\.\\d+)?)$`).test(c.trim());
    if (kind === "step") cover(text, line, where, steps(text).map(typeOne).every(Boolean));
    else if (kind === "cond" || kind === "always") {
      const msg = typeCond(text, scope, row);
      if (msg && !simple(text)) say("TYPE", `\`${text.trim()}\`: ${msg}`);
      cover(text, line, where, msg !== undefined);
    } else if (kind === "value") {
      // An element's value: a template (its holes typed), or a value.
      const template = /^"/.test(text.trim());
      const holes = template ? [...text.matchAll(/\{([^{}]*)\}/g)].map((h) => h[1]) : [text];
      inText = template;
      cover(text, line, where, holes.every((h) => !/@/.test(h) || typedValue(h)));
      inText = false;
    }
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
    return out;
  };
  const uses = (raw: string, rows: string[], line: number, where: string, answerOrEvent: boolean) => {
    if (line >= LINE_BASE) return;
    const text = raw.replace(/"(?:[^"\\]|\\.)*"/g, '""'); // what a string says is not a reference
    const say = (what: string, rec: string) =>
      err(line, "NO_ROW", `\`${what}\` (${where}): no ${rec[0].toLowerCase() + rec.slice(1)} is chosen or found before this step; find it first (\`the ${rec[0].toLowerCase() + rec.slice(1)} whose @${keyOf(rec) ?? "id"} is …\`), or say which one`);
    for (const m of text.matchAll(/\b(that|this|the\s+new)\s+([a-z]\w*)\b/g)) {
      const rec = recordNamed(m[2]);
      if (rec && !rows.includes(rec)) say(`${m[1]} ${m[2]}`, rec);
    }
    // `its @f`: the row this step is about (in an answer's or event's handler, `its` is the answer or event)
    if (!answerOrEvent && !rows.length)
      for (const m of text.matchAll(/\bits\s+(@?[a-z]\w*)/g)) if (!/^(own|way|turn|place|order|full|new|next|previous)$/.test(m[1])) err(line, "NO_ROW", `\`its ${m[1]}\` (${where}): nothing before this step says whose; find the row first, or name it`);
  };

  // Bodies, with what is in scope: loop rows, endpoint params, the answer's or event's body types.
  const walk = (b: Stmt[] | undefined, steps: string[], lines: number[] | undefined, fallback: number, where: string, scope: Map<string, Type>, bodyTypes?: Type[], row?: string, rows: string[] = row ? [row] : [], answerOrEvent = false) => {
    const sentence = (text: string, line: number, kind: Kind) => {
      rows = introduces(text, rows);
      uses(text, rows, line, where, answerOrEvent);
      // "its @f" means the row introduced last, unless the sentence also speaks of something that is not a record ("that result").
      const other = [...text.replace(/"(?:[^"\\]|\\.)*"/g, "").matchAll(/\b(?:that|this)\s+([a-z]\w*)\b/g)].some((m) => !recordNamed(m[1]));
      it = other ? undefined : (row ?? rows[rows.length - 1]);
      check(text, line, where, scope, row, bodyTypes, kind);
      it = undefined;
    };
    if (!b) {
      steps.forEach((s, i) => sentence(s, lines?.[i] ?? fallback, "step"));
      return;
    }
    // Guards narrow: inside `if there is a @x { … }`, and after `if there is no @x { stop }`, @x is not nothing.
    const present = (cond: string | undefined, yes: boolean) => [...(cond ?? "").matchAll(yes ? /\bthere\s+is\s+(?:a|an)\s+@([a-z]\w*)\b|@([a-z]\w*)\s+is\s+(?:not\s+nothing|set)\b/g : /\bthere\s+is\s+no\s+@([a-z]\w*)\b|@([a-z]\w*)\s+is\s+nothing\b/g)].map((m) => m[1] ?? m[2]);
    const narrow = (sc: Map<string, Type>, names: string[]) => {
      const out = new Map(sc);
      for (const n of names) {
        const f = fitOf(n, sc, row);
        if (f.k === "type" && f.t.k === "Maybe") out.set(n, f.t.of);
      }
      return out;
    };
    for (const s of b) {
      if (s.k === "step" || s.k === "answer") sentence(s.text, s.line, "step");
      else if (s.k === "if") {
        // A lookup in a condition introduces its row for the branch and for what follows.
        s.branches.forEach((br) => (br.cond && sentence(br.cond, br.line, "cond"), walk(br.body, [], undefined, br.line, where, narrow(scope, present(br.cond, true)), bodyTypes, row, [...rows], answerOrEvent)));
        const [only] = s.branches;
        const last = only.body[only.body.length - 1];
        if (s.branches.length === 1 && last && (last.k === "stop" || last.k === "answer")) scope = narrow(scope, present(only.cond, false));
      }
      else if (s.k === "for") {
        const f = fitOf(s.list.replace(/^@/, ""), scope, row);
        const inner = new Map(scope);
        const item = f.k === "type" ? listItem(f.t) : undefined;
        if (item) inner.set(s.name, item);
        else inner.delete(s.name);
        const loopRows = item && recordOf(item) ? [...rows, recordOf(item)!] : rows;
        if (s.where) check(s.where, s.line, where, inner, row, bodyTypes, "cond");
        walk(s.body, [], undefined, s.line, where, inner, bodyTypes, row, loopRows, answerOrEvent);
      }
    }
  };
  // The row a handler's button sits in: `that ticket` is its record, and bare fields read from it.
  const rowOf = new Map<string, string>();
  const elements = (els: Element[], row?: string) => {
    for (const el of els) {
      if (row && el.kind === "button") rowOf.set(el.name, row);
      const inner = el.kind === "list" && el.of && records.has(el.of) ? el.of : row;
      if (el.expr) check(el.expr, el.line, `${el.kind} ${el.name}`, new Map(), inner, undefined, "value");
      for (const text of [el.visibleWhen, el.enabledWhen]) if (text) check(text, el.line, `${el.kind} ${el.name}`, new Map(), inner, undefined, "cond");
      for (const text of [el.expr, el.visibleWhen, el.enabledWhen]) if (text) uses(text, introduces(text, inner ? [inner] : []), el.line, `${el.kind} ${el.name}`, false);
      elements(el.children, el.kind === "list" ? inner : row);
    }
  };
  elements(app.screen);
  for (const d of app.derive) {
    uses(d.sentence, introduces(d.sentence, []), d.line, `derive ${d.name}`, false);
    check(d.sentence, d.line, `derive ${d.name}`, new Map(), undefined, undefined, "derive");
    cover(d.sentence, d.line, `derive ${d.name}`, !!derivedTypes.get(d.name));
  }
  for (const a of app.invariants ?? []) check(a.text, a.line, "always", new Map(), undefined, undefined, "always");
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
    const clicked = h.verb === "click" ? rowOf.get(h.target) : undefined;
    walk(h.body, h.steps, h.stepLines, h.line, where, scope, bodyTypes, clicked, clicked ? [clicked] : [], h.verb === "answer" || h.verb === "event");
  }
  for (const ep of app.endpoints ?? []) walk(ep.body, ep.steps, ep.stepLines, ep.line, `endpoint ${ep.name}`, new Map(ep.params.map((p) => [p.name, p.type])));
  for (const j of app.jobs ?? []) walk(j.body, j.steps, j.stepLines, j.line, `every ${j.name.slice(5)}`, new Map());

  // Derived values used where their type matters, with none known: a quality rule's to report (UNTYPED).
  app.facts = { ...app.facts, untypedDerived: [...untyped].filter(([n]) => (app.derive.find((d) => d.name === n)?.line ?? LINE_BASE) < LINE_BASE).map(([name, where]) => ({ name, where })) };

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
      const keys = seeded.get(t.name) ?? new Set<string>();
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
