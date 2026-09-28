// Calls from a screen to an API, as data: `{ endpoint: "tickets.createTicket", args: {…} }`.
// The same data goes to `fetch` in the browser and to the provider's test client in tests.
import { fromWire, toWire, type TypeDesc } from "./api.ts";

export interface CallDesc {
  name: string; // "tickets.createTicket": the alias, then the contract's endpoint
  method: string;
  path: string;
  params: { in: string; name: string; type?: TypeDesc }[]; // type: only when a choice in it has wire names
  answers?: Record<number, TypeDesc | null>; // the same, for reading answers back
  external?: boolean; // `effect external` in the contract
  amount?: string; // `effect external of @amount`: the param a permission's `upTo` limits
}

/** A call as data. `key`: its idempotency key, made when the call was made; every attempt sends the same one. */
export type CallOut = { endpoint: string; args: Record<string, unknown>; headers?: Record<string, string>; config?: Record<string, unknown>; key?: string; undo?: boolean };
/** An answer. `unknown`: no answer after the last attempt, for a call that may have had its effect. */
export type Answer = { endpoint: string; status: number; body?: unknown; error?: string; unknown?: boolean; inProgress?: boolean; retryAfterMs?: number; held?: boolean; rejected?: boolean };

/** A held call's first answer (it waits for approval) and a rejected call's last one: status 0, never sent. */
export const heldAnswer = (c: CallOut): Answer => ({ endpoint: c.endpoint, status: 0, error: "waiting for approval", held: true });
export const rejectedAnswer = (c: CallOut): Answer => ({ endpoint: c.endpoint, status: 0, error: "rejected", rejected: true });

// ---------------------------------------------------------------- effectively once (docs/design/effects.md)

/** Attempts per call, in all (Google SRE: after three, give the failure back). */
export const MAX_ATTEMPTS = 3;
/** Sent again: no answer, 5xx and 429. Never another 4xx: the request itself is wrong (AWS, Stripe). */
export const retryable = (status: number) => status === 0 || status === 429 || status >= 500;
const safe = (method: string) => ["GET", "HEAD", "OPTIONS"].includes(method.toUpperCase());

/** A new idempotency key for a call that is being made (the same one for all its attempts). */
export const newKey = (): string => (globalThis.crypto?.randomUUID ? globalThis.crypto.randomUUID() : `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`);

/** The key a call goes out with. An undo's key is what it undoes (`undo pay.refund {"id":7}`), so
 *  undoing twice sends the same key and the service answers the first undo again: an effect that
 *  was already taken back is not taken back twice. Every other call gets a new key. */
export const keyFor = (c: CallOut): string => (c.undo ? `undo ${c.endpoint} ${JSON.stringify(c.args)}` : newKey());

/**
 * Send a call until it is answered or its attempts run out. `attempt(n)` sends it once (n = 1, 2, 3);
 * `pause(n)` waits before attempt n + 1 (backoff with jitter in the browser, nothing in tests). A
 * non-safe call to an `effect external` endpoint that still has no answer (or a 5xx, or is still in
 * progress) at the end may have happened: its answer is `unknown`, never a plain failure (Stripe
 * treats a 500 as indeterminate).
 */
export async function persist(desc: CallDesc | undefined, attempt: (n: number) => Promise<Answer>, pause: (n: number, last: Answer) => Promise<void> = async () => {}): Promise<Answer> {
  let a = await attempt(1);
  // 409 `idempotent-in-progress` (the service is still doing the first attempt): wait and send the same key again.
  for (let n = 2; n <= MAX_ATTEMPTS && (retryable(a.status) || a.inProgress); n++) {
    await pause(n - 1, a);
    a = await attempt(n);
  }
  delete a.retryAfterMs;
  // Still in progress after the last attempt: the service is doing it, so it will likely happen.
  if (desc?.external && !safe(desc.method) && (a.status === 0 || a.status >= 500 || a.inProgress)) return { endpoint: a.endpoint, status: 0, error: a.error ?? (a.inProgress ? `still in progress after ${MAX_ATTEMPTS} attempts` : `no answer after ${MAX_ATTEMPTS} attempts (last: ${a.status})`), unknown: true };
  return a;
}

