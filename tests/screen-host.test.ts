// The host entry (screen.mjs, STABILITY.md §5, docs/design/screen-host.md), without an LLM: a build of
// apps/29-sized.intent with a stand-in app.ts is bundled for no platform and run where every platform
// global throws (fetch, crypto, localStorage, document, location, timers, Math.random). It says what
// it is (meta), needs a clock, takes the size at start and from the host, and touches no global.
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { load } from "../compiler/load.ts";
import { tsTarget } from "../compiler/targets/ts.ts";

const { app } = load(new URL("../apps/29-sized.intent", import.meta.url).pathname, { ignoreLock: true });
const dir = mkdtempSync(join(tmpdir(), "screen-host-"));
try {
  tsTarget.scaffold(app!, dir, {} as never);
  writeFileSync(join(dir, "app.ts"), 'import type { Clock, Msg, Screen } from "./spec.ts";\nexport type Model = number;\nexport const init = (_c: Clock): Model => 0;\nexport const update = (_e: Msg, m: Model, _c: Clock): Model => m;\nexport const view = (_m: Model, c: Clock): Screen => ({ count: `2 notes`, notes: c.size === "Standard" ? [] : null, more: c.size === "Compact" ? "Open for more" : null });\n');
  assert.equal(await tsTarget.compile(dir), "", "the build compiles");
  assert.ok(existsSync(join(dir, "screen.mjs")) && existsSync(join(dir, "test.mjs")), "both entries are built");
  const host = `
for (const g of ["fetch", "crypto", "localStorage", "document", "window", "location", "setTimeout", "setInterval", "XMLHttpRequest", "EventSource", "navigator"])
  Object.defineProperty(globalThis, g, { get() { throw new Error("screen.mjs touched " + g); }, configurable: true });
Math.random = () => { throw new Error("screen.mjs touched Math.random"); };
const { meta, start } = (await import(${JSON.stringify(join(dir, "screen.mjs"))})).default;
const out = { meta };
try { start(); } catch (e) { out.noClock = e.message; }
const clock = { now: "2026-09-24T09:00", today: "2026-09-24" };
const s = start({ clock, size: "standard" });
out.atStart = s.observe();
s.send({ on: "size", target: "", value: "Compact" });
out.compact = s.observe();
s.send({ on: "noop", target: "", clock: { now: "2026-09-24T10:00", today: "2026-09-24" } });
out.later = s.observe();
out.calls = s.calls(); out.stored = s.stored(); out.nav = s.nav();
console.log(JSON.stringify(out));`;
  const r = spawnSync(process.execPath, ["--input-type=module", "-e", host], { encoding: "utf8" });
  assert.equal(r.status, 0, r.stderr);
  const o = JSON.parse(r.stdout);
  assert.deepEqual(o.meta, { contract: "intent.screen/1", name: "Sized", clock: { tickMs: 0 }, sizes: ["Compact", "Standard"], stored: [], draws: false, screens: null, uses: [] });
  assert.match(o.noClock, /start needs \{ clock \}/, "an app that reads the clock needs one");
  const shown = (n: { c: { n: string; v?: string; rows?: unknown[] }[] }) => n.c.map((x) => x.n);
  assert.deepEqual(shown(o.atStart), ["count", "notes"], "the size given at start (in any case)");
  assert.deepEqual(shown(o.compact), ["count", "more"], "the host changes the size");
  assert.deepEqual(shown(o.later), ["count", "more"], "a new clock keeps the size");
  assert.deepEqual([o.calls, o.stored, o.nav], [[], {}, null], "the same methods on every app, with neutral values");
} finally {
  rmSync(dir, { recursive: true, force: true });
}
console.log("ok screen-host: screen.mjs runs with no platform global, says what it is (meta), needs its clock, takes the size at start and from the host");
