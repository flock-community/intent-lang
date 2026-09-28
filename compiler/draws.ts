// Random values (v69, docs/design/v1-random.md): the five draw forms, where they are in a spec (their
// sites), what each draws from (its space), and the checks on them. A value is drawn from a type that
// lists its values (a choice, an `Int from a to b`, a code `Text of 6 digits`); the harness draws it
// (runtime/ts/draw.ts, runtime/elm/Draw.elm), never a build. Each site is a typed function in the
// generated interface (`draws.deposit1(taken)`), keyed by its place so twin builds see the same values.
import type { App, Diagnostic, Literal, Type } from "./ast.ts";
import { LINE_BASE } from "./ast.ts";
import { codeBits, codeSize } from "./alphabets.ts";
import type { Space } from "../runtime/ts/draw.ts";
export type { Space };

type Err = (l: number, c: string, m: string, col?: number) => void;

export type DrawForm = "one" | "notAmong" | "many" | "pick" | "shuffle";

/** A draw phrase in a sentence, as found (before typing). */
export interface DrawPhrase {
  at: number; // offset in the sentence
  form: DrawForm;
  phrase: string;
  type?: string; // one, notAmong, many: the type drawn
  list?: string; // notAmong: what is taken; pick, shuffle: the list
  count?: string; // many: how many
}

/** What the checker worked out about a draw phrase (app.facts.draws): where it is and the types around it. */
export interface DrawFact extends DrawPhrase {
  line: number;
  where: string; // the unit: `on click roll`, `endpoint deposit`, `derive freeCode`, `every 15m`, `button x`, `always`
  listType?: Type;
  countType?: Type;
  loops: number; // how many `for each` it is inside
  inAnswer?: boolean; // in an `answer …` step
}

/** A draw site: one function of the generated `Draws`. */
export interface DrawSite {
  id: string; // `deposit1`: the function's name
  unit: string; // `endpoint deposit`
  n: number; // its place in the unit (`endpoint deposit#1`)
  line: number;
  form: DrawForm;
  phrase: string;
  type?: string;
  space?: Space;
  bits?: number;
  item?: Type; // pick, shuffle: the list's item type
  row: boolean; // inside a `for each`: takes the row
  maybe: boolean; // may give nothing (a small `not among`, a pick)
  inAnswer?: boolean;
}

// A list a draw reads: a reference chain (`@xs`, `@order's @lines`, `its @items`, `that task's @items`).
const CHAIN = "(?:its\\s+|(?:that|this|the)\\s+[a-z]\\w*['’]s\\s+|the\\s+)?@[a-z][\\w.]*(?:['’]s\\s+@[a-z]\\w*)*";
// What `not among` excludes: a list of the type, or `the @code of @waiting` (a field of every row).
const TAKEN = `(?:the\\s+@[a-z]\\w*\\s+of\\s+)?${CHAIN}`;
const FORMS = new RegExp(
  [
    `\\ba\\s+random\\s+one\\s+of\\s+(${CHAIN})`, // pick
    `\\ba\\s+random\\s+@([A-Z]\\w*)(?:\\s+not\\s+among\\s+(${TAKEN}))?`, // one, notAmong
    `(?<![\\w@.])(\\d+(?:\\.\\d+)?|@[a-z][\\w.]*)\\s+random\\s+@([A-Z]\\w*)`, // many
    // `@deck shuffled` ends its phrase: "shuffled the way a card player would" is English.
    `(${CHAIN})\\s*,?\\s+shuffled(?=\\s*\\.?\\s*$|\\s*[,;)]|\\s+(?:and|or|when|otherwise|then|to|into|as|for)\\b)`, // shuffle
  ].join("|"),
  "g",
);

