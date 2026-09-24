// Screen nodes, wire events and the DOM renderer. Shared by every TypeScript build.

export type Node =
  | { k: "screen"; title: string; c: Node[] }
  | { k: "heading"; v: string }
  | { k: "text"; n: string; v: string }
  | { k: "field"; n: string; label: string; v: string }
  | { k: "button"; n: string; label: string; enabled: boolean }
  | { k: "checkbox"; n: string; label: string; checked: boolean }
  | { k: "progress"; n: string; label: string; v: number }
  | { k: "select"; n: string; label: string; options: string[]; v: string }
  | { k: "list"; n: string; rows: { key: string; c: Node[] }[] }
  | { k: "section"; n: string; label: string; c: Node[] };

export type Wire = { on: string; target: string; key?: string; text?: string; value?: string; answer?: unknown; event?: unknown; clock?: unknown };

export interface Program<M> {
  init: () => M;
  step: (w: Wire, m: M) => M;
  render: (m: M) => Node;
  clockMs?: number;
}

/** Render the program into root; returns dispatch, for events from outside the screen (answers to calls). */
export function mount<M>(root: HTMLElement, p: Program<M>): (w: Wire) => void {
  let model = p.init();
  const dispatch = (w: Wire) => {
    model = p.step(w, model);
    draw();
  };
  const draw = () => {
    const active = document.activeElement as HTMLInputElement | null;
    const focusId = active?.dataset?.id;
    const sel = active && "selectionStart" in active ? [active.selectionStart, active.selectionEnd] : null;
    root.replaceChildren(el(p.render(model), dispatch, ""));
    if (focusId) {
      const again = root.querySelector<HTMLInputElement>(`[data-id="${CSS.escape(focusId)}"]`);
      again?.focus();
      if (again && sel && again.setSelectionRange) again.setSelectionRange(sel[0], sel[1]);
    }
  };
  if (p.clockMs) setInterval(() => dispatch({ on: "tick", target: "" }), p.clockMs);
  draw();
  return dispatch;
}

function el(node: Node, dispatch: (w: Wire) => void, key: string, list = ""): HTMLElement {
  const h = <K extends keyof HTMLElementTagNameMap>(tag: K, cls: string, text?: string) => {
    const e = document.createElement(tag);
    if (cls) e.className = cls;
    if (text !== undefined) e.textContent = text;
    return e;
  };
  const target = (n: string) => (list ? `${list}.${n}` : n);
  switch (node.k) {
    case "screen": {
      const e = h("main", "screen");
      e.append(h("h1", "", node.title), ...node.c.map((c) => el(c, dispatch, key, list)));
      return e;
    }
    case "heading":
      return h("h2", "heading", node.v);
    case "text": {
      const e = h("p", "text", node.v);
      e.dataset.name = node.n;
      return e;
    }
    case "field": {
      const wrap = h("label", "field");
      const input = h("input", "");
      input.value = node.v;
      input.dataset.id = target(node.n) + key;
      input.addEventListener("input", () => dispatch({ on: "input", target: target(node.n), key, text: input.value }));
      if (node.label) wrap.append(h("span", "", node.label));
      wrap.append(input);
      return wrap;
    }
    case "button": {
      const b = h("button", "button", node.label);
      b.disabled = !node.enabled;
      b.dataset.id = target(node.n) + key;
      b.addEventListener("click", () => dispatch({ on: "click", target: target(node.n), key }));
      return b;
    }
    case "checkbox": {
      const wrap = h("label", "checkbox");
      const box = h("input", "");
      box.type = "checkbox";
      box.checked = node.checked;
      box.dataset.id = target(node.n) + key;
      box.addEventListener("change", () => dispatch({ on: "toggle", target: target(node.n), key }));
      wrap.append(box);
      if (node.label) wrap.append(h("span", "", node.label));
      return wrap;
    }
    case "progress": {
      const bar = h("progress", "progress");
      bar.max = 100;
      bar.value = node.v;
      return bar;
    }
    case "select": {
      const wrap = h("div", "select");
      if (node.label) wrap.append(h("span", "", node.label));
      for (const o of node.options) {
        const b = h("button", o === node.v ? "option chosen" : "option", o);
        b.addEventListener("click", () => dispatch({ on: "choose", target: target(node.n), value: o }));
        wrap.append(b);
      }
      return wrap;
    }
    case "list": {
      const ul = h("ul", "list");
      for (const r of node.rows) {
        const li = h("li", "row");
        li.append(...r.c.map((c) => el(c, dispatch, r.key, node.n)));
        ul.append(li);
      }
      return ul;
    }
    case "section": {
      const s = h("section", "section");
      if (node.label) s.append(h("h2", "", node.label));
      s.append(...node.c.map((c) => el(c, dispatch, key, list)));
      return s;
    }
  }
}

export const STYLE = `
body{font-family:system-ui,sans-serif;background:#f6f6f4;color:#1d1d1b;margin:0;padding:24px 16px}
.screen{max-width:520px;margin:0 auto;background:#fff;border-radius:12px;padding:20px 24px;box-shadow:0 1px 3px #0002}
h1{font-size:1.3rem;margin:0 0 12px}h2{font-size:1rem;margin:16px 0 6px}
.field{display:flex;gap:8px;align-items:center;margin:6px 0}.field input{flex:1;padding:6px 8px;font:inherit}
.button,.option{font:inherit;padding:5px 12px;margin:3px 4px 3px 0;border-radius:6px;border:1px solid #bbb;background:#fafafa;cursor:pointer}
.button:disabled{opacity:.4;cursor:default}.option.chosen{background:#1d1d1b;color:#fff}
.list{list-style:none;padding:0;margin:8px 0}.row{display:flex;gap:10px;align-items:center;padding:4px 0;border-bottom:1px solid #eee}
.row .text{margin:0;flex:1}.select{margin:6px 0}.select span{margin-right:8px}
.text{margin:6px 0}.section{border-top:1px solid #eee;margin-top:10px}
`;
