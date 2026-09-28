// Canonical printer: an (expanded) app back to Intent text. The LLM always reads this form, so
// the same spec — whatever its formatting or imports — gives the same bytes. `intent expand`.
import type { App, Binding, Element, Literal, Step, Stmt } from "./ast.ts";
import { LINE_BASE } from "./ast.ts";
import { typeToString } from "./parse.ts";
import { toBraces } from "./braces.ts";
import { codeSize } from "./alphabets.ts";
import { ruleText } from "./access.ts";

const q = (s: string) => JSON.stringify(s);

function lit(l: Literal, ind: string): string {
  switch (l.k) {
    case "text": return q(l.v);
    case "number": return l.raw;
    case "bool": return String(l.v);
    case "emptyList": return "[]";
    case "nothing": return "nothing";
    case "value": return l.v;
    case "date": return l.v;
    case "dateTime": return l.v.replace("T", " ");
    case "list": return `[${l.items.map((x) => lit(x, "")).join(", ")}]`;
    case "record": return `{ ${l.fields.map((f) => `${f.name} = ${lit(f.value, "")}`).join(", ")} }`;
    case "table": {
      const rows = [l.columns, ...l.rows.map((r) => r.map((c) => lit(c, "")))];
      const w = l.columns.map((_, i) => Math.max(...rows.map((r) => r[i].length)));
      return "table\n" + rows.map((r) => `${ind}  ${r.map((c, i) => c.padEnd(w[i])).join(" | ").trimEnd()}`).join("\n");
    }
  }
}

/** A duration in its largest exact unit: 90000 → "90s", 86400000 → "1d". */
function duration(ms: number): string {
  for (const [u, n] of [["d", 86400000], ["h", 3600000], ["m", 60000], ["s", 1000]] as const) if (ms % n === 0) return `${ms / n}${u}`;
  return `${ms}ms`;
}

/** `effect external` and `undone by …` of an endpoint. */
const effectLines = (ep: NonNullable<App["endpoints"]>[number], ind: string): string[] => [
  ...(ep.effect ? [`${ind}effect external${ep.effect.of ? ` of @${ep.effect.of}` : ""}`] : []),
  ...(ep.undoneBy ? [`${ind}undone by ${ep.undoneBy.endpoint}${ep.undoneBy.args.length ? ` with ${ep.undoneBy.args.map((a) => `${a.name} = ${a.value}`).join(", ")}` : ""}`] : []),
];

export function stepText(s: Step): string {
  // One `on row …` per level of rows, innermost first (`on row 2 of items on row 1 of tasks`).
  let at = "";
  for (let r = ("at" in s ? s.at : undefined); r; r = r.parent) at += ` on row ${r.with !== undefined ? `with ${q(r.with)}` : r.row}${r.list ? ` of ${r.list}` : ""}`;
  switch (s.do) {
    case "type": return `type ${q(s.text)} into ${s.target}${at}`;
    case "click": return `click ${s.target}${at}`;
    case "toggle": return `toggle ${s.target}${at}`;
    case "choose": return `choose ${s.quoted ? q(s.value) : s.value} in ${s.target}${at}`;
    case "tick": return s.ms ? `wait ${duration(s.ms)}` : `tick ${s.times} times`;
    case "snapshot": return `snapshot ${q(s.name)}`;
    case "restart": return "restart";
    case "size": return `size ${s.size[0].toLowerCase()}${s.size.slice(1)}`;
    case "open": return `open ${q(s.path)}`;
    case "back": return "go back";
    case "random": return `steer random ${s.what}${s.order ? ` ${s.order === "keep" ? "keeps" : "reverses"} order` : s.pick !== undefined ? ` ${s.pick}` : ` = ${(s.values ?? []).map((v) => lit(v, "")).join(", ")}`}`;
    case "steer": return `steer ${s.api} ${s.fault}${s.fault === "fail" ? ` ${s.times}` : ""}`;
    case "call": {
      const args = [...(s.headers ?? []).map((h) => `header ${h.name} = ${lit(h.value, "")}`), ...s.args.map((a) => `${a.name} = ${lit(a.value, "")}`)];
      return `call ${s.endpoint}${s.as !== undefined ? ` as ${q(s.as)}` : ""}${args.length ? ` with ${args.join(", ")}` : ""}`;
    }
    case "given": return `given ${s.name} = ${lit(s.value, "")}`;
    case "request": return `request ${s.method} ${q(s.path)}${s.args.length ? ` with ${s.args.map((a) => `${a.in} ${a.name} = ${lit(a.value, "")}`).join(", ")}` : ""}`;
    case "see": {
      const c = s.check;
      if (/(^|\.)header\./.test(s.target)) return `see ${s.target} ${c.is === "eq" ? `= ${q(c.value)}` : "is absent"}`;
      const cmp = (x: typeof c) => (x.is === "num" ? `is ${{ atLeast: "at least", atMost: "at most", above: "above", below: "below" }[x.op]} ${x.ref ?? x.value}` : "");
      if (s.every) return `see every row of ${s.every}: ${s.target} ${c.is === "num" ? cmp(c) : c.is === "eq" ? `= ${q(c.value)}` : `is ${c.is}`}`;
      if (c.is === "num") return `see ${s.target}${at} ${cmp(c)}`;
      if (c.is === "rows") return `see ${s.target}${at} has ${c.cmp === "atMost" ? "at most " : c.cmp === "atLeast" ? "at least " : ""}${c.count} rows`;
      if (c.is === "eq" && s.target === "screen" && !at) return `see screen = ${c.value}`;
      if (c.is === "eq") return `see ${s.target}${at} = ${c.nothing ? "nothing" : q(c.value)}`;
      return `see ${s.target}${at} is ${c.is}`;
    }
  }
}

