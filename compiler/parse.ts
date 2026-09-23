// Parser + checker for .intent files. Deterministic: same text in, same IR and diagnostics out.
import { expandUses } from "./expand.ts";
import { uiProfile, verbKinds } from "./profile.ts";
import { LINE_BASE } from "./ast.ts";
import type { Refinement } from "./refine.ts";
import type { App, Binding, Check, ChoiceDecl, Component, Diagnostic, Element, ElementKind, Endpoint, Example, Field, Handler, Literal, Param, RecordDecl, RefinedDecl, RowRef, Step, Type, Verb } from "./ast.ts";

interface Line {
  text: string;
  indent: number;
  line: number;
  children: Line[];
  note?: string; // an end-of-line `# comment`: kept as a note for readers (and the compiler)
}

const LOWER = "[a-z][A-Za-z0-9]*";
const UPPER = "[A-Z][A-Za-z0-9]*";
const STR = '"(?:[^"\\\\]|\\\\.)*"';

// Names that clash with Elm/TypeScript keywords or with names the generators emit.
export const RESERVED = new Set([
  // Elm
  "if", "then", "else", "case", "of", "let", "in", "type", "module", "where", "import", "exposing", "as", "port", "alias", "infix",
  // TypeScript / JS
  "break", "catch", "class", "const", "continue", "debugger", "default", "delete", "do", "enum", "export", "extends", "false", "finally",
  "for", "function", "instanceof", "new", "null", "return", "super", "switch", "this", "throw", "true", "try", "typeof", "var", "void",
  "while", "with", "yield", "let", "static", "implements", "interface", "package", "private", "protected", "public", "await", "async",
  // generated / runtime
  "key", // the row key in generated row types
  "Model", "Msg", "Screen", "Button", "LabeledButton", "Pick", "Node", "Wire", "Ui", "Fmt", "Spec", "App", "Main", "Worker", "Maybe",
  "List", "Text", "Int", "Decimal", "Bool", "String", "Float", "Just", "Nothing", "True", "False", "Tick", "Ok", "Err", "Result",
  "Html", "Sub", "Cmd", "Json", "Dict", "Set", "Array", "Char", "Basics", "Debug", "Platform", "Task", "Time", "Browser",
]);
// The element kinds and their presentations come from the UI profile (lib/profile/ui.intent),
// a spec in its own right: docs/design/profiles.md.
const PROFILE = uiProfile();
export const PRESENTATIONS: Record<ElementKind, string[]> = Object.fromEntries(
  PROFILE.elements.map((e) => [e.kind, e.presentations.map((x) => x.name)]),
) as Record<ElementKind, string[]>;
// Kinds the harness implements for every target; a profile element outside this set cannot be built yet.
const HARNESS_KINDS: ElementKind[] = ["heading", "text", "field", "button", "checkbox", "select", "list", "section", "progress", "use"];
for (const e of PROFILE.elements)
  if (!HARNESS_KINDS.includes(e.kind as ElementKind)) throw new Error(`the UI profile declares element \`${e.kind}\`, which the harness does not implement yet`);
const VERB_KINDS = verbKinds(PROFILE); // verb → element kind
const VERBS = Object.keys(VERB_KINDS).join("|");
const CLOCK_VERBS = PROFILE.clockVerbs.map((v) => v.name).join("|");

// Task is a very natural record name; allow it (Elm's Task module is not imported by generated code).
RESERVED.delete("Task");

type Err = (l: number, c: string, m: string, col?: number) => void;

interface Ctx {
  err: Err;
  warn: Err;
  pendingWaits: { step: { do: "tick"; times: number; line: number }; ms: number }[];
  clockLine: number;
}

const QN = `${LOWER}(?:\\.${LOWER}|\\[\\d+\\])*`; // a (possibly qualified) name: pager.next; in api examples a response path: createTicket.body.items[1].id
const BUNDLE_NAME = `${LOWER}(?:\\.${LOWER})*`;
const HEADER = "[a-z0-9][a-z0-9-]*"; // a header name, lower case: access-control-allow-origin

export const emptyApp = (): App => ({ name: "", components: [], purpose: [], records: [], choices: [], state: [], derive: [], screen: [], handlers: [], rules: [], examples: [], always: [] });

/**
 * Syntax only: the file's own declarations, imports and components, without resolving imports
 * and without semantic checks. `load.ts` resolves imports and expands components, then checks.
 */
export function parseSyntax(src: string): { app: App; diagnostics: Diagnostic[]; clockLine: number; language?: string; languageLine: number } {
  const diags: Diagnostic[] = [];
  const err: Err = (line, code, message, col = 1) => diags.push({ level: "error", code, line, col, message });
  const warn: Err = (line, code, message, col = 1) => diags.push({ level: "warning", code, line, col, message });
  const roots = buildLineTree(src, err);
  const app = emptyApp();
  app.imports = [];
  const ctx: Ctx = { err, warn, pendingWaits: [], clockLine: 0 };
  let language: string | undefined;
  let languageLine = 1;

  roots.forEach((node, i) => {
    const t = node.text;
    let m: RegExpMatchArray | null;
    if ((m = t.match(new RegExp(`^(app|bundle|contract|layer)\\s+(\\S+)$`)))) {
      if (i !== 0) err(node.line, "SYNTAX", `\`${m[1]}\` must be the first block`);
      if (app.name) err(node.line, "DUPLICATE", "only one `app` or `bundle` per file");
      const ok = m[1] === "app" ? new RegExp(`^${UPPER}$`).test(m[2]) : new RegExp(`^${BUNDLE_NAME}$`).test(m[2]);
      if (!ok) err(node.line, "SYNTAX", m[1] === "app" ? "an app name is UpperCamel: `app Helpdesk`" : `a ${m[1]} name is lower case with dots: \`${m[1]} std.list\``);
      app.kind = m[1] as "app" | "bundle" | "contract" | "layer";
      if (app.kind === "layer") app.profile = "api";
      app.name = m[2];
      for (const c of node.children) {
        const str = parseString(c.text);
        if (str === undefined || c.children.length) err(c.line, "SYNTAX", `the purpose of an ${m[1]} is one or more strings`, c.indent + 1);
        else app.purpose.push(str);
      }
    } else if ((m = t.match(new RegExp(`^import\\s+(${BUNDLE_NAME})(?:\\.(${UPPER}))?(?:\\s+as\\s+(${UPPER}))?$`)))) {
      if (m[3] && !m[2]) err(node.line, "SYNTAX", "`as` renames one imported name: `import std.list.Pager as TicketPager`");
      app.imports!.push({ bundle: m[1], name: m[2], alias: m[3], line: node.line });
    } else if ((m = t.match(new RegExp(`^uses\\s+(${BUNDLE_NAME})\\s+as\\s+(${LOWER})$`)))) {
      // A client of a contract; `tested with "<provider spec>"` names the implementation examples run against.
      let testedWith: string | undefined;
      for (const c of node.children) {
        const tm = c.text.match(new RegExp(`^tested\\s+with\\s+(${STR})$`));
        if (tm) testedWith = parseString(tm[1]);
        else err(c.line, "SYNTAX", 'under `uses`: `tested with "path/to/provider.intent"`', c.indent + 1);
      }
      (app.uses ??= []).push({ contract: m[1], alias: m[2], testedWith, line: node.line });
    } else if ((m = t.match(new RegExp(`^use\\s+(${LOWER})\\s*=\\s*(${LOWER}(?:\\.${LOWER})+)$`)))) {
      // An api app runs behind a layer: \`use cors = std.http.cors\`, params bound in indented lines.
      (app.layers ??= []).push({ alias: m[1], layer: m[2], bindings: node.children.map((c) => parseBinding(c, err)).filter((b): b is Binding => !!b), line: node.line });
    } else if (app.kind === "layer" && (m = t.match(new RegExp(`^param\\s+(${LOWER})\\s*:\\s*([^=]+?)\\s*(?:=\\s*(.+))?$`)))) {
      const f = parseField({ ...node, text: `${m[1]}: ${m[2]}` }, err, false);
      const def = m[3] !== undefined ? parseBinding({ ...node, text: `${m[1]} = ${m[3]}` }, err) : undefined;
      if (f) (app.params ??= []).push({ name: f.name, type: f.type, default: def?.value, line: node.line, note: node.note });
    } else if (app.kind === "layer" && t.startsWith("param")) {
      err(node.line, "SYNTAX", 'expected `param name: Type` or `param name: Type = default` (a list: `= "a", "b"`)');
    } else if (app.kind === "layer" && (m = t.match(/^provides\s+(.+)$/))) {
      const f = parseField({ ...node, text: m[1] }, err, false);
      if (f) (app.provides ??= []).push(f);
    } else if (app.kind === "layer" && /^before\s+every\s+request$/.test(t)) {
      if (app.before) err(node.line, "DUPLICATE", "one `before every request` per layer");
      app.before = { steps: parseBullets(node, err), line: node.line };
    } else if (app.kind === "layer" && /^after\s+every\s+answer$/.test(t)) {
      if (app.after) err(node.line, "DUPLICATE", "one `after every answer` per layer");
      app.after = { steps: parseBullets(node, err), line: node.line };
    } else if (app.kind === "layer" && /^examples\s+with$/.test(t)) {
      app.exampleConfig = node.children.map((c) => parseBinding(c, err)).filter((b): b is Binding => !!b);
    } else if ((m = t.match(new RegExp(`^implements\\s+(${BUNDLE_NAME})$`)))) {
      if (app.implements) err(node.line, "DUPLICATE", "an app implements one contract");
      app.implements = { name: m[1], line: node.line };
    } else if ((m = t.match(new RegExp(`^extends\\s+(${BUNDLE_NAME})$`)))) {
      if (app.extends) err(node.line, "DUPLICATE", "a spec extends at most one base (compose components for more)");
      app.extends = { name: m[1], line: node.line };
    } else if (t.startsWith("override ") || t.startsWith("add to ") || t.startsWith("drop ")) {
      const r = parseRefinement(node, ctx);
      if (r) (app.refinements ??= []).push(r);
    } else if ((m = t.match(/^profile\s+([a-z]+)$/))) {
      if (!["ui", "api"].includes(m[1])) err(node.line, "UNKNOWN_NAME", `no profile \`${m[1]}\` (ui, api)`);
      app.profile = m[1];
    } else if ((m = t.match(new RegExp(`^endpoint\\s+(${LOWER})\\s+(GET|POST|PUT|PATCH|DELETE)\\s+(${STR})$`)))) {
      app.endpoints ??= [];
      app.endpoints.push(parseEndpoint(node, m[1], m[2] as "GET", parseString(m[3])!, ctx));
    } else if ((m = t.match(new RegExp(`^endpoint\\s+(${LOWER})$`)))) {
      // In an app that implements a contract: the signature comes from the contract.
      app.endpoints ??= [];
      const ep = parseEndpoint(node, m[1], "GET", "", ctx);
      ep.signatureOnly = true;
      app.endpoints.push(ep);
    } else if (t.startsWith("endpoint")) {
      err(node.line, "SYNTAX", 'expected `endpoint name GET|POST|PUT|PATCH|DELETE "/path/{id}"`, or `endpoint name` when the app implements a contract');
    } else if ((m = t.match(/^language\s+(v\d+)$/))) {
      // The language version the spec was written for: the checker says when the language moved on.
      language = m[1];
      languageLine = node.line;
    } else if (t.startsWith("language")) {
      err(node.line, "SYNTAX", "expected `language v12`");
    } else if (t.startsWith("import")) {
      err(node.line, "SYNTAX", "expected `import std.list` or `import std.list.Pager [as Alias]`");
    } else if (!parseBlock(node, app, ctx, "top")) {
      const word = t.split(/\s+/)[0];
      const hint = suggest(word, ["app", "bundle", "contract", "implements", "uses", "import", "language", "profile", "endpoint", "extends", "override", "add", "drop", "design", "component", "record", "choice", "state", "clock", "derive", "screen", "on", "rules", "always", "example"]);
      err(node.line, "SYNTAX", `unknown block \`${word}\`${hint}`);
    }
  });

  if (!app.name) err(1, "SYNTAX", "a spec starts with `app Name` (or a library with `bundle name`)");
  if (app.kind === "bundle") {
    const behaviour = app.state.length || app.derive.length || app.screen.length || app.handlers.length || app.always.length || app.examples.length || app.rules.length;
    if (behaviour) err(1, "SYNTAX", "a bundle holds records, choices, components and a design; state, screens and behaviour go inside a component, examples in the bundle's demo app");
  }
  if (app.kind === "layer") {
    // A layer wraps every request of an api: no state, no endpoints, no screen.
    const other = app.state.length || app.derive.length || app.screen.length || app.handlers.length || app.components.length || app.endpoints?.length || app.layers?.length;
    if (other) err(1, "SYNTAX", "a layer holds records, choices, `param`, `provides`, `before every request`, `after every answer`, `examples with` and examples");
    if (!app.before && !app.after) err(1, "SYNTAX", "a layer needs `before every request` or `after every answer` (or both)");
  }
  if (app.kind === "contract") {
    // A contract says what goes over the wire, never how: types, endpoint signatures, answers, examples.
    const behaviour = app.state.length || app.derive.length || app.screen.length || app.handlers.length || app.components.length || app.rules.length;
    if (behaviour) err(1, "SYNTAX", "a contract holds records, choices, endpoint signatures (with `answers`) and examples; behaviour belongs in the app that `implements` it");
    for (const ep of app.endpoints ?? []) {
      if (ep.steps.length) err(ep.line, "SYNTAX", `endpoint ${ep.name}: a contract has no steps; the implementing app says what happens`);
      if (!ep.answers?.length) err(ep.line, "SYNTAX", `endpoint ${ep.name}: a contract lists every status it may answer (\`answers 200 Ticket\`)`);
    }
  }
  for (const w of ctx.pendingWaits) {
    if (!app.clockMs) continue; // reported by check()
    if (w.ms % app.clockMs !== 0) err(w.step.line, "STEP", `wait duration is not a whole number of clock ticks (${app.clockMs}ms)`);
    else w.step.times = w.ms / app.clockMs;
  }
  return { app, diagnostics: diags, clockLine: ctx.clockLine, language, languageLine };
}

