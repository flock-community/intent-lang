// Layers (kind "layer"): reusable request/answer wrappers for api apps, such as CORS or API keys.
// The harness generates the interface (Config, Provided, Before); the LLM writes `before` and
// `after`. A layer's examples run it around a stub app that answers 200 { reached: true, …provided }.
import { copyFileSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import type { App, Binding, LayerParam, Literal, Step } from "./ast.ts";
import { ROOT, tsDomain, tsType } from "./gen.ts";
import { checkSeeApi, literalJson, type Responses } from "./api.ts";
import type { HttpRequest } from "../runtime/ts/http.ts";

const q = (s: string) => JSON.stringify(s);

// ---------------------------------------------------------------- config

/** A bound value as JSON: a list param takes one literal, several, or a table (a list of records). */
export function bindingJson(p: LayerParam, value: Literal | Literal[]): unknown {
  const list = p.type.k === "List";
  if (Array.isArray(value)) return value.map(literalJson);
  if (value.k === "table") return value.rows.map((r) => Object.fromEntries(value.columns.map((c, i) => [c, literalJson(r[i])])));
  if (value.k === "emptyList") return [];
  return list ? [literalJson(value)] : literalJson(value);
}

/** The config a layer runs with: its defaults, overridden by the bindings. */
export function layerConfig(layer: App, bindings: Binding[]): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const p of layer.params ?? []) {
    const b = bindings.find((x) => x.name === p.name);
    if (b) out[p.name] = bindingJson(p, b.value);
    else if (p.default !== undefined) out[p.name] = bindingJson(p, p.default);
  }
  return out;
}

// ---------------------------------------------------------------- generated interface

export function genLayerSpec(app: App): string {
  const params = app.params ?? [];
  const provides = app.provides ?? [];
  if (app.beforeCall)
    return `// Generated from layer ${app.name} — do not edit. The interface the layer module must satisfy.
import type { HttpRequest } from "./http.ts";
export type { HttpRequest } from "./http.ts";

${tsDomain(app)}/** The params, as a screen binds them (to its state, or literals; defaults filled in). */
export type Config = { ${params.map((p) => `${p.name}: ${tsType(p.type)}`).join("; ")} };
`;
  return `// Generated from layer ${app.name} — do not edit. The interface the layer module must satisfy.
import type { HttpRequest, HttpResponse } from "./http.ts";
export type { HttpRequest, HttpResponse } from "./http.ts";

${tsDomain(app)}/** The params, as an app binds them (defaults filled in). */
export type Config = { ${params.map((p) => `${p.name}: ${tsType(p.type)}`).join("; ")} };

/** What this layer hands to the app's endpoints when a request passes. */
export type Provided = { ${provides.map((p) => `${p.name}: ${tsType(p.type)}`).join("; ")} };

/** \`before\` either answers (the app is not reached, and no later layer runs) or passes the request on. */
export type Before = { pass: Provided } | { answer: HttpResponse };
`;
}

export const LAYER_SKELETON = `import type { Before, Config, HttpRequest, HttpResponse } from "./spec.ts";
import { … } from "./http.ts"; // what you use of: header, refuse, respond, sameSecret, withHeaders

/** Runs first, for every request. */
export function before(req: HttpRequest, config: Config): Before { /* … */ }

/** Runs last, for every answer: the app's, the harness's (404, 400, 405) and any layer's. */
export function after(req: HttpRequest, res: HttpResponse, config: Config): HttpResponse { /* … */ }
`;

/** A client's layer: one function over every call as it leaves the screen (and the event stream's request). */
export const CLIENT_LAYER_SKELETON = `import type { Config, HttpRequest } from "./spec.ts";
import { … } from "./http.ts"; // what you use of: header, lower

/** Runs for every call a screen makes through this layer, and for its event stream: returns the call as it leaves. */
export function before(req: HttpRequest, config: Config): HttpRequest { /* … */ }
`;

export const CLIENT_LAYER_RULES = `Target: TypeScript (strict mode), a layer around a client's calls. You write \`layer.ts\`.
- Export exactly \`before(req, config)\`, which returns the call as it leaves: the same method, path, query and body unless the spec says otherwise, with the headers the spec says. Header names are lower case.
- It runs in the browser and in tests, for every call and for the event stream (\`GET /events\`). Config values come from the screen's state and change over time: never cache them.
- Available: the standard library, "./spec.ts", "./http.ts" and "./fmt.ts". No I/O, no timers, no randomness, no Date. Import with explicit extensions.
- Pure function: never mutate the request you receive; return a new object.
- Every example must pass. Walk through each one step by step before you answer. Write plain code, no comments.`;

