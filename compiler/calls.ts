// Screens that call APIs (`uses <contract> as <alias>`): what every target needs to know about
// them. Per contract endpoint: a Call variant (what the app sends), an answer type (per status, as
// the contract declares it) and an answer message; each target writes those (targets/elm.ts,
// targets/ts.ts). Calls leave the app as data, `{ endpoint: "tickets.createTicket", args: {…} }`;
// answers come back as the wire event `{ on: "answer", target: <endpoint>, answer: { … } }`.
import type { App, Endpoint, LayerUse, Type } from "./ast.ts";
import { layerConfig } from "./layer.ts";
import { usedByAlias } from "./refs.ts";
import { typeDescOf } from "./targets/ts-service.ts";
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

/** An external endpoint behind `through std.actions`: it can be held for approval, and rejected. */
export const gated = (app: App, c: ClientEndpoint) => !!c.ep.effect && app.clients?.find((x) => x.alias === c.alias)?.through?.layer === "std.actions";

/**
 * Endpoints the app can take back (\`undone by\` in the contract): the undo carries the original
 * answer (and the original arguments when the binding uses them); the harness computes the undo
 * endpoint's arguments from the binding, so no app reassembles a refund itself.
 */
export interface Undoable {
  of: ClientEndpoint; // the endpoint taken back
  by: Endpoint; // the endpoint that takes it back
  tag: string; // "PayChargeUndo"
  answer: Type; // the original success answer's type
  usesArgs: boolean; // the binding reads the original call's params
  args: { name: string; from: "answer" | "args"; path: string[]; type: Type }[];
}

export function undoables(app: App): Undoable[] {
  const eps = clientEndpoints(app);
  return eps.flatMap((c) => {
    const u = c.ep.undoneBy;
    const by = u && c.ep.method !== "GET" ? eps.find((x) => x.alias === c.alias && x.ep.name === u.endpoint)?.ep : undefined;
    const answer = c.ep.answers?.find((a) => a.status < 300 && a.type)?.type;
    if (!u || !by || !answer) return [];
    const args = u.args.map((a) => {
      const path = a.value.slice(1).split(".");
      const type = by.params.find((p) => p.name === a.name)!.type;
      return path[0] === c.ep.name && path[1] === "body" ? { name: a.name, from: "answer" as const, path: path.slice(2), type } : { name: a.name, from: "args" as const, path: [path[0]], type };
    });
    return [{ of: c, by, tag: c.tag + "Undo", answer, usesArgs: args.some((a) => a.from === "args"), args }];
  });
}

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
  return clientEndpoints(app).map((c) => {
    // Types only where a choice has wire names (the runtime translates those at the edge), and for a
    // `T or nothing` param (nothing is sent as `null`, never left out).
    // Types resolve in the app (its imports bring the contract's records and choices), else the contract.
    const contract = scope(app, app.clients!.find((x) => x.alias === c.alias)!.contract);
    const wired = (t: Type) => wireType(contract, t);
    const answers = (c.ep.answers ?? []).some((a) => a.type && wired(a.type)) ? Object.fromEntries((c.ep.answers ?? []).map((a) => [a.status, a.type ? typeDescOf(contract, a.type) : null])) : undefined;
    return { name: c.name, method: c.ep.method, path: c.ep.path, params: c.ep.params.map((p) => ({ in: p.in, name: p.name, ...(wired(p.type) || p.type.k === "Maybe" ? { type: typeDescOf(contract, p.type) } : {}) })), ...(answers ? { answers } : {}), ...(c.ep.effect ? { external: true } : {}), ...(c.ep.effect?.of ? { amount: c.ep.effect.of } : {}) };
  });
}

/** Does a type (read in the app that declares it) hold a choice with wire names? */
export function wireType(app: App, t: Type): boolean {
  return t.k === "List" || t.k === "Maybe" ? wireType(app, t.of) : t.k === "Named" ? !!app.choices.find((c) => c.name === t.name)?.wire || !!app.records.find((r) => r.name === t.name)?.fields.some((f) => wireType(app, f.type)) : false;
}

/** The payload types of the events the app handles whose choices have wire names, by `alias.event`. */
export function eventWireTypes(app: App): Record<string, ReturnType<typeof typeDescOf>> {
  const out: Record<string, ReturnType<typeof typeDescOf>> = {};
  for (const c of app.clients ?? []) {
    const types = scope(app, c.contract);
    for (const e of c.contract.events ?? []) if (wireType(types, e.type)) out[`${c.alias}.${e.name}`] = typeDescOf(types, e.type);
  }
  return out;
}

/** The records and choices a contract's types can name: the contract's own and the app's (its imports). */
const scope = (app: App, contract: App): App => ({ ...contract, records: [...contract.records, ...app.records], choices: [...contract.choices, ...app.choices], refined: [...(contract.refined ?? []), ...(app.refined ?? [])] });

/**
 * The manifest (`manifest.json` in a build): per api, the contract and the endpoints and events
 * the app may use — the `only` list of its `uses` when it has one, else what its handlers use. A
 * host (OurOS) grants exactly these and refuses the rest.
 */
export function manifest(app: App): Record<string, { contract: string; declared: boolean; endpoints: string[]; events: string[] }> {
  const used = usedByAlias(app);
  const out: Record<string, { contract: string; declared: boolean; endpoints: string[]; events: string[] }> = {};
  for (const c of app.clients ?? []) {
    const eps = new Set((c.contract.endpoints ?? []).map((e) => e.name));
    const names = c.only ?? [...used[c.alias].endpoints, ...used[c.alias].events];
    out[c.alias] = { contract: c.contract.name, declared: !!c.only, endpoints: names.filter((n) => eps.has(n)).sort(), events: names.filter((n) => !eps.has(n)).sort() };
  }
  return out;
}
