// Target: Elm 0.19. The generated interface (src/Spec.elm), the entries (browser, test worker, the
// JavaScript glue for calls, the clock and stored state), what the prompt says about Elm, the
// toolchain, and a test session on a compiled build.
import { copyFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { join } from "node:path";
import type { App, Element, Literal, Type } from "../ast.ts";
import { usesClock } from "../refs.ts";
import { buildSites, usesDraws, type DrawSite } from "../draws.ts";
import { codeSize } from "../alphabets.ts";
import { LINE_BASE } from "../ast.ts";
import { callDescs, clientEndpoints, clientEvents, eventsByAlias, eventWireTypes, gated, hasClients, hasThrough, throughs, undoables } from "../calls.ts";
import { mangle, cap, cellFor, copyDrawRuntime, dataField, hasCodes, events, nestedLists, refLookups, hasData, hasHomes, hasInvariants, hasScreens, hasStored, html, startsAfterRestore, ident, lowerFirst, elmQ as q, doc, copyCallsRuntime, ROOT, rowKeyed, selectChoice, storedDefaults, storedTypes, typeName, writeThrough, type TableLit } from "./shared.ts";
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
    case "value": return mangle(l.v);
    case "date": return q(l.v);
    case "dateTime": return q(l.v);
    case "table": return "[]";
    case "list": case "record": throw new Error("a list or record value needs its type: elmValue");
  }
}

/** A literal of a type: a row's inner list in a seed table, each record with its defaults filled in. */
export function elmValue(app: App, l: Literal, t: Type): string {
  const inner = t.k === "Maybe" ? t.of : t;
  const wrap = (v: string) => (t.k === "Maybe" ? `Just (${v})` : v);
  if (l.k === "list" && inner.k === "List") return wrap(l.items.length ? `[ ${l.items.map((x) => elmValue(app, x, inner.of)).join(", ")} ]` : "[]");
  if (l.k === "record" && inner.k === "Named") {
    const rec = app.records.find((r) => r.name === inner.name);
    if (rec) return wrap(`{ ${rec.fields.map((f) => `${mangle(f.name)} = ${elmValue(app, l.fields.find((x) => x.name === f.name)?.value ?? f.default ?? { k: "nothing" }, f.type)}`).join(", ")} }`);
  }
  return elmLiteral(l, t);
}

