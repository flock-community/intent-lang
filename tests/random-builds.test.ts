// Draws through the harness (v69), without an LLM: stand-in app modules written for the test (a real
// build's are the model's) for apps/36-table.intent on both targets and apps/api/invites-api.intent,
// compiled with each target's toolchain and driven as builds are. Examples steer draws; a steered
// value never drawn fails the example; an unsteered draw comes from the example's name, the same in
// TypeScript and Elm; the same session (with its draws) gives the same screens on both targets; a
// random session writes its draws down as `steer random` steps to paste; codes are read forgivingly
// by the api; and a module that makes its own randomness is rejected.
import assert from "node:assert/strict";
import { pathToFileURL } from "node:url";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { load } from "../compiler/load.ts";
import { dataField, scaffold } from "../compiler/gen.ts";
import { targetModule } from "../compiler/targets/index.ts";
import { runJobs, type Action, type ExampleResult, type ExploreResult, type TraceResult } from "../compiler/exec.ts";
import { actionText, exploreJobs } from "../compiler/fuzz.ts";
import { drawTable, simplerDraws } from "../compiler/drawer.ts";
import { ownRandomness } from "../compiler/draws.ts";
import { apiTraces, callText, runApiJobs, scaffoldApi, type Call } from "../compiler/api.ts";
import { parseSyntax } from "../compiler/parse.ts";
import { typeDescOf } from "../compiler/targets/ts-service.ts";

const TS_TABLE = `import type { Card, Data, Die, Draws, Msg, Screen } from "./spec.ts";
import { deckInitial } from "./spec.ts";

export type Model = { first: Die; second: Die; rolled: boolean; deck: Card[]; hand: Card[]; drawn: Card | null };

export function init(): Model {
  return { first: 1, second: 1, rolled: false, deck: deckInitial, hand: [], drawn: null };
}

export function update(msg: Msg, m: Model, draws: Draws): Model {
  switch (msg.tag) {
    case "RollClicked": {
      const first = draws.roll1();
      const second = draws.roll2();
      return { ...m, first, second, rolled: true };
    }
    case "DealClicked":
      return { ...m, hand: draws.deal1(m.deck).slice(0, 5) };
    case "DrawClicked":
      return { ...m, drawn: draws.draw1(m.deck) };
  }
}

export function view(m: Model): Screen {
  return { roll: { enabled: true }, dice: m.rolled ? \`\${m.first} and \${m.second}\` : null, total: m.rolled ? String(m.first + m.second) : null, deal: { enabled: true }, hand: m.hand.map((c) => ({ key: c.name, name: c.name })), draw: { enabled: true }, card: m.drawn ? m.drawn.name : null };
}

export const data = (m: Model): Data => ({ first: m.first, second: m.second, rolled: m.rolled, deck: m.deck, hand: m.hand, drawn: m.drawn });
`;

const ELM_TABLE = `module App exposing (Model, data, init, update, view)

import Spec exposing (..)


type alias Model =
    { first : Die, second : Die, rolled : Bool, deck : List Card, hand : List Card, drawn : Maybe Card }


init : Model
init =
    { first = 1, second = 1, rolled = False, deck = deckInitial, hand = [], drawn = Nothing }


update : Draws -> Msg -> Model -> Model
update draws msg m =
    case msg of
        RollClicked ->
            let
                first =
                    draws.roll1 ()

                second =
                    draws.roll2 ()
            in
            { m | first = first, second = second, rolled = True }

        DealClicked ->
            { m | hand = List.take 5 (draws.deal1 m.deck) }

        DrawClicked ->
            { m | drawn = draws.draw1 m.deck }


view : Model -> Screen
view m =
    { roll = { enabled = True }
    , dice =
        if m.rolled then
            Just (String.fromInt m.first ++ " and " ++ String.fromInt m.second)

        else
            Nothing
    , total =
        if m.rolled then
            Just (String.fromInt (m.first + m.second))

        else
            Nothing
    , deal = { enabled = True }
    , hand = List.map (\\c -> { key = c.name, name = c.name }) m.hand
    , draw = { enabled = True }
    , card = Maybe.map .name m.drawn
    }


data : Model -> Data
data m =
    { first = m.first, second = m.second, rolled = m.rolled, deck = m.deck, hand = m.hand, drawn = m.drawn }
`;

