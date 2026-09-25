// Deterministic code generation: everything except the app logic.
// For each target it writes the typed interface (Spec), the runtime, and the entry points.
import { copyFileSync, existsSync, mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import type { App, Element, Literal, Type } from "./ast.ts";
import { STYLE } from "../runtime/ts/ui.ts";
import { usesClock } from "./refs.ts";
import { elmDecoder, elmEncoder as elmEncode, genElmJson } from "./calls.ts";
import { typeDesc } from "./api.ts";
import { callDescs, elmAnswerMsgs, eventsByAlias, genElmCalls, genTsCalls, hasClients, hasThrough, throughs, tsAnswerMsgs } from "./calls.ts";

export type Target = "elm" | "ts";
export const ROOT = join(dirname(fileURLToPath(import.meta.url)), ".."); // the Intent installation

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
    case "date": return q(l.v);
    case "dateTime": return q(l.v);
    case "table": return "[]";
    case "list": case "record": throw new Error("list and record values are only call arguments in examples");
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
    case "date": return q(l.v);
    case "dateTime": return q(l.v);
    case "table": return "[]";
    case "list": case "record": throw new Error("list and record values are only call arguments in examples");
  }
}

// ---------------------------------------------------------------- Elm

/** Apps with sentences in `always`: the harness checks them on the app's data after every step. */
export const hasInvariants = (app: App) => !!app.invariants?.length;
/** State that survives a restart (`stored name: T = …`). */
export const hasStored = (app: App) => app.state.some((f) => f.stored);
/** The app hands over its data: for the checks in `always`, and to save its stored state. */
export const hasData = (app: App) => hasInvariants(app) || hasStored(app) || (app.layers ?? []).some((l) => l.bindings.some((b) => b.state));
/** A state field's name in the data: `pager.page` → `pagerPage`. */
export const dataField = (name: string) => name.replace(/\.([a-z])/g, (_, c: string) => c.toUpperCase());

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
const storedTypes = (app: App) => app.state.filter((f) => f.stored).map((f) => `${dataField(f.name)}: ${typeDesc(app, f.type)}`).join(", ");

/** The app's data as the checks see it: every state field, typed as in the spec. */
function genElmData(app: App): string {
  const stored = app.state.filter((f) => f.stored);
  const storedPart = stored.length
    ? `{-| The state that survives a restart (\`stored\` in the spec). \`restore saved model\` in the app module puts it into a freshly started model. -}
type alias Stored =
    { ${stored.map((f) => `${dataField(f.name)} : ${elmType(f.type)}`).join("\n    , ")}
    }


decodeStored : D.Decoder Stored
decodeStored =
    D.succeed Stored
${stored.map((f) => `        |> jsonAndMap (D.field ${q(dataField(f.name))} ${elmDecoder(app, f.type)})`).join("\n")}


`
    : "";
  return `${storedPart}{-| The app's data${hasInvariants(app) ? ", for the checks in \`always\`" : ""}${stored.length ? `${hasInvariants(app) ? " and" : ","} to save what is stored` : ""}: every state field, as in the spec. \`data\` in the app module fills it. -}
type alias Data =
    { ${app.state.map((f) => `${dataField(f.name)} : ${elmType(f.type)}`).join("\n    , ")}
    }


encodeData : Data -> J.Value
encodeData d =
    J.object
        [ ${app.state.map((f) => `( ${q(dataField(f.name))}, ${elmEncode(app, f.type, `d.${dataField(f.name)}`)} )`).join("\n        , ")}
        ]


`;
}

