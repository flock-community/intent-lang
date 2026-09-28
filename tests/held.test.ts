// The agreement as the test driver runs it (compiler/exec.ts): a call no permission covers is held,
// and the screen hears `its status is held` at once (heldAnswer); a rejection drops the held call and
// the screen hears `its status is rejected` (rejectedAnswer); a permission lets a later held call out
// with its key, and its real answer follows. The build here is a stand-in with the same interface as a
// compiled one (test.mjs), so the driver's own behaviour is what is tested, without an LLM.
import assert from "node:assert/strict";
import { harnessKey } from "../compiler/keys.ts";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runJobs, type Action } from "../compiler/exec.ts";

const dir = mkdtempSync(join(tmpdir(), "held-"));
const provider = join(dir, "provider");
mkdirSync(provider);
// The provider: every charge is taken (201), and the idempotency key it got is echoed back.
writeFileSync(
  join(provider, "test.mjs"),
  `let n = 0;
export function start() {
  return { send: (method, path, query, body, headers) => ({ status: 201, body: { id: ++n, amount: body.amount, key: headers["idempotency-key"] } }) };
}
`,
);
writeFileSync(
  join(dir, "providers.json"),
  JSON.stringify({ endpoints: [{ name: "pay.charge", method: "POST", path: "/charges", params: [{ in: "body", name: "amount" }], external: true, amount: "amount" }], providers: { pay: provider } }),
);
// The app: Buy calls pay.charge; Allow adds a one-time permission, Reject rejects the calls waiting now.
// Its message shows the last answer it heard, as `on answer pay.charge` would.
writeFileSync(
  join(dir, "test.mjs"),
  `export function start() {
  const m = { agree: [], rejected: [], message: "", heard: [], out: [] };
  const config = () => ({ agree: m.agree, rejected: m.rejected, stop: false, fourEyes: false, requester: null });
  return {
    observe: () => ({ c: [
      { k: "button", n: "buy", label: "Buy", enabled: true },
      { k: "button", n: "allow", label: "Allow", enabled: true },
      { k: "button", n: "reject", label: "Reject", enabled: true },
      { k: "text", n: "message", v: m.message },
      { k: "text", n: "heard", v: m.heard.join(" | ") },
    ] }),
    send: (w) => {
      if (w.on === "click" && w.target === "buy") m.out.push({ endpoint: "pay.charge", args: { amount: 500 } });
      if (w.on === "click" && w.target === "allow") m.agree = [...m.agree, { endpoint: "pay.charge", count: 1, per: null, upTo: null, approver: "Sam" }];
      if (w.on === "click" && w.target === "reject") m.rejected = [...m.rejected, "pay.charge"];
      if (w.on === "answer") {
        const a = w.answer;
        m.message = a.held ? "held" : a.rejected ? "rejected" : String(a.status);
        m.heard.push(a.held ? "held " + a.status : a.rejected ? "rejected " + a.status : a.status + " " + a.body.key);
      }
    },
    calls: () => m.out.splice(0).map((c) => ({ ...c, config: config() })),
    through: () => ({ pay: config() }),
  };
}
`,
);

const click = (target: string): Action => ({ on: "click", target });
try {
  const [r] = (await runJobs(dir, "ts", [{ kind: "trace", actions: [click("buy"), click("reject"), click("buy"), click("allow")] }])) as { steps: string[]; error?: string }[];
  assert.equal(r.error, undefined, `the session crashed: ${r.error}`);
  const shown = r.steps.map((s) => JSON.parse(s)).map((o) => ({ message: o.c.find((n: any) => n.n === "message").v, heard: o.c.find((n: any) => n.n === "heard").v, calls: o.calls as string[] }));
  // Buy: no permission, so the call is held and the screen hears it at once, never sent (status 0).
  assert.equal(shown[1].message, "held", "a call no permission covers: `its status is held`");
  assert.deepEqual(shown[1].calls, ['pay.charge {"amount":500} → held for approval']);
  // Reject: the held call is dropped, and its handler hears `its status is rejected`.
  assert.equal(shown[2].message, "rejected", "a rejection: `its status is rejected`");
  assert.deepEqual(shown[2].calls, ['pay.charge {"amount":500} → rejected']);
  // Buy again: the old rejection does not drop it; it is held again.
  assert.equal(shown[3].message, "held", "a later call is held again, not rejected for good");
  // Allow: the permission lets the held call out, with the key it was held with; the real answer follows.
  assert.equal(shown[4].message, "201", "approved: the real answer");
  assert.deepEqual(shown[4].calls, ['pay.charge {"amount":500} → 201 (approved)']);
  assert.equal(shown[4].heard, `held 0 | rejected 0 | held 0 | 201 ${harnessKey("pay-2")}`, "held and rejected answers are status 0 and never sent; the approved call keeps its key (the second call's)");
} finally {
  rmSync(dir, { recursive: true, force: true });
}
console.log("ok held: the driver answers `held` at once, `rejected` on a rejection, and sends an approved call with its key");
