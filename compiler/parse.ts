// Parser + checker for .intent files. Deterministic: same text in, same IR and diagnostics out.
import { checkDisabledClicks } from "./disabled.ts";
import { parseDate, parseDateTime } from "../runtime/ts/fmt.ts";
import { expandUses } from "./expand.ts";
import { uiProfile, verbKinds } from "./profile.ts";
import { LINE_BASE } from "./ast.ts";
import type { Refinement } from "./refine.ts";
import { fromBraces } from "./braces.ts";
import { checkFit } from "./fit.ts";
import { ALPHABETS, ALPHABET_NAMES } from "./alphabets.ts";
import { checkDraws } from "./draws.ts";
import { checkAccess, parseRule } from "./access.ts";
import { parseString, suggest, typeToString } from "./words.ts";
export { parseString, suggest, typeToString };
import { withStdQuality } from "./quality.ts";
import { declaredNames, refsIn, resolves, sentences, usedByAlias, usesClock } from "./refs.ts";
import type { ScreenDecl, Stmt, App, Binding, LayerUse, Check, ChoiceDecl, Component, Diagnostic, Element, ElementKind, Endpoint, Example, Field, Handler, Literal, Param, RecordDecl, RefinedDecl, RowRef, Step, Type, Verb } from "./ast.ts";

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

