// Runs examples and action traces against a compiled build. Target-agnostic: both targets
// expose the same Node observations and accept the same Wire events.
// Used in-process via `runJobs`, and as a child process (`node exec.ts <dir> <target> <jobs.json>`)
// so a hanging build can be killed.
import { run } from "./proc.ts";
import { readFileSync, rmSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import type { Check, Example, Step } from "./ast.ts";

export type Obs = any; // Ui Node as JSON

export interface Action {
  on: "click" | "toggle" | "input" | "choose" | "tick";
  target: string; // element name ("" for tick)
  list?: string;
  row?: number; // 1-based
  rowWith?: string; // or: the first row showing this text
  text?: string;
  value?: string;
  pick?: number; // choose the (pick mod n)-th option: for selects whose options come from the model
  times?: number;
}

export type Job =
  | { kind: "example"; example: Example; always?: Step[] }
  | { kind: "trace"; actions: Action[]; always?: Step[] }
  | { kind: "explore"; prefix: Action[]; length: number; seed: number; pools: Record<string, string[]>; pool: string[]; ticks: number[]; always?: Step[] };

/** The first broken `always` check in a session: after `actions`, `check` failed on `screen`. */
export interface Violation {
  line: number;
  message: string;
  actions: Action[];
  screen: string;
}

export interface ExploreResult {
  actions: Action[];
  violation?: Violation;
  error?: string;
}

export interface ExampleResult {
  name: string;
  pass: boolean;
  failure?: { line: number; message: string; screen: string };
}

export interface TraceResult {
  steps: string[]; // canonical observation after each action, or "-" when the action was unavailable
  violation?: Violation;
  error?: string;
}

/** Invariants only apply to what is on the screen: a check on an absent element is skipped. */
function brokenInvariant(obs: Obs, always: Step[] | undefined, actions: Action[]): Violation | undefined {
  for (const s of always ?? []) {
    if (s.do !== "see") continue;
    if (!s.every && s.check.is !== "hidden" && s.check.is !== "shown" && "missing" in locate(obs, s.target)) continue;
    const msg = checkSee(obs, s);
    if (msg) return { line: s.line, message: msg, actions: [...actions], screen: describe(obs) };
  }
}

interface Session {
  observe(): Promise<Obs>;
  send(w: object): Promise<void>;
}

async function openSession(dir: string, target: string): Promise<Session> {
  if (target === "ts") {
    const mod = await import(pathToFileURL(join(dir, "test.mjs")).href + `?t=${Date.now()}`);
    const s = mod.start();
    return { observe: async () => s.observe(), send: async (w) => s.send(w) };
  }
  const require = createRequire(import.meta.url);
  const { Elm } = require(join(dir, "worker.cjs"));
  const app = Elm.Worker.init();
  let last: Obs | undefined;
  let waiting: ((v: Obs) => void) | undefined;
  app.ports.observe.subscribe((v: Obs) => {
    last = v;
    waiting?.(v);
  });
  // Elm delivers port messages asynchronously: wait for the observation that answers this event.
  const deliver = (w: object) =>
    new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error("Elm worker produced no observation within 5s")), 5000);
      waiting = () => {
        clearTimeout(timer);
        waiting = undefined;
        resolve();
      };
      try {
        app.ports.act.send(w);
      } catch (e) {
        clearTimeout(timer);
        reject(e);
      }
    });
  await deliver({ on: "noop" });
  return { observe: async () => last, send: deliver };
}

// ---------------------------------------------------------------- observation helpers

type Found = { node: any; rowKey?: string } | { missing: string };

function findIn(nodes: any[], name: string): any | undefined {
  for (const n of nodes) {
    if (n.n === name && n.k !== "section") return n;
    if (n.k === "section") {
      if (n.n === name) return n;
      const inner = findIn(n.c, name);
      if (inner) return inner;
    }
  }
}