export const LAYER_RULES = `Target: TypeScript (strict mode), a layer around an HTTP API. You write \`layer.ts\`.
- Export exactly \`before\` and \`after\` with the signatures below. Without \`before every request\`, \`before\` passes every request on: \`{ pass: {} }\` (plus what the layer provides). Without \`after every answer\`, \`after\` returns the answer unchanged.
- Requests and answers are plain data. Header names are lower case; read request headers with \`header(req, name)\`. Build answers with \`respond(status, body, headers)\` (body \`null\` for none) or \`refuse(status, message, headers)\` (a Problem), and add headers with \`withHeaders(res, {…})\`. Never drop headers or change the status or body of an answer unless the spec says so.
- Secrets (keys, tokens, passwords) are compared only with \`sameSecret(a, b)\`, never with ===.
- Available: the standard library, "./spec.ts", "./http.ts" and "./fmt.ts". No I/O, no timers, no randomness, no Date. Import with explicit extensions.
- Pure functions: never mutate the request or the answer you receive; return new objects.
- Every example must pass. Walk through each one step by step before you answer. Write plain code, no comments.`;

const TEST_ENTRY = `import * as L from "./layer.ts";
import { normalize, type HttpRequest, type HttpResponse } from "./http.ts";

const copy = <T,>(x: T): T => JSON.parse(JSON.stringify(x ?? null));

/** The layer around a stub app that answers 200 { reached: true, …what the layer provided }. */
export function start(config: any) {
  return {
    send(req: HttpRequest): HttpResponse {
      const b = L.before(copy(req), copy(config));
      const res: HttpResponse = "answer" in b ? normalize(b.answer) : { status: 200, headers: {}, body: { reached: true, ...copy(b.pass) } };
      return normalize(L.after(copy(req), copy(res), copy(config)));
    },
  };
}
`;

/** A client's layer in its examples: \`request …\` is a call the screen makes; what is seen is the call as it leaves. */
const CLIENT_TEST_ENTRY = `import * as L from "./layer.ts";
import { lower, type HttpRequest, type HttpResponse } from "./http.ts";

const copy = <T,>(x: T): T => JSON.parse(JSON.stringify(x ?? null));

export function start(config: any) {
  return {
    send(req: HttpRequest): HttpResponse {
      const out = L.before(copy(req), copy(config));
      return { status: 200, headers: lower(out.headers ?? {}), body: copy({ method: out.method, path: out.path, query: out.query ?? {}, body: out.body ?? null }) };
    },
  };
}
`;

export function scaffoldLayer(app: App, dir: string): { appFile: string; specSource: string } {
  mkdirSync(dir, { recursive: true });
  copyFileSync(join(ROOT, "runtime/ts/http.ts"), join(dir, "http.ts"));
  copyFileSync(join(ROOT, "runtime/ts/fmt.ts"), join(dir, "fmt.ts"));
  const spec = genLayerSpec(app);
  writeFileSync(join(dir, "spec.ts"), spec);
  writeFileSync(join(dir, "test-entry.ts"), app.beforeCall ? CLIENT_TEST_ENTRY : TEST_ENTRY);
  writeFileSync(join(dir, "config.json"), JSON.stringify(layerConfig(app, app.exampleConfig ?? []), null, 2));
  writeFileSync(
    join(dir, "tsconfig.json"),
    JSON.stringify({ compilerOptions: { strict: true, noEmit: true, target: "es2022", module: "esnext", moduleResolution: "bundler", allowImportingTsExtensions: true, lib: ["es2022", "dom"], skipLibCheck: true }, include: ["*.ts"] }, null, 2),
  );
  return { appFile: join(dir, "layer.ts"), specSource: spec };
}

/** The files an app build needs from a verified layer build. */
export const LAYER_FILES = ["layer.ts", "spec.ts", "http.ts", "fmt.ts"];

// ---------------------------------------------------------------- driving a layer build

export type LayerJob = { kind: "layer-example"; example: { name: string; steps: Step[]; line: number }; config: unknown } | { kind: "layer-trace"; requests: HttpRequest[]; config: unknown };

/** A \`request\` step as data. */
export function requestOf(s: Extract<Step, { do: "request" }>): HttpRequest {
  const pick = (w: string) => Object.fromEntries(s.args.filter((a) => a.in === w).map((a) => [a.name, literalJson(a.value)]));
  const headers = Object.fromEntries(Object.entries(pick("header")).map(([k, v]) => [k, String(v)]));
  const query = Object.fromEntries(Object.entries(pick("query")).map(([k, v]) => [k, String(v)]));
  const body = s.args.some((a) => a.in === "body") ? pick("body") : undefined;
  return { method: s.method, path: s.path, query, headers, body };
}

