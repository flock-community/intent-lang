// Effectively once, on the service side (docs/design/effects.md). Follows the IETF Idempotency-Key
// draft and Stripe: a request with a non-safe method and an `idempotency-key` header is remembered
// per caller and key, with a fingerprint of the request and the answer the endpoint gave. The same
// key again gets the same answer (marked `idempotent-replayed: true`) and the endpoint does not run;
// the same key with a different request is refused (422). Only answers from an endpoint that ran
// are remembered: a request refused before it ran can be sent again. Keys expire after 24 hours.

export const KEY_HEADER = "idempotency-key";
export const EXPIRES_MINUTES = 24 * 60;
const SAFE = new Set(["GET", "HEAD", "OPTIONS"]);

export type KeyRecord = { fingerprint: string; endpoint: string; status: number; body: unknown; at: string };
/** Remembered answers, by caller and key (`caller key`). Kept with the service's stored state. */
export type Keys = Record<string, KeyRecord>;

const stable = (v: unknown): string =>
  Array.isArray(v) ? `[${v.map(stable).join(",")}]` : v && typeof v === "object" ? `{${Object.keys(v).sort().map((k) => `${JSON.stringify(k)}:${stable((v as Record<string, unknown>)[k])}`).join(",")}}` : JSON.stringify(v ?? null);

export const keyed = (method: string) => !SAFE.has(method.toUpperCase());
export const fingerprint = (method: string, path: string, body: unknown) => `${method.toUpperCase()} ${path} ${stable(body)}`;

/** Minutes from one moment to another ("YYYY-MM-DDTHH:MM"); "" (no clock) never expires. */
const minutesBetween = (a: string, b: string) => (a && b ? (Date.parse(`${b}:00Z`) - Date.parse(`${a}:00Z`)) / 60000 : 0);

/** What an earlier request with this key decides: its answer again, a conflict, or nothing (run it). */
export function recall(keys: Keys, caller: string, key: string, fp: string, now = ""): { replay: KeyRecord } | { conflict: string } | undefined {
  const r = keys[`${caller} ${key}`];
  if (!r || minutesBetween(r.at, now) >= EXPIRES_MINUTES) return undefined;
  return r.fingerprint === fp ? { replay: r } : { conflict: "This idempotency key was used for a different request" };
}

export function remember(keys: Keys, caller: string, key: string, record: KeyRecord) {
  keys[`${caller} ${key}`] = record;
  // Forget what expired, so the kept state does not grow without end.
  for (const [k, r] of Object.entries(keys)) if (minutesBetween(r.at, record.at) >= EXPIRES_MINUTES) delete keys[k];
}
