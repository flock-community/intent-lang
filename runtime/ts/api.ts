// The API runtime: routing, input validation and response helpers. Shared by every API build;
// the LLM writes only the handlers. Messages are fixed, so every build answers bad input the same way.

import { parseDate, parseDateTime, parseInstant } from "./fmt.ts";

export type TypeDesc =
  | { k: "Text" }
  | { k: "Int" }
  | { k: "Decimal" }
  | { k: "Bool" }
  | { k: "Date" }
  | { k: "DateTime" }
  | { k: "Instant" } // UTC, to the second: "2026-09-24T07:00:00Z" (read from any ISO 8601 form with a zone)
  | { k: "List"; of: TypeDesc }
  | { k: "Maybe"; of: TypeDesc }
  | { k: "Map"; of: TypeDesc } // texts to values: a JSON object with any keys, written in key order
  | { k: "Json" } // 1.1: a JSON value the spec does not own; held canonical (every object's keys in order, at every depth)
  | { k: "Choice"; name: string; values: string[]; wire?: string[] } // wire: each value's name in JSON (`Info = "info"`), in order
  | { k: "Record"; name: string; fields: { name: string; type: TypeDesc }[] }
  // 1.1: one of several records, told apart by a tag field whose value is the variant's wire name (or its name).
  | { k: "Union"; name: string; tag: string; variants: { name: string; wire?: string; fields: { name: string; type: TypeDesc }[] }[] }
  | { k: "Refined"; name: string; base: TypeDesc; pattern?: string; min?: number; max?: number; minLength?: number; maxLength?: number; code?: { n: number; chars: string; unambiguous?: boolean } };

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
  t.k === "Text" ? "text" : t.k === "Int" ? "a whole number" : t.k === "Decimal" ? "a number" : t.k === "Bool" ? "true or false" : t.k === "Date" ? "a date (YYYY-MM-DD)" : t.k === "DateTime" ? "a moment (YYYY-MM-DDTHH:MM)" : t.k === "Instant" ? "an instant with a zone (YYYY-MM-DDTHH:MM:SSZ)" : t.k === "List" ? "a list" : t.k === "Map" ? `an object of ${describe(t.of)} by key` : t.k === "Json" ? "a JSON value" : t.k === "Maybe" ? describe(t.of) : t.k === "Choice" ? `one of ${(t.wire ?? t.values).join(", ")}` : t.k === "Refined" ? `a valid ${t.name}` : t.k === "Union" ? `a ${t.name} (${t.tag}: ${t.variants.map((v) => v.wire ?? v.name).join(", ")})` : "an object";

/** A map's entries in the wire's order: by key, as text (§9; Elm's Dict writes the same order). A key is
 *  set as an own property, so no key (`__proto__`) can reach the object's prototype. */
const entriesInOrder = (o: object): [string, unknown][] => Object.keys(o).sort().map((k) => [k, (o as Record<string, unknown>)[k]]);
function mapOf(entries: [string, unknown][]): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of entries) Object.defineProperty(out, k, { value: v, enumerable: true, writable: true, configurable: true });
  return out;
}

/** A JSON value in its one written form (§9.22): every object's keys in order, at every depth, as own
 *  properties (`__proto__` is a key); lists in their order; numbers, texts, true/false and null as they are. */
