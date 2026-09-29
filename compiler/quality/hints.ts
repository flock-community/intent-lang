// The hints std.quality gives (compiler/quality/std.ts): each judges the spec as the compiler
// resolved it — its model and the facts it recorded (app.facts) — and warns where it is not yet
// precise or complete. Moved out of the checker: the compiler decides what a spec means, these
// rules what makes it good, and a project sets their levels (intent.project's `quality` block).
import { LINE_BASE, type App, type Element, type Stmt } from "../ast.ts";
import { bareWords, CLOCK_NAMES, declaredNames, refsIn, sentences, usedByAlias } from "../refs.ts";
import { parseString } from "../parse.ts";
import { parseChange } from "../changes.ts";
import { drawSites } from "../draws.ts";
import { refusalsOf } from "../access.ts";

/** A hint: the line, the rule's code, and what to do. */
export type Warn = (line: number, code: string, message: string) => void;

/** How a rule about before and after a step is said. */
export const CHANGE_FORMS = "; it is about before and after a step, so say it as a change rule (`a @R's @f never changes`, `an @R whose @status was @Done never changes`, `@x never goes down`, `… only changes from @A to @B`, `an @R is never removed`)";

/** A rule that reads like an invariant is only guidance in `rules`; in `always` it is checked. */
export function unchecked(app: App, warn: Warn) {
  app.rules.forEach((r, i) => {
    // A definition ("a @Release meets an item when it is at least …") is not a claim about the data.
    const claim = r.match(/\b(never|always|at most|at least|no two|cannot|can't|must not|may not)\b/i) ?? r.match(CHANGE_CLAIM);
    const defines = claim && /\b(when|if|means|counts as|is called)\b/i.test(r.slice(0, claim.index));
    if (claim && !defines && (app.ruleLines?.[i] ?? 0) < LINE_BASE)
      warn(app.ruleLines?.[i] ?? 1, "UNCHECKED", `this rule reads like something that must always hold, but \`rules\` is only guidance: move it to \`always { - … }\` so every session checks it${CHANGE_CLAIM.test(r) ? CHANGE_FORMS : ""}`);
  });
}

/** In one handler, a call that cannot be undone (a point of no return) comes after the calls that can. */
export function pivot(app: App, warn: Warn) {
  for (const h of app.handlers) {
    if (h.line >= LINE_BASE || !app.clients?.length) continue;
    let first: { name: string; line: number } | undefined;
    for (const [i, st] of h.steps.entries())
      for (const m of st.matchAll(/\bcall\s+@?([a-z]\w*)\.([a-z]\w*)/gi)) {
        const target = app.clients.find((c) => c.alias === m[1])?.contract.endpoints?.find((e) => e.name === m[2]);
        if (!target?.effect) continue;
        const line = h.stepLines?.[i] ?? h.line;
        if (!target.undoneBy) first ??= { name: `${m[1]}.${m[2]}`, line };
        else if (first) warn(line, "PIVOT", `\`${m[1]}.${m[2]}\` can be undone, but it comes after \`${first.name}\` (line ${first.line}), which cannot: put the step that cannot be undone last, after everything that can still fail`);
      }
  }
}

/** A lookup says `whose` (`the ticket whose @id is @ticket`); `where` belongs to `for each … where`. */
export function spelling(app: App, warn: Warn) {
  const lists = new Set([...app.state.filter((f) => f.type.k === "List").map((f) => f.name), ...app.derive.map((d) => d.name), ...(app.params ?? []).filter((p) => p.type.k === "List").map((p) => p.name)]);
  const singular = new Set(app.records.map((r) => r.name[0].toLowerCase() + r.name.slice(1)));
  for (const s of sentences(app)) {
    if (s.line >= LINE_BASE) continue;
    for (const m of s.text.matchAll(/\bthe\s+(@?)([a-z]\w*)\s+where\b/g))
      if (m[1] || singular.has(m[2]) || lists.has(m[2])) warn(s.line, "SPELLING", `a lookup is written \`the ${m[1]}${m[2]} whose …\`, not \`where\` (\`intent fix\` rewrites it)`);
  }
  // `@newToken` (one fresh secret per request) is a draw now: `a random @Token` (std.text's `Text of 32 hex digits`).
  for (const ep of app.endpoints ?? []) {
    if (ep.line >= LINE_BASE) continue;
    const lines = ep.steps.map((t, i) => ({ t, line: ep.stepLines?.[i] ?? ep.line })).filter((x) => /@newToken\b/.test(x.t));
    const uses = lines.reduce((n, x) => n + (x.t.match(/@newToken\b/g) ?? []).length, 0);
    for (const x of lines)
      warn(x.line, "SPELLING", uses === 1 ? "`@newToken` is written `a random @Token` (`import std.text` gives `type Token = Text of 32 hex digits`; `intent fix` rewrites it)" : `\`@newToken\` is written \`a random @Token\` (\`import std.text\`), one value per draw: endpoint ${ep.name} uses it ${uses} times, so draw it once where it is stored (\`add … with @secret = a random @Token\`) and refer to that row after (\`… = the new api key's @secret\`)`);
  }
  // Reading a reference's own row is following it: `its @ticket's @subject`, `@x exists`.
  for (const n of app.facts?.navSpelling ?? [])
    if (n.line < LINE_BASE) warn(n.line, "SPELLING", `\`${n.from}\` looks up the row a reference points at: follow the reference instead, \`${n.to}\` (\`intent fix\` rewrites it)`);
}

/** Control words are structure (`if … { } else { }`, `answer`, `stop`), not prose. */
export function unstructured(app: App, warn: Warn) {
  const walk = (b: Stmt[]) =>
    b.forEach((s) => {
      if (s.k === "step" && s.line < LINE_BASE && (/^(if|when)\s/i.test(s.text) || /^otherwise\b/i.test(s.text) || /\band stop\b/.test(s.text)))
        warn(s.line, "UNSTRUCTURED", `write control words as structure: \`if <condition> { … } else { … }\`, \`answer …\` and \`stop\` instead of "${s.text.slice(0, 40)}${s.text.length > 40 ? "…" : ""}"`);
      if (s.k === "if") s.branches.forEach((br) => walk(br.body));
      if (s.k === "for") walk(s.body);
    });
  for (const h of app.handlers) if (h.body) walk(h.body);
  for (const j of app.jobs ?? []) if (j.body) walk(j.body);
  for (const b of [app.before, app.after, app.beforeCall]) if (b?.body) walk(b.body);
  for (const ep of app.endpoints ?? []) if (ep.body) walk(ep.body);
}

/** A declared name in a sentence is written with `@` (it may also be the English word: then reword). */
export function unmarked(app: App, warn: Warn) {
  const names = declaredNames(app);
  const found = new Map<number, Set<string>>();
  // The hint is only for data (element names such as "empty" or "add" are mostly English), and a
  // word that names a record in lower case ("that ticket") is the row's item.
  const elements = new Set<string>();
  const walk = (els: App["screen"]) => els.forEach((el) => (elements.add(el.name), walk(el.children)));
  walk(app.screen);
  const data = new Set([...app.state.map((f) => f.name), ...app.derive.map((d) => d.name)]);
  // Time words ("3 days", "@days days after") and the clock's own words are English more often than names.
  const TIME_WORDS = ["second", "seconds", "minute", "minutes", "hour", "hours", "day", "days", "week", "weeks", "month", "months", "year", "years"];
  const hinted = new Set([...names].filter((n) => (!elements.has(n) || data.has(n)) && n !== "error" && !CLOCK_NAMES.includes(n) && !TIME_WORDS.includes(n)));
  const rowItems = new Set(app.records.map((r) => r.name[0].toLowerCase() + r.name.slice(1)));
  for (const s of sentences(app)) {
    if (s.line >= LINE_BASE) continue; // from a bundle or contract: checked there
    // "its body" / "its status" of an answer or event are the language's, not a field.
    let text = /^on (answer|event)/.test(s.where) ? s.text.replace(/\bits status is (unknown|held|rejected)\b/g, " ").replace(/\bits (body|status)\b/g, " ") : s.text;
    text = text.replace(/^\([\w.]+\) /, ""); // a rule from a component instance: checked in its bundle
    text = text.replace(/^(call|publish)\b/, " "); // the language's own step words, even when an endpoint or event has that name
    text = text.replace(/\b(?:the\s+)?(?:number|sum)\s+of\b/g, " "); // the language's typed forms, even when a field has that name
    text = text.replace(/\b(?:read\s+as|reads\s+as|is(?:\s+not)?)\s+(?:an?\s+)?(?:whole\s+number|number|decimal)\b|\bwhole\s+number\b/g, " "); // `read as a whole number`, `is a whole number from 1 to 6`: the language's words
    text = text.replace(/\bthe\s+first\s+(?=\d|@)/g, " "); // `the first 5 of @deck shuffled`
    for (const w of bareWords(text)) if (hinted.has(w) && !rowItems.has(w)) (found.get(s.line) ?? found.set(s.line, new Set()).get(s.line)!).add(w);
  }
  for (const [line, ws] of found) warn(line, "UNMARKED", `${[...ws].map((w) => `"${w}"`).join(", ")} ${ws.size > 1 ? "are declared names" : "is a declared name"}: in a sentence, write ${[...ws].map((w) => `\`@${w}\``).join(", ")} when you mean ${ws.size > 1 ? "them" : "it"}`);
}

/** Every element with its list (a row's element), across sections. */
function elementsWithList(app: App): { el: Element; list?: Element; outer?: Element }[] {
  const out: { el: Element; list?: Element; outer?: Element }[] = [];
  // `outer`: for a row inside a row, the list around the element's list.
  const walk = (els: Element[], list?: Element, outer?: Element) => {
    for (const el of els) {
      out.push({ el, list, outer });
      walk(el.children, el.kind === "list" ? el : list, el.kind === "list" ? list : outer);
    }
  };
  walk(app.screen);
  return out;
}

/**
 * Inside a list, an element named like a field of the row and like an app-level name is ambiguous to
 * a reader; inside a row of a list inside a row, so is one named like a field of both rows' records
 * (it shows the inner row's).
 */
export function shadowed(app: App, warn: Warn) {
  const records = new Map(app.records.map((r) => [r.name, r]));
  const appNames = new Set([...app.state.map((f) => f.name), ...app.derive.map((d) => d.name)]);
  const has = (l: Element | undefined, name: string) => !!l && !!records.get(l.of!)?.fields.some((f) => f.name === name);
  for (const { el, list, outer } of elementsWithList(app)) {
    if (!list || el.kind === "heading" || el.line >= LINE_BASE || !has(list, el.name)) continue;
    if (appNames.has(el.name)) warn(el.line, "SHADOWED", `\`${el.name}\` is a field of ${list.of} and also an app-level name; inside the row it means the row's field. Rename the app-level one to avoid mix-ups`);
    else if (has(outer, el.name)) warn(el.line, "SHADOWED", `\`${el.name}\` is a field of ${list.of} and of ${outer!.of} around it; inside the inner row it shows the ${list.of}'s. Rename one of the fields, or write \`text ${el.name} = …\` to say which`);
  }
}

