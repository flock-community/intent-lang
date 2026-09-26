// Calls from a screen to an API, as data: `{ endpoint: "tickets.createTicket", args: {…} }`.
// The same data goes to `fetch` in the browser and to the provider's test client in tests.

export interface CallDesc {
  name: string; // "tickets.createTicket": the alias, then the contract's endpoint
  method: string;
  path: string;
  params: { in: string; name: string }[];
  external?: boolean; // `effect external` in the contract
}

/** A call as data. `key`: its idempotency key, made when the call was made; every attempt sends the same one. */
export type CallOut = { endpoint: string; args: Record<string, unknown>; headers?: Record<string, string>; config?: Record<string, unknown>; key?: string };
/** An answer. `unknown`: no answer after the last attempt, for a call that may have had its effect. */
export type Answer = { endpoint: string; status: number; body?: unknown; error?: string; unknown?: boolean };

// ---------------------------------------------------------------- effectively once (docs/design/effects.md)

/** Attempts per call, in all (Google SRE: after three, give the failure back). */
export const MAX_ATTEMPTS = 3;
/** Sent again: no answer, 5xx and 429. Never another 4xx: the request itself is wrong (AWS, Stripe). */
export const retryable = (status: number) => status === 0 || status === 429 || status >= 500;
const safe = (method: string) => ["GET", "HEAD", "OPTIONS"].includes(method.toUpperCase());

/** A new idempotency key for a call that is being made (the same one for all its attempts). */
export const newKey = (): string => (globalThis.crypto?.randomUUID ? globalThis.crypto.randomUUID() : `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`);

/**
 * Send a call until it is answered or its attempts run out. `attempt(n)` sends it once (n = 1, 2, 3);
 * `pause(n)` waits before attempt n + 1 (backoff with jitter in the browser, nothing in tests). A
 * non-safe call to an `effect external` endpoint that still has no answer (or a 5xx) at the end may
 * have happened: its answer is `unknown`, never a plain failure (Stripe treats a 500 as indeterminate).
 */
export async function persist(desc: CallDesc | undefined, attempt: (n: number) => Promise<Answer>, pause: (n: number) => Promise<void> = async () => {}): Promise<Answer> {
  let a = await attempt(1);
  for (let n = 2; n <= MAX_ATTEMPTS && retryable(a.status); n++) {
    await pause(n - 1);
    a = await attempt(n);
  }
  if (desc?.external && !safe(desc.method) && (a.status === 0 || a.status >= 500)) return { endpoint: a.endpoint, status: 0, error: a.error ?? `no answer after ${MAX_ATTEMPTS} attempts (last: ${a.status})`, unknown: true };
  return a;
}

/** Exponential backoff with full jitter (Brooker): up to 200 ms, 400 ms, … before each retry. */
export const backoff = (n: number) => new Promise<void>((r) => setTimeout(r, Math.random() * 200 * 2 ** (n - 1)));

