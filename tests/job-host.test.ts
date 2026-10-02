// The job host entry (job-host.mjs, contract intent.job/1, docs/design/screen-host.md "Jobs"), without
// an LLM: a build of apps/30-urgent-watch.intent with a stand-in app.ts, run where the old globals
// (`__intentTransport`, `localStorage`) and every platform global throw on access. The host hands
// the job its transport and what it kept; the job makes exactly the calls the spec says, through that
// transport, and hands back its data and its stored fields. The old entry (job.mjs) keeps working on
// the global transport.
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { load } from "../compiler/load.ts";
import { tsTarget } from "../compiler/targets/ts.ts";

const APP = `import type { Call, Data, Msg, Screen, Stored } from "./spec.ts";
export type Model = Data;
type Step = { model: Model; calls: Call[] };
export const init = (): Step => ({ model: { passedOn: 0, told: [], problem: "" }, calls: [] });
export function update(msg: Msg, m: Model): Step {
  if (msg.tag === "AlertsAlertRaised")
    return msg.body.level === "Urgent"
      ? { model: { ...m, passedOn: m.passedOn + 1, told: [...m.told, msg.body.text] }, calls: [{ call: "alerts.raise", args: { text: "On-call told: " + msg.body.text, level: "Info" } }] }
      : { model: m, calls: [] };
  if (msg.tag === "AlertsRaiseAnswered") return { model: { ...m, problem: msg.answer.status === 201 ? "" : msg.answer.status === 0 ? msg.answer.error : msg.answer.body.error }, calls: [] };
  return { model: m, calls: [] };
}
export const view = (m: Model): Screen => ({ passedOn: String(m.passedOn), told: m.told.map((_, i) => ({ key: String(i) })), problem: m.problem });
export const data = (m: Model): Data => m;
export const restore = (s: Stored, m: Model): Model => ({ ...m, passedOn: s.passedOn });
`;