/** The draw phrases in a sentence (what is inside quotes is text, not a draw). */
export function findDraws(text: string): DrawPhrase[] {
  // Text in quotes is masked, except a template's holes (`"{a random @Die}"` draws).
  const masked = text.replace(/"(?:[^"\\]|\\.)*"/g, (x) => x.replace(/\{[^{}]*\}|[^{}]/g, (y) => (y.length > 1 ? ` ${y.slice(1, -1)} ` : y === '"' ? '"' : " ")));
  const out: DrawPhrase[] = [];
  for (const m of masked.matchAll(FORMS)) {
    const phrase = text.slice(m.index!, m.index! + m[0].length);
    if (m[1]) out.push({ at: m.index!, form: "pick", phrase, list: m[1] });
    else if (m[2]) out.push({ at: m.index!, form: m[3] ? "notAmong" : "one", phrase, type: m[2], ...(m[3] ? { list: m[3] } : {}) });
    else if (m[5]) out.push({ at: m.index!, form: "many", phrase, count: m[4], type: m[5] });
    else if (m[6]) out.push({ at: m.index!, form: "shuffle", phrase, list: m[6] });
  }
  return out;
}

/**
 * A word that draws outside the five forms (\`a random number from 1 to 6\`, \`shuffled the deck\`):
 * read as plain English it would be left to the compiler's judgement, so it is an error that names the
 * forms. Text in quotes is text. The word, or undefined.
 */
export function strayDraw(text: string): string | undefined {
  const masked = text.replace(/"(?:[^"\\]|\\.)*"/g, (x) => x.replace(/\{[^{}]*\}|[^{}]/g, (y) => (y.length > 1 ? ` ${y.slice(1, -1)} ` : y === '"' ? '"' : " ")));
  let rest = masked;
  for (const d of findDraws(text)) rest = rest.slice(0, d.at) + " ".repeat(d.phrase.length) + rest.slice(d.at + d.phrase.length);
  return rest.match(/\b(?:random(?:ly)?|shuffled?|shuffles|at\s+random)\b/i)?.[0];
}

/** The draw forms, for messages. */
export const DRAW_FORMS = "`a random @T`, `a random @T not among @xs`, `3 random @T`, `a random one of @xs`, `@xs shuffled`";

/** Does a sentence draw? (A quick test, before any typing.) */
export const drawsIn = (text: string) => findDraws(text).length > 0;

/** The values a type has, when it lists them: a choice, an `Int from a to b` (at most 2^32 values), a code. */
export function drawSpace(app: App, name: string): Space | undefined {
  const r = app.refined?.find((x) => x.name === name);
  if (r?.code) return { k: "text", n: r.code.n, chars: r.code.chars };
  if (r && r.base === "Int" && r.min !== undefined && r.max !== undefined && Number.isInteger(r.min) && Number.isInteger(r.max) && r.max >= r.min && r.max - r.min + 1 <= 2 ** 32) return { k: "int", lo: r.min, hi: r.max };
  const c = app.choices.find((x) => x.name === name);
  if (c) return { k: "names", values: c.values };
  return undefined;
}

/** How many values a space has. */
export const spaceSize = (sp: Space): number => (sp.k === "int" ? sp.hi - sp.lo + 1 : sp.k === "names" ? sp.values.length : [...sp.chars].length ** sp.n);

/** Its entropy in bits. */
export const spaceBits = (sp: Space): number => (sp.k === "text" ? codeBits(sp.n, sp.chars) : Math.log2(spaceSize(sp)));

/** Why a type cannot be drawn, and the form that works. */
function notDrawable(app: App, name: string): string {
  const r = app.refined?.find((x) => x.name === name);
  const works = "a choice, an `Int from 1 to 6` (both bounds), or a code: `type PickupCode = Text of 6 digits`";
  if (r?.pattern !== undefined) return `${name} is a Text matching a pattern, which does not list its values: draw from ${works}`;
  if (r?.base === "Text") return `${name} is a Text of a length, which does not say which characters: draw from ${works}`;
  if (r?.base === "Decimal") return `${name} is a Decimal: a random decimal is not in the language yet; draw a whole number (\`Int from 0 to 100\`) or a choice`;
  if (r?.base === "Int" && (r.min === undefined || r.max === undefined)) return `${name} is an Int with ${r.min === undefined ? "no lower" : "no upper"} bound, so it has no finite space: give both (\`Int from 1 to 6\`)`;
  if (r?.base === "Int") return `${name} has more than 2^32 values; a draw from it is not in the language yet: draw a code (\`Text of 12 digits\`)`;
  if (app.records.some((x) => x.name === name)) return `${name} is a record: draw its fields, or pick one row with \`a random one of @xs\``;
  return `${name} does not list its values: draw from ${works}`;
}

