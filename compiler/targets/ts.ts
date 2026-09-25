// Target: TypeScript (strict). The generated interface (spec.ts), the entries (browser, tests),
// what the prompt says about TypeScript, the toolchain, and a test session on a compiled build.
import { copyFileSync, existsSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import type { App, Element, Literal, Type } from "../ast.ts";
import { usesClock } from "../refs.ts";
import { typeDesc } from "../api.ts";
import { callDescs, clientEndpoints, clientEvents, eventsByAlias, hasClients, hasThrough, throughs } from "../calls.ts";
import { cap, cellFor, dataField, events, hasData, hasInvariants, hasScreens, hasStored, html, ident, lowerFirst, q, ROOT, selectChoice, storedTypes, typeName, writeThrough, type TableLit } from "./shared.ts";
import { bin, clean, run } from "../tools.ts";
import type { Session, TargetModule } from "./target.ts";

export function tsLiteral(l: Literal): string {
  switch (l.k) {
    case "text": return q(l.v);
    case "number": return l.raw;
    case "bool": return String(l.v);
    case "emptyList": return "[]";
    case "nothing": return "null";
    case "value": return q(l.v);
    case "date": return q(l.v);
    case "dateTime": return q(l.v);
    case "table": return "[]";
    case "list": case "record": throw new Error("list and record values are only call arguments in examples");
  }
}

// ---------------------------------------------------------------- Elm

/** The app's data as TypeScript: every state field, for the checks in `always`. */
export function tsData(app: App): string {
  const stored = app.state.filter((f) => f.stored);
  return `/** The app's data${hasInvariants(app) ? ", for the checks in \`always\`" : ""}${stored.length ? `${hasInvariants(app) ? " and" : ","} to save what is stored` : ""}: every state field, as in the spec. \`data(model)\` in the app module fills it. */\nexport type Data = { ${app.state.map((f) => `${dataField(f.name)}: ${tsType(f.type)}`).join("; ")} };\n\n${
    stored.length
      ? `/** The state that survives a restart (\`stored\` in the spec). \`restore(saved, model)\` in the app module puts it into a freshly started model. */\nexport type Stored = { ${stored.map((f) => `${dataField(f.name)}: ${tsType(f.type)}`).join("; ")} };\n\n`
      : ""
  }`;
}

/** Which fields of the data a restart keeps (for the harness: localStorage, a data file). */
export const tsStoredFields = (app: App) => `/** The stored fields and their types: kept data that does not fit is not restored. */\nexport const storedFields: Record<string, TypeDesc> = { ${storedTypes(app)} };\n\n`;

export function tsType(t: Type): string {
  switch (t.k) {
    case "Text": return "string";
    case "Int":
    case "Decimal": return "number";
    case "Bool": return "boolean";
    case "Date": return "Date";
    case "DateTime": return "DateTime";
    case "List": return `${tsAtom(t.of)}[]`;
    case "Maybe": return `${tsType(t.of)} | null`;
    case "Named": return t.name;
  }
}

export const tsAtom = (t: Type) => (t.k === "Maybe" ? `(${tsType(t)})` : tsType(t));

/** Records, choices and table seeds: the domain, shared by every profile. */
export function tsDomain(app: App): string {
  const out: string[] = [];
  out.push(`/** A day, "YYYY-MM-DD", and a moment to the minute, "YYYY-MM-DDTHH:MM" (local time). Compare and sort them as text; compute with Fmt. */\nexport type Date = string;\nexport type DateTime = string;\n/** The clock: @now and @today in the spec. */\nexport type Clock = { now: DateTime; today: Date };\n\n`);
  for (const r of app.refined ?? []) {
    out.push(`/** A ${r.base === "Text" ? "text" : "number"} with a rule: see is${r.name}. */\nexport type ${r.name} = ${r.base === "Text" ? "string" : "number"};\n`);
    if (r.pattern !== undefined) out.push(`/** Whether a text is a valid ${r.name}. */\nexport function is${r.name}(s: string): boolean {\n  return new RegExp(${q(`^(?:${r.pattern})$`)}).test(s);\n}\n\n`);
    else out.push(`/** Whether a number is a valid ${r.name}. */\nexport function is${r.name}(n: number): boolean {\n  return ${[r.min !== undefined ? `n >= ${r.min}` : "", r.max !== undefined ? `n <= ${r.max}` : ""].filter(Boolean).join(" && ") || "true"};\n}\n\n`);
  }
  for (const r of app.records) out.push(`export type ${r.name} = { ${r.fields.map((f) => `${f.name}: ${tsType(f.type)}`).join("; ")} };\n\n`);
  for (const c of app.choices) {
    out.push(`export type ${c.name} = ${c.values.map(q).join(" | ")};\n`);
    out.push(`export const ${lowerFirst(c.name)}Values: ${c.name}[] = [${c.values.map(q).join(", ")}];\n`);
    out.push(`/** The text users see for a value. */\nexport const ${lowerFirst(c.name)}Labels: Record<${c.name}, string> = { ${c.values.map((v) => `${v}: ${q(c.labels[v])}`).join(", ")} };\n\n`);
  }
  for (const f of app.state)
    if (f.default?.k === "table") {
      const rec = app.records.find((r) => f.type.k === "List" && f.type.of.k === "Named" && r.name === f.type.of.name)!;
      out.push(`/** Initial value of state \`${f.name}\` (the table in the spec). */\nexport const ${f.name}Initial: ${rec.name}[] = [\n${f.default.rows.map((row) => `  { ${rec.fields.map((rf) => `${rf.name}: ${tsLiteral(cellFor(f.default as TableLit, row, rf.name) ?? rf.default ?? { k: "nothing" })}`).join(", ")} },`).join("\n")}\n];\n\n`);
    }
  return out.join("");
}

export function genTsSpec(app: App): string {
  const out: string[] = [];
  out.push(`// Generated from ${app.name}.intent — do not edit. The interface the app module must satisfy.
import type { Node, Wire } from "./ui.ts";
${hasClients(app) ? `import { conforms, type TypeDesc } from "./api.ts";\nimport type { Answer, CallDesc, CallOut } from "./calls.ts";\n` : hasStored(app) ? `import type { TypeDesc } from "./api.ts";\n` : ""}
`);
  out.push(tsDomain(app));
  if (hasData(app)) out.push(tsData(app));
  if (hasStored(app)) out.push(tsStoredFields(app));
  const evs = events(app);
  out.push(`/** Everything the user (or the clock) can do${hasClients(app) ? ", and the answers to calls" : ""}. Row events carry the row's key (the \`key\` you gave that row in \`view\`). Typed events carry the full new text of the field. */\nexport type Msg =\n  | ${[...evs
    .map((e) => `{ tag: ${q(e.tag)}${e.payload === "key" ? "; key: string" : e.payload === "text" ? "; text: string" : e.payload === "pick" ? "; value: string" : e.payload === "value" ? `; value: ${e.choice}` : ""} }`), ...tsAnswerMsgs(app)]
    .join("\n  | ")}${hasScreens(app) ? `\n  | { tag: "ScreenOpened"; route: Route }` : ""};\n\n`);
  out.push(`export type Button = { enabled: boolean };\nexport type LabeledButton = { label: string; enabled: boolean };\n/** A select whose options come from the model: the option texts in order, and the selected one ("" for none). */\nexport type Pick = { options: string[]; selected: string };\n\n`);
  const aliases: string[] = [];
  const fieldType = (el: Element): string => {
    let t: string;
    switch (el.kind) {
      case "text":
      case "field": t = "string"; break;
      case "button": t = el.expr ? "LabeledButton" : "Button"; break;
      case "checkbox": t = "boolean"; break;
      case "progress": t = "number"; break;
      case "select": t = el.from ? "Pick" : selectChoice(app, el); break;
      case "list": t = `${typeName(el.name)}Row[]`; aliases.push(`export type ${typeName(el.name)}Row = { key: string; ${rowFields(el.children)} };\n`); break;
      case "section": t = `${typeName(el.name)}Section`; aliases.push(`export type ${typeName(el.name)}Section = { ${rowFields(el.children)} };\n`); break;
      default: t = "";
    }
    return el.visibleWhen ? `${t} | null` : t;
  };
  const rowFields = (els: Element[]): string => els.filter((e) => e.kind !== "heading").map((e) => `${ident(e.name)}: ${fieldType(e)}`).join("; ");
  if (hasScreens(app)) {
    const scs = app.screens!;
    const param = (p: { name: string; type: Type }) => `${p.name}: ${tsType(p.type)}`;
    out.push(`/** Where the app is: one variant per screen, with its path params. The harness keeps it (the address after \\\`#\\\`). */\nexport type Route =\n${scs.map((s) => `  | { screen: ${q(s.name)}${s.params.map((p) => `; ${param(p)}`).join("")} }`).join("\n")};\n\n`);
    out.push(`/** What \`view\` returns: the current screen, with one field per dynamic element on it. */\nexport type Screen =\n${scs.map((s) => `  | { screen: ${q(s.name)}; ${rowFields(app.screen.filter((e) => e.screen === s.name))} }`).join("\n")};\n\n`);
    // Addresses ↔ routes: the harness's, never the app's. An address that fits no screen is the first screen.
    const re = (path: string) => "^" + path.replace(/[.*+?^$()|[\]\\]/g, "\\$&").replace(/\{[a-z]\w*\}/gi, "([^/]+)") + "$";
    out.push(`/** The route an address shows (\\\`/tickets/3\\\`); an address that fits no screen shows the first. */\nexport function routeFromPath(path: string): Route {\n  let m: RegExpMatchArray | null;\n${scs
      .map((s) => {
        const holes = [...s.path.matchAll(/\{([a-z]\w*)\}/gi)].map((x) => x[1]);
        const vals = holes.map((h, i) => {
          const p = s.params.find((x) => x.name === h)!;
          return p.type.k === "Int" ? `${h}: Number(m[${i + 1}])` : `${h}: decodeURIComponent(m[${i + 1}])`;
        });
        const ints = holes.map((h, i) => (s.params.find((x) => x.name === h)!.type.k === "Int" ? `/^-?\\d+$/.test(m[${i + 1}])` : "")).filter(Boolean);
        return `  if ((m = path.match(new RegExp(${q(re(s.path))})))${ints.length ? ` && ${ints.join(" && ")}` : ""}) return { screen: ${q(s.name)}${vals.map((v) => `, ${v}`).join("")} };\n`;
      })
      .join("")}  return { screen: ${q(scs[0].name)}${scs[0].params.map((p) => `, ${p.name}: ${p.type.k === "Int" ? "0" : '""'}`).join("")} } as Route;\n}\n\n`);
    out.push(`/** The address of a route. */\nexport function pathOf(r: Route): string {\n  switch (r.screen) {\n${scs.map((s) => `    case ${q(s.name)}:\n      return ${"`" + s.path.replace(/\{([a-z]\w*)\}/gi, (_, n) => "${encodeURIComponent(String(r." + n + "))}") + "`"};\n`).join("")}  }\n}\n\n`);
  } else {
    const screen = rowFields(app.screen);
    out.push(`/** What \`view\` returns: one field per dynamic element on the screen. */\nexport type Screen = { ${screen} };\n\n`);
  }
  for (const a of aliases) out.push(a + "\n");

  const items = (els: Element[], acc: string): string[] =>
    els.map((el) => {
      if (el.kind === "heading") return `{ k: "heading", v: ${q(el.label ?? "")} }`;
      const v = `${acc}.${ident(el.name)}`;
      if (el.visibleWhen) return `${v} === null ? null : ${node(el, v)}`;
      return node(el, v);
    });
  const list = (xs: string[]) => `[${xs.join(", ")}].filter((x): x is Node => x !== null)`;
  const node = (el: Element, v: string): string => {
    switch (el.kind) {
      case "text": return `{ k: "text", n: ${q(el.name)}, v: ${v} } as Node`;
      case "field": return `{ k: "field", n: ${q(el.name)}, label: ${q(el.label ?? "")}, v: ${v} } as Node`;
      case "button": return `{ k: "button", n: ${q(el.name)}, label: ${el.expr ? `${v}.label` : q(el.label ?? "")}, enabled: ${v}.enabled } as Node`;
      case "checkbox": return `{ k: "checkbox", n: ${q(el.name)}, label: ${q(el.label ?? "")}, checked: ${v} } as Node`;
      case "progress": return `{ k: "progress", n: ${q(el.name)}, label: ${q(el.label ?? "")}, v: ${v} } as Node`;
      case "select":
        if (el.from) return `{ k: "select", n: ${q(el.name)}, label: ${q(el.label ?? "")}, options: [...${v}.options], v: ${v}.selected } as Node`;
        return `{ k: "select", n: ${q(el.name)}, label: ${q(el.label ?? "")}, options: [...${lowerFirst(selectChoice(app, el))}Values], v: ${v} } as Node`;
      case "list": return `{ k: "list", n: ${q(el.name)}, rows: ${v}.map((r) => ({ key: r.key, c: ${list(items(el.children, "r"))} })) } as Node`;
      case "section": return `{ k: "section", n: ${q(el.name)}, label: ${q(el.label ?? "")}, c: ${list(items(el.children, v))} } as Node`;
      default: return "null";
    }
  };
  if (hasScreens(app))
    out.push(`export function toNode(s: Screen): Node {\n  switch (s.screen) {\n${app.screens!.map((sc) => `    case ${q(sc.name)}:\n      return { k: "screen", title: ${q(app.name)}, c: ${list(items(app.screen.filter((e) => e.screen === sc.name), "s"))} };\n`).join("")}  }\n}\n\n`);
  else out.push(`export function toNode(s: Screen): Node {\n  return { k: "screen", title: ${q(app.name)}, c: ${list(items(app.screen, "s"))} };\n}\n\n`);

  const cases = evs.map((e) => {
    if (e.on === "tick") return "";
    const body =
      e.payload === "key" ? `{ tag: ${q(e.tag)}, key: w.key ?? "" }` : e.payload === "pick" ? `{ tag: ${q(e.tag)}, value: w.value ?? "" }` : e.payload === "text" ? `{ tag: ${q(e.tag)}, text: w.text ?? "" }` : e.payload === "value" ? `(${lowerFirst(e.choice!)}Values as string[]).includes(w.value ?? "") ? { tag: ${q(e.tag)}, value: w.value as ${e.choice} } : null` : `{ tag: ${q(e.tag)} }`;
    return `    case ${q(`${e.on} ${e.target}`)}:\n      return ${body};\n`;
  });
  out.push(`export function fromWire(w: Wire): Msg | null {\n${hasScreens(app) ? `  // The harness shows a screen (an address, a link, going back): \\\`on open\\\`.\n  if (w.on === "navigate") return { tag: "ScreenOpened", route: routeFromPath(w.target) };\n` : ""}  switch (\`\${w.on} \${w.target}\`) {\n${cases.join("")}  }\n${app.clockMs ? `  if (w.on === "tick") return { tag: "Tick" };\n` : ""}${hasClients(app) ? `  if (w.on === "answer" && w.answer) return fromAnswer(w.answer as Answer);\n  if (w.on === "event" && w.event) return fromEvent(w.event as { event: string; body: unknown });\n` : ""}  return null;\n}\n`);
  if (hasClients(app)) out.push(`\n${genTsCalls(app)}`);
  return out.join("");
}

export const TS_APP_SKELETON = `import type { Msg, Screen /* , … */ } from "./spec.ts";
import * as Fmt from "./fmt.ts";

export type Model = { /* … */ };

export function init(): Model { /* … */ }

export function update(msg: Msg, model: Model): Model {
  switch (event.tag) { /* … */ }
}

export function view(model: Model): Screen { /* … */ }
`;

export const TS_APP_SKELETON_CALLS = `import type { Call, Msg, Screen /* , … */ } from "./spec.ts";
import * as Fmt from "./fmt.ts";

export type Model = { /* … */ };

export function init(): { model: Model; calls: Call[] } { /* … */ }

export function update(msg: Msg, model: Model): { model: Model; calls: Call[] } {
  switch (msg.tag) { /* … */ }
}

export function view(model: Model): Screen { /* … */ }
`;

export const TS_APP_SKELETON_THROUGH = `
/** What the client layers need from the state (the params bound under \`through\`). */
export function through(model: Model): Through { /* … */ }
`;

/** Entry points of an app that makes calls: the browser performs them with fetch; tests hand them to the driver. */
function genTsEntriesCalls(app: App): { main: string; test: string } {
  const th = hasThrough(app);
  const c = usesClock(app);
  const st = hasStored(app);
  const configOf = th ? `(App.through(current) as Record<string, Record<string, unknown>>)[alias]` : "undefined";
  const main = `import * as App from "./app.ts";
import { callEndpoints, callToJson, eventsByAlias, fromWire, toNode, type Call${st ? ", storedFields, type Stored" : ""} } from "./spec.ts";
import { mount, STYLE, type Wire } from "./ui.ts";
import { fetchCall, listen, newKey, type Outgoing } from "./calls.ts";
import { apply } from "./through.ts";
${c ? `import { localClock } from "./clock.ts";\n` : ""}${st ? `import { load, save } from "./store.ts";\n\n// Stored state lives in this browser (localStorage), under the app's name.\nconst KEY = ${q(`intent:${app.name}`)};\n` : ""}
const style = document.createElement("style");
style.textContent = STYLE;
document.head.append(style);
let dispatch: (w: Wire) => void = () => {};
let current: App.Model;
// Every call and event stream goes through its api's client layer, with the config from the current state.
const via = (alias: string, req: Outgoing) => apply(alias, req, ${configOf});
const perform = (calls: Call[]) => {
  // Each call gets its idempotency key now, when it is made: every attempt sends the same one.
  for (const c of calls) fetchCall(callEndpoints, { ...callToJson(c), key: newKey() }, via).then((a) => dispatch({ on: "answer", target: a.endpoint, answer: a }));
};
let stream: { refresh: () => void } | undefined;
dispatch = mount(document.getElementById("app")!, {
  init: () => {
    const r = App.init(${c ? "localClock()" : ""});
${st ? "    const saved = load(KEY, storedFields);\n    if (saved) r.model = App.restore(saved as Stored, r.model);\n" : ""}    current = r.model;
    perform(r.calls);
    return r.model;
  },
  step: (w, m) => {
    const e = fromWire(w);
    if (!e) return m;
    const r = App.update(e, m${c ? ", localClock()" : ""});
${st ? "    save(KEY, App.data(r.model), storedFields);\n" : ""}    current = r.model;
    perform(r.calls);
    stream?.refresh();
    return r.model;
  },
  render: (m) => toNode(App.view(m${c ? ", localClock()" : ""})),
  clockMs: ${app.clockMs ?? 0},
});
// Events from each api (Server-Sent Events at /events), for the events this app handles.
stream = listen(eventsByAlias, (e) => dispatch({ on: "event", target: e.event, event: e }), via);${c ? `\n// The screen reads the clock: show it again as time passes.\nsetInterval(() => dispatch({ on: "noop", target: "" }), 15000);` : ""}
`;
  const test = `import * as App from "./app.ts";
import { callToJson, fromWire, toNode, type Call } from "./spec.ts";
import type { CallOut } from "./calls.ts";
import type { Wire } from "./ui.ts";
${c ? `import type { Clock } from "./clock.ts";\n` : ""}
/** A call as data, with the config its client layer gets from the state after the step that made it. */
const out = (c: Call, current: App.Model): CallOut => {
  const j = callToJson(c);
  const alias = j.endpoint.split(".")[0];
  return { ...j, config: ${configOf} } as CallOut;
};

export function start(${c ? "initial: Clock" : ""}) {
${c ? "  let clock = initial;\n" : ""}  const first = App.init(${c ? "clock" : ""});
  let m = first.model;
  let pending: CallOut[] = first.calls.map((c) => out(c, m));
  return {
    observe: () => JSON.parse(JSON.stringify(toNode(App.view(m${c ? ", clock" : ""})))),
${hasData(app) ? "    /** The app's data, for the checks in `always` and to keep what is stored. */\n    data: () => JSON.parse(JSON.stringify(App.data(m))),\n" : ""}    /** What the client layers get from the current state, per api. */
    through: () => ${hasThrough(app) ? "JSON.parse(JSON.stringify(App.through(m)))" : "({})"},
    /** The calls made since the last time this was asked, in order. */
    calls() {
      const made = pending;
      pending = [];
      return JSON.parse(JSON.stringify(made));
    },
    send(w: Wire) {
${c ? "      if (w.clock) clock = w.clock as Clock;\n" : ""}${st ? `      // The app starts again with what the driver saved (the stored fields of its data); its first calls go out again.
      if (w.on === "restart") {
        const again = App.init(${c ? "clock" : ""});
        m = App.restore(JSON.parse(JSON.stringify((w as { saved?: unknown }).saved)), again.model);
        pending.push(...again.calls.map((c) => out(c, m)));
        return;
      }
` : ""}      const e = fromWire(w);
      if (!e) return;
      const r = App.update(e, m${c ? ", clock" : ""});
      m = r.model;
      pending.push(...r.calls.map((c) => out(c, m)));
    },
  };
}
`;
  return { main, test };
}

/** The entries; for an app with several screens, with the hooks that keep the address and the screen together. */
export function genTsEntries(app: App): { main: string; test: string } {
  const e = genTsEntriesFor(app);
  if (!hasScreens(app)) return e;
  const one = (text: string, from: string, to: string) => {
    if (text.split(from).length !== 2) throw new Error(`screens: the entry has no single \`${from}\``);
    return text.replace(from, to);
  };
  let main = one(e.main, 'import * as App from "./app.ts";', 'import * as App from "./app-nav.ts";');
  main = main.includes("let dispatch: (w: Wire) => void") ? main : one(main, "mount(document.getElementById", "const dispatch = mount(document.getElementById").replace("const dispatch = const dispatch = ", "const dispatch = ");
  main = one(main, "  render: (m) => ", "  render: (m) => show(m) && ");
  main += `
// Screens: the address after # is where the app is. A new address (a link, typing it, the back
// button) shows that screen; an app that says \\\`go to\\\` or \\\`go back\\\` changes the address.
let shown: object | undefined;
function show(m: App.Model): true {
  if (m.go && m !== shown) {
    shown = m;
    if (m.go === "back") history.back();
    else location.hash = m.go;
  }
  return true;
}
const address = () => decodeURI(location.hash.slice(1)) || "/";
window.addEventListener("hashchange", () => dispatch({ on: "navigate", target: address() }));
dispatch({ on: "navigate", target: address() });
`;
  let test = one(e.test, 'import * as App from "./app.ts";', 'import * as App from "./app-nav.ts";');
  test = one(test, "    send(w: Wire) {", "    /** The address the app asked for since last asked (\\\`go to\\\`), \\\"back\\\", or null: the driver keeps the history. */\n    nav() {\n      const g = m.go ?? null;\n      m = App.settled(m);\n      return g;\n    },\n    send(w: Wire) {");
  return { main, test };
}

