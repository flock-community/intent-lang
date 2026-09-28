// Random values (draws), owned by the harness: no build makes its own. Every draw is a pure function of
// the event's seed and its place: PRF(eventSeed, site, row, index), with HMAC-SHA-256 on the reviewed
// SHA-256 of std.crypto as the PRF (NIST SP 800-108r1, counter mode). A value never depends on how many
// draws came before it, so two builds that evaluate in another order (or evaluate a draw they then
// discard) see the same values: the counter-based idea of Philox and JAX's `fold_in`.
//
// Bytes become values by rejection sampling (no modulo bias), `not among` rejects taken values (and
// lists the free ones when half or more are taken), shuffles are Fisher–Yates. The same code is
// runtime/elm/Draw.elm; tests/random.test.ts holds the two to identical values.
//
// In production each event's seed is 32 bytes from the platform's CSPRNG (`freshSeed`). In tests the
// driver gives every event `eventSeed(runBase(name), n)` and a `Steer`: it may hand out a value for a
// draw (a `steer random …` step, or a random session's edge value), and hears every value drawn.
import { sha256Bytes } from "./platform/std.crypto.ts";

/**
 * What a test driver does to the draws: `take` a steered value (or null), and hear what was `drawn`.
 * With `plan`, the entry first runs the event with a steer that only notes the places asked (its
 * result is dropped), and hands them to `plan`: steered values then go to the draws in the spec's
 * order, never in the order a build happens to evaluate them (Elm evaluates a `let` bottom-up).
 */
export type Steer = { take(key: string, n: number): string | null; drawn(key: string, value: string): void; plan?(asked: [string, number][]): void };

/** A steer that notes the places asked and hands out nothing (the first run of a planned event). */
export function asking(asked: [string, number][]): Steer {
  return { take: (key, n) => (asked.push([key, n]), null), drawn: () => {} };
}

/**
 * Run an event's update with its draws. With a plan to make (steered values queued), the update runs
 * first with a steer that only notes the places asked (on a copy of the model: its result is
 * dropped), then for real with the values planned in the spec's order.
 */
export function withPlan<T>(src: Source, run: (src: Source, first: boolean) => T): T {
  const plan = src.steer?.plan;
  if (plan) {
    const asked: [string, number][] = [];
    run({ seed: src.seed, steer: asking(asked) }, true);
    plan.call(src.steer, asked);
  }
  return run(src, false);
}

/** An event's draws: its seed (64 hex digits) and, in tests, the driver's steering. */
export type Source = { seed: string; steer?: Steer | null };

/** The values a random type has: a whole-number range, a code of n characters, or named values (a choice). */
export type Space = { k: "int"; lo: number; hi: number } | { k: "text"; n: number; chars: string } | { k: "names"; values: string[] };

const utf8 = (s: string) => new TextEncoder().encode(s);
const hexOf = (b: Uint8Array) => [...b].map((x) => x.toString(16).padStart(2, "0")).join("");
const bytesOf = (hex: string) => new Uint8Array((hex.match(/../g) ?? []).map((h) => parseInt(h, 16)));

/** HMAC-SHA-256 (RFC 2104), on std.crypto's SHA-256. */
export function hmac(key: Uint8Array, msg: Uint8Array): Uint8Array {
  const k = new Uint8Array(64);
  k.set(key.length > 64 ? sha256Bytes(key) : key);
  const inner = new Uint8Array(64 + msg.length);
  const outer = new Uint8Array(64 + 32);
  for (let i = 0; i < 64; i++) {
    inner[i] = k[i] ^ 0x36;
    outer[i] = k[i] ^ 0x5c;
  }
  inner.set(msg, 64);
  outer.set(sha256Bytes(inner), 64);
  return sha256Bytes(outer);
}

/** A run's base key: the SHA-256 of its name (an example's name, a random session's seed). */
export const runBase = (name: string): Uint8Array => sha256Bytes(utf8(name));

/** The seed of the n-th event of a run (tests), or of a page (Elm in the browser: its base seed and an event counter). */
export const eventSeed = (base: Uint8Array, n: number): string => hexOf(hmac(base, utf8(`event|${n}`)));

/** 32 bytes from the platform's CSPRNG (Web Crypto in the browser, Node's in a service), as hex. */
export function freshSeed(): string {
  const c = (globalThis as { crypto?: { getRandomValues?(a: Uint8Array): Uint8Array } }).crypto;
  if (!c?.getRandomValues) throw new Error("draws need the platform's CSPRNG (crypto.getRandomValues), and there is none: nothing is drawn");
  const b = new Uint8Array(32);
  c.getRandomValues(b);
  return hexOf(b);
}

/** Is this a seed a draw may use: 32 bytes as 64 hex digits? (Never a fallback: a fixed seed makes every value predictable.) */
export const isSeed = (s: unknown): s is string => typeof s === "string" && /^[0-9a-f]{64}$/.test(s);

/** A stream of uniform 32-bit words for one place: HMAC(seed, "site|row|index|block"), 8 words a block. */
function stream(seed: string, key: string): () => number {
  const k = bytesOf(seed);
  let block = -1;
  let words: number[] = [];
  return () => {
    if (!words.length) {
      const h = hmac(k, utf8(`${key}|${++block}`));
      words = Array.from({ length: 8 }, (_, i) => ((h[i * 4] << 24) | (h[i * 4 + 1] << 16) | (h[i * 4 + 2] << 8) | h[i * 4 + 3]) >>> 0);
    }
    return words.shift()!;
  };
}

