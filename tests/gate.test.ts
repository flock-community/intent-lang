// The agreement gate (runtime/ts/calls.ts): send / hold / reject / stop, and the bounds a standing
// permission enforces (count, period, amount, four eyes).
import assert from "node:assert/strict";
import { gate } from "../runtime/ts/calls.ts";

const perm = (o: Record<string, unknown> = {}) => ({ endpoint: "pay.charge", count: 1, per: 0, upTo: 0, approver: "Sam", ...o });
const cfg = (o: Record<string, unknown> = {}) => ({ agree: [], rejected: [], stop: false, fourEyes: false, requester: "", ...o });

assert.equal(gate(undefined, "pay.charge", true), "send", "no std.actions: nothing is gated");
assert.equal(gate(cfg({ agree: [perm()] }), "pay.charge", true), "send", "a permission sends");
assert.equal(gate(cfg(), "pay.charge", true), "hold", "no permission holds");
assert.equal(gate(cfg({ agree: [perm({ endpoint: "charge" })] }), "pay.charge", true), "send", "a short endpoint name in the permission matches");
assert.equal(gate(cfg({ agree: [perm()] }), "pay.refund", true), "hold", "another endpoint is not covered");
assert.equal(gate(cfg({ agree: [perm()] }), "pay.getCharge", false), "send", "a non-external call is not gated");
assert.equal(gate(cfg({ stop: true, agree: [perm()] }), "pay.charge", true), "stop", "the emergency stop wins");
assert.equal(gate(cfg({ rejected: ["pay.charge"] }), "pay.charge", true), "reject", "a rejected endpoint is dropped");
assert.equal(gate(cfg({ agree: [perm()] }), "pay.charge", true, { amount: 1 }, { "pay.charge": [{ at: 0, amount: 1 }] }, 0), "hold", "the count is spent");
assert.equal(gate(cfg({ agree: [perm({ count: 2 })] }), "pay.charge", true, { amount: 1 }, { "pay.charge": [{ at: 0, amount: 1 }] }, 0), "send", "the count is not spent");
assert.equal(gate(cfg({ agree: [perm({ per: 1 })] }), "pay.charge", true, { amount: 1 }, { "pay.charge": [{ at: 0, amount: 1 }] }, 120_000), "send", "outside the period");
assert.equal(gate(cfg({ agree: [perm({ upTo: 50 })] }), "pay.charge", true, { amount: 100 }), "hold", "over the amount");
assert.equal(gate(cfg({ agree: [perm({ upTo: 500 })] }), "pay.charge", true, { amount: 100 }), "send", "within the amount");
assert.equal(gate(cfg({ agree: [perm({ approver: "Ann" })], fourEyes: true, requester: "Ann" }), "pay.charge", true), "hold", "four eyes: the requester cannot approve their own call");
assert.equal(gate(cfg({ agree: [perm({ approver: "Sam" })], fourEyes: true, requester: "Ann" }), "pay.charge", true), "send", "four eyes: another person approves");

console.log("ok gate: send/hold/reject/stop, count, period, amount and four eyes");