function genTsEntriesFor(app: App): { main: string; test: string } {
  if (hasClients(app)) return genTsEntriesCalls(app);
  const c = usesClock(app);
  const st = hasStored(app);
  const main = `import * as App from "./app.ts";
import { fromWire, toNode${st ? ", storedFields, type Stored" : ""} } from "./spec.ts";
import { mount, STYLE } from "./ui.ts";
${c ? `import { localClock } from "./clock.ts";\n` : ""}${st ? `import { load, save } from "./store.ts";\n\n// Stored state lives in this browser (localStorage), under the app's name.\nconst KEY = ${q(`intent:${app.name}`)};\n` : ""}
const style = document.createElement("style");
style.textContent = STYLE;
document.head.append(style);
${c ? "const dispatch = " : ""}mount(document.getElementById("app")!, {
  init: () => ${st ? `{
    const m = App.init(${c ? "localClock()" : ""});
    const saved = load(KEY, storedFields);
    return saved ? App.restore(saved as Stored, m) : m;
  }` : `App.init(${c ? "localClock()" : ""})`},
  step: (w, m) => {
    const e = fromWire(w);
    ${st ? `const next = e ? App.update(e, m${c ? ", localClock()" : ""}) : m;
    save(KEY, App.data(next), storedFields);
    return next;` : `return e ? App.update(e, m${c ? ", localClock()" : ""}) : m;`}
  },
  render: (m) => toNode(App.view(m${c ? ", localClock()" : ""})),
  clockMs: ${app.clockMs ?? 0},
});${c ? `\n// The screen reads the clock: show it again as time passes.\nsetInterval(() => dispatch({ on: "noop", target: "" }), 15000);` : ""}
`;
  const test = `import * as App from "./app.ts";
import { fromWire, toNode } from "./spec.ts";
import type { Wire } from "./ui.ts";
${c ? `import type { Clock } from "./clock.ts";\n` : ""}
/** The app under test. ${c ? "The driver owns the clock: it comes with every wire event." : ""} */
export function start(${c ? "initial: Clock" : ""}) {
${c ? "  let clock = initial;\n" : ""}  let m = App.init(${c ? "clock" : ""});
  return {
    observe: () => JSON.parse(JSON.stringify(toNode(App.view(m${c ? ", clock" : ""})))),
${hasData(app) ? "    /** The app's data, for the checks in `always` and to keep what is stored. */\n    data: () => JSON.parse(JSON.stringify(App.data(m))),\n" : ""}    send(w: Wire) {
${c ? "      if (w.clock) clock = w.clock as Clock;\n" : ""}${st ? `      // The app starts again with what the driver saved (the stored fields of its data).
      if (w.on === "restart") {
        m = App.restore(JSON.parse(JSON.stringify((w as { saved?: unknown }).saved)), App.init(${c ? "clock" : ""}));
        return;
      }
` : ""}      const e = fromWire(w);
      if (e) m = App.update(e, m${c ? ", clock" : ""});
    },
  };
}
`;
  return { main, test };
}

// ---------------------------------------------------------------- scaffold a build directory

// ---------------------------------------------------------------- TypeScript

export function genTsCalls(app: App): string {
  const eps = clientEndpoints(app);
  const out: string[] = [];
  out.push(`/** A request to an API, made by returning it from init or update. It is answered later by an \`…Answered\` message. */\nexport type Call =\n${eps.map((c) => `  | { call: ${q(c.name)}${c.ep.params.length ? `; args: { ${c.ep.params.map((p) => `${p.name}: ${tsType(p.type)}`).join("; ")} }` : ""} }`).join("\n")};\n\n`);
  for (const c of eps) {
    const variants = (c.ep.answers ?? []).map((a) => `{ status: ${a.status}; body: ${a.type ? tsType(a.type) : "null"} }`);
    const unknown = c.ep.effect ? [`{ status: "unknown"; error: string }`] : [];
    out.push(`/** What ${c.ep.method} ${c.ep.path} answers, per status (the contract). Status 0: no answer the contract allows (network down, or a body of the wrong shape).${c.ep.effect ? ' "unknown": still no answer after the last attempt, so it may or may not have happened (effect external): do not offer to do it again as if it failed.' : ""} */\nexport type ${c.tag}Answer = ${[...variants, "{ status: 0; error: string }", ...unknown].join(" | ")};\n`);
  }
  out.push(`\n/** Endpoints as data, for sending calls. */\nexport const callEndpoints: CallDesc[] = ${JSON.stringify(callDescs(app))};\n\n`);
  out.push(`/** The contract's answers per endpoint (status → body type): an answer that does not fit arrives as status 0. */\nexport const callAnswers: Record<string, Record<number, TypeDesc | null>> = {\n${eps.map((c) => `  ${q(c.name)}: { ${(c.ep.answers ?? []).map((a) => `${a.status}: ${a.type ? typeDesc(app, a.type) : "null"}`).join(", ")} },`).join("\n")}\n};\n\n`);
  const th = throughs(app);
  if (th.length) out.push(`/** What the client layers need from the app's state, per api (through, under uses): through(model) in the app module computes it. */\nexport type Through = { ${th.map((t) => `${t.alias}: { ${t.state.map((x) => `${x.param}: ${tsType(x.type)} /* state ${x.field} */`).join("; ")} }`).join("; ")} };\n\n`);
  out.push(`export function callToJson(c: Call): CallOut {\n  return { endpoint: c.call, args: ("args" in c ? c.args : {}) as Record<string, unknown> };\n}\n\n`);
  out.push(`const ANSWERED: Record<string, string> = { ${eps.map((c) => `${q(c.name)}: ${q(c.tag + "Answered")}`).join(", ")} };\n\n`);
  const evs = clientEvents(app);
  out.push(`/** The events this app handles, and their payload types: an event whose payload does not fit is dropped. */\nconst EVENTS: Record<string, { tag: string; type: TypeDesc }> = { ${evs.map((e) => `${q(e.name)}: { tag: ${q(e.tag)}, type: ${typeDesc(app, e.type)} }`).join(", ")} };\n\n`);
  out.push(`/** Per alias, the events of its api this app handles. */\nexport const eventsByAlias: Record<string, string[]> = ${JSON.stringify(eventsByAlias(app))};\n\n`);
  out.push(`export function fromEvent(e: { event: string; body: unknown }): Msg | null {\n  const d = EVENTS[e.event];\n  if (!d || conforms({ 200: d.type }, { status: 200, body: e.body })) return null;\n  return { tag: d.tag, body: e.body } as Msg;\n}\n\n`);
  out.push(`export function fromAnswer(a: Answer): Msg | null {\n  const tag = ANSWERED[a.endpoint];\n  if (!tag) return null;\n  if (a.unknown && callEndpoints.some((e) => e.name === a.endpoint && e.external)) return { tag, answer: { status: "unknown", error: a.error ?? "no answer" } } as Msg;\n  if (a.status === 0 || a.error !== undefined) return { tag, answer: { status: 0, error: a.error ?? "no answer" } } as Msg;\n  const body = a.body === undefined ? null : a.body;\n  const problem = conforms(callAnswers[a.endpoint], { status: a.status, body });\n  return { tag, answer: problem ? { status: 0, error: \`\${a.endpoint} \${problem}\` } : { status: a.status, body } } as Msg;\n}\n`);
  return out.join("");
}

export const tsAnswerMsgs = (app: App) => [
  ...clientEndpoints(app).map((c) => `{ tag: ${q(c.tag + "Answered")}; answer: ${c.tag}Answer }`),
  ...clientEvents(app).map((e) => `{ tag: ${q(e.tag)}; body: ${tsType(e.type)} }`),
];

/**
 * Apps with several screens: the module the entries use instead of app.ts. The harness keeps where
 * the app is (the route) and turns the app's \`go\` into an address; the app itself only says where to go.
 */
export function genTsNav(app: App): string {
  const calls = hasClients(app);
  const c = usesClock(app);
  const clk = c ? ", clock" : "";
  const clkParam = c ? ", clock: Clock" : "";
  return `// Generated from ${app.name}.intent — do not edit. The screens around the app module: the route is
// the harness's (the address after #); the app says where to go (\\\`go\\\`), the harness goes there.
import * as Inner from "./app.ts";
import { pathOf, routeFromPath, type Msg, type Route${calls ? ", type Call" : ""}${c ? ", type Clock" : ""} } from "./spec.ts";

/** The app's model, where it is, and the address to show next (after \\\`go to\\\` or \\\`go back\\\`). */
export type Model = { inner: Inner.Model; route: Route; go?: string };

const start = routeFromPath("/");

export function init(${c ? "clock: Clock" : ""})${calls ? ": { model: Model; calls: Call[] }" : ": Model"} {
  const r = Inner.init(${c ? "clock" : ""});
  return ${calls ? "{ model: { inner: r.model, route: start }, calls: r.calls }" : "{ inner: r, route: start }"};
}

export function update(msg: Msg, m: Model${clkParam})${calls ? ": { model: Model; calls: Call[] }" : ": Model"} {
  const route = msg.tag === "ScreenOpened" ? msg.route : m.route;
  const r = Inner.update(msg, m.inner, route${clk});
  const go = r.go === undefined ? undefined : r.go === "back" ? "back" : pathOf(r.go);
  return ${calls ? "{ model: { inner: r.model, route, go }, calls: r.calls }" : "{ inner: r.model, route, go }"};
}

export function view(m: Model${clkParam}) {
  return Inner.view(m.inner, m.route${clk});
}

/** The model with its next address taken (the entry shows it). */
export const settled = (m: Model): Model => ({ ...m, go: undefined });
${hasData(app) ? "\nexport const data = (m: Model) => Inner.data(m.inner);\n" : ""}${hasStored(app) ? "export const restore = (saved: Parameters<typeof Inner.restore>[0], m: Model): Model => ({ ...m, inner: Inner.restore(saved, m.inner) });\n" : ""}${hasThrough(app) ? "export const through = (m: Model) => Inner.through(m.inner);\n" : ""}`;
}

/** The build directory of a TypeScript app: the runtime, the generated interface and the entries. */
export function scaffoldTs(app: App, dir: string, layerDirs: Record<string, string> = {}): { appFile: string; specSource: string } {
  mkdirSync(dir, { recursive: true });
  copyFileSync(join(ROOT, "runtime/ts/ui.ts"), join(dir, "ui.ts"));
  copyFileSync(join(ROOT, "runtime/ts/fmt.ts"), join(dir, "fmt.ts"));
  if (usesClock(app)) copyFileSync(join(ROOT, "runtime/ts/clock.ts"), join(dir, "clock.ts"));
  if (hasStored(app)) for (const f of ["store.ts", "api.ts"]) copyFileSync(join(ROOT, "runtime/ts", f), join(dir, f));
  if (hasClients(app)) {
    copyFileSync(join(ROOT, "runtime/ts/api.ts"), join(dir, "api.ts"));
    copyFileSync(join(ROOT, "runtime/ts/calls.ts"), join(dir, "calls.ts"));
    writeThrough(app, dir, layerDirs);
  }
  const spec = genTsSpec(app);
  writeFileSync(join(dir, "spec.ts"), spec);
  if (hasScreens(app)) writeFileSync(join(dir, "app-nav.ts"), genTsNav(app));
  const { main, test } = genTsEntries(app);
  writeFileSync(join(dir, "main.ts"), main);
  writeFileSync(join(dir, "test-entry.ts"), test);
  writeFileSync(
    join(dir, "tsconfig.json"),
    JSON.stringify({ compilerOptions: { strict: true, noEmit: true, target: "es2022", module: "esnext", moduleResolution: "bundler", allowImportingTsExtensions: true, lib: ["es2022", "dom", "dom.iterable"], skipLibCheck: true, noUnusedLocals: false }, include: ["*.ts", "layers/*/*.ts"] }, null, 2),
  );
  writeFileSync(join(dir, "index.html"), html(app.name, `<script src="main.js"></script>`, false));
  return { appFile: join(dir, "app.ts"), specSource: spec };
}

// ---------------------------------------------------------------- the target module

async function compileTs(dir: string): Promise<string> {
  const t = await run(bin("tsc"), ["-p", "."], dir);
  if (!t.ok) return clean(t.out);
  const b1 = await run(bin("esbuild"), ["main.ts", "--bundle", "--format=iife", "--outfile=main.js", "--log-level=error"], dir);
  if (!b1.ok) return clean(b1.out);
  const b2 = await run(bin("esbuild"), ["test-entry.ts", "--bundle", "--format=esm", "--platform=node", "--outfile=test.mjs", "--log-level=error"], dir);
  if (!b2.ok) return clean(b2.out);
  if (existsSync(join(dir, "through.ts"))) {
    // The client layers, for the test driver.
    const t = await run(bin("esbuild"), ["through.ts", "--bundle", "--format=esm", "--platform=node", "--outfile=through.mjs", "--log-level=error"], dir);
    if (!t.ok) return clean(t.out);
  }
  return "";
}

async function compileStyledTs(dir: string): Promise<string> {
  const t = await run(bin("tsc"), ["-p", "."], dir);
  if (!t.ok) return clean(t.out);
  const b = await run(bin("esbuild"), ["main.tsx", "--bundle", "--format=iife", "--outfile=main.js", "--log-level=error"], dir);
  return b.ok ? "" : clean(b.out);
}

async function openTs(dir: string, clock?: { now: string; today: string }): Promise<Session> {
  const mod = await import(pathToFileURL(join(dir, "test.mjs")).href + `?t=${Date.now()}`);
  const s = mod.start(clock);
  return { observe: async () => s.observe(), send: async (w) => s.send(w), calls: async () => (s.calls ? s.calls() : []), through: async () => (s.through ? s.through() : {}), data: async () => (s.data ? s.data() : undefined), nav: async () => (s.nav ? s.nav() : null) };
}

export const tsTarget: TargetModule = {
  name: "ts",
  appFile: "app.ts",
  specFile: "spec.ts",
  fence: "ts",
  scaffold: scaffoldTs,
  compile: compileTs,
  compileStyled: compileStyledTs,
  prompt: {
    rules: `Target: TypeScript (strict mode). You write \`app.ts\`.
- Available: the standard library, the generated \`./spec.ts\` module, and \`./fmt.ts\`. No other imports, no DOM, no timers, no randomness, no Date.
- Import with explicit extensions: \`import type { … } from "./spec.ts"\`, \`import * as Fmt from "./fmt.ts"\`.
- Model must be treated as immutable: return new objects from update.
- The module must export exactly Model, init, update, view with these signatures:`,
    fmt: `Fmt.fixed(places: number, x: number): string   // exactly n decimals, half away from zero: fixed(2, 1.005) === "1.01"
Fmt.decimal(places: number, x: number): string // at most n decimals, trailing zeros removed: decimal(8, 0.1 + 0.2) === "0.3"
Fmt.money(x: number): string                    // fixed(2, x)
Fmt.int(n: number): string                      // plain digits
Fmt.clock(totalSeconds: number): string         // "m:ss" (or "h:mm:ss"): clock(1500) === "25:00"
Fmt.parseDecimal(text: string): number | null   // "-?digits([.,]digits)?", spaces trimmed
Fmt.parseInt(text: string): number | null
Fmt.roundTo(places: number, x: number): number      // round to n decimals, half away from zero
Fmt.roundUpTo(places: number, x: number): number    // round up (towards +infinity) to n decimals
Fmt.roundDownTo(places: number, x: number): number  // round down (towards -infinity) to n decimals
Fmt.cents(x: number): number                        // whole cents, half away from zero: cents(12.345) === 1235
// Dates ("YYYY-MM-DD") and moments ("YYYY-MM-DDTHH:MM") are strings; compare and sort them as text.
Fmt.addDays(date, n): Date                    // addDays("2026-02-27", 2) === "2026-03-01"
Fmt.daysBetween(from, to): number             // daysBetween("2026-09-24", "2026-10-01") === 7
Fmt.weekday(date): string                     // weekday("2026-09-24") === "Thursday"
Fmt.dateOf(dateTime): Date                    // dateOf("2026-09-24T09:30") === "2026-09-24"
Fmt.timeOf(dateTime): string                  // timeOf("2026-09-24T09:30") === "09:30"
Fmt.addMinutes(dateTime, n): DateTime         // addMinutes("2026-09-24T23:50", 15) === "2026-09-25T00:05"
Fmt.minutesBetween(from, to): number
Fmt.formatDate(date): string                  // formatDate("2026-09-04") === "4 Sep 2026"
Fmt.formatDateTime(dateTime): string          // formatDateTime("2026-09-04T09:05") === "4 Sep 2026 09:05"
Fmt.parseDate(text): Date | null              // only a date that exists
Fmt.parseDateTime(text): DateTime | null      // "YYYY-MM-DD HH:MM" or "YYYY-MM-DDTHH:MM"`,
    skeleton: (calls, through) => (calls ? TS_APP_SKELETON_CALLS.replace("import type { Call, Msg, Screen", through ? "import type { Call, Msg, Screen, Through" : "import type { Call, Msg, Screen") + (through ? TS_APP_SKELETON_THROUGH : "") : TS_APP_SKELETON),
    calls: `Calls (this app uses an API):
- \`init\` and \`update\` return \`{ model, calls }\`: the calls to make, in the order the steps say, as \`{ call: "tickets.createTicket", args: { subject, customer, priority } }\`. No step says "call": \`calls: []\`.
- \`on start\`: the calls \`init\` returns. \`on answer tickets.createTicket\`: the message \`{ tag: "TicketsCreateTicketAnswered", answer }\`; \`answer\` is one of the statuses the contract declares (\`{ status: 201, body: Ticket }\`, \`{ status: 400, body: Problem }\`) or \`{ status: 0, error }\` (no valid answer).
- "if its status is 201" is \`answer.status === 201\`; "its body" is \`answer.body\`. "otherwise" covers every other status, 0 included.
- Every argument of a call is given; an absent optional one is \`null\`.`,
    through: "- Export `through(model: Model): Through` too: for each api with a client layer, the params bound to state under `through` in the spec, read from the model. The harness adds the config to every call and to the api's event stream.",
    clock: `Clock (this app reads @now or @today): \`init(clock)\`, \`update(msg, model, clock)\` and \`view(model, clock)\` take the clock (type \`Clock\` from spec.ts) as their LAST argument. \`@now\` is \`clock.now\` (a DateTime), \`@today\` is \`clock.today\` (a Date). Compute with the Fmt date helpers; never store the clock in the model unless the spec says to remember a moment.`,
    data: "Data (this spec has sentences in `always`): also export `data(model: Model): Data` (the `Data` type in spec.ts: every state field, with the value the model holds now). The harness checks the `always` sentences on it after every step; keep it exact, never computed differently from the model.",
    screens: "Screens (this spec has several): `update(msg, model, route)` and `view(model, route)` get where the app is (`Route` in spec.ts: `route.screen` names the screen, its path params are fields, so `@id` is `route.id`); `view` returns that screen's variant of `Screen` (`{ screen: \"ticket\", … }`). `update` returns `{ model, go }` (with calls: `{ model, calls, go }`): `go` is the route of a `go to` step (`{ screen: \"ticket\", id: … }`), `\"back\"` for `go back`, or left out. When a screen is shown (a link, an address, going back), the harness sends `{ tag: \"ScreenOpened\", route }`: do what `on open <that screen>` says, and nothing for a screen without one. The route is the harness's: never keep a copy in the model. With a clock, it comes last: `view(model, route, clock)`, `update(msg, model, route, clock)`.",
    stored: "Stored state (this spec has `stored` fields): also export `data(model: Model): Data` and `restore(saved: Stored, model: Model): Model`. `restore(saved, model)` gets a freshly started model and puts the saved values of the stored fields into it; everything else stays as it starts. Anything the model keeps that depends on stored fields (a next id, a cache) must be brought in line with the restored values. The harness saves `data` after every update and restores it when the app starts again.",
  },
  open: openTs,
};
