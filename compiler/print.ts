// Canonical printer: an (expanded) app back to Intent text. The LLM always reads this form, so
// the same spec — whatever its formatting or imports — gives the same bytes. `intent expand`.
import type { App, Binding, Element, Literal, Step } from "./ast.ts";
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
    case "call": {
      const args = [...(s.headers ?? []).map((h) => `header ${h.name} = ${lit(h.value, "")}`), ...s.args.map((a) => `${a.name} = ${lit(a.value, "")}`)];
      return `call ${s.endpoint}${args.length ? ` with ${args.join(", ")}` : ""}`;
    }
    case "given": return `given ${s.name} = ${lit(s.value, "")}`;
    case "request": return `request ${s.method} ${q(s.path)}${s.args.length ? ` with ${s.args.map((a) => `${a.in} ${a.name} = ${lit(a.value, "")}`).join(", ")}` : ""}`;
    case "see": {
      const c = s.check;
      if (/(^|\.)header\./.test(s.target)) return `see ${s.target} ${c.is === "eq" ? `= ${q(c.value)}` : "is absent"}`;
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

function binding(b: Binding, ind: string): string[] {
  if (Array.isArray(b.value)) return [`${ind}${b.name} = ${b.value.map((v) => lit(v, "")).join(", ")}`];
  const text = lit(b.value, ind);
  return (`${ind}${b.name} = ${text}`).split("\n");
}

export function printApp(app: App): string {
  const out: string[] = [];
  const block = (lines: string[]) => lines.length && out.push(...lines, "");
  block([`${app.kind ?? "app"} ${app.name}`, ...app.purpose.map((p) => `  ${q(p)}`)]);
  if (app.profile && app.profile !== "ui" && app.kind !== "layer") block([`profile ${app.profile}`]);
  // Layers the api runs behind, in order, with their bound params.
  for (const l of app.layers ?? [])
    block([
      `use ${l.alias} = ${l.layer}${l.digest ? `  # layer ${l.digest}` : ""}`,
      ...(l.spec?.purpose ?? []).map((p) => `  # ${p}`),
      ...(l.spec?.provides ?? []).map((p) => `  # provides ${p.name}: ${typeToString(p.type)} to every endpoint${p.note ? ` — ${p.note}` : ""}`),
      ...l.bindings.flatMap((b) => binding(b, "  ")),
    ]);
  // A client: the contract's endpoints, as the app may call them (\`call <alias>.<endpoint>\`).
  for (const c of app.clients ?? [])
    block([
      `uses ${c.contract.name} as ${c.alias}`,
      ...(c.testedWith ? [`  tested with ${q(c.testedWith)}${c.providerDigest ? `  # provider ${c.providerDigest}` : ""}`] : []),
      ...(c.through
        ? [
            `  through ${c.through.layer}${c.through.digest ? `  # layer ${c.through.digest}` : ""}`,
            ...(c.through.spec?.purpose ?? []).map((p) => `    # ${p}`),
            ...c.through.bindings.flatMap((b) => (b.state ? [`    ${b.name} = ${b.state}  # from state`] : binding(b, "    "))),
          ]
        : []),
      ...(c.contract.endpoints ?? []).flatMap((ep) => [
        `  endpoint ${ep.name} ${ep.method} ${q(ep.path)}${ep.note ? `  # ${ep.note}` : ""}`,
        ...ep.params.map((p) => `    ${p.in} ${p.name}: ${typeToString(p.type)}`),
        ...(ep.answers ?? []).map((a) => `    answers ${a.status}${a.type ? ` ${typeToString(a.type)}` : ""}`),
      ]),
      ...(c.contract.events ?? []).map((e) => `  event ${e.name}: ${typeToString(e.type)}${e.note ? `  # ${e.note}` : ""}`),
    ]);
  if (app.design) {
    const d = app.design;
    block(["design", ...(d.look ? [`  look ${q(d.look)}`] : []), ...Object.entries(d.colors).map(([k, v]) => `  ${k}: ${v}`), ...(["font", "radius", "density"] as const).filter((k) => d[k]).map((k) => `  ${k}: ${d[k]}`)]);
  }
  // Look components only; behaviour components are already expanded into the app.
  block(app.components.filter((c) => c.look || c.base).map((c) => `component ${c.name}${c.base ? ` as ${c.base}` : ""} ${q(c.look)}${origin(app, c.line)}`));
  block((app.refined ?? []).map((r) => `type ${r.name} = ${r.base} ${r.pattern !== undefined ? `matching /${r.pattern}/` : [r.min !== undefined ? `from ${r.min}` : "", r.max !== undefined ? `to ${r.max}` : ""].filter(Boolean).join(" ")}${origin(app, r.line)}`));
  block(app.choices.map((c) => `choice ${c.name}: ${c.values.map((v) => (c.labels[v] !== v ? `${v} ${q(c.labels[v])}` : v)).join(" | ")}${origin(app, c.line)}`));
  for (const r of app.records) block([`record ${r.name}${origin(app, r.line)}`, ...r.fields.map((f) => `  ${f.name}: ${typeToString(f.type)}${f.default ? ` = ${lit(f.default, "  ")}` : ""}${origin(app, 0, f.note)}`)]);
  if (app.kind === "layer") {
    block((app.params ?? []).map((f) => `param ${f.name}: ${typeToString(f.type)}${f.default ? ` = ${(Array.isArray(f.default) ? f.default : [f.default]).map((v) => lit(v, "")).join(", ")}` : ""}${origin(app, f.line, f.note)}`));
    block((app.provides ?? []).map((f) => `provides ${f.name}: ${typeToString(f.type)}${origin(app, f.line, f.note)}`));
    if (app.before) block(["before every request", ...app.before.steps.map((st) => `  - ${st}`)]);
    if (app.after) block(["after every answer", ...app.after.steps.map((st) => `  - ${st}`)]);
    if (app.beforeCall) block(["before every call", ...app.beforeCall.steps.map((st) => `  - ${st}`)]);
    if (app.exampleConfig?.length) block(["examples with", ...app.exampleConfig.flatMap((b) => binding(b, "  "))]);
  }
  block(app.state.length ? ["state", ...app.state.map((f) => `  ${f.name}: ${typeToString(f.type)} = ${lit(f.default!, "  ")}${origin(app, f.line, f.note)}`)] : []);
  if (app.clockMs) block([`clock every ${app.clockMs}ms`]);
  block(app.derive.length ? ["derive", ...app.derive.map((d) => `  ${d.name} = ${d.sentence}${origin(app, d.line, d.note)}`)] : []);
  if (app.screen.length) block(["screen", ...app.screen.flatMap((e) => element(app, e, "  "))]);
  block((app.everyAnswer ?? []).map((a) => `every endpoint answers ${a.status}${a.type ? ` ${typeToString(a.type)}` : ""}`));
  block((app.events ?? []).map((e) => `event ${e.name}: ${typeToString(e.type)}${origin(app, e.line, e.note)}`));
  for (const ep of app.endpoints ?? [])
    block([
      `endpoint ${ep.name} ${ep.method} ${q(ep.path)}${origin(app, ep.line, ep.note)}`,
      ...ep.params.map((p) => `  ${p.in} ${p.name}: ${typeToString(p.type)}`),
      ...(ep.returns ? [`  returns ${typeToString(ep.returns)}`] : []),
      ...ep.steps.map((s) => `  - ${s}`),
    ]);
  for (const h of app.handlers) block([`on ${h.verb}${h.target ? ` ${h.target}` : ""}${origin(app, h.line, h.note)}`, ...h.steps.map((s) => `  - ${s}`)]);
  block(app.rules.length ? ["rules", ...app.rules.map((r) => `  - ${r}`)] : []);
  block(app.always.length ? ["always", ...app.always.map((s) => `  ${stepText(s)}${origin(app, s.line)}`)] : []);
  for (const ex of app.examples) block([`example ${q(ex.name)}`, ...ex.steps.map((s) => `  ${stepText(s)}`)]);
  return out.join("\n");
}