const cap = (s: string) => s[0].toUpperCase() + s.slice(1);
const camel = (s: string) => s.replace(/[.\s-]+(\w)/g, (_, c: string) => c.toUpperCase()).replace(/\W/g, "");

/** The kind of unit a sentence is in (`on click roll` → handler), and whether draws may be there. */
function unitOf(where: string): { kind: "handler" | "endpoint" | "job" | "derive" | "other"; base: string; verb?: string } {
  let m: RegExpMatchArray | null;
  if ((m = where.match(/^on\s+(\w+)(?:\s+(.+))?$/))) return { kind: "handler", verb: m[1], base: camel(m[2] ?? m[1]) };
  if ((m = where.match(/^endpoint\s+(\w+)$/))) return { kind: "endpoint", base: m[1] };
  if ((m = where.match(/^every\s+(.+)$/))) return { kind: "job", base: `every${m[1].replace(/\s+/g, "")}` };
  if ((m = where.match(/^derive\s+(\w+)$/))) return { kind: "derive", base: m[1] };
  return { kind: "other", base: camel(where) };
}

const listItemOf = (t?: Type): Type | undefined => {
  const inner = t && (t.k === "Maybe" ? t.of : t);
  return inner?.k === "List" ? inner.of : undefined;
};

/** Every draw site in the app, in unit order, with its function name (`<unit><n>`). Needs checkFit's facts. */
export function drawSites(app: App): DrawSite[] {
  const facts = [...(app.facts?.draws ?? [])].sort((a, b) => a.line - b.line || a.at - b.at);
  // Units whose base names clash (`derive deposit`, `endpoint deposit`) are named with their kind.
  const units = [...new Set(facts.map((f) => f.where))];
  const bases = new Map<string, string[]>();
  for (const u of units) bases.set(unitOf(u).base, [...(bases.get(unitOf(u).base) ?? []), u]);
  const nameOf = (u: string) => {
    const x = unitOf(u);
    return (bases.get(x.base)?.length ?? 0) > 1 ? `${x.verb ?? x.kind}${cap(x.base)}` : x.base;
  };
  const count = new Map<string, number>();
  const out: DrawSite[] = [];
  for (const f of facts) {
    const n = (count.get(f.where) ?? 0) + 1;
    count.set(f.where, n);
    const space = f.type ? drawSpace(app, f.type) : undefined;
    const bits = space ? spaceBits(space) : undefined;
    out.push({
      id: `${nameOf(f.where)}${n}`,
      unit: f.where,
      n,
      line: f.line,
      form: f.form,
      phrase: f.phrase,
      ...(f.type ? { type: f.type } : {}),
      ...(space ? { space, bits } : {}),
      ...(f.form === "pick" || f.form === "shuffle" ? { item: listItemOf(f.listType) } : {}),
      row: f.loops > 0,
      maybe: f.form === "pick" || (f.form === "notAmong" && (bits ?? 0) < 64),
      ...(f.inAnswer ? { inAnswer: true } : {}),
    });
  }
  return out;
}

/** Does the app draw anything? Then every event gets draws (and the build its draw runtime). */
export const usesDraws = (app: App): boolean => drawSites(app).some((s) => unitOf(s.unit).kind !== "other");

/** The draw sites for the generated interface: those in handlers, endpoints, recurring work and an api's derived values. */
export const buildSites = (app: App): DrawSite[] => drawSites(app).filter((s) => ["handler", "endpoint", "job", "derive"].includes(unitOf(s.unit).kind));

/** A number of values in words, to three figures: 1,180. */
const count = (x: number) => {
  const p = 10 ** Math.max(0, Math.floor(Math.log10(Math.max(1, x))) - 2);
  return (Math.round(x / p) * p).toLocaleString("en-US");
};
const an = (w: string) => (/^[AEIOU]/.test(w) ? `an ${w}` : `a ${w}`);

