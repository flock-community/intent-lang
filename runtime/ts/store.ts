// Stored state (`stored` in the spec) outside tests: kept in the browser's localStorage, per app.
// Only the stored fields are kept. Nothing saved, or saved data that does not fit the spec's types
// (an older version of the app, a hand edit): the app starts from its defaults. In tests the driver
// restarts the app instead (`restart` in an example).
import { fits, type TypeDesc } from "./api.ts";

/** The stored fields out of the app's data. */
export const pick = (data: Record<string, unknown>, types: Record<string, TypeDesc>): Record<string, unknown> => Object.fromEntries(Object.keys(types).map((f) => [f, data[f]]));

/** Kept data that fits every stored field's type, or nothing. */
export const readable = (saved: unknown, types: Record<string, TypeDesc>): Record<string, unknown> | undefined =>
  saved && typeof saved === "object" && Object.entries(types).every(([f, t]) => fits((saved as Record<string, unknown>)[f], t)) ? (saved as Record<string, unknown>) : undefined;

export function load(key: string, types: Record<string, TypeDesc>): Record<string, unknown> | undefined {
  try {
    const raw = globalThis.localStorage?.getItem(key);
    return raw ? readable(JSON.parse(raw), types) : undefined;
  } catch {
    return undefined;
  }
}

export function save(key: string, data: Record<string, unknown>, types: Record<string, TypeDesc>) {
  try {
    globalThis.localStorage?.setItem(key, JSON.stringify(pick(data, types)));
  } catch {
    // Storage full or blocked: the app keeps working, it only forgets on the next start.
  }
}