const TS_INVITES = `import type { Data, Handlers, Invite, Stored } from "./spec.ts";
import { answer, fail } from "./api.ts";

export type Model = { invites: Invite[] };

export function init(): Model {
  return { invites: [] };
}

export const data = (m: Model): Data => ({ invites: m.invites });
export const restore = (saved: Stored, m: Model): Model => ({ ...m, invites: saved.invites });

export const handlers: Handlers<Model> = {
  invite: (req, model, draws) => {
    if (req.email.trim() === "") return { model, response: fail(400, "An email is required") };
    const code = draws.freeCode1(model.invites.map((i) => i.code));
    if (code === null) return { model, response: fail(503, "No invitation code is free") };
    const inv = { code, email: req.email.trim(), used: false };
    return { model: { invites: [...model.invites, inv] }, response: answer(201, inv) };
  },
  accept: (req, model) => {
    const inv = model.invites.find((i) => i.code === req.code);
    if (!inv) return { model, response: fail(404, "No such invitation") };
    if (inv.used) return { model, response: fail(409, "This invitation was used already") };
    const used = { ...inv, used: true };
    return { model: { invites: model.invites.map((i) => (i.code === inv.code ? used : i)) }, response: answer(200, used) };
  },
};
`;

const dirs: string[] = [];
const temp = (name: string) => {
  const d = mkdtempSync(join(tmpdir(), `random-${name}-`));
  dirs.push(d);
  return d;
};
try {
  // ---------------------------------------------------------------- a screen, on both targets
  const { app } = load("apps/36-table.intent", { ignoreLock: true });
  assert.ok(app, "apps/36-table.intent loads");
  const built: Record<string, string> = {};
  for (const [target, file, code] of [["ts", "app.ts", TS_TABLE], ["elm", "src/App.elm", ELM_TABLE]] as const) {
    const dir = temp(target);
    scaffold(app!, target, dir);
    writeFileSync(join(dir, file), code);
    // What a build writes for the driver (compiler/build.ts): the draw sites.
    writeFileSync(join(dir, "draws.json"), JSON.stringify(drawTable(app!)));
    const problems = await targetModule(target).compile(dir);
    assert.equal(problems, "", `the ${target} stand-in compiles: ${problems}`);
    built[target] = dir;
  }
  const examples = app!.examples.map((example) => ({ kind: "example" as const, example }));
  for (const target of ["ts", "elm"]) {
    const res = (await runJobs(built[target], target, examples)) as ExampleResult[];
    for (const r of res) assert.ok(r.pass, `${target}: example "${r.name}" passes (${r.failure?.message})`);
  }
  console.log(`ok screen: the table's ${examples.length} examples pass on TypeScript and Elm (dice, a kept and a reversed deck, the third card steered)`);

  // A steered value that is never drawn fails the example, at its steer step.
  const ex = parseSyntax(`app X {\n  "x"\n}\n\nexample "a die nobody rolls" {\n  steer random Die = 6\n  click deal\n  see hand has 5 rows\n}\n`).app!.examples[0];
  for (const target of ["ts", "elm"]) {
    const [r] = (await runJobs(built[target], target, [{ kind: "example", example: ex }])) as ExampleResult[];
    assert.ok(!r.pass && r.failure!.line === 6, `${target}: the example fails at the steer step`);
    assert.match(r.failure!.message, /steered Die 6 was never drawn/);
  }
  console.log("ok steering: a steered value never drawn fails the example, at its step");

  // Unsteered draws: the same values on both targets (the example's seed, and the place of each draw).
  const plain = parseSyntax(`app X {\n  "x"\n}\n\nexample "just roll" {\n  click roll\n  click deal\n  click draw\n}\n`).app!.examples[0];
  const screens: Record<string, string[]> = {};
  for (const target of ["ts", "elm"]) {
    const [t] = (await runJobs(built[target], target, [{ kind: "trace", actions: [{ on: "click", target: "roll" }, { on: "click", target: "deal" }, { on: "click", target: "draw" }, { on: "click", target: "roll" }] }])) as TraceResult[];
    assert.ok(!t.error, t.error ?? "");
    screens[target] = t.steps;
  }
  assert.deepEqual(screens.elm, screens.ts, "the same session draws the same dice, deck and card on Elm and TypeScript");
  const shown = JSON.parse(screens.ts[4]);
  assert.equal(shown.c.find((n: { n: string }) => n.n === "hand").rows.length, 5);
  // An example's seed is its name: another example (or none) changes nothing about this one.
  const again = (await runJobs(built.ts, "ts", [{ kind: "example", example: plain }, { kind: "example", example: plain }])) as ExampleResult[];
  assert.ok(again.every((r) => r.pass));
  console.log("ok twins: an unsteered session gives the same screens on Elm and TypeScript, step by step");

  // A random session writes each action's draws before it; replayed, it shows the same screens.
  const explored = (await runJobs(built.ts, "ts", exploreJobs({ ...app!, examples: [] }, 6, 12, 5))) as ExploreResult[];
  const withDraws = explored.find((e) => e.actions.some((a) => a.on === "random"));
  assert.ok(withDraws, "random sessions write their draws down");
  const lines = withDraws!.actions.map(actionText);
  assert.ok(lines.some((l) => /^steer random Die = [1-6](, [1-6])*$/.test(l)), `paste-ready: ${lines.filter((l) => l.startsWith("steer")).join(" | ")}`);
  assert.ok(lines.filter((l) => l.startsWith("steer random")).every((l) => parseSyntax(`app X {\n  "x"\n}\n\nexample "e" {\n  ${l}\n  click roll\n}\n`).diagnostics.every((d) => d.code !== "SYNTAX")), "every written steer step parses");
  const replays: Record<string, string[]> = {};
  for (const target of ["ts", "elm"]) replays[target] = ((await runJobs(built[target], target, [{ kind: "trace", actions: withDraws!.actions }])) as TraceResult[])[0].steps;
  assert.deepEqual(replays.elm, replays.ts, "the written session replays the same on both targets");
  // Edges: over many sessions, the bounds of a die show up.
  const many = (await runJobs(built.ts, "ts", exploreJobs({ ...app!, examples: [] }, 30, 20, 9))) as ExploreResult[];
  const dice = many.flatMap((e) => e.actions.filter((a) => a.on === "random" && a.target === "Die").flatMap((a) => a.value!.split(", ")));
  assert.ok(dice.includes("1") && dice.includes("6"), "random sessions reach a die's edges");
  const orders = many.flatMap((e) => e.actions.filter((a) => a.on === "random" && a.target === "shuffle").map((a) => a.value));
  assert.ok(orders.includes("keep") || orders.includes("reverse"), "and keep or reverse a shuffle now and then");
  console.log(`ok sessions: draws written as steps to paste (${lines.filter((l) => l.startsWith("steer")).slice(0, 2).join("; ")}), edges reached, replays agree on both targets`);

  // Shrinking: every steered draw at its simplest.
  const simpler = simplerDraws<Action>([{ on: "random", target: "Die", value: "4, 6" }, { on: "click", target: "roll" }, { on: "random", target: "shuffle", value: "reverse" }, { on: "random", target: "pick", value: "3" }], drawTable(app!));
  assert.deepEqual(simpler!.map(actionText), ["steer random Die = 1, 1", "click roll", "steer random shuffle keeps order", "steer random pick 1"]);

  // A planted bug: dice from 0 to 5. The examples that steer 6s cannot see it; random sessions, with
  // edge values, break \`always\` (total at least 2), and the session to paste steers the dice.
  const bad = temp("bad");
  scaffold(app!, "ts", bad);
  writeFileSync(join(bad, "app.ts"), TS_TABLE.replace("const first = draws.roll1();", "const first = (draws.roll1() - 1) as Die;"));
  writeFileSync(join(bad, "draws.json"), JSON.stringify(drawTable(app!)));
  assert.equal(await targetModule("ts").compile(bad), "");
  const caught = ((await runJobs(bad, "ts", exploreJobs(app!, 20, 20, 11))) as ExploreResult[]).find((e) => e.violation);
  assert.ok(caught, "a random session breaks `always` on the off-by-one die");
  const paste = caught!.violation!.actions.map(actionText);
  assert.ok(paste.some((l) => l.startsWith("steer random Die = ")), `the session steers its dice: ${paste.join(" | ")}`);
  console.log(`ok planted bug: an off-by-one die breaks \`always\` in a random session (${paste.filter((l) => l.startsWith("steer")).slice(0, 2).join("; ")})`);

  // ---------------------------------------------------------------- an api: codes drawn not among the taken, read forgivingly
  const api = load("apps/api/invites-api.intent", { ignoreLock: true }).app!;
  const adir = temp("api");
  scaffoldApi(api, adir, {});
  writeFileSync(join(adir, "app.ts"), TS_INVITES);
  writeFileSync(join(adir, "endpoints.json"), JSON.stringify((api.endpoints ?? []).map((e) => ({ name: e.name, method: e.method, path: e.path, params: e.params.map((p) => ({ in: p.in, name: p.name, type: typeDescOf(api, p.type) })) }))));
  writeFileSync(join(adir, "stored.json"), JSON.stringify(api.state.filter((f) => f.stored).map((f) => ({ field: dataField(f.name), line: f.line }))));
  writeFileSync(join(adir, "draws.json"), JSON.stringify(drawTable(api)));
  const svc = targetModule("ts").service!;
  const problems = await svc.compileApi(adir);
  assert.equal(problems, "", `the api stand-in compiles: ${problems}`);
  const results = (await runApiJobs(adir, api.examples.map((example) => ({ kind: "api-example" as const, example })))) as { name: string; pass: boolean; failure?: { message: string } }[];
  for (const r of results) assert.ok(r.pass, `api example "${r.name}" passes (${r.failure?.message})`);
  // A random call session steers edge codes now and then (twice the same: `not among` must skip one), and writes its draws down.
  const traces = apiTraces(api, 20, 12, 3);
  assert.ok(traces.some((t) => t.some((c) => c.endpoint === "(random)")), "api sessions steer edge values");
  const runs = (await runApiJobs(adir, traces.map((calls) => ({ kind: "api-trace" as const, calls, always: api.always })))) as TraceResult[];
  assert.ok(runs.every((r) => !r.error), runs.find((r) => r.error)?.error ?? "");
  const text = traces.flat().filter((c: Call) => c.endpoint === "(random)").map(callText);
  assert.ok(text.every((l) => /^steer random (InviteCode = "[0-9A-Z]{8}"(, "[0-9A-Z]{8}")?)$/.test(l)), text.join(" | "));
  // A draw never falls back to a fixed seed: a request without the driver's draws, and no CSPRNG seed, is refused.
  const bare = (await import(pathToFileURL(join(adir, "test.mjs")).href + `?bare=${Date.now()}`)).start();
  assert.throws(() => bare.send("POST", "/invites", {}, { email: "a@b.nl" }, { "idempotency-key": "0123456789abcdef0123456789abcdef" }), /32-byte seed/, "no seed: nothing is drawn");
  const { scaffoldStyled } = await import("../compiler/styled.ts");
  assert.throws(() => scaffoldStyled(app!, "ts", temp("styled")), /draw random values/, "a styled page has no seed yet: it is not built");
  // A planted bug: a build that ignores \`not among\` hands out a taken code: the example that proves it fails.
  const bdir = temp("api-bad");
  scaffoldApi(api, bdir, {});
  writeFileSync(join(bdir, "app.ts"), TS_INVITES.replace("draws.freeCode1(model.invites.map((i) => i.code))", "draws.freeCode1([])"));
  for (const f of ["endpoints.json", "stored.json", "draws.json"]) writeFileSync(join(bdir, f), JSON.stringify(JSON.parse((await import("node:fs")).readFileSync(join(adir, f), "utf8"))));
  assert.equal(await svc.compileApi(bdir), "");
  const badRes = (await runApiJobs(bdir, api.examples.map((example) => ({ kind: "api-example" as const, example })))) as { name: string; pass: boolean }[];
  assert.deepEqual(badRes.filter((r) => !r.pass).map((r) => r.name), ["two invitations never share a code"], "ignoring `not among` fails the example that proves it");
  console.log(`ok api: ${results.length} examples pass (a code read forgivingly, two invitations never share one, restart); sessions steer edges (${text[0]})`);
  // v73: a derived value that draws is drawn once per event. A build that reads @freeCode again after
  // storing it (what it excludes has changed) gets the same code, so the answer is the stored invite;
  // steered values are taken once per event, so every example still passes.
  const kdir = temp("api-kept");
  scaffoldApi(api, kdir, {});
  writeFileSync(join(kdir, "app.ts"), TS_INVITES.replace("return { model: { invites: [...model.invites, inv] }, response: answer(201, inv) };", "const invites = [...model.invites, inv];\n    const again = draws.freeCode1(invites.map((i) => i.code));\n    return { model: { invites }, response: answer(201, { ...inv, code: again ?? \"\" }) };"));
  for (const f of ["endpoints.json", "stored.json", "draws.json"]) writeFileSync(join(kdir, f), (await import("node:fs")).readFileSync(join(adir, f), "utf8"));
  assert.equal(await svc.compileApi(kdir), "");
  const keptRes = (await runApiJobs(kdir, api.examples.map((example) => ({ kind: "api-example" as const, example })))) as { name: string; pass: boolean; failure?: { message: string } }[];
  for (const r of keptRes) assert.ok(r.pass, `a derived draw read twice in one request: "${r.name}" passes (${r.failure?.message})`);
  const keptRuns = (await runApiJobs(kdir, traces.map((calls) => ({ kind: "api-trace" as const, calls, always: api.always })))) as TraceResult[];
  assert.ok(keptRuns.every((r) => !r.error), keptRuns.find((r) => r.error)?.error ?? "");
  // The generated draws directly: one value per event whatever it excludes later; another event draws anew.
  const spec = await import(pathToFileURL(join(adir, "spec.ts")).href);
  const [s1, s2] = ["a", "b"].map((c) => c.repeat(64));
  const d1 = spec.drawsFrom({ seed: s1 });
  const first = d1.freeCode1([]);
  assert.equal(d1.freeCode1([first]), first, "a second read in the same event keeps the first value, even though it is now taken");
  assert.equal(spec.drawsFrom({ seed: s1 }).freeCode1([]), first, "the same event's seed gives the same value");
  assert.notEqual(spec.drawsFrom({ seed: s2 }).freeCode1([]), first, "another event draws anew");
  console.log("ok api: a derived value that draws is drawn once per event (read again after it was stored: the same code); another request draws anew");

  // ---------------------------------------------------------------- the build rejects its own randomness
  assert.equal(ownRandomness(TS_TABLE, "ts"), undefined);
  assert.equal(ownRandomness(ELM_TABLE, "elm"), undefined);
  assert.match(ownRandomness(TS_TABLE.replace("draws.roll1()", "(1 + Math.floor(Math.random() * 6)) as Die"), "ts") ?? "", /Math\.random/);
  assert.match(ownRandomness(`import { randomBytes } from "node:crypto";\n${TS_INVITES}`, "ts") ?? "", /crypto/);
  assert.match(ownRandomness(TS_TABLE.replace("return {", "const k = crypto.getRandomValues(new Uint8Array(4));\n  return {"), "ts") ?? "", /crypto/);
  // Every spelling a review found: computed names, destructuring, spaces, a `//` inside a string, the
  // Web Crypto API by any path, the clock, a dynamic import, and the harness's own runtime files.
  for (const bad of ['const r = Math["random"]();', "const { random } = Math; random();", "const r = Math . random();", "const c = globalThis[\"crypto\"];", "const r = crypto.subtle.generateKey;", 'const r = self.crypto["randomUUID"]();', 'const x = "http://a"; const r = Math.random();', "const s = `//`; const r = Math.random();", 'import("node:crypto").then((m) => m.randomInt(3));', "const t = performance.now() % 6;", "const t = Date.now() % 6;", 'import { freshSeed } from "./draw.ts";', 'import { newKey } from "./calls.ts";', 'const m = require("crypto");'])
    assert.ok(ownRandomness(`${bad}\n${TS_TABLE}`, "ts"), `rejected: ${bad}`);
  assert.equal(ownRandomness(`const label = "Math.random // crypto";\n${TS_TABLE}`, "ts"), undefined, "text in a string is not code");
  for (const bad of ["import Random as R", "import   Random.Extra", "import Time", "import Task"]) assert.ok(ownRandomness(ELM_TABLE.replace("import Spec exposing (..)", `${bad}\nimport Spec exposing (..)`), "elm"), `rejected: ${bad}`);
  assert.ok(!/"elm\/random"/.test((await import("node:fs")).readFileSync("runtime/elm/elm.json", "utf8")), "an Elm build has no elm/random");
  // In tests the module's own randomness throws, whatever the static reading missed.
  const { execFileSync } = await import("node:child_process");
  const probe = execFileSync(process.execPath, ["--input-type=module", "-e", `await import(${JSON.stringify(new URL("../runtime/ts/norandom.ts", import.meta.url).pathname)}); const t = (f) => { try { f(); return "ran"; } catch { return "threw"; } }; console.log([t(() => Math.random()), t(() => globalThis.crypto.getRandomValues(new Uint8Array(2))), t(() => crypto.randomUUID()), t(() => crypto.subtle.digest("SHA-256", new Uint8Array(1)))].join(","));`], { encoding: "utf8" }).trim();
  assert.equal(probe, "threw,threw,threw,threw", "norandom.ts: Math.random and Web Crypto throw in a test entry");
  assert.match(ownRandomness(ELM_TABLE.replace("import Spec exposing (..)", "import Random\nimport Spec exposing (..)"), "elm") ?? "", /import Random/);
  assert.equal(ownRandomness(`// never Math.random here\n${TS_TABLE}`, "ts"), undefined, "a comment is not code");
  assert.equal(ownRandomness(`{- no import Random -}\n${ELM_TABLE}`, "elm"), undefined);
  console.log("ok ban: a module with Math.random, crypto or Elm's Random is rejected; comments do not count");
} finally {
  for (const d of dirs) rmSync(d, { recursive: true, force: true });
}
