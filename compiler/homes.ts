// A record's home: the state list its rows live in. A `ref Ticket` is followed there (and a change
// rule's `a @Ticket` reads its rows there): one concept, one check. Kept apart from the checker so
// the targets can use it without importing the checker.
import { LINE_BASE, type App, type Type } from "./ast.ts";

/**
 * A record's home lists: the state fields of type `List R` (not derived values, not a component's
 * state). A `ref R` is followed in its home, and a change rule's `a @R` reads its rows there.
 */
export function homeLists(app: App, rec: string): string[] {
  return app.state.filter((f) => !f.name.includes(".") && f.type.k === "List" && f.type.of.k === "Named" && f.type.of.name === rec).map((f) => f.name);
}

/**
 * Where a record's rows live inside the rows of a state list (a list inside a row): `orders`, whose
 * Orders hold `lines: List Line`. An inner row's key is unique within its outer row only, so it is
 * found by the path of keys (the outer row's, then its own).
 */
export function innerHomes(app: App, rec: string): { list: string; outer: string; outerKey?: string; field: string }[] {
  const out: { list: string; outer: string; outerKey?: string; field: string }[] = [];
  for (const f of app.state) {
    if (f.name.includes(".") || f.type.k !== "List" || f.type.of.k !== "Named") continue;
    const outer = app.records.find((r) => r.name === (f.type as { of: { name: string } }).of.name);
    if (!outer) continue;
    for (const g of outer.fields)
      if (g.type.k === "List" && g.type.of.k === "Named" && g.type.of.name === rec)
        out.push({ list: f.name, outer: outer.name, outerKey: outer.fields.find((x) => x.name === (outer.key ?? "id"))?.name, field: g.name });
  }
  return out;
}

/**
 * Where a `ref R` is looked up when it is followed: the list its field names (`ref Ticket in
 * tickets`), or R's one home list. `problem` says why there is none (no home, or several).
 */
export function homeOf(app: App, rec: string, named?: string): { list?: string; problem?: string } {
  if (named) return homeLists(app, rec).includes(named) ? { list: named } : { problem: `@${named} is not a state list of ${rec}` };
  const lists = homeLists(app, rec);
  if (lists.length === 1) return { list: lists[0] };
  const inner = innerHomes(app, rec);
  if (!lists.length && inner.length) return { problem: `${rec}s live only inside the rows of ${inner.map((h) => `@${h.list}`).join(", ")} (a ${rec}'s key is unique within its ${inner[0].outer} only, so a key alone finds no row)` };
  return { problem: lists.length ? `${rec}s live in several state lists (${lists.map((l) => `@${l}`).join(", ")})` : `no state list holds ${rec}s` };
}

/**
 * The lists whose keys the harness keeps unique, checked on the app's data after every step: a list
 * a reference points into, and every list inside the rows of a state list (its key unique within
 * each outer row, and the outer list's key unique, so the path of keys finds one row).
 */
export function keyedLists(app: App): { list: string; record: string; key: string; inner?: { field: string; record: string; key: string } }[] {
  const out = referencedHomes(app).map((h) => ({ ...h })) as ReturnType<typeof keyedLists>;
  const keyOf = (name: string) => {
    const r = app.records.find((x) => x.name === name);
    return r?.fields.find((f) => f.name === (r.key ?? "id"))?.name;
  };
  for (const f of app.state) {
    if (f.name.includes(".") || f.type.k !== "List" || f.type.of.k !== "Named" || f.line >= LINE_BASE) continue;
    const outer = app.records.find((r) => r.name === (f.type as { of: { name: string } }).of.name);
    if (!outer) continue;
    for (const g of outer.fields) {
      if (g.type.k !== "List" || g.type.of.k !== "Named") continue;
      const innerKey = keyOf(g.type.of.name);
      const outerKey = keyOf(outer.name);
      if (!innerKey || !outerKey) continue;
      out.push({ list: f.name, record: outer.name, key: outerKey, inner: { field: g.name, record: g.type.of.name, key: innerKey } });
    }
  }
  return out;
}

/** Every `ref` type the app declares (record fields and state), with where it is. */
export function refTypes(app: App): { t: Extract<Type, { k: "Ref" }>; owner: string; field: string; line: number; optional: boolean }[] {
  const out: ReturnType<typeof refTypes> = [];
  const add = (t: Type, owner: string, field: string, line: number) => {
    const inner = t.k === "Maybe" ? t.of : t;
    if (inner.k === "Ref") out.push({ t: inner, owner, field, line, optional: t.k === "Maybe" });
  };
  for (const r of app.records) for (const f of r.fields) add(f.type, r.name, f.name, f.line);
  for (const f of app.state) if (!f.name.includes(".")) add(f.type, "", f.name, f.line);
  return out;
}

/** The home lists some reference points into, with the record and its key: the harness keeps their keys unique. */
export function referencedHomes(app: App): { list: string; record: string; key: string }[] {
  const out = new Map<string, { list: string; record: string; key: string }>();
  for (const r of refTypes(app)) {
    const h = homeOf(app, r.t.name, r.t.in);
    const rec = app.records.find((x) => x.name === r.t.name);
    const key = rec?.fields.find((f) => f.name === (rec.key ?? "id"))?.name;
    if (h.list && rec && key && r.line < LINE_BASE) out.set(h.list, { list: h.list, record: rec.name, key });
  }
  return [...out.values()];
}

