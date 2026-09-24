// Screens that call APIs (`uses <contract> as <alias>`): the generated half of the interface.
// Per contract endpoint: a Call variant (what the app sends), an answer type (per status, as the
// contract declares it) and an answer message. Calls leave the app as data,
// `{ endpoint: "tickets.createTicket", args: {…} }`; answers come back as the wire event
// `{ on: "answer", target: <endpoint>, answer: { endpoint, status, body | error } }`.
import type { App, Endpoint, LayerUse, Type } from "./ast.ts";
import { elmAtom, elmType, tsType } from "./gen.ts";
import { typeDesc } from "./api.ts";
import { layerConfig } from "./layer.ts";
import type { CallDesc } from "../runtime/ts/calls.ts";

const cap = (s: string) => s[0].toUpperCase() + s.slice(1);
const lowerFirst = (s: string) => s[0].toLowerCase() + s.slice(1);
const q = (s: string) => JSON.stringify(s);

export interface ClientEndpoint {
  alias: string;
  ep: Endpoint;
  name: string; // "tickets.createTicket"
  tag: string; // "TicketsCreateTicket"
}

export function clientEndpoints(app: App): ClientEndpoint[] {
  return (app.clients ?? []).flatMap((c) => (c.contract.endpoints ?? []).map((ep) => ({ alias: c.alias, ep, name: `${c.alias}.${ep.name}`, tag: cap(c.alias) + cap(ep.name) })));
}

export const hasClients = (app: App) => clientEndpoints(app).length > 0;

export interface ClientEvent {
  alias: string;
  name: string; // "tickets.ticketCreated"
  tag: string; // "TicketsTicketCreated"
  type: Type;
}

/** The events this app handles (\`on event tickets.ticketCreated\`): only those get a message. */
export function clientEvents(app: App): ClientEvent[] {
  const handled = new Set(app.handlers.filter((h) => h.verb === "event").map((h) => h.target));
  return (app.clients ?? []).flatMap((c) => (c.contract.events ?? []).filter((e) => handled.has(`${c.alias}.${e.name}`)).map((e) => ({ alias: c.alias, name: `${c.alias}.${e.name}`, tag: cap(c.alias) + cap(e.name), type: e.type })));
}

/** Per alias with a client layer: its params bound to state (the app computes them) and to literals (fixed). */
export function throughs(app: App): { alias: string; use: LayerUse; state: { param: string; field: string; type: Type }[]; fixed: Record<string, unknown> }[] {
  return (app.clients ?? []).filter((c) => c.through?.spec).map((c) => {
    const use = c.through!;
    const params = use.spec!.params ?? [];
    const state = use.bindings.filter((b) => b.state).map((b) => ({ param: b.name, field: b.state!, type: params.find((p) => p.name === b.name)?.type ?? ({ k: "Text" } as Type) }));
    return { alias: c.alias, use, state, fixed: layerConfig(use.spec!, use.bindings.filter((b) => !b.state)) };
  });
}

export const hasThrough = (app: App) => throughs(app).length > 0;

/** Per alias, the events of its api this app handles (each api has its own event stream). */
export function eventsByAlias(app: App): Record<string, string[]> {
  const out: Record<string, string[]> = {};
  for (const c of app.clients ?? []) out[c.alias] = [];
  for (const e of clientEvents(app)) out[e.alias].push(e.name.split(".")[1]);
  return out;
}

/** Method, path and params per callable endpoint: how a call becomes an HTTP request. */
export function callDescs(app: App): CallDesc[] {
  return clientEndpoints(app).map((c) => ({ name: c.name, method: c.ep.method, path: c.ep.path, params: c.ep.params.map((p) => ({ in: p.in, name: p.name })) }));
}

// ---------------------------------------------------------------- TypeScript

