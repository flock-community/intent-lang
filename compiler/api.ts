// The api profile's harness (TypeScript/Node): generated types and endpoint descriptions, a fixed
// router with validation, a server, and a test driver. The LLM writes only `init` and `handle`.
// Observations are responses: { endpoint, status, body } after every call.
import { copyFileSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import type { App, Check, Example, Literal, Step, Type } from "./ast.ts";
import { ROOT, tsDomain, tsType } from "./gen.ts";

const cap = (s: string) => s[0].toUpperCase() + s.slice(1);
const q = (s: string) => JSON.stringify(s);

// ---------------------------------------------------------------- generated interface

function typeDesc(app: App, t: Type): string {
  switch (t.k) {
    case "Text": case "Int": case "Decimal": case "Bool": return `{ k: ${q(t.k)} }`;
    case "List": return `{ k: "List", of: ${typeDesc(app, t.of)} }`;
    case "Maybe": return `{ k: "Maybe", of: ${typeDesc(app, t.of)} }`;
    case "Named": {
      const c = app.choices.find((x) => x.name === t.name);
      if (c) return `{ k: "Choice", name: ${q(c.name)}, values: ${JSON.stringify(c.values)} }`;
      const r = app.records.find((x) => x.name === t.name)!;
      return `{ k: "Record", name: ${q(r.name)}, fields: [${r.fields.map((f) => `{ name: ${q(f.name)}, type: ${typeDesc(app, f.type)} }`).join(", ")}] }`;
    }
  }
}

export function genApiSpec(app: App): string {
  const eps = app.endpoints ?? [];
  return `// Generated from ${app.name}.intent — do not edit. The interface the app module must satisfy.
import type { EndpointDesc, Response } from "./api.ts";
export type { Response } from "./api.ts";

${tsDomain(app)}/** One variant per endpoint, with its validated input (path, query and body params together). */
export type Request =
${eps.map((e) => `  | { endpoint: ${q(e.name)}${e.params.map((p) => `; ${p.name}: ${tsType(p.type)}`).join("")} }`).join("\n")};

${eps.map((e) => `/** ${e.method} ${e.path}${e.returns ? ` → ${tsType(e.returns)}` : ""} */\nexport type ${cap(e.name)}Request = Extract<Request, { endpoint: ${q(e.name)} }>;`).join("\n")}

/** The endpoints, for the router: methods, paths and parameter types. */
export const endpoints: EndpointDesc[] = [
${eps.map((e) => `  { name: ${q(e.name)}, method: ${q(e.method)}, path: ${q(e.path)}, params: [${e.params.map((p) => `{ in: ${q(p.in)}, name: ${q(p.name)}, type: ${typeDesc(app, p.type)} }`).join(", ")}] },`).join("\n")}
];

export type Handled = { model: unknown; response: Response };
`;
}

export const API_APP_SKELETON = `import type { Request, Response /* , Ticket, … */ } from "./spec.ts";
import { answer, fail } from "./api.ts";
import * as Fmt from "./fmt.ts";

export type Model = { /* … */ };

export function init(): Model { /* … */ }

export function handle(req: Request, model: Model): { model: Model; response: Response } {
  switch (req.endpoint) { /* … */ }
}
`;

const SERVER = `import { createServer } from "node:http";
import * as App from "./app.ts";
import { route } from "./api.ts";
import { endpoints } from "./spec.ts";

let model = App.init();
createServer((req, res) => {
  let raw = "";
  req.on("data", (c) => (raw += c));
  req.on("end", () => {
    const url = new URL(req.url ?? "/", "http://localhost");
    let body: unknown = undefined;
    try {
      body = raw ? JSON.parse(raw) : undefined;
    } catch {
      body = null;
    }
    const r = route(endpoints, req.method ?? "GET", url.pathname, Object.fromEntries(url.searchParams), body);
    let response;
    if ("response" in r) response = r.response;
    else ({ model, response } = App.handle(r.request as never, model));
    res.writeHead(response.status, { "content-type": "application/json" });
    res.end(JSON.stringify(response.body));
  });
}).listen(Number(process.env.PORT ?? 3000), () => console.log("listening on " + (process.env.PORT ?? 3000)));
`;

const TEST_ENTRY = `import * as App from "./app.ts";
import { route } from "./api.ts";
import { endpoints } from "./spec.ts";

/** A client for tests: the same routing and validation as the server, without the network. */
export function start() {
  let model = App.init();
  return {
    send(method: string, path: string, query: Record<string, string>, body: unknown) {
      const r = route(endpoints, method, path, query, body === undefined ? undefined : JSON.parse(JSON.stringify(body)));
      if ("response" in r) return r.response;
      const out = App.handle(r.request as never, model);
      model = out.model;
      return JSON.parse(JSON.stringify(out.response));
    },
  };
}
`;

export function scaffoldApi(app: App, dir: string): { appFile: string; specSource: string } {
  mkdirSync(dir, { recursive: true });
  copyFileSync(join(ROOT, "runtime/ts/api.ts"), join(dir, "api.ts"));
  copyFileSync(join(ROOT, "runtime/ts/fmt.ts"), join(dir, "fmt.ts"));
  const spec = genApiSpec(app);
  writeFileSync(join(dir, "spec.ts"), spec);
  writeFileSync(join(dir, "server.ts"), SERVER);
  writeFileSync(join(dir, "test-entry.ts"), TEST_ENTRY);
  writeFileSync(
    join(dir, "tsconfig.json"),
    JSON.stringify({ compilerOptions: { strict: true, noEmit: true, target: "es2022", module: "esnext", moduleResolution: "bundler", allowImportingTsExtensions: true, lib: ["es2022"], types: ["node"], skipLibCheck: true }, include: ["*.ts"] }, null, 2),
  );
  writeFileSync(join(dir, "README.md"), `# ${app.name}\n\nRun: \`node server.mjs\` (PORT, default 3000).\n\n${(app.endpoints ?? []).map((e) => `- ${e.method} ${e.path}`).join("\n")}\n`);
  return { appFile: join(dir, "app.ts"), specSource: spec };
}

export const API_TARGET_RULES = `Target: TypeScript (strict mode), a pure HTTP handler. You write \`app.ts\`.
- The harness already routes requests and validates their input: \`handle\` only receives valid requests (the \`Request\` union in spec.ts). Unknown routes and bad input never reach you.
- Answer with \`answer(status, body)\` or \`fail(status, message)\` from "./api.ts". A body is records, lists of records, or plain values, exactly as the endpoint \`returns\`. "answer 404 \\"No such ticket\\"" means \`fail(404, "No such ticket")\`.
- Available: the standard library, "./spec.ts", "./api.ts" and "./fmt.ts". No I/O, no timers, no randomness, no Date. Import with explicit extensions.
- Model is immutable: return a new model from handle. Handle every endpoint in the switch.
- The module must export exactly Model, init, handle with these signatures:`;

// ---------------------------------------------------------------- driving a build

/** A call as data: the endpoint and its argument values (JSON). */
export interface Call {
  endpoint: string;
  args: Record<string, unknown>;
}

export type ApiJob = { kind: "api-example"; example: Example; always?: Step[] } | { kind: "api-trace"; calls: Call[]; always?: Step[] };

interface EpDesc {
  name: string;
  method: string;
  path: string;
  params: { in: string; name: string }[];
}

export function literalJson(l: Literal): unknown {
  switch (l.k) {
    case "text": return l.v;
    case "number": return l.v;
    case "bool": return l.v;
    case "nothing": return null;
    case "emptyList": return [];
    case "value": return l.v;
    default: return null;
  }
}

/** Turn a call into method, path, query and body, the way a client would send it. */
function toHttp(eps: EpDesc[], c: Call) {
  const ep = eps.find((e) => e.name === c.endpoint)!;
  let path = ep.path;
  const query: Record<string, string> = {};
  const body: Record<string, unknown> = {};
  let hasBody = false;
  for (const p of ep.params) {
    if (!(p.name in c.args)) continue;
    const v = c.args[p.name];
    if (p.in === "path") path = path.replace(`{${p.name}}`, encodeURIComponent(String(v)));
    else if (p.in === "query") {
      if (v !== null) query[p.name] = String(v);
    } else (body[p.name] = v), (hasBody = true);
  }
  // A path param that was not given stays literally "{id}" and does not match a number: like a client that forgot it.
  return { method: ep.method, path, query, body: hasBody || ep.params.some((p) => p.in === "body") ? body : undefined };
}

type Responses = Map<string, { status: number; body: unknown }>;

/** Follow a response path: `createTicket.body.items[2].id` (lists count from 1). */
function atPath(responses: Responses, target: string): { found: boolean; value?: unknown } {
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
function checkSeeApi(responses: Responses, s: Extract<Step, { do: "see" }>, invariant = false): string | undefined {
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
  const out: unknown[] = [];
  for (const job of jobs) {
    const client = mod.start();
    const responses: Responses = new Map();
    const call = (c: Call) => {
      const h = toHttp(eps, c);
      const res = client.send(h.method, h.path, h.query, h.body);
      responses.set(c.endpoint, res);
      return res;
    };
    const broken = (always?: Step[]) => {
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
            call({ endpoint: s.endpoint, args: Object.fromEntries(s.args.map((a) => [a.name, literalJson(a.value)])) });
            const v = broken(job.always);
            if (v) (failure = { line: s.line, message: `after this call, \`always\` (line ${v.line}) is broken: ${v.message}`, screen: dump(responses) }), true;
            if (failure) break;
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
          const res = call(c);
          steps.push(JSON.stringify({ endpoint: c.endpoint, status: res.status, body: res.body }));
          const v = broken(job.always);
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
  return [...responses].map(([ep, r]) => `${ep} → ${r.status} ${JSON.stringify(r.body)}`).join("\n");
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
  for (const ex of app.examples) for (const s of ex.steps) if (s.do === "call") for (const a of s.args) exampleValues.set(a.name, [...(exampleValues.get(a.name) ?? []), literalJson(a.value)]);
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
  for (let i = 0; i < count; i++) {
    const calls: Call[] = [];
    for (let j = 0; j < length; j++) {
      const ep = pick(eps);
      const args: Record<string, unknown> = {};
      for (const p of ep.params) if (rnd() > 0.05) args[p.name] = valueFor(p.name, p.type);
      calls.push({ endpoint: ep.name, args });
    }
    traces.push(calls);
  }
  return traces;
}

export const callText = (c: Call) => `call ${c.endpoint}${Object.keys(c.args).length ? ` with ${Object.entries(c.args).map(([k, v]) => `${k} = ${JSON.stringify(v)}`).join(", ")}` : ""}`;