/**
 * The checks on draws: RANDOM (a form that cannot draw), COLLISION (a key filled from a draw that may
 * repeat), where draws may be, and the `steer random …` steps of the examples (TYPE, STEP).
 */
export function checkDraws(app: App, err: Err) {
  const facts = app.facts?.draws ?? [];
  const sites = drawSites(app);
  const screen = app.profile !== "api";
  for (const f of facts) {
    if (f.line >= LINE_BASE) continue;
    const say = (code: string, msg: string) => err(f.line, code, `\`${f.phrase}\`: ${msg} (${f.where})`);
    const u = unitOf(f.where);
    if (f.where === "rules") continue; // guidance in words
    if (u.kind === "other") {
      say("RANDOM", f.where === "always" ? "a rule in `always` is checked on the data, and draws nothing: the harness checks it after every step" : "the screen shows the state: a value drawn each time it is shown would change on every look; draw it in a handler and keep it in state (`set @x to a random @T`)");
      continue;
    }
    if (u.kind === "derive" && screen) {
      say("RANDOM", "a screen's derived value is computed each time the screen is shown, so a draw in it would change on every look; draw it in a handler and keep it in state (`set @x to a random @T`)");
      continue;
    }
    if (u.kind === "handler" && u.verb === "start") {
      say("RANDOM", "the app starts the same way every time; draw on an event (a click, an answer, a tick)");
      continue;
    }
    if (f.loops > 1) say("NOT_YET", "a draw inside a loop inside a loop is not in the language yet: draw in the outer loop, or keep the values in a list first");
    if (f.type) {
      const declared = !!(app.refined?.some((x) => x.name === f.type) || app.choices.some((x) => x.name === f.type) || app.records.some((x) => x.name === f.type));
      if (!declared) continue; // UNKNOWN_NAME: the reference is checked with the others
      if (!drawSpace(app, f.type)) {
        say("RANDOM", notDrawable(app, f.type));
        continue;
      }
    }
    if (f.form === "notAmong" && f.listType) {
      const item = listItemOf(f.listType);
      const t = item && (item.k === "Maybe" ? item.of : item);
      const same = t && ((t.k === "Named" && t.name === f.type) || (t.k === "Ref" && sameBase(app, t, f.type!)) || sameBase(app, t, f.type!));
      if (!item) say("RANDOM", `\`not among\` excludes a list of ${f.type}s, and ${f.list} is ${showT(f.listType)}`);
      else if (!same) say("RANDOM", `\`not among\` excludes ${f.type}s, and ${f.list} holds ${showT(item)}`);
    }
    if (f.form === "pick" || f.form === "shuffle") {
      const what = f.form === "pick" ? "`a random one of`" : "`shuffled`";
      if (!f.listType) say("RANDOM", `${what} needs a list whose type the checker knows, and it cannot tell what ${f.list} holds: name a state list, or declare the derived value's type (\`xs: List Card = …\`)`);
      else if (!listItemOf(f.listType)) say("RANDOM", `${what} is for a list, and ${f.list} is ${showT(f.listType)}`);
    }
    if (f.form === "many") {
      const c = f.count!;
      if (/^\d+\.\d+$/.test(c)) say("RANDOM", `\`${c} random\`: how many is a whole number`);
      else if (f.countType && !["Int"].includes(baseKind(app, f.countType))) say("RANDOM", `\`${c} random\`: how many is a whole number, and ${c} is ${showT(f.countType)}`);
    }
  }

  // COLLISION: a record's key filled from a draw that may repeat (without `not among`, under 2^128 values).
  for (const s of sites) {
    if (s.line >= LINE_BASE || s.form !== "one" || !s.space || (s.bits ?? 0) >= 128) continue;
    const text = sentenceAt(app, s.line);
    if (!text) continue;
    const esc = s.phrase.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const m = text.match(new RegExp(`@([a-z]\\w*)\\s*(?:=|\\bis\\b)\\s*${esc}`)) ?? text.match(new RegExp(`\\bset\\s+(?:its\\s+|the\\s+)?@([a-z]\\w*)(?:\\s+of\\s+[^,]+?)?\\s+to\\s+${esc}`));
    if (!m) continue;
    const added = text.match(/\badd\s+(?:an?|the new)\s+@([A-Z]\w*)/)?.[1];
    const recs = app.records.filter((r) => (added ? r.name === added : true) && (r.key ?? (r.fields.some((f) => f.name === "id") ? "id" : undefined)) === m[1]);
    if (!recs.length) continue;
    const size = spaceSize(s.space);
    err(s.line, "COLLISION", `\`@${m[1]} = ${s.phrase}\`: ${m[1]} is ${recs[0].name}'s key, and ${s.type} has ${codeSizeOf(s.space)}: a repeat is likely (50 %) after about ${count(1.1774 * Math.sqrt(size))} ${s.type}s. Say \`${s.phrase} not among the @${m[1]} of @${homeName(app, recs[0].name)}\` (and what happens when none is left), or use a type of 128 bits or more (${s.unit})`);
  }

  // The examples' steering: a type that is drawn somewhere, values of that type.
  const drawnTypes = new Set(sites.filter((s) => s.type).map((s) => s.type!));
  for (const ex of app.examples) {
    if (ex.line >= LINE_BASE) continue;
    for (const st of ex.steps) {
      if (st.do !== "random") continue;
      if (st.what === "shuffle" || st.what === "pick") {
        if (!sites.some((s) => s.form === st.what)) err(st.line, "STEP", `\`steer random ${st.what} …\`: nothing in the spec ${st.what === "shuffle" ? "is shuffled (`@xs shuffled`)" : "picks one (`a random one of @xs`)"}, so there is nothing to steer`);
        continue;
      }
      const space = drawSpace(app, st.what);
      const declared = !!(app.refined?.some((x) => x.name === st.what) || app.choices.some((x) => x.name === st.what));
      if (!declared) err(st.line, "UNKNOWN_NAME", `\`steer random ${st.what}\`: no type \`${st.what}\``);
      else if (!drawnTypes.has(st.what)) err(st.line, "STEP", `\`steer random ${st.what}\`: no sentence draws ${an(st.what)} (\`a random @${st.what}\`), so nothing takes these values`);
      if (!space) continue;
      for (const v of st.values ?? []) if (!fitsSpace(v, space)) err(st.line, "TYPE", `\`steer random ${st.what}\`: ${litText(v)} is not a ${st.what} (${spaceWords(space)})`);
    }
  }
  // `random` names what examples steer: an api may not be called that.
  for (const c of app.uses ?? []) if (c.alias === "random" && c.line < LINE_BASE) err(c.line, "RESERVED", "`random` is what `steer random …` steers: give the api another name (`as …`)");
}

