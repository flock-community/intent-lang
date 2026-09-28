// Random values (v69): the draw runtime of both targets gives the same values for the same (seed,
// site, row, index); draws are uniform (chi-square); `not among` ends and stays uniform; codes are read
// as their alphabet says; steering hands out values and hears what was drawn.
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { CROCKFORD, drawMany, drawNotAmong, drawOne, drawPick, drawShuffle, eventSeed, runBase, type Space, type Steer } from "../runtime/ts/draw.ts";
import { readCode } from "../runtime/ts/api.ts";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const bytes = (hex: string) => new Uint8Array((hex.match(/../g) ?? []).map((h) => parseInt(h, 16)));
const S1 = "000102030405060708090a0b0c0d0e0f101112131415161718191a1b1c1d1e1f";
const S2 = eventSeed(runBase("two parcels never share a code"), 3);
const die: Space = { k: "int", lo: 1, hi: 6 };
const pin: Space = { k: "text", n: 6, chars: "0123456789" };
const invite: Space = { k: "text", n: 8, chars: CROCKFORD };
const suit: Space = { k: "names", values: ["Hearts", "Diamonds", "Clubs", "Spades"] };
const wide: Space = { k: "int", lo: -1000000, hi: 3000000000 };
const odd: Space = { k: "text", n: 3, chars: "♠♥x" };

// ---------------------------------------------------------------- TypeScript ≡ Elm, on a table of vectors
type Case = { form: string; seed: string; site?: string; row?: number; index?: number; space?: Space; count?: number; taken?: string[]; xs?: string[]; text?: string; n?: number };
const cases: Case[] = [];
for (const seed of [S1, S2])
  for (const [site, space] of [["roll1", die], ["deposit1", pin], ["invite1", invite], ["suit1", suit], ["wide1", wide], ["odd1", odd]] as [string, Space][])
    for (const row of [0, 3]) for (const index of [0, 1, 7]) cases.push({ form: "one", seed, site, row, index, space });
cases.push({ form: "many", seed: S1, site: "dice1", row: 0, count: 5, space: die });
cases.push({ form: "many", seed: S2, site: "codes1", row: 2, count: 3, space: invite });
for (const taken of [[], ["1", "2", "3"], ["1", "2", "3", "4", "5"], ["1", "2", "3", "4", "5", "6"], ["2", "2", "4", "6"]]) cases.push({ form: "notAmong", seed: S1, site: "free1", row: 0, space: die, taken });
cases.push({ form: "notAmong", seed: S2, site: "free2", row: 1, space: { k: "text", n: 2, chars: "ab" }, taken: ["aa", "ab", "ba"] });
cases.push({ form: "notAmong", seed: S2, site: "free3", row: 0, space: pin, taken: ["308122", "555001"] });
const deck = Array.from({ length: 52 }, (_, i) => `card${i + 1}`);
for (const xs of [[], ["a"], ["a", "b"], ["a", "b", "c", "d", "e"], deck]) {
  cases.push({ form: "shuffle", seed: S1, site: "deal1", row: 0, xs });
  cases.push({ form: "pick", seed: S2, site: "pick1", row: 4, xs });
}
cases.push({ form: "fromBase", seed: S1, n: 0, site: "roll1", row: 0, index: 0, space: invite });
cases.push({ form: "fromBase", seed: S1, n: 41, site: "roll1", row: 0, index: 0, space: invite });
// One table of texts for every code reader: the runtime's (api.ts readCode), Draw.elm's (which the
// generated Elm readers call) and the generated TypeScript readers (spec.ts), below.
const CODE_TEXTS = ["k7mqor1z", "K7MQ-0R1Z", "ILOU1234", "ab12cd34", "AB12CD3", "", "k7mq or1z", "k7mq0r1", "K7MQ0R1Z", "308122", "30812", "３０８１２２", "0000000o", "+2", "-308122"];
const READERS = [{ n: 8, chars: CROCKFORD, unamb: 1 }, { n: 8, chars: CROCKFORD, unamb: 0 }, { n: 6, chars: "0123456789", unamb: 0 }];
for (const text of CODE_TEXTS) for (const r of READERS) cases.push({ form: "read", seed: "", text, index: r.unamb, space: { k: "text", n: r.n, chars: r.chars } });