/** Declared components are used; a manifest (`uses … only …`) asks for no more than the app uses. */
export function unused(app: App, warn: Warn) {
  const usedComponents = new Set(app.facts?.usedComponents ?? []);
  if (app.facts?.usedComponents) for (const c of app.components) if (!usedComponents.has(c.name) && c.line < LINE_BASE) warn(c.line, "UNUSED", `component \`${c.name}\` is never used (\`… as ${c.name}\`)`);
  const used = usedByAlias(app);
  for (const c of app.clients ?? []) {
    if (!c.only || (c.line ?? 0) >= LINE_BASE) continue;
    const names = new Set([...(c.contract.endpoints ?? []).map((e) => e.name), ...(c.contract.events ?? []).map((e) => e.name)]);
    const uses = [...used[c.alias].endpoints, ...used[c.alias].events];
    for (const n of c.only) if (names.has(n) && !uses.includes(n)) warn(c.line ?? 1, "UNUSED", `\`only\` lists \`${n}\`, which the app never uses: leave it out, so the app asks for no more than it needs`);
  }
}

/** A button, a call's answer, an undo's answer and a clock are handled. */
export function noHandler(app: App, warn: Warn) {
  const handled = new Set(app.handlers.map((h) => `${h.verb} ${h.target}`));
  if (app.clockMs && !app.handlers.some((h) => h.verb === "tick")) warn(app.facts?.clockLine ?? 1, "NO_HANDLER", "the app has a clock but no `on tick`");
  for (const h of app.handlers)
    for (const [i, st] of h.steps.entries()) {
      const line = h.stepLines?.[i] ?? h.line;
      if (line >= LINE_BASE) continue;
      for (const m of st.matchAll(/\bcall\s+@?([a-z]\w*)\.([a-z]\w*)/gi))
        if (app.clients?.find((c) => c.alias === m[1])?.contract.endpoints?.some((e) => e.name === m[2]) && !handled.has(`answer ${m[1]}.${m[2]}`))
          warn(line, "NO_HANDLER", `\`${m[1]}.${m[2]}\` is called, but its answer is ignored: add \`on answer ${m[1]}.${m[2]}\``);
      for (const m of st.matchAll(/\bundo\s+@?([a-z]\w*)\.([a-z]\w*)/gi)) {
        const by = app.clients?.find((c) => c.alias === m[1])?.contract.endpoints?.find((e) => e.name === m[2])?.undoneBy?.endpoint;
        if (by && !handled.has(`answer ${m[1]}.${by}`)) warn(line, "NO_HANDLER", `undoing \`${m[1]}.${m[2]}\` calls \`${m[1]}.${by}\`, but its answer is ignored: add \`on answer ${m[1]}.${by}\``);
      }
    }
  for (const { el } of elementsWithList(app)) if (el.kind === "button" && el.line < LINE_BASE && !handled.has(`click ${el.name}`)) warn(el.line, "NO_HANDLER", `button \`${el.name}\` has no \`on click ${el.name}\``);
}

/** The spec has examples: they are what proves its behaviour. */
export function noExamples(app: App, warn: Warn) {
  if (app.kind === "bundle" || app.kind === "platform" || app.examples.length) return;
  const what = app.kind === "layer" ? "the layer" : app.profile === "api" ? "the api" : "the app";
  warn(1, "NO_EXAMPLES", `${what} has no examples; nothing proves its behaviour`);
}

