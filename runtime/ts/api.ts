// The API runtime: routing, input validation and response helpers. Shared by every API build;
// the LLM writes only the handlers. Messages are fixed, so every build answers bad input the same way.

import { parseDate, parseDateTime } from "./fmt.ts";

export type TypeDesc =
  | { k: "Text" }
  | { k: "Int" }
  | { k: "Decimal" }
  | { k: "Bool" }
  | { k: "Date" }
  | { k: "DateTime" }
  | { k: "List"; of: TypeDesc }
  | { k: "Maybe"; of: TypeDesc }
  | { k: "Choice"; name: string; values: string[] }
  | { k: "Record"; name: string; fields: { name: string; type: TypeDesc }[] }
  | { k: "Refined"; name: string; base: TypeDesc; pattern?: string; min?: number; max?: number };

export interface EndpointDesc {
  name: string;
  method: string;
  path: string;
  params: { in: "path" | "query" | "body"; name: string; type: TypeDesc }[];
}

export type Response = { status: number; body: unknown };

/** A successful answer: the status and the body (records, lists, texts, numbers); without a body (204), the body is null. */
export function answer<S extends number>(status: S): { status: S; body: null };
export function answer<S extends number, B>(status: S, body: B): { status: S; body: B };
export function answer<S extends number, B = null>(status: S, body?: B): { status: S; body: B } {
  return { status, body: (body === undefined ? null : JSON.parse(JSON.stringify(body))) as B };
}

/** A refusal: the status and one message, always as `{ "error": message }` (a Problem). */
export function fail<S extends number>(status: S, error: string): { status: S; body: { error: string } } {
  return { status, body: { error } };
}

/** Does an answer match the contract? Returns what is wrong, or undefined. */
export function conforms(answers: Record<number, TypeDesc | null> | undefined, r: Response): string | undefined {
  if (!answers) return;
  if (!(r.status in answers)) return `answered ${r.status}, which the contract does not declare (${Object.keys(answers).join(", ")})`;
  const t = answers[r.status];
  if (t === null) return r.body === null ? undefined : `answered ${r.status} with a body, but the contract declares none`;
  const c = check(r.body, t, "the body");
  return "error" in c ? `answered ${r.status}, but ${c.error}` : undefined;
}

const describe = (t: TypeDesc): string =>
  t.k === "Text" ? "text" : t.k === "Int" ? "a whole number" : t.k === "Decimal" ? "a number" : t.k === "Bool" ? "true or false" : t.k === "Date" ? "a date (YYYY-MM-DD)" : t.k === "DateTime" ? "a moment (YYYY-MM-DDTHH:MM)" : t.k === "List" ? "a list" : t.k === "Maybe" ? describe(t.of) : t.k === "Choice" ? `one of ${t.values.join(", ")}` : t.k === "Refined" ? `a valid ${t.name}` : "an object";

/** Does a JSON value fit a type (kept data read back, for example)? */
export const fits = (v: unknown, t: TypeDesc): boolean => !("error" in check(v, t, "the value"));

/**
 * Kept data read back into the current types: a field that still fits is kept, and a record or list
 * is migrated element by element — an extra field is dropped, a new `T or nothing` field becomes
 * nothing, a new list an empty list. A stored field that cannot be migrated at all is left out, so
 * the caller keeps its default for that field only, never resetting everything. Returns the fields
 * that were migrated and the ones that were dropped.
 */
export function migrate(saved: unknown, types: Record<string, TypeDesc>): { data: Record<string, unknown>; dropped: string[] } {
  const data: Record<string, unknown> = {};
  const dropped: string[] = [];
  for (const [f, t] of Object.entries(types)) {
    const v = saved && typeof saved === "object" ? coerce((saved as Record<string, unknown>)[f], t) : undefined;
    if (v === undefined) dropped.push(f);
    else data[f] = v;
  }
  return { data, dropped };
}

/** The value as the current type wants it, or undefined when it cannot be migrated. */
function coerce(v: unknown, t: TypeDesc): unknown {
  if (t.k === "Maybe") return v === undefined || v === null ? null : (coerce(v, t.of) ?? null);
  if (v === undefined || v === null) return undefined;
  switch (t.k) {
    case "List": {
      if (!Array.isArray(v)) return undefined;
      const out: unknown[] = [];
      for (const x of v) {
        const c = coerce(x, t.of);
        if (c === undefined) return undefined;
        out.push(c);
      }
      return out;
    }
    case "Record": {
      if (typeof v !== "object" || Array.isArray(v)) return undefined;
      const o = v as Record<string, unknown>;
      const out: Record<string, unknown> = {};
      for (const f of t.fields) {
        const c = coerce(o[f.name], f.type);
        if (c !== undefined) out[f.name] = c;
        else if (o[f.name] === undefined && f.type.k === "List") out[f.name] = [];
        else return undefined; // a new field with no default: this element cannot be migrated
      }
      return out;
    }
    default:
      return fits(v, t) ? v : undefined;
  }
}

