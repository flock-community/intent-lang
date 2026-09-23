// The api profile's harness (TypeScript/Node): generated types and endpoint descriptions, a fixed
// router with validation, a server, and a test driver. The LLM writes only `init` and `handle`.
// Observations are responses: { endpoint, status, body } after every call.
import { copyFileSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import type { Endpoint } from "./ast.ts";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import type { App, Check, Example, Literal, Step, Type } from "./ast.ts";
import { ROOT, tsDomain, tsType } from "./gen.ts";
import { toHttp } from "../runtime/ts/calls.ts";
import { LAYER_FILES, layerConfig, requestOf } from "./layer.ts";

const cap = (s: string) => s[0].toUpperCase() + s.slice(1);
const q = (s: string) => JSON.stringify(s);

// ---------------------------------------------------------------- generated interface

export function typeDesc(app: App, t: Type): string {
  switch (t.k) {
    case "Text": case "Int": case "Decimal": case "Bool": return `{ k: ${q(t.k)} }`;
    case "List": return `{ k: "List", of: ${typeDesc(app, t.of)} }`;
    case "Maybe": return `{ k: "Maybe", of: ${typeDesc(app, t.of)} }`;
    case "Named": {
      const rf = app.refined?.find((x) => x.name === t.name);
      if (rf) return `{ k: "Refined", name: ${q(rf.name)}, base: { k: ${q(rf.base)} }${rf.pattern !== undefined ? `, pattern: ${q(`^(?:${rf.pattern})$`)}` : ""}${rf.min !== undefined ? `, min: ${rf.min}` : ""}${rf.max !== undefined ? `, max: ${rf.max}` : ""} }`;
      const c = app.choices.find((x) => x.name === t.name);
      if (c) return `{ k: "Choice", name: ${q(c.name)}, values: ${JSON.stringify(c.values)} }`;
      const r = app.records.find((x) => x.name === t.name)!;
      return `{ k: "Record", name: ${q(r.name)}, fields: [${r.fields.map((f) => `{ name: ${q(f.name)}, type: ${typeDesc(app, f.type)} }`).join(", ")}] }`;
    }
  }
}

const typeName = (e: { name: string }) => cap(e.name);

export function genApiSpec(app: App): string {
  const eps = app.endpoints ?? [];
  // What the layers hand to every endpoint (\`provides caller: Text\` in std.http.apiKey).
  const provided = (app.layers ?? []).flatMap((l) => (l.spec?.provides ?? []).map((p) => ({ ...p, from: l.alias })));
  const respType = (e: Endpoint) =>
    e.answers?.length
      ? e.answers.map((a) => `{ status: ${a.status}; body: ${a.type ? tsType(a.type) : "null"} }`).join(" | ")
      : "Response";
  return `// Generated from ${app.name}.intent — do not edit. The interface the app module must satisfy.
import type { EndpointDesc, Response, TypeDesc } from "./api.ts";
export type { Response } from "./api.ts";

${tsDomain(app)}${provided.length ? `/** What the layers hand to every endpoint: ${provided.map((p) => `\\\`${p.name}\\\` from layer ${p.from}${p.note ? ` (${p.note})` : ""}`).join("; ")}. */\nexport type Provided = { ${provided.map((p) => `${p.name}: ${tsType(p.type)}`).join("; ")} };\n\n` : ""}/** One variant per endpoint, with its validated input (path, query and body params together)${provided.length ? ", and what the layers provide" : ""}. */
export type Request =
${eps.map((e) => `  | { endpoint: ${q(e.name)}${e.params.map((p) => `; ${p.name}: ${tsType(p.type)}`).join("")}${provided.map((p) => `; ${p.name}: ${tsType(p.type)}`).join("")} }`).join("\n")};

${eps
  .map(
    (e) => `/** ${e.method} ${e.path} */
export type ${typeName(e)}Request = Extract<Request, { endpoint: ${q(e.name)} }>;
/** What ${e.name} may answer${e.answers?.length ? " (its contract)" : ""}. */
export type ${typeName(e)}Response = ${respType(e)};`,
  )
  .join("\n\n")}

/** One handler per endpoint: the request and the model in, the new model and the answer out. */
export type Handlers<M> = {
${eps.map((e) => `  ${e.name}: (req: ${typeName(e)}Request, model: M) => { model: M; response: ${typeName(e)}Response };`).join("\n")}
};

/** The endpoints, for the router: methods, paths and parameter types. */
export const endpoints: EndpointDesc[] = [
${eps.map((e) => `  { name: ${q(e.name)}, method: ${q(e.method)}, path: ${q(e.path)}, params: [${e.params.map((p) => `{ in: ${q(p.in)}, name: ${q(p.name)}, type: ${typeDesc(app, p.type)} }`).join(", ")}] },`).join("\n")}
];

/** The contract's answers per endpoint (status → body type), checked on every answer in tests. */
export const answers: Record<string, Record<number, TypeDesc | null>> = {
${eps.filter((e) => e.answers?.length).map((e) => `  ${e.name}: { ${e.answers!.map((a) => `${a.status}: ${a.type ? typeDesc(app, a.type) : "null"}`).join(", ")} },`).join("\n")}
};
`;
}

export const API_APP_SKELETON = `import type { Handlers /* , Ticket, … */ } from "./spec.ts";
import { answer, fail } from "./api.ts";
import * as Fmt from "./fmt.ts";

export type Model = { /* … */ };

export function init(): Model { /* … */ }

export const handlers: Handlers<Model> = {
  someEndpoint: (req, model) => { /* … */ return { model, response: answer(200, …) }; },
  /* one per endpoint */
};
`;

/** One request through the layers (in order), the router and the handlers, and back out through the layers. */
const PIPELINE = `import * as App from "./app.ts";
import { route } from "./api.ts";
import { normalize, type HttpRequest, type HttpResponse } from "./http.ts";
import { endpoints } from "./spec.ts";
import { layers } from "./layers.ts";

const copy = <T,>(x: T): T => JSON.parse(JSON.stringify(x ?? null));

export type Handled = HttpResponse & { endpoint?: string; appAnswer?: { status: number; body: unknown } };

export function pipeline() {
  let model = App.init();
  return (req: HttpRequest): Handled => {
    const passed: typeof layers = [];
    const provided: Record<string, unknown> = {};
    let res: HttpResponse | undefined;
    let endpoint: string | undefined;
    let appAnswer: { status: number; body: unknown } | undefined;
    for (const l of layers) {
      passed.push(l);
      const b = l.before(copy(req), copy(l.config));
      if ("answer" in b) {
        res = normalize(b.answer);
        break;
      }
      Object.assign(provided, copy(b.pass));
    }
    if (!res) {
      const r = route(endpoints, req.method, req.path, req.query, req.body === undefined ? undefined : copy(req.body));
      if ("response" in r) res = { ...r.response, headers: {} };
      else {
        endpoint = r.request.endpoint as string;
        const out = (App.handlers as any)[endpoint]({ ...r.request, ...provided }, model);
        model = out.model;
        appAnswer = copy({ status: out.response.status, body: out.response.body });
        res = { status: out.response.status, headers: {}, body: out.response.body };
      }
    }
    for (const l of passed.reverse()) res = normalize(l.after(copy(req), copy(res), copy(l.config)));
    return { ...normalize(res), endpoint, appAnswer };
  };
}
`;

const SERVER = `import { createServer } from "node:http";
import { pipeline } from "./pipeline.ts";

const handle = pipeline();
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
    const headers: Record<string, string> = {};
    for (const [k, v] of Object.entries(req.headers)) if (typeof v === "string") headers[k.toLowerCase()] = v;
    const out = handle({ method: req.method ?? "GET", path: url.pathname, query: Object.fromEntries(url.searchParams), headers, body });
    const noBody = out.status === 204 || out.status === 304 || req.method === "HEAD";
    res.writeHead(out.status, { ...(noBody ? {} : { "content-type": "application/json" }), ...out.headers });
    res.end(noBody ? undefined : JSON.stringify(out.body));
  });
}).listen(Number(process.env.PORT ?? 3000), () => console.log("listening on " + (process.env.PORT ?? 3000)));
`;

const TEST_ENTRY = `import { conforms } from "./api.ts";
import { answers } from "./spec.ts";
import { pipeline } from "./pipeline.ts";

/** A client for tests: the same layers, routing and validation as the server, without the network. */
export function start() {
  const handle = pipeline();
  return {
    send(method: string, path: string, query: Record<string, string>, body: unknown, headers: Record<string, string> = {}) {
      const out = handle({ method, path, query, headers, body: body === undefined ? undefined : JSON.parse(JSON.stringify(body)) });
      const response = { status: out.status, body: out.body, headers: out.headers };
      // The contract is checked on every answer of the app: a status it does not declare, or a body of the wrong shape.
      const problem = out.endpoint && out.appAnswer ? conforms(answers[out.endpoint], out.appAnswer) : undefined;
      return problem ? { ...response, contractError: \`\${out.endpoint} \${problem}\` } : response;
    },
  };
}
`;

export function scaffoldApi(app: App, dir: string, layerDirs: Record<string, string> = {}): { appFile: string; specSource: string } {
  mkdirSync(dir, { recursive: true });
  copyFileSync(join(ROOT, "runtime/ts/api.ts"), join(dir, "api.ts"));
  copyFileSync(join(ROOT, "runtime/ts/http.ts"), join(dir, "http.ts"));
  // Each layer's verified module, as built once for that layer spec, and the composition with the bound config.
  for (const l of app.layers ?? []) {
    mkdirSync(join(dir, "layers", l.alias), { recursive: true });
    for (const f of LAYER_FILES) copyFileSync(join(layerDirs[l.alias], f), join(dir, "layers", l.alias, f));
  }
  writeFileSync(
    join(dir, "layers.ts"),
    `// Generated — do not edit. The layers this api runs behind, in order, with their bound params.
import type { HttpRequest, HttpResponse } from "./http.ts";
${(app.layers ?? []).map((l) => `import * as ${l.alias} from "./layers/${l.alias}/layer.ts";`).join("\n")}

export type Layer = { name: string; before: (req: HttpRequest, config: any) => { pass: Record<string, unknown> } | { answer: HttpResponse }; after: (req: HttpRequest, res: HttpResponse, config: any) => HttpResponse; config: unknown };

export const layers: Layer[] = [
${(app.layers ?? []).map((l) => `  { name: ${q(l.alias)}, before: ${l.alias}.before as Layer["before"], after: ${l.alias}.after as Layer["after"], config: ${JSON.stringify(layerConfig(l.spec!, l.bindings))} },`).join("\n")}
];
`,
  );
  writeFileSync(join(dir, "pipeline.ts"), PIPELINE);
  copyFileSync(join(ROOT, "runtime/ts/fmt.ts"), join(dir, "fmt.ts"));
  const spec = genApiSpec(app);
  writeFileSync(join(dir, "spec.ts"), spec);
  writeFileSync(join(dir, "server.ts"), SERVER);
  writeFileSync(join(dir, "test-entry.ts"), TEST_ENTRY);
  writeFileSync(
    join(dir, "tsconfig.json"),
    JSON.stringify({ compilerOptions: { strict: true, noEmit: true, target: "es2022", module: "esnext", moduleResolution: "bundler", allowImportingTsExtensions: true, lib: ["es2022"], types: ["node"], skipLibCheck: true }, include: ["*.ts", "layers/*/*.ts"] }, null, 2),
  );
  writeFileSync(join(dir, "README.md"), `# ${app.name}\n\nRun: \`node server.mjs\` (PORT, default 3000).\n\n${(app.endpoints ?? []).map((e) => `- ${e.method} ${e.path}`).join("\n")}\n`);
  return { appFile: join(dir, "app.ts"), specSource: spec };
}

export const API_TARGET_RULES = `Target: TypeScript (strict mode), a pure HTTP handler. You write \`app.ts\`.
- The harness already routes requests and validates their input: \`handle\` only receives valid requests (the \`Request\` union in spec.ts). Unknown routes and bad input never reach you.
- Answer with \`answer(status, body)\` or \`fail(status, message)\` from "./api.ts" (\`answer(204)\` for no body). A body is records, lists of records, or plain values, exactly as the endpoint \`returns\`. "answer 404 \\"No such ticket\\"" means \`fail(404, "No such ticket")\`.
- Available: the standard library, "./spec.ts", "./api.ts" and "./fmt.ts". No I/O, no timers, no randomness, no Date. Import with explicit extensions.
- Model is immutable: return a new model from handle. Handle every endpoint in the switch.
- The module must export exactly Model, init and handlers (one handler per endpoint, typed by \`Handlers<Model>\` in spec.ts). When an endpoint has a contract, its handler's answers are typed: only the declared statuses and body types compile.`;

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
  const out: unknown[] = [];
  for (const job of jobs) {
    const client = mod.start();
    const responses: Responses = new Map();
    const call = (c: Call) => {
      const h = toHttp(eps, c);
      const res = client.send(h.method, h.path, h.query, h.body, c.headers ?? {});
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
          } else if (s.do === "request") {
            // A raw request, through the layers and the router: its answer is \`request.…\`.
            const r = requestOf(s);
            responses.set("request", client.send(r.method, r.path, r.query, r.body, r.headers));
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
          steps.push(JSON.stringify({ endpoint: c.endpoint, status: res.status, body: res.body, headers: Object.fromEntries(Object.entries(res.headers ?? {}).sort()) }));
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
  return [...responses].map(([ep, r]) => `${ep} → ${r.status} ${JSON.stringify(r.body)}${r.headers && Object.keys(r.headers).length ? `  headers ${JSON.stringify(r.headers)}` : ""}`).join("\n");
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
  for (let i = 0; i < count; i++) {
    const calls: Call[] = [];
    for (let j = 0; j < length; j++) {
      const ep = pick(eps);
      const args: Record<string, unknown> = {};
      for (const p of ep.params) if (rnd() > 0.05) args[p.name] = valueFor(p.name, p.type);
      // Headers the examples send (an API key, an origin): mostly one of theirs, sometimes none or another.
      const headers: Record<string, string> = {};
      for (const [h, vs] of headerValues) if (rnd() < 0.85) headers[h] = rnd() < 0.9 ? pick(vs) : pick(TEXTS);
      calls.push({ endpoint: ep.name, args, ...(headerValues.size ? { headers } : {}) });
    }
    traces.push(calls);
  }
  return traces;
}

export const callText = (c: Call) => {
  const args = [...Object.entries(c.headers ?? {}).map(([k, v]) => `header ${k} = ${JSON.stringify(v)}`), ...Object.entries(c.args).map(([k, v]) => `${k} = ${JSON.stringify(v)}`)];
  return `call ${c.endpoint}${args.length ? ` with ${args.join(", ")}` : ""}`;
};

/**
 * A typed client for a contract: one function per endpoint, answering the contract's response
 * union. Generated from the same contract as the provider's handlers, so the two cannot drift.
 */
export function genClient(contract: App): string {
  const eps = contract.endpoints ?? [];
  const respType = (e: Endpoint) => (e.answers?.length ? e.answers.map((a) => `{ status: ${a.status}; body: ${a.type ? tsType(a.type) : "null"} }`).join(" | ") : "{ status: number; body: unknown }");
  return `// Generated from contract ${contract.name} — do not edit. A typed client: provider and consumer share this contract.
${tsDomain(contract).replace(/\/\*\* Initial value[\s\S]*?\n\];\n\n/g, "")}
${eps.map((e) => `/** ${e.method} ${e.path} */\nexport type ${cap(e.name)}Response = ${respType(e)};`).join("\n\n")}

export function client(baseUrl: string, fetchFn: typeof fetch = fetch) {
  const call = async (method: string, path: string, query: Record<string, unknown>, body: Record<string, unknown> | undefined) => {
    const qs = Object.entries(query).filter(([, v]) => v !== undefined && v !== null).map(([k, v]) => \`\${encodeURIComponent(k)}=\${encodeURIComponent(String(v))}\`).join("&");
    const res = await fetchFn(baseUrl.replace(/\\/$/, "") + path + (qs ? "?" + qs : ""), { method, headers: { "content-type": "application/json" }, body: body && JSON.stringify(body) });
    const text = await res.text();
    return { status: res.status, body: text ? JSON.parse(text) : null };
  };
  return {
${eps
  .map((e) => {
    const params = e.params.map((p) => `${p.name}${p.type.k === "Maybe" ? "?" : ""}: ${tsType(p.type)}`).join("; ");
    const path = e.path.replace(/\{(\w+)\}/g, (_, n) => `\${encodeURIComponent(String(args.${n}))}`);
    const query = e.params.filter((p) => p.in === "query").map((p) => `${p.name}: args.${p.name}`).join(", ");
    const body = e.params.some((p) => p.in === "body") ? `{ ${e.params.filter((p) => p.in === "body").map((p) => `${p.name}: args.${p.name}`).join(", ")} }` : "undefined";
    return `    ${e.name}: (args: { ${params} }${e.params.length ? "" : " = {}"}) => call(${q(e.method)}, \`${path}\`, { ${query} }, ${body}) as Promise<${cap(e.name)}Response>,`;
  })
  .join("\n")}
  };
}
`;
}