function canonical(v: unknown): unknown {
  if (Array.isArray(v)) return v.map(canonical);
  if (v !== null && typeof v === "object") return mapOf(entriesInOrder(v).map(([k, x]) => [k, canonical(x)]));
  return v;
}
const isJson = (v: unknown): boolean =>
  v === null || typeof v === "string" || typeof v === "boolean" || (typeof v === "number" && Number.isFinite(v)) || (Array.isArray(v) ? v.every(isJson) : typeof v === "object" && Object.values(v as object).every(isJson));

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
  if (t.k === "Json") return v !== undefined && isJson(v) ? canonical(v) : undefined; // null is a value, kept
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
    case "Map": {
      if (typeof v !== "object" || Array.isArray(v)) return undefined;
      const out: [string, unknown][] = [];
      for (const [k, x] of entriesInOrder(v as object)) {
        const c = coerce(x, t.of);
        if (c === undefined) return undefined;
        out.push([k, c]);
      }
      return mapOf(out);
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
    case "Union": {
      if (typeof v !== "object" || Array.isArray(v)) return undefined;
      const o = v as Record<string, unknown>;
      const variant = t.variants.find((x) => o[t.tag] === x.name || (x.wire !== undefined && o[t.tag] === x.wire));
      if (!variant) return undefined;
      const r = coerce(o, { k: "Record", name: variant.name, fields: variant.fields });
      return r === undefined ? undefined : { [t.tag]: variant.name, ...(r as object) };
    }
    default:
      return fits(v, t) ? v : undefined;
  }
}

