// Differential testing: random user sessions generated from the spec alone (not from any build),
// replayed on every build; screens are compared step by step.
import type { App, Element } from "./ast.ts";
import { describe, stepToAction, type Action, type Job } from "./exec.ts";

function mulberry32(seed: number) {
  return () => {
    seed |= 0;
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const GENERIC_TEXT = ["", " ", "a", "Milk", "milk", "Bread", "0", "1", "7", "12.5", "3,75", "-4", "100", "abc", "  x  ", "Yoga"];
// Text that different readings of "word", "blank", "same name" or "number" disagree on.
const TRICKY_TEXT = ["don't stop", "e-mail me", "one,two", "  two   spaces  ", "Café Ünïcode", "Hello, world!", "a.b.c", "ALL CAPS", "3 apples", "x@y.z", "tab\tseparated", "MILK "];
// Numbers that stress parsing and rounding.
const NUMERIC_EDGES = ["0.01", "0.005", "0,99", "33.33", "99.99", "1000000", "2.675", "1.005", "10.10", "3", "9", "13", "0.1", "07", "1.", ".5", "1e3"];

/** The calls another client makes in the examples (\`call tickets.createTicket …\` in a screen's example). */
export function otherCalls(app: App): Action[] {
  const seen = new Map<string, Action>();
  for (const ex of app.examples) for (const s of ex.steps) if (s.do === "call" && s.endpoint.includes(".")) {
    const a = stepToAction(s)!;
    seen.set(JSON.stringify(a), a);
  }
  return [...seen.values()];
}

/** The same call with its whole-number arguments sometimes changed (1–10): the same kind of change, to something else. */
export function varyOther(a: Action, rnd: () => number): Action {
  const args = Object.fromEntries(Object.entries(a.call!.args).map(([k, v]) => [k, typeof v === "number" && Number.isInteger(v) && rnd() < 0.5 ? 1 + Math.floor(rnd() * 10) : v]));
  return { ...a, call: { ...a.call!, args } };
}

export function actionTemplates(app: App): { weight: number; make: (rnd: () => number) => Action }[] {
  const typed = new Set<string>();
  for (const ex of app.examples) for (const s of ex.steps) if (s.do === "type") typed.add(s.text);
  const pool = [...typed, ...GENERIC_TEXT, ...NUMERIC_EDGES, ...TRICKY_TEXT];
  const pick = <T,>(rnd: () => number, xs: T[]) => xs[Math.floor(rnd() * xs.length)];
  const out: { weight: number; make: (rnd: () => number) => Action }[] = [];
  const choiceOf = (name: string) => {
    const t = app.state.find((f) => f.name === name)?.type;
    return app.choices.find((c) => t?.k === "Named" && c.name === t.name)?.values ?? [];
  };
  const walk = (els: Element[], list?: string) => {
    for (const el of els) {
      const row = (rnd: () => number) => (list ? { list, row: 1 + Math.floor(rnd() * 5) } : {});
      if (el.kind === "field") out.push({ weight: 3, make: (r) => ({ on: "input", target: el.name, text: pick(r, [...typed, ...typed, ...pool]) }) });
      if (el.kind === "button") out.push({ weight: 3, make: (r) => ({ on: "click", target: el.name, ...row(r) }) });
      if (el.kind === "checkbox") out.push({ weight: 2, make: (r) => ({ on: "toggle", target: el.name, ...row(r) }) });
      if (el.kind === "select" && el.from) out.push({ weight: 2, make: (r) => ({ on: "choose", target: el.name, pick: Math.floor(r() * 6) }) });
      else if (el.kind === "select") out.push({ weight: 1, make: (r) => ({ on: "choose", target: el.name, value: pick(r, choiceOf(el.name)) }) });
      if (el.kind === "list") walk(el.children, el.name);
      if (el.kind === "section") walk(el.children, list);
    }
  };
  walk(app.screen);
  // Another client's calls, as the examples make them (with whole numbers varied: another ticket).
  for (const a of otherCalls(app)) out.push({ weight: 1, make: (r) => varyOther(a, r) });
  if (app.clockMs) {
    const perMinute = Math.max(1, Math.round(60_000 / app.clockMs));
    out.push({ weight: 3, make: (r) => ({ on: "tick", target: "", times: pick(r, [1, 1, 2, 5, 10, perMinute, 5 * perMinute, 25 * perMinute]) }) });
  }
  return out;
}

/**
 * Exploration jobs: a third start from the initial screen, the rest replay a prefix of one of the
 * spec's examples (which reach the interesting states) and continue from there. Run them on one
 * reference build; the recorded actions are then replayed on every build.
 */
export function exploreJobs(app: App, count: number, length: number, seed = 7): Job[] {
  const rnd = mulberry32(seed);
  const pools: Record<string, string[]> = {};
  for (const ex of app.examples) for (const s of ex.steps) if (s.do === "type") (pools[s.target] ??= []).push(s.text);
  const pool = [...new Set([...Object.values(pools).flat(), ...GENERIC_TEXT, ...NUMERIC_EDGES, ...TRICKY_TEXT])];
  const perMinute = app.clockMs ? Math.max(1, Math.round(60_000 / app.clockMs)) : 0;
  const ticks = app.clockMs ? [1, 1, 2, 5, 10, perMinute, 5 * perMinute, 25 * perMinute] : [];
  const examples = app.examples.map((ex) => ex.steps.map(stepToAction).filter((a): a is Action => !!a));
  const jobs: Job[] = [];
  for (let i = 0; i < count; i++) {
    let prefix: Action[] = [];
    if (examples.length && i % 3 !== 0) {
      const ex = examples[Math.floor(rnd() * examples.length)];
      prefix = ex.slice(0, 1 + Math.floor(rnd() * ex.length));
    }
    jobs.push({ kind: "explore", prefix, length, seed: Math.floor(rnd() * 2 ** 31), pools, pool, ticks, others: otherCalls(app), always: app.always });
  }
  return jobs;
}

export function makeTraces(app: App, count: number, length: number, seed = 1): Action[][] {
  const templates = actionTemplates(app);
  const total = templates.reduce((s, t) => s + t.weight, 0);
  const rnd = mulberry32(seed);
  const traces: Action[][] = [];
  for (let i = 0; i < count; i++) {
    const trace: Action[] = [];
    for (let j = 0; j < length; j++) {
      let x = rnd() * total;
      const t = templates.find((t) => (x -= t.weight) < 0) ?? templates[templates.length - 1];
      trace.push(t.make(rnd));
    }
    traces.push(trace);
  }
  return traces;
}

export function actionText(a: Action): string {
  const at = a.list ? ` on row ${a.rowWith !== undefined ? `with ${JSON.stringify(a.rowWith)}` : a.row} of ${a.list}` : "";
  switch (a.on) {
    case "input": return `type ${JSON.stringify(a.text)} into ${a.target}`;
    case "click": return `click ${a.target}${at}`;
    case "toggle": return `toggle ${a.target}${at}`;
    case "choose": return a.pick !== undefined ? `choose option ${a.pick + 1} in ${a.target}` : `choose ${a.value} in ${a.target}`;
    case "tick": return `tick ${a.times} times`;
    case "other": return `call ${a.call!.endpoint}${Object.keys(a.call!.args).length ? ` with ${Object.entries(a.call!.args).map(([k, v]) => `${k} = ${JSON.stringify(v)}`).join(", ")}` : ""}  # another client`;
  }
}

export interface Divergence {
  trace: number;
  step: number; // index of the action after which screens differ (-1 = initial screen)
  actions: string[]; // the actions up to and including the diverging one
  groups: { builds: string[]; screen: string }[]; // majority first
}

/**
 * Compare the step sequences of every build on every trace. Screen sessions start with the
 * initial screen (step 0 is before any action); api and layer sessions do not (step 0 is the
 * answer to the first request): pass \`initial = false\` for those.
 */
export function compare<A = Action>(traces: A[][], perBuild: Map<string, (string[] | null)[]>, textOf: (a: A) => string = actionText as (a: A) => string, initial = true): { agree: number; total: number; divergences: Divergence[]; matchMajority: Map<string, number> } {
  const builds = [...perBuild.keys()];
  const divergences: Divergence[] = [];
  const matchMajority = new Map(builds.map((b) => [b, 0]));
  let agree = 0;
  traces.forEach((trace, ti) => {
    const seqs = builds.map((b) => perBuild.get(b)![ti]);
    const keyOf = (s: string[] | null) => (s ? s.join("\n") : "CRASH");
    const groups = new Map<string, string[]>();
    seqs.forEach((s, i) => groups.set(keyOf(s), [...(groups.get(keyOf(s)) ?? []), builds[i]]));
    const sorted = [...groups.entries()].sort((a, b) => b[1].length - a[1].length);
    for (const b of sorted[0][1]) matchMajority.set(b, matchMajority.get(b)! + 1);
    if (groups.size === 1) {
      agree++;
      return;
    }
    // First step where any two sequences differ.
    const maxLen = Math.max(...seqs.map((s) => s?.length ?? 0));
    let step = 0;
    for (; step < maxLen; step++) {
      const vals = new Set(seqs.map((s) => (s ? s[step] : "CRASH")));
      if (vals.size > 1) break;
    }
    const screenAt = (s: string[] | null) => (!s ? "(crashed)" : s[step] === "-" ? "(action not available on this screen)" : describe(JSON.parse(s[step])));
    const byScreen = new Map<string, string[]>();
    seqs.forEach((s, i) => byScreen.set(screenAt(s), [...(byScreen.get(screenAt(s)) ?? []), builds[i]]));
    divergences.push({
      trace: ti,
      step: initial ? step - 1 : step,
      actions: trace.slice(0, initial ? step : step + 1).map(textOf),
      groups: [...byScreen.entries()].sort((a, b) => b[1].length - a[1].length).map(([screen, bs]) => ({ builds: bs, screen })),
    });
  });
  return { agree, total: traces.length, divergences, matchMajority };
}