/** Exponential backoff with full jitter (Brooker): up to 200 ms, 400 ms, … before each retry. When
 *  the service said when to come back (`Retry-After` on a 429 or 503), that wait, up to 10 s. */
export const backoff = (n: number, last?: Answer) =>
  new Promise<void>((r) => setTimeout(r, last?.retryAfterMs !== undefined ? Math.min(last.retryAfterMs, 10_000) : Math.random() * 200 * 2 ** (n - 1)));

/** `Retry-After` (RFC 9110): seconds, or an HTTP date. */
export function retryAfter(value: string | null, now = Date.now()): number | undefined {
  if (!value) return undefined;
  if (/^\d+$/.test(value.trim())) return Number(value.trim()) * 1000;
  const at = Date.parse(value);
  return Number.isNaN(at) ? undefined : Math.max(0, at - now);
}

/** A call as HTTP: method, path (with path params filled in), query and JSON body. */
export function toHttp(eps: { name: string; method: string; path: string; params: { in: string; name: string; type?: TypeDesc }[] }[], c: CallOut) {
  const ep = eps.find((e) => e.name === c.endpoint);
  if (!ep) throw new Error(`no endpoint ${c.endpoint}`);
  let path = ep.path;
  const query: Record<string, string> = {};
  const body: Record<string, unknown> = {};
  let hasBody = false;
  for (const p of ep.params) {
    if (!(p.name in c.args)) continue;
    const v = toWire(c.args[p.name], p.type); // a choice goes out by its wire name
    if (p.in === "path") path = path.replace(`{${p.name}}`, encodeURIComponent(String(v)));
    else if (p.in === "query") {
      if (v !== null && v !== undefined) query[p.name] = String(v);
    } else (body[p.name] = v), (hasBody = true);
  }
  // A path param that was not given stays literally "{id}" and does not match a number: like a client that forgot it.
  return { method: ep.method, path, query, body: hasBody || ep.params.some((p) => p.in === "body") ? body : undefined };
}

/** A call as it leaves: method, path, query, headers and body (what a client layer may change). */
export type Outgoing = { method: string; path: string; query: Record<string, string>; headers: Record<string, string>; body: unknown };

/** Client layers per alias (`uses … through std.http.sendKey`): the call, and the layer's config from the app's state. */
export type Via = (alias: string, req: Outgoing) => Outgoing;

export function outgoing(eps: CallDesc[], c: CallOut, via?: Via): Outgoing {
  const h = toHttp(eps, c);
  const req: Outgoing = { method: h.method, path: h.path, query: h.query, headers: { ...(c.headers ?? {}), ...(c.key && !safe(h.method) ? { "idempotency-key": c.key } : {}) }, body: h.body };
  return via ? via(c.endpoint.split(".")[0], req) : req;
}

/**
 * Where an api lives, in the browser: the \`api.<alias>\` query parameter, else \`api\`, else the
 * page's own origin. Where a service is hosted is deployment, not intent: it is never in the spec.
 */
export function apiBase(alias = ""): string {
  const q = typeof location !== "undefined" ? new URLSearchParams(location.search) : new URLSearchParams();
  return (q.get(`api.${alias}`) ?? q.get("api") ?? "").replace(/\/$/, "");
}

/**
 * Listen to each api's events (Server-Sent Events at <base>/events), for the events this app
 * handles. The stream is read with fetch, so client layers can add headers (a key); \`refresh\`
 * reopens a stream when what the layers would send has changed (the user signed in).
 */