/** The app's data as the checks see it: every state field, typed as in the spec. */
function genElmData(app: App): string {
  const stored = app.state.filter((f) => f.stored);
  const storedPart = stored.length
    ? `{-| The state that survives a restart (\`stored\` in the spec). \`restore saved model\` in the app module puts it into a freshly started model. -}
type alias Stored =
    { ${stored.map((f) => `${mangle(dataField(f.name))} : ${elmType(f.type)}`).join("\n    , ")}
    }


decodeStored : D.Decoder Stored
decodeStored =
    D.succeed Stored
${stored.map((f) => `        |> jsonAndMap (D.field ${q(dataField(f.name))} ${elmDecoder(app, f.type)})`).join("\n")}


`
    : "";
  return `${storedPart}{-| The app's data${hasInvariants(app) ? ", for the checks in \`always\`" : ""}${stored.length ? `${hasInvariants(app) ? " and" : ","} to save what is stored` : ""}: every state field, as in the spec. \`data\` in the app module fills it. -}
type alias Data =
    { ${app.state.map((f) => `${mangle(dataField(f.name))} : ${elmType(f.type)}`).join("\n    , ")}
    }


encodeData : Data -> J.Value
encodeData d =
    J.object
        [ ${app.state.map((f) => `( ${q(dataField(f.name))}, ${elmEncode(app, f.type, `d.${mangle(dataField(f.name))}`)} )`).join("\n        , ")}
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
    case "Named": return mangle(t.name);
    case "Ref": return t.key ? elmType(t.key) : "Int";
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

${hasClients(app) || hasData(app) ? "import Json.Decode as D\nimport Json.Encode as J\n" : ""}${app.platforms?.some((p) => p.name === "std.crypto") ? "import Crypto\n" : ""}${usesDraws(app) || hasCodes(app) ? "import Draw\n" : ""}import Ui${hasScreens(app) ? "\nimport Url" : ""}
${(app.refined ?? []).some((r) => r.pattern !== undefined) ? "import Regex\n" : ""}
`);
  if (app.platforms?.some((p) => p.name === "std.crypto")) out.push(`{-| Platform std.crypto: SHA-256, from the installation's reviewed code (never a home-made version). -}\nsha256 : String -> String\nsha256 =\n    Crypto.sha256\n\n\n`);
  out.push(`{-| A day, "YYYY-MM-DD", and a moment to the minute, "YYYY-MM-DDTHH:MM" (local time). Compare and sort them as text; compute with Fmt. -}\ntype alias Date =\n    String\n\n\ntype alias DateTime =\n    String\n\n\n{-| The clock: @now and @today in the spec${app.sizes ? ", and @size: the size the host shows the app at" : ""}. -}\ntype alias Clock =\n    { now : DateTime, today : Date${app.sizes ? ", size : Size" : ""} }\n\n\n`);
  for (const r of app.refined ?? []) {
    if (r.code) {
      // A code: exactly n characters of its alphabet, read as the alphabet says (the harness's reader, Draw.readCode).
      const unamb = r.code.alphabet === "unambiguous letters and digits";
      out.push(`{-| A code: ${r.code.n} characters from ${doc(q(r.code.chars))} (${codeSize(r.code.n, r.code.chars)}): see is${r.name} and read${r.name}. -}\ntype alias ${mangle(r.name)} =\n    String\n\n\n{-| Whether a text is a valid ${r.name}${unamb ? " (read forgivingly: lower case, o for 0, i and l for 1, hyphens ignored)" : ""}. -}\nis${r.name} : String -> Bool\nis${r.name} s =\n    read${r.name} s /= Nothing\n\n\n{-| The ${r.name} a text is, in its normal form${unamb ? ' (capitals: "k7mq-or1z" is "K7MQ0R1Z")' : ""}, or Nothing when it is not one. Keep this form, never the text as typed. -}\nread${r.name} : String -> Maybe ${mangle(r.name)}\nread${r.name} =\n    Draw.readCode ${r.code.n} ${q(r.code.chars)} ${unamb ? "True" : "False"}\n\n\n`);
      continue;
    }
    // A refined type is its base type plus a generated check: `isEmail : String -> Bool`.
    const lc = lowerFirst(r.name);
    const base = r.base === "Text" ? "String" : r.base === "Int" ? "Int" : "Float";
    out.push(`type alias ${mangle(r.name)} =\n    ${base}\n\n`);
    if (r.pattern !== undefined)
      out.push(`${lc}Pattern : Regex.Regex\n${lc}Pattern =\n    Maybe.withDefault Regex.never (Regex.fromString ${q(`^(?:${r.pattern})$`)})\n\n\n{-| Whether a text is a valid ${r.name}. -}\nis${r.name} : String -> Bool\nis${r.name} s =\n    Regex.contains ${lc}Pattern s\n\n`);
    else if (r.base === "Text") {
      // Characters as code points (String.toList), the same count as TypeScript's [...s].length.
      const conds = [r.minLength !== undefined ? `n >= ${r.minLength}` : "", r.maxLength !== undefined ? `n <= ${r.maxLength}` : ""].filter(Boolean).join(" && ");
      out.push(`{-| Whether a text is a valid ${r.name}: its length in characters. -}\nis${r.name} : String -> Bool\nis${r.name} s =\n    let\n        n =\n            List.length (String.toList s)\n    in\n    ${conds || "True"}\n\n`);
    } else {
      const conds = [r.min !== undefined ? `n >= ${r.min}` : "", r.max !== undefined ? `n <= ${r.max}` : ""].filter(Boolean).join(" && ");
      out.push(`{-| Whether a number is a valid ${r.name}. -}\nis${r.name} : ${base} -> Bool\nis${r.name} n =\n    ${conds || "True"}\n\n`);
    }
  }
  // A record named like a type Elm's Basics always exposes (`Order`) is ambiguous in App.elm unless qualified.
  for (const r of app.records) out.push((["Order", "Never"].includes(r.name) ? `{-| Elm's Basics also has an \`${r.name}\`: in App.elm write this record's type as \`Spec.${r.name}\`. -}\n` : "") + elmRecord(mangle(r.name), r.fields.map((f) => [mangle(f.name), elmType(f.type)])) + "\n");
  // Following a reference: the row is found in its home list when it is read (Nothing: it is gone).
  const refs = refLookups(app);
  for (const b of refs.byKey) out.push(`{-| Following a \`ref ${b.record}\`: the ${b.record} in \`${b.list}\` whose \`${b.key}\` is the key, or Nothing when there is none (it was removed). -}\n${b.fn} : List ${mangle(b.record)} -> ${elmType(b.keyType)} -> Maybe ${mangle(b.record)}\n${b.fn} rows k =\n    List.head (List.filter (\\r -> r.${mangle(b.key)} == k) rows)\n\n\n`);
  for (const f of refs.fields) out.push(`{-| \`its @${f.field}'s …\` on a ${f.holder}: the ${f.record} it points at, in \`${f.list}\`; Nothing when there is none. -}\n${f.fn} : List ${mangle(f.record)} -> ${mangle(f.holder)} -> Maybe ${mangle(f.record)}\n${f.fn} rows row =\n    ${f.optional ? `Maybe.andThen (${f.byKey} rows) row.${mangle(f.field)}` : `${f.byKey} rows row.${mangle(f.field)}`}\n\n\n`);
  for (const c of app.choices) {
    const lc = lowerFirst(c.name);
    const C = mangle(c.name);
    out.push(`type ${C}\n    = ${c.values.map(mangle).join("\n    | ")}\n\n`);
    out.push(`${lc}Values : List ${C}\n${lc}Values =\n    [ ${c.values.map(mangle).join(", ")} ]\n\n`);
    out.push(`${lc}ToString : ${C} -> String\n${lc}ToString v =\n    case v of\n${c.values.map((v) => `        ${mangle(v)} ->\n            ${q(v)}\n`).join("\n")}\n`);
    out.push(`{-| The text users see for a value. -}\n${lc}Label : ${C} -> String\n${lc}Label v =\n    case v of\n${c.values.map((v) => `        ${mangle(v)} ->\n            ${q(c.labels[v])}\n`).join("\n")}\n`);
    out.push(`${lc}FromString : String -> Maybe ${C}\n${lc}FromString s =\n    case s of\n${c.values.map((v) => `        ${q(v)} ->\n            Just ${mangle(v)}\n`).join("\n")}\n        _ ->\n            Nothing\n\n`);
  }

  for (const f of app.state)
    if (f.default?.k === "table") {
      const rec = app.records.find((r) => f.type.k === "List" && f.type.of.k === "Named" && r.name === f.type.of.name)!;
      out.push(`{-| Initial value of state \`${f.name}\` (the table in the spec). -}\n${f.name}Initial : List ${mangle(rec.name)}\n${f.name}Initial =\n    [ ${f.default.rows.map((row) => `{ ${rec.fields.map((rf) => `${mangle(rf.name)} = ${elmValue(app, cellFor(f.default as TableLit, row, rf.name) ?? rf.default ?? { k: "nothing" }, rf.type)}`).join(", ")} }`).join("\n    , ")}\n    ]\n\n`);
    }
  out.push(elmNested(app));
  out.push(elmDraws(app));

  // Events
  const evs = events(app);
  // A row inside a row carries two keys: the outer row's, then its own.
  const keyArgs = (p?: string) => (p?.startsWith("keys") ? " String String" : p?.startsWith("key") ? " String" : "");
  const msgMembers = [...evs
    .map((e) => e.tag + keyArgs(e.payload) + (e.payload?.endsWith("value") ? ` ${mangle(e.choice!)}` : e.payload?.endsWith("text") || e.payload?.endsWith("pick") ? " String" : "")), ...elmAnswerMsgs(app), ...(hasScreens(app) ? ["ScreenOpened Route"] : []), ...(startsAfterRestore(app) ? ["Started"] : [])];
  // A screen with nothing to click, type or choose: Elm has no empty type, so one no-op variant.
  out.push(`{-| Everything the user (or the clock) can do${hasClients(app) ? ", and the answers to calls" : ""}. -}\ntype Msg\n    = ${msgMembers.length ? msgMembers.join("\n    | ") : "NoOp"}\n\n`);
  out.push(`{-| Row events carry the row's key (the \`key\` you gave that row in \`view\`).${nestedLists(app).length ? " A row inside a row carries its outer row's key first, then its own: find the inner row with the generated `update…` / `removeFrom…` helpers above, never by hand." : ""} Typed events carry the full new text of the field. -}\n\n`);

  // Screen types
  out.push(`type alias Button =\n    { enabled : Bool }\n\n`);
  out.push(`type alias LabeledButton =\n    { label : String, enabled : Bool }\n\n`);
  out.push(`{-| A select whose options come from the model: the option texts in order, and the selected one (Nothing: none is chosen). -}\ntype alias Pick =\n    { options : List String, selected : Maybe String }\n\n`);
  const aliases: string[] = [];
  const fieldType = (el: Element, list?: Element): string => {
    let t: string;
    switch (el.kind) {
      case "text":
      case "field": t = "String"; break;
      case "button": t = el.expr ? "LabeledButton" : "Button"; break;
      case "checkbox": t = "Bool"; break;
      case "progress": t = "Int"; break;
      case "select": t = el.from ? "Pick" : mangle(selectChoice(app, el, list)); break;
      case "list": {
        // A list inside a row: its row type is named after both lists (`TasksItemsRow`).
        const row = `${list ? typeName(list.name) : ""}${typeName(el.name)}Row`;
        t = `List ${row}`;
        aliases.push(elmRecord(row, [["key", "String"], ...rowFields(el.children, el)]));
        break;
      }
      case "section": t = `${typeName(el.name)}Section`; aliases.push(elmRecord(`${typeName(el.name)}Section`, rowFields(el.children, list))); break;
      default: t = "";
    }
    return el.visibleWhen ? `Maybe ${t.includes(" ") ? `(${t})` : t}` : t;
  };
  const rowFields = (els: Element[], list?: Element): [string, string][] => els.filter((e) => e.kind !== "heading").map((e) => [mangle(ident(e.name)), fieldType(e, list)]);
  if (hasScreens(app)) {
    const scs = app.screens!;
    const rec = (fields: [string, string][]) => (fields.length ? `{ ${fields.map(([n, t]) => `${n} : ${t}`).join(", ")} }` : "{}");
    out.push(`{-| Where the app is: one variant per screen, with its path params. The harness keeps it (the address after #). -}\ntype Route\n    = ${scs.map((s) => `${cap(s.name)}Route${s.params.length ? ` ${rec(s.params.map((p) => [mangle(p.name), elmType(p.type)]))}` : ""}`).join("\n    | ")}\n\n\n`);
    out.push(`{-| Where to go after an update: \`go to\` a screen, \`go back\`, or stay. -}\ntype Go\n    = Stay\n    | GoTo Route\n    | GoBack\n\n\n`);
    out.push(`{-| What \`view\` returns: the current screen, with one field per dynamic element on it. -}\ntype Screen\n    = ${scs.map((s) => `${cap(s.name)}Screen ${rec(rowFields(app.screen.filter((e) => e.screen === s.name)))}`).join("\n    | ")}\n\n\n`);
    // Addresses ↔ routes: the harness's. An address that fits no screen is the first screen.
    const first = `${cap(scs[0].name)}Route${scs[0].params.length ? ` { ${scs[0].params.map((p) => `${mangle(p.name)} = ${p.type.k === "Int" ? "0" : '""'}`).join(", ")} }` : ""}`;
    const branch = (s: (typeof scs)[number]): string => {
      const segs = s.path.split("/").filter(Boolean);
      const pat = `[ ${segs.map((g, i) => (/^\{[a-z]\w*\}$/i.test(g) ? `a${i}` : q(g))).join(", ")} ]`.replace("[  ]", "[]");
      const holes = segs.flatMap((g, i) => (/^\{([a-z]\w*)\}$/i.test(g) ? [{ name: g.slice(1, -1), v: `a${i}` }] : []));
      // Each param read in turn; one that does not fit makes it the first screen.
      let body = `${cap(s.name)}Route${holes.length ? ` { ${holes.map((h) => `${mangle(h.name)} = ${mangle(h.name)}`).join(", ")} }` : ""}`;
      for (const h of [...holes].reverse()) {
        const p = s.params.find((x) => x.name === h.name)!;
        const read = p.type.k === "Int" ? `String.toInt ${h.v}` : `Url.percentDecode ${h.v}`;
        body = `case ${read} of\n                Just ${mangle(h.name)} ->\n                    ${body.replace(/\n/g, "\n        ")}\n\n                Nothing ->\n                    ${first}`;
      }
      return `        ${pat} ->\n            ${body}\n`;
    };
    out.push(`{-| The route an address shows ("/tickets/3"); an address that fits no screen shows the first. -}\nrouteFromPath : String -> Route\nrouteFromPath path =\n    case List.filter (\\s -> s /= "") (String.split "/" (Maybe.withDefault "" (List.head (String.split "?" path)))) of\n${scs.map(branch).join("\n")}\n        _ ->\n            ${first}\n\n\n`);
    out.push(`{-| The address of a route. -}\npathOf : Route -> String\npathOf r =\n    case r of\n${scs
      .map((s) => `        ${cap(s.name)}Route${s.params.length ? " p" : ""} ->\n            ${s.path.split(/(\{[a-z]\w*\})/i).filter((x) => x !== "").map((x) => {
        const h = x.match(/^\{([a-z]\w*)\}$/i);
        if (!h) return q(x);
        const p = s.params.find((y) => y.name === h[1])!;
        return p.type.k === "Int" ? `String.fromInt p.${mangle(h[1])}` : `Url.percentEncode p.${mangle(h[1])}`;
      }).join(" ++ ")}\n`)
      .join("\n")}\n\n`);
  } else {
    const screenFields = rowFields(app.screen);
    out.push(`{-| What \`view\` returns: one field per dynamic element on the screen. -}\n` + elmRecord("Screen", screenFields) + "\n");
  }
  for (const a of aliases) out.push(a + "\n");

  // toNode
  const items = (els: Element[], acc: string, d: number, list?: Element): string[] =>
    els.map((el) => {
      if (el.kind === "heading") return `Just (Ui.NHeading ${q(el.label ?? "")})`;
      const v = `${acc}.${mangle(ident(el.name))}`;
      if (el.visibleWhen) return `Maybe.map (\\v${d} -> ${node(el, `v${d}`, d + 1, list)}) ${v}`;
      return `Just (${node(el, v, d + 1, list)})`;
    });
  const node = (el: Element, v: string, d: number, list?: Element): string => {
    switch (el.kind) {
      case "text": return `Ui.NText ${q(el.name)} ${v}`;
      case "field": return `Ui.NField ${q(el.name)} ${q(el.label ?? "")} ${v}`;
      case "button": return `Ui.NButton ${q(el.name)} ${el.expr ? `${v}.label` : q(el.label ?? "")} ${v}.enabled`;
      case "checkbox": return `Ui.NCheckbox ${q(el.name)} ${q(el.label ?? "")} ${v}`;
      case "progress": return `Ui.NProgress ${q(el.name)} ${q(el.label ?? "")} ${v}`;
      case "select": {
        if (el.from) return `Ui.NSelect ${q(el.name)} ${q(el.label ?? "")} ${v}.options (Maybe.withDefault "" ${v}.selected)`;
        const lc = lowerFirst(selectChoice(app, el, list));
        return `Ui.NSelect ${q(el.name)} ${q(el.label ?? "")} (List.map ${lc}ToString ${lc}Values) (${lc}ToString ${v})`;
      }
      case "list": return `Ui.NList ${q(el.name)} (List.map (\\r${d} -> ( r${d}.key, List.filterMap identity [ ${items(el.children, `r${d}`, d + 1, el).join(", ")} ] )) ${v})`;
      case "section": return `Ui.NSection ${q(el.name)} ${q(el.label ?? "")} (List.filterMap identity [ ${items(el.children, v, d + 1, list).join(", ")} ])`;
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
    // A row inside a row: the outer row's key is the first of the path of keys.
    const k = e.payload?.startsWith("keys") ? " (Maybe.withDefault \"\" (List.head w.keys)) w.key" : e.payload?.startsWith("key") ? " w.key" : "";
    const p = e.payload?.replace(/^keys?-?/, "") ?? "";
    const body =
      p === "text" ? `Just (${e.tag}${k} w.text)` : p === "pick" ? `Just (${e.tag}${k} w.value)` : p === "value" ? (k ? `Maybe.map (${e.tag}${k}) (${lowerFirst(e.choice!)}FromString w.value)` : `Maybe.map ${e.tag} (${lowerFirst(e.choice!)}FromString w.value)`) : k ? `Just (${e.tag}${k})` : `Just ${e.tag}`;
    return `        ${pat} ->\n            ${body}\n`;
  });
  const nav = hasScreens(app) ? `        ( "navigate", path ) ->\n            Just (ScreenOpened (routeFromPath path))\n\n` : "";
  out.push(`fromWire : Ui.Wire -> Maybe Msg\nfromWire w =\n    case ( w.on, w.target ) of\n${nav}${cases.join("\n")}\n        _ ->\n            Nothing\n`);
  if (hasClients(app) || hasData(app)) out.push(`\n\n${genElmJson(app)}`);
  if (hasData(app)) out.push(genElmData(app));
  if (hasClients(app)) out.push(`\n\n${genElmCalls(app)}`);
  return out.join("");
}

