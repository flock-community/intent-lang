// A screen's examples against a provider that draws and reads the clock (held-out round 4, H1 and
// G5): every request the driver sends the provider carries the example's clock and the provider's own
// draws, and `steer random T` in the screen's example reaches the provider when only the provider draws
// a T. The provider is the generated service around a stand-in app module (apps/api/raffle-api.intent),
// the screen a stand-in TypeScript module (apps/38-raffle.intent): what is tested is the driver. No LLM.
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { load } from "../compiler/load.ts";
import { dataField, scaffold } from "../compiler/gen.ts";
import { scaffoldApi } from "../compiler/api.ts";
import { typeDescOf } from "../compiler/targets/ts-service.ts";
import { exploreJobs } from "../compiler/fuzz.ts";
import { drawTable } from "../compiler/drawer.ts";
import { writeProviders } from "../compiler/build.ts";
import { usesClock } from "../compiler/refs.ts";
import { runJobs, type ExampleResult, type ExploreResult, type TraceResult } from "../compiler/exec.ts";
import { targetModule } from "../compiler/targets/index.ts";
import { parseSyntax } from "../compiler/parse.ts";

const API = `import type { Data, Entry, Handlers, Stored } from "./spec.ts";
import { answer, fail } from "./api.ts";

export type Model = { entries: Entry[]; nextId: number };
export function init(): Model {
  return { entries: [{ id: 1, name: "Ann", code: "K7MQ2R", enteredOn: "2026-09-30" }], nextId: 2 };
}
export const data = (m: Model): Data => ({ entries: m.entries, nextId: m.nextId });
export const restore = (saved: Stored, m: Model): Model => ({ ...m, ...saved });

export const handlers: Handlers<Model> = {
  listEntries: (_req, model) => ({ model, response: answer(200, model.entries) }),
  enter: (req, model, draws) => {
    if (req.name.trim() === "") return { model, response: fail(400, "A name is required") };
    const code = draws.freeCode1(model.entries.map((e) => e.code));
    if (code === null) return { model, response: fail(409, "No ticket code is free") };
    const entry = { id: model.nextId, name: req.name.trim(), code, enteredOn: req.today };
    return { model: { entries: [...model.entries, entry], nextId: model.nextId + 1 }, response: answer(201, entry) };
  },
  withdraw: (req, model) => {
    if (!model.entries.some((e) => e.id === req.id)) return { model, response: fail(404, "No such entry") };
    return { model: { ...model, entries: model.entries.filter((e) => e.id !== req.id) }, response: answer(204) };
  },
};
`;

const SCREEN = `import type { Call, Entry, Msg, Screen } from "./spec.ts";
import { formatDate } from "./fmt.ts";

export type Model = { draft: string; entries: Entry[]; message: string | null };
export function init(): { model: Model; calls: Call[] } {
  return { model: { draft: "", entries: [], message: null }, calls: [{ call: "raffle.listEntries" }] };
}
export function update(msg: Msg, m: Model): { model: Model; calls: Call[] } {
  switch (msg.tag) {
    case "DraftTyped":
      return { model: { ...m, draft: msg.text }, calls: [] };
    case "EnterClicked":
      return { model: m, calls: [{ call: "raffle.enter", args: { name: m.draft } }] };
    case "RaffleListEntriesAnswered":
      return { model: msg.answer.status === 200 ? { ...m, entries: msg.answer.body } : m, calls: [] };
    case "RaffleEnterAnswered":
      if (msg.answer.status === 201) return { model: { ...m, message: "Your ticket code is " + msg.answer.body.code, draft: "" }, calls: [{ call: "raffle.listEntries" }] };
      return { model: { ...m, message: msg.answer.status === 0 ? msg.answer.error : msg.answer.body.error }, calls: [] };
    default:
      return { model: m, calls: [] };
  }
}
export function view(m: Model): Screen {
  return { draft: m.draft, enter: { enabled: m.draft.trim() !== "" }, message: m.message, entries: m.entries.map((e) => ({ key: String(e.id), name: e.name, code: e.code, day: formatDate(e.enteredOn) })) };
}
`;

