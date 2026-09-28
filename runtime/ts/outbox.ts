// The durable outbox (docs/design/effects.md): a call is written down with its idempotency key
// before it goes out, and cleared when it is answered. After a page reload (or a crash) any call
// still in the box is sent again with the same key, so a lost answer cannot charge twice and a
// dropped request is not forgotten.
import type { CallOut, Keep } from "./calls.ts";

export type Pending = CallOut & { key: string };

export interface Outbox {
  put(c: Pending): void;
  done(key: string): void;
  pending(): Pending[];
}

/** A `Storage`-backed (localStorage) outbox, or an in-memory one when there is no storage. */
export function outbox(name: string, store: Pick<Storage, "getItem" | "setItem"> | undefined = browser()): Outbox {
  store ??= memory();
  const read = (): Pending[] => {
    try {
      const raw = store?.getItem(name);
      const xs = raw ? (JSON.parse(raw) as Pending[]) : [];
      return Array.isArray(xs) ? xs.filter((x) => x && typeof x.key === "string" && typeof x.endpoint === "string") : [];
    } catch {
      return [];
    }
  };
  const write = (xs: Pending[]) => {
    try {
      store?.setItem(name, JSON.stringify(xs));
    } catch {
      // Storage full or blocked: the call still goes out, it just is not remembered across a reload.
    }
  };
  return {
    put: (c) => write([...read().filter((x) => x.key !== c.key), c]),
    done: (key) => write(read().filter((x) => x.key !== key)),
    pending: () => read(),
  };
}

type Store = Pick<Storage, "getItem" | "setItem">;
const browser = (): Store | undefined => {
  try {
    return (globalThis as { localStorage?: Storage }).localStorage;
  } catch {
    return undefined; // blocked site data
  }
};
/** Storage for this page only: what a browser without storage (or a test) remembers until a reload. */
export function memory(): Store {
  const m = new Map<string, string>();
  return { getItem: (k) => m.get(k) ?? null, setItem: (k, v) => void m.set(k, v) };
}

/** A durable keep for the agreement (calls.ts `agreement`): its values as JSON under `name:key`. */
export function keep(name: string, store: Store | undefined = browser()): Keep {
  const s = store ?? memory();
  const here = new Map<string, unknown>(); // what this page set, so a storage that refuses writes still holds for the page
  return {
    get<T>(key: string, empty: T): T {
      if (here.has(key)) return here.get(key) as T;
      try {
        const raw = s.getItem(`${name}:${key}`);
        return raw ? (JSON.parse(raw) as T) : empty;
      } catch {
        return empty;
      }
    },
    set(key: string, value: unknown) {
      here.set(key, value);
      try {
        s.setItem(`${name}:${key}`, JSON.stringify(value));
      } catch {
        // Storage full or blocked: the agreement still holds for this page, not across a reload.
      }
    },
  };
}
