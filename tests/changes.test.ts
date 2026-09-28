// Change rules (v67): the named forms the harness checks itself on hand-made before/after data (key
// matching, removal, stuttering, a transition outside the table), the stage's helpers (a multiset
// difference for a list of plain values), and the drivers: a screen checked on every event (not per
// settled step; a restart is not a step) and an api checked per request and per run of recurring
// work, each with a planted violation that must be caught and traced to the rule's line.
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { parse } from "../compiler/parse.ts";
import { changePlan, checkStep, coveredKeys, parseChange, parsePairs, transitionCoverage, watch } from "../compiler/changes.ts";
import { CHANGE_HELPERS, invariantsPrompt, stageSentences } from "../compiler/invariants.ts";
import { typedCoverage } from "../compiler/fit.ts";
import { sourceMap } from "../compiler/load.ts";
import { runJobs } from "../compiler/exec.ts";
import { runApiJobs } from "../compiler/api.ts";

const spec = `app Approvals {
  "Expenses: approved or rejected ones never change."
}

choice Status: Pending | Approved | Rejected

record Expense {
  id: Int
  amount: Decimal
  status: Status
}

state {
  expenses: List Expense = []
  tags: List Text = []
  nextId: Int = 1
}

screen {
  text count = "{the number of @expenses}"
}

always {
  - no two @expenses have the same @id
  - an @Expense whose @status was @Approved never changes
  - an @Expense whose @status was @Rejected never changes
  - an @Expense's @status only changes from @Pending to @Approved or @Rejected
  - every @status in the new @expenses is @Pending
  - an @Expense is never removed
  - @nextId never goes down
}

example "empty" {
  see count = "0"
}
`;
const { app, diagnostics } = parse(spec);
assert.ok(app, diagnostics.filter((d) => d.level === "error").map((d) => `${d.line} ${d.code} ${d.message}`).join("; "));
const line = (text: string) => spec.split("\n").findIndex((l) => l.includes(text)) + 1;

// Reading the forms.
assert.deepEqual(parsePairs("@Open to @Solved, from @Solved to @Open or @Closed"), [["Open", "Solved"], ["Solved", "Open"], ["Solved", "Closed"]]);
assert.equal(parseChange("no two @expenses have the same @id"), undefined, "a one-moment rule is not a change rule");
assert.deepEqual(parseChange("@balance is @balance before plus 1"), { general: true });

// The plan: named forms to the harness, the general form (and nothing else) to the stage.
const plan = changePlan(app!);
assert.deepEqual(plan.named.map((c) => c.form), ["frozen", "frozen", "transitions", "kept", "order"]);
assert.deepEqual(plan.general, [{ line: line("every @status in the new"), text: "every @status in the new @expenses is @Pending" }]);
assert.deepEqual(stageSentences(app!).invariants.map((i) => i.text), ["no two @expenses have the same @id"], "the stage gets the one-moment rule");
const prompt = invariantsPrompt(app!, spec);
assert.match(prompt, /export const changes: \{ line: number; holds: \(before: Data, after: Data, clock: Clock\) => boolean \}\[\]/, "the stage's module has the two-state shape");
assert.match(prompt, /Fmt\.added\(before\.xs, after\.xs, "<key>"\)/, "and is told the helpers");
assert.ok(!prompt.slice(prompt.indexOf("# The sentences to check"), prompt.indexOf("# The app's data")).includes("never changes"), "named forms never reach the stage's list");

// Typed: every change rule is typed whole (`intent check --typed`).
for (const c of typedCoverage(app!).filter((x) => x.where === "always")) assert.ok(c.typed, `typed whole: ${c.text}`);

// The source map lists every `always` sentence, change rules with their form.
const map = sourceMap(app!);
const entry = map[`always :${line("whose @status was @Approved")}`];
assert.deepEqual([entry.kind, entry.line, entry.form], ["change", line("whose @status was @Approved"), "frozen"]);
assert.equal(map[`always :${line("no two @expenses")}`].kind, "always");