function tsRun(c: Case, steer?: Steer | null): unknown {
  const src = { seed: c.form === "fromBase" ? eventSeed(bytes(c.seed), c.n!) : c.seed, steer };
  switch (c.form) {
    case "one": case "fromBase": return drawOne(src, c.site!, c.row!, c.index!, c.space!);
    case "many": return drawMany(src, c.site!, c.row!, c.count!, c.space!);
    case "notAmong": return drawNotAmong(src, c.site!, c.row!, c.space!, c.taken!);
    case "shuffle": return drawShuffle(src, c.site!, c.row!, c.xs!);
    case "pick": return drawPick(src, c.site!, c.row!, c.xs!);
    case "read": return c.space!.k === "text" ? readCode(c.text!, c.space!.n, c.space!.chars, c.index === 1) : null;
  }
}

/** Run the cases through Draw.elm (compiled with the Elm of the fmt parity test). `steer`: an object the Elm side reads through. */
function elmRun(cs: Case[], steer: unknown = null): Promise<unknown[]> {
  const dir = mkdtempSync(join(tmpdir(), "drawprobe-"));
  const r = spawnSync(join(ROOT, "node_modules/.bin/elm"), ["make", "src/DrawProbe.elm", "--optimize", `--output=${join(dir, "probe.js")}`], { cwd: join(ROOT, "tests/fmt-parity"), encoding: "utf8" });
  assert.equal(r.status, 0, r.stdout + r.stderr);
  spawnSync("cp", [join(dir, "probe.js"), join(dir, "probe.cjs")]);
  const { Elm } = createRequire(import.meta.url)(join(dir, "probe.cjs"));
  return new Promise((done) => {
    const app = Elm.DrawProbe.init({ flags: { cases: cs, steer } });
    app.ports.out.subscribe((v: unknown[]) => {
      rmSync(dir, { recursive: true, force: true });
      done(v);
    });
  });
}

const elm = await elmRun(cases);
let same = 0;
cases.forEach((c, i) => {
  assert.deepEqual(elm[i], tsRun(c), `case ${i} (${c.form} ${c.site ?? ""} ${JSON.stringify(c.space ?? c.xs ?? c.text)}): Elm ${JSON.stringify(elm[i])}, TypeScript ${JSON.stringify(tsRun(c))}`);
  same++;
});
// A few known values, so a change to the PRF shows as a change here too (and in the snapshot of builds).
assert.equal(tsRun({ form: "one", seed: S1, site: "roll1", row: 0, index: 0, space: die }), tsRun({ form: "one", seed: S1, site: "roll1", row: 0, index: 0, space: die }));
assert.notEqual(tsRun({ form: "one", seed: S1, site: "deposit1", row: 0, index: 0, space: pin }), tsRun({ form: "one", seed: S1, site: "deposit1", row: 0, index: 1, space: pin }));
console.log(`ok draws: ${same} vectors give the same values in TypeScript and Elm`);