export function genTsCalls(app: App): string {
  const eps = clientEndpoints(app);
  const out: string[] = [];
  out.push(`/** A request to an API, made by returning it from init or update. It is answered later by an \`…Answered\` message. */\nexport type Call =\n${eps.map((c) => `  | { call: ${q(c.name)}${c.ep.params.length ? `; args: { ${c.ep.params.map((p) => `${p.name}: ${tsType(p.type)}`).join("; ")} }` : ""} }`).join("\n")};\n\n`);
  for (const c of eps) {
    const variants = (c.ep.answers ?? []).map((a) => `{ status: ${a.status}; body: ${a.type ? tsType(a.type) : "null"} }`);
    out.push(`/** What ${c.ep.method} ${c.ep.path} answers, per status (the contract). Status 0: no answer the contract allows (network down, or a body of the wrong shape). */\nexport type ${c.tag}Answer = ${[...variants, "{ status: 0; error: string }"].join(" | ")};\n`);
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
  out.push(`export function fromAnswer(a: Answer): Msg | null {\n  const tag = ANSWERED[a.endpoint];\n  if (!tag) return null;\n  if (a.status === 0 || a.error !== undefined) return { tag, answer: { status: 0, error: a.error ?? "no answer" } } as Msg;\n  const body = a.body === undefined ? null : a.body;\n  const problem = conforms(callAnswers[a.endpoint], { status: a.status, body });\n  return { tag, answer: problem ? { status: 0, error: \`\${a.endpoint} \${problem}\` } : { status: a.status, body } } as Msg;\n}\n`);
  return out.join("");
}

export const tsAnswerMsgs = (app: App) => [
  ...clientEndpoints(app).map((c) => `{ tag: ${q(c.tag + "Answered")}; answer: ${c.tag}Answer }`),
  ...clientEvents(app).map((e) => `{ tag: ${q(e.tag)}; body: ${tsType(e.type)} }`),
];

// ---------------------------------------------------------------- Elm

function elmDecoder(app: App, t: Type): string {
  switch (t.k) {
    case "Text": return "D.string";
    case "Int": return "D.int";
    case "Decimal": return "D.float";
    case "Bool": return "D.bool";
    case "List": return `(D.list ${elmDecoder(app, t.of)})`;
    case "Maybe": return `(D.nullable ${elmDecoder(app, t.of)})`;
    case "Named": {
      const r = app.refined?.find((x) => x.name === t.name);
      if (r) return r.base === "Text" ? "D.string" : r.base === "Int" ? "D.int" : "D.float";
      return `decode${t.name}`;
    }
  }
}

function elmEncoder(app: App, t: Type, v: string, d = 0): string {
  switch (t.k) {
    case "Text": return `J.string ${v}`;
    case "Int": return `J.int ${v}`;
    case "Decimal": return `J.float ${v}`;
    case "Bool": return `J.bool ${v}`;
    case "List": return `J.list (\\x${d} -> ${elmEncoder(app, t.of, `x${d}`, d + 1)}) ${v}`;
    case "Maybe": return `Maybe.withDefault J.null (Maybe.map (\\x${d} -> ${elmEncoder(app, t.of, `x${d}`, d + 1)}) ${v})`;
    case "Named": {
      const r = app.refined?.find((x) => x.name === t.name);
      if (r) return elmEncoder(app, { k: r.base } as Type, v, d);
      return `encode${t.name} ${v}`;
    }
  }
}

export function genElmCalls(app: App): string {
  const eps = clientEndpoints(app);
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
  out.push(`{-| A request to an API, made by returning it from init or update. It is answered later by an \`…Answered\` message. -}\ntype Call\n    = ${eps.map((c) => `${c.tag}${c.ep.params.length ? ` { ${c.ep.params.map((p) => `${p.name} : ${elmType(p.type)}`).join(", ")} }` : ""}`).join("\n    | ")}\n\n\n`);
  for (const c of eps) {
    const variants = (c.ep.answers ?? []).map((a) => `${c.tag}${a.status}${a.type ? ` ${elmAtom(a.type)}` : ""}`);
    out.push(`{-| What ${c.ep.method} ${c.ep.path} answers, per status (the contract). Failed: no answer the contract allows (network down, or a body of the wrong shape). -}\ntype ${c.tag}Answer\n    = ${[...variants, `${c.tag}Failed String`].join("\n    | ")}\n\n\n`);
  }
  const th = throughs(app);
  if (th.length) {
    out.push(`{-| What the client layers need from the app's state, per api (\`through\` in \`uses\`): \`through model\` in the app module computes it. -}\ntype alias Through =\n    { ${th.map((t) => `${t.alias} : { ${t.state.map((x) => `${x.param} : ${elmType(x.type)}`).join(", ")} }`).join("\n    , ")}\n    }\n\n\n`);
    out.push(`{-| A call as it leaves, with the config of its api's client layer. -}\ncallOut : Through -> Call -> J.Value\ncallOut th c =\n    let\n        v =\n            callToJson c\n\n        alias =\n            Result.withDefault "" (D.decodeValue (D.field "endpoint" D.string) v) |> String.split "." |> List.head |> Maybe.withDefault ""\n\n        config =\n            case alias of\n${th.map((t) => `                ${q(t.alias)} ->\n                    J.object [ ${t.state.map((x) => `( ${q(x.param)}, ${elmEncoder(app, x.type, `th.${t.alias}.${x.param}`)} )`).join(", ")} ]\n`).join("\n")}\n                _ ->\n                    J.null\n    in\n    J.object [ ( "endpoint", D.decodeValue (D.field "endpoint" D.value) v |> Result.withDefault J.null ), ( "args", D.decodeValue (D.field "args" D.value) v |> Result.withDefault J.null ), ( "config", config ) ]\n\n\n`);
    out.push(`{-| The client layers' config from the app's state, for the event streams. -}\nencodeThrough : Through -> J.Value\nencodeThrough th =\n    J.object [ ${th.map((t) => `( ${q(t.alias)}, J.object [ ${t.state.map((x) => `( ${q(x.param)}, ${elmEncoder(app, x.type, `th.${t.alias}.${x.param}`)} )`).join(", ")} ] )`).join(", ")} ]\n\n\n`);
  }
  out.push(`callToJson : Call -> J.Value\ncallToJson c =\n    case c of\n${eps
    .map((c) => {
      const args = c.ep.params.map((p) => `( ${q(p.name)}, ${elmEncoder(app, p.type, `a.${p.name}`)} )`);
      return `        ${c.tag}${c.ep.params.length ? " a" : ""} ->\n            J.object [ ( "endpoint", J.string ${q(c.name)} ), ( "args", J.object [ ${args.join(", ")} ] ) ]\n`;
    })
    .join("\n")}\n\n`);
  out.push(`{-| An answer from the outside (\`{ endpoint, status, body }\` or \`{ endpoint, status: 0, error }\`) as a message. -}\nfromAnswer : D.Value -> Maybe Msg\nfromAnswer v =\n    let\n        endpoint =\n            Result.withDefault "" (D.decodeValue (D.field "endpoint" D.string) v)\n\n        status =\n            Result.withDefault 0 (D.decodeValue (D.field "status" D.int) v)\n\n        failure =\n            Result.withDefault ("unexpected answer " ++ String.fromInt status) (D.decodeValue (D.field "error" D.string) v)\n\n        body d ok bad =\n            case D.decodeValue (D.field "body" d) v of\n                Ok x ->\n                    ok x\n\n                Err e ->\n                    bad (endpoint ++ " answered " ++ String.fromInt status ++ ", but the body does not fit: " ++ D.errorToString e)\n    in\n    case endpoint of\n${eps
    .map((c) => {
      const cases = (c.ep.answers ?? []).map((a) => `                        ${a.status} ->\n                            ${a.type ? `body ${elmDecoder(app, a.type)} ${c.tag}${a.status} ${c.tag}Failed` : `${c.tag}${a.status}`}\n`);
      return `        ${q(c.name)} ->\n            Just\n                (${c.tag}Answered\n                    (case status of\n${cases.join("\n")}\n                        _ ->\n                            ${c.tag}Failed failure\n                    )\n                )\n`;
    })
    .join("\n")}\n        _ ->\n            Nothing\n`);
  const evs = clientEvents(app);
  out.push(`\n\n{-| An event from the api (\`{ event: "tickets.ticketCreated", body }\`) as a message; one whose payload does not fit is dropped. -}\nfromEvent : D.Value -> Maybe Msg\nfromEvent v =\n    case D.decodeValue (D.field "event" D.string) v of\n${evs.map((e) => `        Ok ${q(e.name)} ->\n            Result.toMaybe (D.decodeValue (D.field "body" (D.map ${e.tag} ${elmDecoder(app, e.type)})) v)\n`).join("\n")}${evs.length ? "\n" : ""}        _ ->\n            Nothing\n`);
  return out.join("");
}

export const elmAnswerMsgs = (app: App) => [...clientEndpoints(app).map((c) => `${c.tag}Answered ${c.tag}Answer`), ...clientEvents(app).map((e) => `${e.tag} ${elmAtom(e.type)}`)];
