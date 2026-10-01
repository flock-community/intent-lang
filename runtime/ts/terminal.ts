// The terminal host (1.1): any screen build (`screen.mjs`, TypeScript or Elm) in a terminal. The same
// screen tree, drawn as text; the same events, from keys: Tab / Shift+Tab / ↑ / ↓ move between the
// controls, Enter or Space clicks a button or toggles a checkbox, typing edits a field, ← / → choose
// an option, Escape dismisses the open dialog or drawer, Ctrl+C quits. Presentations and tones are
// drawn as text marks (a theme of its own: the terminal's). Calls are listed, not performed (a host
// with a transport performs them).
import type { Node, Wire } from "./ui.ts";

/** A control the user can reach: its wire target, row key, and what it does. */
export interface Control {
  kind: "button" | "checkbox" | "field" | "select";
  target: string;
  key: string;
  keys?: string[];
  node: Node;
  dialog?: string; // the open dialog or drawer it is in (focus stays inside the topmost)
}

const TONE: Record<string, string> = { danger: "!", warning: "~", success: "✓", info: "i", muted: "·", neutral: "" };

/** The screen as lines, and the controls in reading order (the focus moves through them). */
export function draw(screen: Node, focus: number): { lines: string[]; controls: Control[] } {
  const lines: string[] = [];
  const controls: Control[] = [];
  const mark = (n: Node) => (n.tone && TONE[n.tone] ? `${TONE[n.tone]} ` : "");
  let inDialog: string | undefined;
  const walk = (ns: Node[], ind: string, lists: string[], keys: string[]) => {
    for (const n of ns) {
      const target = "n" in n ? [...lists, n.n].join(".") : "";
      const at = (c: Omit<Control, "target" | "key" | "keys">) => {
        controls.push({ ...c, target, key: keys[keys.length - 1] ?? "", ...(keys.length > 1 ? { keys } : {}), ...(inDialog ? { dialog: inDialog } : {}) });
        return controls.length - 1 === focus ? "▶ " : "  ";
      };
      switch (n.k) {
        case "screen": lines.push(`${n.title}`, "=".repeat(Math.max(4, n.title.length))); walk(n.c, ind, lists, keys); break;
        case "heading": lines.push("", `${ind}${n.v}`, `${ind}${"-".repeat(n.v.length)}`); break;
        case "text": lines.push(`${ind}  ${mark(n)}${n.as === "badge" ? `[${n.v}]` : n.as === "title" ? n.v.toUpperCase() : n.v}`); break;
        case "field": { const f = at({ kind: "field", node: n }); lines.push(`${ind}${f}${n.label ? `${n.label}: ` : ""}[${n.v}${f === "▶ " ? "_" : ""}]`); break; }
        case "button": { const f = at({ kind: "button", node: n }); lines.push(`${ind}${f}${mark(n)}${n.enabled ? `<${n.label}>` : `(${n.label})`}${n.as === "primary" ? " *" : n.as === "danger" ? " !" : ""}`); break; }
        case "checkbox": { const f = at({ kind: "checkbox", node: n }); lines.push(`${ind}${f}[${n.checked ? "x" : " "}] ${n.label}`); break; }
        case "progress": lines.push(`${ind}  ${n.label} ${"#".repeat(Math.round(n.v / 10)).padEnd(10, ".")} ${n.v}%`); break;
        case "select": { const f = at({ kind: "select", node: n }); lines.push(`${ind}${f}${n.label ? `${n.label}: ` : ""}${n.options.map((o) => (o === n.v ? `(${o})` : ` ${o} `)).join(" ")}`); break; }
        case "list":
          if (!n.rows.length) lines.push(`${ind}  (none)`);
          for (const r of n.rows) {
            lines.push(`${ind}  •`);
            walk(r.c, ind + "    ", [...lists, n.n], [...keys, r.key]);
          }
          break;
        case "section": {
          const box = n.as === "dialog" || n.as === "drawer";
          if (box) lines.push("", `${ind}┌${"─".repeat(40)}`);
          if (n.label) lines.push(`${ind}${box ? "│ " : ""}${n.label}`);
          const outer = inDialog;
          if (box) inDialog = n.n;
          walk(n.c, box ? `${ind}│ ` : ind, lists, keys);
          inDialog = outer;
          if (box) lines.push(`${ind}└${"─".repeat(40)}`);
          break;
        }
      }
    }
  };
  walk([screen], "", [], []);
  return { lines, controls };
}