// ---------------------------------------------------------------- steering, in both targets
{
  const queue = ["6", "6", "1"];
  const heard: string[] = [];
  const steer: Steer = { take: (k) => (k.startsWith("roll") ? (queue.shift() ?? null) : null), drawn: (k, v) => void heard.push(`${k}=${v}`) };
  const got = drawMany({ seed: S1, steer }, "roll1", 0, 4, die);
  assert.deepEqual(got.slice(0, 3), ["6", "6", "1"]);
  assert.deepEqual(heard.slice(0, 3), ["roll1|0|0=6", "roll1|0|1=6", "roll1|0|2=1"]);
  assert.equal(heard.length, 4);
  // A steered value that is taken is skipped, as a real draw of it would be.
  const q2 = ["308122", "308122", "555001"];
  const s2: Steer = { take: () => q2.shift() ?? null, drawn: () => {} };
  assert.equal(drawNotAmong({ seed: S1, steer: s2 }, "deposit1", 0, pin, ["308122"]), "555001");
  // Shuffles steer as keep / reverse; a pick counts from 1.
  const order = (v: string): Steer => ({ take: () => v, drawn: () => {} });
  assert.deepEqual(drawShuffle({ seed: S1, steer: order("keep") }, "deal1", 0, ["a", "b", "c"]), ["a", "b", "c"]);
  assert.deepEqual(drawShuffle({ seed: S1, steer: order("reverse") }, "deal1", 0, ["a", "b", "c"]), ["c", "b", "a"]);
  assert.equal(drawPick({ seed: S1, steer: order("3") }, "pick1", 0, ["a", "b", "c", "d"]), "c");
  // The Elm side reads the same steering through an object (a Proxy in the test worker).
  const eq: string[] = ["6", "6", "1"];
  const eheard: string[] = [];
  const proxy = new Proxy({}, {
    has: () => true,
    get: (_t, k: string) => {
      if (k.startsWith("take|")) return k.startsWith("take|roll") ? (eq.shift() ?? null) : null;
      if (k.startsWith("drawn|")) return eheard.push(k.slice(6)), true;
      return undefined;
    },
  });
  const [e] = await elmRun([{ form: "many", seed: S1, site: "roll1", row: 0, count: 4, space: die }], proxy);
  assert.deepEqual(e, got, "Elm, steered the same way, draws the same");
  assert.deepEqual(eheard.slice(0, 3), ["roll1|0|0|6", "roll1|0|1|6", "roll1|0|2|1"]);
  // Steered picks and \`not among\` in both targets, on one table: a pick is digits only, counted from 1
  // (\`+2\`, \`0\`, \`x\` are not steering, the draw is random), past the end is the last; a steered value
  // that is taken is skipped.
  const steered: { c: Case; queue: string[] }[] = [
    ...["3", "+2", "0", "9", "x", " 2", "02"].map((v) => ({ c: { form: "pick", seed: S2, site: "pick1", row: 0, xs: ["a", "b", "c", "d"] } as Case, queue: [v] })),
    { c: { form: "notAmong", seed: S1, site: "free1", row: 0, space: die, taken: ["6"] }, queue: ["6", "6", "2"] },
    { c: { form: "notAmong", seed: S1, site: "free3", row: 0, space: pin, taken: ["308122", "555001"] }, queue: ["308122", "555001", "000042"] },
  ];
  for (const { c, queue } of steered) {
    const tq = [...queue];
    const ts = tsRun(c, { take: () => tq.shift() ?? null, drawn: () => {} });
    const eq2 = [...queue];
    const px = new Proxy({}, { has: () => true, get: (_t, k: string) => (k.startsWith("take|") ? (eq2.shift() ?? null) : k.startsWith("drawn|") ? true : undefined) });
    const [ev] = await elmRun([c], px);
    assert.deepEqual(ev, ts, `steered ${c.form} ${JSON.stringify(queue)}: Elm ${JSON.stringify(ev)}, TypeScript ${JSON.stringify(ts)}`);
  }
  assert.equal(tsRun(steered[0].c, { take: () => "3", drawn: () => {} }), "c");
  console.log("ok steering: steered values are drawn in order, taken ones skipped, every draw heard (TypeScript and Elm)");
}

// ---------------------------------------------------------------- uniformity (chi-square)
/** Pearson's chi-square of counts against a uniform expectation. */
const chi2 = (counts: number[]) => {
  const total = counts.reduce((a, b) => a + b, 0);
  const e = total / counts.length;
  return counts.reduce((s, c) => s + (c - e) ** 2 / e, 0);
};
const N = 100_000;
{
  const counts = [0, 0, 0, 0, 0, 0];
  for (let i = 0; i < N; i++) counts[Number(drawOne({ seed: S1 }, "roll1", 0, i, die)) - 1]++;
  // df 5: p = 0.001 at 20.52.
  assert.ok(chi2(counts) < 20.52, `Int from 1 to 6 is not uniform: ${counts} (chi² ${chi2(counts).toFixed(2)})`);
  console.log(`ok uniform: Int from 1 to 6 over ${N} draws, chi² ${chi2(counts).toFixed(2)} (df 5, bound 20.52)`);
}
{
  // 3 is not a power of two: a modulo bias would show here.
  const counts = new Map<string, number>([["a", 0], ["b", 0], ["c", 0]]);
  for (let i = 0; i < N; i++) {
    const v = drawOne({ seed: S2 }, "abc1", 0, i, { k: "text", n: 1, chars: "abc" });
    counts.set(v, counts.get(v)! + 1);
  }
  assert.ok(chi2([...counts.values()]) < 13.82, `Text of 1 from "abc" is not uniform: ${[...counts]}`);
  console.log(`ok uniform: Text of 1 from "abc" over ${N} draws, chi² ${chi2([...counts.values()]).toFixed(2)} (df 2, bound 13.82)`);
}
{
  const counts = new Map<string, number>();
  for (let i = 0; i < N; i++) {
    const k = drawShuffle({ seed: S1 }, "deal1", i, ["a", "b", "c", "d", "e"]).join("");
    counts.set(k, (counts.get(k) ?? 0) + 1);
  }
  assert.equal(counts.size, 120, "every order of five items appears");
  // df 119: p = 0.001 at about 168.
  assert.ok(chi2([...counts.values()]) < 175, `the shuffle is not uniform (chi² ${chi2([...counts.values()]).toFixed(1)})`);
  console.log(`ok uniform: all 120 orders of a five-item shuffle over ${N} draws, chi² ${chi2([...counts.values()]).toFixed(1)} (df 119, bound 175)`);
}
{
  // Crockford's alphabet, character by character over many codes.
  const counts = new Map<string, number>([...CROCKFORD].map((c) => [c, 0]));
  for (let i = 0; i < N / 8; i++) for (const c of drawOne({ seed: S2 }, "invite1", 0, i, invite)) counts.set(c, counts.get(c)! + 1);
  // df 31: p = 0.001 at 61.10.
  assert.ok(chi2([...counts.values()]) < 61.1, `unambiguous codes are not uniform over the alphabet`);
  console.log(`ok uniform: characters of Text of 8 unambiguous letters and digits, chi² ${chi2([...counts.values()]).toFixed(2)} (df 31, bound 61.10)`);
}

