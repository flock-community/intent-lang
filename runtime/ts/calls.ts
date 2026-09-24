// Calls from a screen to an API, as data: `{ endpoint: "tickets.createTicket", args: {…} }`.
// The same data goes to `fetch` in the browser and to the provider's test client in tests.

export interface CallDesc {
  name: string; // "tickets.createTicket": the alias, then the contract's endpoint
  method: string;
  path: string;
  params: { in: string; name: string }[];
}

export type CallOut = { endpoint: string; args: Record<string, unknown>; headers?: Record<string, string>; config?: Record<string, unknown> };
export type Answer = { endpoint: string; status: number; body?: unknown; error?: string };

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

/** Client layers per alias (\`uses … through std.http.sendKey\`): the call, and the layer's config from the app's state. */
export type Via = (alias: string, req: Outgoing) => Outgoing;

export function outgoing(eps: CallDesc[], c: CallOut, via?: Via): Outgoing {
  const h = toHttp(eps, c);
  const req: Outgoing = { method: h.method, path: h.path, query: h.query, headers: { ...(c.headers ?? {}) }, body: h.body };
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

/** Perform a call over HTTP. Never throws: a network failure is an answer with status 0 and an error. */
export async function fetchCall(eps: CallDesc[], c: CallOut, via?: Via): Promise<Answer> {
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
