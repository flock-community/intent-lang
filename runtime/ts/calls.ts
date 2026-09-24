// Calls from a screen to an API, as data: `{ endpoint: "tickets.createTicket", args: {…} }`.
// The same data goes to `fetch` in the browser and to the provider's test client in tests.

export interface CallDesc {
  name: string; // "tickets.createTicket": the alias, then the contract's endpoint
  method: string;
  path: string;
  params: { in: string; name: string }[];
}

export type CallOut = { endpoint: string; args: Record<string, unknown> };
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

/** The API's base URL in the browser: the `api` query parameter, or the page's own origin. */
export function apiBase(): string {
  const fromQuery = typeof location !== "undefined" ? new URLSearchParams(location.search).get("api") : null;
  return (fromQuery ?? "").replace(/\/$/, "");
}

/**
 * Listen to the api's events (Server-Sent Events at /events): each \`{ event, body }\` goes to
 * \`deliver\` once per alias whose contract declares it, as \`<alias>.<event>\`.
 */
export function listen(aliases: Record<string, string[]>, deliver: (e: { event: string; body: unknown }) => void): void {
  if (!Object.keys(aliases).length || typeof EventSource === "undefined") return;
  const source = new EventSource(apiBase() + "/events");
  source.onmessage = (m) => {
    try {
      const d = JSON.parse(m.data) as { event: string; body: unknown };
      for (const alias of aliases[d.event] ?? []) deliver({ event: `${alias}.${d.event}`, body: d.body });
    } catch {
      // not an event: ignore
    }
  };
}

/** Perform a call over HTTP. Never throws: a network failure is an answer with status 0 and an error. */
export async function fetchCall(eps: CallDesc[], c: CallOut): Promise<Answer> {
  try {
    const h = toHttp(eps, c);
    const qs = new URLSearchParams(h.query).toString();
    const res = await fetch(apiBase() + h.path + (qs ? "?" + qs : ""), { method: h.method, headers: { "content-type": "application/json" }, body: h.body && JSON.stringify(h.body) });
    const text = await res.text();
    return { endpoint: c.endpoint, status: res.status, body: text ? JSON.parse(text) : null };
  } catch (e) {
    return { endpoint: c.endpoint, status: 0, error: `no answer: ${(e as Error).message}` };
  }
}
