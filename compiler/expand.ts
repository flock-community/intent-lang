// Instantiating behaviour components: `use pager = Pager` + bindings becomes plain spec,
// deterministically. Names of the component become `pager.<name>`; `{local}` anchors in its
// sentences become `{pager.local}`; `{param}` anchors become the bound value.
import { mapBody, mapRefs } from "./refs.ts";
import type { App, Component, Element, Handler, Step, Type } from "./ast.ts";
import { typeToString } from "./words.ts";

type Err = (l: number, c: string, m: string, col?: number) => void;

const QN = /^[a-z][A-Za-z0-9]*(\.[a-z][A-Za-z0-9]*)*$/;

/** Every name a component declares: its state, derived values and screen elements (not row children). */
function localNames(body: App): Set<string> {
  const names = new Set<string>([...body.state.map((f) => f.name), ...body.derive.map((d) => d.name)]);
  const walk = (els: Element[]) => {
    for (const el of els) {
      if (el.slot) {
        walk(el.children); // a slot is the app's place, not a name; its default content is the component's
        continue;
      }
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
  // 1.1: typed params. A param bound to a state or derived value of the app must have its type;
  // a type parameter (`component Table of T`) is what the first binding that mentions it says.
  const typeArgs = new Map<string, string>();
  let broken = false; // a binding of the wrong type: the instance is left empty (one error, not its echoes)
  const typeOfName = (n: string): Type | undefined => app.state.find((f) => f.name === n)?.type ?? app.derive.find((d) => d.name === n)?.type;
  for (const p of params.values()) {
    if (!p.type) continue;
    const b = (use.bindings ?? []).find((x) => x.name === p.name);
    const v = values.get(p.name);
    if (!b || v === undefined || !QN.test(v)) continue;
    const t = typeOfName(v);
    if (!t) continue; // a type the expansion cannot see yet: the checker reads the expanded sentences
    const said = typeToString(t);
    const holes: string[] = [];
    const re = new RegExp(`^${p.type.replace(/[.*+?^$()|[\]\\]/g, "\\$&").split(/\b/).map((w) => ((comp.typeParams ?? []).includes(w) ? (holes.push(w), "([A-Z][A-Za-z0-9]*)") : w)).join("")}$`);
    const m = said.match(re);
    const known = holes.map((h, i) => [h, m?.[i + 1]] as const);
    if (!m || known.some(([h, x]) => typeArgs.has(h) && typeArgs.get(h) !== x)) {
      const want = p.type.split(/\b/).map((w) => typeArgs.get(w) ?? w).join("");
      err(b.line, "TYPE", `\`${p.name} = ${v}\`: ${comp.name}'s \`${p.name}\` is ${want}, but \`${v}\` is ${said}`);
      broken = true;
      continue;
    }
    for (const [h, x] of known) typeArgs.set(h, x!);
  }
  for (const tp of comp.typeParams ?? []) if (!typeArgs.has(tp) && !broken && (broken = true)) err(use.line, "BAD_BINDING", `\`use ${inst} = ${comp.name}\` cannot tell what \`${tp}\` is: bind a typed param to a state or derived value (\`${(comp.params ?? []).find((p) => p.type?.split(/\b/).includes(tp))?.name ?? "…"} = …\`)`);
  const subT = (t: Type): Type => (t.k === "Named" && typeArgs.has(t.name) ? { k: "Named", name: typeArgs.get(t.name)! } : "of" in t && t.of ? ({ ...t, of: subT(t.of) } as Type) : t);
  // 1.1: slots. The content a `use` gives each slot is the app's own: its names, handlers and look.
  const slotNames = new Set<string>();
  const findSlots = (els: Element[]) => els.forEach((e) => (e.slot ? slotNames.add(e.name) : undefined, findSlots(e.children)));
  findSlots(body.screen);
  for (const name of Object.keys(use.fills ?? {})) if (!slotNames.has(name)) err(use.line, "UNKNOWN_NAME", `component ${comp.name} has no slot \`${name}\`${slotNames.size ? ` (${[...slotNames].join(", ")})` : ""}`);

  if (broken) return { kind: "section", name: inst, children: [], line: use.line };
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
  // And `@name` references: `@page` → `@pager.page`, `@items` → `@sorted`, `@size` → `5`.
  const rwBraces = rw;
  const rwAll = (text: string | undefined): string | undefined =>
    text === undefined
      ? undefined
      : mapRefs(rwBraces(text)!, (n) => {
          if (locals.has(n)) return "@" + q(n);
          if (values.has(n)) {
            const v = values.get(n)!;
            return QN.test(v) ? "@" + v : v.replace(/^"(.*)"$/, "$1");
          }
          return "@" + n;
        });
  const renameRef = (name: string) => (locals.has(name) ? q(name) : values.has(name) && QN.test(values.get(name)!) ? values.get(name)! : name);

  for (const f of body.state) app.state.push({ ...f, name: q(f.name), type: subT(f.type) });
  for (const d of body.derive) app.derive.push({ ...d, name: q(d.name), sentence: rwAll(d.sentence)!, ...(d.type ? { type: subT(d.type) } : {}) });
  body.rules.forEach((r, i) => {
    // Keep rules and their lines side by side (an app's own rules may have none recorded).
    app.ruleLines = [...(app.ruleLines ?? app.rules.map(() => 1)), body.ruleLines?.[i] ?? comp.line];
    if (app.ruleBy || body.ruleBy) app.ruleBy = [...(app.ruleBy ?? app.rules.map(() => "human" as const)), body.ruleBy?.[i] ?? "human"];
    app.rules.push(`(${inst}) ${rwAll(r)}`);
  });
  for (const h of body.handlers) {
    const handler: Handler = { ...h, target: h.verb === "tick" ? "" : renameRef(h.target), steps: h.steps.map((s) => rwAll(s)!), body: h.body && mapBody(h.body, (t) => rwAll(t)!) };
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
  // `- sentence` lines (one-moment rules and change rules): the component's names renamed, as in its steps.
  for (const inv of body.invariants ?? []) (app.invariants ??= []).push({ text: rwAll(inv.text)!, line: inv.line });

  const renameEls = (els: Element[], inRow: boolean): Element[] =>
    els.flatMap((el): Element[] => {
      if (!el.slot) return [renamed(el, inRow)];
      const fill = use.fills?.[el.name];
      if (fill) return fill; // the app's elements, as the app wrote them
      if (el.children.length) return renameEls(el.children, inRow); // the slot's own content
      err(use.line, "BAD_BINDING", `\`use ${inst} = ${comp.name}\` needs the content of slot \`${el.name}\`${el.note ? ` (${el.note})` : ""}: \`${el.name} { … }\``);
      return [];
    });
  const renamed = (el: Element, inRow: boolean): Element => ({
      ...el,
      name: el.kind === "heading" || inRow ? el.name : q(el.name),
      part: el.kind === "heading" ? undefined : el.name, // its name in the component: the theme's handle
      label: el.label,
      expr: rwAll(el.expr),
      visibleWhen: rwAll(el.visibleWhen),
      enabledWhen: rwAll(el.enabledWhen),
      tones: el.tones?.map((t) => ({ ...t, when: rwAll(t.when) })),
      look: rwAll(el.look),
      from: el.from ? { list: renameRef(el.from.list), field: el.from.field } : undefined,
      bindings: el.bindings?.map((b) => ({ ...b, value: rwAll(b.value)! })),
      of: el.of && typeArgs.has(el.of) ? typeArgs.get(el.of) : el.of,
      children: renameEls(el.children, inRow || el.kind === "list"),
    });

  return {
    kind: "section",
    name: inst,
    as: comp.look || comp.base ? comp.name : undefined,
    instanceOf: comp.name,
    visibleWhen: use.visibleWhen, // the app's condition: not rewritten
    look: use.look,
    children: renameEls(body.screen, false),
    line: use.line,
  };
}
