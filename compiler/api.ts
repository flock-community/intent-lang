// The api profile's test driver: examples and random requests against an api build, with the
// clock, restarts and the checks in `always`. Observations are responses: { endpoint, status,
// body } after every call. What a build is made of comes from its target (targets/ts-service.ts).
import { difference } from "./diff.ts";
import { copyFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import type { Endpoint } from "./ast.ts";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { LINE_BASE, type App, type Check, type Example, type Literal, type Step, type Type } from "./ast.ts";
import { ROOT, dataField, hasData, tsData, tsDomain, tsStoredFields, tsType } from "./gen.ts";
import { usesClock, usesToken } from "./refs.ts";
import { toHttp } from "../runtime/ts/calls.ts";
import { LAYER_FILES, layerConfig, requestOf } from "./layer.ts";
import { addMinutes } from "../runtime/ts/fmt.ts";
import { clockAt } from "../runtime/ts/clock.ts";

export { genApiSpec, genClient, scaffoldApi, specLine, typeDesc, API_APP_SKELETON, API_TARGET_RULES } from "./targets/ts-service.ts";

// ---------------------------------------------------------------- driving a build

/** A call as data: the endpoint and its argument values (JSON). */
export interface Call {
  endpoint: string;
  args: Record<string, unknown>;
  headers?: Record<string, string>;
}

export type ApiJob = { kind: "api-example"; example: Example; always?: Step[] } | { kind: "api-trace"; calls: Call[]; always?: Step[] };

interface EpDesc {
  name: string;
  method: string;
  path: string;
  params: { in: string; name: string }[];
  external?: boolean; // \`effect external\`: needs an idempotency key
}

export function literalJson(l: Literal): unknown {
  switch (l.k) {
    case "text": return l.v;
    case "number": return l.v;
    case "bool": return l.v;
    case "nothing": return null;
    case "emptyList": return [];
    case "value": return l.v;
    case "date": return l.v;
    case "dateTime": return l.v;
    case "list": return l.items.map(literalJson);
    case "record": return Object.fromEntries(l.fields.map((f) => [f.name, literalJson(f.value)]));
    default: return null;
  }
}

export type Responses = Map<string, { status: number; body: unknown; headers?: Record<string, string> }>;

/** Follow a response path: `createTicket.body.items[2].id` (lists count from 1). */
function atPath(responses: Responses, target: string): { found: boolean; value?: unknown } {
  // A header: \`createTicket.header.vary\` (header names have dashes, so they are not a path).
  const hm = target.match(/^(\w+)\.header\.([a-z0-9-]+)$/i);
  if (hm) {
    const v = responses.get(hm[1])?.headers?.[hm[2].toLowerCase()];
    return v === undefined ? { found: false } : { found: true, value: v };
  }
  const parts = target.match(/[a-z]\w*|\[\d+\]/gi) ?? [];
  const r = parts.length ? responses.get(parts[0] as string) : undefined;
  if (!r) return { found: false };
  let v: unknown = r;
  for (const p of parts.slice(1)) {
    if (v === null || v === undefined) return { found: false };
    const idx = p.match(/^\[(\d+)\]$/);
    if (idx) v = Array.isArray(v) ? v[Number(idx[1]) - 1] : undefined;
    else v = (v as Record<string, unknown>)[p];
    if (v === undefined) return { found: false };
  }
  return { found: true, value: v };
}

const shown = (v: unknown) => (typeof v === "string" ? v : v === null ? "nothing" : typeof v === "object" ? JSON.stringify(v) : String(v));

function checkValue(v: unknown, c: Check, what: string): string | undefined {
  switch (c.is) {
    case "eq": return shown(v) === c.value ? undefined : `expected ${what} = ${JSON.stringify(c.value)}, got ${JSON.stringify(shown(v))}`;
    case "rows": {
      if (!Array.isArray(v)) return `${what} is not a list`;
      const ok = c.cmp === "atMost" ? v.length <= c.count : c.cmp === "atLeast" ? v.length >= c.count : v.length === c.count;
      return ok ? undefined : `expected ${c.cmp === "atMost" ? "at most " : c.cmp === "atLeast" ? "at least " : ""}${c.count} rows in ${what}, got ${v.length}`;
    }
    case "num": {
      const x = typeof v === "number" ? v : Number(String(v).match(/-?\d+(\.\d+)?/)?.[0]);
      const y = c.value!;
      const ok = c.op === "atLeast" ? x >= y : c.op === "atMost" ? x <= y : c.op === "above" ? x > y : x < y;
      return ok ? undefined : `expected ${what} to be ${{ atLeast: "at least", atMost: "at most", above: "above", below: "below" }[c.op]} ${y}, but it is ${x}`;
    }
    case "shown": return;
    default: return `\`is ${c.is}\` does not apply to a response`;
  }
}

/** Check a `see` step against the latest responses. Always-checks skip what has not been answered yet. */
export function checkSeeApi(responses: Responses, s: Extract<Step, { do: "see" }>, invariant = false): string | undefined {
  if (s.every) {
    const list = atPath(responses, s.every);
    if (!list.found || !Array.isArray(list.value)) return invariant ? undefined : `${s.every} is not a list`;
    for (const [i, row] of list.value.entries()) {
      const v = (row as Record<string, unknown>)?.[s.target];
      if (v === undefined) continue;
      const msg = checkValue(v, s.check, `${s.target} of row ${i + 1} of ${s.every}`);
      if (msg) return msg;
    }
    return;
  }
  const r = atPath(responses, s.target);
  if (s.check.is === "hidden") return r.found ? `expected ${s.target} to be absent` : undefined;
  if (!r.found) return invariant ? undefined : `${s.target}: no such value in the response${responses.has(s.target.split(".")[0]) ? "" : " (that endpoint was not called yet)"}`;
  return checkValue(r.value, s.check, s.target);
}

export async function runApiJobs(dir: string, jobs: ApiJob[]): Promise<unknown[]> {
  const mod = await import(pathToFileURL(join(dir, "test.mjs")).href + `?t=${Date.now()}`);
  const eps: EpDesc[] = JSON.parse(readFileSync(join(dir, "endpoints.json"), "utf8"));
  // Apis that read the clock: it starts at `examples start at` and moves with `wait`; recurring work
  // runs at start + k × its interval, in time order (ties: declaration order), when a wait passes it.
  const clockSpec: { start: string; jobs: { name: string; every: number }[] } | undefined = existsSync(join(dir, "clock.json")) ? JSON.parse(readFileSync(join(dir, "clock.json"), "utf8")) : undefined;
  const inv = existsSync(join(dir, "invariants.mjs"))
    ? { checks: (await import(pathToFileURL(join(dir, "invariants.mjs")).href + `?t=${Date.now()}`)).invariants as { line: number; holds: (d: unknown, c: unknown) => boolean }[], texts: JSON.parse(readFileSync(join(dir, "invariants.json"), "utf8")) as { text: string }[] }
    : undefined;
  // Stored state: a restart keeps these fields of the data, and they must come back unchanged.
  const stored: { field: string; line: number }[] = existsSync(join(dir, "stored.json")) ? JSON.parse(readFileSync(join(dir, "stored.json"), "utf8")) : [];
  const out: unknown[] = [];
  for (const job of jobs) {
    const client = mod.start();
    const restart = (): { line: number; message: string } | undefined => {
      const pick = (d: any) => Object.fromEntries(stored.map((s) => [s.field, d?.[s.field]]));
      const saved = pick(client.data?.());
      client.restart(saved);
      const back = pick(client.data?.());
      const wrong = stored.find((s) => JSON.stringify(saved[s.field]) !== JSON.stringify(back[s.field]));
      if (wrong) return { line: wrong.line, message: `after a restart, stored \`${wrong.field}\` (line ${wrong.line}) did not come back as it was saved: ${difference(saved[wrong.field], back[wrong.field])}` };
    };
    let elapsed = 0;
    const clockAtMs = (ms: number) => (clockSpec ? clockAt(addMinutes(clockSpec.start, Math.floor(ms / 60000))) : undefined);
    const wait = (ms: number) => {
      const fires: { at: number; order: number; name: string }[] = [];
      (clockSpec?.jobs ?? []).forEach((j, order) => {
        for (let at = (Math.floor(elapsed / j.every) + 1) * j.every; at <= elapsed + ms; at += j.every) fires.push({ at, order, name: j.name });
      });
      fires.sort((a, b) => a.at - b.at || a.order - b.order);
      const published: { event: string; body: unknown }[] = [];
      for (const f of fires) published.push(...client.runJob(f.name, clockAtMs(f.at)));
      elapsed += ms;
      return published;
    };
    const responses: Responses = new Map();
    // Events as the latest call published them: \`see ticketCreated.body…\`; a call that publishes none clears them.
    let published: string[] = [];
    const record = (res: { events?: { event: string; body: unknown }[] }) => {
      for (const e of published) responses.delete(e);
      published = [];
      for (const ev of res.events ?? []) {
        responses.set(ev.event, { status: 0, body: ev.body });
        published.push(ev.event);
      }
    };
    // Like a real client, the driver gives every call to an \`effect external\` endpoint its own
    // idempotency key, unless the example sends one itself.
    let made = 0;
    const call = (c: Call) => {
      const h = toHttp(eps, c);
      const external = eps.find((e) => e.name === c.endpoint)?.external;
      const headers = external && !Object.keys(c.headers ?? {}).some((k) => k.toLowerCase() === "idempotency-key") ? { ...c.headers, "idempotency-key": `call-${++made}` } : (c.headers ?? {});
      const res = client.send(h.method, h.path, h.query, h.body, headers, clockAtMs(elapsed));
      responses.set(c.endpoint, res);
      record(res);
      return res;
    };
    const broken = (always?: Step[]) => {
      // Sentences in `always` over the api's data.
      if (inv) {
        const data = client.data?.();
        const clock = clockAtMs(elapsed) ?? clockAt("2026-01-05T09:00");
        for (const [i, check] of inv.checks.entries()) {
          let holds: boolean;
          try {
            holds = !!check.holds(data, clock);
          } catch {
            holds = false;
          }
          if (!holds) return { line: check.line, message: `"${inv.texts[i].text}" does not hold; the data: ${JSON.stringify(data).slice(0, 1500)}` };
        }
      }
      for (const s of always ?? []) if (s.do === "see") {
        const msg = checkSeeApi(responses, s, true);
        if (msg) return { line: s.line, message: msg };
      }
    };
    try {
      if (job.kind === "api-example") {
        let failure: { line: number; message: string; screen: string } | undefined;
        for (const s of job.example.steps) {
          if (s.do === "call") {
            // An argument may use a value from an earlier answer: `id = {createTicket.body.id}`.
            const args: Record<string, unknown> = {};
            for (const a of s.args) {
              if (a.value.k === "text" && /^\{[a-z][\w.[\]]*\}$/i.test(a.value.v)) {
                const ref = atPath(responses, a.value.v.slice(1, -1));
                if (!ref.found) {
                  failure = { line: s.line, message: `${a.value.v}: no such value in an earlier answer`, screen: dump(responses) };
                  break;
                }
                args[a.name] = ref.value;
              } else args[a.name] = literalJson(a.value);
            }
            if (failure) break;
            const headers = Object.fromEntries((s.headers ?? []).map((h) => [h.name, String(literalJson(h.value))]));
            const res = call({ endpoint: s.endpoint, args, headers });
            if (res.contractError) {
              failure = { line: s.line, message: `the answer breaks the contract: ${res.contractError}`, screen: dump(responses) };
              break;
            }
            const v = broken(job.always);
            if (v) (failure = { line: s.line, message: `after this call, \`always\` (line ${v.line}) is broken: ${v.message}`, screen: dump(responses) }), true;
            if (failure) break;
          } else if (s.do === "tick" && s.ms) {
            // Time passes: recurring work that falls in it runs; what it publishes is what this step published.
            record({ events: wait(s.ms) });
            const v = broken(job.always);
            if (v) {
              failure = { line: s.line, message: `after this wait, \`always\` (line ${v.line}) is broken: ${v.message}`, screen: dump(responses) };
              break;
            }
          } else if (s.do === "restart") {
            const lost = restart();
            const v = lost ? undefined : broken(job.always);
            if (lost || v) {
              failure = { line: s.line, message: lost ? lost.message : `after this restart, \`always\` (line ${v!.line}) is broken: ${v!.message}`, screen: dump(responses) };
              break;
            }
          } else if (s.do === "request") {
            // A raw request, through the layers and the router: its answer is \`request.…\`.
            const r = requestOf(s);
            const res = client.send(r.method, r.path, r.query, r.body, r.headers, clockAtMs(elapsed));
            responses.set("request", res);
            record(res);
          } else if (s.do === "see") {
            const msg = checkSeeApi(responses, s);
            if (msg) {
              failure = { line: s.line, message: msg, screen: dump(responses) };
              break;
            }
          }
        }
        out.push({ name: job.example.name, pass: !failure, failure });
      } else {
        const steps: string[] = [];
        let violation: { line: number; message: string; actions: Call[]; screen: string } | undefined;
        for (const [i, c] of job.calls.entries()) {
          if (c.endpoint === "(restart)") {
            steps.push(JSON.stringify({ restart: true }));
            const v = restart() ?? broken(job.always);
            if (v && !violation) violation = { ...v, actions: job.calls.slice(0, i + 1), screen: dump(responses) };
            continue;
          }
          if (c.endpoint === "(wait)") {
            steps.push(JSON.stringify({ wait: c.args.ms, events: wait(c.args.ms as number) }));
            const v = broken(job.always);
            if (v && !violation) violation = { ...v, actions: job.calls.slice(0, i + 1), screen: dump(responses) };
            continue;
          }
          const res = call(c);
          steps.push(JSON.stringify({ endpoint: c.endpoint, status: res.status, body: res.body, headers: Object.fromEntries(Object.entries(res.headers ?? {}).sort()), events: res.events ?? [] }));
          const v = res.contractError ? { line: 0, message: `the answer breaks the contract: ${res.contractError}` } : broken(job.always);
          if (v && !violation) violation = { ...v, actions: job.calls.slice(0, i + 1), screen: dump(responses) };
        }
        out.push({ steps, violation });
      }
    } catch (e) {
      out.push(job.kind === "api-example" ? { name: job.example.name, pass: false, failure: { line: job.example.line, message: `crashed: ${(e as Error).message}`, screen: dump(responses) } } : { steps: [], error: `crashed: ${(e as Error).message}` });
    }
  }
  return out;
}

/** The latest responses, readable: for repair prompts and reports. */
function dump(responses: Responses): string {
  return [...responses].map(([ep, r]) => r.status === 0 ? `${ep} published ${JSON.stringify(r.body)}` : `${ep} → ${r.status}${(r as { source?: string }).source ? ` (from ${(r as { source?: string }).source})` : ""} ${JSON.stringify(r.body)}${r.headers && Object.keys(r.headers).length ? `  headers ${JSON.stringify(r.headers)}` : ""}`).join("\n");
}

// ---------------------------------------------------------------- random sessions

function mulberry32(seed: number) {
  return () => {
    seed |= 0;
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const TEXTS = ["", "   ", "Printer on fire", "  padded  ", "don't stop", "Café", "a", "ALL CAPS", "x@y.z"];

/** Random call sequences, from the spec alone: values drawn per param type, sometimes left out. */
export function apiTraces(app: App, count: number, length: number, seed = 7): Call[][] {
  const rnd = mulberry32(seed);
  const pick = <T,>(xs: T[]) => xs[Math.floor(rnd() * xs.length)];
  const exampleValues = new Map<string, unknown[]>();
  const headerValues = new Map<string, string[]>();
  for (const ex of app.examples)
    for (const s of ex.steps)
      if (s.do === "call") {
        for (const a of s.args) exampleValues.set(a.name, [...(exampleValues.get(a.name) ?? []), literalJson(a.value)]);
        for (const h of s.headers ?? []) headerValues.set(h.name, [...(headerValues.get(h.name) ?? []), String(literalJson(h.value))]);
      }
  const valueFor = (name: string, t: Type): unknown => {
    const own = exampleValues.get(name) ?? [];
    if (own.length && rnd() < 0.5) return pick(own);
    if (t.k === "Maybe") return rnd() < 0.4 ? null : valueFor(name, t.of);
    if (t.k === "Int") return pick([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 99, 0, -1]);
    if (t.k === "Decimal") return pick([0, 1.5, 10, -2, 99.99]);
    if (t.k === "Bool") return rnd() < 0.5;
    if (t.k === "Text") return pick(TEXTS);
    if (t.k === "Named") {
      const c = app.choices.find((x) => x.name === t.name);
      if (c) return rnd() < 0.9 ? pick(c.values) : "Unknown";
    }
    return null;
  };
  const eps = app.endpoints ?? [];
  const traces: Call[][] = [];
  const waits = usesClock(app) ? [...new Set([...app.examples.flatMap((e) => e.steps).flatMap((s) => (s.do === "tick" && s.ms ? [s.ms] : [])), 60000, 15 * 60000, 3600000, 86400000])] : [];
  for (let i = 0; i < count; i++) {
    const calls: Call[] = [];
    for (let j = 0; j < length; j++) {
      if (waits.length && rnd() < 0.15) {
        calls.push({ endpoint: "(wait)", args: { ms: pick(waits) } });
        continue;
      }
      if (app.state.some((f) => f.stored) && rnd() < 0.08) {
        calls.push({ endpoint: "(restart)", args: {} });
        continue;
      }
      // A request delivered twice: the last keyed call again, with its key (the service must recognise it).
      const last = [...calls].reverse().find((c) => c.headers?.["idempotency-key"]);
      if (last && rnd() < 0.1) {
        calls.push(JSON.parse(JSON.stringify(last)));
        continue;
      }
      const ep = pick(eps);
      const args: Record<string, unknown> = {};
      for (const p of ep.params) if (rnd() > 0.05) args[p.name] = valueFor(p.name, p.type);
      // Headers the examples send (an API key, an origin): mostly one of theirs, sometimes none or another.
      const headers: Record<string, string> = {};
      for (const [h, vs] of headerValues) if (rnd() < 0.85) headers[h] = rnd() < 0.9 ? pick(vs) : pick(TEXTS);
      // Every non-safe call carries its own key, as the runtime's clients send it.
      if (ep.method !== "GET") headers["idempotency-key"] = `r${i}-${j}`;
      calls.push({ endpoint: ep.name, args, ...(Object.keys(headers).length ? { headers } : {}) });
    }
    traces.push(calls);
  }
  return traces;
}

export const callText = (c: Call) => {
  if (c.endpoint === "(wait)") return `wait ${Number(c.args.ms) / 60000}m`;
  if (c.endpoint === "(restart)") return "restart";
  const args = [...Object.entries(c.headers ?? {}).map(([k, v]) => `header ${k} = ${JSON.stringify(v)}`), ...Object.entries(c.args).map(([k, v]) => `${k} = ${JSON.stringify(v)}`)];
  return `call ${c.endpoint}${args.length ? ` with ${args.join(", ")}` : ""}`;
};