/**
 * Lists inside rows (Elm): the key of each row as \`view\` gives it, and the update of one inner row
 * found by its outer row's key and its own. The harness owns these; the model never writes the nested update.
 */
export function elmNested(app: App): string {
  const nested = nestedLists(app);
  if (!nested.length) return "";
  const out: string[] = [];
  const lower = (s: string) => s[0].toLowerCase() + s.slice(1);
  const keyString = (t: Type, v: string): string => {
    const base = t.k === "Named" ? (app.refined?.find((x) => x.name === t.name)?.base ?? (app.choices.some((c) => c.name === t.name) ? "Choice" : "Text")) : t.k;
    if (base === "Int") return `String.fromInt ${v}`;
    if (base === "Decimal") return `String.fromFloat ${v}`;
    if (base === "Bool") return `(if ${v} then "true" else "false")`;
    if (base === "Choice") return `${lower((t as { name: string }).name)}ToString ${v}`;
    return v;
  };
  for (const { record: r, key } of rowKeyed(app)) {
    const lr = lower(r.name);
    out.push(`{-| The key of ${/^[AEIOU]/.test(r.name) ? "an" : "a"} ${r.name}'s row: ${key ? `its \`${key.name}\`` : "its place in its list"}. Give every row of a list of ${r.name}s this key in \`view\`: row events carry it. -}\n${lr}RowKey : Int -> ${mangle(r.name)} -> String\n${lr}RowKey ${key ? "_" : "i"} r =\n    ${key ? keyString(key.type, `r.${mangle(key.name)}`) : "String.fromInt i"}\n\n\n`);
  }
  for (const n of nested) {
    const O = n.outer.name, I = n.inner.name, F = n.field;
    const Fc = F[0].toUpperCase() + F.slice(1);
    const [MO, MI, MF] = [mangle(O), mangle(I), mangle(F)]; // as identifiers
    out.push(`{-| One ${I} of one ${O}'s \`${F}\` changed by \`f\`: the ${lower(O)} whose row key is \`outerKey\`, its ${lower(I)} whose row key is \`key\` (the keys a row event inside a row carries). Everything else stays as it is. -}\nupdate${O}${Fc} : String -> String -> (${MI} -> ${MI}) -> List ${MO} -> List ${MO}\nupdate${O}${Fc} outerKey key f rows =\n    List.indexedMap\n        (\\i r ->\n            if ${lower(O)}RowKey i r == outerKey then\n                { r | ${MF} = List.indexedMap (\\j x -> if ${lower(I)}RowKey j x == key then f x else x) r.${MF} }\n\n            else\n                r\n        )\n        rows\n\n\n`);
    out.push(`{-| One ${I} removed from one ${O}'s \`${F}\`: the ${lower(O)} whose row key is \`outerKey\`, its ${lower(I)} whose row key is \`key\`. -}\nremoveFrom${O}${Fc} : String -> String -> List ${MO} -> List ${MO}\nremoveFrom${O}${Fc} outerKey key rows =\n    List.indexedMap\n        (\\i r ->\n            if ${lower(O)}RowKey i r == outerKey then\n                { r | ${MF} = List.indexedMap Tuple.pair r.${MF} |> List.filter (\\( j, x ) -> ${lower(I)}RowKey j x /= key) |> List.map Tuple.second }\n\n            else\n                r\n        )\n        rows\n\n\n`);
  }
  return out.join("");
}

/**
 * The draws (v69): one function per place a sentence draws a random value (\`roll1\`: the first draw in
 * \`on click roll\`), from the event's draws (runtime Draw.elm). The app calls the function where its
 * sentence runs; it never makes randomness (no \`Random\`).
 */