function shows(nodes: any[], text: string): boolean {
  return nodes.some((n) => (n.k === "text" || n.k === "field" ? n.v === text : n.k === "button" || n.k === "checkbox" ? n.label === text : n.k === "section" ? shows(n.c, text) : false));
}

function locate(obs: Obs, name: string, list?: string, row?: number, rowWith?: string): Found {
  if (!list) {
    const node = findIn(obs.c, name);
    return node ? { node } : { missing: `\`${name}\` is not on the screen` };
  }
  const l = findIn(obs.c, list);
  if (!l) return { missing: `list \`${list}\` is not on the screen` };
  const r = rowWith !== undefined ? l.rows.find((r: any) => shows(r.c, rowWith)) : l.rows[row! - 1];
  if (!r) return { missing: rowWith !== undefined ? `list \`${list}\` has no row showing ${JSON.stringify(rowWith)}` : `list \`${list}\` has no row ${row} (it has ${l.rows.length})` };
  const node = findIn(r.c, name);
  return node ? { node, rowKey: r.key } : { missing: `row ${row} of \`${list}\` has no \`${name}\`` };
}

/** Observation without row keys (internal) and with stable key order. */
export function canonical(obs: Obs): string {
  const strip = (v: any): any => {
    if (Array.isArray(v)) return v.map(strip);
    if (v && typeof v === "object") {
      const out: any = {};
      for (const k of Object.keys(v).sort()) if (k !== "key") out[k] = strip(v[k]);
      // "" is how a select shows "nothing chosen" (a placeholder), never one of its options.
      if (v.k === "select" && Array.isArray(out.options)) out.options = out.options.filter((o: string) => o !== "");
      return out;
    }
    return v;
  };
  return JSON.stringify(strip(obs));
}

/** Human-readable screen dump, used in repair prompts and divergence reports. */
export function describe(obs: Obs): string {
  if (!obs || !Array.isArray(obs.c)) return JSON.stringify(obs, null, 2); // an api response, not a screen
  const lines: string[] = [];
  const walk = (nodes: any[], ind: string) => {
    for (const n of nodes) {
      switch (n.k) {
        case "heading": lines.push(`${ind}heading "${n.v}"`); break;
        case "text": lines.push(`${ind}text ${n.n} = ${JSON.stringify(n.v)}`); break;
        case "field": lines.push(`${ind}field ${n.n} = ${JSON.stringify(n.v)}`); break;
        case "button": lines.push(`${ind}button ${n.n} "${n.label}"${n.enabled ? "" : " (disabled)"}`); break;
        case "checkbox": lines.push(`${ind}checkbox ${n.n} ${n.checked ? "[x]" : "[ ]"}`); break;
        case "progress": lines.push(`${ind}progress ${n.n} = ${n.v}`); break;
        case "select": lines.push(`${ind}select ${n.n} = ${n.v}`); break;
        case "section": lines.push(`${ind}section ${n.n}`); walk(n.c, ind + "  "); break;
        case "list":
          lines.push(`${ind}list ${n.n} (${n.rows.length} rows)`);
          n.rows.forEach((r: any, i: number) => {
            lines.push(`${ind}  row ${i + 1}:`);
            walk(r.c, ind + "    ");
          });
          break;
      }
    }
  };
  walk(obs.c, "");
  return lines.join("\n");
}

