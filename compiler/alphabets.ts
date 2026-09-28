// The alphabets a code is drawn from (`type PickupCode = Text of 6 digits`): a closed set, so every
// target draws, checks and reads a code the same way (docs/LANGUAGE.md §3a).
import { CROCKFORD } from "../runtime/ts/draw.ts";

export const ALPHABETS: Record<string, string> = {
  digits: "0123456789",
  "hex digits": "0123456789abcdef",
  "capitals and digits": "ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789",
  "letters and digits": "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789",
  // Crockford's Base32: no I, L, O, U; read forgivingly as input (lower case, o → 0, i and l → 1).
  "unambiguous letters and digits": CROCKFORD,
};

/** The alphabets by name, longest first (so `unambiguous letters and digits` wins over `letters and digits`). */
export const ALPHABET_NAMES = Object.keys(ALPHABETS).sort((a, b) => b.length - a.length);

/** Bits of a code of n characters from an alphabet of k: n × log2 k. */
export const codeBits = (n: number, chars: string) => n * Math.log2([...chars].length);

/** How many values a code has, in words: "1,000,000 values, 19.9 bits" (a power when it is large: "32^8 values, 40 bits"). */
export function codeSize(n: number, chars: string): string {
  const k = [...chars].length;
  const count = k ** n;
  const bits = codeBits(n, chars);
  return `${count <= 1e9 ? count.toLocaleString("en-US") : `${k}^${n}`} values, ${Number.isInteger(bits) ? bits : bits.toFixed(1)} bits`;
}