/** One block (top level, or inside a component). Returns false when the line is not a block. */
function parseBlock(node: Line, app: App, ctx: Ctx, where: "top" | "component"): boolean {
  const { err } = ctx;
  const t = node.text;
  let m: RegExpMatchArray | null;
  const onlyTop = (what: string) => {
    if (where === "component") err(node.line, "SYNTAX", `\`${what}\` belongs at the top level, not inside a component`);
  };
  if ((m = t.match(new RegExp(`^type\\s+(${UPPER})\\s*=\\s*(Text|Int|Decimal)\\s+(.+)$`)))) {
    onlyTop("type");
    // A refined type: a base type with a rule. `matching /re/` for Text, `from a [to b]` / `to b` for numbers.
    const [, name, base, rule] = m;
    const r: RefinedDecl = { name, base: base as "Text", line: node.line };
    let rm: RegExpMatchArray | null;
    if (base === "Text" && (rm = rule.match(/^matching\s+\/(.+)\/$/))) {
      try {
        new RegExp(rm[1]);
        r.pattern = rm[1];
      } catch {
        err(node.line, "SYNTAX", `\`/${rm[1]}/\` is not a valid pattern`);
      }
    } else if (base !== "Text" && (rm = rule.match(/^(?:from\s+(-?\d+(?:\.\d+)?))?\s*(?:to\s+(-?\d+(?:\.\d+)?))?$/)) && (rm[1] || rm[2])) {
      if (rm[1]) r.min = Number(rm[1]);
      if (rm[2]) r.max = Number(rm[2]);
    } else {
      err(node.line, "SYNTAX", base === "Text" ? "a refined text looks like `type Email = Text matching /…/`" : `a refined number looks like \`type Age = ${base} from 0 to 150\``);
      return true;
    }
    (app.refined ??= []).push(r);
  } else if ((m = t.match(new RegExp(`^record\\s+(${UPPER})$`)))) {
    onlyTop("record");
    const rec: RecordDecl = { name: m[1], fields: [], line: node.line };
    for (const c of node.children) {
      const f = parseField(c, err, false);
      if (f) rec.fields.push(f);
    }
    if (!rec.fields.length) err(node.line, "SYNTAX", `record ${rec.name} has no fields`);
    app.records.push(rec);
  } else if ((m = t.match(new RegExp(`^choice\\s+(${UPPER})\\s*(?::\\s*(.*))?$`)))) {
    onlyTop("choice");
    // Values, each optionally with a display label: `choice Filter: All "Everything" | Open`.
    const values: string[] = [];
    const labels: Record<string, string> = {};
    const addValue = (raw: string, line: number, col = 1) => {
      const vm = raw.trim().match(new RegExp(`^(${UPPER})(?:\\s+(${STR}))?$`));
      if (!vm) return err(line, "SYNTAX", `choice value \`${raw.trim()}\` must be an UpperCamel name, optionally followed by a "label"`, col);
      values.push(vm[1]);
      labels[vm[1]] = vm[2] !== undefined ? parseString(vm[2])! : vm[1];
    };
    if (m[2] !== undefined && m[2].trim()) for (const v of splitCells(m[2])) addValue(v, node.line);
    for (const c of node.children) addValue(c.text, c.line, c.indent + 1);
    if (values.length < 2) err(node.line, "SYNTAX", `choice ${m[1]} needs at least two values, e.g. \`choice ${m[1]}: A | B\``);
    app.choices.push({ name: m[1], values, labels, line: node.line });
  } else if (t === "design") {
    onlyTop("design");
    app.design = parseDesign(node, err);
  } else if ((m = t.match(new RegExp(`^component\\s+(${UPPER})(?:\\s+as\\s+([a-z]+))?(?:\\s+(${STR}))?$`)))) {
    onlyTop("component");
    app.components.push(parseComponent(node, m[1], m[2], m[3], ctx));
  } else if (t === "state") {
    for (const c of node.children) {
      const f = parseField(c, err, true);
      if (f) app.state.push(f);
    }
  } else if ((m = t.match(/^clock\s+every\s+(\S+)$/))) {
    onlyTop("clock");
    const ms = parseDuration(m[1]);
    if (ms === undefined || ms <= 0) err(node.line, "SYNTAX", "expected a duration such as `1s`, `250ms` or `2m`");
    else app.clockMs = ms;
    ctx.clockLine = node.line;
  } else if (t === "derive") {
    for (const c of node.children) {
      const dm = c.text.match(new RegExp(`^(${LOWER})\\s*=\\s*(.+)$`));
      if (!dm) err(c.line, "SYNTAX", "a derived value looks like `name = sentence`", c.indent + 1);
      else app.derive.push({ name: dm[1], sentence: dm[2] + flattenChildren(c), line: c.line, note: c.note });
    }
  } else if (t === "screen") {
    app.screen = node.children.map((c) => parseElement(c, err, false)).filter((e): e is Element => !!e);
  } else if ((m = t.match(new RegExp(`^on\\s+(${VERBS}|answer)\\s+(${QN})$`))) || (m = t.match(new RegExp(`^on\\s+(${CLOCK_VERBS}|start)$`)))) {
    const h: Handler = { verb: m[1] as Verb, target: m[2] ?? "", steps: parseBullets(node, err), line: node.line, note: node.note };
    app.handlers.push(h);
  } else if (t.startsWith("on ")) {
    err(node.line, "SYNTAX", `expected \`on ${VERBS} <element>\` or \`on ${CLOCK_VERBS}\``);
  } else if (t === "always") {
    for (const c of node.children) {
      const r = parseStep(c, err, where === "component");
      if (!r) continue;
      if (r.step.do !== "see") err(c.line, "SYNTAX", "`always` holds only `see` checks", c.indent + 1);
      else if (r.step.at) err(c.line, "SYNTAX", "`always` checks cannot point at a row", c.indent + 1);
      else app.always.push(r.step);
    }
    if (!node.children.length) err(node.line, "SYNTAX", "expected indented `see …` checks");
  } else if (t === "rules") {
    app.rules.push(...parseBullets(node, err));
  } else if ((m = t.match(new RegExp(`^example\\s+(${STR})$`)))) {
    if (where === "component") err(node.line, "NOT_YET", "examples inside a component are not in the language yet; prove a component with examples in its bundle's demo app");
    const ex: Example = { name: parseString(m[1])!, steps: [], line: node.line };
    for (const c of node.children) {
      const st = parseStep(c, err);
      if (st) {
        ex.steps.push(st.step);
        if (st.waitMs !== undefined) ctx.pendingWaits.push({ step: st.step as any, ms: st.waitMs });
      }
    }
    app.examples.push(ex);
  } else return false;
  return true;
}

/** `endpoint name METHOD "/path/{id}"` with `path|query|body x: Type`, `returns T` and `- steps`. */
function parseEndpoint(node: Line, name: string, method: Endpoint["method"], path: string, ctx: Ctx): Endpoint {
  const { err } = ctx;
  const ep: Endpoint = { name, method, path, params: [], steps: [], line: node.line, note: node.note };
  for (const c of node.children) {
    let m: RegExpMatchArray | null;
    if ((m = c.text.match(new RegExp(`^(path|query|body)\\s+(${LOWER})\\s*:\\s*(.+)$`)))) {
      const type = parseType(m[3]);
      if (!type) err(c.line, "SYNTAX", `\`${m[3]}\` is not a type`, c.indent + 1);
      else ep.params.push({ in: m[1] as "path", name: m[2], type, line: c.line });
    } else if ((m = c.text.match(/^answers\s+([1-5]\d\d)(?:\s+(.+))?$/))) {
      const type = m[2] ? parseType(m[2]) : undefined;
      if (m[2] && !type) err(c.line, "SYNTAX", `\`${m[2]}\` is not a type`, c.indent + 1);
      (ep.answers ??= []).push({ status: Number(m[1]), type, line: c.line });
    } else if ((m = c.text.match(/^returns\s+(.+)$/))) {
      const type = parseType(m[1]);
      if (!type) err(c.line, "SYNTAX", `\`${m[1]}\` is not a type`, c.indent + 1);
      else ep.returns = type;
    } else if (c.text.startsWith("- ")) ep.steps.push((c.text.slice(2) + flattenChildren(c)).trim());
    else err(c.line, "SYNTAX", "inside an endpoint: `path|query|body name: Type`, `returns Type`, `answers 201 Type`, or `- step`", c.indent + 1);
  }
  return ep;
}

