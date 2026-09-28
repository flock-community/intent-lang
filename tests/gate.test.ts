// The agreement (runtime/ts/calls.ts): the gate (send / hold / stop, and the bounds a standing
// permission enforces: count, period, amount, four eyes), and the agreement a screen runs with it
// (a rejection drops the calls held when it is given; what was let through survives a reload).
import assert from "node:assert/strict";
import { agreement, gate, type CallDesc, type CallOut } from "../runtime/ts/calls.ts";
import { keep, memory } from "../runtime/ts/outbox.ts";

const charge: CallDesc = { name: "pay.charge", method: "POST", path: "/charges", params: [{ in: "body", name: "amount" }], external: true, amount: "amount" };
const unmeasured: CallDesc = { ...charge, amount: undefined };
const read: CallDesc = { name: "pay.getCharge", method: "GET", path: "/charges/{id}", params: [] };
const perm = (o: Record<string, unknown> = {}) => ({ endpoint: "pay.charge", count: 1, per: null, upTo: null, approver: "Sam", ...o });
const cfg = (o: Record<string, unknown> = {}) => ({ agree: [], rejected: [], stop: false, fourEyes: false, requester: null, ...o });
const by = (p: ReturnType<typeof perm>, n = 1) => `${JSON.stringify([p.endpoint, p.count, p.per, p.upTo, p.approver])}#${n}`;

// The gate.
assert.equal(gate(undefined, charge), "send", "no std.actions: nothing is gated");
assert.equal(gate(cfg({ agree: [perm()] }), charge), "send", "a permission sends");
assert.equal(gate(cfg(), charge), "hold", "no permission holds");
assert.equal(gate(cfg({ agree: [perm({ endpoint: "charge" })] }), charge), "send", "a short endpoint name in the permission matches");
assert.equal(gate(cfg({ agree: [perm()] }), { ...charge, name: "pay.refund" }), "hold", "another endpoint is not covered");
assert.equal(gate(cfg(), read), "send", "a non-external call is not gated");
assert.equal(gate(cfg({ stop: true, agree: [perm()] }), charge), "stop", "the emergency stop wins");
assert.equal(gate(cfg({ agree: [perm()] }), charge, { amount: 1 }, [{ at: 0, by: by(perm()) }], 0), "hold", "the count is spent");
assert.equal(gate(cfg({ agree: [perm({ count: 2 })] }), charge, { amount: 1 }, [{ at: 0, by: by(perm({ count: 2 })) }], 0), "send", "the count is not spent");
assert.equal(gate(cfg({ agree: [perm({ per: 1 })] }), charge, { amount: 1 }, [{ at: 0, by: by(perm({ per: 1 })) }], 120_000), "send", "outside the period");
assert.equal(gate(cfg({ agree: [perm({ upTo: 50 })] }), charge, { amount: 100 }), "hold", "over the amount");
assert.equal(gate(cfg({ agree: [perm({ upTo: 500 })] }), charge, { amount: 100 }), "send", "within the amount");
assert.equal(gate(cfg({ agree: [perm({ upTo: 500 })] }), unmeasured, { amount: 100 }), "hold", "an amount limit on an endpoint that names no amount covers nothing");
assert.equal(gate(cfg({ agree: [perm({ upTo: 500 })] }), charge, { total: 100 }), "hold", "an amount limit and no amount sent: not covered");
assert.equal(gate(cfg({ agree: [perm({ approver: "Ann" })], fourEyes: true, requester: "Ann" }), charge), "hold", "four eyes: the requester cannot approve their own call");
assert.equal(gate(cfg({ agree: [perm({ approver: "Sam" })], fourEyes: true, requester: "Ann" }), charge), "send", "four eyes: another person approves");
// Two one-time grants are two payments: each permission counts the calls it let through.
assert.equal(gate(cfg({ agree: [perm(), perm()] }), charge, {}, [{ at: 0, by: by(perm(), 1) }], 0), "send", "a second one-time grant covers a second call");
assert.equal(gate(cfg({ agree: [perm(), perm()] }), charge, {}, [{ at: 0, by: by(perm(), 1) }, { at: 0, by: by(perm(), 2) }], 0), "hold", "both grants spent");

// The agreement a screen runs.
const call = (key: string, amount = 100): CallOut => ({ endpoint: "pay.charge", args: { amount }, key });
const store = memory();
let a = agreement([charge], keep("t", store));
let config: Record<string, unknown> = cfg();
const on = () => config;
assert.equal(a.offer(call("k1"), config, 0), "hold", "no permission: held");
config = cfg({ rejected: ["pay.charge"] });
assert.deepEqual(a.release(on, 0), { send: [], dropped: [call("k1")] }, "a rejection drops the call held when it is given");
assert.equal(a.offer(call("k2"), config, 0), "hold", "a later call is held again, not rejected for good");
assert.deepEqual(a.release(on, 0), { send: [], dropped: [] }, "the old rejection does not drop the new call");
config = cfg({ rejected: ["pay.charge"], agree: [perm()] });
assert.deepEqual(a.release(on, 0).send, [call("k2")], "approving lets the held call out with its key");
assert.equal(a.offer(call("k3"), config, 0), "hold", "a one-time grant is spent");
// A reload: a new agreement over the same storage keeps the held call and what the grant let through.
a = agreement([charge], keep("t", store));
assert.deepEqual(a.held(), [call("k3")], "the held call survives a reload");
assert.equal(a.offer(call("k4"), config, 0), "hold", "the spent grant stays spent after a reload");
config = cfg({ rejected: ["pay.charge"], agree: [perm(), perm()] });
assert.deepEqual(a.release(on, 0).send, [call("k3")], "a second grant lets one more held call out");
config = cfg({ rejected: ["pay.charge", "pay.charge"], agree: [perm(), perm()] });
assert.deepEqual(a.release(on, 0).dropped, [call("k4")], "a second rejection drops what is held then");
config = cfg({ stop: true, agree: [perm(), perm(), perm()] });
assert.equal(a.offer(call("k5"), config, 0), "stop", "the stop refuses at once");
config = cfg({ agree: [perm(), perm(), perm()] });
assert.equal(a.offer(call("k6"), config, 0), "send", "a stopped call did not spend the third grant");

console.log("ok gate: send/hold/stop, count, period, amount, four eyes; rejection per held call; kept across a reload");
