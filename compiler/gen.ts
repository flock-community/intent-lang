// Deterministic code generation: everything except the app logic.
// For each target it writes the typed interface (Spec), the runtime, and the entry points.
import { copyFileSync, existsSync, mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import type { App, Element, Literal, Type } from "./ast.ts";
import { STYLE } from "../runtime/ts/ui.ts";
import { callDescs, elmAnswerMsgs, genElmCalls, genTsCalls, hasClients, tsAnswerMsgs } from "./calls.ts";

export type Target = "elm" | "ts";
export const ROOT = join(dirname(fileURLToPath(import.meta.url)), ".."); // the Intent installation

/**
 * The user's project: the nearest folder (from where the command runs) with an intent.project or
 * intent.lock. Its lib/, intent.lock, intent.project and .intent/ belong to the project; the
 * language reference and runtimes come from the Intent installation (ROOT).
 */
export const PROJECT_ROOT = (() => {
  for (let d = process.cwd(); ; d = dirname(d)) {
    if (existsSync(join(d, "intent.project")) || existsSync(join(d, "intent.lock"))) return d;
    if (dirname(d) === d) return ROOT;
  }
})();

const cap = (s: string) => s[0].toUpperCase() + s.slice(1);
// Names of component instances are qualified (`pager.next`): a record field uses the last part,
// a type or event tag joins all parts (`PagerNext`).
const ident = (name: string) => name.slice(name.lastIndexOf(".") + 1);
const typeName = (name: string) => name.split(".").map(cap).join("");
const lowerFirst = (s: string) => s[0].toLowerCase() + s.slice(1);
const q = (s: string) => JSON.stringify(s);

interface EventDef {
  tag: string;
  on: "click" | "toggle" | "input" | "choose" | "tick";
  target: string; // wire target, "list.name" inside rows
  payload?: "key" | "text" | "value" | "pick";
  choice?: string;
}

export function events(app: App): EventDef[] {
  const out: EventDef[] = [];
  const stateType = (n: string) => app.state.find((f) => f.name === n)?.type;
  const walk = (els: Element[], list?: Element) => {
    for (const el of els) {
      if (el.kind === "heading") continue;
      const prefix = list ? typeName(list.name) + typeName(el.name) : typeName(el.name);
      const target = list ? `${list.name}.${el.name}` : el.name;
      if (el.kind === "button") out.push({ tag: prefix + "Clicked", on: "click", target, payload: list ? "key" : undefined });
      if (el.kind === "checkbox") out.push({ tag: prefix + "Toggled", on: "toggle", target, payload: list ? "key" : undefined });
      if (el.kind === "field") out.push({ tag: prefix + "Typed", on: "input", target, payload: "text" });
      if (el.kind === "select" && el.from) out.push({ tag: prefix + "Chosen", on: "choose", target, payload: "pick" });
      else if (el.kind === "select") {
        const t = stateType(el.name);
        out.push({ tag: prefix + "Chosen", on: "choose", target, payload: "value", choice: t?.k === "Named" ? t.name : "" });
      }
      if (el.kind === "list") walk(el.children, el);
      if (el.kind === "section") walk(el.children, list);
    }
  };
  walk(app.screen);
  if (app.clockMs) out.push({ tag: "Tick", on: "tick", target: "" });
  return out;
}

function selectChoice(app: App, el: Element): string {
  const t = app.state.find((f) => f.name === el.name)!.type;
  return (t as { name: string }).name;
}

type TableLit = Extract<Literal, { k: "table" }>;
const cellFor = (t: TableLit, row: Literal[], col: string): Literal | undefined => row[t.columns.indexOf(col)];

function elmLiteral(l: Literal, t: Type): string {
  if (t.k === "Maybe") return l.k === "nothing" ? "Nothing" : `Just ${elmLiteral(l, t.of)}`;
  switch (l.k) {
    case "text": return q(l.v);
    case "number": return t.k === "Decimal" && !l.raw.includes(".") ? `${l.raw}.0` : l.raw.startsWith("-") ? `(${l.raw})` : l.raw;
    case "bool": return l.v ? "True" : "False";
    case "emptyList": return "[]";
    case "nothing": return "Nothing";
    case "value": return l.v;
    case "table": return "[]";
  }
}

function tsLiteral(l: Literal): string {
  switch (l.k) {
    case "text": return q(l.v);
    case "number": return l.raw;
    case "bool": return String(l.v);
    case "emptyList": return "[]";
    case "nothing": return "null";
    case "value": return q(l.v);
    case "table": return "[]";
  }
}

// ---------------------------------------------------------------- Elm

export function elmType(t: Type): string {
  switch (t.k) {
    case "Text": return "String";
    case "Int": return "Int";
    case "Decimal": return "Float";
    case "Bool": return "Bool";
    case "List": return `List ${elmAtom(t.of)}`;
    case "Maybe": return `Maybe ${elmAtom(t.of)}`;
    case "Named": return t.name;
  }
}
export const elmAtom = (t: Type) => (t.k === "List" || t.k === "Maybe" ? `(${elmType(t)})` : elmType(t));

function elmRecord(name: string, fields: [string, string][]): string {
  if (!fields.length) return `type alias ${name} =\n    {}\n`;
  return `type alias ${name} =\n    { ${fields.map(([n, t]) => `${n} : ${t}`).join("\n    , ")}\n    }\n`;
}

export function genElmSpec(app: App): string {
  const out: string[] = [];
  out.push(`module Spec exposing (..)

{-| Generated from ${app.name}.intent — do not edit. The interface the app module must satisfy.
-}

${hasClients(app) ? "import Json.Decode as D\nimport Json.Encode as J\n" : ""}import Ui
${(app.refined ?? []).some((r) => r.pattern !== undefined) ? "import Regex\n" : ""}
`);
  for (const r of app.refined ?? []) {
    // A refined type is its base type plus a generated check: `isEmail : String -> Bool`.
    const lc = lowerFirst(r.name);
    const base = r.base === "Text" ? "String" : r.base === "Int" ? "Int" : "Float";
    out.push(`type alias ${r.name} =\n    ${base}\n\n`);
    if (r.pattern !== undefined)
      out.push(`${lc}Pattern : Regex.Regex\n${lc}Pattern =\n    Maybe.withDefault Regex.never (Regex.fromString ${q(`^(?:${r.pattern})$`)})\n\n\n{-| Whether a text is a valid ${r.name}. -}\nis${r.name} : String -> Bool\nis${r.name} s =\n    Regex.contains ${lc}Pattern s\n\n`);
    else {
      const conds = [r.min !== undefined ? `n >= ${r.min}` : "", r.max !== undefined ? `n <= ${r.max}` : ""].filter(Boolean).join(" && ");
      out.push(`{-| Whether a number is a valid ${r.name}. -}\nis${r.name} : ${base} -> Bool\nis${r.name} n =\n    ${conds || "True"}\n\n`);
    }
  }
  for (const r of app.records) out.push(elmRecord(r.name, r.fields.map((f) => [f.name, elmType(f.type)])) + "\n");
  for (const c of app.choices) {
    const lc = lowerFirst(c.name);
    out.push(`type ${c.name}\n    = ${c.values.join("\n    | ")}\n\n`);
    out.push(`${lc}Values : List ${c.name}\n${lc}Values =\n    [ ${c.values.join(", ")} ]\n\n`);
    out.push(`${lc}ToString : ${c.name} -> String\n${lc}ToString v =\n    case v of\n${c.values.map((v) => `        ${v} ->\n            ${q(v)}\n`).join("\n")}\n`);
    out.push(`{-| The text users see for a value. -}\n${lc}Label : ${c.name} -> String\n${lc}Label v =\n    case v of\n${c.values.map((v) => `        ${v} ->\n            ${q(c.labels[v])}\n`).join("\n")}\n`);
    out.push(`${lc}FromString : String -> Maybe ${c.name}\n${lc}FromString s =\n    case s of\n${c.values.map((v) => `        ${q(v)} ->\n            Just ${v}\n`).join("\n")}\n        _ ->\n            Nothing\n\n`);
  }

  for (const f of app.state)
    if (f.default?.k === "table") {
      const rec = app.records.find((r) => f.type.k === "List" && f.type.of.k === "Named" && r.name === f.type.of.name)!;
      out.push(`{-| Initial value of state \`${f.name}\` (the table in the spec). -}\n${f.name}Initial : List ${rec.name}\n${f.name}Initial =\n    [ ${f.default.rows.map((row) => `{ ${rec.fields.map((rf) => `${rf.name} = ${elmLiteral(cellFor(f.default as TableLit, row, rf.name) ?? rf.default ?? { k: "nothing" }, rf.type)}`).join(", ")} }`).join("\n    , ")}\n    ]\n\n`);
    }

  // Events
  const evs = events(app);
  out.push(`{-| Everything the user (or the clock) can do${hasClients(app) ? ", and the answers to calls" : ""}. -}\ntype Msg\n    = ${[...evs
    .map((e) => e.tag + (e.payload === "key" || e.payload === "text" || e.payload === "pick" ? " String" : e.payload === "value" ? ` ${e.choice}` : "")), ...elmAnswerMsgs(app)]
    .join("\n    | ")}\n\n`);
  out.push(`{-| Row events carry the row's key (the \`key\` you gave that row in \`view\`). Typed events carry the full new text of the field. -}\n\n`);

  // Screen types
  out.push(`type alias Button =\n    { enabled : Bool }\n\n`);
  out.push(`type alias LabeledButton =\n    { label : String, enabled : Bool }\n\n`);
  out.push(`{-| A select whose options come from the model: the option texts in order, and the selected one ("" for none). -}\ntype alias Pick =\n    { options : List String, selected : String }\n\n`);
  const aliases: string[] = [];
  const fieldType = (el: Element): string => {
    let t: string;
    switch (el.kind) {
      case "text":
      case "field": t = "String"; break;
      case "button": t = el.expr ? "LabeledButton" : "Button"; break;
      case "checkbox": t = "Bool"; break;
      case "progress": t = "Int"; break;
      case "select": t = el.from ? "Pick" : selectChoice(app, el); break;
      case "list": t = `List ${typeName(el.name)}Row`; aliases.push(elmRecord(`${typeName(el.name)}Row`, [["key", "String"], ...rowFields(el.children)])); break;
      case "section": t = `${typeName(el.name)}Section`; aliases.push(elmRecord(`${typeName(el.name)}Section`, rowFields(el.children))); break;
      default: t = "";
    }
    return el.visibleWhen ? `Maybe ${t.includes(" ") ? `(${t})` : t}` : t;
  };
  const rowFields = (els: Element[]): [string, string][] => els.filter((e) => e.kind !== "heading").map((e) => [ident(e.name), fieldType(e)]);
  const screenFields = rowFields(app.screen);
  out.push(`{-| What \`view\` returns: one field per dynamic element on the screen. -}\n` + elmRecord("Screen", screenFields) + "\n");
  for (const a of aliases) out.push(a + "\n");

  // toNode
  const items = (els: Element[], acc: string, d: number): string[] =>
    els.map((el) => {
      if (el.kind === "heading") return `Just (Ui.NHeading ${q(el.label ?? "")})`;
      const v = `${acc}.${ident(el.name)}`;
      if (el.visibleWhen) return `Maybe.map (\\v${d} -> ${node(el, `v${d}`, d + 1)}) ${v}`;
      return `Just (${node(el, v, d + 1)})`;
    });
  const node = (el: Element, v: string, d: number): string => {
    switch (el.kind) {
      case "text": return `Ui.NText ${q(el.name)} ${v}`;
      case "field": return `Ui.NField ${q(el.name)} ${q(el.label ?? "")} ${v}`;
      case "button": return `Ui.NButton ${q(el.name)} ${el.expr ? `${v}.label` : q(el.label ?? "")} ${v}.enabled`;
      case "checkbox": return `Ui.NCheckbox ${q(el.name)} ${q(el.label ?? "")} ${v}`;
      case "progress": return `Ui.NProgress ${q(el.name)} ${q(el.label ?? "")} ${v}`;
      case "select": {
        if (el.from) return `Ui.NSelect ${q(el.name)} ${q(el.label ?? "")} ${v}.options ${v}.selected`;
        const lc = lowerFirst(selectChoice(app, el));
        return `Ui.NSelect ${q(el.name)} ${q(el.label ?? "")} (List.map ${lc}ToString ${lc}Values) (${lc}ToString ${v})`;
      }
      case "list": return `Ui.NList ${q(el.name)} (List.map (\\r${d} -> ( r${d}.key, List.filterMap identity [ ${items(el.children, `r${d}`, d + 1).join(", ")} ] )) ${v})`;
      case "section": return `Ui.NSection ${q(el.name)} ${q(el.label ?? "")} (List.filterMap identity [ ${items(el.children, v, d + 1).join(", ")} ])`;
      default: return "";
    }
  };
  out.push(`toNode : Screen -> Ui.Node\ntoNode s =\n    Ui.NScreen ${q(app.name)}\n        (List.filterMap identity\n            [ ${items(app.screen, "s", 1).join("\n            , ")}\n            ]\n        )\n\n`);

  // fromWire
  const cases = evs.map((e) => {
    const pat = e.on === "tick" ? `( "tick", _ )` : `( ${q(e.on)}, ${q(e.target)} )`;
    const body =
      e.payload === "key" ? `Just (${e.tag} w.key)` : e.payload === "text" ? `Just (${e.tag} w.text)` : e.payload === "pick" ? `Just (${e.tag} w.value)` : e.payload === "value" ? `Maybe.map ${e.tag} (${lowerFirst(e.choice!)}FromString w.value)` : `Just ${e.tag}`;
    return `        ${pat} ->\n            ${body}\n`;
  });
  out.push(`fromWire : Ui.Wire -> Maybe Msg\nfromWire w =\n    case ( w.on, w.target ) of\n${cases.join("\n")}\n        _ ->\n            Nothing\n`);
  if (hasClients(app)) out.push(`\n\n${genElmCalls(app)}`);
  return out.join("");
}

function genElmMain(app: App): string {
  return `module Main exposing (main)

import App
import Browser
import Spec
${app.clockMs ? "import Time\n" : ""}import Ui


main : Program () App.Model Ui.Wire
main =
    Browser.element
        { init = \\_ -> ( App.init, Cmd.none )
        , update =
            \\w m ->
                ( case Spec.fromWire w of
                    Just e ->
                        App.update e m

                    Nothing ->
                        m
                , Cmd.none
                )
        , view = \\m -> Ui.render (Spec.toNode (App.view m))
        , subscriptions = \\_ -> ${app.clockMs ? `Time.every ${app.clockMs} (\\_ -> { on = "tick", target = "", key = "", text = "", value = "" })` : "Sub.none"}
        }
`;
}

/** Apps that make calls: ports carry calls out (`request`) and answers in (`answer`); glue.js performs them with fetch. */
function genElmMainCalls(app: App): string {
  return `port module Main exposing (main)

import App
import Browser
import Html
import Json.Decode as D
import Json.Encode as J
import Spec
${app.clockMs ? "import Time\n" : ""}import Ui


port request : J.Value -> Cmd msg


port answer : (D.Value -> msg) -> Sub msg


type In
    = FromUi Ui.Wire
    | FromApi D.Value


send : List Spec.Call -> Cmd In
send calls =
    Cmd.batch (List.map (\\c -> request (Spec.callToJson c)) calls)


main : Program () App.Model In
main =
    Browser.element
        { init = \\_ -> Tuple.mapSecond send App.init
        , update =
            \\i m ->
                let
                    msg =
                        case i of
                            FromUi w ->
                                Spec.fromWire w

                            FromApi v ->
                                Spec.fromAnswer v
                in
                case msg of
                    Just e ->
                        Tuple.mapSecond send (App.update e m)

                    Nothing ->
                        ( m, Cmd.none )
        , view = \\m -> Html.map FromUi (Ui.render (Spec.toNode (App.view m)))
        , subscriptions = \\_ -> Sub.batch [ answer FromApi${app.clockMs ? `, Time.every ${app.clockMs} (\\_ -> FromUi { on = "tick", target = "", key = "", text = "", value = "" })` : ""} ]
        }
`;
}

/** The test worker of an app that makes calls: each observation also carries the calls made since the last one. */
const ELM_WORKER_CALLS = `port module Worker exposing (main)

import App
import Json.Decode as D
import Json.Encode as J
import Spec
import Ui


port observe : J.Value -> Cmd msg


port act : (D.Value -> msg) -> Sub msg


type alias Model =
    { app : App.Model, pending : List Spec.Call }


main : Program () Model D.Value
main =
    Platform.worker
        { init = \\_ -> ( { app = Tuple.first App.init, pending = Tuple.second App.init }, Cmd.none )
        , update =
            \\v m ->
                let
                    msg =
                        if D.decodeValue (D.field "on" D.string) v == Ok "answer" then
                            Result.toMaybe (D.decodeValue (D.field "answer" D.value) v) |> Maybe.andThen Spec.fromAnswer

                        else
                            case D.decodeValue Ui.wireDecoder v of
                                Ok w ->
                                    Spec.fromWire w

                                Err _ ->
                                    Nothing

                    ( next, calls ) =
                        case msg of
                            Just e ->
                                App.update e m.app

                            Nothing ->
                                ( m.app, [] )
                in
                ( { app = next, pending = [] }
                , observe (J.object [ ( "screen", Ui.encode (Spec.toNode (App.view next)) ), ( "calls", J.list Spec.callToJson (m.pending ++ calls) ) ])
                )
        , subscriptions = \\_ -> act identity
        }
`;

const ELM_WORKER = `port module Worker exposing (main)

import App
import Json.Decode as D
import Json.Encode as J
import Spec
import Ui


port observe : J.Value -> Cmd msg


port act : (D.Value -> msg) -> Sub msg


main : Program () App.Model D.Value
main =
    Platform.worker
        { init = \\_ -> ( App.init, Cmd.none )
        , update =
            \\v m ->
                let
                    next =
                        case D.decodeValue Ui.wireDecoder v of
                            Ok w ->
                                case Spec.fromWire w of
                                    Just e ->
                                        App.update e m

                                    Nothing ->
                                        m

                            Err _ ->
                                m
                in
                ( next, observe (Ui.encode (Spec.toNode (App.view next))) )
        , subscriptions = \\_ -> act identity
        }
`;

export const ELM_APP_SKELETON = `module App exposing (Model, init, update, view)

import Fmt
import Spec exposing (..)


type alias Model =
    { ... }


init : Model
init =
    ...


update : Msg -> Model -> Model
update msg model =
    case msg of
        ...


view : Model -> Screen
view model =
    { ... }
`;

export const ELM_APP_SKELETON_CALLS = `module App exposing (Model, init, update, view)

import Fmt
import Spec exposing (..)


type alias Model =
    { ... }


init : ( Model, List Call )
init =
    ( ..., [ ... ] )


update : Msg -> Model -> ( Model, List Call )
update msg model =
    case msg of
        ...


view : Model -> Screen
view model =
    { ... }
`;

// ---------------------------------------------------------------- TypeScript

export function tsType(t: Type): string {
  switch (t.k) {
    case "Text": return "string";
    case "Int":
    case "Decimal": return "number";
    case "Bool": return "boolean";
    case "List": return `${tsAtom(t.of)}[]`;
    case "Maybe": return `${tsType(t.of)} | null`;
    case "Named": return t.name;
  }
}
const tsAtom = (t: Type) => (t.k === "Maybe" ? `(${tsType(t)})` : tsType(t));

/** Records, choices and table seeds: the domain, shared by every profile. */
export function tsDomain(app: App): string {
  const out: string[] = [];
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
${hasClients(app) ? `import { conforms, type TypeDesc } from "./api.ts";\nimport type { Answer, CallDesc, CallOut } from "./calls.ts";\n` : ""}
`);
  out.push(tsDomain(app));
  const evs = events(app);
  out.push(`/** Everything the user (or the clock) can do${hasClients(app) ? ", and the answers to calls" : ""}. Row events carry the row's key (the \`key\` you gave that row in \`view\`). Typed events carry the full new text of the field. */\nexport type Msg =\n  | ${[...evs
    .map((e) => `{ tag: ${q(e.tag)}${e.payload === "key" ? "; key: string" : e.payload === "text" ? "; text: string" : e.payload === "pick" ? "; value: string" : e.payload === "value" ? `; value: ${e.choice}` : ""} }`), ...tsAnswerMsgs(app)]
    .join("\n  | ")};\n\n`);
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
  const screen = rowFields(app.screen);
  out.push(`/** What \`view\` returns: one field per dynamic element on the screen. */\nexport type Screen = { ${screen} };\n\n`);
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
  out.push(`export function toNode(s: Screen): Node {\n  return { k: "screen", title: ${q(app.name)}, c: ${list(items(app.screen, "s"))} };\n}\n\n`);

  const cases = evs.map((e) => {
    if (e.on === "tick") return "";
    const body =
      e.payload === "key" ? `{ tag: ${q(e.tag)}, key: w.key ?? "" }` : e.payload === "pick" ? `{ tag: ${q(e.tag)}, value: w.value ?? "" }` : e.payload === "text" ? `{ tag: ${q(e.tag)}, text: w.text ?? "" }` : e.payload === "value" ? `(${lowerFirst(e.choice!)}Values as string[]).includes(w.value ?? "") ? { tag: ${q(e.tag)}, value: w.value as ${e.choice} } : null` : `{ tag: ${q(e.tag)} }`;
    return `    case ${q(`${e.on} ${e.target}`)}:\n      return ${body};\n`;
  });
  out.push(`export function fromWire(w: Wire): Msg | null {\n  switch (\`\${w.on} \${w.target}\`) {\n${cases.join("")}  }\n${app.clockMs ? `  if (w.on === "tick") return { tag: "Tick" };\n` : ""}${hasClients(app) ? `  if (w.on === "answer" && w.answer) return fromAnswer(w.answer as Answer);\n` : ""}  return null;\n}\n`);
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

/** Entry points of an app that makes calls: the browser performs them with fetch; tests hand them to the driver. */
function genTsEntriesCalls(app: App): { main: string; test: string } {
  const main = `import * as App from "./app.ts";
import { callEndpoints, callToJson, fromWire, toNode, type Call } from "./spec.ts";
import { mount, STYLE, type Wire } from "./ui.ts";
import { fetchCall } from "./calls.ts";

const style = document.createElement("style");
style.textContent = STYLE;
document.head.append(style);
let dispatch: (w: Wire) => void = () => {};
const perform = (calls: Call[]) => {
  for (const c of calls) fetchCall(callEndpoints, callToJson(c)).then((a) => dispatch({ on: "answer", target: a.endpoint, answer: a }));
};
dispatch = mount(document.getElementById("app")!, {
  init: () => {
    const r = App.init();
    perform(r.calls);
    return r.model;
  },
  step: (w, m) => {
    const e = fromWire(w);
    if (!e) return m;
    const r = App.update(e, m);
    perform(r.calls);
    return r.model;
  },
  render: (m) => toNode(App.view(m)),
  clockMs: ${app.clockMs ?? 0},
});
`;
  const test = `import * as App from "./app.ts";
import { callToJson, fromWire, toNode } from "./spec.ts";
import type { CallOut } from "./calls.ts";
import type { Wire } from "./ui.ts";

export function start() {
  const first = App.init();
  let m = first.model;
  let pending: CallOut[] = first.calls.map(callToJson);
  return {
    observe: () => JSON.parse(JSON.stringify(toNode(App.view(m)))),
    /** The calls made since the last time this was asked, in order. */
    calls() {
      const out = pending;
      pending = [];
      return JSON.parse(JSON.stringify(out));
    },
    send(w: Wire) {
      const e = fromWire(w);
      if (!e) return;
      const r = App.update(e, m);
      m = r.model;
      pending.push(...r.calls.map(callToJson));
    },
  };
}
`;
  return { main, test };
}

function genTsEntries(app: App): { main: string; test: string } {
  if (hasClients(app)) return genTsEntriesCalls(app);
  const main = `import * as App from "./app.ts";
import { fromWire, toNode } from "./spec.ts";
import { mount, STYLE } from "./ui.ts";

const style = document.createElement("style");
style.textContent = STYLE;
document.head.append(style);
mount(document.getElementById("app")!, {
  init: App.init,
  step: (w, m) => {
    const e = fromWire(w);
    return e ? App.update(e, m) : m;
  },
  render: (m) => toNode(App.view(m)),
  clockMs: ${app.clockMs ?? 0},
});
`;
  const test = `import * as App from "./app.ts";
import { fromWire, toNode } from "./spec.ts";
import type { Wire } from "./ui.ts";

export function start() {
  let m = App.init();
  return {
    observe: () => JSON.parse(JSON.stringify(toNode(App.view(m)))),
    send(w: Wire) {
      const e = fromWire(w);
      if (e) m = App.update(e, m);
    },
  };
}
`;
  return { main, test };
}

// ---------------------------------------------------------------- scaffold a build directory

export function scaffold(app: App, target: Target, dir: string): { appFile: string; specSource: string } {
  if (target === "elm") {
    mkdirSync(join(dir, "src"), { recursive: true });
    copyFileSync(join(ROOT, "runtime/elm/elm.json"), join(dir, "elm.json"));
    copyFileSync(join(ROOT, "runtime/elm/Ui.elm"), join(dir, "src/Ui.elm"));
    copyFileSync(join(ROOT, "runtime/elm/Fmt.elm"), join(dir, "src/Fmt.elm"));
    const spec = genElmSpec(app);
    writeFileSync(join(dir, "src/Spec.elm"), spec);
    if (hasClients(app)) {
      writeFileSync(join(dir, "src/Main.elm"), genElmMainCalls(app));
      writeFileSync(join(dir, "src/Worker.elm"), ELM_WORKER_CALLS);
      copyFileSync(join(ROOT, "runtime/ts/calls.ts"), join(dir, "calls.ts"));
      writeFileSync(join(dir, "glue.ts"), `// Performs the app's calls with fetch and sends the answers back in.\nimport { fetchCall, type CallDesc } from "./calls.ts";\n\nconst endpoints: CallDesc[] = ${JSON.stringify(callDescs(app))};\n\n(globalThis as any).intentConnect = (app: any) =>\n  app.ports.request.subscribe((c: any) => fetchCall(endpoints, c).then((a) => app.ports.answer.send(a)));\n`);
      writeFileSync(join(dir, "index.html"), html(app.name, `<script src="main.js"></script><script src="glue.js"></script><script>intentConnect(Elm.Main.init({ node: document.getElementById("app") }))</script>`, true));
    } else {
      writeFileSync(join(dir, "src/Main.elm"), genElmMain(app));
      writeFileSync(join(dir, "src/Worker.elm"), ELM_WORKER);
      writeFileSync(join(dir, "index.html"), html(app.name, `<script src="main.js"></script><script>Elm.Main.init({ node: document.getElementById("app") })</script>`, true));
    }
    return { appFile: join(dir, "src/App.elm"), specSource: spec };
  } else {
    mkdirSync(dir, { recursive: true });
    copyFileSync(join(ROOT, "runtime/ts/ui.ts"), join(dir, "ui.ts"));
    copyFileSync(join(ROOT, "runtime/ts/fmt.ts"), join(dir, "fmt.ts"));
    if (hasClients(app)) {
      copyFileSync(join(ROOT, "runtime/ts/api.ts"), join(dir, "api.ts"));
      copyFileSync(join(ROOT, "runtime/ts/calls.ts"), join(dir, "calls.ts"));
    }
    const spec = genTsSpec(app);
    writeFileSync(join(dir, "spec.ts"), spec);
    const { main, test } = genTsEntries(app);
    writeFileSync(join(dir, "main.ts"), main);
    writeFileSync(join(dir, "test-entry.ts"), test);
    writeFileSync(
      join(dir, "tsconfig.json"),
      JSON.stringify({ compilerOptions: { strict: true, noEmit: true, target: "es2022", module: "esnext", moduleResolution: "bundler", allowImportingTsExtensions: true, lib: ["es2022", "dom", "dom.iterable"], skipLibCheck: true, noUnusedLocals: false }, include: ["*.ts"] }, null, 2),
    );
    writeFileSync(join(dir, "index.html"), html(app.name, `<script src="main.js"></script>`, false));
    return { appFile: join(dir, "app.ts"), specSource: spec };
  }
}

function html(title: string, scripts: string, elm: boolean): string {
  const style = elm ? `<style>${STYLE}</style>` : "";
  return `<!doctype html>\n<html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${title}</title>${style}</head>\n<body><div id="app"></div>${scripts}</body></html>\n`;
}
