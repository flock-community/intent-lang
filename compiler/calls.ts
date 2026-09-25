// Screens that call APIs (`uses <contract> as <alias>`): what every target needs to know about
// them. Per contract endpoint: a Call variant (what the app sends), an answer type (per status, as
// the contract declares it) and an answer message; each target writes those (targets/elm.ts,
// targets/ts.ts). Calls leave the app as data, `{ endpoint: "tickets.createTicket", args: {…} }`;
// answers come back as the wire event `{ on: "answer", target: <endpoint>, answer: { … } }`.
import type { App, Endpoint, LayerUse, Type } from "./ast.ts";
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
  return clientEndpoints(app).map((c) => ({ name: c.name, method: c.ep.method, path: c.ep.path, params: c.ep.params.map((p) => ({ in: p.in, name: p.name })), ...(c.ep.effect ? { external: true } : {}) }));
}
