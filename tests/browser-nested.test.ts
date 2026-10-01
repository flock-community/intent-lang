// The styled driver on rows inside rows (v68), in a real browser, without an LLM: a page laid out by
// the DOM contract (an element belongs to its nearest data-row; inner rows inside their outer row) is
// read back as the screen says, an action walks the path of rows (outer list → row → inner list →
// row, by position or by what a row shows), and rects are keyed by that path. A page that puts the
// inner rows outside their outer row does not show what the screen says.
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { build } from "esbuild";
import { load } from "../compiler/load.ts";
import { closeBrowser, fidelityDiff, openStyled } from "../compiler/browser.ts";

const { app } = load("apps/32-checklists.intent");
assert.ok(app, "apps/32-checklists.intent loads");

const item = (key: string, label: string, done: boolean) => ({ key, c: [{ k: "checkbox", n: "done", label: "", checked: done }, { k: "text", n: "label", v: label }, { k: "button", n: "removeItem", label: "Remove", enabled: true }] });
const task = (key: string, title: string, items: object[], left: string) => ({ key, c: [{ k: "text", n: "title", v: title }, { k: "list", n: "items", rows: items }, { k: "field", n: "newItem", label: "New item", v: "" }, { k: "button", n: "addItem", label: "Add", enabled: true }, { k: "text", n: "left", v: left }] });
const screen = { k: "screen", title: "Checklists", c: [{ k: "heading", v: "Checklists" }, { k: "list", n: "tasks", rows: [task("1", "Groceries", [item("1", "Milk", false), item("2", "Eggs", true)], "1 left"), task("2", "Taxes", [], "0 left")] }] };