// The named checks on hand-made data.
const [approved, rejected, table, kept, nextId] = plan.named;
const e = (id: number, amount: number, status: string) => ({ id, amount, status });
const before = { expenses: [e(1, 10, "Pending"), e(2, 45, "Approved"), e(3, 7, "Rejected")], tags: [], nextId: 4 };
const after = (expenses: unknown[], nextIdAfter = 4) => ({ expenses, tags: [], nextId: nextIdAfter });
assert.equal(checkStep(approved, before, after([e(3, 7, "Rejected"), e(2, 45, "Approved"), e(1, 10, "Pending")])), undefined, "rows are matched by key, not position");
assert.equal(checkStep(approved, before, after([e(1, 10, "Approved"), e(2, 45, "Approved"), e(3, 7, "Rejected")])), undefined, "approving a pending one freezes it from now on");
assert.equal(checkStep(approved, before, after([e(1, 10, "Pending"), e(2, 50, "Approved"), e(3, 7, "Rejected")])), "expense id 2 (status was Approved): amount 45 → 50");
assert.equal(checkStep(approved, before, after([e(1, 10, "Pending"), e(3, 7, "Rejected")])), "expense id 2 (status was Approved) was removed", "removing a frozen row changes it");
assert.equal(checkStep(rejected, before, after([e(1, 11, "Pending"), e(2, 45, "Approved"), e(3, 7, "Rejected")])), undefined, "a pending row may change");
assert.equal(checkStep(kept, before, after([e(1, 10, "Pending"), e(2, 45, "Approved")])), "expense id 3 was removed");
assert.equal(checkStep(kept, before, after([...before.expenses, e(4, 1, "Pending")])), undefined, "adding is not removing");
assert.equal(checkStep(table, before, after([e(1, 10, "Rejected"), e(2, 45, "Approved"), e(3, 7, "Rejected")])), undefined, "a declared transition");
assert.equal(checkStep(table, before, after([e(1, 10, "Pending"), e(2, 45, "Pending"), e(3, 7, "Rejected")])), "expense id 2's status: Approved → Pending is not a declared change");
assert.equal(checkStep(nextId, before, after(before.expenses, 3)), "@nextId went down: 4 → 3");
assert.equal(checkStep(nextId, before, after(before.expenses, 9)), undefined);
assert.deepEqual([...coveredKeys(plan.named, before)].sort(), ["2", "3"], "the rows random sessions should try to touch");

// The watch: stuttering passes every rule without running it; the general form comes from the stage.
const never = [{ line: plan.general[0].line, holds: () => false }];
const w = watch(plan, never);
assert.equal(w.step(before, JSON.parse(JSON.stringify(before)), {}), undefined, "a step that changes nothing passes every rule (stuttering)");
assert.equal(w.step(before, after([...before.expenses, e(4, 1, "Pending")], 5), {})?.line, plan.general[0].line, "a general rule runs on a step that changes something");
const probe = [{ line: plan.general[0].line, holds: () => true }];
assert.equal(watch(plan, never, probe).step(before, after([...before.expenses, e(4, 1, "Pending")], 5), {})?.ambiguous, true, "two readings that disagree: the sentence is ambiguous");
w.step(before, after([e(1, 10, "Approved"), e(2, 45, "Approved"), e(3, 7, "Rejected")]), {});
assert.deepEqual(transitionCoverage(plan.named, Object.fromEntries([...w.made].map(([l, xs]) => [l, [...xs]]))), [{ line: table.line, text: table.text, missing: ["Pending → Rejected"] }], "the declared pairs no step made");

// The stage's helpers: rows by key; a list of plain values as a multiset.
const dir = mkdtempSync(join(tmpdir(), "changes-"));
try {
  writeFileSync(join(dir, "helpers.ts"), CHANGE_HELPERS);
  const h = await import(pathToFileURL(join(dir, "helpers.ts")).href);
  assert.deepEqual(h.added([{ id: 1 }, { id: 2 }], [{ id: 2 }, { id: 3 }], "id"), [{ id: 3 }]);
  assert.deepEqual(h.removed([{ id: 1 }, { id: 2 }], [{ id: 2 }, { id: 3 }], "id"), [{ id: 1 }]);
  assert.deepEqual(h.added(["a", "b", "a"], ["a", "a", "a", "b", "c"]), ["a", "c"], "a multiset difference: one more a, and c");
  assert.deepEqual(h.removed(["a", "b", "a"], ["b"]), ["a", "a"]);
} finally {
  rmSync(dir, { recursive: true, force: true });
}