/** `override …`, `add to <section> [after <element>]`, `drop …`: the explicit changes of a refining spec. */
function parseRefinement(node: Line, ctx: Ctx): Refinement | undefined {
  const { err } = ctx;
  const t = node.text;
  let m: RegExpMatchArray | null;
  if ((m = t.match(/^override\s+(heading|text|field|button|checkbox|select|list|section|progress|use)\s/))) {
    const el = parseElement({ ...node, text: t.slice("override ".length) }, err, false);
    return el && { op: "override-element", element: el, line: node.line };
  }
  if (t === "override derive") {
    const c = node.children[0];
    const dm = c?.text.match(new RegExp(`^(${LOWER})\\s*=\\s*(.+)$`));
    if (!dm || node.children.length !== 1) return void err(node.line, "SYNTAX", "`override derive` holds exactly one indented `name = sentence`");
    return { op: "override-derive", name: dm[1], sentence: dm[2] + flattenChildren(c), note: c.note, line: c.line };
  }
  if (t === "override state") {
    const c = node.children[0];
    const f = c && node.children.length === 1 ? parseField(c, err, true) : undefined;
    if (!f) return void err(node.line, "SYNTAX", "`override state` holds exactly one indented `name: Type = default`");
    return { op: "override-state", field: f, line: c.line };
  }
  if ((m = t.match(new RegExp(`^override\\s+on\\s+(${VERBS})\\s+(${QN})$`)))) {
    return { op: "override-handler", handler: { verb: m[1] as Verb, target: m[2], steps: parseBullets(node, err), line: node.line, note: node.note }, line: node.line };
  }
  if ((m = t.match(new RegExp(`^override\\s+component\\s+(${UPPER})(?:\\s+as\\s+([a-z]+))?(?:\\s+(${STR}))?$`)))) {
    return { op: "override-component", component: parseComponent(node, m[1], m[2], m[3], ctx), line: node.line };
  }
  if ((m = t.match(new RegExp(`^add\\s+to\\s+(${QN})(?:\\s+after\\s+(${QN}))?$`)))) {
    const elements = node.children.map((c) => parseElement(c, err, false)).filter((e): e is Element => !!e);
    if (!elements.length) err(node.line, "SYNTAX", "`add to …` needs indented elements");
    return { op: "add-elements", into: m[1], after: m[2], elements, line: node.line };
  }
  if ((m = t.match(new RegExp(`^drop\\s+element\\s+(${QN})$`)))) return { op: "drop-element", name: m[1], line: node.line };
  if ((m = t.match(new RegExp(`^drop\\s+example\\s+(${STR})$`)))) return { op: "drop-example", name: parseString(m[1])!, line: node.line };
  if ((m = t.match(new RegExp(`^drop\\s+on\\s+(${VERBS})\\s+(${QN})$`)))) return { op: "drop-handler", verb: m[1], target: m[2], line: node.line };
  err(node.line, "SYNTAX", 'expected `override <element|derive|state|on …|component> …`, `add to <section> [after <element>]`, or `drop element x | drop example "…" | drop on click x`');
}

/**
 * `component Name [as base] ["look"]`. A component with only a look styles elements (`… as Name`).
 * With `param`s and blocks it is a behaviour component, instantiated by `use x = Name`.
 */
function parseComponent(node: Line, name: string, base: string | undefined, lookStr: string | undefined, ctx: Ctx): Component {
  const { err } = ctx;
  const looks = [lookStr ? parseString(lookStr)! : ""];
  const params: Param[] = [];
  const body = emptyApp();
  let hasBody = false;
  for (const c of node.children) {
    let m: RegExpMatchArray | null;
    const str = parseString(c.text);
    if (str !== undefined) looks.push(str);
    else if ((m = c.text.match(new RegExp(`^param\\s+(${LOWER})(?:\\s+(${STR}))?(?:\\s*=\\s*(.+))?$`)))) {
      if (params.some((p) => p.name === m![1])) err(c.line, "DUPLICATE", `param \`${m[1]}\` is declared twice`, c.indent + 1);
      params.push({ name: m[1], doc: m[2] ? parseString(m[2]) : undefined, default: m[3]?.trim(), line: c.line });
    } else if (parseBlock(c, body, ctx, "component")) hasBody = true;
    else err(c.line, "SYNTAX", 'inside a component: a "look" string, `param name`, or a block (state, derive, screen, on, always, rules)', c.indent + 1);
  }
  const look = looks.filter(Boolean).join(" ");
  if (!look && !hasBody) err(node.line, "SYNTAX", `component ${name} needs a look: \`component ${name} "…"\`, or behaviour blocks`);
  if (base && !Object.values(PRESENTATIONS).some((ps) => ps.includes(base))) err(node.line, "UNKNOWN_NAME", `\`${base}\` is not a built-in presentation`);
  if (hasBody && !body.screen.length) err(node.line, "SYNTAX", `component ${name} has behaviour but no \`screen\``);
  return { name, base, look, line: node.line, params: hasBody ? params : undefined, body: hasBody ? body : undefined };
}

/** Parse and check a self-contained file (no imports). Files with imports go through `load()`. */
export function parse(src: string): { app?: App; diagnostics: Diagnostic[] } {
  const { app, diagnostics, clockLine } = parseSyntax(src);
  const err: Err = (line, code, message, col = 1) => diagnostics.push({ level: "error", code, line, col, message });
  const warn: Err = (line, code, message, col = 1) => diagnostics.push({ level: "warning", code, line, col, message });
  if (app.imports?.length) err(app.imports[0].line, "SYNTAX", "this file imports bundles; check it with `intent check` (which resolves imports), not `parse()`");
  // Semantic checks run even after syntax errors, so one pass reports as much as possible.
  else if (app.name && app.kind !== "bundle") {
    const used = expandUses(app, err, warn);
    check(app, err, warn, clockLine, used);
  }
  diagnostics.sort((a, b) => a.line - b.line || a.col - b.col);
  return { app: diagnostics.some((d) => d.level === "error") ? undefined : app, diagnostics };
}

/** Semantic checks on a complete (expanded) app. */
export function checkApp(app: App, clockLine: number, used = new Set<string>()): Diagnostic[] {
  const diags: Diagnostic[] = [];
  const err: Err = (line, code, message, col = 1) => diags.push({ level: "error", code, line, col, message });
  const warn: Err = (line, code, message, col = 1) => diags.push({ level: "warning", code, line, col, message });
  check(app, err, warn, clockLine, used);
  return diags;
}

// ---------------------------------------------------------------- lines

function buildLineTree(src: string, err: (l: number, c: string, m: string, col?: number) => void): Line[] {
  const roots: Line[] = [];
  const stack: Line[] = [];
  src.split(/\r?\n/).forEach((raw, idx) => {
    const lineNo = idx + 1;
    if (raw.includes("\t")) {
      err(lineNo, "INDENT", "tabs are not allowed; indent with 2 spaces");
      return;
    }
    const text = stripComment(raw).trimEnd();
    if (!text.trim()) return;
    const indent = text.length - text.trimStart().length;
    const note = raw.slice(stripComment(raw).length).replace(/^#\s*/, "").trim() || undefined;
    const node: Line = { text: text.trim(), indent, line: lineNo, children: [], note };
    if (indent % 2 !== 0) {
      err(lineNo, "INDENT", "indentation must be a multiple of 2 spaces", indent + 1);
      return;
    }
    while (stack.length && stack[stack.length - 1].indent >= indent) stack.pop();
    if (!stack.length) {
      if (indent !== 0) err(lineNo, "INDENT", "top-level blocks start at column 1", indent + 1);
      roots.push(node);
    } else {
      const parent = stack[stack.length - 1];
      if (indent !== parent.indent + 2) err(lineNo, "INDENT", `expected ${parent.indent + 2} spaces of indentation`, indent + 1);
      parent.children.push(node);
    }
    stack.push(node);
  });
  return roots;
}

function stripComment(s: string): string {
  let inStr = false;
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (inStr && c === "\\") i++;
    else if (c === '"') inStr = !inStr;
    else if (c === "#" && !inStr) return s.slice(0, i);
  }
  return s;
}

function flattenChildren(n: Line): string {
  return n.children.map((c) => " " + c.text + flattenChildren(c)).join("");
}

function parseBullets(node: Line, err: (l: number, c: string, m: string, col?: number) => void): string[] {
  const out: string[] = [];
  for (const c of node.children) {
    if (!c.text.startsWith("- ")) err(c.line, "SYNTAX", "each step is a line starting with `- `", c.indent + 1);
    else out.push((c.text.slice(2) + flattenChildren(c)).trim());
  }
  if (!out.length) err(node.line, "SYNTAX", "expected at least one `- sentence` line");
  return out;
}

// ---------------------------------------------------------------- pieces

export function parseString(s: string): string | undefined {
  if (!new RegExp(`^${STR}$`).test(s)) return undefined;
  return s.slice(1, -1).replace(/\\(.)/g, "$1");
}

function parseDuration(s: string): number | undefined {
  const m = s.match(/^(\d+)(ms|s|m|h)$/);
  if (!m) return undefined;
  return Number(m[1]) * { ms: 1, s: 1000, m: 60000, h: 3600000 }[m[2] as "ms"];
}

function parseType(s: string): Type | undefined {
  s = s.trim();
  let m: RegExpMatchArray | null;
  if ((m = s.match(/^List\s+(.+)$/))) {
    const of = parseType(m[1]);
    return of && { k: "List", of };
  }
  if ((m = s.match(/^Maybe\s+(.+)$/))) {
    const of = parseType(m[1]);
    return of && { k: "Maybe", of };
  }
  if (s === "Text" || s === "Int" || s === "Decimal" || s === "Bool") return { k: s };
  if (new RegExp(`^${UPPER}$`).test(s)) return { k: "Named", name: s };
  return undefined;
}

export function typeToString(t: Type): string {
  switch (t.k) {
    case "List": return `List ${typeToString(t.of)}`;
    case "Maybe": return `Maybe ${typeToString(t.of)}`;
    case "Named": return t.name;
    default: return t.k;
  }
}

function parseLiteral(s: string): Literal | undefined {
  s = s.trim();
  const str = parseString(s);
  if (str !== undefined) return { k: "text", v: str };
  if (/^-?\d+(\.\d+)?$/.test(s)) return { k: "number", v: Number(s), raw: s };
  if (s === "true" || s === "false") return { k: "bool", v: s === "true" };
  if (s === "[]") return { k: "emptyList" };
  if (s === "nothing") return { k: "nothing" };
  if (new RegExp(`^${UPPER}$`).test(s)) return { k: "value", v: s };
  return undefined;
}