export function listen(events: Record<string, string[]>, deliver: (e: { event: string; body: unknown }) => void, via?: Via, types: Record<string, TypeDesc> = {}): { refresh: () => void } {
  // A host's transport owns events too (below); without one, the stream is Server-Sent Events.
  const t = transport();
  const open = new Map<string, { key: string; stop: () => void }>();
  const connect = (alias: string) => {
    let req: Outgoing;
    try {
      req = via ? via(alias, { method: "GET", path: "/events", query: {}, headers: {}, body: undefined }) : { method: "GET", path: "/events", query: {}, headers: {}, body: undefined };
    } catch {
      return; // the client layer has no config yet (the app has not told it its state): open the stream later
    }
    const key = JSON.stringify(req);
    if (open.get(alias)?.key === key) return;
    open.get(alias)?.stop();
    open.delete(alias);
    const handle = (e: { event: string; body: unknown }) => {
      if (events[alias].includes(e.event)) deliver({ event: `${alias}.${e.event}`, body: fromWire(e.body, types[`${alias}.${e.event}`]) });
    };
    if (t) {
      // The host subscribes with the request the client layers would send (a key), and gets a new
      // subscription when that changes. A host without `listen` has no events for this app.
      if (t.listen) open.set(alias, { key, stop: t.listen(alias, req, handle) });
      return;
    }
    const ctl = new AbortController();
    open.set(alias, { key, stop: () => ctl.abort() });
    const qs = new URLSearchParams(req.query).toString();
    fetch(apiBase(alias) + req.path + (qs ? "?" + qs : ""), { headers: { ...req.headers, accept: "text/event-stream" }, signal: ctl.signal })
      .then(async (res) => {
        if (!res.ok || !res.body) return;
        const reader = res.body.pipeThrough(new TextDecoderStream()).getReader();
        let buf = "";
        for (;;) {
          const { value, done } = await reader.read();
          if (done) return;
          buf += value;
          let cut: number;
          while ((cut = buf.indexOf("\n\n")) >= 0) {
            const chunk = buf.slice(0, cut);
            buf = buf.slice(cut + 2);
            const data = chunk.split("\n").filter((l) => l.startsWith("data:")).map((l) => l.slice(5).trim()).join("\n");
            if (!data) continue;
            try {
              handle(JSON.parse(data) as { event: string; body: unknown });
            } catch {
              // not an event: ignore
            }
          }
        }
      })
      .catch(() => {});
  };
  const refresh = () => {
    for (const alias of Object.keys(events)) if (events[alias].length) connect(alias);
  };
  refresh();
  return { refresh };
}

// ---------------------------------------------------------------- agreement (`through std.actions`)

/** A standing permission (`Permission` in lib/std/actions.intent): an endpoint, how many calls a
 *  period allows, and the most each may amount to. `null` (nothing) is no limit / nobody named. */
export interface Permission {
  endpoint: string; // "pay.charge" (or "charge")
  count: number; // calls this permission lets through per period (a one-time grant: 1)
  per?: number | null; // the period in minutes (nothing: the count applies forever)
  upTo?: number | null; // the most each call may amount to (nothing: no amount limit)
  approver?: string | null; // who granted it; with four eyes it is not the requester
}
/** A call already let through, and the permission that let it through (its place among the equal ones). */
export interface Usage {
  at: number; // milliseconds since the epoch
  by: string;
}

/** What the agreement gate decides for a new call: send it, hold it for approval, or refuse it (the
 *  emergency stop). `config` is the `std.actions` layer's params from the state. */
export type Gate = "send" | "hold" | "stop";

const gated = (config: Record<string, unknown> | undefined) => !!config && ("stop" in config || "agree" in config);
const names = (name: string) => [name, name.split(".")[1]];

/** Each permission, named so the calls it let through count against it alone: two one-time grants
 *  for the same endpoint are two payments, not one. */
function permissions(config: Record<string, unknown>, name: string): { p: Permission; by: string }[] {
  const agree = Array.isArray(config.agree) ? (config.agree as Permission[]) : [];
  const seen: Record<string, number> = {};
  return agree
    .filter((p) => p && names(name).includes(p.endpoint))
    .map((p) => {
      const id = JSON.stringify([p.endpoint, p.count, p.per ?? null, p.upTo ?? null, p.approver ?? null]);
      seen[id] = (seen[id] ?? 0) + 1;
      return { p, by: `${id}#${seen[id]}` };
    });
}

/**
 * The permission that covers a call now, or undefined. An amount limit (`upTo`) reads the param the
 * contract names (`effect external of @amount`); an endpoint that names none is not covered by a
 * permission with a limit (it cannot be measured, so it waits for a person).
 */
