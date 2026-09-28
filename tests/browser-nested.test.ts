// The styled driver on rows inside rows (v68), in a real browser, without an LLM: a page laid out by
// the DOM contract (an element belongs to its nearest data-row; inner rows inside their outer row) is
// read back as the screen says, an action walks the path of rows (outer list → row → inner list →
// row, by position or by what a row shows), and rects are keyed by that path. A page that puts the
// inner rows outside their outer row does not show what the screen says.
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { load } from "../compiler/load.ts";
import { closeBrowser, fidelityDiff, openStyled } from "../compiler/browser.ts";

const { app } = load("apps/32-checklists.intent");
assert.ok(app, "apps/32-checklists.intent loads");

const item = (key: string, label: string, done: boolean) => ({ key, c: [{ k: "checkbox", n: "done", label: "", checked: done }, { k: "text", n: "label", v: label }, { k: "button", n: "removeItem", label: "Remove", enabled: true }] });
const task = (key: string, title: string, items: object[], left: string) => ({ key, c: [{ k: "text", n: "title", v: title }, { k: "list", n: "items", rows: items }, { k: "field", n: "newItem", label: "New item", v: "" }, { k: "button", n: "addItem", label: "Add", enabled: true }, { k: "text", n: "left", v: left }] });
const screen = { k: "screen", title: "Checklists", c: [{ k: "heading", v: "Checklists" }, { k: "list", n: "tasks", rows: [task("1", "Groceries", [item("1", "Milk", false), item("2", "Eggs", true)], "1 left"), task("2", "Taxes", [], "0 left")] }] };

const li = (t: string, k: string, label: string, done: boolean) => `<li data-row><input type="checkbox" data-el="done"${done ? " checked" : ""}><span data-el="label">${label}</span><button data-el="removeItem" onclick="hit('${t}/${k}')">Remove</button></li>`;
const outer = (t: string, title: string, inner: string, left: string, innerOutside = false) =>
  `<div data-row><span data-el="title">${title}</span>${innerOutside ? "" : `<ul data-el="items">${inner}</ul>`}<label>New item<input data-el="newItem" value=""></label><button data-el="addItem" onclick="hit('${t}/add')">Add</button><span data-el="left">${left}</span></div>${innerOutside ? `<ul data-el="items">${inner}</ul>` : ""}`;
const page = (innerOutside: boolean) => `<!doctype html><html><body><main><h2>Checklists</h2><div data-el="tasks">${outer("1", "Groceries", li("1", "1", "Milk", false) + li("1", "2", "Eggs", true), "1 left", innerOutside)}${outer("2", "Taxes", "", "0 left", innerOutside)}</div></main>
<script>window.__screen = ${JSON.stringify(screen)}; window.__n = 1; window.hit = (k) => { window.__hit = k; window.__n++; };</script></body></html>`;

const dirs: string[] = [];
const site = (html: string) => {
  const dir = mkdtempSync(join(tmpdir(), "browser-nested-"));
  dirs.push(dir);
  writeFileSync(join(dir, "index.html"), html);
  return dir;
};
try {
  const s = await openStyled(site(page(false)), app!);
  const { dom, screen: logic, errors } = await s.observe();
  assert.deepEqual(errors, [], "no contract errors");
  assert.deepEqual(fidelityDiff(dom, logic), [], "the page shows the rows inside rows as the screen says");
  // An action walks the path of rows: by position, and by what each row shows (the outer row by its own elements).
  assert.equal(await s.act({ on: "click", target: "removeItem", list: "items", row: 2, outer: { list: "tasks", row: 1 } }, dom), null);
  assert.equal(await s.page.evaluate(() => (window as any).__hit), "1/2", "item 2 of task 1 is clicked");
  assert.equal(await s.act({ on: "click", target: "removeItem", list: "items", rowWith: "Milk", outer: { list: "tasks", rowWith: "Groceries" } }, dom), null);
  assert.equal(await s.page.evaluate(() => (window as any).__hit), "1/1", "the row showing Milk, in the row showing Groceries");
  assert.equal(await s.act({ on: "click", target: "addItem", list: "tasks", row: 2 }, dom), null);
  assert.equal(await s.page.evaluate(() => (window as any).__hit), "2/add", "an outer row's own element: one level");
  assert.match((await s.act({ on: "click", target: "removeItem", list: "items", row: 1, outer: { list: "tasks", row: 2 } }, dom)) ?? "", /no row 1 in items/, "task 2 has no items");
  const rects = await s.rects();
  assert.ok(rects["tasks[1].items[2].removeItem"], `rects are keyed by the path of rows (${Object.keys(rects).filter((k) => k.includes("items[")).join(", ")})`);
  assert.ok(rects["tasks[2].addItem"] && !rects["tasks[2].items[1].label"], "each row counted among its own list's rows");
  await s.close();
  // Inner rows outside their outer row: the page no longer shows what the screen says.
  const bad = await openStyled(site(page(true)), app!);
  const b = await bad.observe();
  assert.ok(fidelityDiff(b.dom, b.screen).length > 0, "inner rows outside their outer row are refused");
  await bad.close();
} finally {
  await closeBrowser();
  for (const d of dirs) rmSync(d, { recursive: true, force: true });
}
console.log("ok browser-nested: rows inside rows read by the nearest data-row, acted on by the path of rows, rects keyed by it, and inner rows outside their row refused");