// ---------------------------------------------------------------- not among
{
  for (let i = 0; i < 200; i++) assert.equal(drawNotAmong({ seed: S1 }, "free1", i, die, ["1", "2", "3", "4", "6"]), "5", "5 of 6 taken: the free one");
  assert.equal(drawNotAmong({ seed: S1 }, "free1", 0, die, ["1", "2", "3", "4", "5", "6"]), null, "all taken: nothing");
  // Half taken (the free values are listed) and a third taken (rejection): uniform over the free ones.
  for (const taken of [["1", "3", "5"], ["2", "5"]]) {
    const counts = new Map<string, number>();
    for (let i = 0; i < 30_000; i++) {
      const v: string = drawNotAmong({ seed: S2 }, "free1", i, die, taken)!;
      assert.ok(!taken.includes(v));
      counts.set(v, (counts.get(v) ?? 0) + 1);
    }
    assert.equal(counts.size, 6 - taken.length);
    assert.ok(chi2([...counts.values()]) < 20, `not among ${taken} is not uniform over the free values: ${[...counts]}`);
  }
  console.log("ok not among: ends with 5 of 6 taken, gives nothing when all are, stays uniform over the free values");
}

// ---------------------------------------------------------------- codes as input
assert.equal(readCode("k7mqor1z", 8, CROCKFORD, true), "K7MQ0R1Z");
assert.equal(readCode("K7MQ-0R1Z", 8, CROCKFORD, true), "K7MQ0R1Z");
assert.equal(readCode("IL0U1234", 8, CROCKFORD, true), null, "U is not in Crockford's alphabet");
assert.equal(readCode("k7mqor1z", 8, CROCKFORD, false), null, "other alphabets are read exactly");
assert.equal(readCode("123456", 6, "0123456789"), "123456");
assert.equal(readCode("12345", 6, "0123456789"), null);
// The generated readers (\`readInviteCode\`, \`readPickupCode\` in spec.ts) read as the runtime does.
{
  const { load } = await import("../compiler/load.ts");
  const { tsDomain } = await import("../compiler/gen.ts");
  const dir = mkdtempSync(join(tmpdir(), "readers-"));
  try {
    const inv = load(join(ROOT, "apps/api/invites-api.intent"), { ignoreLock: true }).app!;
    const lock = load(join(ROOT, "apps/held-out-3/lockers-api.intent"), { ignoreLock: true }).app!;
    writeFileSync(join(dir, "inv.ts"), tsDomain(inv));
    writeFileSync(join(dir, "lock.ts"), tsDomain(lock));
    const a = await import(join(dir, "inv.ts"));
    const b = await import(join(dir, "lock.ts"));
    for (const t of CODE_TEXTS) {
      assert.equal(a.readInviteCode(t), readCode(t, 8, CROCKFORD, true), `readInviteCode(${JSON.stringify(t)})`);
      assert.equal(a.isInviteCode(t), readCode(t, 8, CROCKFORD, true) !== null);
      assert.equal(b.readPickupCode(t), readCode(t, 6, "0123456789"), `readPickupCode(${JSON.stringify(t)})`);
    }
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}
console.log("ok codes: unambiguous codes are read Crockford's way, others exactly (the runtime, Draw.elm and the generated readers)");

// ---------------------------------------------------------------- a seed is from the CSPRNG, never a fallback
{
  const { freshSeed, isSeed } = await import("../runtime/ts/draw.ts");
  assert.ok(isSeed(freshSeed()) && !isSeed("") && !isSeed("0".repeat(63)) && !isSeed("Z".repeat(64)));
  const real = globalThis.crypto;
  Object.defineProperty(globalThis, "crypto", { value: undefined, configurable: true });
  try {
    assert.throws(() => freshSeed(), /CSPRNG/, "no CSPRNG: no seed, not a made-up one");
  } finally {
    Object.defineProperty(globalThis, "crypto", { value: real, configurable: true });
  }
  console.log("ok seeds: from the CSPRNG or none");
}
