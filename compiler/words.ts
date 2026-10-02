// Small helpers for the words of a spec: a quoted string, a type written out, and "did you mean".
// Kept apart from the parser so modules the harness imports (compiler/access.ts) can use them
// without importing the checker.
import type { Literal, Type } from "./ast.ts";

const STR = '"(?:[^"\\\\]|\\\\.)*"';

/** A quoted string: `\\n` is a new line and `\\t` a tab; a backslash before anything else keeps that character. */
export function parseString(s: string): string | undefined {
  if (!new RegExp(`^${STR}$`).test(s)) return undefined;
  return s.slice(1, -1).replace(/\\(.)/g, (_, c: string) => (c === "n" ? "\n" : c === "t" ? "\t" : c));
}

/** A literal as JSON: a record's fields by name, nothing as null, a day or moment as its text. */
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
    case "instant": return l.v;
    case "list": return l.items.map(literalJson);
    case "record": return Object.fromEntries(l.fields.map((f) => [f.name, literalJson(f.value)]));
    default: return null;
  }
}

/** A JSON value in its one written form (§9.22): every object's keys in order (as a map's), at every depth. */
export function canonicalJson(v: unknown): unknown {
  if (Array.isArray(v)) return v.map(canonicalJson);
  if (v !== null && typeof v === "object") {
    const out: Record<string, unknown> = {};
    for (const k of Object.keys(v).sort()) Object.defineProperty(out, k, { value: canonicalJson((v as Record<string, unknown>)[k]), enumerable: true, writable: true, configurable: true });
    return out;
  }
  return v;
}

export function typeToString(t: Type): string {
  switch (t.k) {
    case "List": return `List ${typeToString(t.of)}`;
    case "Maybe": return `${typeToString(t.of)} or nothing`;
    case "Map": return `Map ${typeToString(t.of)}`;
    case "Named": return t.name;
    case "Ref": return `ref ${t.name}${t.in ? ` in ${t.in}` : ""}`;
    default: return t.k;
  }
}

export function suggest(word: string, candidates: string[]): string {
  let best = "";
  let bestD = Infinity;
  for (const c of candidates) {
    const d = lev(word.toLowerCase(), c.toLowerCase());
    if (d < bestD) [best, bestD] = [c, d];
  }
  return best && bestD <= Math.max(1, Math.floor(word.length / 3)) && best !== word ? ` (did you mean \`${best}\`?)` : "";
}

function lev(a: string, b: string): number {
  const d = Array.from({ length: a.length + 1 }, (_, i) => [i, ...Array(b.length).fill(0)]);
  for (let j = 1; j <= b.length; j++) d[0][j] = j;
  for (let i = 1; i <= a.length; i++)
    for (let j = 1; j <= b.length; j++) d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
  return d[a.length][b.length];
}