/** Check a JSON value against a type; returns the value or an error message. */
function check(v: unknown, t: TypeDesc, name: string): { ok: unknown } | { error: string } {
  // Nothing on the wire: a `T or nothing` is `null`, and on input a missing key is nothing too. For a
  // `T`, a missing key is "is required" and `null` is not a value of the type ("must be …").
  if (t.k === "Maybe") return v === null || v === undefined ? { ok: null } : check(v, t.of, name);
  if (v === undefined) return { error: `${name} is required` };
  const bad = { error: `${name} must be ${describe(t)}` };
  // A Json is whatever arrived, read into its one form; null inside it (or as it) is a value.
  if (t.k === "Json") return isJson(v) ? { ok: canonical(v) } : bad;
  if (v === null) return bad;
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
    // An instant arrives in any ISO 8601 form with a zone and is read in its one form (UTC, seconds).
    case "Instant": {
      const i = typeof v === "string" ? parseInstant(v) : null;
      return i !== null ? { ok: i } : bad;
    }
    // A choice arrives by its wire name (or its own name) and is read as the spec's value.
    case "Choice": {
      if (typeof v !== "string") return bad;
      const i = t.wire ? t.wire.indexOf(v) : -1;
      return i >= 0 ? { ok: t.values[i] } : t.values.includes(v) ? { ok: v } : bad;
    }
    case "Refined": {
      const b = check(v, t.base, name);
      if ("error" in b) return { error: `${name} must be a valid ${t.name}` };
      // A code is read as its alphabet says, and the app sees its normal form (`k7mqor1z` → `K7MQ0R1Z`).
      if (t.code) {
        const c = readCode(String(b.ok), t.code.n, t.code.chars, t.code.unambiguous);
        return c === null ? bad : { ok: c };
      }
      const x = b.ok as string | number;
      const len = typeof x === "string" ? [...x].length : 0; // characters (code points), as on both targets
      const fits =
        t.pattern !== undefined
          ? new RegExp(t.pattern).test(String(x))
          : t.minLength !== undefined || t.maxLength !== undefined
            ? (t.minLength === undefined || len >= t.minLength) && (t.maxLength === undefined || len <= t.maxLength)
            : (t.min === undefined || (x as number) >= t.min) && (t.max === undefined || (x as number) <= t.max);
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
    case "Map": {
      if (typeof v !== "object" || Array.isArray(v)) return bad;
      const out: [string, unknown][] = [];
      for (const [k, x] of entriesInOrder(v as object)) {
        const r = check(x, t.of, `${name}[${JSON.stringify(k)}]`);
        if ("error" in r) return r;
        out.push([k, r.ok]);
      }
      return { ok: mapOf(out) };
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
    // A union: the tag says which record (by its wire name or its own); the app reads its own name.
    case "Union": {
      if (typeof v !== "object" || Array.isArray(v)) return bad;
      const tag = (v as Record<string, unknown>)[t.tag];
      const variant = t.variants.find((x) => tag === x.name || (x.wire !== undefined && tag === x.wire));
      if (!variant) return { error: `${name}.${t.tag} must be one of ${t.variants.map((x) => x.wire ?? x.name).join(", ")}` };
      const r = check(v, { k: "Record", name: variant.name, fields: variant.fields }, name);
      return "error" in r ? r : { ok: { [t.tag]: variant.name, ...(r.ok as object) } };
    }
  }
}

/** A value as it goes over the wire: every choice value by its wire name (`Info` → "info"), and every
 *  `T or nothing` field of a record written, as `null` when it is nothing (never left out). */
export function toWire(v: unknown, t: TypeDesc | null | undefined): unknown {
  if (t?.k === "Maybe" && v === undefined) return null;
  if (!t || v === null || v === undefined) return v;
  switch (t.k) {
    case "Maybe": return toWire(v, t.of);
    case "Choice": return t.wire && typeof v === "string" && t.values.includes(v) ? t.wire[t.values.indexOf(v)] : v;
    case "List": return Array.isArray(v) ? v.map((x) => toWire(x, t.of)) : v;
    case "Map": return typeof v === "object" && !Array.isArray(v) ? mapOf(entriesInOrder(v as object).map(([k, x]) => [k, toWire(x, t.of)])) : v;
    case "Json": return canonical(v);
    case "Record": {
      if (typeof v !== "object" || Array.isArray(v)) return v;
      const o = v as Record<string, unknown>;
      const out = Object.fromEntries(Object.entries(o).map(([k, x]) => [k, toWire(x, t.fields.find((f) => f.name === k)?.type)]));
      for (const f of t.fields) if (f.type.k === "Maybe" && o[f.name] === undefined) out[f.name] = null;
      return out;
    }
    case "Union": {
      if (typeof v !== "object" || Array.isArray(v)) return v;
      const o = v as Record<string, unknown>;
      const variant = t.variants.find((x) => o[t.tag] === x.name || (x.wire !== undefined && o[t.tag] === x.wire));
      if (!variant) return v;
      // The tag first, then the variant's fields as declared: the same JSON whatever order a build set them in.
      const r = toWire(o, { k: "Record", name: variant.name, fields: variant.fields }) as Record<string, unknown>;
      return Object.fromEntries([[t.tag, variant.wire ?? variant.name], ...variant.fields.filter((f) => f.name in r).map((f) => [f.name, r[f.name]])]);
    }
    default: return v;
  }
}

/** A value from the wire in the spec's names (a choice's wire name read as its value); unchanged if it does not fit. */
export function fromWire(v: unknown, t: TypeDesc | null | undefined): unknown {
  if (!t) return v;
  const c = check(v, t, "the value");
  return "error" in c ? v : c.ok;
}

/** Does a type carry wire names anywhere (so the harness must translate it)? */
export const hasWire = (t: TypeDesc | null | undefined): boolean =>
  !!t && (t.k === "Choice" ? !!t.wire : t.k === "List" || t.k === "Maybe" || t.k === "Map" ? hasWire(t.of) : t.k === "Record" ? t.fields.some((f) => hasWire(f.type)) : t.k === "Union" || t.k === "Json");

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

/**
 * A code read the way its alphabet says: `unambiguous` codes Crockford's way (lower case accepted,
 * `o`/`O` as 0, `i`/`I`/`l`/`L` as 1, hyphens ignored); every other alphabet exactly. The normal
 * form, or null when the text is not a code of n characters of the alphabet.
 */
export function readCode(text: string, n: number, alphabet: string, unambiguous = false): string | null {
  const s = unambiguous ? text.replace(/-/g, "").toUpperCase().replace(/O/g, "0").replace(/[IL]/g, "1") : text;
  const cs = [...s];
  return cs.length === n && cs.every((c) => alphabet.includes(c)) ? s : null;
}