/** Every dynamic element is checked by some `see` step; every endpoint is called in some example. */
export function unproven(app: App, warn: Warn) {
  if (app.kind === "contract") return; // a contract is proven by its implementation's examples
  if (app.profile === "api") {
    for (const ep of app.endpoints ?? [])
      if (ep.line < LINE_BASE && !app.examples.some((ex) => ex.steps.some((s) => s.do === "call" && s.endpoint === ep.name))) warn(ep.line, "UNPROVEN", `endpoint \`${ep.name}\` is never called in an example`);
    return;
  }
  if (!app.facts?.proven) return;
  const seen = new Set(app.facts.proven);
  for (const { el, list } of elementsWithList(app)) {
    // Fields and selects just mirror their state (built-in binding), so they need no proof of their own.
    const dynamic = el.kind === "text" || el.kind === "checkbox" || el.kind === "list" || el.kind === "progress" || (el.kind === "button" && (el.enabledWhen || el.expr));
    if (!dynamic) continue;
    if (el.line >= LINE_BASE) continue; // from a bundle: its demo app proves it
    if (el.kind === "text" && el.expr && parseString(el.expr) !== undefined && !el.expr.includes("{")) continue; // a constant
    const key = list ? `${list.name}.${el.name}` : el.name;
    if (!seen.has(key)) warn(el.line, "UNPROVEN", `\`${el.kind} ${el.name}\` is never checked by a \`see\` step`);
  }
}

/** A handler step or a rule mentions some declared name (else it is prose the compiler cannot anchor). */
export function unanchored(app: App, warn: Warn) {
  if (app.profile === "api" || app.kind === "layer" || app.kind === "contract") return;
  const names = new Set<string>([
    ...app.state.map((f) => f.name), ...app.derive.map((d) => d.name), ...elementsWithList(app).map((a) => a.el.name),
    ...app.records.map((r) => r.name), ...app.choices.map((c) => c.name), ...app.choices.flatMap((c) => c.values),
    ...app.records.flatMap((r) => r.fields.map((f) => f.name)),
    ...(app.clients ?? []).flatMap((c) => [c.alias, ...(c.contract.endpoints ?? []).map((e) => e.name)]),
    ...(app.screens ?? []).flatMap((sc) => [sc.name, ...sc.params.map((p) => p.name)]),
  ]);
  const anchored = (s: string) => (s.match(/[A-Za-z][A-Za-z0-9]*/g) ?? []).some((w) => names.has(w));
  for (const h of app.handlers) h.steps.forEach((s, i) => (h.stepLines?.[i] ?? h.line) < LINE_BASE && !anchored(s) && !/nothing|initial state/i.test(s) && !/^(if|answer)\s/.test(s) && s !== "go back" && warn(h.stepLines?.[i] ?? h.line, "UNANCHORED", `"${s}" mentions no declared name`));
  app.rules.forEach((r, i) => (app.ruleLines?.[i] ?? 1) < LINE_BASE && !anchored(r) && warn(app.ruleLines?.[i] ?? 1, "UNANCHORED", `rule "${r}" mentions no declared name`));
}

/** A refinement's changes are not what the base's examples and `always` checks prove. */
export function overridesProof(app: App, warn: Warn) {
  const overridden = new Set(app.facts?.overridden ?? []);
  if (!overridden.size) return;
  // Only the base's proofs (they come from the base's file); the spec's own examples are about its changes.
  for (const ex of app.examples.filter((e) => e.line >= LINE_BASE)) {
    const touched = [...new Set(ex.steps.flatMap((s) => ("target" in s ? [s.target] : [])).filter((t) => overridden.has(t)))];
    if (touched.length) warn(ex.line, "OVERRIDES_PROOF", `base example "${ex.name}" checks ${touched.map((t) => `\`${t}\``).join(", ")}, which this spec changes: it must still pass, or \`drop example "${ex.name}"\``);
  }
  for (const a of app.always) if (a.line >= LINE_BASE && "target" in a && overridden.has(a.target)) warn(a.line, "OVERRIDES_PROOF", `a base \`always\` check is about \`${a.target}\`, which this spec changes: it must still hold`);
}

/** A derived value used where its type matters has a known or declared type. */
export function untyped(app: App, warn: Warn) {
  for (const { name, where } of app.facts?.untypedDerived ?? []) {
    const d = app.derive.find((x) => x.name === name);
    if (d && d.line < LINE_BASE) warn(d.line, "UNTYPED", `\`${name}\` is used where its type matters (${where}), but the checker cannot tell its type: declare it (\`${name}: <Type> = …\`) so the sentences that use it are checked`);
  }
}

// ---------------------------------------------------------------- change rules (v67)

/** The words people use for a change rule, and the language's: `intent fix` rewrites them. */
const CHANGE_SPELLINGS: [RegExp, string][] = [
  [/\b(?:only goes up|can only (?:go up|increase)|only increases)\b/, "never goes down"],
  [/\b(?:only goes down|can only (?:go down|decrease)|only decreases)\b/, "never goes up"],
  [/\b(?:stays the same|is immutable|can never change|never gets changed)\b/, "never changes"],
  [/\b(?:is never deleted|can never be deleted|is never dropped)\b/, "is never removed"],
  [/\bused to be\b/, "was"],
];

/** A change rule written with other words than the language's (`only goes up` for `never goes down`). */
export function changeSpelling(app: App, warn: Warn) {
  for (const inv of app.invariants ?? []) {
    if (inv.line >= LINE_BASE) continue;
    for (const [re, to] of CHANGE_SPELLINGS) {
      const m = inv.text.replace(/"(?:[^"\\]|\\.)*"/g, (s) => " ".repeat(s.length)).match(re);
      if (m) warn(inv.line, "SPELLING", `\`${m[0]}\` is written \`${to}\` in a change rule (\`intent fix\` rewrites it)`);
    }
    // `the previous @x` / `the old @x` / `@x previously`: the value before the step is `@x before`.
    for (const m of inv.text.matchAll(/\bthe\s+(?:previous|old)\s+(@[a-z][\w.]*)|(@[a-z][\w.]*)\s+previously\b/g)) warn(inv.line, "SPELLING", `\`${m[0]}\` is written \`${m[1] ?? m[2]} before\` in a change rule (\`intent fix\` rewrites it)`);
  }
}

/** Words that say a rule is about before and after a step: a change rule's job. */
export const CHANGE_CLAIM = /\b(never changes?|no longer change|stays? (?:the same|as (?:it is|they are))|only (?:goes|go) (?:up|down)|only changes? from|(?:is|are) never (?:deleted|removed)|can only (?:increase|decrease))\b/i;

const lowerFirst = (s: string) => s[0].toLowerCase() + s.slice(1);

/** The record a row word names (`that expense` → Expense), or undefined. */
function recordWord(app: App, word: string): string | undefined {
  return app.records.find((r) => lowerFirst(r.name) === word || lowerFirst(r.name) + "s" === word)?.name;
}