// ---------------------------------------------------------------- the screen driver
// A stand-in build: its `bump` changes an approved expense (the planted bug), `flow` moves one
// ticket-like status per tick, and a restart starts it empty.
const screenDir = mkdtempSync(join(tmpdir(), "changes-screen-"));
try {
  const screenSpec = `app Flow {
  "x"
}

choice Status: Pending | Approved | Rejected
choice Phase: Open | Solved | Closed

record Expense {
  id: Int
  amount: Decimal
  status: Status
}

state {
  expenses: List Expense = []
  phase: Phase = Open
}

screen {
  button bump "Bump"
  button fine "Fine"
}

always {
  - an @Expense whose @status was @Approved never changes
  - @phase only changes from @Open to @Solved, from @Solved to @Closed
}

example "x" {
  click fine
}
`;
  const parsed = parse(screenSpec);
  assert.ok(parsed.app, parsed.diagnostics.map((d) => d.message).join("; "));
  writeFileSync(join(screenDir, "changes.json"), JSON.stringify(changePlan(parsed.app!)));
  writeFileSync(
    join(screenDir, "test.mjs"),
    `export function start() {
  let m = { expenses: [{ id: 1, amount: 10, status: "Approved" }, { id: 2, amount: 5, status: "Pending" }], phase: "Open" };
  const next = { Open: "Solved", Solved: "Closed", Closed: "Closed" };
  return {
    observe: () => ({ k: "screen", title: "", c: [{ k: "button", n: "bump", label: "Bump", enabled: true }, { k: "button", n: "fine", label: "Fine", enabled: true }] }),
    send: (w) => {
      if (w.on === "click" && w.target === "bump") m = { ...m, expenses: m.expenses.map((e) => ({ ...e, amount: e.amount + 1 })) };
      if (w.on === "click" && w.target === "fine") m = { ...m, expenses: m.expenses.map((e) => (e.status === "Pending" ? { ...e, amount: e.amount + 1 } : e)) };
      if (w.on === "tick") m = { ...m, phase: next[m.phase] };
      if (w.on === "restart") m = { expenses: [], phase: "Open" };
    },
    data: () => JSON.parse(JSON.stringify(m)),
  };
}
`,
  );
  const ex = (name: string, steps: object[]) => ({ kind: "example" as const, example: { name, line: 1, steps: steps as never }, always: [] });
  const [fine, bug, twoTicks, restarted] = (await runJobs(screenDir, "ts", [
    ex("a pending one may change", [{ do: "click", target: "fine", line: 40 }]),
    ex("the planted bug", [{ do: "click", target: "fine", line: 40 }, { do: "click", target: "bump", line: 41 }]),
    // Two events in one step: Open → Solved → Closed is two declared changes; per settled step it would be Open → Closed.
    ex("a chain of declared changes", [{ do: "tick", times: 2, line: 42 }]),
    ex("a restart is not a step", [{ do: "restart", line: 43 }, { do: "click", target: "fine", line: 44 }]),
  ])) as { pass: boolean; failure?: { line: number; message: string } }[];
  assert.ok(fine.pass, `a change the rules allow passes (${fine.failure?.message})`);
  assert.ok(!bug.pass && bug.failure!.line === 41, "the planted bug fails the step that made it");
  const frozenLine = screenSpec.split("\n").findIndex((l) => l.includes("was @Approved never")) + 1;
  assert.match(bug.failure!.message, new RegExp(`the rule \`always\` \\(line ${frozenLine}\\) is broken: "an @Expense whose @status was @Approved never changes" does not hold: expense id 1 \\(status was Approved\\): amount 10 → 11 \\(at the event click bump\\)`), bug.failure!.message);
  assert.ok(twoTicks.pass, `checked per event, a legal chain passes (${twoTicks.failure?.message})`);
  assert.ok(restarted.pass, `a restart that empties the list is not a removal (${restarted.failure?.message})`);
  // Random sessions: the fuzzer reaches the frozen row and pokes it; the violation names the rule.
  const [explored] = (await runJobs(screenDir, "ts", [{ kind: "explore", prefix: [], length: 20, seed: 3, pools: {}, pool: ["x"], ticks: [], always: [] }])) as { violation?: { line: number; message: string } }[];
  assert.equal(explored.violation?.line, frozenLine, "a random session finds the planted bug");
} finally {
  rmSync(screenDir, { recursive: true, force: true });
}

