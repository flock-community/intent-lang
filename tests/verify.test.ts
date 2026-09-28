// What the verification counts, without an LLM: a session a build crashed on is never agreement (also
// when every build crashed), a hunt whose sessions crashed or could not run is a failure, `see every`
// in an example fails on a missing list or field instead of passing on nothing, a shown number is read
// as the formatter writes it (or refused), and a mutant is caught only by an example that was green.
import assert from "node:assert/strict";
import { compare } from "../compiler/fuzz.ts";
import { sessionsBroke } from "../compiler/build.ts";
import { checkSee } from "../compiler/exec.ts";
import { checkSeeApi } from "../compiler/api.ts";
import { greenOf, newlyRed } from "../compiler/mutate.ts";

// ---------------------------------------------------------------- H2: a crash is a disagreement
{
  const traces = [[{ t: 1 }], [{ t: 2 }], [{ t: 3 }]];
  const text = (a: { t: number }) => String(a.t);
  const allCrash = compare(traces, new Map([["A", [null, null, null]], ["B", [null, null, null]]]), text, false);
  assert.equal(allCrash.agree, 0, "builds that both crash on every session do not agree");
  assert.equal(allCrash.divergences.length, 3);
  assert.equal(allCrash.divergences[0].groups[0].screen, "(crashed)");
  assert.equal(allCrash.matchMajority.get("A"), 0, "crashing is never the majority behaviour");
  const one = compare(traces, new Map([["A", [["x"], ["y"], null]], ["B", [["x"], ["y"], null]]]), text, false);
  assert.deepEqual([one.agree, one.total], [2, 3], "one shared crash is one disagreement");
}

// ---------------------------------------------------------------- H3: a hunt that crashed is no clean hunt
{
  assert.equal(sessionsBroke([{ actions: [] }, { actions: [] }]), undefined, "clean sessions: clean");
  assert.match(sessionsBroke({ error: "timed out" })!.problem, /could not run: timed out/, "a batch that did not run is a failure");
  const crashed = sessionsBroke([{ actions: [] }, { actions: [{ on: "click", target: "add" }], error: "TypeError: x is undefined" }])!;
  assert.match(crashed.problem, /1 of 2 random sessions crashed: TypeError/);
  assert.match(crashed.problem, /click add/, "with the session that crashed");
  assert.equal(sessionsBroke([{ actions: [], error: "boom" }, { actions: [], violation: { line: 3 } }]), undefined, "a broken rule is reported as the rule it breaks");
}

// ---------------------------------------------------------------- M9a: `see every` over nothing
{
  const obs: any = { c: [{ k: "list", n: "tickets", rows: [{ c: [{ k: "text", n: "state", v: "Closed" }] }] }] };
  const see = (target: string, every: string) => ({ do: "see", target, every, check: { is: "eq", value: "Open" }, line: 1 }) as any;
  assert.match(checkSee(obs, see("status", "orders"))!, /no list `orders`/, "a missing list fails in an example");
  assert.match(checkSee(obs, see("status", "tickets"))!, /has no `status`/, "a row without the element fails in an example");
  assert.equal(checkSee(obs, see("status", "orders"), true), undefined, "in `always` a list that is not shown is skipped");
  assert.equal(checkSee(obs, see("status", "tickets"), true), undefined);
  assert.equal(checkSee(obs, { ...see("status", "orders"), check: { is: "hidden" } }), undefined, "`is hidden` on no list holds");
  const res = new Map([["listTickets", { status: 200, body: [{ id: 1, state: "Closed" }] }]]) as any;
  assert.match(checkSeeApi(res, see("status", "listTickets.body"))!, /has no `status`/, "an answer's row without the field fails");
  assert.equal(checkSeeApi(res, see("status", "listTickets.body"), true), undefined);
}

// ---------------------------------------------------------------- M9b: numbers as the formatter writes them
{
  const num = (v: string, op: string, value: number) => checkSee({ c: [{ k: "text", n: "total", v }] } as any, { do: "see", target: "total", check: { is: "num", op, value }, line: 1 } as any);
  assert.match(num("Total: 1,250 items", "atMost", 5)!, /read two ways/, "a comma is refused, not read as 1.25");
  assert.match(num("1.250.000", "atLeast", 1)!, /read two ways/);
  assert.equal(num("Total: 1250.50", "atLeast", 1000), undefined);
  assert.equal(num("-3 left", "below", 0), undefined);
}

// ---------------------------------------------------------------- M9d: caught means a green example turned red
{
  const baseline = greenOf([{ name: "a", pass: true }, { name: "b", pass: false }]);
  assert.deepEqual(newlyRed(baseline, [{ name: "a", pass: false }, { name: "b", pass: false }]), ["a"], "an example red at the baseline catches nothing");
  assert.deepEqual(newlyRed(baseline, { error: "did not run" }), [], "a batch that did not run catches nothing");
  assert.deepEqual([...greenOf({ error: "x" })], []);
}

console.log("ok verify: crashes disagree, a crashed hunt fails, `see every` over nothing fails, numbers read one way, mutants caught by green examples only");