/** A steered value fits the space: a number in the range, a value of the choice, a code of the alphabet. */
function fitsSpace(v: Literal, sp: Space): boolean {
  if (sp.k === "int") return v.k === "number" && Number.isInteger(v.v) && v.v >= sp.lo && v.v <= sp.hi;
  if (sp.k === "names") return v.k === "value" && sp.values.includes(v.v);
  return v.k === "text" && [...v.v].length === sp.n && [...v.v].every((c) => sp.chars.includes(c));
}

const litText = (v: Literal) => (v.k === "text" ? JSON.stringify(v.v) : v.k === "number" ? v.raw : v.k === "value" ? v.v : String((v as { v?: unknown }).v));

const spaceWords = (sp: Space) => (sp.k === "int" ? `a whole number from ${sp.lo} to ${sp.hi}` : sp.k === "names" ? `one of ${sp.values.join(", ")}` : `${sp.n} characters from ${JSON.stringify(sp.chars)}`);

const codeSizeOf = (sp: Space) => (sp.k === "text" ? codeSize(sp.n, sp.chars) : `${count(spaceSize(sp))} values`);

const showT = (t: Type): string => (t.k === "List" ? `a List ${showT(t.of)}` : t.k === "Maybe" ? `${showT(t.of)} or nothing` : t.k === "Named" || t.k === "Ref" ? t.name : t.k);

