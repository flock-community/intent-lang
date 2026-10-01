// The terminal host (runtime/ts/terminal.ts): the screen tree as text, keys as the same events.
import assert from "node:assert/strict";
import { draw, keyToWire, runTerminal } from "../runtime/ts/terminal.ts";
import type { Node, Wire } from "../runtime/ts/ui.ts";

const screen: Node = {
  k: "screen", title: "Tickets", c: [
    { k: "list", n: "rows", rows: [{ key: "7", c: [{ k: "text", n: "subject", v: "Server down" }, { k: "text", n: "priority", v: "Urgent", as: "badge", tone: "danger" }, { k: "button", n: "close", label: "Close", enabled: true }] }] },
    { k: "field", n: "reason", label: "Reason", v: "Fix" },
    { k: "select", n: "level", label: "Level", options: ["Low", "High"], v: "Low" },
    { k: "checkbox", n: "done", label: "Done", checked: false },
    { k: "section", n: "ask", label: "", as: "dialog", c: [{ k: "text", n: "q", v: "Sure?", as: "title" }, { k: "button", n: "ok", label: "OK", enabled: false, as: "primary" }] },
  ],
};
const { lines, controls } = draw(screen, 0);
const text = lines.join("\n");
assert.match(text, /▶ <Close>/, "the focused control is marked");
assert.match(text, /! \[Urgent\]/, "a badge with its tone");
assert.match(text, /Reason: \[Fix\]/);
assert.match(text, /Level: \(Low\)  High /);
assert.match(text, /│ +SURE\?/, "a dialog is boxed, its title in capitals");
assert.match(text, /\(OK\) \*/, "a disabled primary button");
assert.deepEqual(controls.map((c) => `${c.kind} ${c.target} ${c.key}`), ["button rows.close 7", "field reason ", "select level ", "checkbox done ", "button ok "]);
const w = (key: string, i: number) => keyToWire(key, controls[i], screen).wire;
assert.deepEqual(w("\r", 0), { on: "click", target: "rows.close", key: "7" }, "Enter clicks, with the row's key");
assert.deepEqual(w("x", 1), { on: "input", target: "reason", key: "", text: "Fixx" }, "typing edits the field");
assert.deepEqual(w("\x7f", 1), { on: "input", target: "reason", key: "", text: "Fi" }, "Backspace too");
assert.deepEqual(w("\x1b[C", 2), { on: "choose", target: "level", key: "", value: "High" }, "→ chooses the next option");
assert.deepEqual(w(" ", 3), { on: "toggle", target: "done", key: "" });
assert.equal(w("\r", 4), undefined, "a disabled button does nothing");
assert.deepEqual(w("\x1b", 0), { on: "dismiss", target: "ask", key: "" }, "Escape dismisses the dialog");
assert.deepEqual(keyToWire("\t", controls[0], screen), { move: 1 });

// A session: keys in, the app's events out, drawn after each.
const sent: Wire[] = [];
const calm: Node = { ...screen, c: (screen as { c: Node[] }).c.filter((n) => n.k !== "section") } as Node;
const fake = { start: async () => ({ observe: () => calm, send: (x: Wire) => sent.push(x), calls: () => [] }) };
const keys = (async function* () { yield "\t"; yield "\t"; yield "\x1b[C"; yield "\x03"; })();
let out = "";
await runTerminal(fake, {}, { write: (s) => (out += s), keys });
assert.deepEqual(sent, [{ on: "choose", target: "level", key: "", value: "High" }], "Tab, Tab, → on the select");
assert.match(out, /Ctrl\+C quits/);
// A dialog takes the focus, and Tab stays inside it.
const sent2: Wire[] = [];
const modal = { start: async () => ({ observe: () => screen, send: (x: Wire) => sent2.push(x), calls: () => [] }) };
await runTerminal(modal, {}, { write: () => {}, keys: (async function* () { yield "\t"; yield "\t"; yield "\x1b"; yield "\x03"; })() });
assert.deepEqual(sent2, [{ on: "dismiss", target: "ask", key: "" }], "Tab never leaves the dialog (its one control is disabled), Escape dismisses it");
console.log("ok terminal: the screen tree as text (focus, tones, dialogs), keys as the same events, a session");
