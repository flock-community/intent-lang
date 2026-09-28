// A job's runtime (runtime/ts/headless.ts): no page; `run` hands the app an event (read back from
// wire names) and resolves with its data once every call the event set off has been answered.
import assert from "node:assert/strict";
import { headless } from "../runtime/ts/headless.ts";
import { fetchCall, type Transport } from "../runtime/ts/calls.ts";
import type { Wire } from "../runtime/ts/ui.ts";

type M = { seen: string[]; answered: number };
const host = globalThis as { __intentTransport?: Transport };
host.__intentTransport = { send: () => new Promise((r) => setTimeout(() => r({ status: 201, body: {} }), 20)) };
const eps = [{ name: "a.raise", method: "POST", path: "/raise", params: [] }];
let dispatch: (w: Wire) => void = () => {};
const running = headless<M>({
  init: () => ({ seen: [], answered: 0 }),
  step: (w, m) => {
    if (w.on === "event") {
      const e = w.event as { body: { level: string } };
      // Like an app's update: note the event, and make a call whose answer comes back later.
      void fetchCall(eps, { endpoint: "a.raise", args: {}, key: "k" }).then((a) => dispatch({ on: "answer", target: a.endpoint, answer: a }));
      return { ...m, seen: [...m.seen, e.body.level] };
    }
    if (w.on === "answer") return { ...m, answered: m.answered + 1 };
    return m;
  },
  render: () => ({ k: "screen", title: "", c: [] }),
  clockMs: 0,
  data: (m) => m,
  read: (e) => ({ ...e, body: { level: (e.body as { level: string }).level === "urgent" ? "Urgent" : "Info" } }),
});
dispatch = running.dispatch;

assert.deepEqual(await running.job.run(), { seen: [], answered: 0 }, "run() with no event: the job as it started");
assert.deepEqual(await running.job.run({ event: { event: "a.alertRaised", body: { level: "urgent" } } }), { seen: ["Urgent"], answered: 1 }, "the event is read in the spec's names, and run waits for the call's answer");

delete host.__intentTransport;

// A job's entry (job.mjs) is TypeScript only: the TypeScript scaffold writes job.ts, and a build on
// a target that cannot write it stops at once with the reason (it never reaches the model), rather
// than producing a page of the job's state that no host can run.
{
  const { mkdtempSync, existsSync, rmSync } = await import("node:fs");
  const { tmpdir } = await import("node:os");
  const { join } = await import("node:path");
  const { load } = await import("../compiler/load.ts");
  const { buildOnce } = await import("../compiler/build.ts");
  const { scaffold } = await import("../compiler/gen.ts");
  const { TARGETS } = await import("../compiler/targets/index.ts");
  const spec = new URL("../apps/30-urgent-watch.intent", import.meta.url).pathname;
  const { app } = load(spec, { ignoreLock: true });
  assert.equal(app?.profile, "job");
  const dir = mkdtempSync(join(tmpdir(), "job-"));
  try {
    scaffold(app!, "ts", join(dir, "ts"));
    assert.ok(existsSync(join(dir, "ts/job.ts")), "the TypeScript scaffold writes the job's entry");
    assert.ok(TARGETS.ts.job && !TARGETS.elm.job, "only TypeScript writes a job's entry (so far)");
    const r = await buildOnce(app!, "30-urgent-watch.intent", "", "elm", join(dir, "elm"));
    assert.equal(r.ok, false, "a job on Elm does not build");
    assert.match(r.attempts[0]?.detail ?? "", /job.*job\.mjs.*TypeScript harness only.*build it with the ts target/, "and says why, and what to do");
    assert.equal(r.costUsd, 0, "without asking the model");
    assert.ok(!existsSync(join(dir, "elm")), "and writes nothing");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}
console.log("ok headless: a job runs an event, waits for its calls, and returns its data; on Elm it is refused with the reason");
