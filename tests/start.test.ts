// Stored fields are put back before `on start` runs (§9), without an LLM: the harness owns the order.
// `init` is the app from its defaults; the harness restores the stored fields, then sends `Started`
// (the message for `on start`). Stand-in app modules (a real build's are the model's) for two specs:
// Welcome (no calls, draws: `on start` reads a stored name and changes a stored count) and Recent
// (calls and a clock: `on start` calls an api with a stored filter). Both targets, driven as builds are: the test worker
// and test entry, and the browser entries in a real browser (localStorage, reload). A module that
// does `on start` in `init`, as builds did before, fails Welcome's example.
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { chromium } from "playwright";
import { load } from "../compiler/load.ts";
import { dataField, hasStored, scaffold, startsAfterRestore } from "../compiler/gen.ts";
import { targetModule } from "../compiler/targets/index.ts";
import { runJobs, type ExampleResult } from "../compiler/exec.ts";
import { buildPrompt } from "../compiler/prompt.ts";
import { scaffoldStyled } from "../compiler/styled.ts";
import type { App } from "../compiler/ast.ts";
import { drawTable } from "../compiler/drawer.ts";
import { usesDraws } from "../compiler/draws.ts";
import { usesClock } from "../compiler/refs.ts";

const WELCOME = `app Welcome {
  "Greets the person back by name after a restart, and counts how often it was opened."
}
language 1

type Die = Int from 1 to 6

state {
  die: Die = 1
  draft: Text = ""
  stored name: Text = ""
  stored opened: Int = 0
  greeting: Text = ""
}

screen {
  field draft "Your name"
  button save "Save"
  text greeting
  text count = "Opened {@opened} times"
  button roll "Roll"
  text rolled = "{@die}"
}

on start {
  - increase @opened by 1
  if @name is blank {
    stop
  }
  - set @greeting to "Welcome back, {@name}"
}

on click save {
  - set @name to @draft
}

on click roll {
  - set @die to a random @Die
}

example "welcomed back by name after a restart" {
  see count = "Opened 1 times"
  type "Ann" into draft
  click save
  restart
  see greeting = "Welcome back, Ann"
  see count = "Opened 2 times"
}
`;

const RECENT = `app Recent {
  "Remembers the status filter and loads the tickets with it when it starts again."
}
language 1
import support.tickets

uses support.ticketsApi as tickets only listTickets {
  tested with "apps/api/tickets-api.intent"
}

examples start at 2026-01-05 09:00

state {
  stored status: Status or nothing = nothing
  rows: List Ticket = []
}

screen {
  button onlyOpen "Only open"
  text today = "Today is {@today as a date}"
  list rows of Ticket {
    text subject
  }
}

on start {
  if there is no @status {
    stop
  }
  - call @tickets.listTickets with @status = @status
}

on click onlyOpen {
  - set @status to @Open
}

on answer tickets.listTickets {
  if its status is 200 {
    - set @rows to its body
  }
}
`;

// ---------------------------------------------------------------- stand-ins: `on start` is `Started`

const TS_WELCOME = `import type { Data, Die, Draws, Msg, Screen, Stored } from "./spec.ts";

export type Model = { die: Die; draft: string; name: string; opened: number; greeting: string };

export function init(): Model {
  return { die: 1, draft: "", name: "", opened: 0, greeting: "" };
}

export function update(msg: Msg, m: Model, draws: Draws): Model {
  switch (msg.tag) {
    case "DraftTyped":
      return { ...m, draft: msg.text };
    case "SaveClicked":
      return { ...m, name: m.draft };
    case "RollClicked":
      return { ...m, die: draws.roll1() };
    case "Started": {
      const opened = m.opened + 1;
      if (m.name.trim() === "") return { ...m, opened };
      return { ...m, opened, greeting: \`Welcome back, \${m.name}\` };
    }
  }
}

export function view(m: Model): Screen {
  return { draft: m.draft, save: { enabled: true }, greeting: m.greeting, count: \`Opened \${m.opened} times\`, roll: { enabled: true }, rolled: String(m.die) };
}

export const data = (m: Model): Data => ({ ...m });
export const restore = (s: Stored, m: Model): Model => ({ ...m, name: s.name, opened: s.opened });
`;