/** The open dialogs and drawers, outermost first (Escape dismisses the last). */
function openDialogs(n: Node, out: string[] = []): string[] {
  if (n.k === "section" && (n.as === "dialog" || n.as === "drawer")) out.push(n.n);
  if (n.k === "screen" || n.k === "section") for (const c of n.c) openDialogs(c, out);
  return out;
}

/** What a key does on the focused control: the wire to send, a move of the focus, or nothing. */
export function keyToWire(key: string, c: Control | undefined, screen: Node): { wire?: Wire; move?: number } {
  if (key === "\t" || key === "\x1b[B") return { move: 1 };
  if (key === "\x1b[Z" || key === "\x1b[A") return { move: -1 };
  if (key === "\x1b") {
    const open = openDialogs(screen);
    return open.length ? { wire: { on: "dismiss", target: open[open.length - 1], key: "" } } : {};
  }
  if (!c) return {};
  const at = { target: c.target, key: c.key, ...(c.keys ? { keys: c.keys } : {}) };
  const n = c.node as any;
  if (c.kind === "button" && (key === "\r" || key === " ")) return n.enabled ? { wire: { on: "click", ...at } } : {};
  if (c.kind === "checkbox" && (key === "\r" || key === " ")) return { wire: { on: "toggle", ...at } };
  if (c.kind === "select" && (key === "\x1b[C" || key === "\x1b[D")) {
    const i = n.options.indexOf(n.v);
    const j = Math.max(0, Math.min(n.options.length - 1, (i < 0 ? 0 : i) + (key === "\x1b[C" ? 1 : -1)));
    return n.options[j] !== n.v ? { wire: { on: "choose", ...at, value: n.options[j] } } : {};
  }
  if (c.kind === "field") {
    if (key === "\x7f") return { wire: { on: "input", ...at, text: String(n.v).slice(0, -1) } };
    if (key.length === 1 && key >= " ") return { wire: { on: "input", ...at, text: String(n.v) + key } };
  }
  return {};
}

/** A session in a terminal: drawn after every key; returns when the user quits. */
export async function runTerminal(screenModule: { start: (o: object) => unknown }, opts: object, io: { write: (s: string) => void; keys: AsyncIterable<string> }) {
  const s = (await screenModule.start(opts)) as { observe: () => Node; send: (w: Wire) => unknown; calls: () => unknown[] };
  let focus = 0;
  const pending: unknown[] = [];
  const show = () => {
    const { lines, controls } = draw(s.observe(), focus);
    pending.push(...s.calls());
    io.write(`\x1b[2J\x1b[H${lines.join("\n")}\n\n${pending.length ? `${pending.length} call(s) made (not performed here)\n` : ""}Tab/↑↓ move · Enter/Space act · ←→ choose · Esc closes · Ctrl+C quits\n`);
    return controls;
  };
  let controls = show();
  // A dialog's focus, as in the browser (runtime/ts/focus.ts): in when it opens, kept inside, back when it closes.
  let open: string | undefined;
  let opener = 0;
  const sync = () => {
    const dialogs = [...new Set(controls.map((c) => c.dialog).filter((d): d is string => !!d))];
    const top = dialogs[dialogs.length - 1];
    if (top && top !== open) {
      if (!open) opener = focus;
      open = top;
      focus = controls.findIndex((c) => c.dialog === top);
      controls = show();
    } else if (!top && open) {
      open = undefined;
      focus = Math.min(opener, Math.max(0, controls.length - 1));
      controls = show();
    }
  };
  sync();
  for await (const key of io.keys) {
    if (key === "\x03") break;
    const r = keyToWire(key, controls[focus], s.observe());
    if (r.move) {
      const reach = open ? controls.map((c, i) => [c, i] as const).filter(([c]) => c.dialog === open).map(([, i]) => i) : controls.map((_, i) => i);
      const at = Math.max(0, reach.indexOf(focus));
      if (reach.length) focus = reach[(at + r.move + reach.length) % reach.length];
    }
    if (r.wire) await s.send(r.wire);
    controls = show();
    sync();
    if (focus >= controls.length) focus = Math.max(0, controls.length - 1);
  }
}