/** Resolve an abstract action against the current screen. Returns the wire event(s), or a reason it is unavailable. */
export function resolve(obs: Obs, a: Action): { wires: object[] } | { unavailable: string } {
  if (a.on === "tick") return { wires: Array.from({ length: a.times ?? 1 }, () => ({ on: "tick", target: "" })) };
  const f = locate(obs, a.target, a.list, a.row, a.rowWith);
  if ("missing" in f) return { unavailable: f.missing };
  const n = f.node;
  const want = { click: "button", toggle: "checkbox", input: "field", choose: "select" }[a.on];
  if (n.k !== want) return { unavailable: `\`${a.target}\` is a ${n.k}, not a ${want}` };
  if (a.on === "click" && !n.enabled) return { unavailable: `button \`${a.target}\` is disabled` };
  let value = a.value;
  if (a.on === "choose" && a.pick !== undefined) {
    if (!n.options.length) return { unavailable: `\`${a.target}\` has no options` };
    value = n.options[a.pick % n.options.length];
  }
  if (a.on === "choose" && !n.options.includes(value)) return { unavailable: `\`${value}\` is not an option` };
  const target = a.list ? `${a.list}.${a.target}` : a.target;
  return { wires: [{ on: a.on, target, key: f.rowKey ?? "", text: a.text ?? "", value: value ?? "" }] };
}

export function stepToAction(s: Step): Action | undefined {
  switch (s.do) {
    case "type": return { on: "input", target: s.target, text: s.text };
    case "click": return { on: "click", target: s.target, list: s.at?.list, row: s.at?.row, rowWith: s.at?.with };
    case "toggle": return { on: "toggle", target: s.target, list: s.at?.list, row: s.at?.row, rowWith: s.at?.with };
    case "choose": return { on: "choose", target: s.target, value: s.value };
    case "tick": return { on: "tick", target: "", times: s.times };
    default: return undefined;
  }
}

/** The number an element shows: a progress value, or the first number in its text ("10 left" → 10). */
function shownNumber(n: any): number | undefined {
  if (n.k === "progress") return Number(n.v);
  const m = String(n.v ?? "").replace(/(\d),(\d)/g, "$1.$2").match(/-?\d+(\.\d+)?/);
  return m ? Number(m[0]) : undefined;
}

function compareNumber(n: any, c: Extract<Check, { is: "num" }>, scope: any[], what: string): string | undefined {
  const x = shownNumber(n);
  const other = c.ref !== undefined ? findIn(scope, c.ref) : undefined;
  const y = c.ref !== undefined ? (other ? shownNumber(other) : undefined) : c.value;
  if (x === undefined) return `${what} shows no number (${JSON.stringify(n.v)})`;
  if (y === undefined) return c.ref !== undefined ? `\`${c.ref}\` is not on the screen or shows no number` : undefined;
  const ok = c.op === "atLeast" ? x >= y : c.op === "atMost" ? x <= y : c.op === "above" ? x > y : x < y;
  const words = { atLeast: "at least", atMost: "at most", above: "above", below: "below" }[c.op];
  return ok ? undefined : `expected ${what} to be ${words} ${c.ref ? `\`${c.ref}\` (${y})` : y}, but it shows ${x}`;
}

export function checkSee(obs: Obs, s: Extract<Step, { do: "see" }>): string | undefined {
  const c = s.check;
  if (s.every) {
    // Check each row of the list; a missing list or a row without the element is skipped.
    const list = findIn(obs.c, s.every);
    if (!list) return;
    for (const [i, r] of list.rows.entries()) {
      const n = findIn(r.c, s.target);
      const what = `\`${s.target}\` on row ${i + 1} of \`${s.every}\``;
      if (c.is === "hidden") {
        if (n) return `expected ${what} to be hidden`;
        continue;
      }
      if (!n) continue;
      const msg =
        c.is === "num" ? compareNumber(n, c, r.c, what) : c.is === "eq" ? (String(n.k === "button" ? n.label : n.v) === c.value ? undefined : `expected ${what} = ${JSON.stringify(c.value)}, got ${JSON.stringify(n.v)}`) : checkSee({ c: r.c }, { ...s, every: undefined });
      if (msg) return msg;
    }
    return;
  }
  const f = locate(obs, s.target, s.at?.list, s.at?.row, s.at?.with);
  const what = s.at ? `\`${s.target}\` on row ${s.at.with !== undefined ? `with ${JSON.stringify(s.at.with)}` : s.at.row}` : `\`${s.target}\``;
  if (c.is === "hidden") return "missing" in f ? undefined : `expected ${what} to be hidden, but it is on the screen`;
  if ("missing" in f) return c.is === "shown" ? `expected ${what} to be shown, but ${f.missing}` : f.missing;
  const n = f.node;
  switch (c.is) {
    case "shown": return;
    case "rows": {
      const ok = c.cmp === "atMost" ? n.rows.length <= c.count : c.cmp === "atLeast" ? n.rows.length >= c.count : n.rows.length === c.count;
      const want = c.cmp === "atMost" ? `at most ${c.count}` : c.cmp === "atLeast" ? `at least ${c.count}` : `${c.count}`;
      return ok ? undefined : `expected ${want} rows in \`${s.target}\`, got ${n.rows.length}`;
    }
    case "enabled":
    case "disabled": return n.enabled === (c.is === "enabled") ? undefined : `expected ${what} to be ${c.is}, but it is ${n.enabled ? "enabled" : "disabled"}`;
    case "checked":
    case "unchecked": return n.checked === (c.is === "checked") ? undefined : `expected ${what} to be ${c.is}`;
    case "num": return compareNumber(n, c, obs.c, what);
    case "eq": {
      const actual = n.k === "button" ? n.label : String(n.v);
      return actual === c.value ? undefined : `expected ${what} = ${JSON.stringify(c.value)}, got ${JSON.stringify(actual)}`;
    }
  }
}