const ELM_WELCOME = `module App exposing (Model, data, init, restore, update, view)

import Spec exposing (..)


type alias Model =
    { die : Die, draft : String, name : String, opened : Int, greeting : String }


init : Model
init =
    { die = 1, draft = "", name = "", opened = 0, greeting = "" }


update : Draws -> Msg -> Model -> Model
update draws msg m =
    case msg of
        DraftTyped t ->
            { m | draft = t }

        SaveClicked ->
            { m | name = m.draft }

        RollClicked ->
            { m | die = draws.roll1 () }

        Started ->
            if String.trim m.name == "" then
                { m | opened = m.opened + 1 }

            else
                { m | opened = m.opened + 1, greeting = "Welcome back, " ++ m.name }


view : Model -> Screen
view m =
    { draft = m.draft, save = { enabled = True }, greeting = m.greeting, count = "Opened " ++ String.fromInt m.opened ++ " times", roll = { enabled = True }, rolled = String.fromInt m.die }


data : Model -> Data
data m =
    { die = m.die, draft = m.draft, name = m.name, opened = m.opened, greeting = m.greeting }


restore : Stored -> Model -> Model
restore s m =
    { m | name = s.name, opened = s.opened }
`;

// How builds did it before the harness owned the order: \`on start\` in init, on the defaults.
const TS_WELCOME_IN_INIT = TS_WELCOME.replace(
  `export function init(): Model {\n  return { die: 1, draft: "", name: "", opened: 0, greeting: "" };\n}`,
  `export function init(): Model {\n  const m = { die: 1, draft: "", name: "", opened: 0, greeting: "" };\n  return { ...m, opened: 1, greeting: m.name.trim() === "" ? "" : \`Welcome back, \${m.name}\` };\n}`,
).replace(/    case "Started": \{[\s\S]*?\n    \}\n/, `    case "Started":\n      return m;\n`);

const TS_RECENT = `import type { Call, Clock, Data, Msg, Screen, Status, Stored, Ticket } from "./spec.ts";

export type Model = { status: Status | null; rows: Ticket[] };

export function init(_clock: Clock): { model: Model; calls: Call[] } {
  return { model: { status: null, rows: [] }, calls: [] };
}

export function update(msg: Msg, m: Model, _clock: Clock): { model: Model; calls: Call[] } {
  switch (msg.tag) {
    case "OnlyOpenClicked":
      return { model: { ...m, status: "Open" }, calls: [] };
    case "Started":
      if (m.status === null) return { model: m, calls: [] };
      return { model: m, calls: [{ call: "tickets.listTickets", args: { status: m.status } }] };
    case "TicketsListTicketsAnswered":
      return msg.answer.status === 200 ? { model: { ...m, rows: msg.answer.body }, calls: [] } : { model: m, calls: [] };
    default:
      return { model: m, calls: [] };
  }
}

export function view(m: Model, clock: Clock): Screen {
  return { onlyOpen: { enabled: true }, today: \`Today is \${clock.today}\`, rows: m.rows.map((t) => ({ key: String(t.id), subject: t.subject })) };
}

export const data = (m: Model): Data => ({ ...m });
export const restore = (s: Stored, m: Model): Model => ({ ...m, status: s.status });
`;

const ELM_RECENT = `module App exposing (Model, data, init, restore, update, view)

import Spec exposing (..)


type alias Model =
    { status : Maybe Status, rows : List Ticket }


init : Clock -> ( Model, List Call )
init _ =
    ( { status = Nothing, rows = [] }, [] )


update : Clock -> Msg -> Model -> ( Model, List Call )
update _ msg m =
    case msg of
        OnlyOpenClicked ->
            ( { m | status = Just Open }, [] )

        Started ->
            case m.status of
                Nothing ->
                    ( m, [] )

                Just s ->
                    ( m, [ TicketsListTickets { status = Just s } ] )

        TicketsListTicketsAnswered (TicketsListTickets200 rows) ->
            ( { m | rows = rows }, [] )

        _ ->
            ( m, [] )


view : Clock -> Model -> Screen
view clock m =
    { onlyOpen = { enabled = True }, today = "Today is " ++ clock.today, rows = List.map (\\t -> { key = String.fromInt t.id, subject = t.subject }) m.rows }


data : Model -> Data
data m =
    { status = m.status, rows = m.rows }


restore : Stored -> Model -> Model
restore s m =
    { m | status = s.status }
`;