function parseField(c: Line, err: (l: number, c: string, m: string, col?: number) => void, needDefault: boolean): Field | undefined {
  const m = c.text.match(new RegExp(`^(${LOWER})\\s*:\\s*([^=]+?)\\s*(?:=\\s*(.+))?$`));
  if (!m) {
    err(c.line, "SYNTAX", "a field looks like `name: Type` or `name: Type = default`", c.indent + 1);
    return;
  }
  const type = parseType(m[2]);
  if (!type) {
    err(c.line, "SYNTAX", `\`${m[2]}\` is not a type (Text, Int, Decimal, Bool, List T, Maybe T, or a record/choice name)`, c.indent + 1);
    return;
  }
  let def: Literal | undefined;
  if (m[3]?.trim() === "table") {
    def = parseTable(c, err);
  } else if (m[3] !== undefined) {
    def = parseLiteral(m[3]);
    if (!def) err(c.line, "SYNTAX", `\`${m[3]}\` is not a literal`, c.indent + 1);
  } else if (needDefault) {
    err(c.line, "SYNTAX", `state field \`${m[1]}\` needs a default: \`${m[1]}: ${m[2]} = …\``, c.indent + 1);
  }
  if (c.children.length && def?.k !== "table") err(c.children[0].line, "INDENT", "a field has no indented lines");
  return { name: m[1], type, default: def, line: c.line, note: c.note };
}

// `= table` followed by a header row and data rows, cells separated by `|`.
function parseTable(c: Line, err: (l: number, c: string, m: string, col?: number) => void): Literal | undefined {
  if (!c.children.length) {
    err(c.line, "SYNTAX", "`table` needs a header row and data rows, indented below it", c.indent + 1);
    return;
  }
  const [head, ...body] = c.children;
  const columns = splitCells(head.text);
  for (const col of columns) if (!new RegExp(`^${LOWER}$`).test(col)) err(head.line, "SYNTAX", `table header \`${col}\` must be a field name`, head.indent + 1);
  const rows: Literal[][] = [];
  for (const r of body) {
    const cells = splitCells(r.text);
    if (cells.length !== columns.length) {
      err(r.line, "SYNTAX", `this row has ${cells.length} cells; the header has ${columns.length}`, r.indent + 1);
      continue;
    }
    const lits = cells.map((cell) => parseLiteral(cell));
    const bad = lits.findIndex((l) => !l);
    if (bad >= 0) err(r.line, "SYNTAX", `\`${cells[bad]}\` is not a literal`, r.indent + 1);
    else rows.push(lits as Literal[]);
  }
  return { k: "table", columns, rows };
}

/** A param binding: \`origins = "https://a.example", "https://b.example"\`, \`size = 5\`, or \`keys = table\` with rows. */
function parseBinding(c: Line, err: (l: number, c: string, m: string, col?: number) => void): Binding | undefined {
  const m = c.text.match(new RegExp(`^(${LOWER})\\s*=\\s*(.+)$`));
  if (!m) {
    err(c.line, "SYNTAX", "a binding looks like `name = value` (a literal, literals separated by commas, or `table`)", c.indent + 1);
    return;
  }
  if (m[2].trim() === "table") {
    const t = parseTable(c, err);
    return t && { name: m[1], value: t, line: c.line };
  }
  if (c.children.length) err(c.children[0].line, "INDENT", "a binding has no indented lines (except a `table`)");
  const parts = splitArgs(m[2]).map((p) => parseLiteral(p));
  if (parts.some((p) => !p) || !parts.length) {
    err(c.line, "SYNTAX", `\`${m[2]}\` is not a literal or a list of literals`, c.indent + 1);
    return;
  }
  return { name: m[1], value: parts.length === 1 ? parts[0]! : (parts as Literal[]), line: c.line };
}

