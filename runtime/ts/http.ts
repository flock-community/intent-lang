// HTTP as plain data, for layers and the api pipeline. Header names are always lower case.

export type HttpRequest = {
  method: string; // "GET", "OPTIONS", …
  path: string; // "/tickets/7", without the query
  query: Record<string, string>;
  headers: Record<string, string>; // lower-case names
  body: unknown; // parsed JSON, or undefined
};

export type HttpResponse = {
  status: number;
  headers: Record<string, string>; // lower-case names
  body: unknown; // JSON; null for no body
};

/** An answer: status, JSON body (null for none) and headers. */
export function respond(status: number, body: unknown = null, headers: Record<string, string> = {}): HttpResponse {
  return { status, body, headers: lower(headers) };
}

/** A refusal: status and one message, as `{ "error": message }` (a Problem). */
export function refuse(status: number, error: string, headers: Record<string, string> = {}): HttpResponse {
  return { status, body: { error }, headers: lower(headers) };
}

/** A request header by name, any case; undefined when absent. */
export function header(req: HttpRequest, name: string): string | undefined {
  return req.headers[name.toLowerCase()];
}

/** The answer with these headers set (replacing any with the same name). */
export function withHeaders(res: HttpResponse, headers: Record<string, string>): HttpResponse {
  return { ...res, headers: { ...res.headers, ...lower(headers) } };
}

/** Compare two secrets in constant time: how long it takes does not depend on where they differ. */
export function sameSecret(a: string, b: string): boolean {
  const x = new TextEncoder().encode(a);
  const y = new TextEncoder().encode(b);
  let diff = x.length ^ y.length;
  for (let i = 0; i < Math.max(x.length, y.length); i++) diff |= (x[i] ?? 0) ^ (y[i] ?? 0);
  return diff === 0;
}

export function lower(h: Record<string, string>): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(h ?? {})) out[k.toLowerCase()] = String(v);
  return out;
}

/** A response as the harness keeps it: lower-case header names, string values, JSON-clean body. */
export function normalize(res: HttpResponse): HttpResponse {
  return { status: res.status, headers: lower(res.headers ?? {}), body: res.body === undefined ? null : JSON.parse(JSON.stringify(res.body)) };
}
