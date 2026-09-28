// A screen's calls in the browser (runtime/ts/calls.ts), without an LLM: where an api lives comes from
// the deployment (the page's meta tags), never from the page's address; an undo's idempotency key is a
// fixed-length hex digest any header carries, and names the call it takes back; a new key is 128 bits
// from the CSPRNG, also where `randomUUID` is missing (plain http).
import assert from "node:assert/strict";
import { apiBase, keyFor, newKey, noteAnswer, setApiBases, type CallOut } from "../runtime/ts/calls.ts";

const g = globalThis as Record<string, unknown>;

// ---------------------------------------------------------------- H1: the api's address is deployment, not a link
{
  g.location = { search: "?api=https://evil.example&api.pay=https://evil.example" };
  setApiBases(undefined);
  assert.equal(apiBase("pay"), "", "a link cannot send calls (and their keys) elsewhere: the page's own origin");
  assert.equal(apiBase(), "");
  // The deployment says it in the page: one meta per api, or one for every api.
  const metas = [{ getAttribute: () => "pay=https://pay.example/api/" }, { getAttribute: () => "https://all.example" }, { getAttribute: () => "desk=javascript:alert(1)" }];
  g.document = { querySelectorAll: (sel: string) => (sel === 'meta[name="intent-api"]' ? metas : []) };
  setApiBases(undefined);
  assert.equal(apiBase("pay"), "https://pay.example/api");
  assert.equal(apiBase("desk"), "https://all.example", "a meta that is not an http(s) address or a path is ignored");
  setApiBases({ pay: "http://localhost:3000" });
  assert.equal(apiBase("pay"), "http://localhost:3000", "a test sets the addresses itself");
  setApiBases(undefined);
  delete g.location;
  delete g.document;
}

// ---------------------------------------------------------------- H6: an undo's key
{
  const undo: CallOut = { endpoint: "pay.refund", args: { id: 7, note: "Zoë – €5\nnext line" }, undo: true, of: { endpoint: "pay.charge", answer: { id: 7, amount: 5 } } };
  const k = keyFor(undo);
  assert.match(k, /^undo-[0-9a-f]{64}$/, "hex, fixed length, whatever the args hold");
  assert.doesNotThrow(() => new Headers({ "idempotency-key": k }), "a real Headers object carries it");
  assert.equal(keyFor({ ...undo }), k, "the same undo, the same key: undoing twice is answered once");
  // Two charges with the same answer: undoing the second is another request than undoing the first.
  noteAnswer({ endpoint: "pay.charge", args: { amount: 5 }, key: "k-first" }, { endpoint: "pay.charge", status: 201, body: { id: 7, amount: 5 } });
  const first = keyFor(undo);
  noteAnswer({ endpoint: "pay.charge", args: { amount: 5 }, key: "k-second" }, { endpoint: "pay.charge", status: 201, body: { amount: 5, id: 7, note: null } });
  const second = keyFor(undo);
  assert.notEqual(first, second, "the key names the call it takes back");
  assert.notEqual(first, k);
  assert.equal(keyFor(undo), second, "and stays the same for that call");
}

// ---------------------------------------------------------------- M2: new keys from the CSPRNG only
{
  const crypto = globalThis.crypto;
  const random = Math.random;
  const now = Date.now;
  try {
    Object.defineProperty(globalThis, "crypto", { value: { getRandomValues: (b: Uint8Array<ArrayBuffer>) => crypto.getRandomValues(b) }, configurable: true });
    Math.random = () => {
      throw new Error("Math.random");
    };
    Date.now = () => {
      throw new Error("Date.now");
    };
    const a = newKey();
    assert.match(a, /^[0-9a-f]{32}$/, "128 bits from getRandomValues, also without randomUUID (plain http)");
    assert.notEqual(newKey(), a);
    Object.defineProperty(globalThis, "crypto", { value: undefined, configurable: true });
    assert.throws(() => newKey(), /no cryptographic random source/, "never a guessable key");
  } finally {
    Object.defineProperty(globalThis, "crypto", { value: crypto, configurable: true });
    Math.random = random;
    Date.now = now;
  }
}

console.log("ok calls: the api's address from the deployment only, an undo's key (hex, names what it undoes), new keys from the CSPRNG");
