// Refinement: `extends <published app>` plus explicit `override` / `add to` / `drop`.
// The child starts as a copy of the base; every change is named, so it can be listed, checked
// against the base's proofs (examples and `always`), and re-applied when the base changes.
import type { App, Element } from "./ast.ts";

type Err = (l: number, c: string, m: string, col?: number) => void;

export type Refinement =
  | { op: "override-element"; element: Element; line: number }
  | { op: "override-derive"; name: string; sentence: string; note?: string; line: number }
  | { op: "override-state"; field: App["state"][0]; line: number }
  | { op: "override-handler"; handler: App["handlers"][0]; line: number }
  | { op: "override-component"; component: App["components"][0]; line: number }
  | { op: "add-elements"; into: string; after?: string; elements: Element[]; line: number }
  | { op: "drop-element"; name: string; line: number }
  | { op: "drop-example"; name: string; line: number }
  | { op: "drop-handler"; verb: string; target: string; line: number };

/** What a refinement targets, as a stable id: used for listing and for lock fingerprints. */
export function targetOf(r: Refinement): string {
  switch (r.op) {
    case "override-element": return `element ${r.element.name}`;
    case "override-derive": return `derive ${r.name}`;
    case "override-state": return `state ${r.field.name}`;
    case "override-handler": return `on ${r.handler.verb}${r.handler.target ? " " + r.handler.target : ""}`;
    case "override-component": return `component ${r.component.name}`;
    case "add-elements": return `add to ${r.into}${r.after ? ` after ${r.after}` : ""}`;
    case "drop-element": return `element ${r.name}`;
    case "drop-example": return `example ${r.name}`;
    case "drop-handler": return `on ${r.verb}${r.target ? " " + r.target : ""}`;
  }
}

function findElement(els: Element[], name: string): { list: Element[]; index: number } | undefined {
  for (let i = 0; i < els.length; i++) {
    if (els[i].name === name && els[i].kind !== "heading") return { list: els, index: i };
    const inner = findElement(els[i].children, name);
    if (inner) return inner;
  }
}

/** The base's part that a refinement replaces or removes, without line numbers: its fingerprint. */
export function baseTarget(base: App, r: Refinement): unknown {
  const strip = (v: unknown) => JSON.parse(JSON.stringify(v, (k, x) => (k === "line" ? undefined : x)));
  switch (r.op) {
    case "override-element":
    case "drop-element": {
      const name = r.op === "drop-element" ? r.name : r.element.name;
      const f = findElement(base.screen, name);
      return f && strip(f.list[f.index]);
    }
    case "override-derive": return strip(base.derive.find((d) => d.name === r.name));
    case "override-state": return strip(base.state.find((f) => f.name === r.field.name));
    case "override-handler": return strip(base.handlers.find((h) => h.verb === r.handler.verb && h.target === r.handler.target));
    case "drop-handler": return strip(base.handlers.find((h) => h.verb === r.verb && h.target === r.target));
    case "override-component": return strip(base.components.find((c) => c.name === r.component.name));
    case "drop-example": return strip(base.examples.find((e) => e.name === r.name));
    case "add-elements": return strip(findElement(base.screen, r.into)?.list[findElement(base.screen, r.into)!.index]?.children.map((c) => c.name));
  }
}

/**
 * Apply the child's refinements to a copy of the base. The child's own new declarations
 * (state, derive, handlers, rules, always, examples, records, choices, components) are added.
 */