/** The node's own note, where it came from when it came from another file, and the references it follows. */
function origin(app: App, line: number, note?: string): string {
  const i = Math.floor(line / LINE_BASE);
  const parts = [note, i > 0 && app.sources?.[i] ? `from ${app.sources[i].file}:${line % LINE_BASE}` : "", line ? follows(app, line) : ""].filter(Boolean);
  return parts.length ? `  # ${parts.join(" — ")}` : "";
}

/** How a sentence reads through references (`its @ticket's @subject`): what it follows, and what it is when the row is gone. */
function follows(app: App, line: number): string {
  const ns = (app.facts?.navigations ?? []).filter((n) => n.line === line);
  const seen = new Set<string>();
  return ns
    .filter((n) => !seen.has(n.chain) && seen.add(n.chain))
    .map((n) => `${n.chain}: follows ${n.follows.map((f) => f.replace(/ in (\w+)$/, " in @$1")).join(", then ")}; ${n.list ? "rows whose reference finds no row are left out" : n.guarded ? "the row is there (asked before)" : n.condition ? "compared: a missing row equals no value" : n.fallback ? "none → the sentence's fallback" : "may be nothing"}`)
    .join(" · ");
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
      // An empty label is printed as given (`button add ""`); a field without one reads as "" too.
      head = `${el.kind} ${el.name}${el.label !== undefined && (el.label !== "" || el.kind !== "field") ? ` ${q(el.label)}` : ""}${el.expr ? ` = ${el.expr}` : ""}${as}`;
  }
  out.push(`${ind}${head}${origin(app, el.line, el.note)}`);
  if (el.visibleWhen) out.push(`${ind}  visible when ${el.visibleWhen}`);
  if (el.enabledWhen) out.push(`${ind}  enabled when ${el.enabledWhen}`);
  if (el.look) out.push(`${ind}  look ${q(el.look)}`);
  for (const c of el.children) out.push(...element(app, c, ind + "  "));
  return out;
}

