// The test driver's side of draws (v69): every event gets a seed from the run (an example's name, a
// random session's seed) and its number, so an unsteered draw is the same in every build and every
// run, and adding an example changes no other. `steer random …` queues values per type (a shuffle's
// order, a pick): the next draw of that type takes the head. A random session may hand out an edge
// value now and then (a range's bounds, the alphabet's first and last character, a value already
// drawn for `not among`, a kept or reversed order). Every value drawn is heard, so a session can be
// written down as steps to paste (`steer random PickupCode = "308122"`).
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import type { App, Literal } from "./ast.ts";
import { buildSites, type Space } from "./draws.ts";
import { eventSeed, runBase, type Steer } from "../runtime/ts/draw.ts";

/** A draw site as the build lists it (draws.json): what a steered value for it is. */
export type SiteDesc = { form: "one" | "notAmong" | "many" | "pick" | "shuffle"; type?: string; space?: Space; at: number };

/** The sites of an app, for its build's draws.json. */
export const drawTable = (app: App): Record<string, SiteDesc> => Object.fromEntries(buildSites(app).map((s, at) => [s.id, { form: s.form, ...(s.type ? { type: s.type } : {}), ...(s.space ? { space: s.space } : {}), at }]));

/** The sites of a build (none when it draws nothing). */
export const loadDrawTable = (dir: string): Record<string, SiteDesc> => (existsSync(join(dir, "draws.json")) ? JSON.parse(readFileSync(join(dir, "draws.json"), "utf8")) : {});

/** What a steered value is for: a type's name, or `shuffle` / `pick`. */
const queueOf = (d: SiteDesc | undefined) => (!d ? "" : d.form === "shuffle" ? "shuffle" : d.form === "pick" ? "pick" : (d.type ?? ""));

/** A value drawn, as a step writes it: `"308122"` for a code, `6` for a number, `Spades` for a choice value. */
export function literalOf(what: string, value: string, sites: Record<string, SiteDesc>): string {
  const sp = Object.values(sites).find((d) => d.type === what)?.space;
  return sp?.k === "text" ? JSON.stringify(value) : value;
}

/** A `steer random` step's values in their canonical text (a code's characters, a number's digits, a value's name). */
export const canonicalValues = (values: Literal[]): string[] => values.map((v) => (v.k === "text" ? v.v : v.k === "number" ? v.raw : v.k === "value" ? v.v : String((v as { v?: unknown }).v)));

/** Split `"308122", "555001"` (a random action's value) back into canonical values. */
export function splitLiterals(text: string): string[] {
  return (text.match(/"(?:[^"\\]|\\.)*"|[^,\s][^,]*/g) ?? []).map((x) => x.trim()).map((x) => (x.startsWith('"') ? JSON.parse(x) : x));
}

export interface Heard {
  what: string; // the type, or shuffle / pick
  value: string; // canonical
  steered: boolean; // it came from a `steer random` step (so it is written down already)
}

export interface Drawer {
  /** The draw source of the next event. */
  next(): { seed: string; steer: Steer };
  /** `steer random …`: queue values (canonical) for a type, `shuffle` or `pick`; `line` is the step's. */
  steer(what: string, values: string[], line?: number): void;
  /** Steered values still queued: an example fails on them (the draw did not happen where it expected). */
  pending(): { what: string; value: string; line?: number }[];
  /** The draws heard since the last time this was asked, in order. */
  heard(): Heard[];
}

/**
 * A drawer for one run. `name`: the run's seed (an example's name, `session:<seed>`); `edges`: a
 * random session's generator, which hands out an edge value for about one draw in five.
 */