/** A call as HTTP: method, path (with path params filled in), query and JSON body. */
export function toHttp(eps: { name: string; method: string; path: string; params: { in: string; name: string }[] }[], c: CallOut) {
  const ep = eps.find((e) => e.name === c.endpoint);
  if (!ep) throw new Error(`no endpoint ${c.endpoint}`);
  let path = ep.path;
  const query: Record<string, string> = {};
  const body: Record<string, unknown> = {};
  let hasBody = false;
  for (const p of ep.params) {
    if (!(p.name in c.args)) continue;
    const v = c.args[p.name];
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
export function listen(events: Record<string, string[]>, deliver: (e: { event: string; body: unknown }) => void, via?: Via): { refresh: () => void } {
  const open = new Map<string, { key: string; stop: AbortController }>();
  const connect = (alias: string) => {
    let req: Outgoing;
    try {
      req = via ? via(alias, { method: "GET", path: "/events", query: {}, headers: {}, body: undefined }) : { method: "GET", path: "/events", query: {}, headers: {}, body: undefined };
    } catch {
      return; // the client layer has no config yet (the app has not told it its state): open the stream later
    }
    const key = JSON.stringify(req);
    if (open.get(alias)?.key === key) return;
    open.get(alias)?.stop.abort();
    const stop = new AbortController();
    open.set(alias, { key, stop });
    const qs = new URLSearchParams(req.query).toString();
    fetch(apiBase(alias) + req.path + (qs ? "?" + qs : ""), { headers: { ...req.headers, accept: "text/event-stream" }, signal: stop.signal })
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
              const d = JSON.parse(data) as { event: string; body: unknown };
              if (events[alias].includes(d.event)) deliver({ event: `${alias}.${d.event}`, body: d.body });
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

/** A standing permission: an endpoint, how many calls a period allows, and the most each may amount to. */
export interface Permission {
  endpoint: string; // "pay.charge"
  count: number; // calls allowed per period (a one-time grant: 1)
  per: number; // the period in minutes (0: the count applies forever)
  upTo: number; // the most each call may amount to (0: no limit)
  approver: string; // who granted it ("" when nobody is named); with four eyes it is not the requester
}
/** A call already let through, for enforcing a permission's count and period. */
export interface Usage {
  at: number; // milliseconds since the epoch
  amount: number;
}

/** What the agreement gate decides for a call: send it, hold it for approval, drop it (rejected),
 *  or refuse it (the emergency stop). `config` is the `std.actions` layer's params from the state. */
export type Gate = "send" | "hold" | "reject" | "stop";

export function gate(config: Record<string, unknown> | undefined, name: string, external: boolean | undefined, args: Record<string, unknown> = {}, usage: Record<string, Usage[]> = {}, now = 0): Gate {
  if (!config || (!("stop" in config) && !("agree" in config))) return "send";
  if (config.stop === true) return "stop";
  if (!external) return "send";
  const short = name.split(".")[1];
  const reject = Array.isArray(config.rejected) ? (config.rejected as string[]) : [];
  if (reject.includes(name) || reject.includes(short)) return "reject";
  const agree = Array.isArray(config.agree) ? (config.agree as Permission[]) : [];
  const match = agree.filter((p) => p && (p.endpoint === name || p.endpoint === short));
  if (!match.length) return "hold"; // no standing permission: wait for approval
  const amount = Number(args.amount ?? 0);
  const used = usage[name] ?? usage[short] ?? [];
  const fourEyes = config.fourEyes === true;
  const requester = typeof config.requester === "string" ? config.requester : "";
  const ok = match.some((p) => {
    if (fourEyes && requester !== "" && p.approver === requester) return false; // four eyes
    if (p.upTo > 0 && amount > p.upTo) return false;
    const recent = p.per > 0 ? used.filter((x) => now - x.at < p.per * 60_000) : used;
    return recent.length < p.count;
  });
  return ok ? "send" : "hold";
}

/** The one refusal answered at once: the emergency stop. A call with no permission is held. */
export function refused(config: Record<string, unknown> | undefined, _name: string, _external: boolean | undefined, _args: Record<string, unknown>): string | undefined {
  return config && config.stop === true ? "external calls are stopped (the emergency stop is on)" : undefined;
}

/**
 * Perform a call over HTTP: sent again (with the same idempotency key) when the answer is lost, a
 * 5xx or a 429, up to three attempts. Never throws: no answer is status 0 with an error.
 */
export async function fetchCall(eps: CallDesc[], c: CallOut, via?: Via, config?: Record<string, unknown>): Promise<Answer> {
  const desc = eps.find((e) => e.name === c.endpoint);
  const no = refused(config, c.endpoint, desc?.external, c.args);
  if (no) return { endpoint: c.endpoint, status: 0, error: no };
  return persist(desc, () => fetchOnce(eps, c, via), backoff);
}

async function fetchOnce(eps: CallDesc[], c: CallOut, via?: Via): Promise<Answer> {
  try {
    const h = outgoing(eps, c, via);
    const qs = new URLSearchParams(h.query).toString();
    const res = await fetch(apiBase(c.endpoint.split(".")[0]) + h.path + (qs ? "?" + qs : ""), { method: h.method, headers: { "content-type": "application/json", ...h.headers }, body: h.body === undefined ? undefined : JSON.stringify(h.body) });
    const text = await res.text();
    return { endpoint: c.endpoint, status: res.status, body: text ? JSON.parse(text) : null };
  } catch (e) {
    return { endpoint: c.endpoint, status: 0, error: `no answer: ${(e as Error).message}` };
  }
}
