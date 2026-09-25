// std.crypto's sha256 against Node's, on lengths around the 64-byte blocks and on random text.
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { sha256 } from "../runtime/ts/platform/std.crypto.ts";

const node = (s: string) => createHash("sha256").update(s, "utf8").digest("hex");
let n = 0;
for (let len = 0; len <= 200; len++) (assert.equal(sha256("a".repeat(len)), node("a".repeat(len)), `length ${len}`), n++);
const chars = "aZ09 !é€𝄞中\n\t";
let seed = 7;
const rnd = () => ((seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff);
for (let i = 0; i < 300; i++) {
  const s = Array.from({ length: Math.floor(rnd() * 300) }, () => [...chars][Math.floor(rnd() * [...chars].length)]).join("");
  assert.equal(sha256(s), node(s));
  n++;
}
console.log(`ok sha256: ${n} inputs match Node's`);
