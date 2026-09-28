// The hints std.quality gives (compiler/quality/std.ts): each judges the spec as the compiler
// resolved it — its model and the facts it recorded (app.facts) — and warns where it is not yet
// precise or complete. Moved out of the checker: the compiler decides what a spec means, these
// rules what makes it good, and a project sets their levels (intent.project's `quality` block).
import { LINE_BASE, type App, type Element, type Stmt } from "../ast.ts";
import { bareWords, CLOCK_NAMES, declaredNames, refsIn, sentences, usedByAlias } from "../refs.ts";
import { parseString } from "../parse.ts";

/** A hint: the line, the rule's code, and what to do. */
export type Warn = (line: number, code: string, message: string) => void;

/**
 * A value that may be absent (`T or nothing`) is handled where it is used: a sentence that reads
 * it says what happens when there is none, or sits inside an `if` that asks. Otherwise: a hint.
 */
export function unguarded(app: App, warn: Warn) {
  // A value that may be nothing: an optional state field, an optional record field (`Book.rating`),
  // or a lookup (`the ticket whose @id is @id`) that can find no row. A `ref` field is a key, read
  // by comparison, not dereferenced: it is not optional in this sense.
  const optional = new Set([
    ...app.state.filter((f) => f.type.k === "Maybe").map((f) => f.name),
    ...app.records.flatMap((r) => r.fields.filter((f) => f.type.k === "Maybe").map((f) => f.name)),
  ]);
  const esc = (x: string) => x.replace(/\./g, "\\.");
  // Asked about by name, or written (`set @x to …`, `with @x = …`), not read. A general "when there is
  // none" answers for the one value a sentence reads, not for every optional name in it.
  const handles = (text: string, x: string) =>
    new RegExp(`there is (a |an |no )?@${esc(x)}\\b|\\bno @${esc(x)}\\b|@${esc(x)} is (not )?(nothing|set)|without (a |an )?@${esc(x)}\\b|\\b(set|clear) @${esc(x)}\\b|@${esc(x)}\\s*=\\s`).test(text);
  const reads = (text: string) => {
    const xs = [...new Set(refsIn(text).map((r) => r.split(".")[0]))].filter((x) => optional.has(x) && !handles(text, x));
    return xs.length === 1 && /\bwhen there is none\b|\bor nothing\b/.test(text) ? [] : xs;
  };
  const hint = (line: number, x: string, where: string) =>
    line < LINE_BASE && warn(line, "UNGUARDED", `@${x} may be nothing (${where}): say what happens then, inside \`if there is a @${x} { … }\` or in the sentence ("…, or nothing when there is no @${x}")`);
  // A lookup reads one row of a list ("the ticket whose @id is @id"): it can find nothing. A list
  // filter ("the @tickets whose …") returns a list and needs no guard.
  const singular = new Set(app.records.map((r) => r.name[0].toLowerCase() + r.name.slice(1)));
  const lists = new Set([...app.state.filter((f) => f.type.k === "List").map((f) => f.name), ...app.derive.map((d) => d.name)]);
  const saysNone = (text: string) => /\bwhen there is (none|no|one|a)\b|\bor nothing\b|\bwhen none\b|\bif there is no\b|\bwithout\b/.test(text);
  const lookup = (text: string) => [...text.matchAll(/\bthe\s+@?([a-z]\w*)\s+(?:whose|where)\b/g)].some((m) => singular.has(m[1]) && !lists.has(m[1]));
  const lookupHint = (line: number, text: string, where: string) => line < LINE_BASE && lookup(text) && !saysNone(text) && warn(line, "UNGUARDED", `a lookup ("the … whose …" / "the … where …", ${where}) can find nothing: say what happens then ("… when there is none")`);
  const walk = (b: Stmt[], guarded: Set<string>, where: string) => {
    for (const s of b) {
      if (s.k === "step" || s.k === "answer") {
        for (const x of reads(s.text)) if (!guarded.has(x)) hint(s.line, x, where);
        lookupHint(s.line, s.text, where);
      }
      if (s.k === "if") {
        for (const br of s.branches) {
          // `if there is a ticket whose … { }` asks whether the lookup finds one: that is the guard.
          if (br.cond && !/^there is (a|an|no)\b/.test(br.cond)) lookupHint(br.line, br.cond, where);
          const inner = new Set(guarded);
          for (const x of optional) if (br.cond !== undefined && handles(br.cond, x)) inner.add(x);
          walk(br.body, inner, where);
        }
        // `if there is no @x { stop }`: an early exit guards what follows
        const [only] = s.branches;
        const last = only.body[only.body.length - 1];
        if (s.branches.length === 1 && only.cond !== undefined && last && (last.k === "stop" || last.k === "answer"))
          for (const x of optional) if (handles(only.cond, x)) guarded = new Set([...guarded, x]);
      }
      if (s.k === "for") {
        if (s.where) {
          for (const x of reads(s.where)) if (!guarded.has(x)) hint(s.line, x, where);
          lookupHint(s.line, s.where, where);
        }
        walk(s.body, guarded, where);
      }
    }
  };
  for (const h of app.handlers) if (h.body) walk(h.body, new Set(), `on ${h.verb}${h.target ? " " + h.target : ""}`);
  for (const ep of app.endpoints ?? []) if (ep.body) walk(ep.body, new Set(), `endpoint ${ep.name}`);
  for (const d of app.derive) {
    for (const x of reads(d.sentence)) hint(d.line, x, `derive ${d.name}`);
    lookupHint(d.line, d.sentence, `derive ${d.name}`);
  }
  const els = (list: Element[]) => list.forEach((el) => {
    for (const t of [el.expr, el.visibleWhen, el.enabledWhen]) if (t) {
      for (const x of reads(t)) hint(el.line, x, `${el.kind} ${el.name}`);
      lookupHint(el.line, t, `${el.kind} ${el.name}`);
    }
    els(el.children);
  });
  els(app.screen);
}