/** Every action that is possible on this screen, with a weight. */
function available(obs: Obs, job: Extract<Job, { kind: "explore" }>, rnd: () => number): { w: number; a: Action }[] {
  const pickText = (field: string) => {
    const own = job.pools[field] ?? [];
    const src = own.length && rnd() < 0.6 ? own : job.pool;
    return src[Math.floor(rnd() * src.length)];
  };
  const out: { w: number; a: Action }[] = [];
  const walk = (nodes: any[], list?: string, row?: number) => {
    for (const n of nodes) {
      const at = list ? { list, row } : {};
      if (n.k === "section") walk(n.c, list, row);
      else if (n.k === "field") out.push({ w: 2, a: { on: "input", target: n.n, text: pickText(n.n) } });
      else if (n.k === "button" && n.enabled) out.push({ w: 3, a: { on: "click", target: n.n, ...at } });
      else if (n.k === "checkbox") out.push({ w: 1, a: { on: "toggle", target: n.n, ...at } });
      else if (n.k === "select" && n.options.length) out.push({ w: 1, a: { on: "choose", target: n.n, value: n.options[Math.floor(rnd() * n.options.length)] } });
      else if (n.k === "list") n.rows.forEach((r: any, i: number) => walk(r.c, n.n, i + 1));
    }
  };
  walk(obs.c);
  if (job.ticks.length) out.push({ w: 3, a: { on: "tick", target: "", times: job.ticks[Math.floor(rnd() * job.ticks.length)] } });
  return out;
}

