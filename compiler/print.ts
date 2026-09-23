// Canonical printer: an (expanded) app back to Intent text. The LLM always reads this form, so
// the same spec — whatever its formatting or imports — gives the same bytes. `intent expand`.
import type { App, Element, Literal, Step } from "./ast.ts";
import { LINE_BASE } from "./ast.ts";
import { typeToString } from "./parse.ts";

const q = (s: string) => JSON.stringify(s);

function lit(l: Literal, ind: string): string {
  switch (l.k) {
    case "text": return q(l.v);
    case "number": return l.raw;
    case "bool": return String(l.v);
    case "emptyList": return "[]";
    case "nothing": return "nothing";
    case "value": return l.v;
    case "table": {
      const rows = [l.columns, ...l.rows.map((r) => r.map((c) => lit(c, "")))];
      const w = l.columns.map((_, i) => Math.max(...rows.map((r) => r[i].length)));
      return "table\n" + rows.map((r) => `${ind}  ${r.map((c, i) => c.padEnd(w[i])).join(" | ").trimEnd()}`).join("\n");
    }
  }
}

export function stepText(s: Step): string {
  const at = "at" in s && s.at ? ` on row ${s.at.with !== undefined ? `with ${q(s.at.with)}` : s.at.row}${s.at.list ? ` of ${s.at.list}` : ""}` : "";
  switch (s.do) {
    case "type": return `type ${q(s.text)} into ${s.target}`;
    case "click": return `click ${s.target}${at}`;
    case "toggle": return `toggle ${s.target}${at}`;
    case "choose": return `choose ${s.quoted ? q(s.value) : s.value} in ${s.target}`;
    case "tick": return `tick ${s.times} times`;
    case "snapshot": return `snapshot ${q(s.name)}`;
    case "see": {
      const c = s.check;
      const cmp = (x: typeof c) => (x.is === "num" ? `is ${{ atLeast: "at least", atMost: "at most", above: "above", below: "below" }[x.op]} ${x.ref ?? x.value}` : "");
      if (s.every) return `see every row of ${s.every}: ${s.target} ${c.is === "num" ? cmp(c) : c.is === "eq" ? `= ${q(c.value)}` : `is ${c.is}`}`;
      if (c.is === "num") return `see ${s.target}${at} ${cmp(c)}`;
      if (c.is === "rows") return `see ${s.target} has ${c.cmp === "atMost" ? "at most " : c.cmp === "atLeast" ? "at least " : ""}${c.count} rows`;
      if (c.is === "eq") return `see ${s.target}${at} = ${q(c.value)}`;
      return `see ${s.target}${at} is ${c.is}`;
    }
  }
}

/** The node's own note, and where it came from when it came from another file. */
function origin(app: App, line: number, note?: string): string {
  const i = Math.floor(line / LINE_BASE);
  const parts = [note, i > 0 && app.sources?.[i] ? `from ${app.sources[i].file}:${line % LINE_BASE}` : ""].filter(Boolean);
  return parts.length ? `  # ${parts.join(" — ")}` : "";
}

function element(app: App, el: Element, ind: string): string[] {
  const out: string[] = [];
  const as = el.as ? ` as ${el.as}` : "";
  let head: string;
  switch (el.kind) {
    case "heading": head = `heading ${q(el.label ?? "")}${as}`; break;
    case "list": head = `list ${el.name} of ${el.of}${el.expr ? ` = ${el.expr}` : ""}${as}`; break;
    case "select":
      head = el.from ? `select ${el.name}${el.label ? ` ${q(el.label)}` : ""} from ${el.from.list}.${el.from.field}${as}` : `select ${el.name}${el.label ? ` ${q(el.label)}` : ""}${as}`;
      break;
    default:
      head = `${el.kind} ${el.name}${el.label !== undefined && el.label !== "" ? ` ${q(el.label)}` : ""}${el.expr ? ` = ${el.expr}` : ""}${as}`;
  }
  out.push(`${ind}${head}${origin(app, el.line, el.note)}`);
  if (el.visibleWhen) out.push(`${ind}  visible when ${el.visibleWhen}`);
  if (el.enabledWhen) out.push(`${ind}  enabled when ${el.enabledWhen}`);
  if (el.look) out.push(`${ind}  look ${q(el.look)}`);
  for (const c of el.children) out.push(...element(app, c, ind + "  "));
  return out;
}

export function printApp(app: App): string {
  const out: string[] = [];
  const block = (lines: string[]) => lines.length && out.push(...lines, "");
  block([`app ${app.name}`, ...app.purpose.map((p) => `  ${q(p)}`)]);
  if (app.design) {
    const d = app.design;
    block(["design", ...(d.look ? [`  look ${q(d.look)}`] : []), ...Object.entries(d.colors).map(([k, v]) => `  ${k}: ${v}`), ...(["font", "radius", "density"] as const).filter((k) => d[k]).map((k) => `  ${k}: ${d[k]}`)]);
  }
  // Look components only; behaviour components are already expanded into the app.
  block(app.components.filter((c) => c.look || c.base).map((c) => `component ${c.name}${c.base ? ` as ${c.base}` : ""} ${q(c.look)}${origin(app, c.line)}`));
  block(app.choices.map((c) => `choice ${c.name}: ${c.values.map((v) => (c.labels[v] !== v ? `${v} ${q(c.labels[v])}` : v)).join(" | ")}${origin(app, c.line)}`));
  for (const r of app.records) block([`record ${r.name}${origin(app, r.line)}`, ...r.fields.map((f) => `  ${f.name}: ${typeToString(f.type)}${f.default ? ` = ${lit(f.default, "  ")}` : ""}${origin(app, 0, f.note)}`)]);
  block(app.state.length ? ["state", ...app.state.map((f) => `  ${f.name}: ${typeToString(f.type)} = ${lit(f.default!, "  ")}${origin(app, f.line, f.note)}`)] : []);
  if (app.clockMs) block([`clock every ${app.clockMs}ms`]);
  block(app.derive.length ? ["derive", ...app.derive.map((d) => `  ${d.name} = ${d.sentence}${origin(app, d.line, d.note)}`)] : []);
  block(["screen", ...app.screen.flatMap((e) => element(app, e, "  "))]);
  for (const h of app.handlers) block([`on ${h.verb}${h.target ? ` ${h.target}` : ""}${origin(app, h.line, h.note)}`, ...h.steps.map((s) => `  - ${s}`)]);
  block(app.rules.length ? ["rules", ...app.rules.map((r) => `  - ${r}`)] : []);
  block(app.always.length ? ["always", ...app.always.map((s) => `  ${stepText(s)}${origin(app, s.line)}`)] : []);
  for (const ex of app.examples) block([`example ${q(ex.name)}`, ...ex.steps.map((s) => `  ${stepText(s)}`)]);
  return out.join("\n");
}
