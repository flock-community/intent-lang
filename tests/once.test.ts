// The service side of "effectively once" (runtime/ts/once.ts), against the IETF draft's rules.
import assert from "node:assert/strict";
import { fingerprint, keyed, recall, remember, type Keys } from "../runtime/ts/once.ts";
import { keyFor, persist, retryAfter, type Answer, type CallDesc } from "../runtime/ts/calls.ts";

const keys: Keys = {};
const fp = fingerprint("POST", "/charges", { amount: 5, description: "x" });
assert.equal(recall(keys, "", "k1", fp, "2026-09-24T09:00"), undefined, "a new key runs");
remember(keys, "", "k1", { fingerprint: fp, endpoint: "charge", status: 201, body: { id: 1 }, at: "2026-09-24T09:00" });
assert.deepEqual(recall(keys, "", "k1", fp, "2026-09-24T10:00"), { replay: keys[" k1"] }, "the same key and request: the same answer");
assert.equal(fingerprint("POST", "/charges", { description: "x", amount: 5 }), fp, "the order of fields does not matter");
assert.ok("conflict" in (recall(keys, "", "k1", fingerprint("POST", "/charges", { amount: 6, description: "x" }), "2026-09-24T10:00") ?? {}), "the same key, another request: a conflict");
assert.equal(recall(keys, "ann", "k1", fp, "2026-09-24T10:00"), undefined, "keys are per caller");
assert.equal(recall(keys, "", "k1", fp, "2026-09-25T09:00"), undefined, "after 24 hours a key is forgotten");
remember(keys, "", "k2", { fingerprint: fp, endpoint: "charge", status: 201, body: { id: 2 }, at: "2026-09-25T09:30" });
assert.equal(keys[" k1"], undefined, "expired keys are dropped when a new one is kept");
assert.ok(recall(keys, "", "k2", fp) && "replay" in recall(keys, "", "k2", fp)!, "without a clock, keys do not expire");
assert.ok(keyed("POST") && keyed("delete") && !keyed("GET"), "only non-safe methods are keyed");
// An undo's key is what it undoes: undoing twice sends the same key (the service replays the first).
const undo = { endpoint: "pay.refund", args: { id: 7 }, undo: true };
assert.equal(keyFor(undo), keyFor({ ...undo }), "the same undo, the same key");
assert.notEqual(keyFor(undo), keyFor({ ...undo, args: { id: 8 } }), "another charge's undo, another key");
assert.notEqual(keyFor({ endpoint: "pay.charge", args: {} }), keyFor({ endpoint: "pay.charge", args: {} }), "every other call gets a new key");
// Sending a call until it is answered: retried on no answer, 5xx, 429 and "still in progress".
const charge: CallDesc = { name: "pay.charge", method: "POST", path: "/charges", params: [], external: true };
const answers = (...xs: Partial<Answer>[]) => { let n = 0; return async () => ({ endpoint: "pay.charge", status: 0, ...xs[Math.min(n++, xs.length - 1)] }); };
assert.equal((await persist(charge, answers({ status: 503 }, { status: 201 }))).status, 201, "a 503 is sent again");
assert.equal((await persist(charge, answers({ status: 400 }, { status: 201 }))).status, 400, "a 400 is final");
assert.deepEqual(await persist(charge, answers({ status: 0, error: "gone" })), { endpoint: "pay.charge", status: 0, error: "gone", unknown: true }, "no answer on an external call is unknown");
const busy = await persist(charge, answers({ status: 409, inProgress: true }));
assert.ok(busy.unknown && busy.status === 0, "still in progress after the last attempt is unknown, not a failure");
assert.equal((await persist({ ...charge, external: false }, answers({ status: 0 }))).unknown, undefined, "a call without an outside effect just fails");
// Retry-After: the service says when to come back; the pause gets it, and the answer does not keep it.
assert.equal(retryAfter("3"), 3000, "seconds");
assert.equal(retryAfter("Wed, 21 Oct 2026 07:28:05 GMT", Date.parse("Wed, 21 Oct 2026 07:28:00 GMT")), 5000, "an HTTP date");
assert.equal(retryAfter("soon"), undefined, "anything else is ignored");
const waits: (number | undefined)[] = [];
const told = await persist(charge, answers({ status: 429, retryAfterMs: 1500 }, { status: 201 }), async (_n, last) => void waits.push(last.retryAfterMs));
assert.deepEqual(waits, [1500], "the pause is told how long the service asked for");
assert.equal(told.retryAfterMs, undefined);
console.log("ok once: replay, conflict, per caller, expiry, safe methods, undo keys, retries, Retry-After and unknown");
