// Stored state (`stored` in the spec) outside tests: kept in the browser's localStorage, per app.
// Only the stored fields are kept. Saved data from an older version of the app is migrated to the
// current types (a removed field is dropped, a new `T or nothing` field becomes nothing, a new list
// an empty list); a field that cannot be migrated keeps the app's default, and the rest of the data
// is still read. In tests the driver restarts the app instead (`restart` in an example).
import { migrate, type TypeDesc } from "./api.ts";

/** The stored fields out of the app's data. */
export const pick = (data: Record<string, unknown>, types: Record<string, TypeDesc>): Record<string, unknown> => Object.fromEntries(Object.keys(types).map((f) => [f, data[f]]));

/** Kept data, migrated to the current types, with `defaults` (the spec's stored defaults) filling
 *  any field that could not be read. Nothing saved: nothing. */
export function load(key: string, types: Record<string, TypeDesc>, defaults?: Record<string, unknown>): Record<string, unknown> | undefined {
  try {
    const raw = globalThis.localStorage?.getItem(key);
    if (!raw) return undefined;
    const { data, dropped } = migrate(JSON.parse(raw), types);
    if (dropped.length) console.warn(`intent: ${key}: cannot read ${dropped.join(", ")} (from an older version); using the spec's default there`);
    return defaults ? { ...pick(defaults, types), ...data } : data;
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
