// The durable outbox (runtime/ts/outbox.ts): a call is kept with its key until it is answered, so a
// reload sends an unanswered call again with the same key.
import assert from "node:assert/strict";
import { outbox, type Pending } from "../runtime/ts/outbox.ts";

const map = new Map<string, string>();
const store = { getItem: (k: string) => map.get(k) ?? null, setItem: (k: string, v: string) => void map.set(k, v) };
const call = (key: string, endpoint = "pay.charge"): Pending => ({ key, endpoint, args: { amount: 1 } });

const box = outbox("out", store);
assert.deepEqual(box.pending(), [], "nothing pending at the start");
box.put(call("k1"));
box.put(call("k2", "pay.refund"));
assert.deepEqual(box.pending().map((c) => c.key), ["k1", "k2"], "calls go in");

// A reload: a new outbox over the same storage still has them.
const afterReload = outbox("out", store);
assert.deepEqual(afterReload.pending().map((c) => c.key), ["k1", "k2"], "a reload keeps the calls");
afterReload.done("k1");
assert.deepEqual(afterReload.pending().map((c) => c.key), ["k2"], "an answered call is cleared");

// The same key replaces the entry (a double click is one call), and a corrupt store is empty.
afterReload.put(call("k2", "pay.charge"));
assert.equal(outbox("out", store).pending().length, 1, "the same key replaces");
map.set("out", "{not json");
assert.deepEqual(outbox("out", store).pending(), [], "unreadable storage is empty");
assert.deepEqual(outbox("out", undefined).pending(), [], "no storage: the outbox still works");

console.log("ok outbox: durable, keyed, cleared on answer, tolerant of bad storage");
