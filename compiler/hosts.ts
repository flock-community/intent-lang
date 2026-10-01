// A component's own examples (1.1) run in a host app made for them, as stories run in Storybook:
// the bundle's declarations, line for line (so every diagnostic points into the bundle), then the
// host's state and one `use` of the component as `examples with` says, then the component's
// examples with its names qualified (`click next` → `click pager.next`). The host is an ordinary
// app: it is checked, built and verified like any other.
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { App, Component, Diagnostic, RowRef, Step } from "./ast.ts";
import { localNames } from "./expand.ts";
import { stepText } from "./print.ts";

export interface Host {
  component: string;
  name: string; // the host app's name: `PagerExamples`
  text: string;
  /** A host line → the bundle line it came from (the bundle's own lines are the same lines). */
  origin: (line: number) => number;
}

/** The host apps of a bundle's components that have examples. */
export function componentHosts(bundleText: string, bundle: App): Host[] {
  return bundle.components.filter((c) => c.body?.examples.length).map((c) => host(bundleText, c));
}

function host(bundleText: string, comp: Component): Host {
  const name = `${comp.name}Examples`;
  // The instance is named after the component, unless that is a word of the language (`table`, `list`).
  const lower = comp.name[0].toLowerCase() + comp.name.slice(1);
  const inst = ["table", "list", "text", "field", "button", "checkbox", "select", "section", "progress", "heading", "screen", "state", "use", "slot", "record", "choice", "union", "example", "always", "derive", "nothing"].includes(lower) ? `${lower}1` : lower;
  // The bundle as an app: its header line becomes the host's, its language line 1.1; nothing moves.
  const lines = bundleText.split("\n");
  const head = lines.findIndex((l) => /^bundle\s+/.test(l));
  if (head >= 0) lines[head] = lines[head].replace(/^bundle\s+[a-z][\w.]*/, `app ${name}`);
  const lang = lines.findIndex((l) => /^language\s+\S+\s*$/.test(l));
  if (lang >= 0) lines[lang] = "language 1.1";
  else lines.splice(head + 1, 0, "language 1.1");
  // `examples with`: top-level items, each a first line and its indented lines.
  const items: string[][] = [];
  for (const l of comp.examplesWith?.lines ?? []) ((/^\S/.test(l) && l !== "}") || !items.length ? items.push([l]) : items[items.length - 1].push(l));
  // Records and choices the examples need (sample data), the host's state, and the `use`'s bindings and slot fills.
  const decls = items.filter((it) => /^(record|choice|union)\s/.test(it[0]));
  const state = items.filter((it) => /^[a-z]\w*\s*:/.test(it[0]) || /^stored\s+[a-z]\w*\s*:/.test(it[0]));
  const uses = items.filter((it) => !state.includes(it) && !decls.includes(it));
  const locals = localNames(comp.body!);
  const q = (n: string | undefined) => (n && locals.has(n.split(".")[0]) ? `${inst}.${n}` : n);
  const qRow = (r: RowRef | undefined): RowRef | undefined => r && { ...r, list: q(r.list), parent: qRow(r.parent) };
  const qStep = (s: Step): Step => {
    const x = { ...s } as Step & { target?: string; at?: RowRef; every?: string };
    if (typeof x.target === "string") x.target = q(x.target)!;
    if (x.at) x.at = qRow(x.at);
    if (x.every) x.every = q(x.every);
    if (x.do === "see" && x.check.is === "num" && x.check.ref) x.check = { ...x.check, ref: q(x.check.ref) };
    return x;
  };
  const block = (ls: string[], ind: string) => ls.map((l) => `${ind}${l}`).join("\n");
  const out = [
    ...lines,
    "",
    ...decls.flatMap((d) => [d.join("\n"), ""]),
    ...(state.length ? ["state {", block(state.flat(), "  "), "}", ""] : []),
    "screen {",
    `  use ${inst} = ${comp.name} {`,
    ...(uses.length ? [block(uses.flat(), "    ")] : []),
    "  }",
    "}",
    "",
  ];
  // The examples, each line remembering the step it came from.
  const from = new Map<number, number>();
  const extra = comp.examplesWith?.line ?? comp.line;
  for (let i = lines.length; i < out.length; i++) from.set(i + 1, extra);
  for (const e of comp.body!.examples) {
    out.push(`example ${JSON.stringify(e.name)} {`);
    from.set(out.length, e.line);
    for (const s of e.steps) {
      out.push(`  ${stepText(qStep(s))}`);
      from.set(out.length, s.line);
    }
    out.push("}", "");
  }
  return { component: comp.name, name, text: out.join("\n"), origin: (l) => from.get(l) ?? l };
}

/** Check each host of a bundle (written next to nothing: a temporary file), its findings on the bundle's lines. */
export function checkHosts(file: string, text: string, bundle: App, load: (f: string) => { diagnostics: Diagnostic[] }): Diagnostic[] {
  const out: Diagnostic[] = [];
  for (const h of componentHosts(text, bundle)) {
    const dir = mkdtempSync(join(tmpdir(), "intent-host-"));
    const f = join(dir, `${h.name}.intent`);
    writeFileSync(f, h.text);
    try {
      for (const d of load(f).diagnostics) if (!d.file || d.file === f || d.file.endsWith(`${h.name}.intent`)) out.push({ ...d, file, line: h.origin(d.line), message: `(examples of ${h.component}) ${d.message}` });
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  }
  return out;
}
