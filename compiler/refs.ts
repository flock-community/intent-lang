// References in sentences: `@draft`, `@Item`, `@pager.visible`, `@tickets.listTickets`.
// In a sentence (a step, a condition, a derived value, a rule), a name from the spec is marked
// with `@`, so people, the checker and the compiler all see what is intent and what is prose.
// Inside a string, a template hole `{…}` holds a lone name, or a phrase with `@` references.
import type { App, Element } from "./ast.ts";

const STRING = /"(?:[^"\\]|\\.)*"/g;
const REF = /(?<![\w@])@([A-Za-z][A-Za-z0-9]*(?:\.[A-Za-z][A-Za-z0-9]*)*)/g;

/** The parts of a sentence that are not string literals (with template holes: those count as sentence too). */
export function codeParts(text: string): string[] {
  const parts: string[] = [];
  let last = 0;
  for (const m of text.matchAll(STRING)) {
    parts.push(text.slice(last, m.index));
    for (const h of m[0].matchAll(/\{([^{}]*)\}/g)) parts.push(h[1]);
    last = m.index! + m[0].length;
  }
  parts.push(text.slice(last));
  return parts;
}

/** Every `@name` in a sentence (outside strings, and inside template holes). */
export function refsIn(text: string): string[] {
  return codeParts(text).flatMap((p) => [...p.matchAll(REF)].map((m) => m[1]));
}

/** Rewrite the `@name` references of a sentence, outside strings and in template holes. */
export function mapRefs(text: string, f: (name: string) => string): string {
  const onCode = (s: string) => s.replace(REF, (_, n: string) => f(n));
  let out = "";
  let last = 0;
  for (const m of text.matchAll(STRING)) {
    out += onCode(text.slice(last, m.index));
    out += m[0].replace(/\{([^{}]*)\}/g, (_, inner: string) => `{${onCode(inner)}}`);
    last = m.index! + m[0].length;
  }
  return out + onCode(text.slice(last));
}

/** Words of a sentence that are not marked, not in strings and not in holes (for the "mark it" hint). */
export function bareWords(text: string): string[] {
  const outside = text.replace(STRING, " ").replace(REF, " ").replace(/\{[^{}]*\}/g, " ");
  return outside.match(/(?<![\w.@-])[A-Za-z][A-Za-z0-9]*(?![\w-])/g) ?? [];
}

/** Every sentence of an app, with its line: steps, conditions, derived values, rules, endpoint and layer steps. */
export function sentences(app: App): { text: string; line: number; where: string }[] {
  const out: { text: string; line: number; where: string }[] = [];
  for (const h of app.handlers) h.steps.forEach((s, i) => out.push({ text: s, line: h.stepLines?.[i] ?? h.line, where: `on ${h.verb}${h.target ? " " + h.target : ""}` }));
  for (const d of app.derive) out.push({ text: d.sentence, line: d.line, where: `derive ${d.name}` });
  app.rules.forEach((r, i) => out.push({ text: r, line: app.ruleLines?.[i] ?? 1, where: "rules" }));
  const walk = (els: Element[]) => {
    for (const el of els) {
      if (el.expr) out.push({ text: el.expr, line: el.line, where: `${el.kind} ${el.name}` });
      if (el.visibleWhen) out.push({ text: el.visibleWhen, line: el.line, where: `${el.kind} ${el.name}` });
      if (el.enabledWhen) out.push({ text: el.enabledWhen, line: el.line, where: `${el.kind} ${el.name}` });
      walk(el.children);
    }
  };
  walk(app.screen);
  for (const j of app.jobs ?? []) j.steps.forEach((s, i) => out.push({ text: s, line: j.stepLines?.[i] ?? j.line, where: `every ${j.name.slice(5)}` }));
  for (const ep of app.endpoints ?? []) ep.steps.forEach((s, i) => out.push({ text: s, line: ep.stepLines?.[i] ?? ep.line, where: `endpoint ${ep.name}` }));
  for (const [b, where] of [[app.before, "before every request"], [app.after, "after every answer"], [app.beforeCall, "before every call"]] as const)
    (b?.steps ?? []).forEach((s, i) => out.push({ text: s, line: b!.stepLines?.[i] ?? b!.line, where }));
  return out;
}

/** The clock every sentence may read: `@now` (a DateTime) and `@today` (a Date). */
export const CLOCK_NAMES = ["now", "today"];

/** Does this app read the clock (`@now`, `@today`), or run recurring work? Then its logic gets the clock. */
export function usesClock(app: App): boolean {
  if (app.jobs?.length) return true;
  return sentences(app).some((s) => refsIn(s.text).some((r) => CLOCK_NAMES.includes(r.split(".")[0])));
}

/** Every name a sentence of this app may refer to. */
export function declaredNames(app: App): Set<string> {
  const names = new Set<string>(CLOCK_NAMES);
  for (const f of app.state) names.add(f.name);
  for (const d of app.derive) names.add(d.name);
  const walk = (els: Element[]) => {
    for (const el of els) {
      names.add(el.name);
      walk(el.children);
    }
  };
  walk(app.screen);
  for (const r of app.records) {
    names.add(r.name);
    for (const f of r.fields) names.add(f.name);
  }
  for (const c of app.choices) {
    names.add(c.name);
    for (const v of c.values) names.add(v);
  }
  for (const r of app.refined ?? []) names.add(r.name);
  for (const e of app.events ?? []) names.add(e.name);
  for (const ep of app.endpoints ?? []) {
    names.add(ep.name);
    for (const p of ep.params) names.add(p.name);
  }
  for (const p of app.params ?? []) names.add(p.name);
  for (const p of app.provides ?? []) names.add(p.name);
  for (const l of app.layers ?? []) for (const p of l.spec?.provides ?? []) names.add(p.name);
  for (const c of app.clients ?? []) {
    names.add(c.alias);
    for (const e of c.contract.endpoints ?? []) names.add(`${c.alias}.${e.name}`);
    for (const e of c.contract.events ?? []) names.add(`${c.alias}.${e.name}`);
  }
  return names;
}

/** Is `@ref` a declared name, or a field of one (`@current.subject`)? */
export function resolves(ref: string, names: Set<string>): boolean {
  if (names.has(ref)) return true;
  const parts = ref.split(".");
  for (let i = parts.length - 1; i > 0; i--) if (names.has(parts.slice(0, i).join("."))) return parts.slice(i).every((p) => names.has(p));
  return false;
}