/** Split `a = 1, b = "x, y"` at commas outside strings. */
function splitArgs(s: string): string[] {
  return splitCells(s.replace(/,(?=(?:[^"]*"[^"]*")*[^"]*$)/g, "|")).filter(Boolean);
}

function splitCells(line: string): string[] {
  const cells: string[] = [];
  let cur = "";
  let inStr = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (inStr && ch === "\\") {
      cur += ch + line[++i];
      continue;
    }
    if (ch === '"') inStr = !inStr;
    if (ch === "|" && !inStr) {
      cells.push(cur.trim());
      cur = "";
    } else cur += ch;
  }
  cells.push(cur.trim());
  return cells;
}

const ELEMENT_KINDS = PROFILE.elements.map((e) => e.kind) as ElementKind[];



export const COLOR_ROLES = ["brand", "neutral", "accent", "success", "warning", "danger", "info"];
export const PALETTES = ["slate", "gray", "zinc", "neutral", "stone", "red", "orange", "amber", "yellow", "lime", "green", "emerald", "teal", "cyan", "sky", "blue", "indigo", "violet", "purple", "fuchsia", "pink", "rose"];
const DESIGN_KEYS: Record<string, string[]> = {
  font: ["sans", "serif", "mono"],
  radius: ["none", "small", "medium", "large", "xl", "full"],
  density: ["compact", "comfortable", "spacious"],
};

function parseDesign(node: Line, err: (l: number, c: string, m: string, col?: number) => void) {
  const d: { look?: string; colors: Record<string, string>; font?: string; radius?: string; density?: string } = { colors: {} };
  for (const c of node.children) {
    let m: RegExpMatchArray | null;
    if ((m = c.text.match(new RegExp(`^look\\s+(${STR})$`)))) d.look = [d.look, parseString(m[1])].filter(Boolean).join(" ");
    else if ((m = c.text.match(/^([a-z]+)\s*:\s*([a-z]+)$/))) {
      const [, key, value] = m;
      if (COLOR_ROLES.includes(key)) {
        if (!PALETTES.includes(value)) err(c.line, "UNKNOWN_NAME", `\`${value}\` is not a palette${suggest(value, PALETTES)} (${PALETTES.join(", ")})`, c.indent + 1);
        d.colors[key] = value;
      } else if (DESIGN_KEYS[key]) {
        if (!DESIGN_KEYS[key].includes(value)) err(c.line, "UNKNOWN_NAME", `${key} is one of ${DESIGN_KEYS[key].join(", ")}`, c.indent + 1);
        (d as any)[key] = value;
      } else err(c.line, "UNKNOWN_NAME", `unknown design setting \`${key}\`${suggest(key, [...COLOR_ROLES, ...Object.keys(DESIGN_KEYS)])}`, c.indent + 1);
    } else err(c.line, "SYNTAX", 'a design line is `look "…"`, `<role>: <palette>` (brand: indigo), `font: sans`, `radius: large` or `density: compact`', c.indent + 1);
  }
  return d;
}

function parseElement(c: Line, err: (l: number, c: string, m: string, col?: number) => void, inList: boolean): Element | undefined {
  const t = c.text;
  const kw = t.split(/\s+/)[0];
  const col = c.indent + 1;
  if (!ELEMENT_KINDS.includes(kw as ElementKind)) {
    err(c.line, "SYNTAX", `unknown element \`${kw}\`${suggest(kw, ELEMENT_KINDS)}`, col);
    return;
  }
  const kind = kw as ElementKind;
  const el: Element = { kind, name: "", children: [], line: c.line, note: c.note };
  if (kind === "use") {
    // `use pager = Pager` with indented `param = value` bindings.
    const um = t.match(new RegExp(`^use\\s+(${LOWER})\\s*=\\s*(${UPPER})$`));
    if (!um) {
      err(c.line, "SYNTAX", "expected `use name = Component`", col);
      return;
    }
    el.name = um[1];
    el.component = um[2];
    el.bindings = [];
    for (const k of c.children) {
      let vm: RegExpMatchArray | null;
      if ((vm = k.text.match(/^visible\s+when\s+(.+)$/))) el.visibleWhen = vm[1] + flattenChildren(k);
      else if ((vm = k.text.match(new RegExp(`^look\\s+(${STR})$`)))) el.look = parseString(vm[1]);
      else if ((vm = k.text.match(new RegExp(`^(${LOWER})\\s*=\\s*(.+)$`)))) el.bindings.push({ name: vm[1], value: (vm[2] + flattenChildren(k)).trim(), line: k.line });
      else err(k.line, "SYNTAX", "under `use`: `param = value`, `visible when …` or `look \"…\"`", k.indent + 1);
    }
    return el;
  }
  let rest = t.slice(kw.length).trim();
  // `… as <presentation>`: only a known presentation or an UpperCamel component name counts,
  // so sentences like `= price as money` keep their words.
  const asMatch = rest.match(/\s+as\s+([A-Za-z][A-Za-z0-9]*)$/);
  if (asMatch && (PRESENTATIONS[kind].includes(asMatch[1]) || /^[A-Z]/.test(asMatch[1]))) {
    el.as = asMatch[1];
    rest = rest.slice(0, asMatch.index).trim();
  }
  let m: RegExpMatchArray | null;
  if (kind === "heading") {
    const s = parseString(rest);
    if (s === undefined) err(c.line, "SYNTAX", 'a heading looks like `heading "Text"`', col);
    el.label = s ?? "";
  } else if (kind === "list") {
    m = rest.match(new RegExp(`^(${LOWER})\\s+of\\s+(${UPPER})(?:\\s*=\\s*(.+))?$`));
    if (!m) {
      err(c.line, "SYNTAX", "a list looks like `list name of Type` or `list name of Type = sentence`", col);
      return;
    }
    el.name = m[1];
    el.of = m[2];
    el.expr = m[3];
  } else if (kind === "select" && (m = rest.match(new RegExp(`^(${LOWER})(?:\\s+(${STR}))?\\s+from\\s+(${LOWER})\\.(${LOWER})$`)))) {
    el.name = m[1];
    el.label = m[2] !== undefined ? parseString(m[2]) : undefined;
    el.from = { list: m[3], field: m[4] };
  } else {
    m = rest.match(new RegExp(`^(${LOWER})(?:\\s+(${STR}))?(?:\\s*=\\s*(.+))?$`));
    if (!m) {
      err(c.line, "SYNTAX", `expected \`${kind} name${kind === "text" ? " [= value]" : ' "Label"'}\``, col);
      return;
    }
    el.name = m[1];
    if (m[2] !== undefined) el.label = parseString(m[2]);
    if (m[3] !== undefined) el.expr = m[3].trim();
    if (m[2] !== undefined && m[3] !== undefined && kind !== "progress") err(c.line, "SYNTAX", "give either a label or `= value`, not both", col);
    if (m[3] !== undefined && !(kind === "text" || kind === "button" || kind === "progress")) err(c.line, "SYNTAX", `\`= …\` is not allowed on a ${kind}; it edits state \`${el.name}\``, col);
    if (m[2] !== undefined && kind === "text") err(c.line, "SYNTAX", 'a text shows a value: `text name` or `text name = "template"`', col);
    if (kind === "button" && m[2] === undefined && m[3] === undefined) err(c.line, "SYNTAX", 'a button needs a label: `button name "Label"`', col);
    if (kind === "field" && el.label === undefined) el.label = "";
  }

  for (const k of c.children) {
    let mm: RegExpMatchArray | null;
    if ((mm = k.text.match(/^visible\s+when\s+(.+)$/))) el.visibleWhen = mm[1] + flattenChildren(k);
    else if ((mm = k.text.match(new RegExp(`^look\\s+(${STR})$`)))) el.look = [el.look, parseString(mm[1])].filter(Boolean).join(" ");
    else if ((mm = k.text.match(/^as\s+([A-Za-z][A-Za-z0-9]*)$/))) el.as = mm[1]; // for long `= …` lines
    else if ((mm = k.text.match(/^enabled\s+when\s+(.+)$/))) {
      if (kind !== "button") err(k.line, "SYNTAX", "`enabled when` is only for buttons", k.indent + 1);
      el.enabledWhen = mm[1] + flattenChildren(k);
    } else if (kind === "list" || kind === "section") {
      if ((kind === "list" || inList) && k.text.split(/\s+/)[0] === "list") {
        err(k.line, "NOT_YET", "a list inside a list row is not in the language yet", k.indent + 1);
        continue;
      }
      const child = parseElement(k, err, inList || kind === "list");
      if (child) el.children.push(child);
    } else {
      err(k.line, "SYNTAX", 'expected `visible when …`, `enabled when …` or `look "…"`', k.indent + 1);
    }
  }
  if (kind === "list" && !el.children.some((e) => e.kind !== "heading")) err(c.line, "SYNTAX", "a list needs row elements, indented under it", col);
  if (kind === "field" && inList) err(c.line, "NOT_YET", "a field inside a list row is not in the language yet", col);
  if (kind === "select" && inList) err(c.line, "NOT_YET", "a select inside a list row is not in the language yet", col);
  return el;
}

function parseStep(c: Line, err: (l: number, c: string, m: string, col?: number) => void, inComponent = false): { step: Step; waitMs?: number } | undefined {
  const t = c.text;
  const line = c.line;
  const col = c.indent + 1;
  if (c.children.length) err(c.children[0].line, "INDENT", "example steps have no indented lines");
  const ROW = `(?:\\s+on\\s+row\\s+(\\d+|with\\s+${STR})(?:\\s+of\\s+(${QN}))?)?`;
  const at = (n?: string, list?: string): RowRef | undefined =>
    !n ? undefined : n.startsWith("with") ? { row: 0, with: parseString(n.replace(/^with\s+/, "")), list } : { row: Number(n), list };
  let m: RegExpMatchArray | null;
  if ((m = t.match(new RegExp(`^type\\s+(${STR})\\s+into\\s+(${QN})$`)))) return { step: { do: "type", text: parseString(m[1])!, target: m[2], line } };
  if ((m = t.match(new RegExp(`^(click|toggle)\\s+(${QN})${ROW}$`)))) return { step: { do: m[1] as "click", target: m[2], at: at(m[3], m[4]), line } };
  if ((m = t.match(new RegExp(`^choose\\s+(${UPPER})\\s+in\\s+(${QN})$`)))) return { step: { do: "choose", value: m[1], target: m[2], line } };
  if ((m = t.match(new RegExp(`^choose\\s+(${STR})\\s+in\\s+(${QN})$`)))) return { step: { do: "choose", value: parseString(m[1])!, target: m[2], line, quoted: true } };
  if ((m = t.match(new RegExp(`^snapshot\\s+(${STR})$`)))) return { step: { do: "snapshot", name: parseString(m[1])!, line } };
  // api profile: `call createTicket with subject = "Printer", priority = Urgent`
  if ((m = t.match(new RegExp(`^call\\s+(${LOWER})(?:\\s+with\\s+(.+))?$`)))) {
    const args: { name: string; value: Literal }[] = [];
    const headers: { name: string; value: Literal }[] = [];
    for (const part of m[2] ? splitArgs(m[2]) : []) {
      const hm = part.match(new RegExp(`^header\\s+(${HEADER})\\s*=\\s*(.+)$`));
      if (hm) {
        const v = parseLiteral(hm[2]);
        if (!v) err(line, "SYNTAX", `\`${hm[2]}\` is not a literal`, col);
        else headers.push({ name: hm[1], value: v });
        continue;
      }
      const am = part.match(new RegExp(`^(${LOWER})\\s*=\\s*(.+)$`));
      // `{createTicket.body.id}`: a value from an earlier answer (kept as a text literal holding the reference).
      const lit = am && (/^\{[a-z][\w.[\]]*\}$/i.test(am[2].trim()) ? ({ k: "text", v: am[2].trim() } as Literal) : parseLiteral(am[2]));
      if (!am || !lit) err(line, "SYNTAX", `\`${part}\` is not \`name = value\``, col);
      else args.push({ name: am[1], value: lit });
    }
    return { step: { do: "call", endpoint: m[1], args, ...(headers.length ? { headers } : {}), line } };
  }
  // A raw request: \`request OPTIONS "/tickets" with header origin = "https://a.example", query status = Open\`.
  if ((m = t.match(new RegExp(`^request\\s+(GET|POST|PUT|PATCH|DELETE|OPTIONS|HEAD)\\s+(${STR})(?:\\s+with\\s+(.+))?$`)))) {
    const args: { in: "header" | "query" | "body"; name: string; value: Literal }[] = [];
    for (const part of m[3] ? splitArgs(m[3]) : []) {
      const am = part.match(new RegExp(`^(header|query|body)\\s+(${HEADER})\\s*=\\s*(.+)$`));
      const v = am && parseLiteral(am[3]);
      if (!am || !v) err(line, "SYNTAX", `\`${part}\` is not \`header|query|body name = value\``, col);
      else args.push({ in: am[1] as "header", name: am[2], value: v });
    }
    return { step: { do: "request", method: m[1], path: parseString(m[2])!, args, line } };
  }
  if (t.startsWith("request")) {
    err(line, "SYNTAX", 'expected `request GET|POST|…|OPTIONS "/path" [with header name = "value", query name = …, body name = …]`', col);
    return;
  }
  // An answer without that value: \`see body.reached is absent\` (api and layers).
  if ((m = t.match(new RegExp(`^see\\s+(${QN})\\s+is\\s+absent$`)))) return { step: { do: "see", target: m[1], check: { is: "hidden" }, line } };
  // Headers of an answer: \`see header vary = "origin"\`, \`see listTickets.header.x-api-key is absent\`.
  if ((m = t.match(new RegExp(`^see\\s+((?:${LOWER}\\.)?header[.\\s](${HEADER}))\\s*(?:=\\s*(${STR})|is\\s+absent)$`)))) {
    const target = m[1].replace(/header\s+/, "header.");
    return { step: { do: "see", target, check: m[3] !== undefined ? { is: "eq", value: parseString(m[3])! } : { is: "hidden" }, line } };
  }
  if ((m = t.match(/^tick(?:\s+(\d+)\s+times?)?$/))) return { step: { do: "tick", times: Number(m[1] ?? 1), line } };
  if ((m = t.match(/^wait\s+(\S+)$/))) {
    const ms = parseDuration(m[1]);
    if (ms === undefined) {
      err(line, "SYNTAX", "expected a duration such as `3s`", col);
      return;
    }
    return { step: { do: "tick", times: 0, line }, waitMs: ms };
  }
  // Inside a component the row count may be a param: `see rows has at most size rows`.
  if ((m = t.match(new RegExp(`^see\\s+(${QN})\\s+has\\s+(at\\s+most\\s+|at\\s+least\\s+)?(\\d+|${inComponent ? LOWER : "\\d+"})\\s+rows?$`)))) {
    const n = /^\d+$/.test(m[3]) ? Number(m[3]) : NaN;
    return { step: { do: "see", target: m[1], check: { is: "rows", count: n, cmp: !m[2] ? undefined : m[2].includes("most") ? "atMost" : "atLeast", countParam: Number.isNaN(n) ? m[3] : undefined }, line } };
  }
  // Numbers: `see stock is at least 0`, `see every row of shown: confirmed is at most capacity`.
  const NUMCMP = `(at\\s+least|at\\s+most|above|below)\\s+(-?\\d+(?:\\.\\d+)?|${QN})`;
  const numCheck = (op: string, rhs: string): Check => {
    const o = op.replace(/\s+/g, " ");
    const opName = o === "at least" ? "atLeast" : o === "at most" ? "atMost" : o === "above" ? "above" : "below";
    return /^-?\d/.test(rhs) ? { is: "num", op: opName, value: Number(rhs) } : { is: "num", op: opName, ref: rhs };
  };
  if ((m = t.match(new RegExp(`^see\\s+every\\s+row\\s+of\\s+(${QN})\\s*:\\s*(.+)$`)))) {
    const list = m[1];
    const inner = m[2].trim();
    let im: RegExpMatchArray | null;
    if ((im = inner.match(new RegExp(`^(${QN})\\s+is\\s+${NUMCMP}$`)))) return { step: { do: "see", target: im[1], every: list, check: numCheck(im[2], im[3]), line } };
    if ((im = inner.match(new RegExp(`^(${QN})\\s+is\\s+(disabled|enabled|hidden|shown|checked|unchecked)$`)))) return { step: { do: "see", target: im[1], every: list, check: { is: im[2] as "shown" }, line } };
    if ((im = inner.match(new RegExp(`^(${QN})\\s*=\\s*(${STR})$`)))) return { step: { do: "see", target: im[1], every: list, check: { is: "eq", value: parseString(im[2])! }, line } };
    err(line, "SYNTAX", "after `see every row of <list>:` comes `<element> is at least|at most|above|below <number or element>`, `<element> is shown|hidden|…` or `<element> = \"text\"`", col);
    return;
  }
  if ((m = t.match(new RegExp(`^see\\s+(${QN})${ROW}\\s+is\\s+${NUMCMP}$`))))
    return { step: { do: "see", target: m[1], at: at(m[2], m[3]), check: numCheck(m[4], m[5]), line } };
  if ((m = t.match(new RegExp(`^see\\s+(${QN})${ROW}\\s+is\\s+(disabled|enabled|hidden|shown|checked|unchecked)$`))))
    return { step: { do: "see", target: m[1], at: at(m[2], m[3]), check: { is: m[4] as "shown" }, line } };
  if ((m = t.match(new RegExp(`^see\\s+(${QN})${ROW}\\s*=\\s*(.+)$`)))) {
    const lit = parseLiteral(m[4]);
    if (!lit || lit.k === "emptyList" || lit.k === "nothing" || lit.k === "table") {
      err(line, "SYNTAX", `\`${m[4]}\` is not a value to compare with; use a "string", a number or a choice value`, col);
      return;
    }
    const value = lit.k === "text" ? lit.v : lit.k === "number" ? lit.raw : lit.k === "bool" ? String(lit.v) : lit.v;
    return { step: { do: "see", target: m[1], at: at(m[2], m[3]), check: { is: "eq", value }, line } };
  }
  const word = t.split(/\s+/)[0];
  err(line, "SYNTAX", `not an example step: \`${t}\`${suggest(word, ["type", "click", "toggle", "choose", "wait", "tick", "see", "snapshot"])}`, col);
}

// ---------------------------------------------------------------- semantic checks

function check(app: App, err: (l: number, c: string, m: string, col?: number) => void, warn: (l: number, c: string, m: string, col?: number) => void, clockLine: number, usedComponents_ = new Set<string>()) {
  const records = new Map(app.records.map((r) => [r.name, r]));
  const choices = new Map(app.choices.map((c) => [c.name, c]));
  const valueOwner = new Map<string, ChoiceDecl>();
  const typeNames = new Set<string>([app.name]);

  const checkReserved = (name: string, line: number) => {
    for (const part of name.split(".")) if (RESERVED.has(part)) err(line, "RESERVED", `\`${part}\` is reserved; pick another name`);
  };

  for (const r of app.records) {
    if (typeNames.has(r.name)) err(r.line, "DUPLICATE", `type \`${r.name}\` is declared twice (or clashes with the app name)`);
    typeNames.add(r.name);
    checkReserved(r.name, r.line);
  }
  for (const c of app.choices) {
    if (typeNames.has(c.name)) err(c.line, "DUPLICATE", `type \`${c.name}\` is declared twice (or clashes with the app name)`);
    typeNames.add(c.name);
    checkReserved(c.name, c.line);
  }
  for (const c of app.choices) {
    for (const v of c.values) {
      if (valueOwner.has(v)) err(c.line, "DUPLICATE", `value \`${v}\` is already used by choice ${valueOwner.get(v)!.name}; choice values must be unique across the app`);
      else if (typeNames.has(v)) err(c.line, "DUPLICATE", `value \`${v}\` clashes with a type name`);
      valueOwner.set(v, c);
      checkReserved(v, c.line);
    }
  }

  REFINED = new Map((app.refined ?? []).map((r) => [r.name, r]));
  for (const r of app.refined ?? []) {
    if (typeNames.has(r.name)) err(r.line, "DUPLICATE", `type \`${r.name}\` is declared twice`);
    typeNames.add(r.name);
    checkReserved(r.name, r.line);
    if (r.min !== undefined && r.max !== undefined && r.min > r.max) err(r.line, "BAD_BINDING", `${r.name}: from ${r.min} is above to ${r.max}`);
  }
  const checkType = (t: Type, line: number): boolean => {
    if (t.k === "List" || t.k === "Maybe") return checkType(t.of, line);
    if (t.k === "Named" && !records.has(t.name) && !choices.has(t.name) && !REFINED.has(t.name)) {
      err(line, "UNKNOWN_NAME", `unknown type \`${t.name}\`${suggest(t.name, [...typeNames])}`);
      return false;
    }
    return true;
  };
  const checkDefault = (f: Field) => {
    if (!f.default || !checkType(f.type, f.line)) return;
    if (f.default.k === "table") {
      const table = f.default;
      const rec = f.type.k === "List" && f.type.of.k === "Named" ? records.get(f.type.of.name) : undefined;
      if (!rec) return err(f.line, "BAD_BINDING", `a table fills a \`List <Record>\`; \`${f.name}\` is ${typeToString(f.type)}`);
      for (const col of table.columns) if (!rec.fields.some((x) => x.name === col)) err(f.line + 1, "UNKNOWN_NAME", `${rec.name} has no field \`${col}\`${suggest(col, rec.fields.map((x) => x.name))}`);
      for (const rf of rec.fields)
        if (!table.columns.includes(rf.name) && !rf.default && rf.type.k !== "Maybe") err(f.line + 1, "BAD_BINDING", `the table needs a \`${rf.name}\` column (${rec.name}.${rf.name} has no default)`);
      table.rows.forEach((row, i) =>
        row.forEach((cell, j) => {
          const rf = rec.fields.find((x) => x.name === table.columns[j]);
          if (rf && !literalFits(cell, rf.type, choices)) err(f.line + 2 + i, "BAD_BINDING", `\`${rf.name}\` must be ${typeToString(rf.type)}`);
        }),
      );
      return;
    }
    if (!literalFits(f.default, f.type, choices)) err(f.line, "BAD_BINDING", `default does not fit type ${typeToString(f.type)}`);
  };

  for (const r of app.records) {
    const seen = new Set<string>();
    for (const f of r.fields) {
      if (seen.has(f.name)) err(f.line, "DUPLICATE", `field \`${f.name}\` declared twice in ${r.name}`);
      seen.add(f.name);
      checkReserved(f.name, f.line);
      checkType(f.type, f.line);
      checkDefault(f);
      if (f.type.k === "Named" && f.type.name === r.name) err(f.line, "BAD_BINDING", "a record cannot contain itself");
    }
  }
  const state = new Map<string, Field>();
  for (const f of app.state) {
    if (state.has(f.name)) err(f.line, "DUPLICATE", `state \`${f.name}\` declared twice`);
    state.set(f.name, f);
    checkReserved(f.name, f.line);
    checkType(f.type, f.line);
    checkDefault(f);
    if (f.type.k === "Named" && records.has(f.type.name)) err(f.line, "BAD_BINDING", `state of record type needs a literal default; use \`Maybe ${f.type.name} = nothing\``);
  }
  const derived = new Set<string>();
  for (const d of app.derive) {
    if (state.has(d.name) || derived.has(d.name)) err(d.line, "DUPLICATE", `\`${d.name}\` is already declared`);
    derived.add(d.name);
    checkReserved(d.name, d.line);
  }

  // The api profile has endpoints instead of a screen.
  if (app.kind === "layer") return checkLayer(app, err, warn, checkType);
  if (app.profile === "api") return checkApi(app, err, warn, { records, choices, state, derived, checkType, checkReserved });
  if (app.endpoints?.length) err(app.endpoints[0].line, "SYNTAX", "endpoints belong to the api profile: add `profile api`");

  // Screen: scopes and bindings.
  const top = new Map<string, Element>(); // names visible at top level (sections are transparent)
  const lists: Element[] = [];
  const all: { el: Element; list?: Element }[] = [];
  const walk = (els: Element[], list: Element | undefined, scope: Map<string, Element>) => {
    for (const el of els) {
      if (el.kind !== "heading") {
        if (scope.has(el.name)) err(el.line, "DUPLICATE", `element \`${el.name}\` is already on the screen${list ? ` in list ${list.name}` : ""}`);
        scope.set(el.name, el);
        checkReserved(el.name, el.line);
        all.push({ el, list });
      }
      if (el.kind === "list") {
        lists.push(el);
        walk(el.children, el, new Map());
      } else if (el.kind === "section") walk(el.children, list, scope);
    }
  };
  walk(app.screen, undefined, top);
  if (!app.screen.length) err(1, "SYNTAX", "the app has no `screen`");

  for (const { el, list } of all) {
    if (list && el.kind !== "heading" && records.get(list.of!)?.fields.some((f) => f.name === el.name) && (state.has(el.name) || derived.has(el.name)))
      warn(el.line, "SHADOWED", `\`${el.name}\` is a field of ${list.of} and also an app-level name; inside the row it means the row's field. Rename the app-level one to avoid mix-ups`);
  }
  for (const { el, list } of all) {
    const rowType = list ? records.get(list.of!) : undefined;
    const rowField = rowType?.fields.find((f) => f.name === el.name);
    const st = state.get(el.name);
    const where = list ? `row type ${list.of}` : "state";
    switch (el.kind) {
      case "text":
        if (!el.expr && !(list ? rowField : st || derived.has(el.name)))
          err(el.line, "UNKNOWN_NAME", `\`text ${el.name}\` shows nothing: declare ${list ? `field \`${el.name}\` in ${list.of}` : `state or derive \`${el.name}\``}, or write \`text ${el.name} = …\``);
        break;
      case "field":
        if (!st) err(el.line, "BAD_BINDING", `\`field ${el.name}\` edits state \`${el.name}\`, which is not declared (add \`${el.name}: Text = ""\` to state)`);
        else if (st.type.k !== "Text") err(el.line, "BAD_BINDING", `\`field ${el.name}\` edits state \`${el.name}\`, which must be Text (is ${typeToString(st.type)})`);
        break;
      case "select":
        if (el.from) {
          if (!st || st.type.k !== "Text") err(el.line, "BAD_BINDING", `\`select ${el.name} from …\` edits state \`${el.name}\`, which must be Text`);
          const src = state.get(el.from.list);
          const srcRec = src && src.type.k === "List" && src.type.of.k === "Named" ? records.get(src.type.of.name) : undefined;
          if (!src && !derived.has(el.from.list)) err(el.line, "UNKNOWN_NAME", `no state or derive \`${el.from.list}\``);
          else if (src && !srcRec) err(el.line, "BAD_BINDING", `\`${el.from.list}\` must be a list of records`);
          else if (srcRec && srcRec.fields.find((x) => x.name === el.from!.field)?.type.k !== "Text") err(el.line, "BAD_BINDING", `${srcRec.name} needs a Text field \`${el.from.field}\``);
        } else if (!st) err(el.line, "BAD_BINDING", `\`select ${el.name}\` edits state \`${el.name}\`, which is not declared`);
        else if (st.type.k !== "Named" || !choices.has(st.type.name)) err(el.line, "BAD_BINDING", `\`select ${el.name}\` needs state \`${el.name}\` to be a choice (is ${typeToString(st.type)})`);
        break;
      case "checkbox": {
        const f = list ? rowField : st;
        if (!f) err(el.line, "BAD_BINDING", `\`checkbox ${el.name}\` flips a Bool \`${el.name}\` in ${where}, which is not declared`);
        else if (f.type.k !== "Bool") err(el.line, "BAD_BINDING", `\`checkbox ${el.name}\` needs \`${el.name}\` to be Bool (is ${typeToString(f.type)})`);
        break;
      }
      case "progress":
        if (!el.expr && !(list ? rowField : st || derived.has(el.name))) err(el.line, "UNKNOWN_NAME", `\`progress ${el.name}\` shows nothing: declare state or derive \`${el.name}\` (0–100), or write \`progress ${el.name} = …\``);
        break;
      case "list":
        if (!records.has(el.of!)) err(el.line, "UNKNOWN_NAME", `unknown record \`${el.of}\`${suggest(el.of!, [...records.keys()])}`);
        if (!el.expr) {
          const f = st;
          if (!f && !derived.has(el.name)) err(el.line, "UNKNOWN_NAME", `\`list ${el.name}\` shows nothing: declare state or derive \`${el.name}\`, or write \`list ${el.name} of ${el.of} = …\``);
          else if (f && !(f.type.k === "List" && f.type.of.k === "Named" && f.type.of.name === el.of))
            err(el.line, "BAD_BINDING", `state \`${el.name}\` must be \`List ${el.of}\` (is ${typeToString(f.type)})`);
        }
        break;
    }
  }

  // Presentations and components.
  const components = new Set(app.components.map((c) => c.name));
  const usedComponents = new Set<string>(usedComponents_);
  for (const { el } of all) {
    if (!el.as) continue;
    if (/^[A-Z]/.test(el.as)) {
      if (!components.has(el.as)) err(el.line, "UNKNOWN_NAME", `no component \`${el.as}\`${suggest(el.as, [...components])}; declare it with \`component ${el.as} "…"\``);
      const base = app.components.find((c) => c.name === el.as)?.base;
      if (base && !PRESENTATIONS[el.kind].includes(base)) err(el.line, "BAD_BINDING", `component ${el.as} is a \`${base}\`, which a ${el.kind} cannot be`);
      usedComponents.add(el.as);
    } else if (!PRESENTATIONS[el.kind].includes(el.as)) err(el.line, "UNKNOWN_NAME", `a ${el.kind} cannot be shown as \`${el.as}\` (${PRESENTATIONS[el.kind].join(", ")})`);
  }
  for (const c of app.components) {
    if (typeNames.has(c.name) || valueOwner.has(c.name)) err(c.line, "DUPLICATE", `component \`${c.name}\` clashes with a type or value name`);
    // A library offers more than one app uses: only the app's own components must be used.
    if (!usedComponents.has(c.name) && c.line < LINE_BASE) warn(c.line, "UNUSED", `component \`${c.name}\` is never used (\`… as ${c.name}\`)`);
  }

  // Handlers.
  const findEl = (name: string): { el: Element; list?: Element }[] => all.filter((a) => a.el.name === name);
  const verbKind = VERB_KINDS as Record<string, ElementKind>;
  const handled = new Set<string>();
  for (const h of app.handlers) {
    if (h.verb === "tick") {
      if (!app.clockMs) err(h.line, "BAD_BINDING", "`on tick` needs a `clock every …` block");
      continue;
    }
    if (h.verb === "start") continue;
    if (h.verb === "answer") {
      // `on answer tickets.listTickets`: a client alias and an endpoint of its contract.
      const [alias, ep] = h.target.split(".");
      const client = app.clients?.find((c) => c.alias === alias);
      if (!client) err(h.line, "UNKNOWN_NAME", `no client \`${alias}\`; declare it with \`uses <contract> as ${alias}\``);
      else if (!client.contract.endpoints?.some((e) => e.name === ep)) err(h.line, "UNKNOWN_NAME", `contract ${client.contract.name} has no endpoint \`${ep}\`${suggest(ep ?? "", client.contract.endpoints?.map((e) => e.name) ?? [])}`);
      const key = `answer ${h.target}`;
      if (handled.has(key)) err(h.line, "DUPLICATE", `there is already an \`on ${key}\``);
      handled.add(key);
      continue;
    }
    const found = findEl(h.target);
    const want = verbKind[h.verb];
    if (!found.length) err(h.line, "UNKNOWN_NAME", `no element \`${h.target}\` on the screen${suggest(h.target, all.map((a) => a.el.name))}`);
    else if (!found.some((f) => f.el.kind === want)) err(h.line, "BAD_BINDING", `\`on ${h.verb}\` needs a ${want}; \`${h.target}\` is a ${found[0].el.kind}`);
    const key = `${h.verb} ${h.target}`;
    if (handled.has(key)) err(h.line, "DUPLICATE", `there is already an \`on ${key}\``);
    handled.add(key);
  }
  if (app.clockMs && !app.handlers.some((h) => h.verb === "tick")) warn(clockLine, "NO_HANDLER", "the app has a clock but no `on tick`");
  // Calls: \`call tickets.createTicket …\` must name an endpoint of a client, and its answer should be handled.
  if (app.clients?.length)
    for (const h of app.handlers)
      for (const st of h.steps)
        for (const m of st.matchAll(/\bcall\s+([a-z]\w*)\.([a-z]\w*)/gi)) {
          const client = app.clients.find((c) => c.alias === m[1]);
          if (!client) err(h.line, "UNKNOWN_NAME", `no client \`${m[1]}\`; declare it with \`uses <contract> as ${m[1]}\``);
          else if (!client.contract.endpoints?.some((e) => e.name === m[2])) err(h.line, "UNKNOWN_NAME", `contract ${client.contract.name} has no endpoint \`${m[2]}\`${suggest(m[2], client.contract.endpoints?.map((e) => e.name) ?? [])}`);
          else if (!handled.has(`answer ${m[1]}.${m[2]}`)) warn(h.line, "NO_HANDLER", `\`${m[1]}.${m[2]}\` is called, but its answer is ignored: add \`on answer ${m[1]}.${m[2]}\``);
        }
  for (const { el } of all) if (el.kind === "button" && !handled.has(`click ${el.name}`)) warn(el.line, "NO_HANDLER", `button \`${el.name}\` has no \`on click ${el.name}\``);

  // Examples.
  const seen = new Set<string>(); // "list.name" or "name" checked by some `see`
  const exNames = new Set<string>();
  const snapshots = new Set<string>();
  for (const ex of [...app.examples, { name: "(always)", steps: app.always, line: 0 }]) {
    if (ex.line === 0 && !ex.steps.length) continue;
    if (exNames.has(ex.name)) err(ex.line, "DUPLICATE", `example "${ex.name}" declared twice`);
    exNames.add(ex.name);
    if (!ex.steps.length) err(ex.line, "SYNTAX", "an example needs steps");
    for (const s of ex.steps) {
      if (s.do === "tick") {
        if (!app.clockMs) err(s.line, "STEP", "`tick`/`wait` needs a `clock every …` block");
        continue;
      }
      if (s.do === "call" || s.do === "request") {
        err(s.line, "STEP", `\`${s.do}\` belongs to the api profile (add \`profile api\`); a screen is driven with click, type, toggle and choose`);
        continue;
      }
      if (s.do === "snapshot") {
        if (snapshots.has(s.name)) err(s.line, "DUPLICATE", `snapshot "${s.name}" is already used`);
        snapshots.add(s.name);
        if (ex.line === 0) err(s.line, "SYNTAX", "`always` holds only `see` checks");
        continue;
      }
      const at = "at" in s ? s.at : undefined;
      if (s.do === "see" && s.every) {
        // `see every row of L: x …`: x is an element of L's rows.
        const list = all.find((a) => a.el.name === s.every && a.el.kind === "list");
        const inRow = all.filter((a) => a.list?.name === s.every);
        if (!list) err(s.line, "UNKNOWN_NAME", `no list \`${s.every}\`${suggest(s.every, lists.map((l) => l.name))}`);
        else if (!inRow.some((a) => a.el.name === s.target)) err(s.line, "UNKNOWN_NAME", `rows of \`${s.every}\` have no \`${s.target}\`${suggest(s.target, inRow.map((a) => a.el.name))}`);
        else if (s.check.is === "num" && s.check.ref && !inRow.some((a) => a.el.name === (s.check as { ref: string }).ref)) err(s.line, "UNKNOWN_NAME", `rows of \`${s.every}\` have no \`${(s.check as { ref: string }).ref}\``);
        seen.add(`${s.every}.${s.target}`);
        continue;
      }
      const cands = findEl(s.target).filter((c) => (at ? c.list && (!at.list || c.list.name === at.list) : !c.list));
      if (!cands.length) {
        const any = findEl(s.target);
        if (any.length && at && any.every((a) => !a.list)) err(s.line, "STEP", `\`${s.target}\` is not inside a list; drop \`on row …\``);
        else if (any.length && !at) err(s.line, "STEP", `\`${s.target}\` is inside list ${any[0].list!.name}; say which row: \`… on row 1\``);
        else err(s.line, "UNKNOWN_NAME", `no element \`${s.target}\`${at?.list ? ` in list ${at.list}` : ""}${suggest(s.target, all.map((a) => a.el.name))}`);
        continue;
      }
      if (cands.length > 1) {
        if (at) err(s.line, "STEP", `\`${s.target}\` is in several lists; add \`of <list>\``);
        else err(s.line, "STEP", `\`${s.target}\` is ambiguous: it is declared more than once`);
        continue;
      }
      const { el, list } = cands[0];
      if (at) at.list = list!.name;
      const need = (kinds: ElementKind[], what: string) => {
        if (!kinds.includes(el.kind)) err(s.line, "STEP", `cannot ${what} \`${el.name}\`: it is a ${el.kind}`);
      };
      switch (s.do) {
        case "type": need(["field"], "type into"); break;
        case "click": need(["button"], "click"); break;
        case "toggle": need(["checkbox"], "toggle"); break;
        case "choose": {
          need(["select"], "choose in");
          if (el.from) {
            if (!s.quoted) err(s.line, "STEP", `options of \`${el.name}\` are texts: write \`choose "${s.value}" in ${el.name}\``);
            break;
          }
          if (s.quoted) err(s.line, "STEP", `options of \`${el.name}\` are choice values: write \`choose ${s.value} in ${el.name}\` without quotes`);
          const st = state.get(el.name);
          const ch = st && st.type.k === "Named" ? choices.get(st.type.name) : undefined;
          if (ch && !ch.values.includes(s.value)) err(s.line, "UNKNOWN_NAME", `\`${s.value}\` is not a value of ${ch.name} (${ch.values.join(", ")})`);
          break;
        }
        case "see": {
          seen.add(list ? `${list.name}.${el.name}` : el.name);
          if (list) seen.add(list.name); // checking a row proves the list too
          const c: Check = s.check;
          if (c.is === "rows") need(["list"], "count rows of");
          else if (c.is === "eq") need(["text", "field", "select", "button", "progress"], "compare the value of");
          else if (c.is === "disabled" || c.is === "enabled") need(["button"], `check \`is ${c.is}\` on`);
          else if (c.is === "checked" || c.is === "unchecked") need(["checkbox"], `check \`is ${c.is}\` on`);
          else if (c.is === "num") {
            need(["text", "field", "progress"], "compare the number shown by");
            if (c.ref && !findEl(c.ref).length) err(s.line, "UNKNOWN_NAME", `no element \`${c.ref}\``);
          }
          if (c.is === "eq" && el.kind === "button" && !el.expr) warn(s.line, "STEP", `button \`${el.name}\` has a fixed label; this check proves nothing`);
          if (c.is === "eq" && el.kind === "select" && !el.from) {
            const st = state.get(el.name);
            const ch = st && st.type.k === "Named" ? choices.get(st.type.name) : undefined;
            if (ch && !ch.values.includes(c.value)) err(s.line, "UNKNOWN_NAME", `\`${c.value}\` is not a value of ${ch.name}`);
          }
          break;
        }
      }
    }
  }
  if (!app.examples.length) warn(1, "NO_EXAMPLES", "the app has no examples; nothing proves its behaviour");
  for (const { el, list } of all) {
    // Fields and selects just mirror their state (built-in binding), so they need no proof of their own.
    const dynamic = el.kind === "text" || el.kind === "checkbox" || el.kind === "list" || el.kind === "progress" || (el.kind === "button" && (el.enabledWhen || el.expr));
    if (!dynamic) continue;
    if (el.line >= LINE_BASE) continue; // from a bundle: its demo app proves it
    if (el.kind === "text" && el.expr && parseString(el.expr) !== undefined && !el.expr.includes("{")) continue; // a constant
    const key = list ? `${list.name}.${el.name}` : el.name;
    if (!seen.has(key)) warn(el.line, "UNPROVEN", `\`${el.kind} ${el.name}\` is never checked by a \`see\` step`);
  }

  // Anchoring: sentences should mention declared names.
  const names = new Set<string>([
    ...state.keys(), ...derived, ...all.map((a) => a.el.name), ...records.keys(), ...choices.keys(), ...valueOwner.keys(),
    ...app.records.flatMap((r) => r.fields.map((f) => f.name)),
    ...(app.clients ?? []).flatMap((c) => [c.alias, ...(c.contract.endpoints ?? []).map((e) => e.name)]),
  ]);
  const anchored = (s: string) => (s.match(/[A-Za-z][A-Za-z0-9]*/g) ?? []).some((w) => names.has(w));
  for (const h of app.handlers) for (const s of h.steps) if (!anchored(s) && !/nothing|initial state/i.test(s)) warn(h.line, "UNANCHORED", `"${s}" mentions no declared name`);
  for (const r of app.rules) if (!anchored(r)) warn(1, "UNANCHORED", `rule "${r}" mentions no declared name`);
}

/** A see-target on a raw answer: \`status\`, \`header.x\`, \`body…\` (layers), or the same after \`request.\` (apps). */
const RAW_TARGET = /^(?:request\.)?(status|header\.[a-z0-9-]+|body(?:[.[].*)?)$/;

function checkLayer(app: App, err: Err, warn: Err, checkType: (t: Type, line: number) => boolean) {
  const params = new Map((app.params ?? []).map((p) => [p.name, p]));
  for (const p of app.params ?? []) checkType(p.type, p.line);
  for (const p of app.provides ?? []) checkType(p.type, p.line);
  for (const b of app.exampleConfig ?? []) if (!params.has(b.name)) err(b.line, "UNKNOWN_NAME", `the layer has no param \`${b.name}\`${suggest(b.name, [...params.keys()])}`);
  const bound = new Set((app.exampleConfig ?? []).map((b) => b.name));
  for (const p of app.params ?? []) if (!p.default && !bound.has(p.name)) err(p.line, "BAD_BINDING", `param \`${p.name}\` has no default: give its value for the examples under \`examples with\``);
  for (const ex of [...app.examples, { name: "(always)", steps: app.always, line: 0 }])
    for (const s of ex.steps) {
      if (s.do === "request") continue;
      if (s.do === "see" && RAW_TARGET.test(s.target)) continue;
      if (s.do === "see") err(s.line, "UNKNOWN_NAME", `a layer's example sees the answer: \`see status = 200\`, \`see header vary = "origin"\`, \`see body.reached = true\``);
      else err(s.line, "STEP", `a layer's example sends \`request METHOD "/path" with header name = "…"\` and checks with \`see\`, not \`${s.do}\``);
    }
  if (!app.examples.length) warn(1, "NO_EXAMPLES", "the layer has no examples; nothing proves its behaviour");
}

function checkApi(
  app: App,
  err: (l: number, c: string, m: string, col?: number) => void,
  warn: (l: number, c: string, m: string, col?: number) => void,
  ctx: { records: Map<string, RecordDecl>; choices: Map<string, ChoiceDecl>; state: Map<string, Field>; derived: Set<string>; checkType: (t: Type, line: number) => boolean; checkReserved: (n: string, line: number) => void },
) {
  const eps = new Map<string, Endpoint>();
  if (app.screen.length) err(app.screen[0].line, "SYNTAX", "an api has endpoints, not a screen");
  if (!app.endpoints?.length) err(1, "SYNTAX", "an api needs at least one `endpoint`");
  const routes = new Set<string>();
  for (const ep of app.endpoints ?? []) {
    if (eps.has(ep.name)) err(ep.line, "DUPLICATE", `endpoint \`${ep.name}\` is declared twice`);
    eps.set(ep.name, ep);
    ctx.checkReserved(ep.name, ep.line);
    const route = `${ep.method} ${ep.path.replace(/\{[^}]+\}/g, "{}")}`;
    if (routes.has(route)) err(ep.line, "DUPLICATE", `another endpoint already answers ${ep.method} ${ep.path}`);
    routes.add(route);
    const holes = [...ep.path.matchAll(/\{([a-z]\w*)\}/g)].map((m) => m[1]);
    for (const h of holes) if (!ep.params.some((p) => p.in === "path" && p.name === h)) err(ep.line, "UNKNOWN_NAME", `the path has {${h}}: declare \`path ${h}: Int\` (or Text)`);
    for (const p of ep.params) {
      ctx.checkType(p.type, p.line);
      if (p.in === "path" && !holes.includes(p.name)) err(p.line, "BAD_BINDING", `\`path ${p.name}\` is not in "${ep.path}"`);
      if (p.in === "body" && ep.method === "GET") err(p.line, "BAD_BINDING", "a GET request has no body; use `query`");
    }
    if (ep.returns) ctx.checkType(ep.returns, ep.line);
    for (const a of ep.answers ?? []) if (a.type) ctx.checkType(a.type, a.line);
    if (app.kind !== "contract" && !ep.steps.length) err(ep.line, "SYNTAX", `endpoint ${ep.name} needs steps: what happens and what is answered`);
    // Every status the steps answer must be in the endpoint's answers (the contract). The harness's own
    // answers (400 for bad input, 404 unknown route, 405 wrong method) are always allowed.
    if (ep.answers?.length) {
      const declared = new Set(ep.answers.map((a) => a.status));
      for (const st of ep.steps)
        for (const m of st.matchAll(/\banswer\s+([1-5]\d\d)\b/g))
          if (!declared.has(Number(m[1]))) err(ep.line, "CONTRACT", `endpoint ${ep.name} answers ${m[1]}, which its contract does not declare (${[...declared].join(", ")}); add \`answers ${m[1]} …\` to the contract, or answer differently`);
    }
  }
  // Examples: `call` an endpoint with its params; `see <endpoint>.status|body…`.
  for (const ex of [...app.examples, { name: "(always)", steps: app.always, line: 0 }]) {
    for (const s of ex.steps) {
      if (s.do === "call") {
        const ep = eps.get(s.endpoint);
        if (!ep) {
          err(s.line, "UNKNOWN_NAME", `no endpoint \`${s.endpoint}\`${suggest(s.endpoint, [...eps.keys()])}`);
          continue;
        }
        for (const a of s.args) if (!ep.params.some((p) => p.name === a.name)) err(s.line, "UNKNOWN_NAME", `endpoint ${ep.name} has no param \`${a.name}\` (${ep.params.map((p) => p.name).join(", ") || "none"})`);
      } else if (s.do === "request") {
        continue;
      } else if (s.do === "see" && s.target.startsWith("request.")) {
        if (!RAW_TARGET.test(s.target)) err(s.line, "UNKNOWN_NAME", "a raw answer has `request.status`, `request.header.<name>` and `request.body…`");
      } else if (s.do === "see" && /^[a-z]\w*\.header\./i.test(s.target)) {
        if (!eps.has(s.target.split(".")[0])) err(s.line, "UNKNOWN_NAME", `\`${s.target.split(".")[0]}\` is not an endpoint`);
      } else if (s.do === "see") {
        const [head, part] = s.target.split(/[.[]/);
        const target = s.every ?? s.target;
        const h = target.split(/[.[]/)[0];
        if (!eps.has(h)) err(s.line, "UNKNOWN_NAME", `\`${h}\` is not an endpoint; check a response as \`see ${[...eps.keys()][0] ?? "endpoint"}.status = 200\` or \`….body.<field>\``);
        else if (!s.every && !["status", "body"].includes(part)) err(s.line, "UNKNOWN_NAME", `a response has \`status\` and \`body\`: \`see ${head}.status = 200\``);
        else {
          // The path into the body must exist in a type the endpoint can answer with: \`returns\`, or any of its \`answers\`.
          const ep = eps.get(h)!;
          // Every endpoint may also refuse with a Problem: its own refusals, the harness's 400/404, a layer's 401.
          const types = [ep.returns, ...(ep.answers ?? []).map((x) => x.type), ...(ctx.records.has("Problem") ? [{ k: "Named", name: "Problem" } as Type] : [])].filter((t): t is Type => !!t);
          const parts = (target.match(/[a-z]\w*|\[\d+\]/gi) ?? []).slice(1);
          if (parts[0] === "body" && types.length) {
            const rest = [...parts.slice(1), ...(s.every ? [s.target] : [])];
            const every = !!s.every;
            const walk = (t: Type, ps: string[], listNeeded: boolean): string | undefined => {
              let cur: Type = t;
              for (const [i, p] of ps.entries()) {
                if (cur.k === "Maybe") cur = cur.of;
                if (every && i === ps.length - 1 && cur.k === "List") cur = cur.of; // \`see every row of x.body: field\`
                if (p.startsWith("[")) {
                  if (cur.k !== "List") return `\`${p}\` needs a list, but this is ${typeToString(cur)}`;
                  cur = cur.of;
                  continue;
                }
                const rec = cur.k === "Named" ? ctx.records.get(cur.name) : undefined;
                const f = rec?.fields.find((x) => x.name === p);
                if (!f) return `${typeToString(cur)} has no \`${p}\`${rec ? ` (${rec.fields.map((x) => x.name).join(", ")})` : ""}`;
                cur = f.type;
              }
              if (listNeeded && (cur.k === "Maybe" ? cur.of : cur).k !== "List") return `this is ${typeToString(cur)}, not a list`;
            };
            const problems = types.map((t) => walk(t, rest, s.check.is === "rows"));
            if (problems.every(Boolean)) err(s.line, "UNKNOWN_NAME", `\`${target}${s.every ? `: ${s.target}` : ""}\`: ${problems[0]}`);
          }
        }
      } else if (s.do !== "snapshot") err(s.line, "STEP", `an api example uses \`call\` and \`see\`, not \`${s.do}\``);
    }
  }
  for (const ep of eps.values()) if (!app.examples.some((ex) => ex.steps.some((s) => s.do === "call" && s.endpoint === ep.name))) warn(ep.line, "UNPROVEN", `endpoint \`${ep.name}\` is never called in an example`);
  if (!app.examples.length) warn(1, "NO_EXAMPLES", "the api has no examples; nothing proves its behaviour");
}

function literalFits(l: Literal, t: Type, choices: Map<string, ChoiceDecl>): boolean {
  switch (t.k) {
    case "Text": return l.k === "text";
    case "Int": return l.k === "number" && Number.isInteger(l.v) && !l.raw.includes(".");
    case "Decimal": return l.k === "number";
    case "Bool": return l.k === "bool";
    case "List": return l.k === "emptyList" || l.k === "table";
    case "Maybe": return l.k === "nothing" || literalFits(l, t.of, choices);
    case "Named": {
      const r = REFINED.get(t.name);
      if (r) return literalFits(l, { k: r.base }, choices) && satisfies(r, l.k === "text" ? l.v : l.k === "number" ? l.v : undefined);
      return l.k === "value" && !!choices.get(t.name)?.values.includes(l.v);
    }
  }
}

/** The refined types of the app being checked (set by check). */
let REFINED = new Map<string, RefinedDecl>();

/** Does a value satisfy a refined type's rule? The same rule the generated validators apply. */
export function satisfies(r: RefinedDecl, v: string | number | undefined): boolean {
  if (v === undefined) return false;
  if (r.pattern !== undefined) return typeof v === "string" && new RegExp(`^(?:${r.pattern})$`).test(v);
  if (typeof v !== "number") return false;
  return (r.min === undefined || v >= r.min) && (r.max === undefined || v <= r.max);
}

// ---------------------------------------------------------------- hints

function suggest(word: string, candidates: string[]): string {
  let best = "";
  let bestD = Infinity;
  for (const c of candidates) {
    const d = lev(word.toLowerCase(), c.toLowerCase());
    if (d < bestD) [best, bestD] = [c, d];
  }
  return best && bestD <= Math.max(1, Math.floor(word.length / 3)) && best !== word ? ` (did you mean \`${best}\`?)` : "";
}

function lev(a: string, b: string): number {
  const d = Array.from({ length: a.length + 1 }, (_, i) => [i, ...Array(b.length).fill(0)]);
  for (let j = 1; j <= b.length; j++) d[0][j] = j;
  for (let i = 1; i <= a.length; i++)
    for (let j = 1; j <= b.length; j++) d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
  return d[a.length][b.length];
}

export function formatDiagnostics(file: string, src: string, diags: Diagnostic[], sources?: { file: string; text: string }[]): string {
  const text = (f: string) => (sources?.find((s) => s.file === f)?.text ?? src).split(/\r?\n/);
  return diags
    .map((d) => {
      const f = d.file ?? file;
      const code = text(f)[d.line - 1] ?? "";
      return `${f}:${d.line}:${d.col}: ${d.level} ${d.code}: ${d.message}\n  ${String(d.line).padStart(4)} | ${code}\n       | ${" ".repeat(Math.max(0, d.col - 1))}^`;
    })
    .join("\n");
}