export function elmType(t: Type): string {
  switch (t.k) {
    case "Text": return "String";
    case "Int": return "Int";
    case "Decimal": return "Float";
    case "Bool": return "Bool";
    case "Date": return "Date";
    case "DateTime": return "DateTime";
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

${hasClients(app) || hasData(app) ? "import Json.Decode as D\nimport Json.Encode as J\n" : ""}import Ui
${(app.refined ?? []).some((r) => r.pattern !== undefined) ? "import Regex\n" : ""}
`);
  out.push(`{-| A day, "YYYY-MM-DD", and a moment to the minute, "YYYY-MM-DDTHH:MM" (local time). Compare and sort them as text; compute with Fmt. -}\ntype alias Date =\n    String\n\n\ntype alias DateTime =\n    String\n\n\n{-| The clock: @now and @today in the spec. -}\ntype alias Clock =\n    { now : DateTime, today : Date }\n\n\n`);
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
  if (hasClients(app) || hasData(app)) out.push(`\n\n${genElmJson(app)}`);
  if (hasData(app)) out.push(genElmData(app));
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

/**
 * The browser entry of an app that makes calls or reads the clock: ports carry calls out
 * (`request`), answers and events in, the client layers' config out (`through`), and the local
 * time in (`clockTicks`); glue.js does the JavaScript side.
 */
function genElmMainPorts(app: App): string {
  const calls = hasClients(app);
  const th = hasThrough(app);
  const c = usesClock(app);
  const st = hasStored(app);
  const clk = c ? " model.clock" : "";
  const first = c ? "(App.init start)" : "App.init";
  // Stored state: what this browser kept comes in with the flags, and the data goes out after every update.
  const init = st ? (calls ? `(Tuple.mapFirst (restoreFrom flags) ${first})` : `(restoreFrom flags ${first})`) : first;
  const withClock = (fn: string) => (c ? `(${fn} model.clock)` : fn);
  const send = th
    ? `{-| The calls, each with the config its api's client layer gets from this state; and that config, for the event streams. -}
send : ( App.Model, List Spec.Call ) -> ( App.Model, Cmd In )
send ( m, calls ) =
    ( m, Cmd.batch (through (Spec.encodeThrough (App.through m)) :: List.map (\\c -> request (Spec.callOut (App.through m) c)) calls) )`
    : `send : ( App.Model, List Spec.Call ) -> ( App.Model, Cmd In )
send ( m, calls ) =
    ( m, Cmd.batch (List.map (\\c -> request (Spec.callToJson c)) calls) )`;
  return `port module Main exposing (main)

import App
import Browser
import Html
import Json.Decode as D
import Json.Encode as J
import Spec
${app.clockMs ? "import Time\n" : ""}import Ui
${calls ? `

port request : J.Value -> Cmd msg


port answer : (D.Value -> msg) -> Sub msg


port events : (D.Value -> msg) -> Sub msg
` : ""}${th ? `

port through : J.Value -> Cmd msg
` : ""}${st ? `

port save : J.Value -> Cmd msg
` : ""}${c ? `

port clockTicks : (D.Value -> msg) -> Sub msg
` : ""}

type In
    = FromUi Ui.Wire${calls ? `
    | FromApi D.Value
    | FromEvent D.Value` : ""}${c ? `
    | NewClock D.Value` : ""}


type alias Model =
    { app : App.Model${c ? ", clock : Spec.Clock" : ""} }


{-| The clock JavaScript sends: { now, today }; the one before when it cannot be read. -}
decodeClock : D.Value -> Spec.Clock -> Spec.Clock
decodeClock v before =
    Result.withDefault before (D.decodeValue (D.map2 Spec.Clock (D.field "now" D.string) (D.field "today" D.string)) v)

${st ? `
{-| The model with what this browser kept (the stored fields), when there is any. -}
restoreFrom : D.Value -> App.Model -> App.Model
restoreFrom flags m =
    case D.decodeValue (D.field "saved" Spec.decodeStored) flags of
        Ok saved ->
            App.restore saved m

        Err _ ->
            m

` : ""}${calls ? send : `send : App.Model -> ( App.Model, Cmd In )
send m =
    ( m, Cmd.none )`}


main : Program D.Value Model In
main =
    Browser.element
        { init =
            \\flags ->
                let
                    model =
                        { app = Tuple.first (send ${init}) ${c ? ", clock = start " : ""}}

                    start =
                        decodeClock flags { now = "2026-01-05T09:00", today = "2026-01-05" }
                in
                ( model, Tuple.second (send ${init}) )
        , update =
            \\i model ->
                let
                    msg =
                        case i of
                            FromUi w ->
                                Spec.fromWire w
${calls ? `
                            FromApi v ->
                                Spec.fromAnswer v

                            FromEvent v ->
                                Spec.fromEvent v
` : ""}${c ? `
                            NewClock _ ->
                                Nothing
` : ""}
                    moved =
                        ${c ? `case i of
                            NewClock v ->
                                { model | clock = decodeClock v model.clock }

                            _ ->
                                model` : "model"}
                in
                case msg of
                    Just e ->
                        ${st ? `let
                            ( a, cmd ) =
                                send (${withClock("App.update")} e moved.app)
                        in
                        ( { moved | app = a }, Cmd.batch [ cmd, save (Spec.encodeData (App.data a)) ] )` : `Tuple.mapFirst (\\a -> { moved | app = a }) (send (${withClock("App.update")} e moved.app))`}

                    Nothing ->
                        ( moved, Cmd.none )
        , view = \\model -> Html.map FromUi (Ui.render (Spec.toNode (App.view${clk} model.app)))
        , subscriptions = \\_ -> Sub.batch [ ${[calls ? "answer FromApi, events FromEvent" : "", c ? "clockTicks NewClock" : "", app.clockMs ? `Time.every ${app.clockMs} (\\_ -> FromUi { on = "tick", target = "", key = "", text = "", value = "" })` : ""].filter(Boolean).join(", ")} ]
        }
`;
}

/** The test worker of an app that makes calls or reads the clock: the driver sends the clock with every event. */
const elmWorkerPorts = (app: App) => {
  const calls = hasClients(app);
  const c = usesClock(app);
  const inv = hasData(app);
  const st = hasStored(app);
  const upd = c ? "App.update clock" : "App.update";
  return `port module Worker exposing (main)

import App
import Json.Decode as D
import Json.Encode as J
import Spec
import Ui


port observe : J.Value -> Cmd msg


port act : (D.Value -> msg) -> Sub msg


type alias Model =
    { app : App.Model${calls ? ", pending : List Spec.Call" : ""}${c ? ", clock : Spec.Clock" : ""} }


decodeClock : D.Value -> Spec.Clock -> Spec.Clock
decodeClock v before =
    Result.withDefault before (D.decodeValue (D.map2 Spec.Clock (D.field "now" D.string) (D.field "today" D.string)) v)


main : Program D.Value Model D.Value
main =
    Platform.worker
        { init =
            \\flags ->
                let
                    start =
                        decodeClock flags { now = "2026-01-05T09:00", today = "2026-01-05" }

                    first =
                        ${c ? "App.init start" : "App.init"}
                in
                ( { app = ${calls ? "Tuple.first first" : "first"}${calls ? ", pending = Tuple.second first" : ""}${c ? ", clock = start" : ""} }, Cmd.none )
        , update =
            \\v m ->
                let
                    clock =
                        ${c ? `Result.withDefault m.clock (D.decodeValue (D.field "clock" D.value) v |> Result.map (\\cv -> decodeClock cv m.clock))` : "()"}

                    on =
                        Result.withDefault "" (D.decodeValue (D.field "on" D.string) v)

                    msg =
                        ${calls ? `if on == "answer" then
                            Result.toMaybe (D.decodeValue (D.field "answer" D.value) v) |> Maybe.andThen Spec.fromAnswer

                        else if on == "event" then
                            Result.toMaybe (D.decodeValue (D.field "event" D.value) v) |> Maybe.andThen Spec.fromEvent

                        else
                            ` : ""}case D.decodeValue Ui.wireDecoder v of
                                Ok w ->
                                    Spec.fromWire w

                                Err _ ->
                                    Nothing

                    ( next, calls ) =
                        ${st ? `if on == "restart" then
                            -- The app starts again with what the driver saved (the stored fields of its data).
                            let
                                ( fresh, first ) =
                                    ${calls ? (c ? "App.init clock" : "App.init") : `( ${c ? "App.init clock" : "App.init"}, [] )`}
                            in
                            case D.decodeValue (D.field "saved" Spec.decodeStored) v of
                                Ok saved ->
                                    ( App.restore saved fresh, first )

                                Err _ ->
                                    ( fresh, first )

                        else
                        ` : ""}case msg of
                            Just e ->
                                ${calls ? `${upd} e m.app` : `( ${upd} e m.app, [] )`}

                            Nothing ->
                                ( m.app, [] )

                    screen =
                        Ui.encode (Spec.toNode (App.view${c ? " clock" : ""} next))
                in
                ( { app = next${calls ? ", pending = []" : ""}${c ? ", clock = clock" : ""} }
                , observe ${calls || inv ? `(J.object [ ${hasThrough(app) ? `( "through", Spec.encodeThrough (App.through next) ), ` : ""}${inv ? `( "data", Spec.encodeData (App.data next) ), ` : ""}( "screen", screen )${calls ? `, ( "calls", J.list ${hasThrough(app) ? "(Spec.callOut (App.through next))" : "Spec.callToJson"} (m.pending ++ calls) )` : ""} ])` : "screen"}
                )
        , subscriptions = \\_ -> act identity
        }
`;
};

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

export const ELM_APP_SKELETON_THROUGH = `

{-| What the client layers need from the state (the params bound under \`through\`). -}
through : Model -> Through
through model =
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
    case "Date": return "Date";
    case "DateTime": return "DateTime";
    case "List": return `${tsAtom(t.of)}[]`;
    case "Maybe": return `${tsType(t.of)} | null`;
    case "Named": return t.name;
  }
}
const tsAtom = (t: Type) => (t.k === "Maybe" ? `(${tsType(t)})` : tsType(t));

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
  out.push(`export function fromWire(w: Wire): Msg | null {\n  switch (\`\${w.on} \${w.target}\`) {\n${cases.join("")}  }\n${app.clockMs ? `  if (w.on === "tick") return { tag: "Tick" };\n` : ""}${hasClients(app) ? `  if (w.on === "answer" && w.answer) return fromAnswer(w.answer as Answer);\n  if (w.on === "event" && w.event) return fromEvent(w.event as { event: string; body: unknown });\n` : ""}  return null;\n}\n`);
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

function genTsEntries(app: App): { main: string; test: string } {
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

/** Apps that call apis: the client layers' verified modules (built once per layer spec) and their composition. */
function writeThrough(app: App, dir: string, layerDirs: Record<string, string>) {
  for (const t of throughs(app)) {
    mkdirSync(join(dir, "layers", t.alias), { recursive: true });
    for (const f of ["layer.ts", "spec.ts", "http.ts", "fmt.ts"]) copyFileSync(join(layerDirs[t.alias], f), join(dir, "layers", t.alias, f));
  }
  writeFileSync(join(dir, "through.ts"), genThrough(app));
}

export function scaffold(app: App, target: Target, dir: string, layerDirs: Record<string, string> = {}): { appFile: string; specSource: string } {
  if (target === "elm") {
    mkdirSync(join(dir, "src"), { recursive: true });
    copyFileSync(join(ROOT, "runtime/elm/elm.json"), join(dir, "elm.json"));
    copyFileSync(join(ROOT, "runtime/elm/Ui.elm"), join(dir, "src/Ui.elm"));
    copyFileSync(join(ROOT, "runtime/elm/Fmt.elm"), join(dir, "src/Fmt.elm"));
    const spec = genElmSpec(app);
    writeFileSync(join(dir, "src/Spec.elm"), spec);
    if (!hasClients(app) && !usesClock(app) && !hasStored(app) && hasInvariants(app)) {
      // Checks in `always` need the data from the test worker; the browser entry stays plain.
      writeFileSync(join(dir, "src/Main.elm"), genElmMain(app));
      writeFileSync(join(dir, "src/Worker.elm"), elmWorkerPorts(app));
      writeFileSync(join(dir, "index.html"), html(app.name, `<script src="main.js"></script><script>Elm.Main.init({ node: document.getElementById("app") })</script>`, true));
    } else if (hasClients(app) || usesClock(app) || hasStored(app)) {
      writeFileSync(join(dir, "src/Main.elm"), genElmMainPorts(app));
      for (const f of ["store.ts", "api.ts", "fmt.ts"]) copyFileSync(join(ROOT, "runtime/ts", f), join(dir, f));
      writeFileSync(join(dir, "src/Worker.elm"), elmWorkerPorts(app));
      copyFileSync(join(ROOT, "runtime/ts/calls.ts"), join(dir, "calls.ts"));
      copyFileSync(join(ROOT, "runtime/ts/clock.ts"), join(dir, "clock.ts"));
      writeThrough(app, dir, layerDirs);
      writeFileSync(
        join(dir, "glue.ts"),
        `// The JavaScript side of the Elm app: calls with fetch (through each api's client layer), answers and
// events in, and the local clock (at the start, then every 15 seconds).
import { fetchCall, listen, newKey, type CallDesc, type Outgoing } from "./calls.ts";
import { apply } from "./through.ts";
import { localClock } from "./clock.ts";
import { load, save } from "./store.ts";
import type { TypeDesc } from "./api.ts";

const endpoints: CallDesc[] = ${JSON.stringify(callDescs(app))};
// Stored state lives in this browser (localStorage), under the app's name.
const KEY = ${q(`intent:${app.name}`)};
const storedFields: Record<string, TypeDesc> = { ${storedTypes(app)} };

// The flags: the local clock, and what this browser kept of the stored state.
(globalThis as any).intentClock = () => ({ ...localClock(), ...(Object.keys(storedFields).length ? { saved: load(KEY, storedFields) ?? null } : {}) });
(globalThis as any).intentConnect = (app: any) => {
  if (app.ports.clockTicks) setInterval(() => app.ports.clockTicks.send(localClock()), 15000);
  if (app.ports.save) app.ports.save.subscribe((data: Record<string, unknown>) => save(KEY, data, storedFields));
  if (!app.ports.request) return;
  let latest: Record<string, Record<string, unknown>> = {};
  let stream: { refresh: () => void } | undefined;
  // The client layers' config arrives from the app after every update (and after init): reopen the streams it changes.
  if (app.ports.through)
    app.ports.through.subscribe((t: Record<string, Record<string, unknown>>) => {
      latest = t;
      stream?.refresh();
    });
  // Each call gets its idempotency key when it is made: every attempt sends the same one.
  app.ports.request.subscribe((c: any) => fetchCall(endpoints, { ...c, key: newKey() }, (alias: string, req: Outgoing) => apply(alias, req, c.config ?? undefined)).then((a) => app.ports.answer.send(a)));
  stream = listen(${JSON.stringify(eventsByAlias(app))}, (e) => app.ports.events.send(e), (alias: string, req: Outgoing) => apply(alias, req, latest[alias]));
};
`,
      );
      writeFileSync(join(dir, "index.html"), html(app.name, `<script src="main.js"></script><script src="glue.js"></script><script>intentConnect(Elm.Main.init({ node: document.getElementById("app"), flags: intentClock() }))</script>`, true));
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
    if (usesClock(app)) copyFileSync(join(ROOT, "runtime/ts/clock.ts"), join(dir, "clock.ts"));
    if (hasStored(app)) for (const f of ["store.ts", "api.ts"]) copyFileSync(join(ROOT, "runtime/ts", f), join(dir, f));
    if (hasClients(app)) {
      copyFileSync(join(ROOT, "runtime/ts/api.ts"), join(dir, "api.ts"));
      copyFileSync(join(ROOT, "runtime/ts/calls.ts"), join(dir, "calls.ts"));
      writeThrough(app, dir, layerDirs);
    }
    const spec = genTsSpec(app);
    writeFileSync(join(dir, "spec.ts"), spec);
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
}

function html(title: string, scripts: string, elm: boolean): string {
  const style = elm ? `<style>${STYLE}</style>` : "";
  return `<!doctype html>\n<html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${title}</title>${style}</head>\n<body><div id="app"></div>${scripts}</body></html>\n`;
}