export function covering(config: Record<string, unknown>, desc: CallDesc, args: Record<string, unknown>, usage: Usage[], now: number): string | undefined {
  const fourEyes = config.fourEyes === true;
  const requester = typeof config.requester === "string" ? config.requester : undefined;
  const size = desc.amount !== undefined ? Number(args[desc.amount]) : NaN;
  const found = permissions(config, desc.name).find(({ p, by }) => {
    if (fourEyes && requester !== undefined && p.approver === requester) return false; // four eyes
    if (p.upTo != null && !(Number.isFinite(size) && size <= p.upTo)) return false;
    const mine = usage.filter((u) => u.by === by);
    const recent = p.per != null ? mine.filter((u) => now - u.at < p.per! * 60_000) : mine;
    return recent.length < p.count;
  });
  return found?.by;
}

export function gate(config: Record<string, unknown> | undefined, desc: CallDesc | undefined, args: Record<string, unknown> = {}, usage: Usage[] = [], now = 0): Gate {
  if (!gated(config)) return "send";
  if (config!.stop === true) return "stop";
  if (!desc?.external) return "send";
  return covering(config!, desc, args, usage, now) ? "send" : "hold";
}

/** The one refusal answered at once: the emergency stop. A call with no permission is held. */
export function refused(config: Record<string, unknown> | undefined): string | undefined {
  return config && config.stop === true ? "external calls are stopped (the emergency stop is on)" : undefined;
}

/** Where the agreement keeps what must survive a reload: the held calls, the calls each permission
 *  let through, and how many rejections it has applied. `keep()` in outbox.ts is the browser's. */
export interface Keep {
  get<T>(key: string, empty: T): T;
  set(key: string, value: unknown): void;
}

/**
 * The agreement for one screen: `offer` decides a new call, `release` (after every update) drops the
 * held calls a new rejection covers and lets out the ones a permission now covers. A rejection
 * (`add "pay.charge" to @rejected`) drops the calls held *when it is given*; a later call is held
 * again, as a person asked about that one payment, not about every payment to come.
 */
export function agreement(eps: CallDesc[], keep: Keep) {
  const desc = (c: CallOut) => eps.find((e) => e.name === c.endpoint);
  const held = () => keep.get<CallOut[]>("held", []);
  const used = () => keep.get<Record<string, Usage[]>>("used", {});
  const applied = () => keep.get<Record<string, number>>("rejected", {});
  const rejections = (config: Record<string, unknown> | undefined, name: string) =>
    Array.isArray(config?.rejected) ? (config!.rejected as string[]).filter((x) => names(name).includes(x)).length : 0;
  /** Note a call let through against the permission that covered it. */
  const letGo = (config: Record<string, unknown> | undefined, c: CallOut, now: number) => {
    const d = desc(c);
    if (!gated(config) || !d?.external) return;
    const u = used();
    const by = covering(config!, d, c.args, u[c.endpoint] ?? [], now);
    if (by) keep.set("used", { ...u, [c.endpoint]: [...(u[c.endpoint] ?? []), { at: now, by }] });
  };
  /** Rejections given for an endpoint since last time: they apply to the calls held now. */
  const fresh = (config: Record<string, unknown> | undefined, name: string) => {
    const n = rejections(config, name);
    const a = applied();
    if (n === (a[name] ?? 0)) return false;
    keep.set("rejected", { ...a, [name]: n }); // a shorter list (the app cleared it) resets the count
    return n > (a[name] ?? 0);
  };
  return {
    held,
    offer(c: CallOut, config: Record<string, unknown> | undefined, now: number): Gate {
      fresh(config, c.endpoint); // a rejection given before this call was made is not about it
      const how = gate(config, desc(c), c.args, used()[c.endpoint] ?? [], now);
      if (how === "hold") keep.set("held", [...held(), c]);
      if (how === "send") letGo(config, c, now);
      return how;
    },
    release(configFor: (alias: string) => Record<string, unknown> | undefined, now: number): { send: CallOut[]; dropped: CallOut[] } {
      const send: CallOut[] = [], dropped: CallOut[] = [], stay: CallOut[] = [];
      const rejected = new Set<string>();
      for (const c of held()) {
        const config = configFor(c.endpoint.split(".")[0]);
        if (rejected.has(c.endpoint) || fresh(config, c.endpoint)) {
          rejected.add(c.endpoint);
          dropped.push(c);
        } else if (gate(config, desc(c), c.args, used()[c.endpoint] ?? [], now) === "send") {
          letGo(config, c, now);
          send.push(c);
        } else stay.push(c);
      }
      keep.set("held", stay);
      return { send, dropped };
    },
  };
}

