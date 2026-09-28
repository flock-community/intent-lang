// A host transport (OurOS): the host owns calls and events end to end, instead of the generated
// fetch/SSE. Set `globalThis.__intentTransport` before the app starts (docs/design/effects.md). The
// runtime is the same for both targets (the Elm glue calls fetchCall and listen from calls.ts).
import assert from "node:assert/strict";
import { fetchCall, listen, type CallDesc, type CallOut, type Outgoing, type Transport } from "../runtime/ts/calls.ts";

const host = globalThis as { __intentTransport?: Transport };
const eps: CallDesc[] = [{ name: "pay.charge", method: "POST", path: "/charges", params: [{ in: "body", name: "amount" }], external: true }];
// A client layer: puts the signed-in user's key on every request (std.http.sendKey).
let signedIn = "";
const via = (_alias: string, req: Outgoing): Outgoing => ({ ...req, headers: { ...req.headers, ...(signedIn ? { "x-api-key": signedIn } : {}) } });

// Calls: routed by endpoint, the HTTP-shaped request after the client layers.
const sent: (Outgoing & { alias: string; endpoint: string })[] = [];
let replies: { status: number; body?: unknown; inProgress?: boolean }[] = [];
const subscribed: { alias: string; req: Outgoing; onEvent: (e: { event: string; body: unknown }) => void; off: boolean }[] = [];
host.__intentTransport = {
  send: async (req) => (sent.push(req), replies.shift() ?? { status: 201, body: { id: 1 } }),
  listen: (alias, req, onEvent) => {
    const sub = { alias, req, onEvent, off: false };
    subscribed.push(sub);
    return () => (sub.off = true);
  },
};

signedIn = "k-ann";
const call: CallOut = { endpoint: "pay.charge", args: { amount: 1250 }, key: "k1" };
const a = await fetchCall(eps, call, via);
assert.equal(a.status, 201, "the transport's status is the answer");
assert.deepEqual(a.body, { id: 1 }, "the transport's body is the answer");
assert.equal(sent[0].endpoint, "pay.charge", "the transport gets the endpoint to route by");
assert.equal(sent[0].alias, "pay", "and the alias");
assert.equal(sent[0].headers["idempotency-key"], "k1", "with the idempotency key");
assert.equal(sent[0].headers["x-api-key"], "k-ann", "and what the client layers add");
assert.deepEqual(sent[0].body, { amount: 1250 }, "the body is the call's args");

// Sending again: over the transport too, with the same key; no answer at the end is `unknown`.
sent.length = 0;
replies = [{ status: 503 }, { status: 201, body: { id: 2 } }];
assert.equal((await fetchCall(eps, { ...call, key: "k2" }, via)).status, 201, "a 503 from the host is sent again");
assert.deepEqual(sent.map((r) => r.headers["idempotency-key"]), ["k2", "k2"], "with the same key");
replies = [{ status: 409, inProgress: true }, { status: 201, body: { id: 3 } }];
assert.equal((await fetchCall(eps, { ...call, key: "k3" }, via)).status, 201, "still in progress: sent again");
replies = [{ status: 0 }, { status: 0 }, { status: 0 }];
assert.equal((await fetchCall(eps, { ...call, key: "k4" }, via)).unknown, true, "no answer after the last attempt: unknown");
host.__intentTransport.send = async () => {
  throw new Error("bus down");
};
const down = await fetchCall(eps, { ...call, key: "k5" }, via);
assert.ok(down.unknown && /bus down/.test(down.error ?? ""), "a transport that throws is no answer, never an exception");

// Events: one subscription per api the app has events for, with the layers' request.
const got: { event: string; body: unknown }[] = [];
signedIn = "";
const stream = listen({ pay: ["charged"], mail: [] }, (e) => got.push(e), via);
stream.refresh();
assert.deepEqual(subscribed.map((s) => s.alias), ["pay"], "only apis the app handles events of are subscribed, once");
assert.equal(subscribed[0].req.path, "/events", "the stream request goes to the host");
subscribed[0].onEvent({ event: "charged", body: { id: 9 } });
assert.deepEqual(got, [{ event: "pay.charged", body: { id: 9 } }], "the host's events reach the app, qualified by alias");
subscribed[0].onEvent({ event: "other", body: {} });
assert.equal(got.length, 1, "an event the app does not handle is dropped");
signedIn = "k-ann";
stream.refresh();
assert.equal(subscribed.length, 2, "signing in subscribes again");
assert.equal(subscribed[0].off, true, "and the old subscription is ended");
assert.equal(subscribed[1].req.headers["x-api-key"], "k-ann", "the new one carries what the layers add");

// A host that owns calls but has no `listen`: no events, and no stream to the page's own origin.
const realFetch = globalThis.fetch;
let fetched = 0;
globalThis.fetch = (async () => (fetched++, new Response(null))) as typeof fetch;
host.__intentTransport = { send: () => ({ status: 200 }) };
listen({ pay: ["charged"] }, () => {}, via);
assert.equal(fetched, 0, "without the host's listen, nothing is fetched");
globalThis.fetch = realFetch;

delete host.__intentTransport;
console.log("ok transport: a host owns calls (layers, keys, retries, unknown) and events (per api, again after a sign-in)");