// ---------------------------------------------------------------- the run

const specDir = join("tests", ".tmp-start"); // `tested with` and `lib/` are the project's
const dirs: string[] = [];
const temp = (name: string) => {
  const d = mkdtempSync(join(tmpdir(), `start-${name}-`));
  dirs.push(d);
  return d;
};
const loadSpec = (name: string, text: string): App => {
  const file = join(specDir, `${name}.intent`);
  writeFileSync(file, text);
  const { app, diagnostics } = load(file, { ignoreLock: true }) as { app?: App; diagnostics: { level: string; message: string }[] };
  assert.ok(app, `${name} loads: ${diagnostics.filter((d) => d.level === "error").map((d) => d.message).join("; ")}`);
  return app!;
};
const build = async (app: App, target: "ts" | "elm", code: string) => {
  const dir = temp(`${app.name}-${target}`);
  scaffold(app, target, dir);
  writeFileSync(join(dir, target === "ts" ? "app.ts" : "src/App.elm"), code);
  // What a build writes for the driver (compiler/build.ts): the stored fields.
  if (usesDraws(app)) writeFileSync(join(dir, "draws.json"), JSON.stringify(drawTable(app)));
  if (usesClock(app)) writeFileSync(join(dir, "clock.json"), JSON.stringify({ start: app.startsAt ?? "2026-01-05T09:00", tickMs: 0, jobs: [] }));
  if (hasStored(app)) writeFileSync(join(dir, "stored.json"), JSON.stringify(app.state.filter((f) => f.stored).map((f) => ({ field: dataField(f.name), line: f.line }))));
  const problems = await targetModule(target).compile(dir);
  assert.equal(problems, "", `${app.name} (${target}) stand-in compiles: ${problems}`);
  return dir;
};