export function refine(base: App, child: App, refinements: Refinement[], err: Err, warn: Err): App {
  const app: App = JSON.parse(JSON.stringify(base));
  app.kind = "app";
  app.name = child.name;
  app.purpose = child.purpose.length ? child.purpose : base.purpose;
  app.imports = [...(base.imports ?? []), ...(child.imports ?? [])];
  const overridden = new Set<string>();

  for (const r of refinements) {
    switch (r.op) {
      case "override-element": {
        const f = findElement(app.screen, r.element.name);
        if (!f) err(r.line, "UNKNOWN_NAME", `the base has no element \`${r.element.name}\` to override; add new elements with \`add to <section>\``);
        else {
          f.list[f.index] = r.element;
          overridden.add(r.element.name);
        }
        break;
      }
      case "override-derive": {
        const d = app.derive.find((x) => x.name === r.name);
        if (!d) err(r.line, "UNKNOWN_NAME", `the base has no derived value \`${r.name}\``);
        else (Object.assign(d, { sentence: r.sentence, note: r.note ?? d.note, line: r.line }), overridden.add(r.name));
        break;
      }
      case "override-state": {
        const i = app.state.findIndex((x) => x.name === r.field.name);
        if (i < 0) err(r.line, "UNKNOWN_NAME", `the base has no state \`${r.field.name}\`; declare new state in a normal \`state\` block`);
        else (app.state[i] = r.field, overridden.add(r.field.name));
        break;
      }
      case "override-handler": {
        const i = app.handlers.findIndex((h) => h.verb === r.handler.verb && h.target === r.handler.target);
        if (i < 0) err(r.line, "UNKNOWN_NAME", `the base has no \`on ${r.handler.verb} ${r.handler.target}\``);
        else (app.handlers[i] = r.handler, overridden.add(r.handler.target));
        break;
      }
      case "override-component": {
        const i = app.components.findIndex((c) => c.name === r.component.name);
        // A component can also come from the base's imports: then the override is recorded and applied after imports load.
        if (i >= 0) app.components[i] = r.component;
        else app.components.push({ ...r.component, from: "override" });
        break;
      }
      case "add-elements": {
        const f = findElement(app.screen, r.into);
        const into = f?.list[f.index];
        if (!into || (into.kind !== "section" && into.kind !== "list")) {
          err(r.line, "UNKNOWN_NAME", `the base has no section \`${r.into}\` to add to`);
          break;
        }
        const at = r.after ? into.children.findIndex((c) => c.name === r.after) : into.children.length - 1;
        if (r.after && at < 0) err(r.line, "UNKNOWN_NAME", `section \`${r.into}\` has no element \`${r.after}\``);
        into.children.splice(at + 1, 0, ...r.elements);
        break;
      }
      case "drop-element": {
        const f = findElement(app.screen, r.name);
        if (!f) err(r.line, "UNKNOWN_NAME", `the base has no element \`${r.name}\` to drop`);
        else (f.list.splice(f.index, 1), overridden.add(r.name));
        break;
      }
      case "drop-example": {
        const i = app.examples.findIndex((e) => e.name === r.name);
        if (i < 0) err(r.line, "UNKNOWN_NAME", `the base has no example "${r.name}"`);
        else app.examples.splice(i, 1);
        break;
      }
      case "drop-handler": {
        const i = app.handlers.findIndex((h) => h.verb === r.verb && h.target === r.target);
        if (i < 0) err(r.line, "UNKNOWN_NAME", `the base has no \`on ${r.verb} ${r.target}\``);
        else app.handlers.splice(i, 1);
        break;
      }
    }
  }

  // The base's proofs still apply. Say which of them touch what the child changed.
  for (const ex of app.examples) {
    const touched = [...new Set(ex.steps.flatMap((s) => ("target" in s ? [s.target] : [])).filter((t) => overridden.has(t)))];
    if (touched.length)
      warn(ex.line, "OVERRIDES_PROOF", `base example "${ex.name}" checks ${touched.map((t) => `\`${t}\``).join(", ")}, which this spec changes: it must still pass, or \`drop example "${ex.name}"\``);
  }
  for (const a of app.always) if ("target" in a && overridden.has(a.target)) warn(a.line, "OVERRIDES_PROOF", `a base \`always\` check is about \`${a.target}\`, which this spec changes: it must still hold`);

  // The child's own additions.
  if (child.screen.length) err(child.screen[0].line, "SYNTAX", "a spec that `extends` another has no `screen` block; place new elements with `add to <section> [after <element>]`");
  app.records.push(...child.records);
  app.choices.push(...child.choices);
  app.components.push(...child.components);
  app.state.push(...child.state);
  app.derive.push(...child.derive);
  app.handlers.push(...child.handlers);
  app.rules.push(...child.rules);
  app.always.push(...child.always);
  app.examples.push(...child.examples);
  if (child.design) {
    const d = app.design ?? { colors: {} };
    app.design = { ...d, ...child.design, colors: { ...d.colors, ...child.design.colors } };
  }
  if (child.clockMs) app.clockMs = child.clockMs;
  return app;
}