const li = (t: string, k: string, label: string, done: boolean) => `<li data-row="${k}"><input type="checkbox" data-el="done"${done ? " checked" : ""}><span data-el="label">${label}</span><button data-el="removeItem" onclick="hit('${t}/${k}')">Remove</button></li>`;
const outer = (t: string, title: string, inner: string, left: string, innerOutside = false) =>
  `<div data-row="${t}"><span data-el="title">${title}</span>${innerOutside ? "" : `<ul data-el="items">${inner}</ul>`}<label>New item<input data-el="newItem" value=""></label><button data-el="addItem" onclick="hit('${t}/add')">Add</button><span data-el="left">${left}</span></div>${innerOutside ? `<ul data-el="items">${inner}</ul>` : ""}`;
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
  // A row's data-row is its key (the one its events carry): swapped keys are refused.
  const swapped = await openStyled(site(page(false).replace('data-row="1"><span data-el="title">Groceries', 'data-row="9"><span data-el="title">Groceries')), app!);
  const w = await swapped.observe();
  assert.match(fidelityDiff(w.dom, w.screen).join("\n"), /tasks\[1\]: data-row is "9", the row's key is "1"/, "a row whose data-row is not its key is refused");
  await swapped.close();
  // The harness's own (unstyled) renderer keeps the same DOM contract: data-el on every element,
  // data-row with the row's key, data-option on options; the styled driver reads it back as the screen.
  const plain = site("");
  await build({
    stdin: { contents: `import { mount } from ${JSON.stringify(join(process.cwd(), "runtime/ts/ui.ts"))};\nconst screen = (window as any).__screen;\nmount(document.getElementById("app")!, { init: () => 0, step: (_w, m) => m, render: () => screen });`, loader: "ts", resolveDir: process.cwd() },
    bundle: true, format: "iife", outfile: join(plain, "app.js"), logLevel: "error",
  });
  writeFileSync(join(plain, "index.html"), `<!doctype html><html><body><div id="app"></div><script>window.__screen = ${JSON.stringify(screen)}; window.__n = 1;</script><script src="app.js"></script></body></html>`);
  const p = await openStyled(plain, app!);
  const o = await p.observe();
  assert.deepEqual(o.errors, [], "the plain renderer meets the DOM contract");
  assert.deepEqual(fidelityDiff(o.dom, o.screen), [], "the plain renderer shows the screen, row keys included");
  await p.close();
  // Escape inside a section shown as dialog sends `dismiss` for it (1.1), and nothing outside one.
  const esc = site("");
  await build({
    stdin: { contents: `import { mount } from ${JSON.stringify(join(process.cwd(), "runtime/ts/ui.ts"))};\n(window as any).__w = [];\nmount(document.getElementById("app")!, { init: () => 0, step: (w, m) => ((window as any).__w.push(w), m), render: () => ({ k: "screen", title: "T", c: [{ k: "button", n: "outside", label: "Out", enabled: true }, { k: "section", n: "ask", label: "", as: "dialog", c: [{ k: "button", n: "ok", label: "OK", enabled: true }] }] }) as any });`, loader: "ts", resolveDir: process.cwd() },
    bundle: true, format: "iife", outfile: join(esc, "app.js"), logLevel: "error",
  });
  writeFileSync(join(esc, "index.html"), `<!doctype html><html><body><div id="app"></div><script src="app.js"></script></body></html>`);
  const { getBrowser } = await import("../compiler/browser.ts");
  const tab = await (await getBrowser()).newPage();
  await tab.goto(`file://${join(esc, "index.html")}`);
  await tab.focus('[data-el="outside"]');
  await tab.keyboard.press("Escape");
  await tab.focus('[data-el="ok"]');
  await tab.keyboard.press("Escape");
  assert.deepEqual(await tab.evaluate(() => (window as any).__w), [{ on: "dismiss", target: "ask", key: "" }], "Escape in the dialog dismisses it; outside it does nothing");
  assert.equal(await tab.getAttribute('[data-el="ask"]', "data-as"), "dialog");
  await tab.close();
  // Focus (runtime/ts/focus.ts): a dialog is a labelled modal dialog; when it opens focus moves into
  // it, Tab stays inside it, and when it closes focus goes back to the button that opened it.
  const fdir = site("");
  await build({
    stdin: { contents: `import { mount } from ${JSON.stringify(join(process.cwd(), "runtime/ts/ui.ts"))};\nimport { watchFocus } from ${JSON.stringify(join(process.cwd(), "runtime/ts/focus.ts"))};\nmount(document.getElementById("app")!, { init: () => 0, step: (w, m) => (w.on === "click" && w.target === "open" ? 1 : w.on === "dismiss" || (w.on === "click" && w.target === "cancel") ? 0 : m), render: (m) => ({ k: "screen", title: "T", c: [{ k: "button", n: "open", label: "Open", enabled: true }, ...(m ? [{ k: "section", n: "ask", label: "", as: "dialog", c: [{ k: "text", n: "q", v: "Sure?", as: "title" }, { k: "field", n: "why", label: "Why", v: "" }, { k: "button", n: "ok", label: "OK", enabled: true }, { k: "button", n: "cancel", label: "Cancel", enabled: true }] }] : [])] }) as any });\nwatchFocus(document.body);`, loader: "ts", resolveDir: process.cwd() },
    bundle: true, format: "iife", outfile: join(fdir, "app.js"), logLevel: "error",
  });
  writeFileSync(join(fdir, "index.html"), `<!doctype html><html><body><div id="app"></div><script src="app.js"></script></body></html>`);
  const ft = await (await getBrowser()).newPage();
  await ft.goto(`file://${join(fdir, "index.html")}`);
  const focused = () => ft.evaluate(() => (document.activeElement as HTMLElement | null)?.closest("[data-el]")?.getAttribute("data-el") ?? null);
  await ft.click('[data-el="open"]');
  await ft.waitForFunction(() => document.activeElement?.closest("[data-el]")?.getAttribute("data-el") === "why");
  assert.deepEqual(await ft.evaluate(() => { const d = document.querySelector('[data-el="ask"]')!; return [d.getAttribute("role"), d.getAttribute("aria-modal"), document.getElementById(d.getAttribute("aria-labelledby")!)?.textContent]; }), ["dialog", "true", "Sure?"], "a modal dialog, labelled by its title");
  await ft.keyboard.press("Tab");
  await ft.keyboard.press("Tab");
  assert.equal(await focused(), "cancel");
  await ft.keyboard.press("Tab");
  assert.equal(await focused(), "why", "Tab goes round inside the dialog");
  await ft.keyboard.press("Shift+Tab");
  assert.equal(await focused(), "cancel", "and Shift+Tab back");
  await ft.keyboard.press("Escape");
  await ft.waitForFunction(() => !document.querySelector('[data-el="ask"]'));
  await ft.waitForFunction(() => document.activeElement?.getAttribute("data-el") === "open");
  assert.equal(await focused(), "open", "focus goes back to what opened it");
  await ft.close();
} finally {
  await closeBrowser();
  for (const d of dirs) rmSync(d, { recursive: true, force: true });
}
console.log("ok browser-nested: rows inside rows read by the nearest data-row, acted on by the path of rows, rects keyed by it, inner rows outside their row refused, data-row is the row's key; the plain renderer meets the same contract; Escape dismisses a dialog; focus moves into a dialog, stays there and goes back");