rmSync(specDir, { recursive: true, force: true });
mkdirSync(specDir, { recursive: true });
const browser = await chromium.launch();
try {
  const welcome = loadSpec("welcome", WELCOME);
  const recent = loadSpec("recent", RECENT);
  assert.ok(startsAfterRestore(welcome) && startsAfterRestore(recent));
  assert.ok(!startsAfterRestore(load("apps/17-habits.intent", { ignoreLock: true }).app!), "stored fields without `on start`: nothing changes");

  // The generated interface has `Started`; the prompt says `on start` is that message, not init.
  for (const target of ["ts", "elm"] as const) {
    const p = buildPrompt(target, "welcome.intent", WELCOME, "", false, false, false, false, false, true, true, false, false, [], false, false, [], true);
    assert.match(p, /`on start` is the message `(\{ tag: \\?"Started\\?" \}|Started)`/, `${target}: the prompt names Started`);
    assert.doesNotMatch(buildPrompt(target, "welcome.intent", WELCOME, "", false, false, false, false, false, true, true), /is the message `.*Started/, `${target}: only when the spec has both`);
  }

  // Welcome: the example passes on both targets (the restart check reads the data before `on start` changed `opened`).
  const examples = welcome.examples.map((example) => ({ kind: "example" as const, example }));
  for (const [target, code] of [["ts", TS_WELCOME], ["elm", ELM_WELCOME]] as const) {
    const dir = await build(welcome, target, code);
    const [r] = (await runJobs(dir, target, examples)) as ExampleResult[];
    assert.ok(r.pass, `${target}: "${r.name}" passes (${r.failure?.message})`);

    // In the browser: what the page kept (localStorage) is put back before `on start` runs.
    const page = await browser.newPage();
    await page.goto(pathToFileURL(join(dir, "index.html")).href);
    await page.fill("label.field input", "Ann");
    await page.click('button:has-text("Save")');
    await page.reload();
    await page.waitForSelector('[data-name="greeting"]');
    assert.equal((await page.textContent('[data-name="greeting"]'))?.trim(), "Welcome back, Ann", `${target}: the browser greets by the kept name after a reload`);
    assert.equal((await page.textContent('[data-name="count"]'))?.trim(), "Opened 2 times", `${target}: and \`on start\` counted on the kept count`);
    await page.close();
  }
  // `on start` done in init, on the defaults (what builds did before): the example fails at the restart.
  const before = await build(welcome, "ts", TS_WELCOME_IN_INIT);
  const [bad] = (await runJobs(before, "ts", examples)) as ExampleResult[];
  assert.ok(!bad.pass, "on start in init misses the kept name");
  assert.match(bad.failure!.message, /greeting/);
  console.log("ok welcome: stored fields back before `on start` (test worker, test entry and the browser, on both targets); `on start` may change them; on start in init fails the example");

  // Recent: `on start`'s call carries the kept filter, after a restart and after a reload.
  for (const [target, code] of [["ts", TS_RECENT], ["elm", ELM_RECENT]] as const) {
    const dir = await build(recent, target, code);
    const s = await targetModule(target).open(dir, { now: "2026-01-05T09:00", today: "2026-01-05" });
    assert.deepEqual(await s.calls!(), [], `${target}: nothing kept, so \`on start\` stops`);
    await s.send({ on: "click", target: "onlyOpen" });
    const saved = { status: ((await s.data!()) as { status: string }).status };
    assert.equal(saved.status, "Open");
    await s.send({ on: "restart", target: "", saved });
    const calls = (await s.calls!()) as { endpoint: string; args: { status: string } }[];
    assert.deepEqual(calls.map((c) => [c.endpoint, c.args.status]), [["tickets.listTickets", "Open"]], `${target}: after a restart, \`on start\` calls with the kept filter`);
    assert.deepEqual(await s.restored!(), { status: "Open", rows: [] }, `${target}: the data right after the restore`);

    // The page's calls go where its meta says; the browser answers them here.
    writeFileSync(join(dir, "index.html"), readFileSync(join(dir, "index.html"), "utf8").replace("<head>", '<head><meta name="intent-api" content="http://api.test">'));
    const page = await browser.newPage();
    const sent: string[] = [];
    await page.route("**/tickets**", (route) => {
      sent.push(route.request().url());
      return route.fulfill({ status: 200, contentType: "application/json", body: "[]" });
    });
    await page.goto(pathToFileURL(join(dir, "index.html")).href);
    await page.click('button:has-text("Only open")');
    await page.reload();
    for (let n = 0; n < 50 && !sent.length; n++) await page.waitForTimeout(50);
    assert.ok(sent.some((u) => u.includes("status=Open")), `${target}: the browser's first call after a reload carries the kept filter (${sent.join(", ") || "no call"})`);
    await page.close();
  }
  console.log("ok recent: `on start` calls with the kept filter after a restart (test worker, test entry) and after a reload (browser), on both targets");

  // Styled builds keep nothing yet, but `on start` still runs: the harness sends Started after init.
  // (A styled page draws nothing yet: Welcome without its die.)
  const plain = loadSpec("welcome-plain", WELCOME.replace(/\ntype Die[^\n]*\n/, "\n").replace("  die: Die = 1\n", "").replace(/  button roll[^\n]*\n  text rolled[^\n]*\n/, "").replace(/\non click roll \{[^}]*\}\n/, ""));
  assert.ok(!usesDraws(plain) && startsAfterRestore(plain));
  for (const target of ["ts", "elm"] as const) {
    const dir = temp(`styled-${target}`);
    scaffold(plain, target, dir);
    scaffoldStyled(plain, target, dir);
    const main = readFileSync(join(dir, target === "ts" ? "main.tsx" : "src/Main.elm"), "utf8");
    assert.match(main, target === "ts" ? /App\.update\(\{ tag: "Started" \}, App\.init\(\)\)/ : /App\.update Spec\.Started App\.init/, `${target}: the styled entry sends Started`);
  }
  console.log("ok styled: the styled entries send Started after init");
} finally {
  await browser.close();
  rmSync(specDir, { recursive: true, force: true });
  for (const d of dirs) rmSync(d, { recursive: true, force: true });
}