export function drawer(sites: Record<string, SiteDesc>, name: string, edges?: () => number): Drawer {
  const base = runBase(name);
  let event = 0;
  const queues = new Map<string, { value: string; line?: number }[]>();
  let log: Heard[] = [];
  const history = new Map<string, string[]>(); // per type: every value drawn so far (for `not among` edges)
  // Values an event's plan gave to places its draws did not reach: back to the front of their queues.
  let planned = new Map<string, { what: string; value: string; line?: number }>();
  const settle = () => {
    for (const p of [...planned.values()].reverse()) queues.set(p.what, [{ value: p.value, line: p.line }, ...(queues.get(p.what) ?? [])]);
    planned = new Map();
  };
  const order = (key: string) => {
    const [site, row, index] = key.split("|");
    return [sites[site]?.at ?? Infinity, Number(row), Number(index)];
  };
  return {
    next() {
      settle();
      const seed = eventSeed(base, ++event);
      const memo = new Map<string, string | null>(); // one answer per place in this event
      const given = new Set<string>();
      const heardHere = new Set<string>();
      const steer: Steer = {
        take(key, n) {
          if (memo.has(key)) return memo.get(key)!;
          const d = sites[key.split("|")[0]];
          const q = queues.get(queueOf(d));
          const p = planned.get(key);
          if (p) planned.delete(key);
          let v: string | null = p ? p.value : q?.length ? q.shift()!.value : null;
          if (v !== null) given.add(key); // steered by a step: already written down
          else if (edges && d && edges() < 0.2) v = edge(d, n, history.get(d.type ?? "") ?? [], edges); // an edge: written down when heard
          memo.set(key, v);
          return v;
        },
        drawn(key, value) {
          if (heardHere.has(key)) return;
          heardHere.add(key);
          const d = sites[key.split("|")[0]];
          const what = queueOf(d);
          if (!what) return;
          log.push({ what, value, steered: given.has(key) });
          if (d?.type) history.set(d.type, [...(history.get(d.type) ?? []), value]);
        },
      };
      // With values queued, the entry runs the event once to see which draws it makes (\`plan\`), and
      // the values go to them in the spec's order (site, row, index), not the order a build evaluates.
      if ([...queues.values()].some((q) => q.length))
        steer.plan = (asked) => {
          const keys = [...new Set(asked.map(([k]) => k))].sort((a, b) => {
            const [x, y] = [order(a), order(b)];
            return x[0] - y[0] || x[1] - y[1] || x[2] - y[2];
          });
          for (const k of keys) {
            const what = queueOf(sites[k.split("|")[0]]);
            const q = queues.get(what);
            if (q?.length) planned.set(k, { what, ...q.shift()! });
          }
        };
      return { seed, steer };
    },
    steer(what, values, line) {
      queues.set(what, [...(queues.get(what) ?? []), ...values.map((value) => ({ value, line }))]);
    },
    pending() {
      settle();
      return [...queues].flatMap(([what, q]) => q.map((x) => ({ what, ...x })));
    },
    heard() {
      const out = log;
      log = [];
      return out;
    },
  };
}

/** An edge value of a site: a range's bounds, the alphabet's first or last character, a choice's first or last value, a value drawn before (for `not among`), a kept or reversed order, the first or last item. */
function edge(d: SiteDesc, n: number, drawn: string[], rnd: () => number): string | null {
  const either = <T,>(a: T, b: T) => (rnd() < 0.5 ? a : b);
  if (d.form === "shuffle") return either("keep", "reverse");
  if (d.form === "pick") return n ? either("1", String(n)) : null;
  if (d.form === "notAmong" && drawn.length && rnd() < 0.5) return drawn[Math.floor(rnd() * drawn.length)]; // taken: the rejection runs
  const sp = d.space;
  if (!sp) return null;
  if (sp.k === "int") return String(either(sp.lo, sp.hi));
  if (sp.k === "names") return either(sp.values[0], sp.values[sp.values.length - 1]);
  const cs = [...sp.chars];
  return either(cs[0], cs[cs.length - 1]).repeat(sp.n);
}

/** The simplest value of a site (shrinking): the lowest number, the first choice value, the alphabet's first character, the order kept, the first item. */
export function simplest(what: string, sites: Record<string, SiteDesc>): string | undefined {
  if (what === "shuffle") return "keep";
  if (what === "pick") return "1";
  const sp = Object.values(sites).find((d) => d.type === what)?.space;
  if (!sp) return undefined;
  return sp.k === "int" ? String(sp.lo) : sp.k === "names" ? sp.values[0] : [...sp.chars][0].repeat(sp.n);
}

/** The steps that steer what was heard (unsteered draws only), grouped by type in the order drawn. */
export function steerSteps(heard: Heard[]): { what: string; values: string[] }[] {
  const out: { what: string; values: string[] }[] = [];
  for (const h of heard.filter((x) => !x.steered)) {
    if (h.what === "shuffle" && h.value === "random") continue; // a random order cannot be steered: shrinking tries "keeps order"
    const last = out.find((o) => o.what === h.what);
    if (last && h.what !== "shuffle" && h.what !== "pick") last.values.push(h.value);
    else out.push({ what: h.what, values: [h.value] });
  }
  return out;
}

/**
 * A failing session with every steered draw at its simplest value (QuickCheck's shrinking, on the
 * choices): the lowest number, the first choice value, a code of the alphabet's first character, the
 * order kept, the first item. Undefined when nothing would change. Works on screen actions (`on:
 * "random"`) and api calls (`(random)`).
 */
export function simplerDraws<A>(actions: A[], sites: Record<string, SiteDesc>): A[] | undefined {
  let changed = false;
  const simpler = (what: string, value: string): string => {
    const s = simplest(what, sites);
    if (s === undefined) return value;
    const out = what === "shuffle" || what === "pick" ? s : splitLiterals(value).map(() => literalOf(what, s, sites)).join(", ");
    if (out !== value) changed = true;
    return out;
  };
  const next = actions.map((a) => {
    const x = a as { on?: string; target?: string; value?: string; endpoint?: string; args?: Record<string, unknown> };
    if (x.on === "random") return { ...x, value: simpler(x.target!, x.value ?? "") } as A;
    if (x.endpoint === "(random)") return { ...x, args: { ...x.args, value: simpler(String(x.args?.what), String(x.args?.value)) } } as A;
    return a;
  });
  return changed ? next : undefined;
}
