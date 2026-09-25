// The durable outbox (docs/design/effects.md): a call is written down with its idempotency key
// before it goes out, and cleared when it is answered. After a page reload (or a crash) any call
// still in the box is sent again with the same key, so a lost answer cannot charge twice and a
// dropped request is not forgotten.
import type { CallOut } from "./calls.ts";

export type Pending = CallOut & { key: string };

export interface Outbox {
  put(c: Pending): void;
  done(key: string): void;
  pending(): Pending[];
}

/** A `Storage`-backed (localStorage) outbox, or an in-memory one when there is no storage. */
export function outbox(name: string, store: Pick<Storage, "getItem" | "setItem"> | undefined = (globalThis as { localStorage?: Storage }).localStorage): Outbox {
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
