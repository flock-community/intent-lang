// A `Json` through the host entries (1.1, docs/design/open-data.md), without an LLM: builds of
// apps/45-notices.intent (TypeScript and Elm, screen.mjs) and apps/46-notices-watch.intent
// (TypeScript, job-host.mjs) with stand-in apps, run where every platform global throws. What the app
// sends is its own record (`List Action`) where the contract says `Json`: it goes out as that value's
// JSON, keys in order. What arrives keeps what the spec did not declare (`payload`), keys in order,
// and stored data gives it back unchanged.
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { load } from "../compiler/load.ts";
import { tsTarget } from "../compiler/targets/ts.ts";
import { elmTarget } from "../compiler/targets/elm.ts";

const GUARD = `
for (const g of ["__intentTransport", "fetch", "crypto", "localStorage", "sessionStorage", "indexedDB", "document", "window", "location", "setTimeout", "setInterval", "queueMicrotask", "XMLHttpRequest", "EventSource", "WebSocket", "navigator"])
  Object.defineProperty(globalThis, g, { get() { throw new Error("host entry touched " + g); }, set() { throw new Error("host entry set " + g); }, configurable: true });
Math.random = () => { throw new Error("host entry touched Math.random"); };`;
const node = (code: string) => {
  const r = spawnSync(process.execPath, ["--no-warnings", "--input-type=module", "-e", code], { encoding: "utf8" });
  assert.equal(r.status, 0, r.stderr);
  return JSON.parse(r.stdout);
};
const text = (v: unknown) => JSON.stringify(v);
const SENT = [{ endpoint: "notices.notify", args: { title: "Server down", actions: [{ label: "Open", type: "open" }] } }];
// The service answers with more than the screen sent, in another key order: kept, keys in order.
const BODY = { id: 1, title: "Server down", actions: [{ type: "open", label: "Open", payload: { deep: [1] } }] };
const KEPT = '[{"label":"Open","payload":{"deep":[1]},"type":"open"}]';

