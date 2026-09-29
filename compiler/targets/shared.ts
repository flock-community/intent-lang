// What every target shares: the installation and project folders, naming, the events a screen
// has, the app's data, the client layers' composition, and the page around a build.
import { copyFileSync, existsSync, mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import type { App, Element, Literal, RecordDecl, Type } from "../ast.ts";
import { homeOf, keyedLists } from "../homes.ts";
import { STYLE } from "../../runtime/ts/ui.ts";
import { literalJson, typeDesc } from "../api.ts";
import { throughs } from "../calls.ts";
import { usesDraws } from "../draws.ts";

export type Target = "elm" | "ts";

export const ROOT = join(dirname(fileURLToPath(import.meta.url)), "../.."); // the Intent installation

/**
 * The user's project: the nearest folder (from where the command runs) with an intent.project or
 * intent.lock; without one, the folder the command runs in (a new project: `intent lock` starts
 * its lock there). Never the installation by accident: its lock and cache are its own. The
 * project's lib/, intent.lock, intent.project and .intent/ belong to the project; the language
 * reference, runtimes and standard library come from the Intent installation (ROOT).
 */
export const PROJECT_ROOT = (() => {
  for (let d = process.cwd(); ; d = dirname(d)) {
    if (existsSync(join(d, "intent.project")) || existsSync(join(d, "intent.lock"))) return d;
    if (dirname(d) === d) return process.cwd();
  }
})();

export const cap = (s: string) => s[0].toUpperCase() + s.slice(1);

/** Does the app declare a code type (`Text of 6 digits`)? Its checks use the harness's reader. */
export const hasCodes = (app: App) => (app.refined ?? []).some((r) => r.code);

/** Words a generated identifier cannot be: the keywords of the targets (Elm, TypeScript and
 *  JavaScript, and Kotlin for the targets to come) and the names the harness generates. A spec may
 *  use them as names (only Intent's own words are reserved, parse.ts RESERVED): the harness writes
 *  such a name with a trailing `_` wherever it would be an identifier the target refuses — in Elm a
 *  record field, a type, a constructor (`type` → `type_`, a record `Model` → `Model_`); in TypeScript a
 *  type name (a property may be a keyword there, so records stay as they are on the wire) — and as
 *  itself wherever it is data (JSON keys, `data-el`, the source map, examples). A spec name never has
 *  an `_`, so a mangled name meets no other. Every other name is written as it is. */
export const TARGET_WORDS = new Set([
  // Elm
  "if", "then", "else", "case", "of", "let", "in", "type", "module", "where", "import", "exposing", "as", "port", "alias", "infix", "effect",
  // TypeScript / JavaScript
  "break", "catch", "class", "const", "continue", "debugger", "default", "delete", "do", "enum", "export", "extends", "finally",
  "for", "function", "instanceof", "new", "null", "return", "super", "switch", "this", "throw", "try", "typeof", "var", "void",
  "while", "with", "yield", "static", "implements", "interface", "package", "private", "protected", "public", "await", "async",
  "undefined", "arguments", "eval",
  // Kotlin
  "fun", "val", "when", "is", "object", "typealias",
  // generated types, and the modules and types a generated file names
  "Model", "Msg", "Screen", "Button", "LabeledButton", "Pick", "Node", "Wire", "Ui", "Fmt", "Spec", "App", "Main", "Worker",
  "String", "Float", "Just", "Nothing", "True", "False", "Tick", "Ok", "Err", "Result",
  "Html", "Sub", "Cmd", "Json", "Dict", "Set", "Array", "Char", "Basics", "Debug", "Platform", "Time", "Browser",
  "Program", "Tuple", "Regex", "Url", "Draw", "Crypto", "Data", "Stored", "Route", "Go", "Stay", "GoTo", "GoBack", "NoOp",
  "ScreenOpened", "Started", "Call", "Through", "Draws", "Clock", "Source", "Request", "Response", "Handlers", "Published", "Jobs",
  "Config", "Provided", "TypeDesc", "EndpointDesc", "Record", "Map", "Promise", "Error", "Object", "Boolean", "Symbol",
  "JSON", "Math", "RegExp", "Extract", "Partial",
]);
/** A spec name as a generated identifier (see TARGET_WORDS). */
export const mangle = (name: string) => (TARGET_WORDS.has(name) ? `${name}_` : name);

/** The spec's names a target's generated interface writes mangled (for the prompt): in Elm every
 *  name that is an identifier there, in TypeScript the type names. */
export function mangledNames(app: App, target: "elm" | "ts"): string[] {
  const types = [...app.records.map((r) => r.name), ...app.choices.map((c) => c.name), ...(app.refined ?? []).map((r) => r.name)];
  const walk = (els: Element[]): string[] => els.flatMap((e) => [e.name.slice(e.name.lastIndexOf(".") + 1), ...walk(e.children ?? [])]);
  const values =
    target === "ts"
      ? types
      : [
          ...types,
          ...app.choices.flatMap((c) => c.values),
          ...app.records.flatMap((r) => r.fields.map((f) => f.name)),
          ...app.state.map((f) => f.name),
          ...walk(app.screen),
          ...(app.screens ?? []).flatMap((s) => s.params.map((p) => p.name)),
          ...(app.clients ?? []).map((c) => c.alias),
        ];
  return [...new Set(values.filter((n) => TARGET_WORDS.has(n)))].sort();
}

// Names of component instances are qualified (`pager.next`): a record field uses the last part,
// a type or event tag joins all parts (`PagerNext`).
export const ident = (name: string) => name.slice(name.lastIndexOf(".") + 1);

export const typeName = (name: string) => name.split(".").map(cap).join("");

export const lowerFirst = (s: string) => s[0].toLowerCase() + s.slice(1);

export const q = (s: string) => JSON.stringify(s);

/**
 * An Elm string literal. JSON's escapes are Elm's except for control characters: Elm writes
 * `\u{0001}` where JSON writes `\u0001`, and has no `\b` or `\f`.
 */
export const elmQ = (s: string) => JSON.stringify(s).replace(/\\\\|\\u([0-9a-fA-F]{4})|\\b|\\f/g, (m, h?: string) => (m === "\\\\" ? m : h ? `\\u{${h}}` : m === "\\b" ? "\\u{0008}" : "\\u{000C}"));

/**
 * Spec text inside a generated comment (TypeScript \`/** … *\/\` and \`//\`, Elm \`{-| … -}\` and \`--\`):
 * nothing in it may end the comment, open a nested one (Elm's nest), or start a new line (a line
 * comment ends there; U+2028 and U+2029 end a line in JavaScript too). Every template uses it for
 * every piece of spec text it puts in a comment.
 */
export const doc = (s: string) =>
  s
    .replace(/[\u0000-\u001f\u007f-\u009f\u2028\u2029]/g, " ")
    .replace(/\*\//g, "* /")
    .replace(/\/\*/g, "/ *")
    .replace(/-\}/g, "- }")
    .replace(/\{-/g, "{ -");

/** Text in HTML. */
export const escapeHtml = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

export interface EventDef {
  tag: string;
  on: "click" | "toggle" | "input" | "choose" | "tick";
  target: string; // wire target: "list.name" inside rows, "list.inner.name" inside a row of a list inside a row
  // key: the row's key; keys: a row inside a row, with the outer row's key too (outerKey, then key)
  payload?: "key" | "text" | "value" | "pick" | "key-text" | "key-value" | "key-pick" | "keys" | "keys-text" | "keys-value" | "keys-pick";
  choice?: string;
}

export function events(app: App): EventDef[] {
  const out: EventDef[] = [];
  const stateType = (n: string) => app.state.find((f) => f.name === n)?.type;
  // `lists`: the lists around the element, outermost first (a row inside a row has two).
  const walk = (els: Element[], lists: Element[]) => {
    const list = lists[lists.length - 1];
    const k = lists.length > 1 ? "keys" : lists.length ? "key" : "";
    for (const el of els) {
      if (el.kind === "heading") continue;
      const prefix = [...lists, el].map((x) => typeName(x.name)).join("");
      const target = [...lists, el].map((x) => x.name).join(".");
      if (el.kind === "button") out.push({ tag: prefix + "Clicked", on: "click", target, payload: k ? (k as "key") : undefined });
      if (el.kind === "checkbox") out.push({ tag: prefix + "Toggled", on: "toggle", target, payload: k ? (k as "key") : undefined });
      if (el.kind === "field") out.push({ tag: prefix + "Typed", on: "input", target, payload: k ? (`${k}-text` as "key-text") : "text" });
      if (el.kind === "select" && el.from) out.push({ tag: prefix + "Chosen", on: "choose", target, payload: k ? (`${k}-pick` as "key-pick") : "pick" });
      else if (el.kind === "select") {
        const t = list ? app.records.find((r) => r.name === list.of)?.fields.find((f) => f.name === el.name)?.type : stateType(el.name);
        out.push({ tag: prefix + "Chosen", on: "choose", target, payload: k ? (`${k}-value` as "key-value") : "value", choice: t?.k === "Named" ? t.name : "" });
      }
      if (el.kind === "list") walk(el.children, [...lists, el]);
      if (el.kind === "section") walk(el.children, lists);
    }
  };
  walk(app.screen, []);
  if (app.clockMs) out.push({ tag: "Tick", on: "tick", target: "" });
  // Two screens may reuse an element name (`back` on both): the handler belongs to the name, so one
  // event covers both.
  const seen = new Set<string>();
  return out.filter((e) => !seen.has(e.tag) && (seen.add(e.tag), true));
}

export function selectChoice(app: App, el: Element, list?: Element): string {
  const t = list ? app.records.find((r) => r.name === list.of)?.fields.find((f) => f.name === el.name)?.type : app.state.find((f) => f.name === el.name)?.type;
  return (t as { name: string } | undefined)?.name ?? "";
}

export type TableLit = Extract<Literal, { k: "table" }>;

export const cellFor = (t: TableLit, row: Literal[], col: string): Literal | undefined => row[t.columns.indexOf(col)];

/** Apps with sentences in `always`: the harness checks them on the app's data after every step. */
export const hasInvariants = (app: App) => !!app.invariants?.length;
/** Several screens, with addresses (`screen <name> "<path>"`). */
export const hasScreens = (app: App) => !!app.screens?.length;

/** State that survives a restart (`stored name: T = …`). */
export const hasStored = (app: App) => app.state.some((f) => f.stored);

/**
 * `on start` in an app with stored fields: the harness owns the order. It starts the app from the
 * defaults (`init`, no `on start` in it), puts back what was kept, and then sends `Started`, the
 * message for `on start`, so `on start` sees what the app remembered (§9).
 */
export const startsAfterRestore = (app: App) => hasStored(app) && app.handlers.some((h) => h.verb === "start");

/** Lists a reference points into, and lists inside rows: the harness checks that their keys stay unique (on the app's data). */
export const hasHomes = (app: App) => keyedLists(app).length > 0;

/**
 * Lists inside rows (a record with a field `List R` of another record, whose rows live in a state
 * list): the harness generates the update of one inner row (found by the outer row's key and its
 * own), so the model never writes the nested update. One per record and field.
 */
export function nestedLists(app: App): { outer: RecordDecl; field: string; inner: RecordDecl }[] {
  const out: { outer: RecordDecl; field: string; inner: RecordDecl }[] = [];
  for (const f of app.state) {
    if (f.name.includes(".") || f.type.k !== "List" || f.type.of.k !== "Named") continue;
    const outer = app.records.find((r) => r.name === (f.type as { of: { name: string } }).of.name);
    for (const g of outer?.fields ?? []) {
      const inner = g.type.k === "List" && g.type.of.k === "Named" ? app.records.find((r) => r.name === (g.type as { of: { name: string } }).of.name) : undefined;
      if (outer && inner && !out.some((x) => x.outer === outer && x.field === g.name)) out.push({ outer, field: g.name, inner });
    }
  }
  return out;
}

/** The records whose rows the nested helpers find by key: every outer and inner record of `nestedLists`. */
export function rowKeyed(app: App): { record: RecordDecl; key?: { name: string; type: Type } }[] {
  const seen = new Set<string>();
  const out: { record: RecordDecl; key?: { name: string; type: Type } }[] = [];
  for (const n of nestedLists(app))
    for (const r of [n.outer, n.inner])
      if (!seen.has(r.name)) {
        seen.add(r.name);
        const k = r.fields.find((f) => f.name === (r.key ?? "id"));
        out.push({ record: r, ...(k ? { key: { name: k.name, type: k.type } } : {}) });
      }
  return out;
}

/** The app hands over its data: for the checks in `always`, to save its stored state, and to check the keys references find rows by. */
// An api with an \`access\` block hands it over too: the harness reads the grants and the rows the rules are about.
export const hasData = (app: App) => hasInvariants(app) || hasStored(app) || hasHomes(app) || (app.layers ?? []).some((l) => l.bindings.some((b) => b.state)) || !!app.access;

/**
 * Following a reference, as the harness generates it for every target: per record a reference
 * points at, a lookup by key in its home list (`ticketByKey`), and per `ref` field of a record a
 * lookup of the row it points at (`commentTicket`). Nothing is copied: the row is found when it is read.
 */
export function refLookups(app: App): { byKey: { fn: string; record: string; list: string; key: string; keyType: Type }[]; fields: { fn: string; holder: string; field: string; record: string; list: string; optional: boolean; byKey: string }[] } {
  const byKey = new Map<string, { fn: string; record: string; list: string; key: string; keyType: Type }>();
  const fields: { fn: string; holder: string; field: string; record: string; list: string; optional: boolean; byKey: string }[] = [];
  const lower = (s: string) => s[0].toLowerCase() + s.slice(1);
  for (const r of app.records)
    for (const f of r.fields) {
      const t = f.type.k === "Maybe" ? f.type.of : f.type;
      if (t.k !== "Ref") continue;
      const list = homeOf(app, t.name, t.in).list;
      const target = app.records.find((x) => x.name === t.name);
      const key = target?.fields.find((x) => x.name === (target.key ?? "id"));
      if (!list || !target || !key) continue;
      const fn = `${lower(t.name)}In${list[0].toUpperCase()}${list.slice(1)}`;
      if (!byKey.has(fn)) byKey.set(fn, { fn, record: t.name, list, key: key.name, keyType: key.type });
      fields.push({ fn: `${lower(r.name)}${f.name[0].toUpperCase()}${f.name.slice(1)}`, holder: r.name, field: f.name, record: t.name, list, optional: f.type.k === "Maybe", byKey: fn });
    }
  // A state field that holds a reference (`chosen: ref Ticket or nothing`) is followed with the lookup by key.
  for (const s of app.state) {
    const t = s.type.k === "Maybe" ? s.type.of : s.type;
    if (t.k !== "Ref" || s.name.includes(".")) continue;
    const list = homeOf(app, t.name, t.in).list;
    const target = app.records.find((x) => x.name === t.name);
    const key = target?.fields.find((x) => x.name === (target.key ?? "id"));
    const fn = list ? `${lower(t.name)}In${list[0].toUpperCase()}${list.slice(1)}` : "";
    if (list && target && key && !byKey.has(fn)) byKey.set(fn, { fn, record: t.name, list, key: key.name, keyType: key.type });
  }
  return { byKey: [...byKey.values()], fields };
}

/** A state field's name in the data: `pager.page` → `pagerPage`. */
export const dataField = (name: string) => name.replace(/\.([a-z])/g, (_, c: string) => c.toUpperCase());

export const storedTypes = (app: App) => app.state.filter((f) => f.stored).map((f) => `${dataField(f.name)}: ${typeDesc(app, f.type)}`).join(", ");

/** The spec's defaults for the stored fields, as JSON: what a field that cannot be migrated keeps. */
export const storedDefaults = (app: App) => app.state.filter((f) => f.stored).map((f) => `${dataField(f.name)}: ${JSON.stringify(f.default?.k === "table" ? [] : literalJson(f.default ?? { k: "nothing" }))}`).join(", ");

/** The client layers of an app's apis (\`through\` under \`uses\`), with their fixed params: used in the browser and in tests. */
export function genThrough(app: App): string {
  const th = throughs(app);
  return `// Generated — do not edit. Each api's client layer, as verified once for its layer spec.
import type { Outgoing } from "./calls.ts";
${th.map((t) => `import * as ${t.alias} from "./layers/${t.alias}/layer.ts";`).join("\n")}

const layers: Record<string, { before: (req: any, config: any) => any; fixed: Record<string, unknown> }> = {
${th.map((t) => `  ${t.alias}: { before: ${t.alias}.before, fixed: ${JSON.stringify(t.fixed)} },`).join("\n")}
};

const lower = (h: Record<string, string>) => Object.fromEntries(Object.entries(h ?? {}).map(([k, v]) => [k.toLowerCase(), String(v)]));

/** A call as it leaves through its api's client layer; config is what the app's state gives the layer. */
export function apply(alias: string, req: Outgoing, config: Record<string, unknown> | undefined): Outgoing {
  const l = layers[alias];
  if (!l) return req;
  const out = l.before(JSON.parse(JSON.stringify(req)), { ...l.fixed, ...(config ?? {}) });
  return { ...out, headers: lower(out.headers) };
}
`;
}

/** Apps that call apis: the client layers' verified modules (built once per layer spec) and their composition. */
export function writeThrough(app: App, dir: string, layerDirs: Record<string, string>) {
  for (const t of throughs(app)) {
    mkdirSync(join(dir, "layers", t.alias), { recursive: true });
    for (const f of ["layer.ts", "spec.ts", "http.ts", "fmt.ts"]) copyFileSync(join(layerDirs[t.alias], f), join(dir, "layers", t.alias, f));
  }
  writeFileSync(join(dir, "through.ts"), genThrough(app));
}

export function html(title: string, scripts: string, elm: boolean): string {
  const style = elm ? `<style>${STYLE}</style>` : "";
  return `<!doctype html>\n<html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${escapeHtml(title)}</title>${style}</head>\n<body><div id="app"></div>${scripts}</body></html>\n`;
}

/** Apps that call apis: the calls runtime, its outbox, and the reviewed SHA-256 an undo's key is made with. */
export function copyCallsRuntime(dir: string) {
  copyFileSync(join(ROOT, "runtime/ts/calls.ts"), join(dir, "calls.ts"));
  copyFileSync(join(ROOT, "runtime/ts/outbox.ts"), join(dir, "outbox.ts"));
  mkdirSync(join(dir, "platform"), { recursive: true });
  copyFileSync(join(ROOT, "runtime/ts/platform/std.crypto.ts"), join(dir, "platform/std.crypto.ts"));
}

/**
 * Draws (v69): the draw runtime and the reviewed SHA-256 it keys with (std.crypto's code, never a
 * home-made hash).
 */
export function copyDrawRuntime(app: App, dir: string) {
  if (usesDraws(app)) {
    copyFileSync(join(ROOT, "runtime/ts/draw.ts"), join(dir, "draw.ts"));
    mkdirSync(join(dir, "platform"), { recursive: true });
    copyFileSync(join(ROOT, "runtime/ts/platform/std.crypto.ts"), join(dir, "platform", "std.crypto.ts"));
  }
}