/** A body in its indented form (the canonical print adds the braces): steps, `if`/`else`, `answer`, `stop`. */
function body(b: { body?: Stmt[]; steps: string[] }, ind: string, app?: App): string[] {
  if (!b.body) return b.steps.map((s) => `${ind}- ${s}`);
  const out: string[] = [];
  const walk = (stmts: Stmt[], i: string) => {
    for (const s of stmts) {
      if (s.k === "step") out.push(`${i}- ${s.text}${app ? origin(app, s.line >= LINE_BASE ? 0 : s.line) : ""}`);
      else if (s.k === "answer") out.push(`${i}answer ${s.text}`);
      else if (s.k === "stop") out.push(`${i}stop`);
      else if (s.k === "for") {
        out.push(`${i}for each @${s.name} in ${s.list}${s.where ? ` where ${s.where}` : ""}`);
        walk(s.body, i + "  ");
      } else
        s.branches.forEach((br, n) => {
          out.push(`${i}${br.cond === undefined ? "else" : `${n ? "else if" : "if"} ${br.cond}`}${app && br.cond !== undefined && br.line < LINE_BASE ? origin(app, br.line) : ""}`);
          walk(br.body, i + "  ");
        });
    }
  };
  walk(b.body, ind);
  return out;
}

function binding(b: Binding, ind: string): string[] {
  // Bound to the app's state: the layer reads that field on every request.
  if (b.state) return [`${ind}${b.name} = ${b.state}  # from state`];
  if (Array.isArray(b.value)) return [`${ind}${b.name} = ${b.value.map((v) => lit(v, "")).join(", ")}`];
  const text = lit(b.value, ind);
  return (`${ind}${b.name} = ${text}`).split("\n");
}