// ---------------------------------------------------------------- the api driver
// A stand-in ledger service: `deposit` adds a deposit and its amount to the balance; the daily fee
// (recurring work) takes 1 off the balance without a withdrawal: the general rule must catch it,
// at the run of recurring work. The general check is a stand-in for the stage's.
const apiDir = mkdtempSync(join(tmpdir(), "changes-api-"));
try {
  const ledger = `app Ledger {
  "x"
}

profile api

record Deposit {
  id: Int
  amount: Decimal
}

state {
  stored balance: Decimal = 0
  stored deposits: List Deposit = []
}

endpoint deposit POST "/deposits" {
  body amount: Decimal
  answers 201
  - add a @Deposit to @deposits with @id = the number of @deposits plus 1, @amount = the given @amount
  - increase @balance by the given @amount
  answer 201
}

every 1d {
  - decrease @balance by 1
}

always {
  - @balance is @balance before plus the sum of @amount over the new @deposits
  - a @Deposit's @amount never changes
}

example "a deposit" {
  call deposit with amount = 5
  see deposit.status = 201
}
`;
  const parsed = parse(ledger);
  assert.ok(parsed.app, parsed.diagnostics.filter((d) => d.level === "error").map((d) => `${d.line} ${d.code} ${d.message}`).join("; "));
  const p = changePlan(parsed.app!);
  assert.deepEqual(p.named.map((c) => c.form), ["frozen"]);
  const generalLine = ledger.split("\n").findIndex((l) => l.includes("@balance before")) + 1;
  assert.deepEqual(p.general.map((g) => g.line), [generalLine]);
  writeFileSync(join(apiDir, "changes.json"), JSON.stringify(p));
  writeFileSync(join(apiDir, "invariants.json"), "[]");
  writeFileSync(join(apiDir, "invariants.mjs"), `export const invariants = [];\nexport const changes = [{ line: ${generalLine}, holds: (b, a) => { const had = new Set(b.deposits.map((d) => d.id)); return a.balance === b.balance + a.deposits.filter((d) => !had.has(d.id)).reduce((s, d) => s + d.amount, 0); } }];\n`);
  writeFileSync(join(apiDir, "endpoints.json"), JSON.stringify([{ name: "deposit", method: "POST", path: "/deposits", params: [{ in: "body", name: "amount" }] }]));
  writeFileSync(join(apiDir, "clock.json"), JSON.stringify({ start: "2026-01-05T09:00", jobs: [{ name: "every1d", every: 86400000 }] }));
  writeFileSync(
    join(apiDir, "test.mjs"),
    `export function start() {
  let m = { balance: 0, deposits: [] };
  return {
    send: (method, path, query, body) => {
      m = { balance: m.balance + body.amount, deposits: [...m.deposits, { id: m.deposits.length + 1, amount: body.amount }] };
      return { status: 201, body: {}, headers: {} };
    },
    runJob: () => ((m = { ...m, balance: m.balance - 1 }), []),
    data: () => JSON.parse(JSON.stringify(m)),
    restart: (saved) => { m = saved; },
  };
}
`,
  );
  const call = (amount: number, l: number) => ({ do: "call", endpoint: "deposit", args: [{ name: "amount", value: { k: "number", v: amount } }], line: l });
  const [ok, fee] = (await runApiJobs(apiDir, [
    { kind: "api-example", example: { name: "deposits", line: 1, steps: [call(5, 50), call(7, 51)] as never } },
    { kind: "api-example", example: { name: "the fee", line: 1, steps: [call(5, 50), { do: "tick", times: 0, ms: 86400000, line: 52 }] as never } },
  ])) as { pass: boolean; failure?: { line: number; message: string } }[];
  assert.ok(ok.pass, `each request is a step, and deposits keep the rule (${ok.failure?.message})`);
  assert.ok(!fee.pass && fee.failure!.line === 52, "the fee breaks the rule at the wait that ran it");
  assert.match(fee.failure!.message, new RegExp(`\`always\` \\(line ${generalLine}\\) is broken: "@balance is @balance before plus the sum of @amount over the new @deposits" does not hold: it does not hold across this step \\(at every 1d\\)`), fee.failure!.message);
} finally {
  rmSync(apiDir, { recursive: true, force: true });
}

// `the @score never goes down` is the named form the harness checks (the article is English, not a new subject).
assert.deepEqual(parseChange("the @score never goes down"), { named: { form: "order", dir: "down", subject: { k: "state", name: "score", hops: [] } }, subjectText: "the @score" });

console.log("ok changes: named forms by key (removal, stuttering, transitions), the stage's helpers, per-event checks in the screen and api drivers, a planted bug caught");