/** A rule that reads like an invariant is only guidance in `rules`; in `always` it is checked. */
export function unchecked(app: App, warn: Warn) {
  app.rules.forEach((r, i) => {
    // A definition ("a @Release meets an item when it is at least …") is not a claim about the data.
    const claim = r.match(/\b(never|always|at most|at least|no two|cannot|can't|must not|may not)\b/i);
    const defines = claim && /\b(when|if|means|counts as|is called)\b/i.test(r.slice(0, claim.index));
    if (claim && !defines && (app.ruleLines?.[i] ?? 0) < LINE_BASE)
      warn(app.ruleLines?.[i] ?? 1, "UNCHECKED", `this rule reads like something that must always hold, but \`rules\` is only guidance: move it to \`always { - … }\` so every session checks it`);
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
    for (const w of bareWords(text)) if (hinted.has(w) && !rowItems.has(w)) (found.get(s.line) ?? found.set(s.line, new Set()).get(s.line)!).add(w);
  }
  for (const [line, ws] of found) warn(line, "UNMARKED", `${[...ws].map((w) => `"${w}"`).join(", ")} ${ws.size > 1 ? "are declared names" : "is a declared name"}: in a sentence, write ${[...ws].map((w) => `\`@${w}\``).join(", ")} when you mean ${ws.size > 1 ? "them" : "it"}`);
}

/** Every element with its list (a row's element), across sections. */
function elementsWithList(app: App): { el: Element; list?: Element }[] {
  const out: { el: Element; list?: Element }[] = [];
  const walk = (els: Element[], list?: Element) => {
    for (const el of els) {
      out.push({ el, list });
      walk(el.children, el.kind === "list" ? el : list);
    }
  };
  walk(app.screen);
  return out;
}

/** Inside a list, an element named like a field of the row and like an app-level name is ambiguous to a reader. */
export function shadowed(app: App, warn: Warn) {
  const records = new Map(app.records.map((r) => [r.name, r]));
  const appNames = new Set([...app.state.map((f) => f.name), ...app.derive.map((d) => d.name)]);
  for (const { el, list } of elementsWithList(app))
    if (list && el.kind !== "heading" && el.line < LINE_BASE && records.get(list.of!)?.fields.some((f) => f.name === el.name) && appNames.has(el.name))
      warn(el.line, "SHADOWED", `\`${el.name}\` is a field of ${list.of} and also an app-level name; inside the row it means the row's field. Rename the app-level one to avoid mix-ups`);
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