/**
 * The host's transport (OurOS, a test host, a bus): it owns sending a call and listening to events
 * end to end, instead of the generated `fetch`/SSE. Set `globalThis.__intentTransport` before the
 * app starts. `req` is the HTTP-shaped request *after* the client layers, so `via` still applies;
 * route by `endpoint` and ignore the URL if the host has no HTTP.
 */
export interface Transport {
  send(req: Outgoing & { alias: string; endpoint: string }): Promise<{ status: number; body?: unknown; error?: string; inProgress?: boolean; retryAfterMs?: number }> | { status: number; body?: unknown; error?: string; inProgress?: boolean; retryAfterMs?: number };
  /** Subscribe to one alias's events, with the stream request after the client layers (`GET
   *  /events` and its headers: a key); returns an unsubscribe. Called again, after the old one is
   *  unsubscribed, when that request changes (the user signed in). Without it: no events. */
  listen?(alias: string, req: Outgoing, onEvent: (e: { event: string; body: unknown }) => void): () => void;
}

export const transport = (): Transport | undefined => (globalThis as { __intentTransport?: Transport }).__intentTransport;

/**
 * Perform a call over the host's transport when one is set, else over HTTP: sent again (with the same
 * idempotency key) when the answer is lost, a 5xx or a 429, up to three attempts. Never throws.
 */
let flying = 0;
/** Calls sent and not yet answered (a headless job waits for them before it says it is done). */
export const inFlight = () => flying;

export async function fetchCall(eps: CallDesc[], c: CallOut, via?: Via, config?: Record<string, unknown>): Promise<Answer> {
  flying++;
  try {
    return await fetchCallOnce(eps, c, via, config);
  } finally {
    flying--;
  }
}

async function fetchCallOnce(eps: CallDesc[], c: CallOut, via?: Via, config?: Record<string, unknown>): Promise<Answer> {
  const desc = eps.find((e) => e.name === c.endpoint);
  const no = refused(config);
  if (no) return { endpoint: c.endpoint, status: 0, error: no };
  const t = transport();
  // A choice comes back by its wire name: read the answer in the spec's names.
  const read = (a: Answer): Answer => (desc?.answers && a.body !== undefined ? { ...a, body: fromWire(a.body, desc.answers[a.status]) } : a);
  if (!t) return read(await persist(desc, () => fetchOnce(eps, c, via), backoff));
  const alias = c.endpoint.split(".")[0];
  return persist(desc, async () => {
    const req = outgoing(eps, c, via);
    try {
      const r = await t.send({ ...req, alias, endpoint: c.endpoint });
      return { endpoint: c.endpoint, status: r.status, body: r.body, error: r.error, ...(r.inProgress ? { inProgress: true } : {}), ...(r.retryAfterMs !== undefined ? { retryAfterMs: r.retryAfterMs } : {}) };
    } catch (e) {
      return { endpoint: c.endpoint, status: 0, error: `no answer: ${(e as Error).message}` };
    }
  }, backoff).then(read);
}

async function fetchOnce(eps: CallDesc[], c: CallOut, via?: Via): Promise<Answer> {
  try {
    const h = outgoing(eps, c, via);
    const qs = new URLSearchParams(h.query).toString();
    const res = await fetch(apiBase(c.endpoint.split(".")[0]) + h.path + (qs ? "?" + qs : ""), { method: h.method, headers: { "content-type": "application/json", ...h.headers }, body: h.body === undefined ? undefined : JSON.stringify(h.body) });
    const text = await res.text();
    // 409 with this header: the service is still doing the first attempt; send the same key again.
    const inProgress = res.headers.get("idempotent-in-progress") === "true";
    const wait = res.status === 429 || res.status === 503 ? retryAfter(res.headers.get("retry-after")) : undefined;
    return { endpoint: c.endpoint, status: res.status, body: text ? JSON.parse(text) : null, ...(inProgress ? { inProgress: true } : {}), ...(wait !== undefined ? { retryAfterMs: wait } : {}) };
  } catch (e) {
    return { endpoint: c.endpoint, status: 0, error: `no answer: ${(e as Error).message}` };
  }
}