const { app } = load(new URL("../apps/30-urgent-watch.intent", import.meta.url).pathname, { ignoreLock: true });
assert.equal(app?.profile, "job");
const dir = mkdtempSync(join(tmpdir(), "job-host-"));
const node = (code: string) => {
  const r = spawnSync(process.execPath, ["--no-warnings", "--input-type=module", "-e", code], { encoding: "utf8" });
  assert.equal(r.status, 0, r.stderr);
  return JSON.parse(r.stdout);
};
try {
  tsTarget.scaffold(app!, dir, {} as never);
  writeFileSync(join(dir, "app.ts"), APP);
  assert.equal(await tsTarget.compile(dir), "", "the build compiles");
  assert.ok(existsSync(join(dir, "job-host.mjs")) && existsSync(join(dir, "job.mjs")), "both job entries are built");
  assert.ok(!existsSync(join(dir, "screen.mjs")), "a job is not a screen");

  // The host entry: every global the old entry read, and every platform global, throws when touched.
  const guarded = `
for (const g of ["__intentTransport", "localStorage", "sessionStorage", "indexedDB", "fetch", "crypto", "document", "window", "location", "setTimeout", "setInterval", "queueMicrotask", "XMLHttpRequest", "EventSource", "WebSocket", "navigator"])
  Object.defineProperty(globalThis, g, { get() { throw new Error("job-host.mjs touched " + g); }, set() { throw new Error("job-host.mjs set " + g); }, configurable: true });
Math.random = () => { throw new Error("job-host.mjs touched Math.random"); };
const { meta, start } = (await import(${JSON.stringify(join(dir, "job-host.mjs"))})).default;
const sent = [];
const transport = { send(req) { sent.push(req); return Promise.resolve(req.body.text.endsWith("Bad") ? { status: 400, body: { error: "text too long" } } : { status: 201, body: { id: sent.length, text: req.body.text, level: req.body.level } }); } };
const out = { meta };
try { start(); } catch (e) { out.noTransport = e.message; }
const job = start({ transport });
out.idle = await job.run();
out.info = await job.run({ event: { event: "alerts.alertRaised", body: { id: 1, text: "Backup done", level: "info" } } });
out.infoSent = sent.length;
out.urgent = await job.run({ event: { event: "alerts.alertRaised", body: { id: 2, text: "Disk full", level: "urgent" } } });
out.bad = await job.run({ event: { event: "alerts.alertRaised", body: { id: 3, text: "Bad", level: "urgent" } } });
out.stored = job.stored();
out.sent = sent.splice(0);
const again = start({ transport, saved: out.stored });
out.restarted = await again.run();
out.restartedStored = again.stored();
const down = start({ transport: { send: () => Promise.reject(new Error("bus down")) }, saved: { passedOn: 7 } });
out.down = await down.run({ event: { event: "alerts.alertRaised", body: { id: 4, text: "CPU hot", level: "urgent" } } });
console.log(JSON.stringify(out));`;
  const o = node(guarded);
  assert.deepEqual(o.meta, { contract: "intent.job/1", name: "UrgentWatch", clock: null, stored: ["passedOn"], draws: false, uses: [{ alias: "alerts", contract: "notify.alertsApi", endpoints: ["raise"], events: ["alertRaised"] }] }, "meta: what the job is, for its host");
  assert.match(o.noTransport, /^UrgentWatch: start needs \{ transport \}/, "a job that calls an api needs the host's transport");
  assert.deepEqual(o.idle, { passedOn: 0, told: [], problem: "" }, "run() with no event: the job as it started");
  assert.deepEqual(o.info, { passedOn: 0, told: [], problem: "" }, "an info alert is left alone");
  assert.equal(o.infoSent, 0, "and makes no call");
  assert.deepEqual(o.urgent, { passedOn: 1, told: ["Disk full"], problem: "" }, "an urgent alert is passed on; run resolves once its call is answered");
  assert.deepEqual(o.bad, { passedOn: 2, told: ["Disk full", "Bad"], problem: "text too long" }, "a 400 answer reaches the app in the spec's terms");
  assert.deepEqual(o.sent, [
    { method: "POST", path: "/alerts", query: {}, headers: {}, body: { text: "On-call told: Disk full", level: "info" }, alias: "alerts", endpoint: "alerts.raise" },
    { method: "POST", path: "/alerts", query: {}, headers: {}, body: { text: "On-call told: Bad", level: "info" }, alias: "alerts", endpoint: "alerts.raise" },
  ], "exactly the calls the spec makes, through the host's transport, choices by their wire names, no key (the host owns keys)");
  assert.deepEqual(o.stored, { passedOn: 2 }, "stored(): only the stored fields, for the host to keep");
  assert.deepEqual([o.restarted, o.restartedStored], [{ passedOn: 2, told: [], problem: "" }, { passedOn: 2 }], "start({ saved }): counted across a restart");
  assert.deepEqual(o.down, { passedOn: 8, told: ["CPU hot"], problem: "no answer: bus down" }, "a transport that fails is an answer with status 0, not a crash");

  // The old entry keeps working for existing hosts: the transport from globalThis.__intentTransport.
  const legacy = node(`
const sent = [];
globalThis.__intentTransport = { send(req) { sent.push({ endpoint: req.endpoint, body: req.body, keyed: /^[0-9a-f]{32}$/.test(req.headers["idempotency-key"] ?? "") }); return { status: 201, body: { id: 1, text: req.body.text, level: req.body.level } }; } };
const job = (await import(${JSON.stringify(join(dir, "job.mjs"))})).default;
const data = await job.run({ event: { event: "alerts.alertRaised", body: { id: 2, text: "Disk full", level: "urgent" } } });
console.log(JSON.stringify({ data, sent }));
process.exit(0);`);
  assert.deepEqual(legacy, { data: { passedOn: 1, told: ["Disk full"], problem: "" }, sent: [{ endpoint: "alerts.raise", body: { text: "On-call told: Disk full", level: "info" }, keyed: true }] }, "job.mjs: unchanged, on the global transport");
} finally {
  rmSync(dir, { recursive: true, force: true });
}
console.log("ok job-host: job-host.mjs runs a job with the host's transport and saved state, touching no global; job.mjs still runs on the global transport");
