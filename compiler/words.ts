// Small helpers for the words of a spec: a quoted string, a type written out, and "did you mean".
// Kept apart from the parser so modules the harness imports (compiler/access.ts) can use them
// without importing the checker.
import type { Type } from "./ast.ts";

const STR = '"(?:[^"\\\\]|\\\\.)*"';

/** A quoted string: `\\n` is a new line and `\\t` a tab; a backslash before anything else keeps that character. */
export function parseString(s: string): string | undefined {
  if (!new RegExp(`^${STR}$`).test(s)) return undefined;
  return s.slice(1, -1).replace(/\\(.)/g, (_, c: string) => (c === "n" ? "\n" : c === "t" ? "\t" : c));
}

export function typeToString(t: Type): string {
  switch (t.k) {
    case "List": return `List ${typeToString(t.of)}`;
    case "Maybe": return `${typeToString(t.of)} or nothing`;
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