/** Check a JSON value against a type; returns the value or an error message. */
function check(v: unknown, t: TypeDesc, name: string): { ok: unknown } | { error: string } {
  if (t.k === "Maybe") return v === null || v === undefined ? { ok: null } : check(v, t.of, name);
  if (v === undefined || v === null) return { error: `${name} is required` };
  const bad = { error: `${name} must be ${describe(t)}` };
  switch (t.k) {
    case "Text": return typeof v === "string" ? { ok: v } : bad;
    case "Int": return typeof v === "number" && Number.isInteger(v) ? { ok: v } : bad;
    case "Decimal": return typeof v === "number" && Number.isFinite(v) ? { ok: v } : bad;
    case "Bool": return typeof v === "boolean" ? { ok: v } : bad;
    case "Date": return typeof v === "string" && parseDate(v) === v ? { ok: v } : bad;
    case "DateTime": {
      const dt = typeof v === "string" ? parseDateTime(v) : null;
      return dt !== null ? { ok: dt } : bad;
    }
    case "Choice": return typeof v === "string" && t.values.includes(v) ? { ok: v } : bad;
    case "Refined": {
      const b = check(v, t.base, name);
      if ("error" in b) return { error: `${name} must be a valid ${t.name}` };
      const x = b.ok as string | number;
      const fits = t.pattern !== undefined ? new RegExp(t.pattern).test(String(x)) : (t.min === undefined || (x as number) >= t.min) && (t.max === undefined || (x as number) <= t.max);
      return fits ? { ok: x } : bad;
    }
    case "List": {
      if (!Array.isArray(v)) return bad;
      const out: unknown[] = [];
      for (const [i, x] of v.entries()) {
        const r = check(x, t.of, `${name}[${i + 1}]`);
        if ("error" in r) return r;
        out.push(r.ok);
      }
      return { ok: out };
    }
    case "Record": {
      if (typeof v !== "object" || Array.isArray(v)) return bad;
      const out: Record<string, unknown> = {};
      for (const f of t.fields) {
        const r = check((v as Record<string, unknown>)[f.name], f.type, `${name}.${f.name}`);
        if ("error" in r) return r;
        out[f.name] = r.ok;
      }
      return { ok: out };
    }
  }
}

/** A query or path value arrives as text: read it as its type. */
function fromText(s: string | undefined, t: TypeDesc): unknown {
  if (s === undefined) return undefined;
  let inner = t.k === "Maybe" ? t.of : t;
  if (inner.k === "Refined") inner = inner.base;
  if (inner.k === "Int") return /^-?\d+$/.test(s) ? Number(s) : s;
  if (inner.k === "Decimal") return /^-?\d+(\.\d+)?$/.test(s) ? Number(s) : s;
  if (inner.k === "Bool") return s === "true" ? true : s === "false" ? false : s;
  return s;
}

/** Match a request to an endpoint and validate its input. Unknown routes and bad input are answered here. */
export function route(endpoints: EndpointDesc[], method: string, path: string, query: Record<string, string>, body: unknown): { request: Record<string, unknown> } | { response: Response } {
  const parts = path.split("/").filter(Boolean);
  const matches = endpoints
    .map((e) => {
      const segs = e.path.split("/").filter(Boolean);
      if (segs.length !== parts.length) return undefined;
      const params: Record<string, string> = {};
      for (let i = 0; i < segs.length; i++) {
        const m = segs[i].match(/^\{(\w+)\}$/);
        if (m) params[m[1]] = decodeURIComponent(parts[i]);
        else if (segs[i] !== parts[i]) return undefined;
      }
      return { e, params };
    })
    .filter((x): x is { e: EndpointDesc; params: Record<string, string> } => !!x);
  if (!matches.length) return { response: fail(404, "Not found") };
  const hit = matches.find((m) => m.e.method === method);
  if (!hit) return { response: fail(405, "Method not allowed") };
  const request: Record<string, unknown> = { endpoint: hit.e.name };
  const bodyObj = body && typeof body === "object" && !Array.isArray(body) ? (body as Record<string, unknown>) : {};
  if (hit.e.params.some((p) => p.in === "body") && body !== undefined && body !== null && (typeof body !== "object" || Array.isArray(body))) return { response: fail(400, "the body must be a JSON object") };
  for (const p of hit.e.params) {
    const raw = p.in === "path" ? fromText(hit.params[p.name], p.type) : p.in === "query" ? fromText(query[p.name], p.type) : bodyObj[p.name];
    const r = check(raw, p.type, p.name);
    if ("error" in r) return { response: fail(400, r.error) };
    request[p.name] = r.ok;
  }
  return { request };
}
