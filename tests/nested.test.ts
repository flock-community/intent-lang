// Lists inside list rows (v68), without an LLM: the harness's own part. The generated helpers find an
// inner row by its outer row's key and its own (both targets); the test driver addresses a row inside
// a row by one `on row` per level, sends the path of keys, checks inner keys after every step, and its
// random sessions act on inner rows; a planted bug (the right item removed from the wrong task) is
// caught by comparing random sessions, as converge compares builds. The app module here is a stand-in
// written for the test (a real build's is the model's), compiled with the TypeScript target's toolchain.
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { load, sourceMap } from "../compiler/load.ts";
import { dataField, genElmSpec, scaffold, tsDomain } from "../compiler/gen.ts";
import { tsTarget } from "../compiler/targets/ts.ts";
import { keyedLists } from "../compiler/homes.ts";
import { duplicateKey } from "../compiler/keys.ts";
import { canonical, runJobs, type Action, type ExploreResult, type ExampleResult, type TraceResult } from "../compiler/exec.ts";
import { actionText, exploreJobs } from "../compiler/fuzz.ts";
import { parseSyntax } from "../compiler/parse.ts";
import { stepText } from "../compiler/print.ts";
import { changePlan, checkStep } from "../compiler/changes.ts";

const { app } = load("apps/32-checklists.intent");
assert.ok(app, "apps/32-checklists.intent loads");

// ---------------------------------------------------------------- the helpers, TypeScript
const hdir = mkdtempSync(join(tmpdir(), "nested-helpers-"));
try {
  writeFileSync(join(hdir, "domain.ts"), tsDomain(app!));
  const d = await import(pathToFileURL(join(hdir, "domain.ts")).href);
  const tasks = [
    { id: 1, title: "A", items: [{ id: 1, label: "x", done: false }, { id: 2, label: "y", done: false }], newItem: "" },
    { id: 2, title: "B", items: [{ id: 1, label: "z", done: false }], newItem: "" },
  ];
  const done = d.updateTaskItems(tasks, "2", "1", (i: { done: boolean }) => ({ ...i, done: true }));
  assert.equal(done[1].items[0].done, true, "the item with key 1 of the task with key 2 changes");
  assert.equal(done[0].items[0].done, false, "the item with the same key in another task does not");
  assert.equal(tasks[1].items[0].done, false, "the rows are not changed in place");
  const gone = d.removeFromTaskItems(tasks, "1", "2");
  assert.deepEqual(gone[0].items.map((i: { id: number }) => i.id), [1], "one item is removed from one task");
  assert.equal(gone[1].items.length, 1, "the other task keeps its items");
  assert.equal(d.taskRowKey(tasks[1], 1), "2", "a row's key is its record's key, as text");
  assert.deepEqual(d.tasksInitial[0].items, [{ id: 1, label: "Milk", done: false }, { id: 2, label: "Eggs", done: true }], "seeded inner rows, with their defaults");
} finally {
  rmSync(hdir, { recursive: true, force: true });
}

// Elm: the same helpers, the message with both keys, and the wire's path of keys.
const elm = genElmSpec(app!);
assert.match(elm, /updateTaskItems : String -> String -> \(Item -> Item\) -> List Task -> List Task/, "Elm: one item of one task changed");
assert.match(elm, /removeFromTaskItems : String -> String -> List Task -> List Task/);
assert.match(elm, /TasksItemsRemoveItemClicked String String/, "Elm: an inner row's event carries the outer key and its own");
assert.match(elm, /\( "click", "tasks\.items\.removeItem" \) ->\n\s+Just \(TasksItemsRemoveItemClicked \(Maybe\.withDefault "" \(List\.head w\.keys\)\) w\.key\)/, "Elm: the outer key is the first of the wire's keys");
assert.match(elm, /type alias TasksItemsRow =/, "Elm: the inner row type is named after both lists");

// ---------------------------------------------------------------- source map, printer
const map = sourceMap(app!);
assert.ok(map["tasks[].items[].removeItem"], "the source map keys an inner row's element by its list path");
assert.equal(map["tasks[].items[].removeItem"].kind, "button");
const nestedStep = app!.examples.flatMap((e) => e.steps).find((s) => "at" in s && s.at?.parent)!;
assert.equal(stepText(nestedStep).includes(" on row 1 of tasks"), true, `a nested step prints one \`on row\` per level, innermost first: ${stepText(nestedStep)}`);
const back = parseSyntax(`app X {\n  "x"\n}\n\nexample "e" {\n  ${stepText(nestedStep)}\n}\n`).app.examples[0].steps[0];
assert.deepEqual(JSON.parse(JSON.stringify(back, (k, v) => (k === "line" ? undefined : v))), JSON.parse(JSON.stringify(nestedStep, (k, v) => (k === "line" ? undefined : v))), "a printed nested step reads back the same");