/** A uniform whole number in [0, n), n ≤ 2^32: rejection sampling, never `random % n` (its bias). */
function uniform(next: () => number, n: number): number {
  if (n <= 1) return 0;
  const limit = 2 ** 32 - (2 ** 32 % n);
  for (;;) {
    const w = next();
    if (w < limit) return w % n;
  }
}

const chars = (s: string) => [...s];

/** How many values a space has (Infinity past 2^53). */
export function sizeOf(sp: Space): number {
  if (sp.k === "int") return sp.hi - sp.lo + 1;
  if (sp.k === "names") return sp.values.length;
  return chars(sp.chars).length ** sp.n;
}

/** The value a stream gives, in its canonical text: a number's digits, a code, a value's name. */
function valueFrom(next: () => number, sp: Space): string {
  if (sp.k === "int") return String(sp.lo + uniform(next, sp.hi - sp.lo + 1));
  if (sp.k === "names") return sp.values[uniform(next, sp.values.length)];
  const cs = chars(sp.chars);
  let out = "";
  for (let i = 0; i < sp.n; i++) out += cs[uniform(next, cs.length)];
  return out;
}

/** Every value of a small space, in order (numbers up, the alphabet's order, a choice's order). */
function every(sp: Space): string[] {
  if (sp.k === "int") return Array.from({ length: sp.hi - sp.lo + 1 }, (_, i) => String(sp.lo + i));
  if (sp.k === "names") return [...sp.values];
  const cs = chars(sp.chars);
  const out: string[] = [];
  const total = cs.length ** sp.n;
  for (let i = 0; i < total; i++) {
    let s = "";
    for (let j = 0, x = i; j < sp.n; j++, x = Math.floor(x / cs.length)) s = cs[x % cs.length] + s;
    out.push(s);
  }
  return out;
}

const place = (site: string, row: number, index: number) => `${site}|${row}|${index}`;

/** `a random @T`: one value (index 0), or the index-th of `n random @T`. */
export function drawOne(src: Source, site: string, row: number, index: number, sp: Space): string {
  const key = place(site, row, index);
  const v = src.steer?.take(key, 0) ?? valueFrom(stream(src.seed, key), sp);
  src.steer?.drawn(key, v);
  return v;
}

/** `<n> random @T`: n independent values (they may repeat). */
export function drawMany(src: Source, site: string, row: number, count: number, sp: Space): string[] {
  return Array.from({ length: Math.max(0, Math.floor(count)) }, (_, i) => drawOne(src, site, row, i, sp));
}

/**
 * `a random @T not among …`: a value not in `taken`, uniform over the free ones; null when every value
 * is taken. Attempt k is the draw at index k; a taken value (drawn or steered) is skipped. When half or
 * more of a small space is taken it lists the free values and picks one, so it always ends.
 */
export function drawNotAmong(src: Source, site: string, row: number, sp: Space, taken: string[]): string | null {
  const used = new Set(taken);
  const size = sizeOf(sp);
  for (let attempt = 0; ; attempt++) {
    const key = place(site, row, attempt);
    const steered = src.steer?.take(key, 0) ?? null;
    if (steered !== null) {
      if (used.has(steered)) continue;
      src.steer?.drawn(key, steered);
      return steered;
    }
    if (size <= 2 ** 32 && used.size * 2 >= size) {
      const free = every(sp).filter((v) => !used.has(v));
      if (!free.length) return null;
      const v = free[uniform(stream(src.seed, key), free.length)];
      src.steer?.drawn(key, v);
      return v;
    }
    const v = valueFrom(stream(src.seed, key), sp);
    if (used.has(v)) continue;
    src.steer?.drawn(key, v);
    return v;
  }
}

/** `@xs shuffled`: the same items in a uniformly random order (Fisher–Yates, Durstenfeld). */
export function drawShuffle<T>(src: Source, site: string, row: number, xs: T[]): T[] {
  const key = place(site, row, 0);
  const steered = src.steer?.take(key, xs.length) ?? null;
  let out = [...xs];
  if (steered === "reverse") out.reverse();
  else if (steered !== "keep") {
    const next = stream(src.seed, key);
    for (let i = out.length - 1; i > 0; i--) {
      const j = uniform(next, i + 1);
      [out[i], out[j]] = [out[j], out[i]];
    }
  }
  src.steer?.drawn(key, steered ?? "random");
  return out;
}

/** `a random one of @xs`: one item, uniformly; null for an empty list. A steered pick counts from 1 (past the end: the last). */
export function drawPick<T>(src: Source, site: string, row: number, xs: T[]): T | null {
  if (!xs.length) return null;
  const key = place(site, row, 0);
  const steered = src.steer?.take(key, xs.length) ?? null;
  const i = steered !== null && /^\d+$/.test(steered) && Number(steered) >= 1 ? Math.min(Number(steered), xs.length) - 1 : uniform(stream(src.seed, key), xs.length);
  src.steer?.drawn(key, String(i + 1));
  return xs[i];
}

/** Crockford's 32 (no I, L, O, U): what `unambiguous letters and digits` draws from (read as input by api.ts's readCode). */
export const CROCKFORD = "0123456789ABCDEFGHJKMNPQRSTVWXYZ";
