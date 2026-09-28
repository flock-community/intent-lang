// The keys rows are found by stay unique (`keys.json` in a build): the lists a reference points into,
// and the lists inside rows (an inner row's key within its outer row, and the outer list's key, so the
// path of keys finds one row). Checked on the app's data after every step, by the screen driver
// (exec.ts) and the api driver (api.ts).
import { sha256 } from "../runtime/ts/platform/std.crypto.ts";

export interface KeyedList {
  field: string; // the state list in the data
  list: string;
  key: string;
  record: string;
  line: number;
  inner?: { field: string; key: string; record: string }; // a list inside each row of `list`
}

/** Two rows with the same key (`keys.json`), or undefined. */
export function duplicateKey(keys: KeyedList[], data: any): { line: number; message: string } | undefined {
  for (const k of keys) {
    const seen = new Map<string, number>();
    const rows: any[] = Array.isArray(data?.[k.field]) ? data[k.field] : [];
    for (const [i, r] of rows.entries()) {
      const v = JSON.stringify(r?.[k.key]);
      if (seen.has(v))
        return {
          line: k.line,
          message: k.inner
            ? `two rows of \`${k.list}\` have ${k.key} ${v} (rows ${seen.get(v)! + 1} and ${i + 1}): a row inside a row is found by its ${k.record}'s key and its own, so the ${k.record}'s key must stay unique`
            : `two rows of \`${k.list}\` have ${k.key} ${v} (rows ${seen.get(v)! + 1} and ${i + 1}): a reference to a ${k.record} finds one row by its key, so the key must stay unique`,
        };
      seen.set(v, i);
    }
    if (!k.inner) continue;
    for (const [i, r] of rows.entries()) {
      const inner: any[] = Array.isArray(r?.[k.inner.field]) ? r[k.inner.field] : [];
      const mine = new Map<string, number>();
      for (const [j, x] of inner.entries()) {
        const v = JSON.stringify(x?.[k.inner.key]);
        if (mine.has(v)) return { line: k.line, message: `row ${i + 1} of \`${k.list}\` (${k.key} ${JSON.stringify(r?.[k.key])}) has two ${k.inner.field} with ${k.inner.key} ${v} (rows ${mine.get(v)! + 1} and ${j + 1}): an inner row is found by its key within its ${k.record}, so the key must stay unique there` };
        mine.set(v, j);
      }
    }
  }
}

/**
 * The idempotency key a test driver sends for a call: deterministic (twin builds see the same
 * requests), and as long as a real one (32 hex digits), so a service takes it from an anonymous
 * caller too (runtime/ts/once.ts).
 */
export const harnessKey = (seed: string) => sha256(`intent-harness ${seed}`).slice(0, 32);