export function elmDraws(app: App): string {
  const sites = buildSites(app);
  if (!sites.length) return "";
  const space = (s: DrawSite) => (!s.space ? "(Draw.IntRange 0 0)" : s.space.k === "int" ? `(Draw.IntRange ${s.space.lo < 0 ? `(${s.space.lo})` : s.space.lo} ${s.space.hi < 0 ? `(${s.space.hi})` : s.space.hi})` : s.space.k === "text" ? `(Draw.Chars ${s.space.n} ${q(s.space.chars)})` : `(Draw.Names [ ${s.space.values.map(q).join(", ")} ])`);
  const lc = (n: string) => lowerFirst(n);
  // From the canonical text a draw gives to the type, and back (for \`not among\`).
  const from = (s: DrawSite) => (s.space?.k === "int" ? `(String.toInt >> Maybe.withDefault ${s.space.lo < 0 ? `(${s.space.lo})` : s.space.lo})` : s.space?.k === "names" ? `(${lc(s.type!)}FromString >> Maybe.withDefault ${mangle(s.space.values[0])})` : "identity");
  const toText = (s: DrawSite) => (s.space?.k === "int" ? "String.fromInt" : s.space?.k === "names" ? `${lc(s.type!)}ToString` : "identity");
  const fromMaybe = (s: DrawSite) => (s.space?.k === "int" ? "String.toInt" : s.space?.k === "names" ? `${lc(s.type!)}FromString` : "Just");
  const item = (s: DrawSite) => (s.item ? elmAtom(s.item) : "()");
  const row = (s: DrawSite) => (s.row ? "row" : "0");
  const args = (s: DrawSite, ...more: string[]) => [...(s.row ? ["row"] : []), ...more];
  const sig = (s: DrawSite): string => {
    const r = s.row ? "Int -> " : "";
    const T = mangle(s.type ?? "");
    switch (s.form) {
      case "one": return `${r || "() -> "}${T}`;
      case "many": return `${r}Int -> List ${T}`;
      case "notAmong": return `${r}List ${T} -> ${s.maybe ? `Maybe ${T}` : T}`;
      case "pick": return `${r}List ${item(s)} -> Maybe ${item(s)}`;
      case "shuffle": return `${r}List ${item(s)} -> List ${item(s)}`;
    }
  };
  const impl = (s: DrawSite): string => {
    const a = (more: string[]) => (args(s, ...more).length ? `\\${args(s, ...more).join(" ")} -> ` : "\\_ -> ");
    const id = q(s.id);
    switch (s.form) {
      case "one": return `${a([])}Draw.one src ${id} ${row(s)} 0 ${space(s)} |> ${from(s)}`;
      case "many": return `${a(["n"])}Draw.many src ${id} ${row(s)} n ${space(s)} |> List.map ${from(s)}`;
      case "notAmong": return s.maybe ? `${a(["taken"])}Draw.notAmong src ${id} ${row(s)} ${space(s)} (List.map ${toText(s)} taken) |> Maybe.andThen ${fromMaybe(s)}` : `${a(["taken"])}Draw.notAmong src ${id} ${row(s)} ${space(s)} (List.map ${toText(s)} taken) |> Maybe.withDefault "" |> ${from(s)}`;
      case "pick": return `${a(["xs"])}Draw.pick src ${id} ${row(s)} xs`;
      case "shuffle": return `${a(["xs"])}Draw.shuffle src ${id} ${row(s)} xs`;
    }
  };
  const drawDoc = (s: DrawSite) => `${s.unit}, line ${s.line % LINE_BASE}: \`${doc(s.phrase)}\`${s.row ? "; the first argument is the index of the loop's row (0 for the first)" : ""}${s.form === "notAmong" ? `; never one of the taken${s.maybe ? ", Nothing when every one is taken" : ""}` : s.form === "pick" ? "; Nothing for an empty list" : s.form === "many" ? "; n values, which may repeat" : ""}`;
  return `{-| The draws of one event (a random value in the spec): one function per place a sentence draws, named after its handler (or derived value) and its place there. The harness makes the values; call a function exactly where its sentence runs, once per value the sentence needs.

${sites.map((s) => `  - \`${s.id}\`: ${drawDoc(s)}`).join("\n")}

-}
type alias Draws =
    { ${sites.map((s) => `${s.id} : ${sig(s)}`).join("\n    , ")}
    }


{-| The draws of an event, from its source (the harness's; the app never calls this). -}
drawsFrom : Draw.Source -> Draws
drawsFrom src =
    { ${sites.map((s) => `${s.id} = ${impl(s)}`).join("\n    , ")}
    }


`;
}

/**
 * An app with stored fields and \`on start\`: the harness owns the order. \`init\` is the app from its
 * defaults; the stored fields are put back; then \`Started\` runs \`on start\`, which sees them. The
 * calls \`init\` returns (none, by the prompt) go out before those of \`on start\`.
 */
function elmStarted(app: App, arg: string, argType: string, restored: string): string {
  const c = usesClock(app);
  const calls = hasClients(app);
  const ck = c ? " clock" : "";
  // \`on start\` draws nothing (the checker refuses it): an empty source.
  const upd = `App.update${ck}${usesDraws(app) ? ' (Spec.drawsFrom (Draw.source "" J.null))' : ""} Spec.Started`;
  return `{-| The app as it starts: from its defaults, with the stored fields put back, then \`on start\` (\`Started\`), so \`on start\` sees what the app remembered. -}
started : ${c ? "Spec.Clock -> " : ""}${argType} -> ${calls ? "( App.Model, List Spec.Call )" : "App.Model"}
started${ck} ${arg} =
    let
        ${calls ? "( fresh, first )" : "fresh"} =
            App.init${ck}
${calls ? `
        ( m, onStart ) =
            ${upd} (${restored})
    in
    ( m, first ++ onStart )` : `    in
    ${upd} (${restored})`}


`;
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
        , subscriptions = \\_ -> ${app.clockMs ? `Time.every ${app.clockMs} (\\_ -> { on = "tick", target = "", key = "", keys = [], text = "", value = "" })` : "Sub.none"}
        }
`;
}

/**
 * The browser entry of an app that makes calls or reads the clock: ports carry calls out
 * (`request`), answers and events in, the client layers' config out (`through`), and the local
 * time in (`clockTicks`); glue.js does the JavaScript side.
 */
function genElmMainPorts(app: App): string {
  const dw = usesDraws(app);
  const calls = hasClients(app);
  const th = hasThrough(app);
  const c = usesClock(app);
  const st = hasStored(app);
  const clk = c ? " model.clock" : "";
  const first = c ? "(App.init start)" : "App.init";
  // Stored state: what this browser kept comes in with the flags, and the data goes out after every update.
  // With \`on start\`, the harness restores first and then sends \`Started\` (\`started\`, below).
  const sar = startsAfterRestore(app);
  const init = sar ? `(started${c ? " start" : ""} flags)` : st ? (calls ? `(Tuple.mapFirst (restoreFrom flags) ${first})` : `(restoreFrom flags ${first})`) : first;
  // Draws: the page's base seed (Web Crypto, in the flags) and a counter give every event its own seed.
  const withClock = (fn: string) => {
    const f = c ? `(${fn} model.clock)` : fn;
    return dw ? `(${f} (Spec.drawsFrom (Draw.fromBase model.seed model.events J.null)))` : f;
  };
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
${app.clockMs ? "import Time\n" : ""}import Ui${dw ? "\nimport Draw" : ""}
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
    { app : App.Model${c ? ", clock : Spec.Clock" : ""}${dw ? ", seed : String, events : Int" : ""} }


{-| The clock JavaScript sends: { now, today }; the one before when it cannot be read. -}
decodeClock : D.Value -> Spec.Clock -> Spec.Clock
decodeClock v before =
    Result.withDefault before (D.decodeValue ${elmClockDecoder(app)} v)

${st ? `
{-| The model with what this browser kept (the stored fields), when there is any. -}
restoreFrom : D.Value -> App.Model -> App.Model
restoreFrom flags m =
    case D.decodeValue (D.field "saved" Spec.decodeStored) flags of
        Ok saved ->
            App.restore saved m

        Err _ ->
            m

` : ""}${sar ? `\n${elmStarted(app, "flags", "D.Value", "restoreFrom flags fresh")}` : ""}${calls ? send : `send : App.Model -> ( App.Model, Cmd In )
send m =
    ( m, Cmd.none )`}


main : Program D.Value Model In
main =
    Browser.element
        { init =
            \\flags ->
                let
                    model =
                        { app = Tuple.first (send ${init}) ${c ? ", clock = start " : ""}${dw ? ', seed = Result.withDefault "" (D.decodeValue (D.field "seed" D.string) flags), events = 0 ' : ""}}

                    start =
                        decodeClock flags ${elmClockStart(app)}
                in
                ( model, Tuple.second (send ${init}) )
        , update =
            \\i model ->
                let
                    msg =
                        ${dw ? `if String.length model.seed /= 64 || not (String.all Char.isHexDigit model.seed) then
                            -- No seed from the CSPRNG (the page gives one with the flags): no event runs, so nothing is drawn from a fixed seed.
                            Nothing

                        else
                        ` : ""}case i of
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
                        ( { moved | app = a${dw ? ", events = moved.events + 1" : ""} }, Cmd.batch [ cmd, save (Spec.encodeData (App.data a)) ] )` : `Tuple.mapFirst (\\a -> { moved | app = a${dw ? ", events = moved.events + 1" : ""} }) (send (${withClock("App.update")} e moved.app))`}

                    Nothing ->
                        ( moved, Cmd.none )
        , view = \\model -> Html.map FromUi (Ui.render (Spec.toNode (App.view${clk} model.app)))
        , subscriptions = \\_ -> Sub.batch [ ${[calls ? "answer FromApi, events FromEvent" : "", c ? "clockTicks NewClock" : "", app.clockMs ? `Time.every ${app.clockMs} (\\_ -> FromUi { on = "tick", target = "", key = "", keys = [], text = "", value = "" })` : ""].filter(Boolean).join(", ")} ]
        }