// Intent's own words: a name cannot be one. Every other name is free: the harness writes a name that
// is a target's keyword, or a name it generates, with a trailing `_` wherever it is an identifier
// (compiler/targets/shared.ts, `mangle`), so `type`, `in`, `class`, `when` or a record `Model` build.
export const RESERVED = new Set([
  "key", // the row key in generated row types, and a record's `key` field
  "nothing", "true", "false", "random",
  // the type words
  "Text", "Int", "Decimal", "Bool", "Date", "DateTime", "List", "Maybe",
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

type Err = (l: number, c: string, m: string, col?: number) => void;

interface Ctx {
  err: Err;
  warn: Err;
  pendingWaits: { step: { do: "tick"; times: number; line: number }; ms: number }[];
  clockLine: number;
}

const QN = `${LOWER}(?:\\.${LOWER}|\\[\\d+\\])*`;
/** A declared name, qualified when it is a component instance's (\`pager.page\`): what \`intent expand\`
 *  prints for an expanded component, so that the expanded spec reads back as it is printed. */
const DECL = `${LOWER}(?:\\.${LOWER})*`; // a (possibly qualified) name: pager.next; in api examples a response path: createTicket.body.items[1].id
const BUNDLE_NAME = `${LOWER}(?:\\.${LOWER})*`;
/** The line \`intent expand\` writes first: the spec below is expanded, so qualified names read back. */
export const EXPANDED_LINE = "# expanded by intent expand: components are inlined, their names qualified (pager.next)";
const EXPANDED = /^# expanded by intent expand\b/m;
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
  // Blocks with braces are read as their indented form, line for line (so line numbers stay).
  const braces = fromBraces(src);
  for (const e of braces.errors) err(e.line, "SYNTAX", e.message);
  const roots = buildLineTree(braces.text, err);
  const app = emptyApp();
  app.imports = [];
  const ctx: Ctx = { err, warn, pendingWaits: [], clockLine: 0 };
  let language: string | undefined;
  let languageLine = 1;

  roots.forEach((node, i) => {
    const t = node.text;
    let m: RegExpMatchArray | null;
    if ((m = t.match(new RegExp(`^(app|bundle|contract|layer|platform)\\s+(\\S+)$`)))) {
      if (i !== 0) err(node.line, "SYNTAX", `\`${m[1]}\` must be the first block`);
      if (app.name) err(node.line, "DUPLICATE", "only one `app` or `bundle` per file");
      const ok = m[1] === "app" ? new RegExp(`^${UPPER}$`).test(m[2]) : new RegExp(`^${BUNDLE_NAME}$`).test(m[2]);
      if (!ok) err(node.line, "SYNTAX", m[1] === "app" ? "an app name is UpperCamel: `app Helpdesk`" : `a ${m[1]} name is lower case with dots: \`${m[1]} std.list\``);
      app.kind = m[1] as "app" | "bundle" | "contract" | "layer" | "platform";
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
    } else if ((m = t.match(new RegExp(`^uses\\s+(${BUNDLE_NAME})\\s+as\\s+(${LOWER})(?:\\s+only\\s+(.+))?$`)))) {
      // `only listNotes, noteCreated`: the endpoints and events this app may use (its manifest).
      const only = m[3]?.split(/\s*,\s*|\s+and\s+/).map((x) => x.trim()).filter(Boolean);
      if (only?.some((x) => !new RegExp(`^${LOWER}$`).test(x))) err(node.line, "SYNTAX", "`only` lists endpoint and event names of the contract: `uses ouros.notes as notes only listNotes, noteCreated`");
      // A client of a contract; `tested with "<provider spec>"` names the implementation examples run against.
      let testedWith: string | undefined;
      let through: LayerUse | undefined;
      for (const c of node.children) {
        const tm = c.text.match(new RegExp(`^tested\\s+with\\s+(${STR})$`));
        const lm = c.text.match(new RegExp(`^through\\s+(${LOWER}(?:\\.${LOWER})+)$`));
        if (tm) testedWith = parseString(tm[1]);
        else if (lm) {
          // A client's layer: every call (and the event stream) goes through it; params bind to state or literals.
          if (through) err(c.line, "DUPLICATE", "one `through` per `uses`");
          through = { alias: m[2], layer: lm[1], bindings: c.children.map((b) => parseBinding(b, err, true)).filter((b): b is Binding => !!b), line: c.line };
        } else err(c.line, "SYNTAX", 'under `uses`: `tested with "path/to/provider.intent"` or `through <client layer>`', c.indent + 1);
      }
      (app.uses ??= []).push({ contract: m[1], alias: m[2], testedWith, through, ...(only ? { only } : {}), line: node.line });
    } else if ((m = t.match(new RegExp(`^(use|layer)\\s+(${LOWER})\\s*=\\s*(${LOWER}(?:\\.${LOWER})+)$`)))) {
      // An api app runs behind a layer: \`layer cors = std.http.cors\` (\`use\` is the older word), params bound in its block.
      (app.layers ??= []).push({ alias: m[2], layer: m[3], bindings: node.children.map((c) => parseBinding(c, err, true)).filter((b): b is Binding => !!b), line: node.line, ...(m[1] === "use" ? { spelledUse: true } : {}) });
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
      app.before = { ...parseBody(node, err), line: node.line };
    } else if (app.kind === "layer" && /^after\s+every\s+answer$/.test(t)) {
      if (app.after) err(node.line, "DUPLICATE", "one `after every answer` per layer");
      app.after = { ...parseBody(node, err), line: node.line };
    } else if (app.kind === "layer" && /^before\s+every\s+call$/.test(t)) {
      if (app.beforeCall) err(node.line, "DUPLICATE", "one `before every call` per layer");
      app.beforeCall = { ...parseBody(node, err), line: node.line };
    } else if (app.kind === "platform" && (m = t.match(new RegExp(`^function\\s+(${LOWER})\\s*\\(([^)]*)\\)\\s*:\\s*(.+)$`)))) {
      // \`function sha256(text: Text): Text\`: a signature; the installation implements it.
      const params: { name: string; type: Type }[] = [];
      for (const part of m[2].split(",").map((x) => x.trim()).filter(Boolean)) {
        const pm = part.match(new RegExp(`^(${LOWER})\\s*:\\s*(.+)$`));
        const type = pm ? parseType(pm[2]) : undefined;
        if (!pm || !type) err(node.line, "SYNTAX", `\`${part}\`: a param looks like \`name: Type\``);
        else params.push({ name: pm[1], type });
      }
      const returns = parseType(m[3]);
      if (!returns) err(node.line, "SYNTAX", `\`${m[3]}\` is not a type`);
      else (app.functions ??= []).push({ name: m[1], params, returns, line: node.line, note: node.note });
    } else if (app.kind === "layer" && /^acts\s+as\b/.test(t)) {
      // How a test acts as a caller (\`call x as "Ann"\`): the typed form the harness reads, never built.
      const am = t.match(/^acts\s+as\s+@caller\s+with\s+header\s+@([a-z]\w*)\s*=\s*the\s+@([a-z]\w*)\s+of\s+the\s+[a-z]\w*\s+in\s+@([a-z]\w*)\s+whose\s+@([a-z]\w*)\s+is\s+@caller$/);
      if (!am) err(node.line, "SYNTAX", "`acts as @caller with header @keyHeader = the @secret of the key in @keys whose @owner is @caller`: the header a test sends to act as a caller, and the key that is theirs");
      else if (app.actsAs) err(node.line, "DUPLICATE", "one `acts as` per layer");
      else app.actsAs = { header: am[1], secret: am[2], list: am[3], owner: am[4], line: node.line };
    } else if (t === "access") {
      // Who may call which endpoint and hear which event (v70): \`roles = grants\` and \`- rule\` lines.
      if (app.access) err(node.line, "DUPLICATE", "one `access` block per app");
      const block: NonNullable<App["access"]> = { rules: [], line: node.line };
      for (const c of node.children) {
        let rm: RegExpMatchArray | null;
        if ((rm = c.text.match(new RegExp(`^roles\\s*=\\s*(${LOWER})$`)))) {
          if (block.roles) err(c.line, "DUPLICATE", "one `roles = …` line per `access` block");
          block.roles = { list: rm[1], line: c.line };
        } else if (c.text.startsWith("- ")) {
          const r = parseRule(c.text.slice(2) + flattenChildren(c), c.line);
          if ("rule" in r) block.rules.push(r.rule);
          else err(c.line, r.code, r.message, c.indent + 1);
        } else err(c.line, "SYNTAX", "inside `access`: `roles = <state list of grants>` and `- <who> may call <endpoints> [when …]` rules", c.indent + 1);
      }
      if (!block.rules.length) err(node.line, "SYNTAX", "an `access` block holds its rules: `- an @Agent may call @myTickets`");
      app.access ??= block;
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
      if (!["ui", "api", "job"].includes(m[1])) err(node.line, "UNKNOWN_NAME", `no profile \`${m[1]}\` (ui, api, job)`);
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
    } else if ((m = t.match(new RegExp(`^event\\s+(${LOWER})\\s*:\\s*(.+)$`)))) {
      // An api announces something happened: \`event ticketCreated: Ticket\` (the payload type).
      const type = parseType(m[2]);
      if (!type) err(node.line, "SYNTAX", `\`${m[2]}\` is not a type`);
      else (app.events ??= []).push({ name: m[1], type, line: node.line, note: node.note });
    } else if ((m = t.match(/^sizes\s+(.+)$/))) {
      // The sizes a host shows the screen at, smallest first: \`sizes Compact | Standard\` (choice values; the older lower-case spelling still reads). The app
      // reads \`@size\` (a value of the choice \`Size\`: \`@Compact\`) like it reads \`@now\`.
      const words = m[1].split(/\s*\|\s*/).map((w) => w.trim());
      if (words.length < 2 || words.some((w) => !/^[A-Za-z][a-zA-Z0-9]*$/.test(w))) err(node.line, "SYNTAX", "`sizes Compact | Standard`: two or more sizes, written like choice values, the default first");
      else if (app.sizes) err(node.line, "DUPLICATE", "one `sizes` line per app");
      else {
        app.sizes = words.map((w) => w[0].toUpperCase() + w.slice(1));
        app.choices.push({ name: "Size", values: app.sizes, labels: Object.fromEntries(app.sizes.map((v) => [v, v])), line: node.line });
      }
    } else if ((m = t.match(/^examples\s+start\s+at\s+(\d{4}-\d{2}-\d{2}(?:[T ]\d{2}:\d{2})?)$/))) {
      // The clock at the start of every example and random session (default 2026-01-05 09:00, a Monday).
      app.startsAt = m[1].length === 10 ? `${m[1]}T09:00` : m[1].replace(" ", "T");
      if (parseDateTime(app.startsAt) !== app.startsAt) err(node.line, "SYNTAX", `${m[1]} is not a moment that exists`);
    } else if ((m = t.match(/^every\s+(\d+(?:ms|s|m|h|d))$/))) {
      // An api's recurring work: `every 15m { - … }`, run by the clock (and by `wait` in tests).
      const ms = parseDuration(m[1])!;
      if (ms < 60000) err(node.line, "SYNTAX", "recurring work runs at most once a minute: `every 1m` or more");
      (app.jobs ??= []).push({ every: ms, name: `every${m[1]}`, ...parseBody(node, err), line: node.line });
    } else if ((m = t.match(/^every\s+endpoint\s+answers\s+([1-5]\d\d)(?:\s+(.+))?$/))) {
      // What any endpoint may answer (a layer's 401, a 429): \`every endpoint answers 401 Problem\`.
      const type = m[2] ? parseType(m[2]) : undefined;
      if (m[2] && !type) err(node.line, "SYNTAX", `\`${m[2]}\` is not a type`);
      else (app.everyAnswer ??= []).push({ status: Number(m[1]), type, line: node.line });
    } else if (t.startsWith("every ")) {
      const unit = t.match(/^every\s+(\d+)\s*(minutes?|hours?|days?|seconds?)$/);
      err(node.line, "SYNTAX", unit ? `write the interval as \`every ${unit[1]}${unit[2][0] === "s" ? "s" : unit[2][0]}\` (s, m, h or d)` : "expected `every 15m { … }` (recurring work) or `every endpoint answers 401 Problem`");
    } else if (t.startsWith("event ")) {
      err(node.line, "SYNTAX", "expected `event name: Type` (the payload), for example `event ticketCreated: Ticket`");
    } else if (t.startsWith("endpoint")) {
      err(node.line, "SYNTAX", 'expected `endpoint name GET|POST|PUT|PATCH|DELETE "/path/{id}"`, or `endpoint name` when the app implements a contract');
    } else if ((m = t.match(/^language\s+(\d+(?:\.\d+)?|v\d+)$/))) {
      // The lowest language version the spec needs (`language 1`, `language 1.2`). A pre-1 line
      // (`language v73`) reads as `language 1`; the checker warns and `intent fix` rewrites it.
      language = m[1];
      languageLine = node.line;
      app.language = m[1].startsWith("v") ? "1" : m[1];
    } else if (t.startsWith("language")) {
      err(node.line, "SYNTAX", "expected `language 1` (or `language 1.2`: the lowest version the spec needs)");
    } else if ((m = t.match(/^(implements|uses|import|extends)\s+"([^"]*)"/))) {
      // A file where a name belongs (held-out round 4): say where the file lives and how it is named.
      const file = m[2].replace(/^\.\//, "").replace(/\.intent$/, "");
      const name = /^lib\/[a-z]\w*\/[a-z]\w*$/i.test(file) ? file.slice(4).replace("/", ".") : "<area>.<name>";
      const what = m[1] === "implements" || m[1] === "uses" ? "contract" : m[1] === "extends" ? "published app" : "bundle";
      const how = m[1] === "uses" ? `uses ${name} as <alias>` : `${m[1]} ${name}`;
      err(node.line, "SYNTAX", `\`${m[1]}\` takes a ${what}'s name, not a file: \`${how}\`. A ${what} lives in \`lib/<area>/<name>.intent\` and starts with \`${what === "contract" ? "contract" : what === "bundle" ? "bundle" : "app"} <area>.<name>\` (a name is found only there); run \`intent lock\` after writing it`);
    } else if ((m = t.match(new RegExp(`^uses\\s+(${BUNDLE_NAME})$`)))) {
      err(node.line, "SYNTAX", `\`uses\` names the contract and the name you call it by: \`uses ${m[1]} as <alias>\` (then \`call @<alias>.<endpoint>\`)`);
    } else if (t.startsWith("import")) {
      err(node.line, "SYNTAX", "expected `import std.list` or `import std.list.Pager [as Alias]`");
    } else if (!parseBlock(node, app, ctx, "top")) {
      const word = t.split(/\s+/)[0];
      const hint = suggest(word, ["app", "bundle", "contract", "layer", "event", "implements", "uses", "import", "language", "profile", "endpoint", "extends", "override", "add", "drop", "design", "component", "record", "choice", "state", "clock", "derive", "screen", "on", "rules", "always", "example", "access"]);
      err(node.line, "SYNTAX", `unknown block \`${word}\`${hint}`);
    }
  });

  if (!app.name) err(1, "SYNTAX", "a spec starts with `app Name` (or a library with `bundle name`)");
  // A qualified declared name (`pager.page: Int = 1`, `button pager.next`) is what `intent expand` prints
  // for a component's own names; it reads back only in an expanded spec, which says so on a line of its own.
  if (!EXPANDED.test(src)) {
    const qualified = (name: string, line: number, what: string) =>
      name.includes(".") && err(line, "SYNTAX", `\`${name}\` is a component's own name, as \`intent expand\` prints it: declare \`${name.split(".").pop()}\` inside its component, and write \`@${name}\` where the app uses it (the app's own ${what}s have plain names)`);
    for (const f of app.state) qualified(f.name, f.line, "state field");
    for (const d of app.derive) qualified(d.name, d.line, "derived value");
    const els = (xs: Element[]) => xs.forEach((e) => (qualified(e.name, e.line, "element"), els(e.children)));
    els(app.screen);
  }
  for (const a of app.everyAnswer ?? [])
    for (const ep of app.endpoints ?? []) if (ep.answers?.length && !ep.answers.some((x) => x.status === a.status)) ep.answers.push({ ...a });
  if (app.kind === "bundle") {
    const behaviour = app.state.length || app.derive.length || app.screen.length || app.handlers.length || app.always.length || app.examples.length || app.rules.length;
    if (behaviour) err(1, "SYNTAX", "a bundle holds records, choices, components and a design; state, screens and behaviour go inside a component, examples in the bundle's demo app");
  }
  if (app.kind === "platform") {
    // A platform declares functions, and the records they take and give; its examples prove the implementation.
    const other = app.state.length || app.derive.length || app.screen.length || app.handlers.length || app.components.length || app.endpoints?.length || app.layers?.length || app.rules.length;
    if (other) err(1, "SYNTAX", "a platform holds records, choices, `function` signatures and examples; behaviour is in the installation's code");
    if (!app.functions?.length) err(1, "SYNTAX", "a platform declares at least one `function name(param: Type): Type`");
    const fns = new Map((app.functions ?? []).map((f) => [f.name, f]));
    for (const ex of app.examples)
      for (const s of ex.steps) {
        if (s.do === "call") {
          const f = fns.get(s.endpoint);
          if (!f) err(s.line, "UNKNOWN_NAME", fns.size ? `no function \`${s.endpoint}\`${suggest(s.endpoint, [...fns.keys()])}` : `no function \`${s.endpoint}\`: the platform declares none (\`function ${s.endpoint}(…): …\`)`);
          else for (const a of s.args) if (!f.params.some((p) => p.name === a.name)) err(s.line, "UNKNOWN_NAME", `\`${s.endpoint}\` has no param \`${a.name}\``);
        } else if (s.do === "see") {
          // With no function declared, the example has nothing to see (the missing `function` line is the error).
          if (fns.size && !fns.has(s.target.split(/[.[]/)[0])) err(s.line, "UNKNOWN_NAME", `\`see ${s.target}\`: see a function's latest result (\`see ${[...fns.keys()][0]} = …\`, \`see ${[...fns.keys()][0]}.field = …\`)`);
        } else err(s.line, "STEP", "a platform's example calls its functions (`call f with x = …`) and sees their results (`see f = …`)");
      }
  }
  if (app.kind === "layer") {
    // A layer wraps every request of an api: no state, no endpoints, no screen.
    const other = app.state.length || app.derive.length || app.screen.length || app.handlers.length || app.components.length || app.endpoints?.length || app.layers?.length;
    if (other) err(1, "SYNTAX", "a layer holds records, choices, `param`, `provides`, `before every request`, `after every answer`, `examples with` and examples");
    if (!app.before && !app.after && !app.beforeCall) err(1, "SYNTAX", "a layer needs `before every request` or `after every answer` (a service's layer), or `before every call` (a client's layer)");
    if (app.beforeCall && (app.before || app.after)) err(app.beforeCall.line, "SYNTAX", "a layer wraps either a service (`before every request`, `after every answer`) or a client (`before every call`), not both");
    if (app.beforeCall && app.provides?.length) err(1, "SYNTAX", "a client's layer provides nothing; it changes the calls that go out");
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
    // A refined type: a base type with a rule. `matching /re/` or `of length a to b` (`at most b`,
    // `at least a`) for Text, `from a [to b]` / `to b` for numbers.
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
    } else if (base === "Text" && (rm = rule.match(/^of\s+(\d+)\s+(.+)$/))) {
      // A code: exactly n characters from a closed alphabet, or from the characters given.
      const n = Number(rm[1]);
      const words = rm[2].trim().replace(/\s+/g, " ");
      const from = words.match(/^from\s+("(?:[^"\\]|\\.)*")$/);
      const chars = from ? parseString(from[1])! : ALPHABETS[words];
      if (chars === undefined) {
        err(node.line, "SYNTAX", `\`${words}\` is not an alphabet: a code is \`Text of <n> ${ALPHABET_NAMES.slice().reverse().join(" | ")}\`, or \`Text of <n> from "…"\` (the characters it may use)`);
        return true;
      }
      if (n < 1) err(node.line, "BAD_BINDING", `${name}: a code has at least 1 character, not ${n}`);
      if (from && new Set([...chars]).size !== [...chars].length) err(node.line, "BAD_BINDING", `${name}: \`from ${from[1]}\` lists a character twice (${[...chars].filter((c, i, a) => a.indexOf(c) !== i).map((c) => JSON.stringify(c)).join(", ")}): each character once, so each is as likely`);
      else if (from && [...chars].length < 2) err(node.line, "BAD_BINDING", `${name}: \`from ${from[1]}\` has ${[...chars].length === 1 ? "one character" : "no characters"}: a code needs at least two to choose from`);
      r.code = { n, alphabet: from ? "from" : words, chars };
    } else if (base === "Text" && (rm = rule.match(/^of\s+length\s+(?:(\d+)\s+to\s+(\d+)|at\s+most\s+(\d+)|at\s+least\s+(\d+))$/))) {
      const lo = rm[1] ?? rm[4];
      const hi = rm[2] ?? rm[3];
      if (lo !== undefined) r.minLength = Number(lo);
      if (hi !== undefined) r.maxLength = Number(hi);
      if (r.minLength !== undefined && r.maxLength !== undefined && r.minLength > r.maxLength) err(node.line, "BAD_BINDING", `${name}: a length from ${r.minLength} is above to ${r.maxLength}`);
    } else if (base !== "Text" && (rm = rule.match(/^(?:from\s+(-?\d+(?:\.\d+)?))?\s*(?:to\s+(-?\d+(?:\.\d+)?))?$/)) && (rm[1] || rm[2])) {
      if (rm[1]) r.min = Number(rm[1]);
      if (rm[2]) r.max = Number(rm[2]);
    } else {
      err(node.line, "SYNTAX", base === "Text" ? "a refined text looks like `type Email = Text matching /…/`, `type Title = Text of length 1 to 80` or `type PickupCode = Text of 6 digits`" : `a refined number looks like \`type Age = ${base} from 0 to 150\``);
      return true;
    }
    (app.refined ??= []).push(r);
  } else if ((m = t.match(new RegExp(`^record\\s+(${UPPER})$`)))) {
    onlyTop("record");
    const rec: RecordDecl = { name: m[1], fields: [], line: node.line };
    for (const c of node.children) {
      // `key id: Int`: the field another record's `ref` holds.
      const key = /^key\s+/.test(c.text);
      const f = parseField(key ? { ...c, text: c.text.replace(/^key\s+/, "") } : c, err, false);
      if (!f) continue;
      rec.fields.push(f);
      if (key && rec.key) err(c.line, "DUPLICATE", `record ${rec.name} has one key: \`${rec.key}\` is already its key`);
      else if (key) rec.key = f.name;
    }
    if (!rec.fields.length) err(node.line, "SYNTAX", `record ${rec.name} has no fields`);
    app.records.push(rec);
  } else if ((m = t.match(new RegExp(`^choice\\s+(${UPPER})\\s*(?::\\s*(.*))?$`)))) {
    onlyTop("choice");
    // Values, each optionally with a display label and a wire name (its text in JSON, for an api
    // that already exists): `choice Level: Info "Information" = "info" | Warn = "warn"`.
    const values: string[] = [];
    const labels: Record<string, string> = {};
    const wire: Record<string, string> = {};
    const badValues = new Set<string>();
    const addValue = (raw: string, line: number, col = 1) => {
      const vm = raw.trim().match(new RegExp(`^(${UPPER})(?:\\s+(${STR}))?(?:\\s*=\\s*(${STR}))?$`));
      if (!vm) {
        // Said once per line and text (`Paid | |` has two empty values: one mistake).
        if (badValues.has(`${line}|${raw.trim()}`)) return;
        badValues.add(`${line}|${raw.trim()}`);
        return err(line, "SYNTAX", raw.trim() ? `choice value \`${raw.trim()}\` must be an UpperCamel name, optionally followed by a "label" and \`= "wire name"\`` : "a choice value is empty: remove the extra `|`", col);
      }
      values.push(vm[1]);
      labels[vm[1]] = vm[2] !== undefined ? parseString(vm[2])! : vm[1];
      if (vm[3] !== undefined) {
        const w = parseString(vm[3])!;
        if (Object.values(wire).includes(w)) err(line, "DUPLICATE", `the wire name "${w}" is already another value's`, col);
        wire[vm[1]] = w;
      }
    };
    if (m[2] !== undefined && m[2].trim()) for (const v of splitCells(m[2])) addValue(v, node.line);
    for (const c of node.children) addValue(c.text, c.line, c.indent + 1);
    if (values.length < 2) err(node.line, "SYNTAX", `choice ${m[1]} needs at least two values, e.g. \`choice ${m[1]}: A | B\``);
    const some = Object.keys(wire).length;
    if (some && some < values.length) err(node.line, "SYNTAX", `choice ${m[1]}: give every value a wire name, or none (${values.filter((v) => !(v in wire)).join(", ")} has none)`);
    app.choices.push({ name: m[1], values, labels, ...(some ? { wire } : {}), line: node.line });
  } else if (t === "design") {
    onlyTop("design");
    app.design = parseDesign(node, err);
  } else if ((m = t.match(new RegExp(`^component\\s+(${UPPER})(?:\\s+as\\s+([a-z]+))?(?:\\s+(${STR}))?$`)))) {
    onlyTop("component");
    app.components.push(parseComponent(node, m[1], m[2], m[3], ctx));
  } else if (t === "state") {
    for (const c of node.children) {
      const stored = /^stored\s+/.test(c.text);
      const f = parseField(stored ? { ...c, text: c.text.replace(/^stored\s+/, "") } : c, err, true, true);
      if (f) app.state.push(stored ? { ...f, stored } : f);
    }
  } else if ((m = t.match(/^clock\s+every\s+(\S+)$/))) {
    onlyTop("clock");
    const ms = parseDuration(m[1]);
    if (ms === undefined || ms <= 0) err(node.line, "SYNTAX", "expected a duration such as `250ms`, `1s`, `2m`, `1h` or `1d`");
    else app.clockMs = ms;
    ctx.clockLine = node.line;
  } else if (t === "derive") {
    for (const c of node.children) {
      // `name = sentence`, or with its type declared: `total: Decimal = the sum of …` (then checked).
      const dm = c.text.match(new RegExp(`^(${DECL})\\s*(?::\\s*([^=]+?))?\\s*=\\s*(.+)$`));
      if (!dm) err(c.line, "SYNTAX", "a derived value looks like `name = sentence` (or `name: Type = sentence`)", c.indent + 1);
      else {
        const type = dm[2] ? parseType(dm[2].trim()) : undefined;
        if (dm[2] && !type) err(c.line, "SYNTAX", `\`${dm[2].trim()}\` is not a type`, c.indent + 1);
        app.derive.push({ name: dm[1], sentence: dm[3] + flattenChildren(c), ...(type ? { type } : {}), line: c.line, note: c.note });
      }
    }
  } else if (t === "screen") {
    if (app.screens?.length) err(node.line, "SYNTAX", "this app has named screens: give this one a name and a path too (`screen <name> \"/path\"`)");
    app.screen = node.children.map((c) => parseElement(c, err, 0)).filter((e): e is Element => !!e);
  } else if ((m = t.match(new RegExp(`^screen\\s+(${LOWER})\\s+(${STR})$`)))) {
    // One of several screens, with its address; `path x: T` lines are its params.
    const path = parseString(m[2])!;
    if (!path.startsWith("/")) err(node.line, "SYNTAX", "a screen's path starts with `/`");
    else if (!SAFE_PATH.test(path)) err(node.line, "SYNTAX", `\`${path}\`: a path is \`/\` and then letters, digits, \`. _ ~ - /\` and \`{param}\` holes (\`"/tickets/{id}"\`)`);
    if (app.screen.length && !app.screens?.length) err(node.line, "SYNTAX", "this app has an unnamed `screen`: with several screens, each has a name and a path");
    if (app.screens?.some((s) => s.name === m![1])) err(node.line, "DUPLICATE", `screen \`${m[1]}\` is declared twice`);
    const decl: ScreenDecl = { name: m[1], path, params: [], line: node.line, note: node.note };
    for (const c of node.children) {
      const pm = c.text.match(new RegExp(`^path\\s+(${LOWER})\\s*:\\s*(.+)$`));
      if (pm) {
        const type = parseType(pm[2]);
        if (!type) err(c.line, "SYNTAX", `\`${pm[2]}\` is not a type`, c.indent + 1);
        else decl.params.push({ name: pm[1], type, line: c.line });
        continue;
      }
      const el = parseElement(c, err, 0);
      if (el) app.screen.push({ ...el, screen: m[1] });
    }
    (app.screens ??= []).push(decl);
  } else if ((m = t.match(new RegExp(`^on\\s+open\\s+(${LOWER})$`)))) {
    // Runs every time that screen is shown: from a link, an address, or going back.
    app.handlers.push({ verb: "open", target: m[1], ...parseBody(node, err), line: node.line, note: node.note });
  } else if ((m = t.match(new RegExp(`^on\\s+(${VERBS}|answer|event)\\s+(${QN})$`))) || (m = t.match(new RegExp(`^on\\s+(${CLOCK_VERBS}|start)$`)))) {
    const h: Handler = { verb: m[1] as Verb, target: m[2] ?? "", ...parseBody(node, err), line: node.line, note: node.note };
    app.handlers.push(h);
  } else if (t.startsWith("on ")) {
    err(node.line, "SYNTAX", `expected \`on ${VERBS} <element>\` or \`on ${CLOCK_VERBS}\``);
  } else if (t === "always") {
    for (const c of node.children) {
      if (c.text.startsWith("- ")) {
        // A sentence over the data (state, derived values): checked after every step of every session.
        (app.invariants ??= []).push({ text: (c.text.slice(2) + flattenChildren(c)).trim(), line: c.line });
        continue;
      }
      const r = parseStep(c, err, where === "component");
      if (!r) continue;
      if (r.step.do !== "see") err(c.line, "SYNTAX", "`always` holds `see` checks (the screen) and `- sentence` lines (the data)", c.indent + 1);
      else if (r.step.at) err(c.line, "SYNTAX", "`always` checks cannot point at a row", c.indent + 1);
      else app.always.push(r.step);
    }
    if (!node.children.length) err(node.line, "SYNTAX", "expected `see …` checks or `- sentence` lines");
  } else if ((m = t.match(/^rules(?:\s+by\s+(\S+))?$/))) {
    // `rules by ai { … }`: rules an LLM wrote (and may revise); plain `rules` are the person's.
    if (m[1] && m[1] !== "ai" && m[1] !== "human") err(node.line, "SYNTAX", "`rules by ai` or `rules by human` (who wrote them; without `by`, a person did)");
    const by = m[1] === "ai" ? "ai" : "human";
    const lines: number[] = [];
    const texts = parseBullets(node, err, lines);
    app.ruleBy = [...(app.ruleBy ?? app.rules.map(() => "human" as const)), ...texts.map(() => by)];
    app.rules.push(...texts);
    (app.ruleLines ??= []).push(...lines);
  } else if (t === "relations") {
    err(node.line, "SYNTAX", "a relation is said on the field that holds the key: `ticket: ref Ticket` in the record (the `relations` block is gone since v59)");
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

/** What a path (an endpoint's or a screen's) may hold: it goes into generated code, comments and URLs as is. */
const SAFE_PATH = /^\/[A-Za-z0-9._~{}\/-]*$/;

/** `endpoint name METHOD "/path/{id}"` with `path|query|body x: Type`, `returns T` and `- steps`. */
function parseEndpoint(node: Line, name: string, method: Endpoint["method"], path: string, ctx: Ctx): Endpoint {
  const { err } = ctx;
  const ep: Endpoint = { name, method, path, params: [], steps: [], line: node.line, note: node.note };
  if (path && !SAFE_PATH.test(path)) err(node.line, "SYNTAX", `\`${path}\`: a path is \`/\` and then letters, digits, \`. _ ~ - /\` and \`{param}\` holes (\`"/tickets/{id}/notes"\`); anything else is a query or body param`);
  const stmts: Line[] = [];
  for (const c of node.children) {
    let m: RegExpMatchArray | null;
    if ((m = c.text.match(new RegExp(`^(path|query|body)\\s+(${LOWER})\\s*:\\s*(.+)$`)))) {
      const type = parseType(m[3]);
      if (!type) err(c.line, "SYNTAX", `\`${m[3]}\` is not a type`, c.indent + 1);
      else ep.params.push({ in: m[1] as "path", name: m[2], type, line: c.line });
    } else if ((m = c.text.match(/^answers\s+([1-5]\d\d)(?:\s+(.+))?$/))) {
      const type = m[2] ? parseType(m[2]) : undefined;
      if (m[2] && !type) err(c.line, "SYNTAX", `\`${m[2]}\` is not a type`, c.indent + 1);
      // One body type per status: a second `answers 201` is a mistake, not another answer.
      if (ep.answers?.some((a) => a.status === Number(m![1]))) err(c.line, "DUPLICATE", `endpoint ${ep.name} already answers ${m[1]}; give each status one \`answers\` line`, c.indent + 1);
      else (ep.answers ??= []).push({ status: Number(m[1]), type, line: c.line });
    } else if ((m = c.text.match(new RegExp(`^effect\\s+(\\S+)(?:\\s+of\\s+@(${LOWER}))?$`)))) {
      if (m[1] === "external") ep.effect = { kind: "external", ...(m[2] ? { of: m[2] } : {}), line: c.line };
      else err(c.line, "SYNTAX", `the only effect is \`effect external\` (it reaches outside the system: money, mail, another company's service), optionally \`effect external of @amount\` (the param that says how much). Keys and retries follow from the method, so there is no other kind to declare`, c.indent + 1);
    } else if ((m = c.text.match(new RegExp(`^undone\\s+by\\s+(${LOWER})(?:\\s+with\\s+(.+))?$`)))) {
      const args: { name: string; value: string }[] = [];
      for (const part of m[2] ? m[2].split(/\s*,\s*/) : []) {
        const a = part.match(new RegExp(`^(${LOWER})\\s*=\\s*(@[a-z][\\w.]*)$`));
        if (a) args.push({ name: a[1], value: a[2] });
        else err(c.line, "SYNTAX", `\`${part}\`: write \`name = @${name}.body.field\` (from this call's answer) or \`name = @param\` (from this call)`, c.indent + 1);
      }
      ep.undoneBy = { endpoint: m[1], args, line: c.line };
    } else if ((m = c.text.match(/^returns\s+(.+)$/))) {
      const type = parseType(m[1]);
      if (!type) err(c.line, "SYNTAX", `\`${m[1]}\` is not a type`, c.indent + 1);
      else ep.returns = type;
    } else if (/^(- |if\s|else\b|for\s+each\s|answer\s|stop$)/.test(c.text)) stmts.push(c);
    else err(c.line, "SYNTAX", "inside an endpoint: `path|query|body name: Type`, `answers 201 Type`, `effect external`, `undone by …`, `- step`, `if … {`, `for each @x in @xs whose … {`, `answer …` or `stop`", c.indent + 1);
  }
  if (stmts.length) {
    ep.body = parseStmts(stmts, err);
    const flat = flattenBody(ep.body);
    ep.steps = flat.steps;
    ep.stepLines = flat.lines;
  }
  return ep;
}

/** `override …`, `add to <section> [after <element>]`, `drop …`: the explicit changes of a refining spec. */
function parseRefinement(node: Line, ctx: Ctx): Refinement | undefined {
  const { err } = ctx;
  const t = node.text;
  let m: RegExpMatchArray | null;
  if ((m = t.match(/^override\s+(heading|text|field|button|checkbox|select|list|section|progress|use)\s/))) {
    const el = parseElement({ ...node, text: t.slice("override ".length) }, err, 0);
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
    return { op: "override-handler", handler: { verb: m[1] as Verb, target: m[2], ...parseBody(node, err), line: node.line, note: node.note }, line: node.line };
  }
  if ((m = t.match(new RegExp(`^override\\s+component\\s+(${UPPER})(?:\\s+as\\s+([a-z]+))?(?:\\s+(${STR}))?$`)))) {
    return { op: "override-component", component: parseComponent(node, m[1], m[2], m[3], ctx), line: node.line };
  }
  if ((m = t.match(new RegExp(`^add\\s+to\\s+(${QN})(?:\\s+after\\s+(${QN}))?$`)))) {
    const elements = node.children.map((c) => parseElement(c, err, 0)).filter((e): e is Element => !!e);
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

/**
 * A job (`profile job`) has no screen: it works on events, answers and the clock. The harness shows
 * its state instead — a text per value, a list per list (its rows' plain fields) — so examples
 * (`see sent has 2 rows`), twin builds and random sessions work as for any app, and nobody writes
 * a screen for it. A job with a screen, or with endpoints, is a mistake.
 */
export function jobScreen(app: App, err: Err) {
  if (app.profile !== "job") return;
  if (app.screen.length) return err(app.screen[0].line, "SYNTAX", "a job has no screen: the harness shows its state (`profile job`)");
  if (app.endpoints?.length) return err(app.endpoints[0].line, "SYNTAX", "a job has no endpoints: it calls apis (`uses`) and handles their events");
  if (app.sizes) return err(1, "SYNTAX", "a job is not shown, so it has no `sizes`");
  const records = new Map(app.records.map((r) => [r.name, r]));
  const plain = (t: Type): boolean => (t.k === "Maybe" ? plain(t.of) : t.k === "Named" ? !records.has(t.name) : t.k !== "List");
  for (const f of app.state) {
    const t = f.type.k === "Maybe" ? f.type.of : f.type;
    if (t.k === "List" && t.of.k === "Named" && records.has(t.of.name))
      app.screen.push({ kind: "list", name: f.name, of: t.of.name, children: records.get(t.of.name)!.fields.filter((x) => plain(x.type)).map((x) => ({ kind: "text" as const, name: x.name, children: [], line: f.line })), line: f.line });
    else if (t.k === "List" && plain(t.of)) app.screen.push({ kind: "list", name: f.name, of: typeToString(t.of), children: [], line: f.line });
    else if (plain(f.type)) app.screen.push({ kind: "text", name: f.name, children: [], line: f.line });
  }
}

/** Parse and check a self-contained file (no imports). Files with imports go through `load()`. */
export function parse(src: string): { app?: App; diagnostics: Diagnostic[] } {
  const { app, diagnostics, clockLine } = parseSyntax(src);
  const err: Err = (line, code, message, col = 1) => diagnostics.push({ level: "error", code, line, col, message });
  const warn: Err = (line, code, message, col = 1) => diagnostics.push({ level: "warning", code, line, col, message });
  if (app.imports?.length) err(app.imports[0].line, "SYNTAX", "this file imports bundles; check it with `intent check` (which resolves imports), not `parse()`");
  // Semantic checks run even after syntax errors, so one pass reports as much as possible.
  else if (app.name && app.kind !== "bundle" && app.kind !== "platform") {
    // `Problem` is the body of every refusal (`{ "error": "…" }`), built in for services and contracts, as load() has it.
    if ((app.profile === "api" || app.kind === "contract") && !app.records.some((r) => r.name === "Problem")) app.records.push({ name: "Problem", fields: [{ name: "error", type: { k: "Text" }, line: 0 }], line: 0 });
    const used = expandUses(app, err, warn);
    jobScreen(app, err);
    check(app, err, warn, clockLine, used);
    checkRefs(app, err);
    checkLookups(app, err);
    checkLoops(app, err);
    checkFit(app, err, new Set(diagnostics.filter((d) => d.code === "SYNTAX").map((d) => d.line)));
    checkDraws(app, err);
    checkBodies(app, err);
    checkDisabledClicks(app, err);
    checkEffects(app, err);
    checkScreens(app, err);
    checkAccess(app, err, warn);
    // std.quality's hints (compiler/quality): the compiler decides what the spec means, they what makes it good.
    diagnostics.splice(0, diagnostics.length, ...withStdQuality("", app, diagnostics));
  }
  diagnostics.sort((a, b) => a.line - b.line || a.col - b.col);
  return { app: diagnostics.some((d) => d.level === "error") ? undefined : app, diagnostics };
}

/** Semantic checks on a complete (expanded) app. */
export function checkApp(app: App, clockLine: number, used = new Set<string>(), syntaxLines = new Set<number>()): Diagnostic[] {
  const diags: Diagnostic[] = [];
  if (app.kind === "platform") return diags; // checked while parsing (its functions and examples)
  const err: Err = (line, code, message, col = 1) => diags.push({ level: "error", code, line, col, message });
  const warn: Err = (line, code, message, col = 1) => diags.push({ level: "warning", code, line, col, message });
  check(app, err, warn, clockLine, used);
  checkRefs(app, err);
  checkLookups(app, err);
  checkLoops(app, err);
  checkFit(app, err, syntaxLines);
  checkDraws(app, err);
  checkBodies(app, err);
  checkDisabledClicks(app, err);
  checkEffects(app, err);
  checkScreens(app, err);
  checkAccess(app, err, warn);
  return diags;
}

/**
 * Several screens (docs/design/screens.md): every `{x}` in a path is a declared `path x: T` and
 * back; no two screens answer the same address; a path param does not shadow other names;
 * `go to @screen` names a screen and binds every one of its path params.
 */
function checkScreens(app: App, err: Err) {
  const screens = app.screens ?? [];
  const byName = new Map(screens.map((s) => [s.name, s]));
  const shapes = new Map<string, string>();
  const taken = new Set([...app.state.map((f) => f.name), ...app.derive.map((d) => d.name), ...app.screen.map((e) => e.name)]);
  for (const s of screens) {
    if (s.line >= LINE_BASE) continue;
    const holes = [...s.path.matchAll(/\{([a-z]\w*)\}/gi)].map((x) => x[1]);
    for (const h of holes) if (!s.params.some((p) => p.name === h)) err(s.line, "UNKNOWN_NAME", `path \`${s.path}\` has \`{${h}}\`: declare it in the screen as \`path ${h}: Type\``);
    for (const p of s.params) {
      if (!["Int", "Text", "Date", "DateTime"].includes(p.type.k)) err(p.line, "NOT_YET", `a path param is an Int, a Text, a Date or a DateTime (so far), not ${typeToString(p.type)}`);
      if (!holes.includes(p.name)) err(p.line, "UNKNOWN_NAME", `\`path ${p.name}\` is not in the path \`${s.path}\`: write \`{${p.name}}\` where it goes`);
      if (taken.has(p.name)) err(p.line, "DUPLICATE", `\`${p.name}\` is already a name in this app (state, derived value or element); give the path param another name`);
    }
    // Two paths are the same address when they differ only in their params' names.
    const shape = s.path.replace(/\{[a-z]\w*\}/gi, "{}");
    if (shapes.has(shape)) err(s.line, "DUPLICATE", `screens \`${shapes.get(shape)}\` and \`${s.name}\` have the same address (\`${s.path}\`)`);
    shapes.set(shape, s.name);
  }
  for (const h of app.handlers) {
    if (h.line >= LINE_BASE) continue;
    for (const [i, st] of h.steps.entries()) {
      const line = h.stepLines?.[i] ?? h.line;
      // `go back` returns to the previous address: `go back to @screen` would read the target as prose and ignore it.
      if (/\bgo\s+back\s+to\s+@[a-z]/i.test(st)) err(line, "STEP", "`go back` takes no target: `go back` returns to the previous address; to name one, use `go to @screen …`");
      for (const m of st.matchAll(/\bgo\s+to\s+@?([a-z]\w*)(?:\s+with\s+([^.;]+))?/gi)) {
        const target = byName.get(m[1]);
        if (!target) {
          err(line, "UNKNOWN_NAME", `\`go to\` names a screen; there is no screen \`${m[1]}\`${screens.length ? suggest(m[1], screens.map((s) => s.name)) : " (this app has one screen)"}`);
          continue;
        }
        const bound = new Set([...(m[2] ?? "").matchAll(/@?([a-z]\w*)\s*=/gi)].map((x) => x[1]));
        for (const p of target.params) if (!bound.has(p.name)) err(line, "STEP", `\`go to @${target.name}\` needs its path param: \`go to @${target.name} with @${p.name} = …\``);
      }
    }
  }
}

/**
 * Effects (docs/design/effects.md): `undone by` names an endpoint of the same service, binds
 * every param it needs, from this call's params or its answer; a read has no effect. On the
 * calling side, a point of no return (external, no `undone by`) comes after the steps that can
 * still be undone.
 */
function checkEffects(app: App, err: Err) {
  const own = (line: number) => line < LINE_BASE;
  const eps = app.endpoints ?? [];
  const records = new Map(app.records.map((r) => [r.name, r]));
  // The type at `a.b.c` inside a type, through records (and lists' items not: a field of a list is a mistake).
  const fieldPath = (t: Type | undefined, path: string[]): Type | undefined => {
    for (const f of path) {
      const inner: Type | undefined = t?.k === "Maybe" ? t.of : t;
      const r = inner?.k === "Named" ? records.get(inner.name) : undefined;
      t = r?.fields.find((x) => x.name === f)?.type;
      if (!t) return undefined;
    }
    return t;
  };
  for (const ep of eps) {
    // Declared in this file (an implementing app gets them from its contract, checked there).
    if (ep.method === "GET" && ep.effect && own(ep.effect.line)) err(ep.effect.line, "EFFECT", `endpoint ${ep.name} is a GET: it only reads, so it has no effect to declare`);
    // `effect external of @amount`: a permission's amount limit reads this param, so it must be a number the call sends.
    const of = ep.effect?.of;
    if (of && own(ep.effect!.line)) {
      const p = ep.params.find((x) => x.name === of);
      const t = p?.type.k === "Maybe" ? p.type.of : p?.type;
      if (!p) err(ep.effect!.line, "UNKNOWN_NAME", `endpoint ${ep.name} has no param \`${of}\` to measure its effect by${suggest(of, ep.params.map((x) => x.name))}`);
      else if (!(t?.k === "Int" || t?.k === "Decimal" || (t?.k === "Named" && (app.refined ?? []).some((r) => r.name === t.name && r.base !== "Text")))) err(ep.effect!.line, "TYPE", `\`effect external of @${of}\`: \`${of}\` is ${typeToString(p.type)}; an amount is an Int or a Decimal`);
    }
    const u = ep.undoneBy;
    if (!u || !own(u.line)) continue;
    if (ep.method === "GET") {
      err(u.line, "EFFECT", `endpoint ${ep.name} is a GET: a read has nothing to undo`);
      continue;
    }
    const undo = eps.find((e) => e.name === u.endpoint);
    if (!undo) {
      err(u.line, "UNKNOWN_NAME", `no endpoint \`${u.endpoint}\` in this service to undo ${ep.name} with${suggest(u.endpoint, eps.map((e) => e.name))}`);
      continue;
    }
    if (undo === ep) err(u.line, "EFFECT", `endpoint ${ep.name} cannot undo itself`);
    else if (undo.undoneBy) err(u.line, "EFFECT", `\`${undo.name}\` has an \`undone by\` of its own: an undo is the last step back, it is not undone again`);
    const ok = ep.answers?.find((a) => a.status < 300 && a.type)?.type ?? ep.returns;
    for (const a of u.args) {
      if (!undo.params.some((p) => p.name === a.name)) err(u.line, "UNKNOWN_NAME", `\`${undo.name}\` has no param \`${a.name}\`${suggest(a.name, undo.params.map((p) => p.name))}`);
      const path = a.value.slice(1).split(".");
      if (path[0] === ep.name && path[1] === "body") {
        if (!ok) err(u.line, "EFFECT", `${a.value}: ${ep.name} answers no body to take it from`);
        else if (path.length > 2 && !fieldPath(ok, path.slice(2))) err(u.line, "UNKNOWN_NAME", `${a.value}: ${ep.name}'s answer (${typeToString(ok)}) has no \`${path.slice(2).join(".")}\``);
      } else if (!(path.length === 1 && ep.params.some((p) => p.name === path[0]))) err(u.line, "UNKNOWN_NAME", `${a.value}: bind to \`@${ep.name}.body.<field>\` (this call's answer) or to one of its params (${ep.params.map((p) => `@${p.name}`).join(", ") || "it has none"})`);
    }
    for (const p of undo.params) if (p.type.k !== "Maybe" && !u.args.some((a) => a.name === p.name)) err(u.line, "EFFECT", `\`${undo.name}\` needs \`${p.name}\`: bind it (\`with ${p.name} = …\`)`);
  }
}

/**
 * A lookup is a form: `the @tickets whose @status is @Open` or `the @tickets where …` looks in a
 * list or a derived value, named after the `@`. The checker names it, so a typo is an error, not a
 * sentence the compiler silently reads as something else.
 */
function checkLookups(app: App, err: Err) {
  const lists = new Set([...app.state.filter((f) => f.type.k === "List").map((f) => f.name), ...app.derive.map((d) => d.name), ...(app.params ?? []).filter((p) => p.type.k === "List").map((p) => p.name)]);
  const singular = new Set(app.records.map((r) => r.name[0].toLowerCase() + r.name.slice(1)));
  for (const s of sentences(app)) {
    if (s.line >= LINE_BASE) continue; // from a bundle or contract: checked there
    const loops = new Set([...s.text.matchAll(/\bfor each @([a-z]\w*)/g)].map((m) => m[1]));
    for (const m of s.text.matchAll(/\bthe\s+@([a-z]\w*)\s+(?:whose|where)\b/g))
      if (!lists.has(m[1]) && !loops.has(m[1])) err(s.line, "UNKNOWN_NAME", `\`@${m[1]}\` (${s.where}) is not a state list or a derived value to look in`);
  }
}

/**
 * `for each @x in @xs where … { … }`: `@x` names the row inside the block only, it does not hide a
 * name the app already has, and `@xs` is a list.
 */
function checkLoops(app: App, err: Err) {
  const own = new Set([...app.state.map((f) => f.name), ...app.derive.map((d) => d.name), ...(app.params ?? []).map((p) => p.name)]);
  const fields = new Set(app.records.flatMap((r) => r.fields.map((f) => f.name)));
  const typeOf = new Map<string, Type>([...app.state.map((f) => [f.name, f.type] as const), ...(app.params ?? []).map((p) => [p.name, p.type] as const)]);
  const loops = new Set<string>();
  const collect = (b?: Stmt[]) => (b ?? []).forEach((s) => (s.k === "for" ? (loops.add(s.name), collect(s.body)) : s.k === "if" ? s.branches.forEach((br) => collect(br.body)) : undefined));
  const bodies = [...app.handlers.map((h) => h.body), ...(app.endpoints ?? []).map((e) => e.body), ...(app.jobs ?? []).map((j) => j.body)];
  bodies.forEach(collect);
  // A loop's name used outside its loop (and not a name the app has otherwise) names nothing there.
  const stray = [...loops].filter((x) => !own.has(x) && !fields.has(x));
  const roots = (text: string) => refsIn(text).map((r) => r.split(".")[0]);
  const walk = (b: Stmt[] | undefined, scope: Set<string>) => {
    for (const st of b ?? []) {
      const line = st.k === "if" ? st.branches[0].line : st.line;
      if (line >= LINE_BASE) continue;
      const texts = st.k === "if" ? st.branches.map((br) => br.cond ?? "") : st.k === "for" ? [st.list] : "text" in st ? [st.text as string] : [];
      for (const t of texts) for (const r of roots(t)) if (stray.includes(r) && !scope.has(r)) err(line, "UNKNOWN_NAME", `\`@${r}\` is the row of a \`for each\` elsewhere: it names nothing outside its own block`);
      if (st.k === "if") st.branches.forEach((br) => walk(br.body, scope));
      if (st.k === "for") {
        if (own.has(st.name)) err(st.line, "DUPLICATE", `the loop's row \`@${st.name}\` would hide the app's own \`${st.name}\`: give the row another name`);
        const list = st.list.replace(/^@/, "").split(".")[0];
        const t = typeOf.get(list);
        if (t && !st.list.includes(".") && t.k !== "List") err(st.line, "TYPE", `\`for each … in @${list}\`: \`${list}\` is ${typeToString(t)}, not a list`);
        const inner = new Set([...scope, st.name]);
        for (const r of roots(st.where ?? "")) if (stray.includes(r) && !inner.has(r)) err(st.line, "UNKNOWN_NAME", `\`@${r}\` is the row of a \`for each\` elsewhere: it names nothing outside its own block`);
        walk(st.body, inner);
      }
    }
  };
  bodies.forEach((b) => walk(b, new Set()));
}


/**
 * Structure in bodies: an endpoint answers on every path; nothing follows `answer` or `stop` in
 * its block; `answer` only where there is a request to answer. Control words written as prose
 * ("- if …, … and stop") get a hint with the structured form.
 */
function checkBodies(app: App, err: Err) {
  const ends = (s: Stmt, withStop: boolean): boolean =>
    s.k === "answer" || (withStop && s.k === "stop") || (s.k === "step" && /^answer\s/.test(s.text)) || (s.k === "if" && s.branches.some((b) => b.cond === undefined) && s.branches.every((b) => endsBlock(b.body, withStop)));
  const endsBlock = (b: Stmt[], withStop: boolean) => b.some((s) => ends(s, withStop));
  const lineOf = (s: Stmt) => (s.k === "if" ? s.branches[0].line : s.line);
  const walk = (b: Stmt[], where: string, canAnswer: boolean) => {
    b.forEach((s, i) => {
      if (i > 0 && ends(b[i - 1], true)) err(lineOf(s), "UNREACHABLE", `this never runs: the step before it ${b[i - 1].k === "stop" ? "stops" : "answers"} (${where})`);
      if (s.k === "answer" && !canAnswer) err(s.line, "STEP", `\`answer\` is for an endpoint (or a layer's \`before every request\`); ${where} has no request to answer`);
      if (s.k === "stop" && where.startsWith("endpoint")) err(s.line, "STEP", "an endpoint ends a path with `answer …`, not `stop`: a path that stops answers nothing");
      if (s.k === "if") s.branches.forEach((br) => walk(br.body, where, canAnswer));
      if (s.k === "for") walk(s.body, where, canAnswer);
    });
  };
  for (const h of app.handlers) if (h.body) walk(h.body, `on ${h.verb}${h.target ? " " + h.target : ""}`, false);
  for (const j of app.jobs ?? []) if (j.body) walk(j.body, `every ${j.name.slice(5)}`, false);
  if (app.before?.body) walk(app.before.body, "before every request", true);
  if (app.after?.body) walk(app.after.body, "after every answer", false);
  if (app.beforeCall?.body) walk(app.beforeCall.body, "before every call", false);
  for (const ep of app.endpoints ?? []) {
    if (!ep.body) continue;
    walk(ep.body, `endpoint ${ep.name}`, true);
    if (ep.line < LINE_BASE && !endsBlock(ep.body, false)) err(ep.line, "NO_ANSWER", `endpoint ${ep.name} does not answer on every path: end it with \`answer …\`, or give every \`if\` an \`else\` that answers`);
  }
}


/**
 * References in sentences: every `@name` must be declared; a bare word that is a declared name
 * gets a hint to mark it (it may also just be English: "the title of the page").
 */
function checkRefs(app: App, err: Err) {
  const names = declaredNames(app);
  const said = new Set<string>(); // an element's value and its `visible when` are said on one line: a name once
  for (const s of sentences(app)) {
    if (s.line >= LINE_BASE) continue; // from a bundle or contract: checked there
    // `@path.id` / `@query.q` / `@body.room`: a request param, told apart from a field with the same
    // name. Only inside an endpoint's own steps.
    const ep = s.where.startsWith("endpoint ") ? app.endpoints?.find((e) => e.name === s.where.slice("endpoint ".length)) : undefined;
    for (const r of new Set(refsIn(s.text))) {
      // Each name once per sentence (`@missing plus @missing` is one undeclared name), and per line.
      if (said.has(`${s.line}|${s.where}|${r}`)) continue;
      said.add(`${s.line}|${s.where}|${r}`);
      const q = r.match(/^(path|query|body)\.([a-z]\w*)$/);
      if (q) {
        const p = ep?.params.find((x) => x.name === q[2]);
        if (!ep) err(s.line, "UNKNOWN_NAME", `\`@${r}\` names a request param, which only an endpoint's steps can write`);
        else if (!p) err(s.line, "UNKNOWN_NAME", `endpoint ${ep.name} has no param \`${q[2]}\` (${ep.params.map((x) => x.name).join(", ") || "none"})`);
        else if (p.in !== q[1]) err(s.line, "UNKNOWN_NAME", `\`${q[2]}\` is a ${p.in} param, not ${q[1]}: write \`@${p.in}.${q[2]}\``);
      } else if (!resolves(r, names)) err(s.line, "UNKNOWN_NAME", `\`@${r}\` (${s.where}) is not declared${suggest(r, [...names])}`);
    }
  }
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

/**
 * A body: `- step` lines, `if … { } else if … { } else { }`, `answer …` and `stop`. Returns the
 * structure, and its flat text (conditions as "if …", answers as "answer …") with a line per entry.
 */
function parseBody(node: Line, err: (l: number, c: string, m: string, col?: number) => void): { body: Stmt[]; steps: string[]; stepLines: number[] } {
  const body = parseStmts(node.children, err);
  if (!node.children.length) err(node.line, "SYNTAX", "expected at least one step");
  const { steps, lines } = flattenBody(body);
  return { body, steps, stepLines: lines };
}

function parseStmts(children: Line[], err: (l: number, c: string, m: string, col?: number) => void): Stmt[] {
  const out: Stmt[] = [];
  for (const c of children) {
    let m: RegExpMatchArray | null;
    if (c.text.startsWith("- ")) out.push({ k: "step", text: (c.text.slice(2) + flattenChildren(c)).trim(), line: c.line });
    else if ((m = c.text.match(/^if\s+(.+)$/))) {
      if (!c.children.length) err(c.line, "SYNTAX", "`if …` needs a block: `if <condition> {` with the steps inside, then `}`", c.indent + 1);
      out.push({ k: "if", branches: [{ cond: m[1], body: parseStmts(c.children, err), line: c.line }] });
    } else if ((m = c.text.match(/^else(?:\s+if\s+(.+))?$/))) {
      const prev = out[out.length - 1];
      if (!prev || prev.k !== "if" || prev.branches[prev.branches.length - 1].cond === undefined) err(c.line, "SYNTAX", "`else` belongs right after an `if` block: `} else {`", c.indent + 1);
      else prev.branches.push({ cond: m[1], body: parseStmts(c.children, err), line: c.line });
    } else if ((m = c.text.match(/^for\s+each\s+@?([a-z]\w*)\s+in\s+((?:its\s+@|(?:that|this)\s+[a-z]\w*['’]s\s+@|@)?[a-z]\w*(?:\.[a-z]\w*)*(?:['’]s\s+@[a-z]\w*)*)(?:\s+(where|whose)\s+(.+))?$/))) {
      // The list: a state list or a derived one (\`@xs\`), or a row's inner list (\`that chore's @steps\`, \`its @items\`).
      if (!c.children.length) err(c.line, "SYNTAX", "`for each …` needs a block: `for each @x in @xs whose … {` with the steps inside, then `}`", c.indent + 1);
      const list = /^[a-z]/.test(m[2]) && !/^(?:its|that|this)\s/.test(m[2]) ? `@${m[2]}` : m[2];
      out.push({ k: "for", name: m[1], list, where: m[4], ...(m[3] === "whose" ? { whose: true } : {}), body: parseStmts(c.children, err), line: c.line });
    } else if ((m = c.text.match(/^answer\s+(.+)$/))) out.push({ k: "answer", text: m[1], line: c.line });
    else if (c.text === "stop") out.push({ k: "stop", line: c.line });
    else err(c.line, "SYNTAX", "a step is `- sentence`, `if <condition> {`, `for each @x in @xs whose … {`, `} else {`, `answer …` or `stop`", c.indent + 1);
  }
  return out;
}

/** The flat text of a body: every step, every condition ("if …"), every answer ("answer …"), with its line. */
export function flattenBody(body: Stmt[]): { steps: string[]; lines: number[] } {
  const steps: string[] = [];
  const lines: number[] = [];
  const walk = (b: Stmt[]) => {
    for (const s of b) {
      if (s.k === "step") (steps.push(s.text), lines.push(s.line));
      else if (s.k === "answer") (steps.push(`answer ${s.text}`), lines.push(s.line));
      else if (s.k === "for") (steps.push(`for each @${s.name} in ${s.list}${s.where ? ` ${s.whose ? "whose" : "where"} ${s.where}` : ""}`), lines.push(s.line), walk(s.body));
      else if (s.k === "if")
        for (const br of s.branches) {
          if (br.cond !== undefined) (steps.push(`if ${br.cond}`), lines.push(br.line));
          walk(br.body);
        }
    }
  };
  walk(body);
  return { steps, lines };
}

/** The `- step` lines of a block; `lines` receives the line of each step. */
function parseBullets(node: Line, err: (l: number, c: string, m: string, col?: number) => void, lines?: number[]): string[] {
  const out: string[] = [];
  for (const c of node.children) {
    if (!c.text.startsWith("- ")) err(c.line, "SYNTAX", "each step is a line starting with `- `", c.indent + 1);
    else {
      out.push((c.text.slice(2) + flattenChildren(c)).trim());
      lines?.push(c.line);
    }
  }
  if (!out.length) err(node.line, "SYNTAX", "expected at least one `- sentence` line");
  return out;
}

// ---------------------------------------------------------------- pieces


/** Does an address fit a screen's path (`/tickets/3` fits `/tickets/{id}`)? */
export const screenMatch = (pattern: string, path: string): boolean => {
  const re = pattern.replace(/[.*+?^$()|[\]\\]/g, "\\$&").replace(/\{[a-z]\w*\}/gi, "[^/]+");
  return new RegExp(`^${re}$`).test(path.split("?")[0]);
};

/** Whether a list or record value in a \`call\` fits the param's type: lists for lists, a record's fields by name. */
function argShape(v: Literal, t: Type, app: App): string | undefined {
  const inner = t.k === "Maybe" ? t.of : t;
  if (v.k === "list") {
    if (inner.k !== "List") return `a list, but the param is ${typeToString(t)}`;
    for (const x of v.items) {
      const w = argShape(x, inner.of, app);
      if (w) return w;
    }
  }
  if (v.k === "record") {
    const r = inner.k === "Named" ? app.records.find((x) => x.name === inner.name) : undefined;
    if (!r) return `a record, but the param is ${typeToString(t)}`;
    for (const f of v.fields) {
      const field = r.fields.find((x) => x.name === f.name);
      if (!field) return `${r.name} has no field \`${f.name}\` (${r.fields.map((x) => x.name).join(", ")})`;
      const w = argShape(f.value, field.type, app);
      if (w) return w;
    }
    const missing = r.fields.find((x) => x.type.k !== "Maybe" && x.default === undefined && !v.fields.some((f) => f.name === x.name));
    if (missing) return `${r.name} needs \`${missing.name}\``;
  }
  return undefined;
}

/** Split `a = 1, b = [x, y], c = { d = "e, f" }` at the commas that are not inside brackets, braces or strings. */
function splitTop(s: string): string[] {
  const out: string[] = [];
  let depth = 0;
  let inStr = false;
  let cur = "";
  for (let i = 0; i < s.length; i++) {
    const ch = s[i];
    if (inStr && ch === "\\") {
      cur += ch + (s[++i] ?? "");
      continue;
    }
    if (ch === '"') inStr = !inStr;
    else if (!inStr && (ch === "[" || ch === "{")) depth++;
    else if (!inStr && (ch === "]" || ch === "}")) depth--;
    if (ch === "," && !inStr && depth === 0) {
      out.push(cur.trim());
      cur = "";
    } else cur += ch;
  }
  if (cur.trim()) out.push(cur.trim());
  return out;
}

/** A value in a \`call\` argument: a literal, a list \`[a, b]\`, or a record \`{ name = value, … }\`. */
function parseArgValue(s: string): Literal | undefined {
  s = s.trim();
  if (s.startsWith("[") && s.endsWith("]") && s !== "[]") {
    const items = splitTop(s.slice(1, -1)).map(parseArgValue);
    return items.every((x): x is Literal => !!x) ? { k: "list", items } : undefined;
  }
  if (s.startsWith("{") && s.endsWith("}") && s.includes("=")) {
    const fields: { name: string; value: Literal }[] = [];
    for (const part of splitTop(s.slice(1, -1))) {
      const m = part.match(new RegExp(`^(${LOWER})\\s*=\\s*(.+)$`));
      const v = m && parseArgValue(m[2]);
      if (!m || !v) return undefined;
      fields.push({ name: m[1], value: v });
    }
    return { k: "record", fields };
  }
  return parseLiteral(s);
}

function parseDuration(s: string): number | undefined {
  const m = s.match(/^(\d+)(ms|s|m|h|d)$/);
  if (!m) return undefined;
  return Number(m[1]) * { ms: 1, s: 1000, m: 60000, h: 3600000, d: 86400000 }[m[2] as "ms"];
}

function parseType(s: string): Type | undefined {
  s = s.trim();
  let m: RegExpMatchArray | null;
  if ((m = s.match(/^List\s+(.+)$/))) {
    const of = parseType(m[1]);
    return of && { k: "List", of };
  }
  // `Ticket or nothing` (and the older `Maybe Ticket`): a value that may be absent.
  if ((m = s.match(/^(.+?)\s+or\s+nothing$/)) || (m = s.match(/^Maybe\s+(.+)$/))) {
    const of = parseType(m[1]);
    return of && { k: "Maybe", of };
  }
  if (s === "Text" || s === "Int" || s === "Decimal" || s === "Bool" || s === "Date" || s === "DateTime") return { k: s };
  // `ticket: ref Ticket`: a field that holds the referenced record's key (`@Ticket`'s key field).
  if ((m = s.match(new RegExp(`^ref\\s+(${UPPER})$`)))) return { k: "Ref", name: m[1] };
  // `ticket: ref Ticket in tickets`: and the state list its row is found in when it is followed.
  if ((m = s.match(new RegExp(`^ref\\s+(${UPPER})\\s+in\\s+(${LOWER})$`)))) return { k: "Ref", name: m[1], in: m[2] };
  if (new RegExp(`^${UPPER}$`).test(s)) return { k: "Named", name: s };
  return undefined;
}


function parseLiteral(s: string): Literal | undefined {
  s = s.trim();
  const str = parseString(s);
  if (str !== undefined) return { k: "text", v: str };
  if (/^-?\d+(\.\d+)?$/.test(s)) return { k: "number", v: Number(s), raw: s };
  if (s === "true" || s === "false") return { k: "bool", v: s === "true" };
  if (s === "[]") return { k: "emptyList" };
  if (s === "nothing") return { k: "nothing" };
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return { k: "date", v: s };
  if (/^\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}$/.test(s)) return { k: "dateTime", v: s.replace(" ", "T") };
  if (new RegExp(`^${UPPER}$`).test(s)) return { k: "value", v: s };
  return undefined;
}

function parseField(c: Line, err: (l: number, c: string, m: string, col?: number) => void, needDefault: boolean, qualified = false): Field | undefined {
  const m = c.text.match(new RegExp(`^(${qualified ? DECL : LOWER})\\s*:\\s*([^=]+?)\\s*(?:=\\s*(.+))?$`));
  if (!m) {
    err(c.line, "SYNTAX", "a field looks like `name: Type` or `name: Type = default`", c.indent + 1);
    return;
  }
  const type = parseType(m[2]);
  if (!type) {
    err(c.line, "SYNTAX", `\`${m[2]}\` is not a type (Text, Int, Decimal, Bool, List T, T or nothing, or a record/choice name)`, c.indent + 1);
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
    // A cell holds one value, or a row's inner list: `[{ id = 1, label = "Milk" }, …]` (the literal of call arguments).
    const lits = cells.map((cell) => (cell.trim().startsWith("[") && cell.trim() !== "[]" ? parseArgValue(cell) : parseLiteral(cell)));
    const bad = lits.findIndex((l) => !l);
    if (bad >= 0)
      err(r.line, "SYNTAX", cells[bad].trim().startsWith("[") ? `\`${cells[bad]}\` is not a list: write the row's inner list as \`[{ id = 1, label = "Milk" }, { … }]\` (records with \`field = value\`), or \`[]\`` : `\`${cells[bad]}\` is not a literal: use a "text", a number, true/false, nothing or a choice value`, r.indent + 1);
    else rows.push(lits as Literal[]);
  }
  return { k: "table", columns, rows };
}

/** A param binding: \`origins = "https://a.example", "https://b.example"\`, \`size = 5\`, or \`keys = table\` with rows. */
function parseBinding(c: Line, err: (l: number, c: string, m: string, col?: number) => void, stateAllowed = false): Binding | undefined {
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
  if (stateAllowed && new RegExp(`^${LOWER}$`).test(m[2].trim()) && !["true", "false", "nothing"].includes(m[2].trim())) return { name: m[1], value: { k: "nothing" }, state: m[2].trim(), line: c.line };
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
      } else if (Object.hasOwn(DESIGN_KEYS, key)) { // not `constructor`, `toString`: an object's own keys only
        if (!DESIGN_KEYS[key].includes(value)) err(c.line, "UNKNOWN_NAME", `${key} is one of ${DESIGN_KEYS[key].join(", ")}`, c.indent + 1);
        (d as any)[key] = value;
      } else err(c.line, "UNKNOWN_NAME", `unknown design setting \`${key}\`${suggest(key, [...COLOR_ROLES, ...Object.keys(DESIGN_KEYS)])}`, c.indent + 1);
    } else err(c.line, "SYNTAX", 'a design line is `look "…"`, `<role>: <palette>` (brand: indigo), `font: sans`, `radius: large` or `density: compact`', c.indent + 1);
  }
  return d;
}

/** An element; `rows` is how many list rows it is inside (0 at the top, 1 in a row, 2 in a row of a list inside a row). */
function parseElement(c: Line, err: (l: number, c: string, m: string, col?: number) => void, rows: number): Element | undefined {
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
    m = rest.match(new RegExp(`^(${DECL})\\s+of\\s+(${UPPER})(?:\\s*=\\s*(.+))?$`));
    if (!m) {
      err(c.line, "SYNTAX", "a list looks like `list name of Type` or `list name of Type = sentence`", col);
      return;
    }
    el.name = m[1];
    el.of = m[2];
    el.expr = m[3];
  } else if (kind === "select" && (m = rest.match(new RegExp(`^(${DECL})(?:\\s+(${STR}))?\\s+from\\s+(${LOWER})\\.(${LOWER})$`)))) {
    el.name = m[1];
    el.label = m[2] !== undefined ? parseString(m[2]) : undefined;
    el.from = { list: m[3], field: m[4] };
  } else {
    m = rest.match(new RegExp(`^(${DECL})(?:\\s+(${STR}))?(?:\\s*=\\s*(.+))?$`));
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
      const inner = rows + (kind === "list" ? 1 : 0);
      // A list inside a row (two levels: a task's items) is in the language; a list inside a row of
      // that inner list (a third level) is not yet.
      if (inner >= 2 && k.text.split(/\s+/)[0] === "list") {
        err(k.line, "NOT_YET", "a list inside a row of a list that is itself inside a row (a third level) is not in the language yet: two levels (a task's items) are; show deeper parts on their own, next to the list, filtered by the chosen row", k.indent + 1);
        continue;
      }
      const child = parseElement(k, err, inner);
      if (child) el.children.push(child);
    } else {
      err(k.line, "SYNTAX", 'expected `visible when …`, `enabled when …` or `look "…"`', k.indent + 1);
    }
  }
  if (kind === "list" && !["Text", "Int", "Decimal", "Bool", "Date", "DateTime"].includes(el.of ?? "") && !el.children.some((e) => e.kind !== "heading")) err(c.line, "SYNTAX", "a list needs row elements, indented under it", col);
  return el;
}

function parseStep(c: Line, err: (l: number, c: string, m: string, col?: number) => void, inComponent = false): { step: Step; waitMs?: number } | undefined {
  const t = c.text;
  const line = c.line;
  const col = c.indent + 1;
  if (c.children.length) err(c.children[0].line, "INDENT", "example steps have no indented lines");
  // `on row N [of list]`, once per level of rows, innermost first: `on row 2 on row 1` is row 2 of the
  // inner list, in row 1 of the outer one. One group captures them all; `at` reads it.
  const ONE_ROW = `\\s+on\\s+row\\s+(?:\\d+|with\\s+${STR})(?:\\s+of\\s+${QN})?`;
  const ROW = `((?:${ONE_ROW})*)`;
  const at = (suffix?: string): RowRef | undefined => {
    const levels = [...(suffix ?? "").matchAll(new RegExp(`\\s+on\\s+row\\s+(\\d+|with\\s+(${STR}))(?:\\s+of\\s+(${QN}))?`, "g"))].map(
      (x): RowRef => (x[2] !== undefined ? { row: 0, with: parseString(x[2]), list: x[3] } : { row: Number(x[1]), list: x[3] }),
    );
    for (let i = levels.length - 2; i >= 0; i--) levels[i].parent = levels[i + 1];
    return levels[0];
  };
  let m: RegExpMatchArray | null;
  if ((m = t.match(new RegExp(`^type\\s+(${STR})\\s+into\\s+(${QN})${ROW}$`)))) return { step: { do: "type", text: parseString(m[1])!, target: m[2], at: at(m[3]), line } };
  if ((m = t.match(new RegExp(`^(click|toggle)\\s+(${QN})${ROW}$`)))) return { step: { do: m[1] as "click", target: m[2], at: at(m[3]), line } };
  if ((m = t.match(new RegExp(`^choose\\s+(${UPPER})\\s+in\\s+(${QN})${ROW}$`)))) return { step: { do: "choose", value: m[1], target: m[2], at: at(m[3]), line } };
  if ((m = t.match(new RegExp(`^choose\\s+(${STR})\\s+in\\s+(${QN})${ROW}$`)))) return { step: { do: "choose", value: parseString(m[1])!, target: m[2], at: at(m[3]), line, quoted: true } };
  if ((m = t.match(new RegExp(`^snapshot\\s+(${STR})$`)))) return { step: { do: "snapshot", name: parseString(m[1])!, line } };
  // api profile: `call createTicket with subject = "Printer", priority = Urgent`
  // In a screen's examples, \`call tickets.createTicket …\` is another client calling the provider.
  // \`call solveTicket as "Ann" with id = 4\`: the call is made as that caller, with their key (v70).
  if ((m = t.match(new RegExp(`^call\\s+(${LOWER}(?:\\.${LOWER})?)(?:\\s+as\\s+(${STR}))?(?:\\s+with\\s+(.+))?$`)))) {
    const as = m[2] !== undefined ? parseString(m[2]) : undefined;
    m = [m[0], m[1], m[3]] as unknown as RegExpMatchArray;
    const args: { name: string; value: Literal }[] = [];
    const headers: { name: string; value: Literal }[] = [];
    const badArgs = new Set<string>(); // `with a = 1, , ,`: each wrong part said once
    for (const part of m[2] ? splitTop(m[2]) : []) {
      const hm = part.match(new RegExp(`^header\\s+(${HEADER})\\s*=\\s*(.+)$`));
      if (hm) {
        const v = parseLiteral(hm[2]);
        if (!v) err(line, "SYNTAX", `\`${hm[2]}\` is not a literal`, col);
        else headers.push({ name: hm[1], value: v });
        continue;
      }
      const am = part.match(new RegExp(`^(${LOWER})\\s*=\\s*(.+)$`));
      // `{createTicket.body.id}`: a value from an earlier answer (kept as a text literal holding the reference).
      const lit = am && (/^\{[a-z][\w.[\]]*\}$/i.test(am[2].trim()) ? ({ k: "text", v: am[2].trim() } as Literal) : parseArgValue(am[2]));
      if (!am || !lit) {
        if (!badArgs.has(part.trim())) err(line, "SYNTAX", part.trim() ? `\`${part}\` is not \`name = value\` (a value is a literal, a list \`[a, b]\` or a record \`{ field = value, … }\`)` : "an empty argument (`, ,`): each argument is `name = value`", col);
        badArgs.add(part.trim());
      }
      else args.push({ name: am[1], value: lit });
    }
    return { step: { do: "call", endpoint: m[1], args, ...(headers.length ? { headers } : {}), ...(as !== undefined ? { as } : {}), line } };
  }
  // In a layer's example: `given key = ""` changes a param from here on.
  if ((m = t.match(new RegExp(`^given\\s+(${LOWER})\\s*=\\s*(.+)$`)))) {
    const v = parseLiteral(m[2]);
    if (!v) err(line, "SYNTAX", `\`${m[2]}\` is not a literal`, col);
    else return { step: { do: "given", name: m[1], value: v, line } };
    return;
  }
  // A raw request: `request OPTIONS "/tickets" with header origin = "https://a.example", query status = Open`.
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
  if (t === "restart") return { step: { do: "restart", line } };
  if (t === "go back") return { step: { do: "back", line } };
  if ((m = t.match(new RegExp(`^see\\s+screen\\s*=\\s*(${LOWER})$`)))) return { step: { do: "see", target: "screen", check: { is: "eq", value: m[1] }, line } };
  if ((m = t.match(new RegExp(`^open\\s+(${STR})$`)))) return { step: { do: "open", path: parseString(m[1])!, line } };
  // `steer random …`: the next draws take these values (a type's values, a shuffle's order, a pick).
  if ((m = t.match(/^steer\s+random\s+shuffle\s+(keeps|reverses)\s+order$/))) return { step: { do: "random", what: "shuffle", order: m[1] === "keeps" ? "keep" : "reverse", line } };
  if ((m = t.match(/^steer\s+random\s+pick\s+(\d+)$/))) {
    if (Number(m[1]) < 1) err(line, "STEP", "`steer random pick <n>` counts from 1 (the first item)", col);
    return { step: { do: "random", what: "pick", pick: Number(m[1]), line } };
  }
  if ((m = t.match(new RegExp(`^steer\\s+random\\s+(${UPPER})\\s*=\\s*(.+)$`)))) {
    const values: Literal[] = [];
    for (const part of splitTop(m[2])) {
      const lit = parseLiteral(part.trim());
      if (!lit || !["text", "number", "value", "bool"].includes(lit.k)) {
        err(line, "SYNTAX", `\`${part.trim()}\` is not a value to steer with: a "text", a number or a choice value`, col);
        return;
      }
      values.push(lit);
    }
    return { step: { do: "random", what: m[1], values, line } };
  }
  if (/^steer\s+random\b/.test(t)) {
    err(line, "SYNTAX", "expected `steer random <Type> = <value>, …`, `steer random shuffle keeps order` (or `reverses order`) or `steer random pick <n>`", col);
    return;
  }
  if ((m = t.match(/^steer\s+([a-z]\w*)\s+(lose\s+request|lose\s+answer|duplicate|slow|restart\s+after\s+effect|expire\s+keys|fail(?:\s+(\d+))?)$/))) {
    const fault = m[2].startsWith("fail") ? "fail" : (m[2].replace(/\s+/, " ") as "lose request");
    return { step: { do: "steer", api: m[1], fault, times: fault === "fail" ? Number(m[3] ?? 1) : 1, line } };
  }
  if (/^steer\b/.test(t)) {
    err(line, "SYNTAX", "expected `steer <api> lose request`, `lose answer`, `duplicate`, `slow`, `restart after effect`, `expire keys` or `fail <n>`", col);
    return;
  }
  if ((m = t.match(/^tick(?:\s+(\d+)\s+times?)?$/))) return { step: { do: "tick", times: Number(m[1] ?? 1), line } };
  if ((m = t.match(/^size\s+([A-Za-z][a-zA-Z0-9]*)$/))) return { step: { do: "size", size: m[1][0].toUpperCase() + m[1].slice(1), line } };
  if ((m = t.match(/^wait\s+(\d+)\s+(seconds?|minutes?|hours?|days?)$/))) {
    err(line, "SYNTAX", `write the time as \`wait ${m[1]}${m[2][0] === "s" ? "s" : m[2][0]}\` (s, m, h or d)`, col);
    return;
  }
  if ((m = t.match(/^wait\s+(\S+)$/))) {
    const ms = parseDuration(m[1]);
    if (ms === undefined) {
      err(line, "SYNTAX", "expected a duration such as `3s`, `30m`, `2h` or `1d`", col);
      return;
    }
    return { step: { do: "tick", times: 0, ms, line }, waitMs: ms };
  }
  // Inside a component the row count may be a param: `see rows has at most size rows`.
  // `see items on row 1 has 3 rows`: the inner list of one outer row.
  if ((m = t.match(new RegExp(`^see\\s+(${QN})${ROW}\\s+has\\s+(at\\s+most\\s+|at\\s+least\\s+)?(\\d+|${inComponent ? LOWER : "\\d+"})\\s+rows?$`)))) {
    const n = /^\d+$/.test(m[4]) ? Number(m[4]) : NaN;
    const where = at(m[2]);
    return { step: { do: "see", target: m[1], ...(where ? { at: where } : {}), check: { is: "rows", count: n, cmp: !m[3] ? undefined : m[3].includes("most") ? "atMost" : "atLeast", countParam: Number.isNaN(n) ? m[4] : undefined }, line } };
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
    return { step: { do: "see", target: m[1], at: at(m[2]), check: numCheck(m[3], m[4]), line } };
  if ((m = t.match(new RegExp(`^see\\s+(${QN})${ROW}\\s+is\\s+(disabled|enabled|hidden|shown|checked|unchecked)$`))))
    return { step: { do: "see", target: m[1], at: at(m[2]), check: { is: m[3] as "shown" }, line } };
  if ((m = t.match(new RegExp(`^see\\s+(${QN})${ROW}\\s*=\\s*(.+)$`)))) {
    const lit = parseLiteral(m[3]);
    // `see x.body.f = nothing`: an answer's (or event's) value that is nothing, written as `null`.
    if (lit?.k === "nothing" && !m[2] && /(^|\.)body\b/.test(m[1])) return { step: { do: "see", target: m[1], check: { is: "eq", value: "nothing", nothing: true }, line } };
    if (!lit || lit.k === "emptyList" || lit.k === "nothing" || lit.k === "table" || lit.k === "list" || lit.k === "record") {
      err(line, "SYNTAX", `\`${m[3]}\` is not a value to compare with; use a "string", a number or a choice value${lit?.k === "nothing" ? " (`= nothing` is for a value in an answer or an event: `see x.body.f = nothing`)" : ""}`, col);
      return;
    }
    const value = lit.k === "text" ? lit.v : lit.k === "number" ? lit.raw : lit.k === "bool" ? String(lit.v) : lit.v;
    return { step: { do: "see", target: m[1], at: at(m[2]), check: { is: "eq", value }, line } };
  }
  const word = t.split(/\s+/)[0];
  err(line, "SYNTAX", `not an example step: \`${t}\`${suggest(word, ["type", "click", "toggle", "choose", "wait", "tick", "see", "snapshot", "restart", "steer", "open", "go back"])}`, col);
}

// ---------------------------------------------------------------- semantic checks

function check(app: App, err: (l: number, c: string, m: string, col?: number) => void, warn: (l: number, c: string, m: string, col?: number) => void, clockLine: number, usedComponents_ = new Set<string>()) {
  const records = new Map(app.records.map((r) => [r.name, r]));
  const choices = new Map(app.choices.map((c) => [c.name, c]));
  const valueOwner = new Map<string, ChoiceDecl>();
  const typeNames = new Set<string>([app.name]);

  const reservedSaid = new Set<string>(); // a job's state is also its screen: one name, one line, said once
  const checkReserved = (name: string, line: number) => {
    for (const part of name.split("."))
      if (RESERVED.has(part) && !reservedSaid.has(`${line}|${part}`)) (reservedSaid.add(`${line}|${part}`), err(line, "RESERVED", `\`${part}\` is reserved; pick another name`));
  };
  // In an api, `@path.x` / `@query.x` / `@body.x` name a request's parts: state and derived values
  // cannot take those names (a record field can: it is read through its row, never as `@body.x`).
  const checkRequestPart = (name: string, line: number) => {
    if (app.endpoints?.length && ["path", "query", "body"].includes(name)) err(line, "RESERVED", `\`${name}\` names a request's part in an api (\`@${name}.x\`); pick another name`);
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
    const listed = new Set<string>();
    for (const v of c.values) {
      // A value listed twice in one choice is said once, as that; in another choice, as the clash.
      if (listed.has(v)) continue;
      listed.add(v);
      const times = c.values.filter((x) => x === v).length;
      if (times > 1) err(c.line, "DUPLICATE", `value \`${v}\` is listed ${times} times in choice ${c.name}; list each value once`);
      if (valueOwner.has(v)) err(c.line, "DUPLICATE", `value \`${v}\` is already used by choice ${valueOwner.get(v)!.name}; choice values must be unique across the app`);
      else if (typeNames.has(v) || app.refined?.some((r) => r.name === v)) err(c.line, "DUPLICATE", `value \`${v}\` clashes with a type name: choice values, records, choices and refined types share one namespace (\`@${v}\` must name one thing)`);
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
  const badKeys = new Set<string>();
  const checkType = (t: Type, line: number): boolean => {
    if (t.k === "List" || t.k === "Maybe") return checkType(t.of, line);
    if (t.k === "Ref") {
      const rec = records.get(t.name);
      if (!rec) {
        err(line, "UNKNOWN_NAME", `no record \`${t.name}\` to reference${suggest(t.name, [...records.keys()])}`);
        return false;
      }
      // The key is declared (`key code: Text`), or the field named `id`; never a field's position.
      const key = rec.fields.find((f) => f.name === (rec.key ?? "id"));
      if (!key) {
        err(line, "NO_KEY", `${t.name} has no key, so \`ref ${t.name}\` holds nothing: name its key field \`id\`, or mark one \`key code: Text\``);
        return false;
      }
      const k = key.type.k === "Named" ? REFINED.get(key.type.name)?.base : key.type.k;
      if (k !== "Int" && k !== "Text") {
        if (!badKeys.has(t.name)) err(key.line, "TYPE", key.type.k === "Ref" || (key.type.k === "Maybe" && key.type.of.k === "Ref") ? `${t.name}'s key \`${key.name}\` is ${typeToString(key.type)}: a key is an Int or a Text of its own, never a reference to another row` : `${t.name}'s key \`${key.name}\` is ${typeToString(key.type)}: a key is an Int or a Text, always there`);
        badKeys.add(t.name); // said once, however many fields refer to the record
        return false;
      }
      t.key = key.type;
      return true;
    }
    if (t.k === "Named" && !records.has(t.name) && !choices.has(t.name) && !REFINED.has(t.name)) {
      err(line, "UNKNOWN_NAME", `unknown type \`${t.name}\`${suggest(t.name, [...typeNames])}`);
      return false;
    }
    return true;
  };
  // A row's inner list in a seed table: `[{ id = 1, label = "Milk" }, …]`. Each record has only the
  // inner record's fields, with values that fit (omitted fields take their defaults), and no two
  // share a key within the row: the harness finds an inner row by its key within its parent.
  const innerList = (cell: Extract<Literal, { k: "list" }>, t: Type, what: string, line: number) => {
    const inner = t.k === "Maybe" ? t.of : t;
    if (inner.k !== "List") return err(line, "BAD_BINDING", `${what} is ${typeToString(t)}, not a list`);
    const rec = inner.of.k === "Named" ? records.get(inner.of.name) : undefined;
    const keyField = rec?.fields.find((x) => x.name === (rec.key ?? "id"));
    const keys = new Map<string, number>();
    cell.items.forEach((item, n) => {
      if (!rec) {
        if (!literalFits(item, inner.of, choices)) err(line, "TYPE", `${what}: item ${n + 1} must be ${typeToString(inner.of)}`);
        return;
      }
      if (item.k !== "record") return err(line, "TYPE", `${what}: item ${n + 1} must be a ${rec.name}, written \`{ ${rec.fields.map((x) => `${x.name} = …`).slice(0, 2).join(", ")} }\``);
      for (const fv of item.fields) {
        const field = rec.fields.find((x) => x.name === fv.name);
        if (!field) err(line, "UNKNOWN_NAME", `${what}, item ${n + 1}: ${rec.name} has no field \`${fv.name}\`${suggest(fv.name, rec.fields.map((x) => x.name))}`);
        else if (fv.value.k === "list" || fv.value.k === "record") err(line, "TYPE", `${what}: \`${fv.name}\` of item ${n + 1} must be ${typeToString(field.type)}`);
        else if (!literalFits(fv.value, field.type, choices)) err(line, "TYPE", `${what}: \`${fv.name}\` of item ${n + 1} must be ${typeToString(field.type)}`);
      }
      for (const rf of rec.fields)
        if (!item.fields.some((x) => x.name === rf.name) && rf.default === undefined && rf.type.k !== "Maybe") err(line, "BAD_BINDING", `${what}: item ${n + 1} needs \`${rf.name}\` (${rec.name}.${rf.name} has no default)`);
      const k = keyField && item.fields.find((x) => x.name === keyField.name)?.value;
      if (k && k.k !== "list" && k.k !== "record") {
        const v = JSON.stringify("v" in k ? k.v : k.k);
        if (keys.has(v)) err(line, "DUPLICATE", `${what}: items ${keys.get(v)! + 1} and ${n + 1} have ${keyField!.name} ${v.replace(/^"|"$/g, "")}; an inner row's key is unique within its row`);
        else keys.set(v, n);
      }
    });
  };
  // The field's type is checked (and reported) once, by the caller: `typeOk` is its result.
  const checkDefault = (f: Field, typeOk: boolean) => {
    if (!f.default || !typeOk) return;
    if (f.default.k === "table") {
      const table = f.default;
      const rec = f.type.k === "List" && f.type.of.k === "Named" ? records.get(f.type.of.name) : undefined;
      if (!rec) return err(f.line, "BAD_BINDING", `a table fills a \`List <Record>\`; \`${f.name}\` is ${typeToString(f.type)}`);
      for (const col of new Set(table.columns)) if (!rec.fields.some((x) => x.name === col)) err(f.line + 1, "UNKNOWN_NAME", `${rec.name} has no field \`${col}\`${suggest(col, rec.fields.map((x) => x.name))}`);
      for (const rf of rec.fields)
        if (!table.columns.includes(rf.name) && !rf.default && rf.type.k !== "Maybe") err(f.line + 1, "BAD_BINDING", `the table needs a \`${rf.name}\` column (${rec.name}.${rf.name} has no default)`);
      table.rows.forEach((row, i) =>
        row.forEach((cell, j) => {
          const rf = rec.fields.find((x) => x.name === table.columns[j]);
          if (rf && cell.k === "list") innerList(cell, rf.type, `\`${rf.name}\` of row ${i + 1}`, f.line + 2 + i);
          else if (rf && !literalFits(cell, rf.type, choices)) err(f.line + 2 + i, "BAD_BINDING", `\`${rf.name}\` must be ${typeToString(rf.type)}`);
        }),
      );
      return;
    }
    if (!literalFits(f.default, f.type, choices)) err(f.line, "BAD_BINDING", `default does not fit type ${typeToString(f.type)}`);
  };

  // A record may hold a list of records (a task's items); that inner record may not hold one itself.
  const recordList = (t: Type): string | undefined => {
    const inner = t.k === "Maybe" ? t.of : t;
    return inner.k === "List" && inner.of.k === "Named" && records.has(inner.of.name) ? inner.of.name : undefined;
  };
  for (const r of app.records) {
    const seen = new Set<string>();
    for (const f of r.fields) {
      if (seen.has(f.name)) err(f.line, "DUPLICATE", `field \`${f.name}\` declared twice in ${r.name}`);
      seen.add(f.name);
      checkReserved(f.name, f.line);
      checkDefault(f, checkType(f.type, f.line));
      if (f.type.k === "Named" && f.type.name === r.name) err(f.line, "BAD_BINDING", "a record cannot contain itself");
      const inner = recordList(f.type);
      const deeper = inner ? records.get(inner)!.fields.find((x) => recordList(x.type)) : undefined;
      if (inner && deeper && f.line < LINE_BASE)
        err(f.line, "NOT_YET", inner === r.name ? `\`${f.name}: ${typeToString(f.type)}\`: a record that holds a list of its own kind (a tree) is not in the language yet` : `\`${f.name}: ${typeToString(f.type)}\`: a ${inner} holds a list of records itself (\`${deeper.name}: ${typeToString(deeper.type)}\`), and lists three levels deep are not in the language yet; keep the deepest part in a list of its own with a \`ref\` back`);
    }
  }
  const state = new Map<string, Field>();
  for (const f of app.state) {
    if (state.has(f.name)) err(f.line, "DUPLICATE", `state \`${f.name}\` declared twice`);
    state.set(f.name, f);
    checkReserved(f.name, f.line);
    checkRequestPart(f.name, f.line);
    checkDefault(f, checkType(f.type, f.line));
    if (f.type.k === "Named" && records.has(f.type.name)) err(f.line, "BAD_BINDING", `state of record type needs a literal default; use \`${f.type.name} or nothing = nothing\``);
  }
  const derived = new Set<string>();
  for (const d of app.derive) {
    if (state.has(d.name) || derived.has(d.name)) err(d.line, "DUPLICATE", `\`${d.name}\` is already declared`);
    derived.add(d.name);
    checkReserved(d.name, d.line);
    checkRequestPart(d.name, d.line);
    if (d.type) checkType(d.type, d.line);
  }

  // The api profile has endpoints instead of a screen.
  if (app.kind === "layer") return checkLayer(app, err, warn, checkType);
  if (app.profile === "api") return checkApi(app, err, warn, { records, choices, state, derived, checkType, checkReserved });
  if (app.endpoints?.length) err(app.endpoints[0].line, "SYNTAX", "endpoints belong to the api profile: add `profile api`");

  // Screen: scopes and bindings. `path` is the lists an element is in, outermost first: a row
  // element of `tasks` has [tasks]; one of `items` inside a task's row has [tasks, items].
  const lists: Element[] = [];
  const PLAIN = ["Text", "Int", "Decimal", "Bool", "Date", "DateTime"];
  const all: { el: Element; list?: Element; path: Element[] }[] = [];
  // A row's scope holds the names of its inner rows too (`inner`: from the rows of that inner list),
  // so `on click removeItem` names one element; two inner lists of one row are apart, as two lists are.
  type Named = { el: Element; list?: Element; inner?: Element };
  const walk = (els: Element[], path: Element[], scope: Map<string, Named>) => {
    const list = path[path.length - 1];
    for (const el of els) {
      if (el.kind !== "heading") {
        const before = scope.get(el.name);
        const shared = "a row and the rows of its inner lists share one scope, so a handler (`on click …`) names one element; give one of them another name";
        if (before) err(el.line, "DUPLICATE", before.inner ? `element \`${el.name}\` is already in the rows of list ${before.inner.name}, inside this row of list ${list!.name}: ${shared}` : before.list && list && before.list !== list ? `element \`${el.name}\` is already in this row of list ${before.list.name}, around list ${list.name}: ${shared}` : `element \`${el.name}\` is already on the screen${list ? ` in list ${list.name}` : ""}`);
        scope.set(el.name, { el, list });
        checkReserved(el.name, el.line);
        all.push({ el, list, path });
      }
      if (el.kind === "list") {
        lists.push(el);
        // A list of plain values shows each value as a row: it has no row elements to declare.
        if (PLAIN.includes(el.of!)) {
          if (el.children.length) err(el.line, "SYNTAX", `\`list ${el.name} of ${el.of}\` shows each value as a row; it has no row elements to declare`);
        } else if (!path.length) walk(el.children, [el], new Map());
        else {
          const child = new Map([...scope].filter(([, v]) => !v.inner));
          walk(el.children, [...path, el], child);
          for (const [n, v] of child) if (!scope.has(n)) scope.set(n, { ...v, inner: el });
        }
      } else if (el.kind === "section") walk(el.children, path, scope);
    }
  };
  // A name is unique within a screen (and within a list), but two screens may reuse one: the
  // handler (`on click back`) belongs to the name, so both screens share its behaviour.
  const byScreen = new Map<string, Element[]>();
  for (const el of app.screen) {
    const k = el.screen ?? "";
    (byScreen.get(k) ?? byScreen.set(k, []).get(k)!).push(el);
  }
  for (const els of byScreen.values()) walk(els, [], new Map());
  // A reused name is one element on several screens: one handler and one event serve them all, so
  // the kind must agree (a `button back` here and a `field back` there would share nothing sensible).
  const kindOf = new Map<string, Element>();
  for (const { el, list } of all) {
    if (list || !el.screen) continue;
    const first = kindOf.get(el.name);
    if (!first) kindOf.set(el.name, el);
    else if (first.kind !== el.kind) err(el.line, "DUPLICATE", `\`${el.name}\` is a ${first.kind} on screen \`${first.screen}\` (line ${first.line}) and a ${el.kind} here: a name reused across screens is the same kind of element, with one handler. Give this one its own name`);
  }
  if (!app.screen.length) err(1, "SYNTAX", "the app has no `screen`");

  for (const { el, list, path } of all) {
    const rowType = list ? records.get(list.of!) : undefined;
    const rowField = rowType?.fields.find((f) => f.name === el.name);
    const st = state.get(el.name);
    const where = list ? `row type ${list.of}` : "state";
    switch (el.kind) {
      case "text":
        if (!el.expr && !(list ? rowField : st || derived.has(el.name)))
          err(el.line, "UNKNOWN_NAME", `\`text ${el.name}\` shows nothing: declare ${list ? `field \`${el.name}\` in ${list.of}` : `state or derive \`${el.name}\``}, or write \`text ${el.name} = …\``);
        break;
      case "field": {
        const f = list ? rowField : st;
        if (!f) err(el.line, "BAD_BINDING", `\`field ${el.name}\` edits \`${el.name}\` in ${where}, which is not declared${list ? ` (add \`${el.name}: Text\` to ${list.of})` : " (add `" + el.name + `: Text = ""\` to state)`}`);
        else if (f.type.k !== "Text") err(el.line, "BAD_BINDING", `\`field ${el.name}\` needs \`${el.name}\` to be Text (is ${typeToString(f.type)})`);
        break;
      }
      case "select":
        if (el.from) {
          const f = list ? rowField : st;
          // What is chosen, or nothing: `Text or nothing` (a plain `Text` with "" for none is the older spelling).
          const ft = f && (f.type.k === "Maybe" ? f.type.of : f.type);
          if (!f || ft?.k !== "Text") err(el.line, "BAD_BINDING", `\`select ${el.name} from …\` edits \`${el.name}\` in ${where}, which must be \`Text or nothing\` (nothing: none is chosen)${list ? ` (add \`${el.name}: Text or nothing = nothing\` to ${list.of})` : ` (\`${el.name}: Text or nothing = nothing\` in state)`}`);
          const src = state.get(el.from.list);
          // Inside an inner row the options may also come from a list field of a row it is in (the outer row's).
          const rowSrc = path.slice(0, -1).map((l) => records.get(l.of!)?.fields.find((x) => x.name === el.from!.list)).find((x) => !!x);
          const srcType = src?.type ?? rowSrc?.type;
          const srcRec = srcType && srcType.k === "List" && srcType.of.k === "Named" ? records.get(srcType.of.name) : undefined;
          if (!src && !rowSrc && !derived.has(el.from.list)) err(el.line, "UNKNOWN_NAME", `no state or derive \`${el.from.list}\`${path.length > 1 ? `, and no field \`${el.from.list}\` of ${path.slice(0, -1).map((l) => l.of).join(" or ")}` : ""}`);
          else if (srcType && !srcRec) err(el.line, "BAD_BINDING", `\`${el.from.list}\` must be a list of records`);
          else if (srcRec && srcRec.fields.find((x) => x.name === el.from!.field)?.type.k !== "Text") err(el.line, "BAD_BINDING", `${srcRec.name} needs a Text field \`${el.from.field}\``);
        } else {
          const f = list ? rowField : st;
          if (!f) err(el.line, "BAD_BINDING", `\`select ${el.name}\` edits \`${el.name}\` in ${where}, which is not declared${list ? ` (add \`${el.name}: <Choice>\` to ${list.of})` : ""}`);
          else if (f.type.k !== "Named" || !choices.has(f.type.name)) err(el.line, "BAD_BINDING", `\`select ${el.name}\` needs \`${el.name}\` to be a choice (is ${typeToString(f.type)})`);
        }
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
        if (!PLAIN.includes(el.of!) && !records.has(el.of!)) err(el.line, "UNKNOWN_NAME", `unknown record or value type \`${el.of}\`${suggest(el.of!, [...records.keys(), ...PLAIN])}`);
        // A table inside a table's row is an accessibility anti-pattern; a treegrid is its own presentation (later).
        if (list && el.as === "table" && list.as === "table") err(el.line, "NOT_YET", `\`list ${el.name} … as table\` inside a row of the table ${list.name}: a table inside a table is not in the language yet; without \`as\` the inner list sits in a cell of its own`);
        if (!el.expr && list) {
          // A list inside a row shows the row item's field (as `text x` shows the row's field `x`).
          if (!rowField) err(el.line, "BAD_BINDING", `\`list ${el.name} of ${el.of}\` inside list ${list.name} shows the row's field \`${el.name}\`, which ${list.of} does not have (add \`${el.name}: List ${el.of} = []\` to ${list.of}), or write \`list ${el.name} of ${el.of} = …\``);
          else if (rowField.type.k !== "List") err(el.line, "BAD_BINDING", `\`${list.of}.${el.name}\` must be \`List ${el.of}\` to be shown as a list (is ${typeToString(rowField.type)})`);
          else if (typeToString(rowField.type.of) !== el.of) err(el.line, "TYPE", `\`list ${el.name} of ${el.of}\`: ${list.of}.${el.name} is ${typeToString(rowField.type)}, so its rows are ${typeToString(rowField.type.of)}s`);
        } else if (!el.expr) {
          const f = st;
          if (!f && !derived.has(el.name)) err(el.line, "UNKNOWN_NAME", `\`list ${el.name}\` shows nothing: declare state or derive \`${el.name}\`, or write \`list ${el.name} of ${el.of} = …\``);
          else if (f && !(f.type.k === "List" && typeToString(f.type.of) === el.of))
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
    // Whether it is used is a quality rule's (std.quality UNUSED): the compiler records it.
  }

  // Handlers.
  const findEl = (name: string): { el: Element; list?: Element; path: Element[] }[] => all.filter((a) => a.el.name === name);
  // A step's rows, innermost first (`on row 2 on row 1`), against the lists an element is in.
  const levelsOf = (a?: RowRef): RowRef[] => {
    const out: RowRef[] = [];
    for (let x = a; x; x = x.parent) out.push(x);
    return out;
  };
  const fitsRows = (c: { path: Element[] }, a?: RowRef) => {
    const lv = levelsOf(a);
    const inner = [...c.path].reverse();
    return lv.length === inner.length && lv.every((x, i) => !x.list || x.list === inner[i].name);
  };
  const inWords = (path: Element[]) => [...path].reverse().map((l, i) => `${i ? "inside " : ""}list ${l.name}`).join(", ");
  const rowsWords = (path: Element[]) => path.map(() => "on row 1").join(" ");
  const verbKind = VERB_KINDS as Record<string, ElementKind>;
  const handled = new Set<string>();
  for (const h of app.handlers) {
    if (h.verb === "tick") {
      if (!app.clockMs) err(h.line, "BAD_BINDING", "`on tick` needs a `clock every …` block");
      continue;
    }
    if (h.verb === "start") continue;
    if (h.verb === "open") {
      const key = `open ${h.target}`;
      if (!app.screens?.some((s) => s.name === h.target)) err(h.line, "UNKNOWN_NAME", `no screen \`${h.target}\`${app.screens?.length ? suggest(h.target, app.screens.map((s) => s.name)) : " (this app has one screen: use `on start`)"}`);
      if (handled.has(key)) err(h.line, "DUPLICATE", `there is already an \`on ${key}\``);
      handled.add(key);
      continue;
    }
    if (h.verb === "event") {
      // `on event tickets.ticketCreated`: a client alias and an event of its contract.
      const [alias, ev] = h.target.split(".");
      const client = app.clients?.find((c) => c.alias === alias);
      if (ev === undefined) err(h.line, "SYNTAX", `\`on event\` names a client's event: \`on event ${alias}.<event>\``);
      else if (!client) err(h.line, "UNKNOWN_NAME", `no client \`${alias}\`; declare it with \`uses <contract> as ${alias}\``);
      else if (!client.contract.events?.some((e) => e.name === ev)) err(h.line, "UNKNOWN_NAME", `contract ${client.contract.name} has no event \`${ev}\`${suggest(ev ?? "", client.contract.events?.map((e) => e.name) ?? [])}`);
      const key = `event ${h.target}`;
      if (handled.has(key)) err(h.line, "DUPLICATE", `there is already an \`on ${key}\``);
      handled.add(key);
      continue;
    }
    if (h.verb === "answer") {
      // `on answer tickets.listTickets`: a client alias and an endpoint of its contract.
      const [alias, ep] = h.target.split(".");
      const client = app.clients?.find((c) => c.alias === alias);
      if (ep === undefined) err(h.line, "SYNTAX", `\`on answer\` names a client's endpoint: \`on answer ${alias}.<endpoint>\``);
      else if (!client) err(h.line, "UNKNOWN_NAME", `no client \`${alias}\`; declare it with \`uses <contract> as ${alias}\``);
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
  // Calls: `call @tickets.createTicket …` must name an endpoint of a client, and its answer should be handled.
  if (app.clients?.length)
    for (const h of app.handlers)
      for (const [i, st] of h.steps.entries())
        for (const m of st.matchAll(/\bcall\s+@?([a-z]\w*)\.([a-z]\w*)/gi)) {
          const line = h.stepLines?.[i] ?? h.line;
          const client = app.clients.find((c) => c.alias === m[1]);
          if (!client) err(line, "UNKNOWN_NAME", `no client \`${m[1]}\`; declare it with \`uses <contract> as ${m[1]}\``);
          else if (!client.contract.endpoints?.some((e) => e.name === m[2])) err(line, "UNKNOWN_NAME", `contract ${client.contract.name} has no endpoint \`${m[2]}\`${suggest(m[2], client.contract.endpoints?.map((e) => e.name) ?? [])}`);
        }
  // Undo: `undo @pay.charge …` takes back an effect through the endpoint its contract names in `undone by`.
  if (app.clients?.length)
    for (const h of app.handlers)
      for (const [i, st] of h.steps.entries())
        for (const m of st.matchAll(/\bundo\s+@?([a-z]\w*)\.([a-z]\w*)/gi)) {
          const line = h.stepLines?.[i] ?? h.line;
          const ep = app.clients.find((c) => c.alias === m[1])?.contract.endpoints?.find((e) => e.name === m[2]);
          if (!ep) err(line, "UNKNOWN_NAME", `no endpoint \`${m[1]}.${m[2]}\` to undo`);
          else if (!ep.undoneBy) err(line, "EFFECT", `\`${m[1]}.${m[2]}\` cannot be undone: its contract names no \`undone by\``);
        }
  // `its status is held` / `rejected` come only from the agreement: an `effect external` endpoint of an api used `through std.actions`.
  for (const h of app.handlers) {
    if (h.verb !== "answer" || !h.target) continue;
    const [alias, name] = h.target.split(".");
    const client = app.clients?.find((c) => c.alias === alias);
    const ep = client?.contract.endpoints?.find((e) => e.name === name);
    if (!ep) continue; // reported above
    for (const [i, st] of h.steps.entries())
      for (const m of st.matchAll(/\bits\s+status\s+is\s+(held|rejected)\b/g)) {
        const line = h.stepLines?.[i] ?? h.line;
        if (client!.through?.layer !== "std.actions") err(line, "EFFECT", `\`its status is ${m[1]}\`: only a call that waits for approval is ${m[1]}, and \`${h.target}\` does not go \`through std.actions\` (add it under \`uses … as ${alias}\`)`);
        else if (!ep.effect) err(line, "EFFECT", `\`its status is ${m[1]}\`: the agreement only holds calls that reach outside, and \`${h.target}\` has no \`effect external\` in its contract`);
      }
  }
  // The manifest: `uses … as notes only listNotes, noteCreated` names what this app may use of an
  // api; using anything else is an error (the host would refuse it), naming what the contract lacks too.
  const usedApi = usedByAlias(app);
  for (const c of app.clients ?? []) {
    if (!c.only || (c.line ?? 0) >= LINE_BASE) continue;
    const names = new Set([...(c.contract.endpoints ?? []).map((e) => e.name), ...(c.contract.events ?? []).map((e) => e.name)]);
    for (const n of c.only) if (!names.has(n)) err(c.line ?? 1, "UNKNOWN_NAME", `\`only ${n}\`: contract ${c.contract.name} has no endpoint or event \`${n}\`${suggest(n, [...names])}`);
    const used = [...usedApi[c.alias].endpoints, ...usedApi[c.alias].events];
    for (const n of used) if (!c.only.includes(n)) err(c.line ?? 1, "UNDECLARED", `the app uses \`${c.alias}.${n}\`, which \`only\` does not list: add it, or stop using it`);
  }

  // Examples.
  const seen = new Set<string>(); // "list.name" or "name" checked by some `see`
  const exNames = new Set<string>();
  const snapshots = new Set<string>();
  const navCache = new Map<string, string | undefined>();
  const clickHandlers = new Map<string, (typeof app.handlers)[number]>();
  for (const h of app.handlers) if (h.verb === "click" && h.target && !clickHandlers.has(h.target)) clickHandlers.set(h.target, h);
  for (const ex of [...app.examples, { name: "(always)", steps: app.always, line: 0 }]) {
    if (ex.line === 0 && !ex.steps.length) continue;
    if (exNames.has(ex.name)) err(ex.line, "DUPLICATE", `example "${ex.name}" declared twice`);
    exNames.add(ex.name);
    if (!ex.steps.length) err(ex.line, "SYNTAX", "an example needs steps");
    // Screen flow: which screen the example is on, so a `see` checks the right one. Each example
    // starts at the first screen (the address `/`); `open`, `go back` and a button's `go to` move it.
    let current = app.screens?.[0]?.name;
    const stack: string[] = [];
    const goTo = (name: string | undefined) => { if (name) (stack.push(current!), (current = name)); };
    const goBack = () => { if (stack.length) current = stack.pop()!; };
    // Where a click goes: a `go to` / `go back` at the handler's top level is certain; one inside an
    // `if` or a loop depends on the state, so after it the screen is unknown (and not checked) until
    // an `open` or a certain move says again.
    const navOf = (button: string): string | "back" | "unknown" | undefined => {
      // Once per button, for all examples: a long example clicks the same buttons many times.
      if (navCache.has(button)) return navCache.get(button);
      const found = navOfButton(button);
      navCache.set(button, found);
      return found;
    };
    const navOfButton = (button: string): string | "back" | "unknown" | undefined => {
      const h = clickHandlers.get(button);
      const dest = (text: string) => text.match(/\bgo\s+to\s+@?([a-z]\w*)/i)?.[1] ?? (/\bgo\s+back\b/.test(text) ? "back" : undefined);
      const nested = (b: Stmt[]): boolean => b.some((st) => (st.k === "if" ? st.branches.some((br) => nested(br.body) || br.body.some((x) => "text" in x && dest(x.text as string))) : st.k === "for" ? st.body.some((x) => "text" in x && dest(x.text as string)) || nested(st.body) : false));
      if (h?.body && nested(h.body)) return "unknown";
      return (h?.steps ?? []).map(dest).find(Boolean);
    };
    const onScreen = (el: Element) => !app.screens?.length || !el.screen || current === undefined || el.screen === current;
    for (const s of ex.steps) {
      if (s.do === "tick") {
        // `tick` needs a clock tick; `wait` needs one, or an app that reads the clock (@now, @today).
        if (!app.clockMs && !(s.ms && (usesClock(app) || app.clients?.some((c) => c.providerClock)))) err(s.line, "STEP", s.ms ? "`wait` moves the clock on: it needs `clock every …`, or sentences that read `@now` or `@today` (here or in a provider named in `tested with`)" : "`tick` needs a `clock every …` block");
        continue;
      }
      if (s.do === "call" && s.endpoint.includes(".")) {
        // Another client calls the provider: \`call tickets.createTicket with …\`.
        const [alias, epName] = s.endpoint.split(".");
        const client = app.clients?.find((c) => c.alias === alias);
        const ep = client?.contract.endpoints?.find((e) => e.name === epName);
        if (!client) err(s.line, "UNKNOWN_NAME", `no client \`${alias}\`; declare it with \`uses <contract> as ${alias}\``);
        else if (!ep) err(s.line, "UNKNOWN_NAME", `contract ${client.contract.name} has no endpoint \`${epName}\``);
        else {
          if (!client.testedWith) err(s.line, "STEP", `another client's call needs a provider: add \`tested with "…"\` under \`uses ${client.contract.name} as ${alias}\``);
          for (const a of s.args) if (!ep.params.some((p) => p.name === a.name)) err(s.line, "UNKNOWN_NAME", `endpoint ${epName} has no param \`${a.name}\` (${ep.params.map((p) => p.name).join(", ") || "none"})`);
        }
        if (ex.line === 0) err(s.line, "SYNTAX", "`always` holds only `see` checks");
        continue;
      }
      if (s.do === "given") {
        err(s.line, "STEP", "`given` belongs to a layer's examples");
        continue;
      }
      if (s.do === "call" || s.do === "request") {
        err(s.line, "STEP", `\`${s.do}\` belongs to the api profile (add \`profile api\`); a screen is driven with click, type, toggle and choose`);
        continue;
      }
      if (s.do === "open" || s.do === "back") {
        if (ex.line === 0) err(s.line, "SYNTAX", "`always` holds only `see` checks");
        else if (!app.screens?.length) err(s.line, "STEP", `\`${s.do === "open" ? "open" : "go back"}\` moves between screens; this app has one screen`);
        else if (s.do === "open" && !app.screens.some((sc) => screenMatch(sc.path, s.path))) err(s.line, "STEP", `\`${s.path}\` is no screen's address (${app.screens.map((sc) => sc.path).join(", ")}); an unknown address shows the first screen, which is rarely what an example means`);
        else if (s.do === "open") goTo(app.screens.find((sc) => screenMatch(sc.path, s.path))?.name);
        else goBack();
        continue;
      }
      if (s.do === "random") {
        if (ex.line === 0) err(s.line, "SYNTAX", "`always` holds only `see` checks");
        continue; // checked against the spec's draws (compiler/draws.ts)
      }
      if (s.do === "steer") {
        const client = app.clients?.find((c) => c.alias === s.api);
        if (ex.line === 0) err(s.line, "SYNTAX", "`always` holds only `see` checks");
        else if (!client) err(s.line, "STEP", `\`steer\` goes wrong on the way to an api this screen uses; there is no \`${s.api}\`${app.clients?.length ? ` (${app.clients.map((c) => c.alias).join(", ")})` : ""}`);
        else if (!client.testedWith) err(s.line, "STEP", `\`steer ${s.api}\` needs a real provider to go wrong with: add \`tested with "…"\` to its \`uses\``);
        continue;
      }
      if (s.do === "size") {
        if (ex.line === 0) err(s.line, "SYNTAX", "`always` holds only `see` checks");
        else if (!app.sizes) err(s.line, "STEP", "`size …` shows the app at another size: declare them first, `sizes Compact | Standard`");
        else if (!app.sizes.includes(s.size)) err(s.line, "UNKNOWN_NAME", `no size \`${s.size}\` (${app.sizes.join(", ")})`);
        continue;
      }
      if (s.do === "restart") {
        if (ex.line === 0) err(s.line, "SYNTAX", "`always` holds only `see` checks");
        else if (!app.state.some((f) => f.stored)) warn(s.line, "STEP", "`restart` starts the app again, but no state is `stored`: everything starts from its default");
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
        const list = all.find((a) => a.el.name === s.every && a.el.kind === "list" && onScreen(a.el));
        const inRow = all.filter((a) => a.list?.name === s.every);
        if (!list) err(s.line, "UNKNOWN_NAME", `no list \`${s.every}\`${suggest(s.every, lists.map((l) => l.name))}`);
        else if (!inRow.some((a) => a.el.name === s.target)) err(s.line, "UNKNOWN_NAME", `rows of \`${s.every}\` have no \`${s.target}\`${suggest(s.target, inRow.map((a) => a.el.name))}`);
        else if (s.check.is === "num" && s.check.ref && !inRow.some((a) => a.el.name === (s.check as { ref: string }).ref)) err(s.line, "UNKNOWN_NAME", `rows of \`${s.every}\` have no \`${(s.check as { ref: string }).ref}\``);
        seen.add(`${s.every}.${s.target}`);
        continue;
      }
      // `see screen = ticket`, `see path = "/tickets/2"`: where an app with several screens is.
      if (s.do === "see" && (s.target === "screen" || s.target === "path") && !findEl(s.target).length) {
        if (!app.screens?.length) err(s.line, "STEP", `\`see ${s.target}\` is for apps with several screens`);
        else if (s.check.is !== "eq") err(s.line, "STEP", `write \`see ${s.target} = ${s.target === "screen" ? app.screens[0].name : '"/"'}\``);
        else if (s.target === "screen" && !app.screens.some((sc) => sc.name === (s.check as { value: string }).value)) err(s.line, "UNKNOWN_NAME", `no screen \`${(s.check as { value: string }).value}\`${suggest((s.check as { value: string }).value, app.screens.map((sc) => sc.name))}`);
        else if (s.target === "path") {
          const value = (s.check as { value: string }).value;
          const screen = app.screens.find((sc) => screenMatch(sc.path, value));
          if (!screen) err(s.line, "STEP", `\`${value}\` is no screen's address (${app.screens.map((sc) => sc.path).join(", ")})`);
          else {
            const parts = screen.path.split("/");
            const actual = value.split("?")[0].split("/");
            for (const [i, part] of parts.entries()) {
              const m = part.match(/^\{([a-z]\w*)\}$/);
              const p = m && screen.params.find((x) => x.name === m[1]);
              const seg = decodeURIComponent(actual[i] ?? "");
              if (p && p.type.k === "Int" && !/^-?\d+$/.test(seg)) err(s.line, "STEP", `\`${seg}\` is not an Int for \`${m![1]}\` in ${screen.path}`);
            }
          }
        }
        continue;
      }
      const cands = findEl(s.target).filter((c) => onScreen(c.el) && fitsRows(c, at));
      if (!cands.length) {
        const any = findEl(s.target);
        const elsewhere = app.screens?.length && any.find((a) => !onScreen(a.el));
        const levels = levelsOf(at);
        const deep = any.find((a) => a.path.length > 1);
        if (elsewhere) err(s.line, "STEP", `\`${s.target}\` is on screen \`${elsewhere.el.screen}\`, not \`${current}\`; \`open\` or \`go to\` it first`);
        else if (any.length && at && any.every((a) => !a.list)) err(s.line, "STEP", `\`${s.target}\` is not inside a list; drop \`on row …\``);
        else if (any.length && !at) err(s.line, "STEP", `\`${s.target}\` is inside ${inWords(any[0].path)}; say which row${any[0].path.length > 1 ? "s (one `on row` per level, the innermost first)" : ""}: \`… ${rowsWords(any[0].path)}\``);
        else if (any.length && any.every((a) => a.path.length !== levels.length)) {
          const a = any[0];
          err(s.line, "STEP", `\`${s.target}\` is inside ${inWords(a.path)}: ${a.path.length > levels.length ? `say which rows, one \`on row\` per level, the innermost first: \`… ${rowsWords(a.path)}\`` : `that is ${a.path.length > 1 ? `${a.path.length} levels of rows, so one \`on row\` per level` : "one level of rows, so one `on row`"}: \`… ${rowsWords(a.path)}\``}`);
        } else if (deep && levels.length === deep.path.length && levels.some((x, i) => x.list && [...deep.path].reverse().some((l, j) => j !== i && l.name === x.list)))
          err(s.line, "STEP", `\`${s.target}\` is inside ${inWords(deep.path)}: rows are named innermost first: \`… ${[...deep.path].reverse().map((l) => `on row 1 of ${l.name}`).join(" ")}\``);
        else err(s.line, "UNKNOWN_NAME", `no element \`${s.target}\`${at?.list ? ` in list ${at.list}` : ""}${suggest(s.target, all.map((a) => a.el.name))}`);
        continue;
      }
      if (cands.length > 1) {
        if (at) err(s.line, "STEP", `\`${s.target}\` is in several lists; add \`of <list>\``);
        else err(s.line, "STEP", `\`${s.target}\` is ambiguous: it is declared more than once`);
        continue;
      }
      const { el, list, path } = cands[0];
      // Each level of rows names its list (the printed spec says it): innermost first.
      levelsOf(at).forEach((x, i) => (x.list = path[path.length - 1 - i].name));
      const need = (kinds: ElementKind[], what: string) => {
        if (!kinds.includes(el.kind)) err(s.line, "STEP", `cannot ${what} \`${el.name}\`: it is a ${el.kind}`);
      };
      switch (s.do) {
        case "type": need(["field"], "type into"); break;
        case "click": {
          need(["button"], "click");
          const dest = navOf(el.name);
          if (dest === "unknown") (current = undefined), (stack.length = 0);
          else if (dest === "back") goBack();
          else if (dest) goTo(dest);
          break;
        }
        case "toggle": need(["checkbox"], "toggle"); break;
        case "choose": {
          need(["select"], "choose in");
          if (el.from) {
            if (!s.quoted) err(s.line, "STEP", `options of \`${el.name}\` are texts: write \`choose "${s.value}" in ${el.name}\``);
            break;
          }
          if (s.quoted) err(s.line, "STEP", `options of \`${el.name}\` are choice values: write \`choose ${s.value} in ${el.name}\` without quotes`);
          // A select inside a list row sets the row item's field; a top-level one, the state field.
          const t = list ? app.records.find((r) => r.name === list.of)?.fields.find((f) => f.name === el.name)?.type : state.get(el.name)?.type;
          const ch = t?.k === "Named" ? choices.get(t.name) : undefined;
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
  // What the examples prove, and the components used: facts the quality rules judge (std.quality).
  app.facts = { ...app.facts, proven: [...seen], usedComponents: [...usedComponents], clockLine };
}

/** A see-target on a raw answer: \`status\`, \`header.x\`, \`body…\` (layers), or the same after \`request.\` (apps). */
const RAW_TARGET = /^(?:request\.)?(status|header\.[a-z0-9-]+|body(?:[.[].*)?)$/;

function checkLayer(app: App, err: Err, warn: Err, checkType: (t: Type, line: number) => boolean) {
  const params = new Map((app.params ?? []).map((p) => [p.name, p]));
  for (const p of app.params ?? []) checkType(p.type, p.line);
  for (const p of app.provides ?? []) checkType(p.type, p.line);
  for (const b of app.exampleConfig ?? []) if (!params.has(b.name)) err(b.line, "UNKNOWN_NAME", `the layer has no param \`${b.name}\`${suggest(b.name, [...params.keys()])}`);
  // \`acts as\`: a Text param names the header, a list param of records holds each key's secret and owner.
  const acts = app.actsAs;
  if (acts) {
    const header = params.get(acts.header);
    const list = params.get(acts.list);
    const rec = list?.type.k === "List" && list.type.of.k === "Named" ? app.records.find((r) => r.name === (list.type as { of: { name: string } }).of.name) : undefined;
    if (!app.provides?.some((p) => p.name === "caller")) err(acts.line, "ACCESS", "`acts as @caller`: this layer does not provide `caller`");
    if (!header) err(acts.line, "UNKNOWN_NAME", `the layer has no param \`${acts.header}\` (the header's name)${suggest(acts.header, [...params.keys()])}`);
    else if (header.type.k !== "Text") err(acts.line, "TYPE", `\`@${acts.header}\` names the header, so it is Text, not ${typeToString(header.type)}`);
    if (!list) err(acts.line, "UNKNOWN_NAME", `the layer has no param \`${acts.list}\` (the keys)${suggest(acts.list, [...params.keys()])}`);
    else if (!rec) err(acts.line, "TYPE", `\`@${acts.list}\` holds the keys: a list of records, not ${typeToString(list.type)}`);
    else
      for (const f of [acts.secret, acts.owner]) {
        const field = rec.fields.find((x) => x.name === f);
        if (!field) err(acts.line, "UNKNOWN_NAME", `${rec.name} has no field \`${f}\``);
        else if (field.type.k !== "Text") err(acts.line, "TYPE", `${rec.name}.${f} is ${typeToString(field.type)}, not Text`);
      }
  }
  const bound = new Set((app.exampleConfig ?? []).map((b) => b.name));
  for (const p of app.params ?? []) if (!p.default && !bound.has(p.name)) err(p.line, "BAD_BINDING", `param \`${p.name}\` has no default: give its value for the examples under \`examples with\``);
  for (const ex of [...app.examples, { name: "(always)", steps: app.always, line: 0 }])
    for (const s of ex.steps) {
      if (s.do === "request") continue;
      if (s.do === "given") {
        if (!params.has(s.name)) err(s.line, "UNKNOWN_NAME", `the layer has no param \`${s.name}\`${suggest(s.name, [...params.keys()])}`);
        continue;
      }
      if (s.do === "see" && RAW_TARGET.test(s.target)) continue;
      if (s.do === "see") err(s.line, "UNKNOWN_NAME", `a layer's example sees the answer: \`see status = 200\`, \`see header vary = "origin"\`, \`see body.reached = true\``);
      else err(s.line, "STEP", `a layer's example sends \`request METHOD "/path" with header name = "…"\` and checks with \`see\`, not \`${s.do}\``);
    }
}

function checkApi(
  app: App,
  err: (l: number, c: string, m: string, col?: number) => void,
  warn: (l: number, c: string, m: string, col?: number) => void,
  ctx: { records: Map<string, RecordDecl>; choices: Map<string, ChoiceDecl>; state: Map<string, Field>; derived: Set<string>; checkType: (t: Type, line: number) => boolean; checkReserved: (n: string, line: number) => void },
) {
  const eps = new Map<string, Endpoint>();
  if (app.screen.length) err(app.screen[0].line, "SYNTAX", "an api has endpoints, not a screen");
  // An api starts from its state's defaults and what it stored; nothing runs when it starts (so far).
  for (const h of app.handlers) if (h.verb === "start") err(h.line, "NOT_YET", "an api has no `on start` yet: it starts from its state's defaults and what it stored; write what it starts with as the state's default (seed data as a table)");
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
      for (const [i, st] of ep.steps.entries())
        for (const m of st.matchAll(/\banswer\s+([1-5]\d\d)\b/g))
          if (!declared.has(Number(m[1]))) err(ep.stepLines?.[i] ?? ep.line, "CONTRACT", `endpoint ${ep.name} answers ${m[1]}, which its contract does not declare (${[...declared].join(", ")}); add \`answers ${m[1]} …\` to the contract, or answer differently`);
    }
    // A refusal says why: `answer 409` with nothing after it tells the caller nothing.
    for (const [i, st] of ep.steps.entries())
      for (const m of st.matchAll(/\banswer\s+([45]\d\d)\s*$/g))
        err(ep.stepLines?.[i] ?? ep.line, "STEP", `\`answer ${m[1]}\` needs a message: write \`answer ${m[1]} "…"\``);
  }
  // Events: declared once, with a payload type; \`publish x\` in steps names a declared event.
  const events = new Map<string, NonNullable<App["events"]>[number]>();
  for (const e of app.events ?? []) {
    if (events.has(e.name)) err(e.line, "DUPLICATE", `event \`${e.name}\` is declared twice`);
    events.set(e.name, e);
    ctx.checkType(e.type, e.line);
    if (eps.has(e.name)) err(e.line, "DUPLICATE", `\`${e.name}\` is both an endpoint and an event`);
  }
  for (const ep of [...eps.values(), ...(app.jobs ?? [])])
    for (const [i, st] of ep.steps.entries())
      for (const m of st.matchAll(/\bpublish(?:es)?\s+@?([a-z]\w*)/gi))
        if (!events.has(m[1])) err(ep.stepLines?.[i] ?? ep.line, "UNKNOWN_NAME", `${"every" in ep ? `every ${ep.name.slice(5)}` : `endpoint ${ep.name}`} publishes \`${m[1]}\`, which is not a declared event${suggest(m[1], [...events.keys()])}; declare it with \`event ${m[1]}: <Type>\``);
  // A path into an answer or event body: `body.items[1].id`. Returns the type it lands on, or what is wrong.
  const bodyWalk = (t: Type, ps: string[], listNeeded: boolean): string | Type => {
    let cur: Type = t;
    for (const [i, p] of ps.entries()) {
      if (cur.k === "Maybe") cur = cur.of;
      if (listNeeded && i === ps.length - 1 && cur.k === "List") cur = cur.of; // `see every row of x.body: field`
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
    return cur;
  };
  const checkBodyEq = (target: string, s: Extract<Step, { do: "see" }>, t: Type) => {
    if (absentOnNothing(target, s, [t]) || nothingOnT(target, s, [t])) return;
    // The value compared with must be one the field can hold: `see x.body.id = "ten"` is a mistake.
    if (s.check.is === "eq" && !(t.k === "Named" && ctx.records.has(t.name) ? (s.check as { value: string }).value.startsWith("{") : valueFits(t, (s.check as { value: string }).value, ctx.choices)))
      err(s.line, "STEP", `\`${target}\` is ${typeToString(t)}; ${JSON.stringify((s.check as { value: string }).value)} can never be equal to it`);
  };
  // Nothing on the wire is `null`, never a missing key: a declared `T or nothing` is always there, so
  // `is absent` can never hold for it; `= nothing` asks. (`is absent` stays for headers, events and
  // paths outside the declared type.)
  const absentOnNothing = (target: string, s: Extract<Step, { do: "see" }>, found: Type[]): boolean => {
    if (s.check.is !== "hidden" || s.every || !found.some((t) => t.k === "Maybe")) return false;
    err(s.line, "STEP", `\`is absent\` is written \`= nothing\` here: \`${target}\` is ${typeToString(found.find((t) => t.k === "Maybe")!)}, which is always in the answer (nothing is written as \`null\`, never left out); \`is absent\` is only for headers, events and paths outside the declared type (\`intent fix\` rewrites it)`);
    return true;
  };
  // `= nothing` on a value that is never nothing (a `T`): it can never hold.
  const nothingOnT = (target: string, s: Extract<Step, { do: "see" }>, found: Type[]): boolean => {
    if (s.check.is !== "eq" || !s.check.nothing || found.some((t) => t.k === "Maybe")) return false;
    err(s.line, "STEP", `\`${target}\` is ${typeToString(found[0])}, never nothing: \`= nothing\` can never hold`);
    return true;
  };
  // Examples: `call` an endpoint with its params; `see <endpoint>.status|body…`; `see <event>.body…` (what the latest call published).
  for (const ex of [...app.examples, { name: "(always)", steps: app.always, line: 0 }]) {
    for (const s of ex.steps) {
      if (s.do === "call") {
        const ep = eps.get(s.endpoint);
        if (!ep) {
          err(s.line, "UNKNOWN_NAME", `no endpoint \`${s.endpoint}\`${suggest(s.endpoint, [...eps.keys()])}`);
          continue;
        }
        for (const a of s.args) {
          const param = ep.params.find((p) => p.name === a.name);
          if (!param) err(s.line, "UNKNOWN_NAME", `endpoint ${ep.name} has no param \`${a.name}\` (${ep.params.map((p) => p.name).join(", ") || "none"})`);
          else {
            const wrong = argShape(a.value, param.type, app);
            if (wrong) err(s.line, "STEP", `\`${a.name}\`: ${wrong}`);
            // A date literal must be a real day: `day = 2026-02-30` is not a Date.
            else if (dateType(param.type) && !literalFits(a.value, param.type, ctx.choices)) err(s.line, "STEP", `\`${a.name}\` does not fit ${typeToString(param.type)}: ${JSON.stringify(String((a.value as { v?: unknown }).v ?? a.value.k))}`);
          }
        }
      } else if (s.do === "request") {
        continue;
      } else if (s.do === "see" && s.target.startsWith("request.")) {
        if (!RAW_TARGET.test(s.target)) err(s.line, "UNKNOWN_NAME", "a raw answer has `request.status`, `request.header.<name>` and `request.body…`");
      } else if (s.do === "see" && /^audit\b/.test(s.target)) {
        continue; // the access audit (compiler/access.ts checks it)
      } else if (s.do === "see" && /^[a-z]\w*\.header\./i.test(s.target)) {
        if (!eps.has(s.target.split(".")[0])) err(s.line, "UNKNOWN_NAME", `\`${s.target.split(".")[0]}\` is not an endpoint`);
      } else if (s.do === "see") {
        const [head, part] = s.target.split(/[.[]/);
        const target = s.every ?? s.target;
        const h = target.split(/[.[]/)[0];
        if (events.has(h)) {
          // `see ticketCreated.body.subject = "…"`: the event as the latest call published it; `see ticketCreated is absent`.
          if (part !== undefined && part !== "body") err(s.line, "UNKNOWN_NAME", `an event has a \`body\`: \`see ${h}.body.<field>\``);
          else {
            // The path into the body must exist in the event's payload type.
            const parts = (target.match(/[a-z]\w*|\[\d+\]/gi) ?? []).slice(1);
            if (parts[0] === "body") {
              const rest = [...parts.slice(1), ...(s.every ? [s.target] : [])];
              const r = bodyWalk(events.get(h)!.type, rest, s.check.is === "rows");
              const shown = `${target}${s.every ? `: ${s.target}` : ""}`;
              if (typeof r === "string") err(s.line, "UNKNOWN_NAME", `\`${shown}\`: ${r}`);
              else checkBodyEq(shown, s, r);
            }
          }
          continue;
        }
        if (!eps.has(h)) err(s.line, "UNKNOWN_NAME", `\`${h}\` is not an endpoint or an event; check a response as \`see ${[...eps.keys()][0] ?? "endpoint"}.status = 200\` or \`….body.<field>\``);
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
            const walk = (t: Type, ps: string[], listNeeded: boolean): string | Type => {
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
              return cur;
            };
            const results = types.map((t) => walk(t, rest, s.check.is === "rows"));
            const found = results.filter((r): r is Type => typeof r !== "string");
            if (!found.length) err(s.line, "UNKNOWN_NAME", `\`${target}${s.every ? `: ${s.target}` : ""}\`: ${results[0]}`);
            else if (absentOnNothing(target, s, found) || nothingOnT(target, s, found)) continue;
            // The value compared with must be one the field can hold: `see x.body.id = "ten"` is a mistake.
            else if (s.check.is === "eq" && !found.some((t) => (t.k === "Named" && ctx.records.has(t.name) ? (s.check as { value: string }).value.startsWith("{") : valueFits(t, (s.check as { value: string }).value, ctx.choices))))
              err(s.line, "STEP", `\`${target}${s.every ? `: ${s.target}` : ""}\` is ${typeToString(found[0])}; ${JSON.stringify((s.check as { value: string }).value)} can never be equal to it`);
          }
        }
      } else if (s.do === "tick" && s.ms) {
        if (!usesClock(app)) err(s.line, "STEP", "`wait` moves the clock on: this api reads no `@now` or `@today`, and has no `every …` work");
      } else if (s.do === "restart") {
        if (!app.state.some((f) => f.stored)) warn(s.line, "STEP", "`restart` starts the api again, but no state is `stored`: everything starts from its default");
      } else if (s.do === "random") {
        if (ex.line === 0) err(s.line, "SYNTAX", "`always` holds only `see` checks"); // steering is checked against the draws (compiler/draws.ts)
      } else if (s.do !== "snapshot") err(s.line, "STEP", `an api example uses \`call\`, \`see\`, \`wait\`, \`restart\` and \`steer random\`, not \`${s.do}\``);
    }
  }
}

/** Is this a Date or DateTime (or `T or nothing` of one)? */
function dateType(t: Type): boolean {
  if (t.k === "Maybe") return dateType(t.of);
  return t.k === "Date" || t.k === "DateTime";
}

function literalFits(l: Literal, t: Type, choices: Map<string, ChoiceDecl>): boolean {
  switch (t.k) {
    case "Text": return l.k === "text";
    case "Int": return l.k === "number" && Number.isInteger(l.v) && !l.raw.includes(".");
    case "Decimal": return l.k === "number";
    case "Bool": return l.k === "bool";
    case "Date": return l.k === "date" && parseDate(l.v) === l.v;
    case "DateTime": return l.k === "dateTime" && parseDateTime(l.v) === l.v;
    case "List": return l.k === "emptyList" || l.k === "table";
    case "Maybe": return l.k === "nothing" || literalFits(l, t.of, choices);
    case "Named": {
      const r = REFINED.get(t.name);
      if (r) return literalFits(l, { k: r.base }, choices) && satisfies(r, l.k === "text" ? l.v : l.k === "number" ? l.v : undefined);
      return l.k === "value" && !!choices.get(t.name)?.values.includes(l.v);
    }
    case "Ref": return t.key ? literalFits(l, t.key, choices) : false;
  }
}

/** The refined types of the app being checked (set by check). */
let REFINED = new Map<string, RefinedDecl>();

/** Does a value satisfy a refined type's rule? The same rule the generated validators apply. */
/** Can a value of this type be shown as this text? (For `see … = value` checks.) */
function valueFits(t: Type, v: string, choices: Map<string, ChoiceDecl>): boolean {
  if (t.k === "Maybe") return v === "nothing" || v === "" || valueFits(t.of, v, choices);
  if (t.k === "Int") return /^-?\d+$/.test(v);
  if (t.k === "Decimal") return /^-?\d+(\.\d+)?$/.test(v);
  if (t.k === "Bool") return v === "true" || v === "false";
  if (t.k === "Date") return /^\d{4}-\d{2}-\d{2}$/.test(v);
  if (t.k === "DateTime") return /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(v);
  if (t.k === "Named" && choices.has(t.name)) return choices.get(t.name)!.values.includes(v);
  if (t.k === "List") return v.startsWith("[");
  return true; // text, and refined types (their rule is checked at run time)
}

export function satisfies(r: RefinedDecl, v: string | number | undefined): boolean {
  if (v === undefined) return false;
  // A code: exactly n characters of its alphabet (literals are written in the normal form: capitals for `unambiguous`).
  if (r.code) return typeof v === "string" && [...v].length === r.code.n && [...v].every((c) => r.code!.chars.includes(c));
  if (r.pattern !== undefined) return typeof v === "string" && new RegExp(`^(?:${r.pattern})$`).test(v);
  if (r.base === "Text") return typeof v === "string" && (r.minLength === undefined || [...v].length >= r.minLength) && (r.maxLength === undefined || [...v].length <= r.maxLength);
  if (typeof v !== "number") return false;
  return (r.min === undefined || v >= r.min) && (r.max === undefined || v <= r.max);
}

// ---------------------------------------------------------------- hints


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