export const requestText = (r: HttpRequest) =>
  `request ${r.method} ${q(r.path)}${Object.keys(r.headers).length ? ` with ${Object.entries(r.headers).map(([k, v]) => `header ${k} = ${q(v)}`).join(", ")}` : ""}`;

/** In a layer's examples, \`see status\` means the latest answer: \`request.status\`. */
export const rawTarget = (s: Extract<Step, { do: "see" }>) => (/^(status|header\.|body)/.test(s.target) ? { ...s, target: `request.${s.target}` } : s);

export async function runLayerJobs(dir: string, jobs: LayerJob[]): Promise<unknown[]> {
  const mod = await import(pathToFileURL(join(dir, "test.mjs")).href + `?t=${Date.now()}`);
  const out: unknown[] = [];
  for (const job of jobs) {
    let config = job.config as Record<string, unknown>;
    let layer = mod.start(config);
    const responses: Responses = new Map();
    const dump = () => [...responses].map(([k, r]) => `${k} → ${r.status} ${JSON.stringify(r.headers ?? {})} ${JSON.stringify(r.body)}`).join("\n");
    try {
      if (job.kind === "layer-example") {
        let failure: { line: number; message: string; screen: string } | undefined;
        for (const s of job.example.steps) {
          if (s.do === "given") {
            // A param's value from here on; a list param given one value is a list of one.
            const v = literalJson(s.value);
            config = { ...config, [s.name]: Array.isArray(config[s.name]) && !Array.isArray(v) ? (s.value.k === "emptyList" ? [] : [v]) : v };
            layer = mod.start(config);
          } else if (s.do === "request") responses.set("request", layer.send(requestOf(s)));
          else if (s.do === "see") {
            const msg = checkSeeApi(responses, rawTarget(s));
            if (msg) {
              failure = { line: s.line, message: msg, screen: dump() };
              break;
            }
          }
        }
        out.push({ name: job.example.name, pass: !failure, failure });
      } else {
        out.push({ steps: job.requests.map((r) => JSON.stringify(canonical(layer.send(r)))) });
      }
    } catch (e) {
      out.push(job.kind === "layer-example" ? { name: job.example.name, pass: false, failure: { line: job.example.line, message: `crashed: ${(e as Error).message}`, screen: dump() } } : { steps: [], error: `crashed: ${(e as Error).message}` });
    }
  }
  return out;
}

const canonical = (v: unknown): unknown =>
  Array.isArray(v) ? v.map(canonical) : v && typeof v === "object" ? Object.fromEntries(Object.keys(v).sort().map((k) => [k, canonical((v as Record<string, unknown>)[k])])) : v;

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

/** Random requests, from the layer's examples: their methods, paths and header values, mixed and left out. */
export function layerTraces(app: App, count: number, length: number, seed = 7): HttpRequest[][] {
  const rnd = mulberry32(seed);
  const pick = <T,>(xs: T[]) => xs[Math.floor(rnd() * xs.length)];
  const reqs = app.examples.flatMap((e) => e.steps).filter((s): s is Extract<Step, { do: "request" }> => s.do === "request").map(requestOf);
  const methods = [...new Set(["GET", "POST", "OPTIONS", "DELETE", ...reqs.map((r) => r.method)])];
  const paths = [...new Set(["/", "/x", ...reqs.map((r) => r.path)])];
  const values = new Map<string, string[]>();
  for (const r of reqs) for (const [k, v] of Object.entries(r.headers)) values.set(k, [...(values.get(k) ?? []), v]);
  const noise = ["", "  ", "x", "HTTPS://DESK.EXAMPLE", "null"];
  const traces: HttpRequest[][] = [];
  for (let i = 0; i < count; i++) {
    const t: HttpRequest[] = [];
    for (let j = 0; j < length; j++) {
      const headers: Record<string, string> = {};
      for (const [k, vs] of values) if (rnd() < 0.6) headers[k] = rnd() < 0.8 ? pick(vs) : pick(noise);
      t.push({ method: pick(methods), path: pick(paths), query: {}, headers, body: undefined });
    }
    traces.push(t);
  }
  return traces;
}

export function readLayerConfig(dir: string): unknown {
  return JSON.parse(readFileSync(join(dir, "config.json"), "utf8"));
}

