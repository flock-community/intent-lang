// Instantiating behaviour components: `use pager = Pager` + bindings becomes plain spec,
// deterministically. Names of the component become `pager.<name>`; `{local}` anchors in its
// sentences become `{pager.local}`; `{param}` anchors become the bound value.
import type { App, Component, Element, Handler, Step } from "./ast.ts";

type Err = (l: number, c: string, m: string, col?: number) => void;

const QN = /^[a-z][A-Za-z0-9]*(\.[a-z][A-Za-z0-9]*)*$/;

/** Every name a component declares: its state, derived values and screen elements (not row children). */
function localNames(body: App): Set<string> {
  const names = new Set<string>([...body.state.map((f) => f.name), ...body.derive.map((d) => d.name)]);
  const walk = (els: Element[]) => {
    for (const el of els) {
      if (el.kind !== "heading") names.add(el.name);
      if (el.kind === "section") walk(el.children); // list rows keep their own names
    }
  };
  walk(body.screen);
  return names;
}

export function expandUses(app: App, err: Err, warn: Err) {
  const byName = new Map(app.components.map((c) => [c.name, c]));
  const used = new Set<string>();
  const expand = (els: Element[], depth: number): Element[] =>
    els.map((el) => {
      if (el.kind === "use") {
        const comp = byName.get(el.component!);
        if (!comp) {
          err(el.line, "UNKNOWN_NAME", `no component \`${el.component}\`; declare or import it`);
          return { ...el, kind: "section", children: [] };
        }
        if (!comp.body) {
          err(el.line, "BAD_BINDING", `component ${comp.name} has only a look; show an element \`as ${comp.name}\` instead of \`use\``);
          return { ...el, kind: "section", children: [] };
        }
        if (depth > 8) {
          err(el.line, "BAD_BINDING", "components use each other too deeply (a cycle?)");
          return { ...el, kind: "section", children: [] };
        }
        used.add(comp.name);
        const section = instantiate(app, comp, el, err);
        section.children = expand(section.children, depth + 1);
        return section;
      }
      if (el.children.length) return { ...el, children: expand(el.children, depth) };
      return el;
    });
  app.screen = expand(app.screen, 0);
  return used;
}

function instantiate(app: App, comp: Component, use: Element, err: Err): Element {
  const inst = use.name;
  const body = comp.body!;
  const locals = localNames(body);
  const params = new Map((comp.params ?? []).map((p) => [p.name, p]));
  const values = new Map<string, string>();
  for (const b of use.bindings ?? []) {
    if (!params.has(b.name)) err(b.line, "UNKNOWN_NAME", `component ${comp.name} has no param \`${b.name}\` (${[...params.keys()].join(", ") || "none"})`);
    else values.set(b.name, b.value);
  }
  for (const p of params.values()) {
    if (!values.has(p.name)) {
      if (p.default !== undefined) values.set(p.name, p.default);
      else err(use.line, "BAD_BINDING", `\`use ${inst} = ${comp.name}\` needs a value for \`${p.name}\`${p.doc ? ` (${p.doc})` : ""}`);
    }
  }
  const q = (name: string) => `${inst}.${name}`;
  // Rewrite anchors inside braces: locals get the instance prefix, params their value.
  const rw = (text: string | undefined): string | undefined =>
    text?.replace(/\{([^{}]*)\}/g, (_, inner: string) => {
      // A param bound to a literal reads as plain text: "divided by {size}" → "divided by 5".
      const whole = inner.trim();
      if (values.has(whole) && !QN.test(values.get(whole)!)) return values.get(whole)!.replace(/^"(.*)"$/, "$1");
      const out = inner.replace(/(?<![\w.])([a-z][A-Za-z0-9]*)(?![\w])/g, (w: string) => {
        if (locals.has(w)) return q(w);
        if (values.has(w)) {
          const v = values.get(w)!;
          return QN.test(v) || /^-?\d+(\.\d+)?$/.test(v) ? v : v.replace(/^"(.*)"$/, "$1");
        }
        return w;
      });
      return `{${out}}`;
    });
  const renameRef = (name: string) => (locals.has(name) ? q(name) : values.has(name) && QN.test(values.get(name)!) ? values.get(name)! : name);

  for (const f of body.state) app.state.push({ ...f, name: q(f.name) });
  for (const d of body.derive) app.derive.push({ ...d, name: q(d.name), sentence: rw(d.sentence)! });
  for (const r of body.rules) app.rules.push(`(${inst}) ${rw(r)}`);
  for (const h of body.handlers) {
    const handler: Handler = { ...h, target: h.verb === "tick" ? "" : renameRef(h.target), steps: h.steps.map((s) => rw(s)!) };
    app.handlers.push(handler);
  }
  for (const a of body.always) {
    const step = { ...a, target: renameRef((a as { target: string }).target) } as Step;
    if (step.do === "see" && step.check.is === "rows" && step.check.countParam) {
      const v = values.get(step.check.countParam);
      if (v === undefined || !/^\d+$/.test(v)) err(use.line, "BAD_BINDING", `\`${step.check.countParam}\` must be a whole number here (used in \`always\` of ${comp.name})`);
      step.check = { ...step.check, count: Number(v), countParam: undefined };
    }
    app.always.push(step);
  }

  const renameEls = (els: Element[], inRow: boolean): Element[] =>
    els.map((el) => ({
      ...el,
      name: el.kind === "heading" || inRow ? el.name : q(el.name),
      label: el.label,
      expr: rw(el.expr),
      visibleWhen: rw(el.visibleWhen),
      enabledWhen: rw(el.enabledWhen),
      look: rw(el.look),
      from: el.from ? { list: renameRef(el.from.list), field: el.from.field } : undefined,
      bindings: el.bindings?.map((b) => ({ ...b, value: rw(b.value)! })),
      children: renameEls(el.children, inRow || el.kind === "list"),
    }));

  return {
    kind: "section",
    name: inst,
    as: comp.look || comp.base ? comp.name : undefined,
    visibleWhen: use.visibleWhen, // the app's condition: not rewritten
    look: use.look,
    children: renameEls(body.screen, false),
    line: use.line,
  };
}
