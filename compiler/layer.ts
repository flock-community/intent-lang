// Layers (kind "layer"): reusable request/answer wrappers for api apps, such as CORS or API keys.
// Here: binding a layer's params, and the driver that runs a layer's examples and random requests
// around a stub app (200 { reached: true, …provided }). What a build is made of comes from its
// target (targets/ts-service.ts).
import { copyFileSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import type { App, Binding, LayerParam, Literal, Step } from "./ast.ts";
import { ROOT, tsDomain, tsType } from "./gen.ts";
import { checkSeeApi, literalJson, type Responses } from "./api.ts";
import type { HttpRequest } from "../runtime/ts/http.ts";

const q = (s: string) => JSON.stringify(s);
export { genLayerSpec, scaffoldLayer, LAYER_FILES, LAYER_RULES, LAYER_SKELETON, CLIENT_LAYER_RULES, CLIENT_LAYER_SKELETON } from "./targets/ts-service.ts";

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

