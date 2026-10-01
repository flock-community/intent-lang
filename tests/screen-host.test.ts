// The host entry (screen.mjs, STABILITY.md §5, docs/design/screen-host.md), without an LLM: a build of
// apps/29-sized.intent with a stand-in app.ts is bundled for no platform and run where every platform
// global throws (fetch, crypto, localStorage, document, location, timers, Math.random). It says what
// it is (meta), needs a clock, takes the size at start and from the host, and touches no global.
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { load } from "../compiler/load.ts";
import { tsTarget } from "../compiler/targets/ts.ts";
import { elmTarget } from "../compiler/targets/elm.ts";

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
// The Elm build's screen.mjs: the same contract around the Elm worker (start and send are promises),
// with no platform global either (Elm's own timers are microtasks inside the bundle).
{
  const d = mkdtempSync(join(tmpdir(), "screen-host-elm-"));
  try {
    elmTarget.scaffold(app!, d, {} as never);
    writeFileSync(join(d, "src/App.elm"), 'module App exposing (Model, init, update, view)\n\nimport Spec exposing (..)\n\n\ntype alias Model =\n    Int\n\n\ninit : Clock -> Model\ninit _ =\n    0\n\n\nupdate : Clock -> Msg -> Model -> Model\nupdate _ _ m =\n    m\n\n\nview : Clock -> Model -> Screen\nview clock _ =\n    { count = "2 notes"\n    , notes = if clock.size == Standard then Just [] else Nothing\n    , more = if clock.size == Compact then Just "Open for more" else Nothing\n    }\n');
    assert.equal(await elmTarget.compile(d), "", "the Elm build compiles");
    const host = `
for (const g of ["fetch", "crypto", "localStorage", "document", "window", "location", "setTimeout", "setInterval", "XMLHttpRequest", "EventSource", "navigator"])
  Object.defineProperty(globalThis, g, { get() { throw new Error("screen.mjs touched " + g); }, configurable: true });
const { meta, start } = (await import(${JSON.stringify(join(d, "screen.mjs"))})).default;
const s = await start({ clock: { now: "2026-09-24T09:00", today: "2026-09-24" }, size: "standard" });
const a = s.observe();
await s.send({ on: "size", target: "", value: "Compact" });
console.log(JSON.stringify({ name: meta.name, at: a.c.map((n) => n.n), compact: s.observe().c.map((n) => n.n), calls: s.calls(), stored: s.stored() }));`;
    const r = spawnSync(process.execPath, ["--input-type=module", "-e", host], { encoding: "utf8" });
    assert.equal(r.status, 0, r.stderr);
    assert.deepEqual(JSON.parse(r.stdout), { name: "Sized", at: ["count", "notes"], compact: ["count", "more"], calls: [], stored: {} }, "the same contract on Elm");
  } finally {
    rmSync(d, { recursive: true, force: true });
  }
}

// The tree says what to draw by (1.1): an instance's component and each element's part in it, its
// presentation and tone. A theme styles `Pager` / `next`; it never needs the app's names.
{
  const { app: demo } = load(new URL("../lib/std/list.demo.intent", import.meta.url).pathname, { ignoreLock: true });
  const d = mkdtempSync(join(tmpdir(), "screen-anatomy-"));
  try {
    tsTarget.scaffold(demo!, d, {} as never);
    const spec = readFileSync(join(d, "spec.ts"), "utf8");
    assert.match(spec, /component: "Pager"/, "the instance says which component it is");
    for (const part of ["pageInfo", "previous", "next"]) assert.match(spec, new RegExp(`part: "${part}"`), `its element says its part: ${part}`);
    assert.match(spec, /n: "pager\.next".*?as: "secondary", part: "next"/, "with its presentation");
  } finally {
    rmSync(d, { recursive: true, force: true });
  }
}
console.log("ok screen-host: screen.mjs runs with no platform global, says what it is (meta), needs its clock, takes the size at start and from the host; the tree carries component, part, presentation; the same on Elm");
