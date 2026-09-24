// The service side of "effectively once" (runtime/ts/once.ts), against the IETF draft's rules.
import assert from "node:assert/strict";
import { fingerprint, keyed, recall, remember, type Keys } from "../runtime/ts/once.ts";

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
console.log("ok once: replay, conflict, per caller, expiry, safe methods");