function baseKind(app: App, t: Type): string {
  const inner = t.k === "Maybe" ? t.of : t;
  if (inner.k === "Named") return app.refined?.find((r) => r.name === inner.name)?.base ?? inner.name;
  return inner.k;
}

/** A list item of the type drawn, or of its base (a list of Text for a code, of Int for a range). */
function sameBase(app: App, t: Type, drawn: string): boolean {
  const r = app.refined?.find((x) => x.name === drawn);
  if (t.k === "Named" && t.name === drawn) return true;
  if (t.k === "Ref") return false;
  return !!r && baseKind(app, t) === r.base;
}

/** The home list of a record (for the message): the one state list of it. */
function homeName(app: App, rec: string): string {
  const lists = app.state.filter((f) => f.type.k === "List" && f.type.of.k === "Named" && f.type.of.name === rec).map((f) => f.name);
  return lists[0] ?? `${rec[0].toLowerCase()}${rec.slice(1)}s`;
}

/** The sentence at a line (a step, a derived value). */
function sentenceAt(app: App, line: number): string | undefined {
  const bodies = [...app.handlers.map((h) => ({ steps: h.steps, lines: h.stepLines })), ...(app.endpoints ?? []).map((e) => ({ steps: e.steps, lines: e.stepLines })), ...(app.jobs ?? []).map((j) => ({ steps: j.steps, lines: j.stepLines }))];
  for (const b of bodies) {
    const i = b.lines?.indexOf(line) ?? -1;
    if (i >= 0) return b.steps[i];
  }
  return app.derive.find((d) => d.line === line)?.sentence;
}

/** For the source map: each draw site, where it is, and what it draws. */
export function drawMap(app: App): Record<string, { unit: string; line: number; form: DrawForm; type?: string; values?: string; bits?: number }> {
  return Object.fromEntries(
    buildSites(app).map((s) => [s.id, { unit: `${s.unit}#${s.n}`, line: s.line, form: s.form, ...(s.type ? { type: s.type } : {}), ...(s.space ? { values: codeSizeOf(s.space), bits: Math.round(s.bits! * 10) / 10 } : {}) }]),
  );
}

export type { Diagnostic };

/**
 * TypeScript source in two views: without comments (strings kept, for what is imported), and code
 * only (comments and the text of strings and templates blanked, a template's \`\${…}\` kept). A scanner,
 * not a regular expression, so a \`//\` or \`/*\` inside a string is text, and a quote inside a comment
 * is not a string.
 */
export function tsViews(code: string): { noComments: string; codeOnly: string } {
  let nc = "";
  let co = "";
  const depth: number[] = []; // template literals open around the current \`\${…}\` (their brace depth)
  let braces = 0;
  let i = 0;
  const put = (c: string, inCode: boolean) => ((nc += c), (co += inCode || c === "\n" ? c : " "));
  while (i < code.length) {
    const c = code[i];
    const two = code.slice(i, i + 2);
    if (two === "//") {
      while (i < code.length && code[i] !== "\n") (nc += " "), (co += " "), i++;
      continue;
    }
    if (two === "/*") {
      const end = code.indexOf("*/", i + 2);
      const stop = end < 0 ? code.length : end + 2;
      for (; i < stop; i++) (nc += code[i] === "\n" ? "\n" : " "), (co += code[i] === "\n" ? "\n" : " ");
      continue;
    }
    if (c === '"' || c === "'") {
      put(c, true);
      i++;
      while (i < code.length && code[i] !== c && code[i] !== "\n") {
        if (code[i] === "\\") put(code[i++] ?? "", false);
        put(code[i++] ?? "", false);
      }
      if (i < code.length) put(code[i++], true);
      continue;
    }
    if (c === "`" || (c === "}" && depth.length && depth[depth.length - 1] === braces)) {
      // A template's text, up to its end or its next \`\${\`.
      if (c === "}") depth.pop();
      put(c, true);
      i++;
      while (i < code.length && code[i] !== "`" && code.slice(i, i + 2) !== "${") {
        if (code[i] === "\\") put(code[i++] ?? "", false);
        put(code[i++] ?? "", false);
      }
      if (code.slice(i, i + 2) === "${") {
        put("$", true), put("{", true);
        i += 2;
        depth.push(braces);
      } else if (i < code.length) put(code[i++], true);
      continue;
    }
    if (c === "{") braces++;
    if (c === "}") braces--;
    put(c, true);
    i++;
  }
  return { noComments: nc, codeOnly: co };
}