// ---------------------------------------------------------------- the screen, TypeScript
const screenApp = load(new URL("../apps/45-notices.intent", import.meta.url).pathname, { ignoreLock: true }).app!;
const TS_SCREEN = `import type { Action, Call, Json, Msg, Notice, Screen } from "./spec.ts";
export type Model = { draft: string; actions: Action[]; shown: Notice[]; last: Json | null };
type Step = { model: Model; calls: Call[] };
export const init = (): Step => ({ model: { draft: "", actions: [{ type: "open", label: "Open" }], shown: [], last: null }, calls: [] });
export function update(msg: Msg, m: Model): Step {
  if (msg.tag === "DraftTyped") return { model: { ...m, draft: msg.text }, calls: [] };
  if (msg.tag === "SendClicked") return { model: m, calls: [{ call: "notices.notify", args: { title: m.draft.trim(), actions: m.actions } }] };
  if (msg.tag === "NoticesNotifyAnswered") return { model: msg.answer.status === 201 ? { ...m, draft: "" } : m, calls: [] };
  if (msg.tag === "NoticesNoticeCreated") return { model: { ...m, shown: [...m.shown, msg.body], last: msg.body.actions }, calls: [] };
  return { model: m, calls: [] };
}
export const view = (m: Model): Screen => ({ draft: m.draft, send: { enabled: m.draft.trim() !== "" }, shown: m.shown.map((n) => ({ key: String(n.id), title: n.title })) });
export const data = (m: Model) => m;
export const restore = (s: { shown: Notice[]; last: Json | null }, m: Model): Model => ({ ...m, shown: s.shown, last: s.last });
`;
const screenHost = (file: string, awaited: boolean) => `${GUARD}
const { start } = (await import(${JSON.stringify(file)})).default;
const out = {};
const s = ${awaited ? "await " : ""}start({});
${awaited ? "await " : ""}s.send({ on: "input", target: "draft", text: "Server down" });
${awaited ? "await " : ""}s.send({ on: "click", target: "send" });
out.calls = s.calls();
${awaited ? "await " : ""}s.send({ on: "answer", target: "notices.notify", answer: { endpoint: "notices.notify", status: 201, body: ${text(BODY)} } });
${awaited ? "await " : ""}s.send({ on: "event", target: "notices.noticeCreated", event: { event: "notices.noticeCreated", body: ${text(BODY)} } });
out.stored = s.stored();
const again = ${awaited ? "await " : ""}start({ saved: out.stored });
out.again = again.stored();
console.log(JSON.stringify(out));`;
const checkScreen = (o: { calls: unknown; stored: { last: unknown; shown: unknown[] }; again: unknown }, target: string) => {
  assert.equal(text(o.calls), text(SENT), `${target}: calls() is the one notify, the app's own records as JSON, keys in order`);
  assert.equal(text(o.stored.last), KEPT, `${target}: stored().last keeps what the spec did not declare, keys in order`);
  assert.equal(text(o.stored.shown), text([{ id: 1, title: "Server down", actions: JSON.parse(KEPT) }]), `${target}: a Notice's Json field the same`);
  assert.equal(text(o.again), text(o.stored), `${target}: start({ saved: stored() }) gives it back unchanged`);
};
{
  const dir = mkdtempSync(join(tmpdir(), "json-host-ts-"));
  try {
    tsTarget.scaffold(screenApp, dir, {} as never);
    writeFileSync(join(dir, "app.ts"), TS_SCREEN);
    assert.equal(await tsTarget.compile(dir), "", "the TypeScript screen compiles");
    checkScreen(node(screenHost(join(dir, "screen.mjs"), false)), "ts");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

// ---------------------------------------------------------------- the screen, Elm
// The alias `type alias Json = D.Value` compiles next to the module Json.Decode; `sameJson` compares.
const ELM_SCREEN = `module App exposing (Model, data, init, restore, update, view)

import Json.Encode as J
import Spec exposing (..)


type alias Model =
    { draft : String, actions : List Action, shown : List Notice, last : Maybe Json }


init : ( Model, List Call )
init =
    ( { draft = "", actions = actionsInitial, shown = [], last = Nothing }, [] )


update : Msg -> Model -> ( Model, List Call )
update msg model =
    case msg of
        DraftTyped t ->
            ( { model | draft = t }, [] )

        SendClicked ->
            ( model, [ NoticesNotify { title = String.trim model.draft, actions = J.list encodeAction model.actions } ] )

        NoticesNotifyAnswered (NoticesNotify201 _) ->
            ( { model | draft = "" }, [] )

        NoticesNoticeCreated n ->
            ( { model | shown = model.shown ++ [ n ], last = if Maybe.map (sameJson n.actions) model.last == Just True then model.last else Just n.actions }, [] )

        _ ->
            ( model, [] )


view : Model -> Screen
view model =
    { draft = model.draft, send = { enabled = String.trim model.draft /= "" }, shown = List.map (\\n -> { key = String.fromInt n.id, title = n.title }) model.shown }


data : Model -> Data
data model =
    { draft = model.draft, actions = model.actions, shown = model.shown, last = model.last }


restore : Stored -> Model -> Model
restore saved model =
    { model | shown = saved.shown, last = saved.last }
`;
{
  const dir = mkdtempSync(join(tmpdir(), "json-host-elm-"));
  try {
    elmTarget.scaffold(screenApp, dir, {} as never);
    writeFileSync(join(dir, "src/App.elm"), ELM_SCREEN);
    assert.equal(await elmTarget.compile(dir), "", "the Elm screen compiles (the Json alias next to Json.Decode)");
    checkScreen(node(screenHost(join(dir, "screen.mjs"), true)), "elm");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

// ---------------------------------------------------------------- the job, TypeScript
const jobApp = load(new URL("../apps/46-notices-watch.intent", import.meta.url).pathname, { ignoreLock: true }).app!;
const TS_JOB = `import type { Call, Data, Msg, Screen, Stored } from "./spec.ts";
export type Model = Data;
type Step = { model: Model; calls: Call[] };
export const init = (): Step => ({ model: { count: 0, last: null }, calls: [] });
export const update = (msg: Msg, m: Model): Step => (msg.tag === "NoticesNoticeCreated" ? { model: { count: m.count + 1, last: msg.body.actions }, calls: [] } : { model: m, calls: [] });
export const view = (m: Model): Screen => ({ count: String(m.count), last: m.last === null ? "" : JSON.stringify(m.last) });
export const data = (m: Model): Data => m;
export const restore = (s: Stored, m: Model): Model => ({ ...m, ...s });
`;
{
  const dir = mkdtempSync(join(tmpdir(), "json-host-job-"));
  try {
    tsTarget.scaffold(jobApp, dir, {} as never);
    writeFileSync(join(dir, "app.ts"), TS_JOB);
    assert.equal(await tsTarget.compile(dir), "", "the job compiles");
    const o = node(`${GUARD}
const { start } = (await import(${JSON.stringify(join(dir, "job-host.mjs"))})).default;
const transport = { send() { throw new Error("this job calls nothing"); } };
const job = start({ transport });
const out = {};
out.ran = await job.run({ event: { event: "notices.noticeCreated", body: { id: 1, title: "x", actions: [{ type: "open", label: "Open" }] } } });
out.stored = job.stored();
const again = start({ transport, saved: out.stored });
out.again = await again.run();
out.againStored = again.stored();
console.log(JSON.stringify(out));`);
    const want = '[{"label":"Open","type":"open"}]';
    assert.equal(text(o.ran.last), want, "run resolves with last, keys in order");
    assert.equal(o.ran.count, 1);
    assert.equal(text(o.stored), text({ count: 1, last: JSON.parse(want) }), "stored() the same");
    assert.equal(text(o.again.last), want, "a start from saved brings it back");
    assert.equal(text(o.againStored), text(o.stored), "and keeps it as it was");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}
console.log("ok json host: a Json goes out as the app's own records' JSON and comes back with what the spec did not declare, keys in order, in calls() and stored() of screen.mjs (TypeScript and Elm) and job-host.mjs");