/** The record of the list a button sits in (`that expense`, `its @f` in its click handler). */
function rowRecords(app: App): Map<string, string> {
  const out = new Map<string, string>();
  const walk = (els: Element[], row?: string) => {
    for (const el of els) {
      const inner = el.kind === "list" && el.of && app.records.some((r) => r.name === el.of) ? el.of : row;
      if (row && (el.kind === "button" || el.kind === "field" || el.kind === "checkbox" || el.kind === "select")) out.set(el.name, row);
      walk(el.children, inner);
    }
  };
  walk(app.screen);
  return out;
}

type Bodied = { where: string; row?: string; body: Stmt[] };
function bodies(app: App): Bodied[] {
  const rows = rowRecords(app);
  const flat = (steps: string[], lines: number[] | undefined, line: number): Stmt[] => steps.map((t, i) => ({ k: "step", text: t, line: lines?.[i] ?? line }));
  return [
    ...app.handlers.map((h) => ({ where: `on ${h.verb}${h.target ? " " + h.target : ""}`, row: rows.get(h.target), body: h.body ?? flat(h.steps, h.stepLines, h.line) })),
    ...(app.endpoints ?? []).map((e) => ({ where: `endpoint ${e.name}`, body: e.body ?? flat(e.steps, e.stepLines, e.line) })),
    ...(app.jobs ?? []).map((j) => ({ where: `every ${j.name.slice(5)}`, body: j.body ?? flat(j.steps, j.stepLines, j.line) })),
  ];
}

/** Every step of a body, with the conditions around it and the exits before it (`if … { stop }`). */
function stepsWithGuards(body: Stmt[], guards: string[] = [], out: { text: string; line: number; guards: string[] }[] = []) {
  const before = [...guards];
  for (const s of body) {
    if (s.k === "step" || s.k === "answer") out.push({ text: s.text, line: s.line, guards: [...before] });
    else if (s.k === "if") {
      let rest: string[] = [];
      for (const br of s.branches) {
        stepsWithGuards(br.body, [...before, ...rest, ...(br.cond ? [br.cond] : [])], out);
        if (br.cond) rest = [...rest, br.cond];
      }
      const last = (b: Stmt[]) => b[b.length - 1];
      if (s.branches.some((br) => br.cond && ["stop", "answer"].includes(last(br.body)?.k ?? ""))) before.push(...s.branches.flatMap((br) => (br.cond ? [br.cond] : [])));
    } else if (s.k === "for") stepsWithGuards(s.body, [...before, ...(s.where ? [s.where] : [])], out);
  }
  return out;
}