/** What an app module may import: the generated interface and the harness's reviewed helpers, nothing that can make randomness. */
const TS_IMPORTS = new Set(["./spec.ts", "./fmt.ts", "./api.ts"]);
const ELM_IMPORTS = new Set(["Spec", "Fmt", "Array", "Basics", "Bitwise", "Char", "Dict", "List", "Maybe", "Result", "Set", "String", "Tuple", "Json.Decode", "Json.Encode", "Regex"]);

/**
 * A build that makes its own randomness is rejected before its examples run: draws come from the
 * harness (secure in production, steerable in tests). The module the LLM wrote may import only the
 * generated interface and the harness's helpers (\`./spec.ts\`, \`./fmt.ts\`, \`./api.ts\`; Elm: \`Spec\`,
 * \`Fmt\` and elm/core's pure modules), and uses no source of randomness or time in any spelling it
 * can be caught in: \`Math\` other than \`Math.<function>\`, \`crypto\`, \`performance\`, \`Date.now\`,
 * \`new Date()\`, a dynamic \`import\`, \`require\`, \`eval\`, \`Function\`, or a global read by a
 * computed name. Comments and the text of strings do not count. In tests \`Math.random\` and
 * \`crypto\` also throw (runtime/ts/norandom.ts): what a static reading misses still fails. The reason, or undefined.
 */
export function ownRandomness(code: string, target: "elm" | "ts"): string | undefined {
  if (target === "elm") {
    // Elm's comments nest: strip the innermost first.
    let src = code;
    for (let prev = ""; prev !== src; ) (prev = src), (src = src.replace(/\{-(?:(?!\{-|-\})[\s\S])*-\}/g, " "));
    src = src.replace(/--.*$/gm, "");
    for (const m of src.matchAll(/^\s*import\s+([A-Z][\w.]*)/gm)) if (!ELM_IMPORTS.has(m[1])) return `\`import ${m[1]}\` (an app module imports Spec, Fmt and elm/core's pure modules)`;
    return undefined;
  }
  const { noComments, codeOnly } = tsViews(code);
  for (const m of noComments.matchAll(/(?:^|[;\s])(?:import|export)\b[^;"'`]*?\bfrom\s*["']([^"']+)["']|(?:^|[;\s])import\s*["']([^"']+)["']/g)) {
    const from = m[1] ?? m[2];
    if (!TS_IMPORTS.has(from)) return `\`import … from "${from}"\` (an app module imports ${[...TS_IMPORTS].join(", ")})`;
  }
  const bans: [RegExp, string][] = [
    [/\bMath\b(?!\s*\.\s*(?!random\b)[A-Za-z_]\w*)/, "`Math.random` (or `Math` used other than `Math.<function>`)"],
    [/\bcrypto\b/, "`crypto`"],
    [/\bperformance\b/, "`performance`"],
    [/\bDate\s*\.\s*now\b/, "`Date.now`"],
    [/\bnew\s+Date\s*\(\s*\)/, "`new Date()`"],
    [/\bimport\s*\(/, "a dynamic `import(…)`"],
    [/\brequire\s*\(/, "`require(…)`"],
    [/\beval\b|\bFunction\s*\(/, "`eval` or `Function(…)`"],
    [/\b(?:globalThis|self|window|global)\s*(?:\?\.)?\s*\[/, "a global read by a computed name (`globalThis[…]`)"],
  ];
  for (const [re, what] of bans) if (re.test(codeOnly)) return what;
  return undefined;
}