`;
}

/** The test worker of an app that makes calls or reads the clock: the driver sends the clock with every event. */
const elmWorkerPorts = (app: App) => {
  const dw = usesDraws(app);
  const calls = hasClients(app);
  const c = usesClock(app);
  const inv = hasData(app);
  const sc = hasScreens(app);
  const st = hasStored(app);
  // Draws: the driver's seed and steering come with every event (\`draw\`).
  const updWith = (src: string) => `${c ? "App.update clock" : "App.update"}${dw ? ` (Spec.drawsFrom ${src})` : ""}`;
  const upd = updWith("draws");
  return `port module Worker exposing (main)

import App
import Json.Decode as D
import Json.Encode as J
import Spec
import Ui${dw ? "\nimport Draw" : ""}


port observe : J.Value -> Cmd msg


port act : (D.Value -> msg) -> Sub msg


type alias Model =
    { app : App.Model${calls ? ", pending : List Spec.Call" : ""}${c ? ", clock : Spec.Clock" : ""} }


decodeClock : D.Value -> Spec.Clock -> Spec.Clock
decodeClock v before =
    Result.withDefault before (D.decodeValue ${elmClockDecoder(app)} v)


${startsAfterRestore(app) ? elmStarted(app, "saved", "Maybe Spec.Stored", "Maybe.withDefault fresh (Maybe.map (\\s -> App.restore s fresh) saved)") : ""}main : Program D.Value Model D.Value
main =
    Platform.worker
        { init =
            \\flags ->
                let
                    start =
                        decodeClock flags ${elmClockStart(app)}

                    first =
                        ${startsAfterRestore(app) ? `started${c ? " start" : ""} Nothing` : c ? "App.init start" : "App.init"}
                in
                ( { app = ${calls ? "Tuple.first first" : "first"}${calls ? ", pending = Tuple.second first" : ""}${c ? ", clock = start" : ""} }, Cmd.none )
        , update =
            \\v m ->
                let
                    clock =
                        ${c ? `Result.withDefault m.clock (D.decodeValue (D.field "clock" D.value) v |> Result.map (\\cv -> decodeClock cv m.clock))` : "()"}

                    on =
                        Result.withDefault "" (D.decodeValue (D.field "on" D.string) v)
${dw ? `
                    drawSeed =
                        Result.withDefault "" (D.decodeValue (D.at [ "draw", "seed" ] D.string) v)

                    -- Steered values go to the draws in the spec's order, not the order this build
                    -- evaluates them in: a first run (its result dropped) says which draws the event makes.
                    probed =
                        case D.decodeValue (D.at [ "draw", "probe" ] D.value) v of
                            Ok probe ->
                                Just ( probe, Maybe.map (\\e -> ${updWith("(Draw.source drawSeed probe)")} e m.app) msg )

                            Err _ ->
                                Nothing

                    draws =
                        case probed of
                            Just ( probe, _ ) ->
                                Draw.source drawSeed (Result.withDefault J.null (D.decodeValue (D.field "plan" D.value) probe))

                            Nothing ->
                                Draw.source drawSeed (Result.withDefault J.null (D.decodeValue (D.at [ "draw", "steer" ] D.value) v))
` : ""}
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
                        ${startsAfterRestore(app) ? `if on == "restart" then
                            -- The app starts again with what the driver saved (the stored fields of its data), then \`on start\`.
                            ${calls ? "" : "( "}started${c ? " clock" : ""} (Result.toMaybe (D.decodeValue (D.field "saved" Spec.decodeStored) v))${calls ? "" : ", [] )"}

                        else
                        ` : st ? `if on == "restart" then
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
${startsAfterRestore(app) ? `
                    -- The data right after the restart put the stored fields back, before \`on start\` ran (for the driver's check).
                    restored =
                        case ( on, D.decodeValue (D.field "saved" Spec.decodeStored) v ) of
                            ( "restart", Ok saved ) ->
                                Spec.encodeData (App.data (App.restore saved ${calls ? `(Tuple.first (App.init${c ? " clock" : ""}))` : `(App.init${c ? " clock" : ""})`}))

                            _ ->
                                J.null
` : ""}                in
                ( { app = ${sc ? "App.settled next" : "next"}${calls ? ", pending = []" : ""}${c ? ", clock = clock" : ""} }
                , observe ${calls || inv || sc ? `(J.object [ ${hasThrough(app) ? `( "through", Spec.encodeThrough (App.through next) ), ` : ""}${inv ? `( "data", Spec.encodeData (App.data next) ), ` : ""}${startsAfterRestore(app) ? `( "restored", restored ), ` : ""}${sc ? `( "go", Maybe.withDefault J.null (Maybe.map J.string next.go) ), ` : ""}( "screen", screen )${calls ? `, ( "calls", J.list ${hasThrough(app) ? "(Spec.callOut (App.through next))" : "Spec.callToJson"} (m.pending ++ calls) )` : ""} ])` : "screen"}
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

/** The decoder for the clock JavaScript sends: { now, today } (and { size } with `sizes`). */
const elmClockDecoder = (app: App) =>
  app.sizes
    ? `(D.map3 Spec.Clock (D.field "now" D.string) (D.field "today" D.string) (D.oneOf [ D.field "size" (D.map (Spec.sizeFromString >> Maybe.withDefault Spec.${mangle(app.sizes[0])}) D.string), D.succeed Spec.${mangle(app.sizes[0])} ]))`
    : `(D.map2 Spec.Clock (D.field "now" D.string) (D.field "today" D.string))`;
/** The clock before JavaScript says otherwise. */
const elmClockStart = (app: App) => `{ now = "2026-01-05T09:00", today = "2026-01-05"${app.sizes ? `, size = Spec.${mangle(app.sizes[0])}` : ""} }`;

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
    case "Ref": return t.key ? elmDecoder(app, t.key) : "D.int";
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
    case "Ref": return t.key ? elmEncoder(app, t.key, v, d) : `J.int ${v}`;
  }
}

/** JSON decoders and encoders for every record and choice (calls, answers, and the app's data for checks). */
export function genElmJson(app: App): string {
  const out: string[] = [];
  // JSON for every record and choice: calls send them, answers bring them back.
  out.push(`jsonAndMap : D.Decoder a -> D.Decoder (a -> b) -> D.Decoder b\njsonAndMap =\n    D.map2 (|>)\n\n\n`);
  // Nothing on the wire: a `T or nothing` field is `null` or missing; a value of another type does not fit.
  out.push(`{-| A \`T or nothing\` field: missing or null is Nothing; anything else must be a T. -}\njsonOptional : String -> D.Decoder a -> D.Decoder (Maybe a)\njsonOptional name d =\n    D.maybe (D.field name D.value)\n        |> D.andThen\n            (\\v ->\n                case v of\n                    Nothing ->\n                        D.succeed Nothing\n\n                    Just _ ->\n                        D.field name (D.nullable d)\n            )\n\n\n`);
  for (const c of app.choices) {
    const lc = lowerFirst(c.name);
    out.push(`decode${c.name} : D.Decoder ${mangle(c.name)}\ndecode${c.name} =\n    D.string\n        |> D.andThen\n            (\\s ->\n                case ${lc}FromString s of\n                    Just v ->\n                        D.succeed v\n\n                    Nothing ->\n                        D.fail ("not a ${c.name}: " ++ s)\n            )\n\n\n`);
    out.push(`encode${c.name} : ${mangle(c.name)} -> J.Value\nencode${c.name} v =\n    J.string (${lc}ToString v)\n\n\n`);
  }
  for (const r of app.records) {
    if (!r.fields.length) continue;
    const field = (f: { name: string; type: Type }) =>
      f.type.k === "Maybe" ? `(jsonOptional ${q(f.name)} ${elmDecoder(app, f.type.of)})` : `(D.field ${q(f.name)} ${elmDecoder(app, f.type)})`;
    out.push(`decode${r.name} : D.Decoder ${mangle(r.name)}\ndecode${r.name} =\n    D.succeed ${mangle(r.name)}\n${r.fields.map((f) => `        |> jsonAndMap ${field(f)}`).join("\n")}\n\n\n`);
    out.push(`encode${r.name} : ${mangle(r.name)} -> J.Value\nencode${r.name} r =\n    J.object\n        [ ${r.fields.map((f) => `( ${q(f.name)}, ${elmEncoder(app, f.type, `r.${mangle(f.name)}`)} )`).join("\n        , ")}\n        ]\n\n\n`);
  }
  return out.join("");
}