/** What a step writes of a record's rows: the field it sets (or "" for a removal), and the record. */
function rowWrite(app: App, text: string, row?: string): { record: string; field: string } | undefined {
  let m: RegExpMatchArray | null;
  if ((m = text.match(/^set\s+(?:the\s+@([a-z]\w*)\s+of\s+(?:that|this|the)\s+([a-z]\w*)|(?:that|this|the)\s+([a-z]\w*)['’]s\s+@([a-z]\w*))\s+to\b/))) {
    const record = recordWord(app, m[2] ?? m[3]);
    return record ? { record, field: m[1] ?? m[4] } : undefined;
  }
  if ((m = text.match(/^set\s+its\s+@([a-z]\w*)\s+to\b/)) && row) return { record: row, field: m[1] };
  if ((m = text.match(/^remove\s+(?:that|this|the|its)\s+([a-z]\w*)\b/))) {
    const record = recordWord(app, m[1]);
    return record ? { record, field: "" } : undefined;
  }
  if ((m = text.match(/^remove\s+.*?\bfrom\s+@([a-z][\w.]*)/))) {
    const t = app.state.find((f) => f.name === m![1])?.type;
    return t?.k === "List" && t.of.k === "Named" ? { record: t.of.name, field: "" } : undefined;
  }
}

/**
 * A handler step writes what a change rule freezes (or removes what it keeps), with no condition
 * before it that could exclude the frozen rows: the rule would be broken the first time it runs on
 * one. A hint, not a proof: the harness checks the rule on every event.
 */
export function breaksRule(app: App, warn: Warn) {
  const rules = (app.invariants ?? []).filter((i) => i.line < LINE_BASE).flatMap((i) => {
    const c = parseChange(i.text);
    return c && "named" in c && c.named ? [{ ...c.named, line: i.line, text: i.text }] : [];
  });
  if (!rules.length) return;
  for (const b of bodies(app))
    for (const st of stepsWithGuards(b.body)) {
      if (st.line >= LINE_BASE) continue;
      const w = rowWrite(app, st.text.trim(), b.row);
      for (const r of rules) {
        const s = r.subject;
        let hit = false;
        let guard: string | undefined;
        if (s.k === "state" && r.form === "order") hit = new RegExp(`^(?:${r.dir === "down" ? "decrease|reset|clear" : "increase"})\\s+(?:the\\s+)?@${s.name.replace(/\./g, "\\.")}\\b`).test(st.text.trim());
        else if (s.k === "state" && r.form === "frozen") hit = new RegExp(`^(?:set|increase|decrease|reset|clear)\\s+@${s.name.replace(/\./g, "\\.")}\\b`).test(st.text.trim());
        else if (w && s.k !== "state" && w.record === s.record) {
          if (s.k === "field" && r.form === "frozen") hit = w.field === s.field;
          else if (s.k === "rows" && r.form === "frozen") hit = true;
          else if (s.k === "rows" && r.form === "kept") hit = w.field === "";
          // A condition on the field the rule picks its rows by could exclude them.
          guard = s.k === "rows" ? s.cond?.match(/@([a-z]\w*)/)?.[1] : undefined;
          if (hit && s.k === "rows" && guard && st.guards.some((g) => new RegExp(`@${guard}\\b`).test(g))) hit = false;
        }
        if (hit)
          warn(st.line, "BREAKS_RULE", `\`${st.text.trim()}\` (${b.where}) ${w?.field === "" ? "removes" : "changes"} what \`${r.text}\` (line ${r.line}) ${r.form === "kept" ? "keeps" : "freezes"}${guard ? `, and no condition before it looks at @${guard}: ask first (\`if that ${lowerFirst((s as { record: string }).record)}'s @${guard} is … { stop }\`)` : ""}`);
      }
    }
}

/**
 * A pair of a transition table (`only changes from @A to @B`) that no example makes: like a status
 * no example sees (STATUS_UNPROVEN). An example makes A → B when a step of it runs a handler that
 * sets the field to B, after the field was A (from the start, or by an earlier step's handler).
 */
export function transitionUnproven(app: App, warn: Warn) {
  if (app.kind === "contract" || app.kind === "bundle") return;
  for (const inv of app.invariants ?? []) {
    if (inv.line >= LINE_BASE) continue;
    const c = parseChange(inv.text);
    if (!c || !("named" in c) || c.named?.form !== "transitions") continue;
    const s = c.named.subject;
    if (s.k === "rows") continue;
    const field = s.k === "field" ? s.field : s.name;
    const esc = field.replace(/\./g, "\\.");
    const setTo = new RegExp(`\\bset\\s+(?:the\\s+@${esc}\\s+of\\s+(?:that|this|the)\\s+[a-z]\\w*|(?:that|this|the)\\s+[a-z]\\w*['’]s\\s+@${esc}|its\\s+@${esc}|@${esc})\\s+to\\s+@?([A-Za-z]\\w*)\\b|@${esc}\\s*=\\s*@?([A-Za-z]\\w*)|@${esc}\\s+@([A-Z]\\w*)`, "g");
    // What each handler (by what triggers it) can make the field.
    const makes = new Map<string, Set<string>>();
    const flatten = (b: Stmt[]): string[] => b.flatMap((x) => (x.k === "step" || x.k === "answer" ? [x.text] : x.k === "if" ? x.branches.flatMap((br) => flatten(br.body)) : x.k === "for" ? flatten(x.body) : []));
    const add = (key: string, texts: string[]) => {
      for (const t of texts) for (const m of t.matchAll(setTo)) (makes.get(key) ?? makes.set(key, new Set()).get(key)!).add(m[1] ?? m[2] ?? m[3]);
    };
    for (const h of app.handlers) add(`${h.verb} ${h.target}`, h.body ? flatten(h.body) : h.steps);
    for (const e of app.endpoints ?? []) add(`call ${e.name}`, e.body ? flatten(e.body) : e.steps);
    // Where the field starts: its default, or a seeded row's value (a new row: the record's default).
    const start = new Set<string>();
    const recordDefault = s.k === "field" ? app.records.find((r) => r.name === s.record)?.fields.find((f) => f.name === s.field)?.default : undefined;
    if (recordDefault) start.add(String((recordDefault as { v?: unknown }).v ?? ""));
    for (const f of app.state) {
      if (s.k === "state" && f.name === s.name && f.default) start.add(String((f.default as { v?: unknown }).v ?? ""));
      if (s.k === "field" && f.default?.k === "table" && f.type.k === "List" && f.type.of.k === "Named" && f.type.of.name === s.record) {
        const col = f.default.columns.indexOf(s.field);
        if (col >= 0) for (const row of f.default.rows) start.add(String((row[col] as { v?: unknown } | undefined)?.v ?? ""));
      }
    }
    const trigger = (st: { do: string; target?: string; endpoint?: string }) => (st.do === "call" ? `call ${st.endpoint}` : st.do === "type" ? `type ${st.target}` : `${st.do} ${st.target}`);
    const made = new Set<string>();
    for (const ex of app.examples) {
      const seen = new Set(start);
      for (const st of ex.steps) {
        const vs = makes.get(trigger(st as { do: string; target?: string; endpoint?: string })) ?? new Set<string>();
        for (const b of vs) for (const a of seen) if (a !== b) made.add(`${a}→${b}`);
        for (const b of vs) seen.add(b);
      }
    }
    for (const [a, b] of c.named.pairs) if (b && !made.has(`${a}→${b}`) && made.add(`${a}→${b}`)) warn(inv.line, "TRANSITION_UNPROVEN", `no example makes \`${field}\` change from ${a} to ${b}`);
  }
}

// ---------------------------------------------------------------- draws (v69)

/** An endpoint that draws a type and draws it again in its answer: the answer is not the value it stored. */
export function redraw(app: App, warn: Warn) {
  const sites = drawSites(app);
  for (const s of sites) {
    if (s.line >= LINE_BASE || !s.inAnswer || !s.type || !/^endpoint\s/.test(s.unit)) continue;
    const before = sites.find((x) => x.unit === s.unit && x.type === s.type && !x.inAnswer && x.n < s.n);
    if (before) warn(s.line, "REDRAW", `\`${s.phrase}\` in the answer draws a new ${s.type}, not the one line ${before.line % LINE_BASE} drew: keep the first and refer to it (\`the new … 's @…\`); each draw is one value`);
  }
}

/** Which field names hold which drawn types (for a literal compared with one in an example). */
function drawnFields(app: App): Map<string, string> {
  const drawn = new Set(drawSites(app).filter((s) => s.type).map((s) => s.type!));
  const out = new Map<string, string>();
  const note = (name: string, t: { k: string; name?: string; of?: unknown }) => {
    const inner = (t.k === "Maybe" ? t.of : t) as { k: string; name?: string };
    if (inner.k === "Named" && drawn.has(inner.name!)) out.set(name, inner.name!);
  };
  for (const r of app.records) for (const f of r.fields) note(f.name, f.type);
  for (const f of app.state) note(f.name, f.type);
  return out;
}

/**
 * A new key made as \`the highest @id in @xs + 1\` while rows of @xs can be removed (held-out round 4,
 * G14): a removed row's key is handed out again, so an undo that puts the row back, a reference to it,
 * or a client that kept its key now finds another row. Keep a counter instead (\`stored nextId: Int\`).
 */
export function reusedKey(app: App, warn: Warn) {
  const texts = sentences(app);
  const refd = new Set(app.records.flatMap((r) => r.fields.map((f) => (f.type.k === "Maybe" ? f.type.of : f.type)).filter((t) => t.k === "Ref").map((t) => (t as { name: string }).name)));
  const kept = new Set(app.state.filter((f) => f.type.k === "Maybe" && f.type.of.k === "Named").map((f) => ((f.type as { of: { name: string } }).of).name));
  for (const s of texts) {
    if (s.line >= LINE_BASE) continue;
    for (const m of s.text.matchAll(/\badd\s+(?:an?)\s+@([A-Z]\w*)\s+to\s+(?:the\s+(?:end|start)\s+of\s+)?@([a-z]\w*)\b[^]*?@([a-z]\w*)\s*=\s*the\s+highest\s+@\3\s+in\s+@\2\s*\+\s*1/g)) {
      const [rec, list, key] = [m[1], m[2], m[3]];
      const removes = texts.some((t) => new RegExp(`\\bremove\\b[^]*@${list}\\b`).test(t.text));
      if (!removes) continue;
      const why = app.profile === "api" ? "a client that kept the old key now reaches the new row" : refd.has(rec) ? `a \`ref ${rec}\` that held the old key now points at the new row` : kept.has(rec) ? `a kept ${rec} (an undo that puts the row back) now clashes with the new row` : undefined;
      if (why) warn(s.line, "REUSED_KEY", `\`@${key} = the highest @${key} in @${list} + 1\` hands out a removed row's ${key} again: ${why}. Keep a counter (\`stored next${key[0].toUpperCase()}${key.slice(1)}: Int = …\` in \`state\`, \`@${key} = @next${key[0].toUpperCase()}${key.slice(1)}\`, then \`increase @next${key[0].toUpperCase()}${key.slice(1)} by 1\`)`);
    }
  }
}

/** An example compares a value of a drawn type with a literal, and nothing steered that type before: the value is the seed's. */
export function unsteered(app: App, warn: Warn) {
  const fields = drawnFields(app);
  if (!fields.size) return;
  // Values the spec seeds (held-out round 4, K6): a seeded row's code was never drawn.
  const seeded = new Map<string, Set<string>>();
  const seed = (name: string, v: string) => seeded.set(name, (seeded.get(name) ?? new Set()).add(v));
  for (const f of app.state) {
    const d = f.default;
    if (d?.k === "table") d.rows.forEach((row) => d.columns.forEach((c, i) => row[i] && (row[i].k === "text" || row[i].k === "number" || row[i].k === "value") && seed(c, String((row[i] as { v: unknown }).v))));
    else if (d && (d.k === "text" || d.k === "number" || d.k === "value")) seed(f.name, String(d.v));
  }
  for (const ex of app.examples) {
    if (ex.line >= LINE_BASE) continue;
    const steered = new Set<string>();
    let acted = false; // a value is drawn by an event: before the first, nothing was
    for (const st of ex.steps) {
      if (st.do === "random") steered.add(st.what);
      if (st.do !== "see" && st.do !== "snapshot" && st.do !== "random") acted = true;
      if (st.do !== "see" || st.check.is !== "eq") continue;
      const last = (st.every ? st.target : st.target.split(".").pop() ?? "").replace(/\[\d+\]$/, "");
      const t = fields.get(last);
      if (t && acted && !steered.has(t) && !seeded.get(last)?.has(st.check.value)) warn(st.line, "UNSTEERED", `\`${st.target} = ${JSON.stringify(st.check.value)}\` compares a ${t} with a value, but no \`steer random ${t} = …\` comes before it: the ${t} is drawn from this example's seed, and changes when the spec's draws change. Steer it (\`steer random ${t} = ${JSON.stringify(st.check.value)}\`), or carry it forward (\`{…body.${last}}\`)`);
    }
  }
}

/** A random type under 128 bits accepted as input: it can be guessed without an attempt limit. */
export function guessable(app: App, warn: Warn) {
  const drawn = new Map(drawSites(app).filter((s) => s.type && s.bits !== undefined).map((s) => [s.type!, s.bits!]));
  for (const ep of app.endpoints ?? []) {
    if (ep.line >= LINE_BASE) continue;
    for (const p of ep.params) {
      const t = p.type.k === "Maybe" ? p.type.of : p.type;
      const bits = t.k === "Named" ? drawn.get(t.name) : undefined;
      if (bits === undefined || bits >= 128) continue;
      // A param the contract declares (held-out round 4, K5): said at the implementation's endpoint.
      const line = p.line < LINE_BASE ? p.line : ep.line;
      warn(line, "GUESSABLE", `\`${p.in} ${p.name}: ${(t as { name: string }).name}\`${p.line < LINE_BASE ? "" : ` (in the contract of endpoint ${ep.name})`} takes a drawn ${(t as { name: string }).name} as input, and it has ${Number.isInteger(bits) ? bits : bits.toFixed(1)} bits: with no limit on attempts it can be guessed. Give it 128 bits or more (\`Text of 22 letters and digits\`), or limit the attempts (OWASP ASVS 11.5.1; NIST SP 800-63B-4 §3.2.2)`);
    }
  }
}

// ---------------------------------------------------------------- access (v70)

/** With an access block, an endpoint that answers 403 on a condition about the caller checks access by hand. */
export function handAccess(app: App, warn: Warn) {
  if (!app.access) return;
  const walk = (b: Stmt[], ep: string) =>
    b.forEach((s) => {
      if (s.k === "if")
        for (const br of s.branches) {
          const refuses = br.body.some((x) => (x.k === "answer" || x.k === "step") && /^(?:answer\s+)?40[13]\b/.test(x.text.replace(/^answer\s+/, "")) );
          if (br.cond && /@caller\b/.test(br.cond) && refuses && br.line < LINE_BASE)
            warn(br.line, "HAND_ACCESS", `endpoint ${ep} refuses by hand on a condition about the caller (\`if ${br.cond}\`): with an \`access\` block, say it there (\`- … may call @${ep} when …: "…"\`), where the harness enforces it before the endpoint runs and audits it`);
          walk(br.body, ep);
        }
      if (s.k === "for") walk(s.body, ep);
    });
  for (const ep of app.endpoints ?? []) if (ep.body) walk(ep.body, ep.name);
}

/** A screen-only app (or a job) that promises who may do what: without a service, nobody keeps the promise. */
const ROLE = "(?:manager|admin|administrator|lead|supervisor|approver|reviewer|owner|staff|employee|clerk|moderator|author|member)s?";
const PROMISE = new RegExp(`\\b(?:a|an|the|only)\\s+${ROLE}\\s+(?:approves?|rejects?|decides?|may|can|signs?\\s+off|cancels?)\\b|\\bonly\\s+(?:the\\s+|a\\s+|an\\s+)?(?:${ROLE}|assignee|submitter|creator)\\b|\\bcannot\\s+approve\\s+(?:their|his|her)\\s+own\\b|\\bfour[- ]eyes\\b|\\bwho\\s+may\\b|\\bstaff\\s+(?:can|may)\\b`, "i");
export function unenforced(app: App, warn: Warn) {
  if (app.kind && app.kind !== "app") return;
  if (app.profile === "api" || app.clients?.length) return;
  // A marked name reads as the word (\`only the @owner of an item may delete it\`, held-out round 4, K7).
  const said = [...app.purpose, ...app.rules].map((t) => t.replace(/@(?=[A-Za-z])/g, "")).find((t) => PROMISE.test(t));
  if (!said) return;
  const what = said.match(PROMISE)![0];
  warn(1, "UNENFORCED", `the spec says who may do what ("${what}"), but a screen enforces nothing: whoever controls the browser can do anything the screen can. Keep the promise on a service (an api with an \`access\` block) that this screen calls`);
}

// ---------------------------------------------------------------- one spelling per form (v73)

/** The text with its plain string parts blanked (template holes stay: they are sentences) and its comment cut. */
function codeOf(line: string): string {
  let out = "";
  let inString = false;
  let inHole = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (inString && !inHole) {
      if (ch === "\\") (out += "  "), i++;
      else if (ch === '"') (inString = false), (out += ch);
      else if (ch === "{") (inHole = true), (out += ch);
      else out += " ";
    } else if (inHole) {
      if (ch === "}") inHole = false;
      out += ch;
    } else if (ch === '"') (inString = true), (out += ch);
    else if (ch === "#") break;
    else out += ch;
  }
  return out;
}

const records = (app: App) => new Set(app.records.map((r) => r.name));
const article = (name: string) => (/^[aeiou]/i.test(name) ? "an" : "a");
/** A subject that is a name of its own (not a row's field: `whose @f`, `its @f`, `x's @f`). */
const OWN = String.raw`(?<!(?:['’]s|\bwhose|\bits|\bwith|\bof|\bwhere|\bthe|\bthat|\bthis|\bevery|\bno)\s)`;

/**
 * v73: one spelling for each form, so a spec reads one way. Asking about nothing is `there is a @x` /
 * `there is no @x` (`nothing` is a value: `set @x to nothing`, `from nothing to @A`); the fallback is
 * `…, or B when there is none`; a loop's rows are picked with `whose` and read with `'s`; an answer's
 * field is `its body's @f` and its message `the error`; a date moves with `14 days after @today`.
 * Each old form is a SPELLING hint that `intent fix` rewrites.
 */
export function languageSpelling(app: App, warn: Warn) {
  const own = app.sources?.[0]?.text.split("\n") ?? [];
  const says = (line: number, from: string, to: string, why: string) => warn(line, "SPELLING", `\`${from}\` is written \`${to}\`: ${why} (\`intent fix\` rewrites it)`);
  const optional = new Set([...app.state.filter((f) => f.type.k === "Maybe").map((f) => f.name), ...app.derive.filter((d) => d.type?.k === "Maybe").map((d) => d.name)]);
  const seen = new Set<string>();
  const once = (line: number, from: string) => !seen.has(`${line}|${from}`) && !!seen.add(`${line}|${from}`);
  for (const s of sentences(app)) {
    if (s.line >= LINE_BASE) continue;
    const t = codeOf(s.text);
    let m: RegExpMatchArray | null;
    // Asking whether a value is there.
    for (const m of t.matchAll(new RegExp(String.raw`${OWN}@([a-z][\w.]*)\s+is\s+not\s+nothing\b`, "g")))
      if (once(s.line, m[0])) says(s.line, m[0], `there is ${article(m[1])} @${m[1]}`, "a condition asks whether a value is there with `there is a @x` or `there is no @x`; `nothing` is a value");
    for (const m of t.matchAll(new RegExp(String.raw`${OWN}@([a-z][\w.]*)\s+is\s+nothing\b`, "g")))
      if (!/\bto\s*$/.test(t.slice(0, m.index)) && once(s.line, m[0])) says(s.line, m[0], `there is no @${m[1]}`, "a condition asks whether a value is there with `there is a @x` or `there is no @x`; `nothing` is a value");
    for (const m of t.matchAll(new RegExp(String.raw`${OWN}@([a-z][\w.]*)\s+is\s+(not\s+)?set\b`, "g")))
      if (optional.has(m[1]) && once(s.line, m[0])) says(s.line, m[0], m[2] ? `there is no @${m[1]}` : `there is ${article(m[1])} @${m[1]}`, "a condition asks whether a value is there with `there is a @x` or `there is no @x`");
    // The fallback: `…, or B when there is none`.
    for (const m of t.matchAll(/ \(([^()]+?) when there (?:is|are) (?:none|nothing|no @[a-z][\w.]*)\)/g)) {
      if (!once(s.line, m[0])) continue;
      if (m[1].trim() === "none") warn(s.line, "SPELLING", `\`${m[0]}\` is not needed: a list is empty when there is nothing to find, and comparing with nothing does not hold (\`intent fix\` removes it)`);
      else says(s.line, m[0], `, or ${m[1]} when there is none`, "a fallback is `…, or B when there is none`, after the value it is for");
    }
    for (const m of t.matchAll(/,\s+or\s+([^,;]+?)\s+when\s+(?:there\s+are\s+none|there\s+is\s+nothing|it\s+is\s+nothing|there\s+is\s+no\s+@[a-z][\w.]*)\b/g))
      if (once(s.line, m[0])) says(s.line, m[0], `, or ${m[1]} when there is none`, "a fallback is `…, or B when there is none`: it covers everything before it that may be nothing");
    // A date moves by days in words: `14 days after @today`.
    for (const m of t.matchAll(/(@?today)\s*([+-])\s*(\d+)\b/g))
      if (once(s.line, m[0])) says(s.line, m[0], `${m[3]} ${m[3] === "1" ? "day" : "days"} ${m[2] === "+" ? "after" : "before"} @today`, "a date moves by days in words (`14 days after @today`, `the day before @today`)");
    // An order is `sorted by`, one key at a time (held-out round 4, G3): `, earliest @start first, then
    // lowest @id first` is ` sorted by @start, earliest first, then by @id, lowest first`; `, @name from A
    // to Z` is ` sorted by @name, A to Z`. Only an order that ends the value is rewritten.
    {
      const KEY = String.raw`(?:(?:the\s+)?(lowest|highest|earliest|latest)\s+@([a-z]\w*)\s+first|@([a-z]\w*)\s+from\s+(A\s+to\s+Z|Z\s+to\s+A))`;
      const key = (dir: string | undefined, f1: string | undefined, f2: string | undefined, az: string | undefined) => `@${f1 ?? f2}, ${dir ? `${dir} first` : az}`;
      for (const m of t.matchAll(new RegExp(String.raw`,\s+${KEY}((?:,\s+then\s+${KEY})*)(?=\s*(?:$|;|\)|,\s+or\b|\s+when\b))`, "g"))) {
        if (!once(s.line, m[0])) continue;
        const rest = [...m[5].matchAll(new RegExp(String.raw`,\s+then\s+${KEY}`, "g"))].map((k) => `, then by ${key(k[1], k[2], k[3], k[4])}`).join("");
        says(s.line, m[0], ` sorted by ${key(m[1], m[2], m[3], m[4])}${rest}`, "an order is `sorted by`, one key at a time, each with its direction when it is not the usual one: `sorted by @due, earliest first, then by @id`");
      }
    }
    // An answer's message and fields: `the error`, `its body's @f`.
    if ((m = t.match(/\bthe error in its body\b/)) && once(s.line, m[0])) says(s.line, m[0], "the error", "an answer's message is `the error`");
    for (const m of t.matchAll(/\bthe\s+@([a-z]\w*)\s+(?:in|of)\s+its\s+body\b/g)) if (once(s.line, m[0])) says(s.line, m[0], `its body's @${m[1]}`, "a field of an answer or an event is `its body's @f`");
  }
  // The row an endpoint's request names: `path id: ref Ticket`, then `if that ticket does not exist { answer 404 "…" }`.
  for (const ep of app.endpoints ?? []) {
    if (ep.line >= LINE_BASE) continue;
    const refs = ep.params.filter((p) => (p.type.k === "Maybe" ? p.type.of : p.type).k === "Ref");
    const conds = (b: Stmt[] | undefined): { cond: string; line: number }[] => (b ?? []).flatMap((x) => (x.k === "if" ? x.branches.flatMap((br) => [...(br.cond ? [{ cond: br.cond, line: br.line }] : []), ...conds(br.body)]) : x.k === "for" ? conds(x.body) : []));
    for (const c of conds(ep.body)) {
      const m = c.cond.match(/^(no\s+([a-z]\w*)\s+has\s+(?:that\s+)?@(?:(?:path|query|body)\.)?([a-z]\w*)|there\s+is\s+no\s+([a-z]\w*)\s+whose\s+@\w+\s+is\s+(?:that\s+)?@([a-z]\w*))$/);
      if (!m) continue;
      const word = m[2] ?? m[4];
      const param = m[3] ?? m[5];
      const rec = word[0].toUpperCase() + word.slice(1);
      const p = ep.params.find((x) => x.name === param);
      const ref = p && refs.length === 1 && refs[0] === p && (p.type.k === "Maybe" ? p.type.of : p.type).k === "Ref" && ((p.type.k === "Maybe" ? p.type.of : p.type) as { name: string }).name === rec;
      if (ref) says(c.line, m[1], `that ${word} does not exist`, `the request names the ${word} (\`${p!.in} ${param}: ref ${rec}\`), so ask whether it is there, and "that ${word}" is it after`);
      else if (p && records(app).has(rec)) warn(c.line, "SPELLING", `\`${m[1]}\`: declare the param as a reference, \`${p.in} ${param}: ref ${rec}\` (in the contract, when there is one), then write \`if that ${word} does not exist { answer 404 "…" }\`: "that ${word}" is the row after it`);
    }
  }
  // An endpoint says what it answers with `answers <status> <Type>`, one line per status (`returns` is the older word).
  const src = app.sources?.[0]?.text.split("\n") ?? [];
  for (const ep of app.endpoints ?? []) {
    if (ep.line >= LINE_BASE || !ep.returns) continue;
    let at = -1;
    for (let i = ep.line; i < src.length && !/^\S/.test(src[i]); i++) if (/^\s+returns\s+/.test(src[i])) (at = i + 1);
    if (at < 0) continue;
    const type = src[at - 1].trim().replace(/^returns\s+/, "").replace(/\s*#.*$/, "");
    const statuses = new Map<number, string | undefined>();
    for (const [i, st] of ep.steps.entries()) {
      void i;
      for (const m of st.matchAll(/\banswer\s+([1-5]\d\d)\b(\s+with\b)?/g)) {
        const n = Number(m[1]);
        if (!statuses.has(n)) statuses.set(n, n >= 200 && n < 300 ? (m[2] ? type : undefined) : m[2] ? "?" : "Problem");
      }
    }
    for (const n of refusalsOf(app, ep.name)) if (!statuses.has(n)) statuses.set(n, "Problem");
    for (const a of ep.answers ?? []) statuses.delete(a.status);
    const lines = [...statuses].sort((a, b) => a[0] - b[0]).map(([n, t]) => `answers ${n}${t ? ` ${t}` : ""}`);
    const success = lines.find((l) => /^answers 2\d\d /.test(l));
    if (!success || lines.some((l) => l.endsWith(" ?"))) warn(at, "SPELLING", `\`returns ${type}\` is written \`answers <status> ${type}\`, one \`answers\` line for each status the endpoint answers (with a \`Problem\` for a refusal): say which status answers with ${type}`);
    else says(at, `returns ${type}`, success, `an endpoint lists what it answers, one line per status${lines.length > 1 ? `; the others it answers: ${lines.filter((l) => l !== success).map((l) => `\`${l}\``).join(", ")}` : ""}`);
  }
  // Loops: `for each @x in @xs whose @f …`, and the row's field is `@x's @f`.
  const loopsIn = (b: Stmt[] | undefined, rows: string[]) => {
    for (const s of b ?? []) {
      const texts = s.k === "step" || s.k === "answer" ? [s.text] : s.k === "if" ? s.branches.flatMap((br) => (br.cond ? [br.cond] : [])) : [];
      for (const text of texts)
        for (const r of rows)
          for (const m of codeOf(text).matchAll(new RegExp(String.raw`@${r}\.([a-z]\w*)\b`, "g")))
            if (s.k !== "if" || true) {
              const line = s.k === "if" ? s.branches.find((br) => br.cond === text)!.line : s.line;
              if (line < LINE_BASE && once(line, m[0])) says(line, m[0], `@${r}'s @${m[1]}`, "a loop's row is a record, and its field is read with `'s`");
            }
      if (s.k === "if") s.branches.forEach((br) => loopsIn(br.body, rows));
      if (s.k === "for") {
        if (s.where && s.line < LINE_BASE && !(s as { whose?: boolean }).whose) {
          const cond = s.where.replace(new RegExp(String.raw`@${s.name}\.([a-z]\w*)\b`, "g"), "@$1");
          if (once(s.line, `where ${s.where}`)) says(s.line, `where ${s.where}`, `whose ${cond}`, "a loop picks its rows with `whose`, and the rows' fields are named alone, as in a lookup");
        } else if (s.where && s.line < LINE_BASE)
          for (const m of codeOf(s.where).matchAll(new RegExp(String.raw`@${s.name}\.([a-z]\w*)\b`, "g"))) if (once(s.line, m[0])) says(s.line, m[0], `@${m[1]}`, "in a loop's `whose`, the rows' fields are named alone");
        loopsIn(s.body, [...rows, s.name]);
      }
    }
  };
  for (const h of app.handlers) loopsIn(h.body, []);
  for (const ep of app.endpoints ?? []) loopsIn(ep.body, []);
  for (const j of app.jobs ?? []) loopsIn(j.body, []);
  for (const b of [app.before, app.after, app.beforeCall]) loopsIn(b?.body, []);
  // A server's layers: `layer auth = std.http.apiKey { … }` (`use` is for components and `intent.project`).
  for (const l of app.layers ?? []) if (l.spelledUse && l.line < LINE_BASE) says(l.line, `use ${l.alias} =`, `layer ${l.alias} =`, "an api runs behind a layer, declared with `layer`; `use` places a component");
  // `select x from list.f` edits a `Text or nothing`: nothing is "none chosen" (never a "" stand-in).
  const picks: { name: string; rec?: string }[] = [];
  const walkEls = (els: Element[], rec?: string) => {
    for (const el of els) {
      if (el.kind === "select" && el.from) picks.push({ name: el.name, rec });
      walkEls(el.children, el.kind === "list" && el.of ? el.of : rec);
    }
  };
  walkEls(app.screen);
  for (const p of picks) {
    const f = p.rec ? app.records.find((r) => r.name === p.rec)?.fields.find((x) => x.name === p.name) : app.state.find((x) => x.name === p.name);
    // A select that always has a choice (a text default of its own, never un-picked) is a plain `Text`.
    if (!f || f.line >= LINE_BASE || f.type.k !== "Text" || (f.default?.k === "text" && f.default.v !== "")) continue;
    const decl = own[f.line - 1] ?? "";
    const m = decl.match(new RegExp(String.raw`\b${p.name}\s*:\s*Text(?:\s*=\s*"")?`));
    const keeps = m && /^\s*=/.test(decl.slice((m.index ?? 0) + m[0].length)); // a default of its own: kept
    if (m) says(f.line, m[0], `${p.name}: Text or nothing${!keeps && (/=/.test(m[0]) || !p.rec) ? " = nothing" : ""}`, `\`select ${p.name} from …\` holds what is chosen, or nothing when none is (never a "" stand-in)`);
  }
  for (const s of sentences(app)) {
    if (s.line >= LINE_BASE) continue;
    for (const p of picks)
      for (const m of s.text.matchAll(new RegExp(String.raw`\bset\s+((?:its\s+|(?:that|this)\s+[a-z]\w*['’]s\s+|the\s+)?@${p.name})\s+to\s+""`, "g")))
        says(s.line, m[0], `set ${m[1]} to nothing`, `nothing chosen is nothing (\`clear @${p.name}\` says the same)`);
  }
  // Lines of the file itself: types, sizes.
  own.forEach((raw, i) => {
    const line = i + 1;
    const t = codeOf(raw);
    for (const m of t.matchAll(/\bMaybe\s+([A-Z]\w*)/g)) says(line, m[0], `${m[1]} or nothing`, "a value that may be absent is `T or nothing`");
    const sz = t.match(/^sizes\s+(.+)$/);
    if (sz && /\b[a-z]/.test(sz[1])) says(line, sz[0].trim(), `sizes ${sz[1].split("|").map((x) => x.trim()).map((x) => x[0].toUpperCase() + x.slice(1)).join(" | ")}`, "sizes are choice values, written in UpperCamel like every choice value");
    const step = t.match(/^\s*size\s+([a-z]\w*)\s*$/);
    if (step && app.sizes) says(line, `size ${step[1]}`, `size ${step[1][0].toUpperCase() + step[1].slice(1)}`, "a size is a choice value (`size Standard`)");
  });
}