// ---------------------------------------------------------------- inner keys stay unique
const keys = keyedLists(app!).map((h) => ({ field: dataField(h.list), list: h.list, key: h.key, record: h.record, line: 1, ...(h.inner ? { inner: h.inner } : {}) }));
assert.deepEqual(keys[0].inner, { field: "items", record: "Item", key: "id" }, "keys.json: the inner list of each task");
assert.equal(duplicateKey(keys, { tasks: [{ id: 1, items: [{ id: 1 }, { id: 2 }] }, { id: 2, items: [{ id: 1 }] }] }), undefined, "an inner key may repeat across tasks");
assert.match(duplicateKey(keys, { tasks: [{ id: 1, items: [{ id: 1 }, { id: 1 }] }] })?.message ?? "", /has two items with id 1/, "but not within one task");
assert.match(duplicateKey(keys, { tasks: [{ id: 1, items: [] }, { id: 1, items: [] }] })?.message ?? "", /two rows of `tasks` have id 1/, "and the outer key stays unique");

// ---------------------------------------------------------------- change rules over inner rows
const { app: orders } = load("apps/33-order-lines.intent");
assert.ok(orders, "apps/33-order-lines.intent loads");
const price = changePlan(orders!).named.find((c) => c.form === "frozen")!;
assert.deepEqual((price.subject as { inner?: unknown }).inner, { field: "lines", outerKey: "id", outer: "Order" }, "a rule about a Line reads the lines inside the orders");
const before = { orders: [{ id: 1, lines: [{ id: 1, price: 3.5 }] }, { id: 2, lines: [{ id: 1, price: 6.25 }] }] };
assert.equal(checkStep(price, before, { orders: [{ id: 1, lines: [{ id: 1, price: 3.5 }] }, { id: 2, lines: [{ id: 1, price: 6.25 }, { id: 2, price: 1 }] }] }), undefined, "a new line is not a change");
assert.match(checkStep(price, before, { orders: [{ id: 1, lines: [{ id: 1, price: 3.5 }] }, { id: 2, lines: [{ id: 1, price: 7 }] }] }) ?? "", /line id 1 of order id 2's price: 6.25 → 7/, "matched by the path of keys: order 2's line 1");

// ---------------------------------------------------------------- the driver, on a stand-in build
const APP = (bug: boolean) => `import type { Data, Msg, Screen, Stored, Task } from "./spec.ts";
import { removeFromTaskItems, taskRowKey, tasksInitial, itemRowKey, updateTaskItems } from "./spec.ts";

export type Model = { tasks: Task[]; toast: string };

export function init(): Model {
  return { tasks: tasksInitial, toast: "" };
}

export function update(msg: Msg, m: Model): Model {
  switch (msg.tag) {
    case "TasksItemsDoneToggled": {
      const tasks = updateTaskItems(m.tasks, msg.outerKey, msg.key, (i) => ({ ...i, done: !i.done }));
      const task = tasks.find((t, i) => taskRowKey(t, i) === msg.outerKey);
      return { tasks, toast: task && task.items.every((i) => i.done) ? task.title + " is complete" : "" };
    }
    case "TasksItemsRemoveItemClicked":
      return { ...m, tasks: removeFromTaskItems(m.tasks, ${bug ? "taskRowKey(m.tasks[0], 0)" : "msg.outerKey"}, msg.key) };
    case "TasksNewItemTyped":
      return { ...m, tasks: m.tasks.map((t, i) => (taskRowKey(t, i) === msg.key ? { ...t, newItem: msg.text } : t)) };
    case "TasksAddItemClicked":
      return {
        ...m,
        tasks: m.tasks.map((t, i) => {
          if (taskRowKey(t, i) !== msg.key || !t.newItem.trim()) return t;
          const id = Math.max(0, ...t.items.map((x) => x.id)) + 1;
          return { ...t, items: [...t.items, { id, label: t.newItem.trim(), done: false }], newItem: "" };
        }),
      };
  }
}

export function view(m: Model): Screen {
  return {
    tasks: m.tasks.map((t, i) => ({
      key: taskRowKey(t, i),
      title: t.title,
      items: t.items.map((x, j) => ({ key: itemRowKey(x, j), done: x.done, label: x.label, removeItem: { enabled: true } })),
      newItem: t.newItem,
      addItem: { enabled: true },
      left: t.items.filter((x) => !x.done).length + " left",
    })),
    toast: m.toast.trim() ? m.toast : null,
  };
}

export const data = (m: Model): Data => ({ tasks: m.tasks, toast: m.toast });
export const restore = (saved: Stored, m: Model): Model => ({ ...m, tasks: saved.tasks });
`;

const buildOf = async (bug: boolean) => {
  const dir = mkdtempSync(join(tmpdir(), `nested-${bug ? "bug" : "ok"}-`));
  scaffold(app!, "ts", dir);
  writeFileSync(join(dir, "app.ts"), APP(bug));
  // What a build writes for the driver (compiler/build.ts): the keys it checks, the stored fields.
  writeFileSync(join(dir, "keys.json"), JSON.stringify(keys));
  writeFileSync(join(dir, "stored.json"), JSON.stringify(app!.state.filter((f) => f.stored).map((f) => ({ field: dataField(f.name), line: f.line }))));
  const problems = await tsTarget.compile(dir);
  assert.equal(problems, "", `the stand-in build compiles: ${problems}`);
  return dir;
};
const good = await buildOf(false);
const bad = await buildOf(true);
try {
  // Every example passes on the right build: rows addressed per level, by position and by what they show.
  const ex = (await runJobs(good, "ts", app!.examples.map((example) => ({ kind: "example" as const, example, always: app!.always })))) as ExampleResult[];
  for (const r of ex) assert.ok(r.pass, `example "${r.name}": ${r.failure?.message}\n${r.failure?.screen}`);
  // The wire carries the path of keys: removing item 1 of task 2 leaves task 1's item 1.
  const click = (target: string, row: number, outer: number): Action => ({ on: "click", target, list: "items", row, outer: { list: "tasks", row: outer } });
  const [t] = (await runJobs(good, "ts", [{ kind: "trace", actions: [{ on: "input", target: "newItem", text: "Z", list: "tasks", row: 2 }, { on: "click", target: "addItem", list: "tasks", row: 2 }, click("removeItem", 1, 2)] }])) as TraceResult[];
  const last = JSON.parse(t.steps[t.steps.length - 1]);
  const tasks = last.c.find((n: any) => n.n === "tasks");
  assert.equal(tasks.rows[0].c.find((n: any) => n.n === "items").rows.length, 2, "task 1 keeps both items");
  assert.equal(tasks.rows[1].c.find((n: any) => n.n === "items").rows.length, 0, "task 2's item is removed");
  assert.equal(actionText(click("removeItem", 1, 2)), "click removeItem on row 1 of items on row 2 of tasks", "an action reads as a paste-ready step, innermost row first");
  // The planted bug: the examples catch it (one removes from the second task) …
  const exBad = (await runJobs(bad, "ts", app!.examples.map((example) => ({ kind: "example" as const, example, always: app!.always })))) as ExampleResult[];
  assert.ok(exBad.some((r) => !r.pass), "an example catches the item removed from the wrong task");
  // … and so do random sessions, without the examples: explore on the right build, replay on both.
  const explored = (await runJobs(good, "ts", exploreJobs({ ...app!, examples: [] }, 30, 30, 3))) as ExploreResult[];
  const innerActions = explored.flatMap((e) => e.actions).filter((a) => a.outer);
  assert.ok(innerActions.length > 0, "random sessions act on rows inside rows");
  const traces = explored.map((e) => e.actions);
  const run = async (dir: string) => ((await runJobs(dir, "ts", traces.map((actions) => ({ kind: "trace" as const, actions })))) as TraceResult[]).map((r) => r.steps.join("\n"));
  const [a, b] = [await run(good), await run(bad)];
  assert.ok(a.some((s, i) => s !== b[i]), "random sessions tell the build that removes from the wrong task apart");
  // A step that makes two items of one task share a key fails, with that step.
  const dup = await buildOf(false);
  writeFileSync(join(dup, "app.ts"), APP(false).replace("const id = Math.max(0, ...t.items.map((x) => x.id)) + 1;", "const id = 1;"));
  assert.equal(await tsTarget.compile(dup), "");
  const add = [{ on: "input", target: "newItem", text: "Bread", list: "tasks", row: 1 }, { on: "click", target: "addItem", list: "tasks", row: 1 }] as Action[];
  const [d] = (await runJobs(dup, "ts", [{ kind: "trace", actions: add }])) as TraceResult[];
  assert.match(d.violation?.message ?? "", /has two items with id 1/, `an inner key used twice in one task is caught (${d.violation?.message})`);
  rmSync(dup, { recursive: true, force: true });
  assert.ok(canonical(last).length > 0);
} finally {
  rmSync(good, { recursive: true, force: true });
  rmSync(bad, { recursive: true, force: true });
}
console.log("ok nested: helpers for both targets, the path of keys on the wire, inner keys checked, change rules on inner rows, random sessions on inner rows, the planted bug caught");