const dirs: string[] = [];
const temp = (name: string) => {
  const d = mkdtempSync(join(tmpdir(), `provider-draws-${name}-`));
  dirs.push(d);
  return d;
};
try {
  // The provider, as a build writes it for the driver (compiler/build.ts): endpoints, stored fields, draws, clock.
  const api = load("apps/api/raffle-api.intent", { ignoreLock: true }).app!;
  assert.ok(api, "apps/api/raffle-api.intent loads");
  const adir = temp("api");
  scaffoldApi(api, adir, {});
  writeFileSync(join(adir, "app.ts"), API);
  writeFileSync(join(adir, "endpoints.json"), JSON.stringify((api.endpoints ?? []).map((e) => ({ name: e.name, method: e.method, path: e.path, params: e.params.map((p) => ({ in: p.in, name: p.name, type: typeDescOf(api, p.type) })) }))));
  writeFileSync(join(adir, "stored.json"), JSON.stringify(api.state.filter((f) => f.stored).map((f) => ({ field: dataField(f.name), line: f.line }))));
  writeFileSync(join(adir, "draws.json"), JSON.stringify(drawTable(api)));
  assert.ok(usesClock(api));
  writeFileSync(join(adir, "clock.json"), JSON.stringify({ start: api.startsAt, tickMs: 0, jobs: [] }));
  assert.equal(await targetModule("ts").service!.compileApi(adir), "", "the provider stand-in compiles");

  // The screen: it draws nothing and reads no clock itself.
  const { app, diagnostics } = load("apps/38-raffle.intent", { ignoreLock: true });
  assert.ok(app, `apps/38-raffle.intent loads: ${diagnostics.map((d) => d.message).join("; ")}`);
  assert.ok(!usesClock(app!), "the screen reads no clock: only its provider does");
  const sdir = temp("screen");
  scaffold(app!, "ts", sdir);
  writeFileSync(join(sdir, "app.ts"), SCREEN);
  writeProviders(app!, sdir, { raffle: adir });
  assert.equal(await targetModule("ts").compile(sdir), "", "the screen stand-in compiles");

  // Every example of the screen: the provider draws (seeded, and steered by the screen's example), and `wait 1d` moves its clock.
  const res = (await runJobs(sdir, "ts", app!.examples.map((example) => ({ kind: "example" as const, example })))) as ExampleResult[];
  for (const r of res) assert.ok(r.pass, `example "${r.name}" passes (${r.failure?.message})`);
  console.log(`ok provider draws: the raffle screen's ${res.length} examples pass against a provider that draws codes and reads the clock (steered from the screen; wait 1d moves the provider's day)`);

  // Unsteered, a provider's draw is the same in every run (the example's name and the alias are its seed).
  const plain = parseSyntax(`app X {\n  "x"\n}\n\nexample "just enter" {\n  type "Fay" into draft\n  click enter\n}\n`).app!.examples[0];
  const codes = await Promise.all([1, 2].map(async () => {
    const [t] = (await runJobs(sdir, "ts", [{ kind: "trace", actions: [{ on: "input", target: "draft", text: "Fay" }, { on: "click", target: "enter" }] }])) as TraceResult[];
    assert.ok(!t.error, t.error ?? "");
    return JSON.parse(t.steps[t.steps.length - 1]).c.find((n: { n?: string }) => n.n === "message").v as string;
  }));
  assert.match(codes[0], /^Your ticket code is [0-9A-Z]{6}$/);
  assert.equal(codes[1], codes[0], "the same session draws the same code again");
  const [ok] = (await runJobs(sdir, "ts", [{ kind: "example", example: plain }])) as ExampleResult[];
  assert.ok(ok.pass, ok.failure?.message ?? "");

  // A steered value the provider never draws fails the example at the steer step.
  const never = parseSyntax(`app X {\n  "x"\n}\n\nexample "steered, never drawn" {\n  steer random TicketCode = "M8TX3Q"\n  see entries has 1 row\n}\n`).app!.examples[0];
  const [bad] = (await runJobs(sdir, "ts", [{ kind: "example", example: never }])) as ExampleResult[];
  assert.ok(!bad.pass && bad.failure!.line === 6, "the example fails at its steer step");
  assert.match(bad.failure!.message, /steered TicketCode "M8TX3Q" was never drawn/);

  // A random session writes the provider's draws down as steps to paste, and the written session replays the same.
  const walks = (await runJobs(sdir, "ts", exploreJobs({ ...app!, examples: app!.examples }, 12, 10, 5))) as ExploreResult[];
  assert.ok(walks.every((w) => !w.error), walks.find((w) => w.error)?.error ?? "");
  const steer = walks.flatMap((w) => w.actions).find((a) => a.on === "random" && a.target === "TicketCode" && !/^"(M8TX3Q|K7MQ2R|Z2Y6FA|W5RD9E)"/.test(a.value ?? ""));
  assert.ok(steer && /^"[0-9A-Z]{6}"$/.test(steer.value!), `the provider's code is written down as a quoted code: ${JSON.stringify(steer)}`);
  console.log("ok provider draws: unsteered draws repeat run to run; a steered value never drawn fails at its step; random sessions write the provider's draws down");

  // The checker: `steer random TicketCode` in the screen is fine (its provider draws it), and so is
  // `wait 1d` (its provider reads the clock); that was a STEP error before.
  assert.deepEqual(diagnostics.filter((d) => d.code === "STEP").map((d) => d.message), [], "the screen's steer and wait steps check clean");

  // A provider's recurring work runs when a screen's \`wait\` passes its time, and what it publishes
  // reaches the screen (stand-ins with the interface of compiled builds: the driver is what is tested).
  const prov = temp("every");
  writeFileSync(join(prov, "test.mjs"), `let n = 0;
export function start() {
  return {
    send: () => ({ status: 200, body: [] }),
    runJob: (name, clock) => [{ event: "pinged", body: { n: ++n, at: clock.now } }],
  };
}
`);
  writeFileSync(join(prov, "clock.json"), JSON.stringify({ start: "2026-10-01T09:00", tickMs: 0, jobs: [{ name: "every1m", every: 60000 }] }));
  const scr = temp("every-screen");
  writeFileSync(join(scr, "providers.json"), JSON.stringify({ endpoints: [], providers: { pings: prov } }));
  writeFileSync(join(scr, "test.mjs"), `export function start() {
  const heard = [];
  return {
    observe: () => ({ c: [{ k: "text", n: "heard", v: heard.join(", ") }] }),
    calls: () => [],
    send: (w) => { if (w.on === "event") heard.push(w.event.body.n + "@" + w.event.body.at.slice(11)); },
  };
}
`);
  const waits = parseSyntax(`app X {\n  "x"\n}\n\nexample "three minutes pass" {\n  wait 3m\n  see heard = "1@09:01, 2@09:02, 3@09:03"\n}\n`).app!.examples[0];
  const [w3] = (await runJobs(scr, "ts", [{ kind: "example", example: waits }])) as ExampleResult[];
  assert.ok(w3.pass, w3.failure?.message ?? "");
  console.log("ok provider draws: a screen's wait runs its provider's recurring work, at the provider's times, and the screen hears what it publishes");
} finally {
  for (const d of dirs) rmSync(d, { recursive: true, force: true });
}