export function genElmCalls(app: App): string {
  const eps = clientEndpoints(app);
  const undos = undoables(app);
  const out: string[] = [];
  const callVariants = [
    ...eps.map((c) => `${c.tag}${c.ep.params.length ? ` { ${c.ep.params.map((p) => `${mangle(p.name)} : ${elmType(p.type)}`).join(", ")} }` : ""}`),
    ...undos.map((u) => `${u.tag} { answer : ${elmType(u.answer)}${u.usesArgs ? `, ${u.of.ep.params.map((p) => `${mangle(p.name)} : ${elmType(p.type)}`).join(", ")}` : ""} }`),
  ];
  out.push(`{-| A request to an API, made by returning it from init or update. It is answered later by an \`…Answered\` message.${undos.length ? " An \`undo\` takes an effect back (\`undo @pay.charge\`): give the answer the original call got (and its args); the harness calls the endpoint the contract names in \`undone by\`, answered as that endpoint's \`…Answered\`." : ""} -}\ntype Call\n    = ${callVariants.join("\n    | ")}\n\n\n`);
  for (const c of eps) {
    const variants = (c.ep.answers ?? []).map((a) => `${c.tag}${a.status}${a.type ? ` ${elmAtom(a.type)}` : ""}`);
    const unknown = [...(c.ep.effect ? [`${c.tag}Unknown String`] : []), ...(gated(app, c) ? [`${c.tag}Held`, `${c.tag}Rejected`] : [])];
    out.push(`{-| What ${c.ep.method} ${doc(c.ep.path)} answers, per status (the contract). Failed: no answer the contract allows (network down, or a body of the wrong shape).${c.ep.effect ? " Unknown: still no answer after the last attempt, so it may or may not have happened (effect external): do not offer to do it again as if it failed." : ""}${gated(app, c) ? " Held: the call waits for approval (it has not gone out); its real answer follows once approved, or Rejected." : ""} -}\ntype ${c.tag}Answer\n    = ${[...variants, `${c.tag}Failed String`, ...unknown].join("\n    | ")}\n\n\n`);
  }
  const th = throughs(app);
  if (th.length) {
    out.push(`{-| What the client layers need from the app's state, per api (\`through\` in \`uses\`): \`through model\` in the app module computes it. -}\ntype alias Through =\n    { ${th.map((t) => `${mangle(t.alias)} : { ${t.state.map((x) => `${mangle(x.param)} : ${elmType(x.type)}`).join(", ")} }`).join("\n    , ")}\n    }\n\n\n`);
    out.push(`{-| A call as it leaves, with the config of its api's client layer. -}\ncallOut : Through -> Call -> J.Value\ncallOut th c =\n    let\n        v =\n            callToJson c\n\n        alias =\n            Result.withDefault "" (D.decodeValue (D.field "endpoint" D.string) v) |> String.split "." |> List.head |> Maybe.withDefault ""\n\n        config =\n            case alias of\n${th.map((t) => `                ${q(t.alias)} ->\n                    J.object [ ${t.state.map((x) => `( ${q(x.param)}, ${elmEncoder(app, x.type, `th.${mangle(t.alias)}.${mangle(x.param)}`)} )`).join(", ")} ]\n`).join("\n")}\n                _ ->\n                    J.null\n    in\n    J.object [ ( "endpoint", D.decodeValue (D.field "endpoint" D.value) v |> Result.withDefault J.null ), ( "args", D.decodeValue (D.field "args" D.value) v |> Result.withDefault J.null ), ( "config", config ) ]\n\n\n`);
    out.push(`{-| The client layers' config from the app's state, for the event streams. -}\nencodeThrough : Through -> J.Value\nencodeThrough th =\n    J.object [ ${th.map((t) => `( ${q(t.alias)}, J.object [ ${t.state.map((x) => `( ${q(x.param)}, ${elmEncoder(app, x.type, `th.${mangle(t.alias)}.${mangle(x.param)}`)} )`).join(", ")} ] )`).join(", ")} ]\n\n\n`);
  }
  const callCases = [
    ...eps.map((c) => {
      const args = c.ep.params.map((p) => `( ${q(p.name)}, ${elmEncoder(app, p.type, `a.${mangle(p.name)}`)} )`);
      return `        ${c.tag}${c.ep.params.length ? " a" : ""} ->\n            J.object [ ( "endpoint", J.string ${q(c.name)} ), ( "args", J.object [ ${args.join(", ")} ] ) ]\n`;
    }),
    ...undos.map((u) => {
      const args = u.args.map((a) => {
        const v = a.from === "answer" ? ["u.answer", ...a.path.map(mangle)].join(".") : `u.${mangle(a.path[0])}`;
        return `( ${q(a.name)}, ${elmEncoder(app, a.type, v)} )`;
      });
      return `        ${u.tag} u ->\n            J.object [ ( "endpoint", J.string ${q(`${u.of.alias}.${u.by.name}`)} ), ( "args", J.object [ ${args.join(", ")} ] ), ( "undo", J.bool True ), ( "of", J.object [ ( "endpoint", J.string ${q(u.of.name)} ), ( "answer", ${elmEncoder(app, u.answer, "u.answer")} ) ] ) ]\n`;
    }),
  ];
  out.push(`callToJson : Call -> J.Value\ncallToJson c =\n    case c of\n${callCases.join("\n")}\n\n`);
  out.push(`{-| An answer from the outside (\`{ endpoint, status, body }\` or \`{ endpoint, status: 0, error }\`) as a message. -}\nfromAnswer : D.Value -> Maybe Msg\nfromAnswer v =\n    let\n        endpoint =\n            Result.withDefault "" (D.decodeValue (D.field "endpoint" D.string) v)\n\n        status =\n            Result.withDefault 0 (D.decodeValue (D.field "status" D.int) v)\n\n        failure =\n            Result.withDefault "no answer" (D.decodeValue (D.field "error" D.string) v)\n\n        errored =\n            Result.withDefault False (Result.map (\\_ -> True) (D.decodeValue (D.field "error" D.string) v))\n\n        unknown =\n            Result.withDefault False (D.decodeValue (D.field "unknown" D.bool) v)\n\n${clientEndpoints(app).some((c) => gated(app, c)) ? '        held =\n            Result.withDefault False (D.decodeValue (D.field "held" D.bool) v)\n\n        rejected =\n            Result.withDefault False (D.decodeValue (D.field "rejected" D.bool) v)\n\n' : ""}        body d ok bad =\n            case D.decodeValue (D.field "body" d) v of\n                Ok x ->\n                    ok x\n\n                Err _ ->\n                    bad (endpoint ++ " answered " ++ String.fromInt status ++ ", but the body does not fit the contract")\n\n        noBody ok bad =\n            case ( D.decodeValue (D.field "body" (D.null ())) v, D.decodeValue (D.field "body" D.value) v ) of\n                ( Err _, Ok _ ) ->\n                    bad (endpoint ++ " answered " ++ String.fromInt status ++ ", but the body does not fit the contract")\n\n                _ ->\n                    ok\n    in\n    case endpoint of\n${eps
    .map((c) => {
      const cases = (c.ep.answers ?? []).map((a) => `                        ${a.status} ->\n                            ${a.type ? `body ${elmDecoder(app, a.type)} ${c.tag}${a.status} ${c.tag}Failed` : `noBody ${c.tag}${a.status} ${c.tag}Failed`}\n`);
      // The same message TypeScript's `conforms` gives: an answer the contract does not declare, its
      // statuses in ascending order (as \`Object.keys\` lists a record's number keys).
      const statuses = (c.ep.answers ?? []).map((a) => Number(a.status)).sort((a, b) => a - b).join(", ");
      const fallback = `${c.tag}Failed (if status == 0 then failure else endpoint ++ " answered " ++ String.fromInt status ++ ", which the contract does not declare (${statuses})")`;
      // An answer with an error (status 0, or a call still in progress after its last attempt) is a
      // failure with that error, before its status is read: TypeScript's \`fromAnswer\` does the same.
      const byStatus = `(if errored then\n                        ${c.tag}Failed failure\n\n                     else\n                        case status of\n${cases.map((x) => x.replace(/^(?=.)/gm, "    ")).join("\n")}\n                            _ ->\n                                ${fallback}\n                    )`;
      const inner = c.ep.effect ? `(if unknown then\n                        ${c.tag}Unknown failure\n\n                     else\n                        ${byStatus.replace(/\n/g, "\n    ")}\n                    )` : byStatus;
      const answer = gated(app, c) ? `(if held then\n                        ${c.tag}Held\n\n                     else if rejected then\n                        ${c.tag}Rejected\n\n                     else\n                        ${inner.replace(/\n/g, "\n    ")}\n                    )` : inner;
      return `        ${q(c.name)} ->\n            Just\n                (${c.tag}Answered\n                    ${answer}\n                )\n`;
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
  const dw = usesDraws(app);
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


update : ${c ? "Clock -> " : ""}${dw ? "Draws -> " : ""}Msg -> Model -> ${calls ? "( Model, List Call )" : "Model"}
update ${ck}${dw ? "draws " : ""}msg m =
    let
        route =
            case msg of
                ScreenOpened r ->
                    r

                _ ->
                    m.route

        ${calls ? "( inner, cs, go )" : "( inner, go )"} =
            Inner.update ${ck}route ${dw ? "draws " : ""}msg m.inner
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
  m = one(m, "                            FromUi w ->\n                                Spec.fromWire w\n", "                            FromUi w ->\n                                Spec.fromWire w\n\n                            FromNav path ->\n                                Spec.fromWire { on = \"navigate\", target = path, key = \"\", keys = [], text = \"\", value = \"\" }\n");
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
  // Randomness is the harness's: an Elm build has no package that makes it (and App.elm may not import one).
  if (/"elm\/random"/.test(readFileSync(join(dir, "elm.json"), "utf8"))) throw new Error("runtime/elm/elm.json depends on elm/random: randomness is the harness's (Draw.elm)");
  copyFileSync(join(ROOT, "runtime/elm/Ui.elm"), join(dir, "src/Ui.elm"));
  copyFileSync(join(ROOT, "runtime/elm/Fmt.elm"), join(dir, "src/Fmt.elm"));
  // Platform functions: the installation's reviewed Elm code, imported by the generated Spec.
  if (app.platforms?.some((p) => p.name === "std.crypto")) copyFileSync(join(ROOT, "runtime/elm/Crypto.elm"), join(dir, "src/Crypto.elm"));
  // Draws and codes: the harness's Draw module (HMAC-SHA-256 on the reviewed Crypto), never \`Random\`.
  if (usesDraws(app) || hasCodes(app)) for (const f of ["Crypto.elm", "Draw.elm"]) copyFileSync(join(ROOT, "runtime/elm", f), join(dir, "src", f));
  const spec = genElmSpec(app);
  writeFileSync(join(dir, "src/Spec.elm"), spec);
  const ports = hasClients(app) || usesClock(app) || hasStored(app) || hasScreens(app) || usesDraws(app);
  if (!ports && (hasInvariants(app) || hasHomes(app))) {
    // Checks in `always` (and of the keys references find rows by) need the data from the test worker; the browser entry stays plain.
    writeFileSync(join(dir, "src/Main.elm"), genElmMain(app));
    writeFileSync(join(dir, "src/Worker.elm"), elmWorkerPorts(app));
    writeFileSync(join(dir, "index.html"), html(app.name, `<script src="main.js"></script><script>Elm.Main.init({ node: document.getElementById("app") })</script>`, true));
  } else if (ports) {
    // An app whose only reason for this entry is its draws (the seed in the flags) has no ports.
    const main = genElmMainPorts(app);
    writeFileSync(join(dir, "src/Main.elm"), hasScreens(app) ? withScreens(main) : /^port [a-z]\w* :/m.test(main) ? main : main.replace("port module Main", "module Main"));
    if (hasScreens(app)) writeFileSync(join(dir, "src/AppNav.elm"), genElmNav(app));
    for (const f of ["store.ts", "api.ts", "fmt.ts"]) copyFileSync(join(ROOT, "runtime/ts", f), join(dir, f));
    writeFileSync(join(dir, "src/Worker.elm"), hasScreens(app) ? elmWorkerPorts(app).replace("\nimport App\n", "\nimport AppNav as App\n") : elmWorkerPorts(app));
    copyCallsRuntime(dir);
    copyFileSync(join(ROOT, "runtime/ts/clock.ts"), join(dir, "clock.ts"));
    copyDrawRuntime(app, dir);
    writeThrough(app, dir, layerDirs);
    writeFileSync(
      join(dir, "glue.ts"),
      `// The JavaScript side of the Elm app: calls with fetch (through each api's client layer), answers and
// events in, and the local clock (at the start, then every 15 seconds).
import { agreement, fetchCall, heldAnswer, keyFor, listen, rejectedAnswer, type Answer, type CallDesc, type CallOut, type Outgoing } from "./calls.ts";
import { keep, outbox } from "./outbox.ts";
import { apply } from "./through.ts";
import { ${app.sizes ? "hostSize, " : ""}localClock } from "./clock.ts";
import { load, save } from "./store.ts";
import type { TypeDesc } from "./api.ts";
${usesDraws(app) ? 'import { freshSeed } from "./draw.ts";\n' : ""}
const endpoints: CallDesc[] = ${JSON.stringify(callDescs(app))};
// The clock the app gets${app.sizes ? ", with the size the host shows it at" : ""}.
const hostClock = () => ${app.sizes ? `({ ...localClock(), size: hostSize(${JSON.stringify(app.sizes)}) })` : "localClock()"};
// Stored state lives in this browser (localStorage), under the app's name.
const KEY = ${q(`intent:${app.name}`)};
const storedFields: Record<string, TypeDesc> = { ${storedTypes(app)} };
const storedDefaults: Record<string, unknown> = { ${storedDefaults(app)} };

// The flags: the local clock, and what this browser kept of the stored state${usesDraws(app) ? "; the page's base seed for draws (Web Crypto)" : ""}.
(globalThis as any).intentClock = () => ({ ...hostClock(), ...(Object.keys(storedFields).length ? { saved: load(KEY, storedFields, storedDefaults) ?? null } : {})${usesDraws(app) ? ", seed: freshSeed()" : ""} });
(globalThis as any).intentConnect = (app: any) => {
${usesDraws(app) ? "  if (!app.ports) return; // nothing to connect (an app that only draws gets its seed with the flags)\n" : ""}  if (app.ports.clockTicks) setInterval(() => app.ports.clockTicks.send(hostClock()), 15000);${app.sizes ? `\n  // The host shows the app at another size: the app gets the clock with it at once.\n  if (app.ports.clockTicks) window.addEventListener("intentsize", () => app.ports.clockTicks.send(hostClock()));` : ""}
  if (app.ports.save) app.ports.save.subscribe((data: Record<string, unknown>) => save(KEY, data, storedFields));
${hasScreens(app) ? `  // Several screens: the address after # is where the app is; the app's \\\`go to\\\` / \\\`go back\\\` change it.
  const address = () => decodeURI(location.hash.slice(1)) || "/";
  app.ports.goTo.subscribe((p: string) => (p === "back" ? history.back() : (location.hash = p)));
  window.addEventListener("hashchange", () => app.ports.navigate.send(address()));
  app.ports.navigate.send(address());
` : ""}  if (!app.ports.request) return;
  let latest: Record<string, Record<string, unknown>> = {};
  let stream: { refresh: () => void } | undefined;
  // Each call gets its idempotency key when it is made: every attempt sends the same one. The call
  // is written to a durable outbox first, so a reload sends an unanswered call again with that key.
  const box = outbox(${q(`intent:${app.name}:outbox`)});
  const send = (call: CallOut) => fetchCall(endpoints, call, (alias: string, req: Outgoing) => apply(alias, req, call.config ?? undefined), call.config).then((a) => { if (!a.unknown) box.done(call.key!); app.ports.answer.send(a); });
  // The agreement (through std.actions, calls.ts): a call no permission covers is held for approval.
  // The held calls, what each permission let through and the rejections applied survive a reload.
  const agreed = agreement(endpoints, keep(${q(`intent:${app.name}:agreement`)}));
  const letGo = (call: CallOut) => { box.put(call); send(call); };
  // After every update: a new rejection drops the calls held now; a permission lets held calls out.
  // Answers from the harness itself (held, rejected) go after the current update, like any answer.
  const answerLater = (a: Answer) => void Promise.resolve().then(() => app.ports.answer.send(a));
  const release = () => {
    const { send: out, dropped } = agreed.release((alias) => latest[alias], Date.now());
    out.forEach(letGo);
    dropped.forEach((c) => answerLater(rejectedAnswer(c)));
  };
  // The client layers' config arrives from the app after every update (and after init): reopen the streams it changes.
  if (app.ports.through)
    app.ports.through.subscribe((t: Record<string, Record<string, unknown>>) => {
      latest = t;
      stream?.refresh();
      release();
    });
  app.ports.request.subscribe((c: any) => {
    const call = { ...c } as CallOut;
    call.key = keyFor(call);
    if (agreed.offer(call, latest[call.endpoint.split(".")[0]], Date.now()) !== "hold") letGo(call);
    else answerLater(heldAnswer(call)); // the screen learns it waits for approval
  });
  for (const call of box.pending()) send(call);
  stream = listen(${JSON.stringify(eventsByAlias(app))}, (e) => app.ports.events.send(e), (alias: string, req: Outgoing) => apply(alias, req, latest[alias])${Object.keys(eventWireTypes(app)).length ? `, ${JSON.stringify(eventWireTypes(app))}` : ""});
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

/**
 * The driver's steering, for Draw.elm: an object Elm reads through (\`take|site|row|index|n\` gives a
 * steered value or null; reading \`drawn|site|row|index|value\` tells the driver what was drawn).
 */
function steerable(w: object): object {
  type Steer = { take(k: string, n: number): string | null; drawn(k: string, v: string): void; plan?(asked: [string, number][]): void };
  const d = (w as { draw?: { seed: string; steer?: Steer } }).draw;
  if (!d?.steer) return w;
  const st = d.steer;
  const through = (s: Steer, plan?: () => unknown) =>
    new Proxy({}, {
      has: (_t, k) => typeof k === "string" && (k.startsWith("take|") || k.startsWith("drawn|") || (!!plan && k === "plan")),
      get: (_t, k) => {
        if (typeof k !== "string") return undefined;
        const parts = k.split("|");
        if (parts[0] === "take") return s.take(parts.slice(1, 4).join("|"), Number(parts[4]));
        if (parts[0] === "drawn") return s.drawn(parts.slice(1, 4).join("|"), parts.slice(4).join("|")), true;
        if (k === "plan" && plan) return plan();
        return undefined;
      },
    });
  const real = through(st);
  if (!st.plan) return { ...w, draw: { seed: d.seed, steer: real } };
  // A planned event: the first run reads through \`probe\` (it notes the places asked and gives nothing),
  // then reading \`plan\` makes the plan and gives the steering for the real run.
  const asked: [string, number][] = [];
  const probe = through({ take: (k, n) => (asked.push([k, n]), null), drawn: () => {} }, () => (st.plan!(asked), real));
  return { ...w, draw: { seed: d.seed, steer: real, probe } };
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
  let restored: unknown;
  let go: string | null = null;
  let waiting: ((v: any) => void) | undefined;
  app.ports.observe.subscribe((v: any) => {
    // Apps that make calls observe { screen, calls }.
    if (v && v.screen) {
      made.push(...(v.calls ?? []));
      if (v.data !== undefined) data = v.data;
      if (v.restored != null) restored = v.restored;
      if (v.through) through = v.through;
      if (v.go) go = v.go;
      v = v.screen;
    }
    last = v;
    waiting?.(v);
  });
  // Elm delivers port messages asynchronously: wait for the observation that answers this event.
  const deliver = (w0: object) => {
    const w = steerable(w0);
    return new Promise<void>((resolve, reject) => {
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
  };
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
    restored: async () => restored,
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
Fmt.minutesBetween : DateTime -> DateTime -> Int -- \`the minutes between A and B\`: negative when B comes first
Fmt.hoursBetween : DateTime -> DateTime -> Int   -- \`the hours between A and B\`: whole hours, toward zero: 09:00 → 10:59 is 1
Fmt.formatDate : Date -> String                  -- formatDate "2026-09-04" == "4 Sep 2026"
Fmt.formatDateTime : DateTime -> String          -- formatDateTime "2026-09-04T09:05" == "4 Sep 2026 09:05"
Fmt.parseDate : String -> Maybe Date             -- only a date that exists
Fmt.parseDateTime : String -> Maybe DateTime     -- "YYYY-MM-DD HH:MM" or "YYYY-MM-DDTHH:MM"
-- An order the spec writes (\`, earliest @due first, then lowest @id first\`) is Fmt.sortBy, never a sort of your own:
Fmt.sortBy : List ( a -> Fmt.SortKey, Fmt.SortOrder ) -> List a -> List a  -- stable; SortNothing last either way; SortInt / SortFloat / SortText; a choice: SortInt of its place
--   Fmt.sortBy [ ( \\r -> Maybe.withDefault Fmt.SortNothing (Maybe.map Fmt.SortText r.due), Fmt.Ascending ), ( \\r -> Fmt.SortInt r.id, Fmt.Ascending ) ] rows`,
    skeleton: (calls, through) => (calls ? (through ? ELM_APP_SKELETON_CALLS.replace("exposing (Model, init, update, view)", "exposing (Model, init, through, update, view)") + ELM_APP_SKELETON_THROUGH : ELM_APP_SKELETON_CALLS) : ELM_APP_SKELETON),
    calls: `Calls (this app uses an API):
- \`init\` and \`update\` also return the calls to make, in the order the steps say: \`( model, [ TicketsCreateTicket { subject = …, customer = …, priority = … } ] )\`. No step says "call": return \`[]\`.
- \`on start\`: the calls \`init\` returns. \`on answer tickets.createTicket\`: the message \`TicketsCreateTicketAnswered answer\`; the answer has one variant per status the contract declares (\`TicketsCreateTicket201 ticket\`, \`TicketsCreateTicket400 problem\`) plus \`TicketsCreateTicketFailed reason\`.
- "if its status is 201" matches that variant; "its body" is the value it carries. "otherwise" covers every other variant, Failed included.
- To take an effect back (\`undo @pay.charge\`): the call is \`PayChargeUndo { answer = <the answer the original call got> }\`, with the original params too when the undo's binding reads them. The reply is the \`…Answered\` message of the endpoint the contract names in \`undone by\`.
- Every argument of a call is given; an absent optional one is \`Nothing\`.`,
    through: "- `through : Model -> Through` (exposed too): for each api with a client layer, the params bound to state under `through` in the spec, read from the model. The harness adds the config to every call and to the api's event stream.",
    clock: `Clock (this app reads @now or @today): \`init\`, \`update\` and \`view\` take the clock as their FIRST argument: \`init : Clock -> …\`, \`update : Clock -> Msg -> Model -> …\`, \`view : Clock -> Model -> Screen\`. \`@now\` is \`clock.now\` (a DateTime), \`@today\` is \`clock.today\` (a Date). Compute with the Fmt date helpers; never store the clock in the model unless the spec says to remember a moment.`,
    data: "Data (this spec has sentences in `always`, stored state, lists a reference points into, or lists inside rows): also expose `data : Model -> Data` (the `Data` record in Spec: every state field, with the value the model holds now). The harness checks the `always` sentences, and that the keys of those lists stay unique, on it after every step; keep it exact, never computed differently from the model.",
    screens: "Screens (this spec has several): `update` and `view` also get where the app is, a `Route` (in Spec: `TicketRoute { id }` for `screen ticket`; `@id` is that field), right before the message or model: `update : Route -> Msg -> Model -> ( Model, Go )` (with calls: `( Model, List Call, Go )`), `view : Route -> Model -> Screen`, which returns the current screen's variant (`TicketScreen { … }`). `Go` is `GoTo (TicketRoute { id = … })` for a `go to` step, `GoBack` for `go back`, or `Stay`. When a screen is shown (a link, an address, going back), the harness sends `ScreenOpened route`: do what `on open <that screen>` says, and nothing for a screen without one. The route is the harness's: never keep a copy in the model. With a clock, it comes first: `update : Clock -> Route -> Msg -> Model -> …`, `view : Clock -> Route -> Model -> Screen`.",
    stored: "Stored state (this spec has `stored` fields): also expose `data : Model -> Data` and `restore : Stored -> Model -> Model`. `restore saved model` gets a freshly started model and puts the saved values of the stored fields into it; everything else stays as it starts. Anything the model keeps that depends on stored fields (a next id, a cache) must be brought in line with the restored values. The harness saves `data` after every update and restores it when the app starts again.",
    started: "On start (this spec has `stored` fields and `on start`): `on start` is the message `Started`, handled in `update` like any other; it is not `init`. `init` is the app as it starts from the spec's defaults and does nothing else (with calls: `( model, [] )`). The harness starts the app with `init`, puts the stored fields back with `restore`, and then sends `Started`, so `on start` sees what the app remembered. It does this every time the app starts, a restart too.",
    platform: "Platform functions (this spec imports one): a sentence that names a function (`the @sha256 of the given @text`) calls exactly that function, from `Spec` (`sha256 : String -> String`). It is the installation's reviewed code: never write your own version of what it does.",
    draws: `Draws (this spec draws random values): \`update\` takes the event's draws (the \`Draws\` record in Spec) right before the message, after the clock and the route when there are: \`update : Draws -> Msg -> Model -> …\`, \`update : Clock -> Draws -> Msg -> Model -> …\`, \`update : Clock -> Route -> Draws -> Msg -> Model -> …\`. Each place a sentence draws (\`a random @Die\`, \`a random @Code not among …\`, \`3 random @Die\`, \`a random one of @xs\`, \`@xs shuffled\`) is one function of \`Draws\`, named after its handler and its place there (\`draws.roll1 ()\`, \`draws.roll2 ()\`, \`draws.deal1 xs\`): call exactly that function where that sentence runs, once per value the sentence needs, in the order the steps say (write the \`let\` bindings in step order), and nowhere else (not in \`view\`, not ahead of time). Pass what the sentence reads: the list to shuffle or pick from, the values taken, how many; inside a \`for each\`, the row's index first (0 for the first row the loop visits). A value that later steps use again is kept (a \`let\`, the model), never drawn again. There is no \`Random\`: the harness makes every value.`,
  },
  open: openElm,
};
