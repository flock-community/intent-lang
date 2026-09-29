// An answer to a call reaches the app the same way on both targets (the harness's glue, no LLM):
// Elm's `Spec.fromAnswer` and TypeScript's `fromAnswer` must give the same message for every answer
// the drivers deliver, or two builds that both pass every example are different apps (Elm≡TS).
// Found by the final v1 converge round (runs/r1-all): a call still in progress after its last attempt
// (409 with an error and no body) was a failure on TypeScript and "the body does not fit" on Elm, and
// the statuses in "which the contract does not declare (…)" were listed in two orders.
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
process.chdir(ROOT);
const { load } = await import(join(ROOT, "compiler/load.ts"));
const gen = await import(join(ROOT, "compiler/gen.ts"));

const { app } = load("apps/18-checkout.intent", { ignoreLock: true });
assert.ok(app, "the checkout spec loads");
const fake = mkdtempSync(join(tmpdir(), "answers-layer-"));
for (const f of ["layer.ts", "spec.ts", "http.ts", "fmt.ts"]) writeFileSync(join(fake, f), "export {};\n"); // a layer's build: its code is the model's
const layerDirs = new Proxy({}, { get: () => fake });
const elmDir = mkdtempSync(join(tmpdir(), "answers-elm-"));
const tsDir = mkdtempSync(join(tmpdir(), "answers-ts-"));
gen.scaffold(app, "elm", elmDir, layerDirs);
gen.scaffold(app, "ts", tsDir, layerDirs);

// What the drivers and the browser runtime deliver (compiler/exec.ts, runtime/ts/calls.ts).
const answers = [
  { endpoint: "pay.refund", status: 409, error: "another attempt is in progress", inProgress: true }, // `steer … slow`, still running
  { endpoint: "pay.refund", status: 503, body: { error: "Service unavailable" } }, // a status the contract does not declare
  { endpoint: "pay.refund", status: 0, error: "no answer (request lost)" },
  { endpoint: "pay.refund", status: 0 }, // no error given
  { endpoint: "pay.charge", status: 0, error: "no answer after 3 attempts (last: 503)", unknown: true }, // effect external
  { endpoint: "pay.charge", status: 418, body: null },
  // Held-out round 4 converge: a body that does not fit the contract was worded two ways.
  { endpoint: "pay.charge", status: 201, body: { id: "seven", amount: 5 } }, // a declared status, a body of the wrong shape
  { endpoint: "pay.refund", status: 200, body: 12 }, // not a record at all
  { endpoint: "pay.refund", status: 200 }, // a body the contract needs is missing
  { endpoint: "pay.sendReceipt", status: 204, body: { sent: true } }, // a body where the contract declares none
  { endpoint: "pay.sendReceipt", status: 204 }, // and none: the answer
];

// TypeScript: the generated spec.ts's fromAnswer.
const spec = await import(join(tsDir, "spec.ts"));
const tsSays = answers.map((a) => {
  const m = spec.fromAnswer(structuredClone(a)) as { answer: { status: number | string; error?: string } } | null;
  if (m && m.answer.status !== "unknown" && m.answer.status !== 0) return "answered"; // a status the contract declares, with its body (as Elm's probe says)
  return m ? `${m.answer.status === "unknown" ? "unknown" : m.answer.status === 0 ? "failed" : `status ${m.answer.status}`}: ${m.answer.error ?? ""}` : "none";
});

// Elm: a worker that reads the same answers through Spec.fromAnswer and says what each became.
mkdirSync(join(elmDir, "src"), { recursive: true });
writeFileSync(
  join(elmDir, "src/Probe.elm"),
  `port module Probe exposing (main)

import Json.Decode as D
import Spec


port out : List String -> Cmd msg


say : D.Value -> String
say v =
    case Spec.fromAnswer v of
        Just (Spec.PayRefundAnswered (Spec.PayRefundFailed e)) ->
            "failed: " ++ e

        Just (Spec.PayChargeAnswered (Spec.PayChargeFailed e)) ->
            "failed: " ++ e

        Just (Spec.PayChargeAnswered (Spec.PayChargeUnknown e)) ->
            "unknown: " ++ e

        Just (Spec.PaySendReceiptAnswered (Spec.PaySendReceiptFailed e)) ->
            "failed: " ++ e

        Just _ ->
            "answered"

        Nothing ->
            "none"


main : Program (List D.Value) () ()
main =
    Platform.worker { init = \\vs -> ( (), out (List.map say vs) ), update = \\_ m -> ( m, Cmd.none ), subscriptions = \\_ -> Sub.none }
`,
);
const made = spawnSync(join(ROOT, "node_modules/.bin/elm"), ["make", "src/Probe.elm", "--output=probe.js"], { cwd: elmDir, encoding: "utf8" });
assert.equal(made.status, 0, `the probe compiles:\n${made.stdout}${made.stderr}`);
copyFileSync(join(elmDir, "probe.js"), join(elmDir, "probe.cjs"));
const { Elm } = createRequire(import.meta.url)(join(elmDir, "probe.cjs")) as { Elm: { Probe: { init: (o: { flags: unknown }) => { ports: { out: { subscribe: (f: (xs: string[]) => void) => void } } } } } };
const elmSays = await new Promise<string[]>((done) => Elm.Probe.init({ flags: answers }).ports.out.subscribe(done));

answers.forEach((a, i) => assert.equal(elmSays[i], tsSays[i], `${JSON.stringify(a)}: Elm and TypeScript read this answer differently`));
assert.match(tsSays[0], /^failed: another attempt is in progress$/);
assert.match(tsSays[1], /^failed: pay\.refund answered 503, which the contract does not declare \(\d+(, \d+)*\)$/);
const listed = tsSays[1].match(/\(([^)]*)\)$/)![1].split(", ").map(Number);
assert.deepEqual(listed, [...listed].sort((x, y) => x - y), "the declared statuses are listed in ascending order");
assert.equal(tsSays[3], "failed: no answer");
assert.equal(tsSays[6], "failed: pay.charge answered 201, but the body does not fit the contract");
assert.equal(tsSays[7], "failed: pay.refund answered 200, but the body does not fit the contract");
assert.equal(tsSays[8], "failed: pay.refund answered 200, but the body does not fit the contract");
assert.equal(tsSays[9], "failed: pay.sendReceipt answered 204, but the body does not fit the contract");
assert.equal(tsSays[10], "answered");

rmSync(elmDir, { recursive: true, force: true });
rmSync(tsDir, { recursive: true, force: true });
rmSync(fake, { recursive: true, force: true });
console.log(`ok answers-parity: ${answers.length} answers read the same on Elm and TypeScript`);