export function printApp(app: App): string {
  const out: string[] = [];
  const block = (lines: string[]) => lines.length && out.push(...lines, "");
  block([`${app.kind ?? "app"} ${app.name}`, ...app.purpose.map((p) => `  ${q(p)}`)]);
  if (app.profile && app.profile !== "ui" && app.kind !== "layer") block([`profile ${app.profile}`]);
  if (app.startsAt) block([`examples start at ${app.startsAt.replace("T", " ")}`]);
  if (app.sizes) block([`sizes ${app.sizes.map((x) => x[0].toLowerCase() + x.slice(1)).join(" | ")}`]);
  // Layers the api runs behind, in order, with their bound params.
  for (const l of app.layers ?? [])
    block([
      `use ${l.alias} = ${l.layer}${l.digest ? `  # layer ${l.digest}` : ""}`,
      ...(l.spec?.purpose ?? []).map((p) => `  # ${p}`),
      ...(l.spec?.provides ?? []).map((p) => `  # provides ${p.name}: ${typeToString(p.type)} to every endpoint${p.note ? ` — ${p.note}` : ""}`),
      ...l.bindings.flatMap((b) => binding(b, "  ")),
    ]);
  // A client: the contract's endpoints, as the app may call them (\`call <alias>.<endpoint>\`). They
  // are the contract's (the \`uses\` line brings them), shown as notes so that the expanded spec
  // reads back as it is printed.
  for (const c of app.clients ?? [])
    block([
      `uses ${c.contract.name} as ${c.alias}${c.only ? ` only ${c.only.join(", ")}` : ""}`,
      ...(c.testedWith ? [`  tested with ${q(c.testedWith)}${c.providerDigest ? `  # provider ${c.providerDigest}` : ""}`] : []),
      ...(c.through
        ? [
            `  through ${c.through.layer}${c.through.digest ? `  # layer ${c.through.digest}` : ""}`,
            ...(c.through.spec?.purpose ?? []).map((p) => `    # ${p}`),
            ...c.through.bindings.flatMap((b) => binding(b, "    ")),
          ]
        : []),
      ...(c.contract.endpoints ?? []).flatMap((ep) => [
        `  # endpoint ${ep.name} ${ep.method} ${q(ep.path)}${ep.note ? ` — ${ep.note}` : ""}`,
        ...ep.params.map((p) => `  #   ${p.in} ${p.name}: ${typeToString(p.type)}`),
        ...(ep.answers ?? []).map((a) => `  #   answers ${a.status}${a.type ? ` ${typeToString(a.type)}` : ""}`),
        ...effectLines(ep, "  #   "),
      ]),
      ...(c.contract.events ?? []).map((e) => `  # event ${e.name}: ${typeToString(e.type)}${e.note ? ` — ${e.note}` : ""}`),
    ]);
  if (app.design) {
    const d = app.design;
    block(["design", ...(d.look ? [`  look ${q(d.look)}`] : []), ...Object.entries(d.colors).map(([k, v]) => `  ${k}: ${v}`), ...(["font", "radius", "density"] as const).filter((k) => d[k]).map((k) => `  ${k}: ${d[k]}`)]);
  }
  // Look components only; behaviour components are already expanded into the app. A contract has none
  // of its own (the wire has no look): an imported bundle's are not the contract's.
  block(app.components.filter((c) => (c.look || c.base) && app.kind !== "contract").map((c) => `component ${c.name}${c.base ? ` as ${c.base}` : ""} ${q(c.look)}${origin(app, c.line)}`));
  const lengthRule = (r: NonNullable<App["refined"]>[number]) => (r.minLength !== undefined && r.maxLength !== undefined ? `of length ${r.minLength} to ${r.maxLength}` : r.maxLength !== undefined ? `of length at most ${r.maxLength}` : `of length at least ${r.minLength}`);
  // A code says its alphabet, and (as a note) how many values it has: what a draw is uniform over.
  const codeRule = (c: NonNullable<NonNullable<App["refined"]>[number]["code"]>) => `of ${c.n} ${c.alphabet === "from" ? `from ${q(c.chars)}` : c.alphabet}`;
  // A platform's functions; an app names the platforms it imports (their functions are the installation's).
  block((app.functions ?? []).map((f) => `function ${f.name}(${f.params.map((p) => `${p.name}: ${typeToString(p.type)}`).join(", ")}): ${typeToString(f.returns)}${origin(app, f.line, f.note)}`));
  block((app.platforms ?? []).map((p) => `import ${p.name}  # a platform: its functions are the installation's`));
  block((app.refined ?? []).map((r) => `type ${r.name} = ${r.base} ${r.code ? codeRule(r.code) : r.pattern !== undefined ? `matching /${r.pattern}/` : r.minLength !== undefined || r.maxLength !== undefined ? lengthRule(r) : [r.min !== undefined ? `from ${r.min}` : "", r.max !== undefined ? `to ${r.max}` : ""].filter(Boolean).join(" ")}${origin(app, r.line, r.code ? codeSize(r.code.n, r.code.chars) : undefined)}`));
  // `Size` comes from the `sizes` line, printed above.
  block(app.choices.filter((c) => !(app.sizes && c.name === "Size" && c.values.join() === app.sizes.join())).map((c) => `choice ${c.name}: ${c.values.map((v) => `${v}${c.labels[v] !== v ? ` ${q(c.labels[v])}` : ""}${c.wire?.[v] !== undefined ? ` = ${q(c.wire[v])}` : ""}`).join(" | ")}${origin(app, c.line)}`));
  for (const r of app.records) block([`record ${r.name}${origin(app, r.line)}`, ...r.fields.map((f) => `  ${r.key === f.name ? "key " : ""}${f.name}: ${typeToString(f.type)}${f.default ? ` = ${lit(f.default, "  ")}` : ""}${origin(app, 0, f.note)}`)]);
  if (app.kind === "layer") {
    block((app.params ?? []).map((f) => `param ${f.name}: ${typeToString(f.type)}${f.default ? ` = ${(Array.isArray(f.default) ? f.default : [f.default]).map((v) => lit(v, "")).join(", ")}` : ""}${origin(app, f.line, f.note)}`));
    block((app.provides ?? []).map((f) => `provides ${f.name}: ${typeToString(f.type)}${origin(app, f.line, f.note)}`));
    if (app.before) block(["before every request", ...body(app.before, "  ")]);
    if (app.after) block(["after every answer", ...body(app.after, "  ")]);
    if (app.beforeCall) block(["before every call", ...body(app.beforeCall, "  ")]);
    if (app.exampleConfig?.length) block(["examples with", ...app.exampleConfig.flatMap((b) => binding(b, "  "))]);
    if (app.actsAs) block([`acts as @caller with header @${app.actsAs.header} = the @${app.actsAs.secret} of the key in @${app.actsAs.list} whose @${app.actsAs.owner} is @caller  # how a test acts as a caller: the harness's, nothing to build`]);
  }
  block(app.state.length ? ["state", ...app.state.map((f) => `  ${f.stored ? "stored " : ""}${f.name}: ${typeToString(f.type)} = ${lit(f.default!, "  ")}${origin(app, f.line, f.note)}`)] : []);
  if (app.clockMs) block([`clock every ${app.clockMs}ms`]);
  block(app.derive.length ? ["derive", ...app.derive.map((d) => `  ${d.name}${d.type ? `: ${typeToString(d.type)}` : ""} = ${d.sentence}${origin(app, d.line, d.note)}`)] : []);
  if (app.screens?.length)
    for (const sc of app.screens)
      block([`screen ${sc.name} ${q(sc.path)}${origin(app, sc.line, sc.note)}`, ...sc.params.map((p) => `  path ${p.name}: ${typeToString(p.type)}`), ...app.screen.filter((e) => e.screen === sc.name).flatMap((e) => element(app, e, "  "))]);
  // A job's screen is the harness's (its state), never written: shown as a note for the reader.
  else if (app.profile === "job" && app.screen.length) block(["# The harness shows this job's state, as if it were this screen:", ...["screen", ...app.screen.flatMap((e) => element(app, e, "  "))].map((l) => `#   ${l}`)]);
  else if (app.screen.length) block(["screen", ...app.screen.flatMap((e) => element(app, e, "  "))]);
  block((app.everyAnswer ?? []).map((a) => `every endpoint answers ${a.status}${a.type ? ` ${typeToString(a.type)}` : ""}`));
  block((app.events ?? []).map((e) => `event ${e.name}: ${typeToString(e.type)}${origin(app, e.line, e.note)}`));
  // Access (v70): enforced by the harness before any endpoint runs; the endpoints never check it themselves.
  if (app.access)
    block([
      `access${origin(app, app.access.line, "enforced by the harness before the endpoint runs; default deny")}`,
      ...(app.access.roles ? [`  roles = ${app.access.roles.list}`] : []),
      ...app.access.rules.map((r) => `  - ${ruleText(r)}${origin(app, r.line)}`),
    ]);
  // Every status an endpoint may answer (its contract's, or its own `answers`), with the body's type.
  for (const ep of app.endpoints ?? [])
    block([
      `endpoint ${ep.name} ${ep.method} ${q(ep.path)}${origin(app, ep.line, ep.note)}`,
      ...ep.params.map((p) => `  ${p.in} ${p.name}: ${typeToString(p.type)}`),
      ...(ep.returns && app.kind !== "contract" ? [`  returns ${typeToString(ep.returns)}`] : []),
      ...(ep.answers ?? []).map((a) => `  answers ${a.status}${a.type ? ` ${typeToString(a.type)}` : ""}`),
      ...effectLines(ep, "  "),
      ...(app.kind === "contract" ? [] : body(ep, "  ", app)),
    ]);
  for (const j of app.jobs ?? []) block([`every ${j.name.slice(5)}`, ...body(j, "  ", app)]);
  for (const h of app.handlers) block([`on ${h.verb}${h.target ? ` ${h.target}` : ""}${origin(app, h.line, h.note)}`, ...body(h, "  ", app)]);
  // Rules in runs of one origin: `rules` (a person's) and `rules by ai`.
  for (let i = 0; i < app.rules.length; ) {
    const by = app.ruleBy?.[i] ?? "human";
    const run: string[] = [];
    for (; i < app.rules.length && (app.ruleBy?.[i] ?? "human") === by; i++) run.push(`  - ${app.rules[i]}`);
    block([by === "ai" ? "rules by ai" : "rules", ...run]);
  }
  block(app.always.length || app.invariants?.length ? ["always", ...app.always.map((s) => `  ${stepText(s)}${origin(app, s.line)}`), ...(app.invariants ?? []).map((i) => `  - ${i.text}${origin(app, i.line)}`)] : []);
  for (const ex of app.examples) block([`example ${q(ex.name)}`, ...ex.steps.map((s) => `  ${stepText(s)}`)]);
  // The canonical form has braces for blocks: what the compiler reads, and what `intent expand` shows.
  return toBraces(out.join("\n"));
}
