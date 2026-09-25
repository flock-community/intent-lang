// Target: Elm 0.19. The generated interface (src/Spec.elm), the entries (browser, test worker, the
// JavaScript glue for calls, the clock and stored state), what the prompt says about Elm, the
// toolchain, and a test session on a compiled build.
import { copyFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { join } from "node:path";
import type { App, Element, Literal, Type } from "../ast.ts";
import { usesClock } from "../refs.ts";
import { callDescs, clientEndpoints, clientEvents, eventsByAlias, hasClients, hasThrough, throughs, undoables } from "../calls.ts";
import { cap, cellFor, dataField, events, hasData, hasInvariants, hasScreens, hasStored, html, ident, lowerFirst, q, ROOT, selectChoice, storedTypes, typeName, writeThrough, type TableLit } from "./shared.ts";
import { bin, clean, run } from "../tools.ts";
import type { Session, TargetModule } from "./target.ts";
import type { CallOut } from "../../runtime/ts/calls.ts";

export function elmLiteral(l: Literal, t: Type): string {
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

export function elmRecord(name: string, fields: [string, string][]): string {
  if (!fields.length) return `type alias ${name} =\n    {}\n`;
  return `type alias ${name} =\n    { ${fields.map(([n, t]) => `${n} : ${t}`).join("\n    , ")}\n    }\n`;
}

export function genElmSpec(app: App): string {
  const out: string[] = [];
  out.push(`module Spec exposing (..)

{-| Generated from ${app.name}.intent — do not edit. The interface the app module must satisfy.
-}

${hasClients(app) || hasData(app) ? "import Json.Decode as D\nimport Json.Encode as J\n" : ""}import Ui${hasScreens(app) ? "\nimport Url" : ""}
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
    .map((e) => e.tag + (e.payload === "key" || e.payload === "text" || e.payload === "pick" ? " String" : e.payload === "value" ? ` ${e.choice}` : "")), ...elmAnswerMsgs(app), ...(hasScreens(app) ? ["ScreenOpened Route"] : [])]
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
  if (hasScreens(app)) {
    const scs = app.screens!;
    const rec = (fields: [string, string][]) => (fields.length ? `{ ${fields.map(([n, t]) => `${n} : ${t}`).join(", ")} }` : "{}");
    out.push(`{-| Where the app is: one variant per screen, with its path params. The harness keeps it (the address after #). -}\ntype Route\n    = ${scs.map((s) => `${cap(s.name)}Route${s.params.length ? ` ${rec(s.params.map((p) => [p.name, elmType(p.type)]))}` : ""}`).join("\n    | ")}\n\n\n`);
    out.push(`{-| Where to go after an update: \`go to\` a screen, \`go back\`, or stay. -}\ntype Go\n    = Stay\n    | GoTo Route\n    | GoBack\n\n\n`);
    out.push(`{-| What \`view\` returns: the current screen, with one field per dynamic element on it. -}\ntype Screen\n    = ${scs.map((s) => `${cap(s.name)}Screen ${rec(rowFields(app.screen.filter((e) => e.screen === s.name)))}`).join("\n    | ")}\n\n\n`);
    // Addresses ↔ routes: the harness's. An address that fits no screen is the first screen.
    const first = `${cap(scs[0].name)}Route${scs[0].params.length ? ` { ${scs[0].params.map((p) => `${p.name} = ${p.type.k === "Int" ? "0" : '""'}`).join(", ")} }` : ""}`;
    const branch = (s: (typeof scs)[number]): string => {
      const segs = s.path.split("/").filter(Boolean);
      const pat = `[ ${segs.map((g, i) => (/^\{[a-z]\w*\}$/i.test(g) ? `a${i}` : q(g))).join(", ")} ]`.replace("[  ]", "[]");
      const holes = segs.flatMap((g, i) => (/^\{([a-z]\w*)\}$/i.test(g) ? [{ name: g.slice(1, -1), v: `a${i}` }] : []));
      // Each param read in turn; one that does not fit makes it the first screen.
      let body = `${cap(s.name)}Route${holes.length ? ` { ${holes.map((h) => `${h.name} = ${h.name}`).join(", ")} }` : ""}`;
      for (const h of [...holes].reverse()) {
        const p = s.params.find((x) => x.name === h.name)!;
        const read = p.type.k === "Int" ? `String.toInt ${h.v}` : `Url.percentDecode ${h.v}`;
        body = `case ${read} of\n                Just ${h.name} ->\n                    ${body.replace(/\n/g, "\n        ")}\n\n                Nothing ->\n                    ${first}`;
      }
      return `        ${pat} ->\n            ${body}\n`;
    };
    out.push(`{-| The route an address shows ("/tickets/3"); an address that fits no screen shows the first. -}\nrouteFromPath : String -> Route\nrouteFromPath path =\n    case List.filter (\\s -> s /= "") (String.split "/" (Maybe.withDefault "" (List.head (String.split "?" path)))) of\n${scs.map(branch).join("\n")}\n        _ ->\n            ${first}\n\n\n`);
    out.push(`{-| The address of a route. -}\npathOf : Route -> String\npathOf r =\n    case r of\n${scs
      .map((s) => `        ${cap(s.name)}Route${s.params.length ? " p" : ""} ->\n            ${s.path.split(/(\{[a-z]\w*\})/i).filter((x) => x !== "").map((x) => {
        const h = x.match(/^\{([a-z]\w*)\}$/i);
        if (!h) return q(x);
        const p = s.params.find((y) => y.name === h[1])!;
        return p.type.k === "Int" ? `String.fromInt p.${h[1]}` : `Url.percentEncode p.${h[1]}`;
      }).join(" ++ ")}\n`)
      .join("\n")}\n\n`);
  } else {
    const screenFields = rowFields(app.screen);
    out.push(`{-| What \`view\` returns: one field per dynamic element on the screen. -}\n` + elmRecord("Screen", screenFields) + "\n");
  }
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
  if (hasScreens(app))
    out.push(`toNode : Screen -> Ui.Node\ntoNode screen =\n    case screen of\n${app.screens!.map((sc) => {
      const els = app.screen.filter((e) => e.screen === sc.name);
      return `        ${cap(sc.name)}Screen s ->\n            Ui.NScreen ${q(app.name)}\n                (List.filterMap identity\n                    [ ${items(els, "s", 1).join("\n                    , ")}\n                    ]\n                )\n`;
    }).join("\n")}\n`);
  else out.push(`toNode : Screen -> Ui.Node\ntoNode s =\n    Ui.NScreen ${q(app.name)}\n        (List.filterMap identity\n            [ ${items(app.screen, "s", 1).join("\n            , ")}\n            ]\n        )\n\n`);

  // fromWire
  const cases = evs.map((e) => {
    const pat = e.on === "tick" ? `( "tick", _ )` : `( ${q(e.on)}, ${q(e.target)} )`;
    const body =
      e.payload === "key" ? `Just (${e.tag} w.key)` : e.payload === "text" ? `Just (${e.tag} w.text)` : e.payload === "pick" ? `Just (${e.tag} w.value)` : e.payload === "value" ? `Maybe.map ${e.tag} (${lowerFirst(e.choice!)}FromString w.value)` : `Just ${e.tag}`;
    return `        ${pat} ->\n            ${body}\n`;
  });
  const nav = hasScreens(app) ? `        ( "navigate", path ) ->\n            Just (ScreenOpened (routeFromPath path))\n\n` : "";
  out.push(`fromWire : Ui.Wire -> Maybe Msg\nfromWire w =\n    case ( w.on, w.target ) of\n${nav}${cases.join("\n")}\n        _ ->\n            Nothing\n`);
  if (hasClients(app) || hasData(app)) out.push(`\n\n${genElmJson(app)}`);
  if (hasData(app)) out.push(genElmData(app));
  if (hasClients(app)) out.push(`\n\n${genElmCalls(app)}`);
  return out.join("");
}

export function genElmMain(app: App): string {
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
  const sc = hasScreens(app);
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
                ( { app = ${sc ? "App.settled next" : "next"}${calls ? ", pending = []" : ""}${c ? ", clock = clock" : ""} }
                , observe ${calls || inv || sc ? `(J.object [ ${hasThrough(app) ? `( "through", Spec.encodeThrough (App.through next) ), ` : ""}${inv ? `( "data", Spec.encodeData (App.data next) ), ` : ""}${sc ? `( "go", Maybe.withDefault J.null (Maybe.map J.string next.go) ), ` : ""}( "screen", screen )${calls ? `, ( "calls", J.list ${hasThrough(app) ? "(Spec.callOut (App.through next))" : "Spec.callToJson"} (m.pending ++ calls) )` : ""} ])` : "screen"}
                )
        , subscriptions = \\_ -> act identity
        }
`;
};

export const ELM_WORKER = `port module Worker exposing (main)

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

// ---------------------------------------------------------------- Elm

export function elmDecoder(app: App, t: Type): string {
  switch (t.k) {
    case "Text": return "D.string";
    case "Int": return "D.int";
    case "Decimal": return "D.float";
    case "Bool": return "D.bool";
    case "Date": case "DateTime": return "D.string";
    case "List": return `(D.list ${elmDecoder(app, t.of)})`;
    case "Maybe": return `(D.nullable ${elmDecoder(app, t.of)})`;
    case "Named": {
      const r = app.refined?.find((x) => x.name === t.name);
      if (r) return r.base === "Text" ? "D.string" : r.base === "Int" ? "D.int" : "D.float";
      return `decode${t.name}`;
    }
  }
}

export function elmEncoder(app: App, t: Type, v: string, d = 0): string {
  switch (t.k) {
    case "Text": return `J.string ${v}`;
    case "Int": return `J.int ${v}`;
    case "Decimal": return `J.float ${v}`;
    case "Bool": return `J.bool ${v}`;
    case "Date": case "DateTime": return `J.string ${v}`;
    case "List": return `J.list (\\x${d} -> ${elmEncoder(app, t.of, `x${d}`, d + 1)}) ${v}`;
    case "Maybe": return `Maybe.withDefault J.null (Maybe.map (\\x${d} -> ${elmEncoder(app, t.of, `x${d}`, d + 1)}) ${v})`;
    case "Named": {
      const r = app.refined?.find((x) => x.name === t.name);
      if (r) return elmEncoder(app, { k: r.base } as Type, v, d);
      return `encode${t.name} ${v}`;
    }
  }
}

/** JSON decoders and encoders for every record and choice (calls, answers, and the app's data for checks). */
export function genElmJson(app: App): string {
  const out: string[] = [];
  // JSON for every record and choice: calls send them, answers bring them back.
  out.push(`jsonAndMap : D.Decoder a -> D.Decoder (a -> b) -> D.Decoder b\njsonAndMap =\n    D.map2 (|>)\n\n\n`);
  for (const c of app.choices) {
    const lc = lowerFirst(c.name);
    out.push(`decode${c.name} : D.Decoder ${c.name}\ndecode${c.name} =\n    D.string\n        |> D.andThen\n            (\\s ->\n                case ${lc}FromString s of\n                    Just v ->\n                        D.succeed v\n\n                    Nothing ->\n                        D.fail ("not a ${c.name}: " ++ s)\n            )\n\n\n`);
    out.push(`encode${c.name} : ${c.name} -> J.Value\nencode${c.name} v =\n    J.string (${lc}ToString v)\n\n\n`);
  }
  for (const r of app.records) {
    if (!r.fields.length) continue;
    const field = (f: { name: string; type: Type }) =>
      f.type.k === "Maybe" ? `(D.oneOf [ D.field ${q(f.name)} ${elmDecoder(app, f.type)}, D.succeed Nothing ])` : `(D.field ${q(f.name)} ${elmDecoder(app, f.type)})`;
    out.push(`decode${r.name} : D.Decoder ${r.name}\ndecode${r.name} =\n    D.succeed ${r.name}\n${r.fields.map((f) => `        |> jsonAndMap ${field(f)}`).join("\n")}\n\n\n`);
    out.push(`encode${r.name} : ${r.name} -> J.Value\nencode${r.name} r =\n    J.object\n        [ ${r.fields.map((f) => `( ${q(f.name)}, ${elmEncoder(app, f.type, `r.${f.name}`)} )`).join("\n        , ")}\n        ]\n\n\n`);
  }
  return out.join("");
}

export function genElmCalls(app: App): string {
  const eps = clientEndpoints(app);
  const undos = undoables(app);
  const out: string[] = [];
  const callVariants = [
    ...eps.map((c) => `${c.tag}${c.ep.params.length ? ` { ${c.ep.params.map((p) => `${p.name} : ${elmType(p.type)}`).join(", ")} }` : ""}`),
    ...undos.map((u) => `${u.tag} { answer : ${elmType(u.answer)}${u.usesArgs ? `, ${u.of.ep.params.map((p) => `${p.name} : ${elmType(p.type)}`).join(", ")}` : ""} }`),
  ];
  out.push(`{-| A request to an API, made by returning it from init or update. It is answered later by an \`…Answered\` message.${undos.length ? " An \`undo\` takes an effect back (\`undo @pay.charge\`): give the answer the original call got (and its args); the harness calls the endpoint the contract names in \`undone by\`, answered as that endpoint's \`…Answered\`." : ""} -}\ntype Call\n    = ${callVariants.join("\n    | ")}\n\n\n`);
  for (const c of eps) {
    const variants = (c.ep.answers ?? []).map((a) => `${c.tag}${a.status}${a.type ? ` ${elmAtom(a.type)}` : ""}`);
    const unknown = c.ep.effect ? [`${c.tag}Unknown String`] : [];
    out.push(`{-| What ${c.ep.method} ${c.ep.path} answers, per status (the contract). Failed: no answer the contract allows (network down, or a body of the wrong shape).${c.ep.effect ? " Unknown: still no answer after the last attempt, so it may or may not have happened (effect external): do not offer to do it again as if it failed." : ""} -}\ntype ${c.tag}Answer\n    = ${[...variants, `${c.tag}Failed String`, ...unknown].join("\n    | ")}\n\n\n`);
  }
  const th = throughs(app);
  if (th.length) {
    out.push(`{-| What the client layers need from the app's state, per api (\`through\` in \`uses\`): \`through model\` in the app module computes it. -}\ntype alias Through =\n    { ${th.map((t) => `${t.alias} : { ${t.state.map((x) => `${x.param} : ${elmType(x.type)}`).join(", ")} }`).join("\n    , ")}\n    }\n\n\n`);
    out.push(`{-| A call as it leaves, with the config of its api's client layer. -}\ncallOut : Through -> Call -> J.Value\ncallOut th c =\n    let\n        v =\n            callToJson c\n\n        alias =\n            Result.withDefault "" (D.decodeValue (D.field "endpoint" D.string) v) |> String.split "." |> List.head |> Maybe.withDefault ""\n\n        config =\n            case alias of\n${th.map((t) => `                ${q(t.alias)} ->\n                    J.object [ ${t.state.map((x) => `( ${q(x.param)}, ${elmEncoder(app, x.type, `th.${t.alias}.${x.param}`)} )`).join(", ")} ]\n`).join("\n")}\n                _ ->\n                    J.null\n    in\n    J.object [ ( "endpoint", D.decodeValue (D.field "endpoint" D.value) v |> Result.withDefault J.null ), ( "args", D.decodeValue (D.field "args" D.value) v |> Result.withDefault J.null ), ( "config", config ) ]\n\n\n`);
    out.push(`{-| The client layers' config from the app's state, for the event streams. -}\nencodeThrough : Through -> J.Value\nencodeThrough th =\n    J.object [ ${th.map((t) => `( ${q(t.alias)}, J.object [ ${t.state.map((x) => `( ${q(x.param)}, ${elmEncoder(app, x.type, `th.${t.alias}.${x.param}`)} )`).join(", ")} ] )`).join(", ")} ]\n\n\n`);
  }
  const callCases = [
    ...eps.map((c) => {
      const args = c.ep.params.map((p) => `( ${q(p.name)}, ${elmEncoder(app, p.type, `a.${p.name}`)} )`);
      return `        ${c.tag}${c.ep.params.length ? " a" : ""} ->\n            J.object [ ( "endpoint", J.string ${q(c.name)} ), ( "args", J.object [ ${args.join(", ")} ] ) ]\n`;
    }),
    ...undos.map((u) => {
      const args = u.args.map((a) => {
        const v = a.from === "answer" ? ["u.answer", ...a.path].join(".") : `u.${a.path[0]}`;
        return `( ${q(a.name)}, ${elmEncoder(app, a.type, v)} )`;
      });
      return `        ${u.tag} u ->\n            J.object [ ( "endpoint", J.string ${q(`${u.of.alias}.${u.by.name}`)} ), ( "args", J.object [ ${args.join(", ")} ] ) ]\n`;
    }),
  ];
  out.push(`callToJson : Call -> J.Value\ncallToJson c =\n    case c of\n${callCases.join("\n")}\n\n`);
  out.push(`{-| An answer from the outside (\`{ endpoint, status, body }\` or \`{ endpoint, status: 0, error }\`) as a message. -}\nfromAnswer : D.Value -> Maybe Msg\nfromAnswer v =\n    let\n        endpoint =\n            Result.withDefault "" (D.decodeValue (D.field "endpoint" D.string) v)\n\n        status =\n            Result.withDefault 0 (D.decodeValue (D.field "status" D.int) v)\n\n        failure =\n            Result.withDefault ("unexpected answer " ++ String.fromInt status) (D.decodeValue (D.field "error" D.string) v)\n\n        unknown =\n            Result.withDefault False (D.decodeValue (D.field "unknown" D.bool) v)\n\n        body d ok bad =\n            case D.decodeValue (D.field "body" d) v of\n                Ok x ->\n                    ok x\n\n                Err e ->\n                    bad (endpoint ++ " answered " ++ String.fromInt status ++ ", but the body does not fit: " ++ D.errorToString e)\n    in\n    case endpoint of\n${eps
    .map((c) => {
      const cases = (c.ep.answers ?? []).map((a) => `                        ${a.status} ->\n                            ${a.type ? `body ${elmDecoder(app, a.type)} ${c.tag}${a.status} ${c.tag}Failed` : `${c.tag}${a.status}`}\n`);
      // The same message TypeScript's `conforms` gives: an answer the contract does not declare.
      const statuses = (c.ep.answers ?? []).map((a) => a.status).join(", ");
      const fallback = `${c.tag}Failed (if status == 0 then failure else endpoint ++ " answered " ++ String.fromInt status ++ ", which the contract does not declare (${statuses})")`;
      const byStatus = `(case status of\n${cases.join("\n")}\n                        _ ->\n                            ${fallback}\n                    )`;
      return `        ${q(c.name)} ->\n            Just\n                (${c.tag}Answered\n                    ${c.ep.effect ? `(if unknown then\n                        ${c.tag}Unknown failure\n\n                     else\n                        ${byStatus.replace(/\n/g, "\n    ")}\n                    )` : byStatus}\n                )\n`;
    })
    .join("\n")}\n        _ ->\n            Nothing\n`);
  const evs = clientEvents(app);
  out.push(`\n\n{-| An event from the api (\`{ event: "tickets.ticketCreated", body }\`) as a message; one whose payload does not fit is dropped. -}\nfromEvent : D.Value -> Maybe Msg\nfromEvent v =\n    case D.decodeValue (D.field "event" D.string) v of\n${evs.map((e) => `        Ok ${q(e.name)} ->\n            Result.toMaybe (D.decodeValue (D.field "body" (D.map ${e.tag} ${elmDecoder(app, e.type)})) v)\n`).join("\n")}${evs.length ? "\n" : ""}        _ ->\n            Nothing\n`);
  return out.join("");
}

export const elmAnswerMsgs = (app: App) => [...clientEndpoints(app).map((c) => `${c.tag}Answered ${c.tag}Answer`), ...clientEvents(app).map((e) => `${e.tag} ${elmAtom(e.type)}`)];

const elmEncode = elmEncoder;

/**
 * Apps with several screens: the module the entries use instead of App. The harness keeps where
 * the app is (the route) and turns the app's `Go` into an address; the app only says where to go.
 */
export function genElmNav(app: App): string {
  const calls = hasClients(app);
  const c = usesClock(app);
  const ck = c ? "clock " : "";
  const exposing = ["Model", "init", "update", "view", "settled", ...(hasData(app) ? ["data"] : []), ...(hasStored(app) ? ["restore"] : []), ...(hasThrough(app) ? ["through"] : [])];
  return `module AppNav exposing (${exposing.join(", ")})

{-| Generated from ${app.name}.intent — do not edit. The screens around the app module: the route is
the harness's (the address after #); the app says where to go (\`Go\`), the harness goes there.
-}

import App as Inner
import Spec exposing (..)


{-| The app's model, where it is, and the address to show next (after \`go to\` or \`go back\`). -}
type alias Model =
    { inner : Inner.Model, route : Route, go : Maybe String }


start : Route
start =
    routeFromPath "/"


init : ${c ? "Clock -> " : ""}${calls ? "( Model, List Call )" : "Model"}
init ${ck}=
${calls ? `    let
        ( m, cs ) =
            Inner.init ${ck}
    in
    ( { inner = m, route = start, go = Nothing }, cs )` : `    { inner = Inner.init ${ck}, route = start, go = Nothing }`}


update : ${c ? "Clock -> " : ""}Msg -> Model -> ${calls ? "( Model, List Call )" : "Model"}
update ${ck}msg m =
    let
        route =
            case msg of
                ScreenOpened r ->
                    r

                _ ->
                    m.route

        ${calls ? "( inner, cs, go )" : "( inner, go )"} =
            Inner.update ${ck}route msg m.inner
    in
    ${calls ? "( { inner = inner, route = route, go = address go }, cs )" : "{ inner = inner, route = route, go = address go }"}


address : Go -> Maybe String
address go =
    case go of
        Stay ->
            Nothing

        GoTo r ->
            Just (pathOf r)

        GoBack ->
            Just "back"


view : ${c ? "Clock -> " : ""}Model -> Screen
view ${ck}m =
    Inner.view ${ck}m.route m.inner


{-| The model with its next address taken (the entry shows it). -}
settled : Model -> Model
settled m =
    { m | go = Nothing }
${hasData(app) ? `

data : Model -> Data
data m =
    Inner.data m.inner
` : ""}${hasStored(app) ? `

restore : Stored -> Model -> Model
restore saved m =
    { m | inner = Inner.restore saved m.inner }
` : ""}${hasThrough(app) ? `

through : Model -> Through
through m =
    Inner.through m.inner
` : ""}`;
}

/** The browser entry of an app with several screens: the address comes in (`navigate`), `go` goes out (`goTo`). */
function withScreens(main: string): string {
  const one = (text: string, from: string, to: string) => {
    if (text.split(from).length !== 2) throw new Error(`screens: Main.elm has no single \`${from.trim()}\``);
    return text.replace(from, to);
  };
  let m = one(main, "\nimport App\n", "\nimport AppNav as App\n");
  m = one(m, "\n\ntype In\n    = FromUi Ui.Wire", "\n\nport navigate : (String -> msg) -> Sub msg\n\n\nport goTo : String -> Cmd msg\n\n\ntype In\n    = FromUi Ui.Wire\n    | FromNav String");
  m = one(m, "                            FromUi w ->\n                                Spec.fromWire w\n", "                            FromUi w ->\n                                Spec.fromWire w\n\n                            FromNav path ->\n                                Spec.fromWire { on = \"navigate\", target = path, key = \"\", text = \"\", value = \"\" }\n");
  // The update becomes `step`; after it, an address the app asked for goes out.
  const head = "        , update =\n            \\i model ->\n";
  const a = m.indexOf(head);
  const b = m.indexOf("        , view =");
  if (a < 0 || b < 0) throw new Error("screens: Main.elm has no update to wrap");
  const body = m.slice(a + head.length, b);
  m = m.slice(0, a) + "        , update = \\i model -> withNav (step i model)\n" + m.slice(b);
  m = one(m, "        , subscriptions = \\_ -> Sub.batch [ ", "        , subscriptions = \\_ -> Sub.batch [ navigate FromNav, ").replace("[ navigate FromNav,  ]", "[ navigate FromNav ]");
  m = m.replace(/\s*$/, "") + `


step : In -> Model -> ( Model, Cmd In )
step i model =
${body.trimEnd()}


withNav : ( Model, Cmd In ) -> ( Model, Cmd In )
withNav ( model, cmd ) =
    case model.app.go of
        Just path ->
            ( { model | app = App.settled model.app }, Cmd.batch [ cmd, goTo path ] )

        Nothing ->
            ( model, cmd )
`;
  return m;
}

/** The build directory of an Elm app: the runtime, the generated interface and the entries. */
export function scaffoldElm(app: App, dir: string, layerDirs: Record<string, string> = {}): { appFile: string; specSource: string } {
  mkdirSync(join(dir, "src"), { recursive: true });
  copyFileSync(join(ROOT, "runtime/elm/elm.json"), join(dir, "elm.json"));
  copyFileSync(join(ROOT, "runtime/elm/Ui.elm"), join(dir, "src/Ui.elm"));
  copyFileSync(join(ROOT, "runtime/elm/Fmt.elm"), join(dir, "src/Fmt.elm"));
  const spec = genElmSpec(app);
  writeFileSync(join(dir, "src/Spec.elm"), spec);
  if (!hasClients(app) && !usesClock(app) && !hasStored(app) && !hasScreens(app) && hasInvariants(app)) {
    // Checks in `always` need the data from the test worker; the browser entry stays plain.
    writeFileSync(join(dir, "src/Main.elm"), genElmMain(app));
    writeFileSync(join(dir, "src/Worker.elm"), elmWorkerPorts(app));
    writeFileSync(join(dir, "index.html"), html(app.name, `<script src="main.js"></script><script>Elm.Main.init({ node: document.getElementById("app") })</script>`, true));
  } else if (hasClients(app) || usesClock(app) || hasStored(app) || hasScreens(app)) {
    writeFileSync(join(dir, "src/Main.elm"), hasScreens(app) ? withScreens(genElmMainPorts(app)) : genElmMainPorts(app));
    if (hasScreens(app)) writeFileSync(join(dir, "src/AppNav.elm"), genElmNav(app));
    for (const f of ["store.ts", "api.ts", "fmt.ts"]) copyFileSync(join(ROOT, "runtime/ts", f), join(dir, f));
    writeFileSync(join(dir, "src/Worker.elm"), hasScreens(app) ? elmWorkerPorts(app).replace("\nimport App\n", "\nimport AppNav as App\n") : elmWorkerPorts(app));
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
${hasScreens(app) ? `  // Several screens: the address after # is where the app is; the app's \\\`go to\\\` / \\\`go back\\\` change it.
  const address = () => decodeURI(location.hash.slice(1)) || "/";
  app.ports.goTo.subscribe((p: string) => (p === "back" ? history.back() : (location.hash = p)));
  window.addEventListener("hashchange", () => app.ports.navigate.send(address()));
  app.ports.navigate.send(address());
` : ""}  if (!app.ports.request) return;
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
}

// ---------------------------------------------------------------- the target module

async function compileElm(dir: string): Promise<string> {
  const w = await run(bin("elm"), ["make", "src/Worker.elm", "--optimize", "--output=worker.js"], dir);
  if (!w.ok) return clean(w.out);
  copyFileSync(join(dir, "worker.js"), join(dir, "worker.cjs"));
  const m = await run(bin("elm"), ["make", "src/Main.elm", "--optimize", "--output=main.js"], dir);
  if (!m.ok) return clean(m.out);
  if (existsSync(join(dir, "through.ts"))) {
    // The client layers, for the test driver.
    const t = await run(bin("esbuild"), ["through.ts", "--bundle", "--format=esm", "--platform=node", "--outfile=through.mjs", "--log-level=error"], dir);
    if (!t.ok) return clean(t.out);
  }
  if (existsSync(join(dir, "glue.ts"))) {
    // Apps that make calls: the fetch glue for the browser.
    const g = await run(bin("esbuild"), ["glue.ts", "--bundle", "--format=iife", "--outfile=glue.js", "--log-level=error"], dir);
    if (!g.ok) return clean(g.out);
  }
  return "";
}

async function compileStyledElm(dir: string): Promise<string> {
  const m = await run(bin("elm"), ["make", "src/Main.elm", "--optimize", "--output=main.js"], dir);
  return m.ok ? "" : clean(m.out);
}

async function openElm(dir: string, clock?: { now: string; today: string }): Promise<Session> {
  const require = createRequire(import.meta.url);
  const { Elm } = require(join(dir, "worker.cjs"));
  // A worker that takes flags (the clock, or nothing) says so in its type.
  const takesFlags = readFileSync(join(dir, "src/Worker.elm"), "utf8").includes("Program D.Value");
  const app = takesFlags ? Elm.Worker.init({ flags: clock ?? null }) : Elm.Worker.init();
  let last: any;
  let made: CallOut[] = [];
  let through: Record<string, Record<string, unknown>> = {};
  let data: unknown;
  let go: string | null = null;
  let waiting: ((v: any) => void) | undefined;
  app.ports.observe.subscribe((v: any) => {
    // Apps that make calls observe { screen, calls }.
    if (v && v.screen) {
      made.push(...(v.calls ?? []));
      if (v.data !== undefined) data = v.data;
      if (v.through) through = v.through;
      if (v.go) go = v.go;
      v = v.screen;
    }
    last = v;
    waiting?.(v);
  });
  // Elm delivers port messages asynchronously: wait for the observation that answers this event.
  const deliver = (w: object) =>
    new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error("Elm worker produced no observation within 5s")), 5000);
      waiting = () => {
        clearTimeout(timer);
        waiting = undefined;
        resolve();
      };
      try {
        app.ports.act.send(w);
      } catch (e) {
        clearTimeout(timer);
        reject(e);
      }
    });
  await deliver({ on: "noop" });
  return {
    observe: async () => last,
    send: deliver,
    calls: async () => {
      const out = made;
      made = [];
      return out;
    },
    through: async () => through,
    data: async () => data,
    nav: async () => {
      const g = go;
      go = null;
      return g;
    },
  };
}

export const elmTarget: TargetModule = {
  name: "elm",
  appFile: "src/App.elm",
  specFile: "src/Spec.elm",
  fence: "elm",
  scaffold: scaffoldElm,
  compile: compileElm,
  compileStyled: compileStyledElm,
  prompt: {
    rules: `Target: Elm 0.19. You write \`src/App.elm\`.
- Available: elm/core (List, String, Dict, Set, Array, Maybe, Char, Tuple, Basics), the generated \`Spec\` module, and \`Fmt\`. Nothing else: no other packages, no ports, no Debug.
- \`import Spec exposing (..)\` and \`import Fmt\`. Import core modules you use (Dict, Set, Array) explicitly.
- The module must expose exactly (Model, init, update, view) with these signatures:`,
    fmt: `Fmt.fixed : Int -> Float -> String      -- exactly n decimals, half away from zero: fixed 2 1.005 == "1.01"
Fmt.decimal : Int -> Float -> String    -- at most n decimals, trailing zeros removed: decimal 8 (0.1 + 0.2) == "0.3"
Fmt.money : Float -> String             -- fixed 2
Fmt.int : Int -> String                 -- plain digits
Fmt.clock : Int -> String               -- seconds as "m:ss" (or "h:mm:ss"): clock 1500 == "25:00"
Fmt.parseDecimal : String -> Maybe Float -- "-?digits([.,]digits)?", spaces trimmed
Fmt.parseInt : String -> Maybe Int
Fmt.roundTo : Int -> Float -> Float     -- round to n decimals, half away from zero
Fmt.roundUpTo : Int -> Float -> Float   -- round up (towards +infinity) to n decimals
Fmt.roundDownTo : Int -> Float -> Float -- round down (towards -infinity) to n decimals
Fmt.cents : Float -> Int                -- whole cents, half away from zero: cents 12.345 == 1235
-- Dates ("YYYY-MM-DD") and moments ("YYYY-MM-DDTHH:MM") are Strings; compare and sort them as text.
Fmt.addDays : Date -> Int -> Date               -- addDays "2026-02-27" 2 == "2026-03-01"
Fmt.daysBetween : Date -> Date -> Int            -- daysBetween "2026-09-24" "2026-10-01" == 7
Fmt.weekday : Date -> String                     -- weekday "2026-09-24" == "Thursday"
Fmt.dateOf : DateTime -> Date                    -- dateOf "2026-09-24T09:30" == "2026-09-24"
Fmt.timeOf : DateTime -> String                  -- timeOf "2026-09-24T09:30" == "09:30"
Fmt.addMinutes : DateTime -> Int -> DateTime     -- addMinutes "2026-09-24T23:50" 15 == "2026-09-25T00:05"
Fmt.minutesBetween : DateTime -> DateTime -> Int
Fmt.formatDate : Date -> String                  -- formatDate "2026-09-04" == "4 Sep 2026"
Fmt.formatDateTime : DateTime -> String          -- formatDateTime "2026-09-04T09:05" == "4 Sep 2026 09:05"
Fmt.parseDate : String -> Maybe Date             -- only a date that exists
Fmt.parseDateTime : String -> Maybe DateTime     -- "YYYY-MM-DD HH:MM" or "YYYY-MM-DDTHH:MM"`,
    skeleton: (calls, through) => (calls ? (through ? ELM_APP_SKELETON_CALLS.replace("exposing (Model, init, update, view)", "exposing (Model, init, through, update, view)") + ELM_APP_SKELETON_THROUGH : ELM_APP_SKELETON_CALLS) : ELM_APP_SKELETON),
    calls: `Calls (this app uses an API):
- \`init\` and \`update\` also return the calls to make, in the order the steps say: \`( model, [ TicketsCreateTicket { subject = …, customer = …, priority = … } ] )\`. No step says "call": return \`[]\`.
- \`on start\`: the calls \`init\` returns. \`on answer tickets.createTicket\`: the message \`TicketsCreateTicketAnswered answer\`; the answer has one variant per status the contract declares (\`TicketsCreateTicket201 ticket\`, \`TicketsCreateTicket400 problem\`) plus \`TicketsCreateTicketFailed reason\`.
- "if its status is 201" matches that variant; "its body" is the value it carries. "otherwise" covers every other variant, Failed included.
- To take an effect back (\`undo @pay.charge\`): the call is \`PayChargeUndo { answer = <the answer the original call got> }\`, with the original params too when the undo's binding reads them. The reply is the \`…Answered\` message of the endpoint the contract names in \`undone by\`.
- Every argument of a call is given; an absent optional one is \`Nothing\`.`,
    through: "- `through : Model -> Through` (exposed too): for each api with a client layer, the params bound to state under `through` in the spec, read from the model. The harness adds the config to every call and to the api's event stream.",
    clock: `Clock (this app reads @now or @today): \`init\`, \`update\` and \`view\` take the clock as their FIRST argument: \`init : Clock -> …\`, \`update : Clock -> Msg -> Model -> …\`, \`view : Clock -> Model -> Screen\`. \`@now\` is \`clock.now\` (a DateTime), \`@today\` is \`clock.today\` (a Date). Compute with the Fmt date helpers; never store the clock in the model unless the spec says to remember a moment.`,
    data: "Data (this spec has sentences in `always`): also expose `data : Model -> Data` (the `Data` record in Spec: every state field, with the value the model holds now). The harness checks the `always` sentences on it after every step; keep it exact, never computed differently from the model.",
    screens: "Screens (this spec has several): `update` and `view` also get where the app is, a `Route` (in Spec: `TicketRoute { id }` for `screen ticket`; `@id` is that field), right before the message or model: `update : Route -> Msg -> Model -> ( Model, Go )` (with calls: `( Model, List Call, Go )`), `view : Route -> Model -> Screen`, which returns the current screen's variant (`TicketScreen { … }`). `Go` is `GoTo (TicketRoute { id = … })` for a `go to` step, `GoBack` for `go back`, or `Stay`. When a screen is shown (a link, an address, going back), the harness sends `ScreenOpened route`: do what `on open <that screen>` says, and nothing for a screen without one. The route is the harness's: never keep a copy in the model. With a clock, it comes first: `update : Clock -> Route -> Msg -> Model -> …`, `view : Clock -> Route -> Model -> Screen`.",
    stored: "Stored state (this spec has `stored` fields): also expose `data : Model -> Data` and `restore : Stored -> Model -> Model`. `restore saved model` gets a freshly started model and puts the saved values of the stored fields into it; everything else stays as it starts. Anything the model keeps that depends on stored fields (a next id, a cache) must be brought in line with the restored values. The harness saves `data` after every update and restores it when the app starts again.",
  },
  open: openElm,
};