function mulberry32(seed: number) {
  return () => {
    seed |= 0;
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export async function runJobs(dir: string, target: string, jobs: Job[]): Promise<(ExampleResult | TraceResult | ExploreResult)[]> {
  const out: (ExampleResult | TraceResult | ExploreResult)[] = [];
  for (const job of jobs) {
    if (job.kind === "explore") {
      // Walk the app on this (reference) build, choosing only actions the current screen offers.
      const actions: Action[] = [];
      const rnd = mulberry32(job.seed);
      try {
        const s = await openSession(dir, target);
        let obs = await s.observe();
        let violation: Violation | undefined = brokenInvariant(obs, job.always, actions);
        const step = async (a: Action) => {
          const r = resolve(obs, a);
          actions.push(a);
          if ("unavailable" in r) return;
          for (const w of r.wires) await s.send(w);
          obs = await s.observe();
          violation ??= brokenInvariant(obs, job.always, actions);
        };
        for (const a of job.prefix) await step(a);
        for (let i = 0; i < job.length && !violation; i++) {
          const opts = available(obs, job, rnd);
          const total = opts.reduce((t, o) => t + o.w, 0);
          let x = rnd() * total;
          await step((opts.find((o) => (x -= o.w) < 0) ?? opts[opts.length - 1]).a);
        }
        out.push({ actions, violation });
      } catch (e) {
        out.push({ actions, error: (e as Error).message });
      }
    } else if (job.kind === "example") {
      const ex = job.example;
      let failure: ExampleResult["failure"];
      let obs: Obs;
      try {
        const s = await openSession(dir, target);
        obs = await s.observe();
        for (const step of ex.steps) {
          if (step.do === "snapshot") continue;
          if (step.do === "see") {
            const msg = checkSee(obs, step);
            if (msg) {
              failure = { line: step.line, message: msg, screen: describe(obs) };
              break;
            }
            continue;
          }
          const r = resolve(obs, stepToAction(step)!);
          if ("unavailable" in r) {
            failure = { line: step.line, message: `cannot do this step: ${r.unavailable}`, screen: describe(obs) };
            break;
          }
          for (const w of r.wires) await s.send(w);
          obs = await s.observe();
          const v = brokenInvariant(obs, job.always, []);
          if (v) {
            failure = { line: step.line, message: `after this step, the rule \`always\` (line ${v.line}) is broken: ${v.message}`, screen: v.screen };
            break;
          }
        }
      } catch (e) {
        failure = { line: ex.line, message: `crashed: ${(e as Error).message}`, screen: obs ? describe(obs) : "" };
      }
      out.push({ name: ex.name, pass: !failure, failure });
    } else {
      const steps: string[] = [];
      let error: string | undefined;
      let violation: Violation | undefined;
      try {
        const s = await openSession(dir, target);
        let obs = await s.observe();
        steps.push(canonical(obs));
        violation = brokenInvariant(obs, job.always, []);
        for (const [i, a] of job.actions.entries()) {
          const r = resolve(obs, a);
          if ("unavailable" in r) {
            steps.push("-");
            continue;
          }
          for (const w of r.wires) await s.send(w);
          obs = await s.observe();
          steps.push(canonical(obs));
          violation ??= brokenInvariant(obs, job.always, job.actions.slice(0, i + 1));
        }
      } catch (e) {
        error = `crashed: ${(e as Error).message}`;
      }
      out.push({ steps, violation, error });
    }
  }
  return out;
}

/** Run jobs in a child process with a timeout, so an infinite loop in generated code cannot hang the harness. */
export async function runJobsIsolated(dir: string, target: string, jobs: Job[] | import("./api.ts").ApiJob[], timeoutMs = 120_000): Promise<(ExampleResult | TraceResult | ExploreResult)[] | { error: string }> {
  const jobFile = join(dir, `jobs-${process.pid}-${Math.random().toString(36).slice(2)}.json`);
  writeFileSync(jobFile, JSON.stringify(jobs));
  const r = await run(process.execPath, [new URL(import.meta.url).pathname, dir, target, jobFile], { timeoutMs });
  if (!r.ok) return { error: r.timedOut ? `timed out after ${timeoutMs / 1000}s (infinite loop?)` : `crashed: ${r.stderr.slice(0, 2000)}` };
  const out = JSON.parse(readFileSync(jobFile + ".out", "utf8"));
  rmSync(jobFile);
  rmSync(jobFile + ".out");
  return out;
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  const [dir, target, jobFile] = process.argv.slice(2);
  const jobs: Job[] = JSON.parse(readFileSync(jobFile, "utf8"));
  // api-profile jobs go to the api driver.
  const res = (jobs[0] as { kind: string } | undefined)?.kind?.startsWith("api-") ? await (await import("./api.ts")).runApiJobs(dir, jobs as never) : await runJobs(dir, target, jobs);
  writeFileSync(jobFile + ".out", JSON.stringify(res));
}
