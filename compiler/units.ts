// The units of a spec and what each depends on (`units.json`, beside `sourcemap.json`): the map
// from spec to code that an incremental build needs (docs/design/incremental.md). A unit is one
// named part of the spec — a record, a choice, a state field, a derived value, an element, a
// handler, an endpoint, an `always` sentence, an example. Its digest is of its canonical text, so
// reformatting or moving it is no change; it depends on the units and types it names.
import { createHash } from "node:crypto";
import type { App, Element, Stmt, Type } from "./ast.ts";
import { refsIn } from "./refs.ts";

const sha = (s: string) => createHash("sha256").update(s).digest("hex").slice(0, 16);

/** The canonical text of a unit: its IR without the line numbers (so moving it is no change). */
const canonical = (x: unknown): string =>
  JSON.stringify(x, (k, v) => (k === "line" || k === "stepLines" || k === "ruleLines" || k === "sources" ? undefined : v));

export interface Unit {
  key: string; // `derive total`, `on click add`, `record Ticket`: kind and name, as in sourcemap.json
  kind: string;
  name: string;
  line: number;
  digest: string;
  depends: string[]; // the names it reads or uses: state, derived values, elements, types, endpoints
}

/** Every named unit of a spec, with its digest and the names it depends on. */
export function units(app: App): Unit[] {
  const out: Unit[] = [];
  const add = (kind: string, name: string, line: number, text: unknown, deps: string[]) =>
    out.push({ key: `${kind} ${name}`, kind, name, line, digest: sha(canonical(text)), depends: [...new Set(deps.filter(Boolean))].sort() });

  // The types a unit uses: a `Named`/`Ref` name (a record, a choice or a refined type).
  const typesOf = (t: Type): string[] => (t.k === "Named" || t.k === "Ref" ? [t.name] : t.k === "List" || t.k === "Maybe" ? typesOf(t.of) : []);
  // The names a piece of prose reads.
  const refsOf = (text: string) => refsIn(text).map((r) => r.split(".")[0]);
  const refsOfAll = (...texts: (string | undefined)[]) => texts.flatMap((t) => (t ? refsOf(t) : []));
  const stmtText = (b?: Stmt[]): string[] => (b ?? []).flatMap((s) => (s.k === "if" ? s.branches.flatMap((br) => [br.cond ?? "", ...stmtText(br.body)]) : s.k === "for" ? [s.where ?? "", ...stmtText(s.body)] : "text" in s ? [s.text] : []));

  for (const r of app.refined ?? []) add("type", r.name, r.line, { base: r.base, pattern: r.pattern, min: r.min, max: r.max, minLength: r.minLength, maxLength: r.maxLength }, []);
  for (const c of app.choices) add("choice", c.name, c.line, c, []);
  for (const r of app.records) add("record", r.name, r.line, { key: r.key, fields: r.fields.map((f) => ({ name: f.name, type: f.type })) }, r.fields.flatMap((f) => typesOf(f.type)));
  for (const c of app.components) add("component", c.name, c.line, { base: c.base, look: c.look, params: c.params }, []);

  for (const f of app.state) add("state", f.name, f.line, { type: f.type, default: f.default, stored: f.stored }, typesOf(f.type));
  for (const p of app.params ?? []) add("param", p.name, p.line, p, []);
  for (const d of app.derive) add("derive", d.name, d.line, d.type ? { sentence: d.sentence, type: d.type } : d.sentence, [...refsOf(d.sentence), ...(d.type ? typesOf(d.type) : [])]);

  // With several screens an element's unit starts with its screen (`about/title`): two screens may
  // reuse a name, and each is its own code.
  const walk = (els: Element[], list?: string, screen?: string) => {
    for (const el of els) {
      if (el.kind === "heading") continue;
      const on = el.screen ?? screen;
      const name = `${on ? `${on}/` : ""}${list ? `${list}.${el.name}` : el.name}`;
      add("element", name, el.line, { kind: el.kind, label: el.label, expr: el.expr, of: el.of, visibleWhen: el.visibleWhen, enabledWhen: el.enabledWhen, from: el.from, as: el.as, look: el.look, component: el.component, bindings: el.bindings }, [...refsOfAll(el.expr, el.visibleWhen, el.enabledWhen, ...(el.bindings ?? []).map((b) => b.value)), ...(el.of ? [el.of] : [])]);
      walk(el.children, el.kind === "list" ? (list ? `${list}.${el.name}` : el.name) : list, on);
    }
  };
  walk(app.screen);

  for (const h of app.handlers) add("on", `${h.verb}${h.target ? " " + h.target : ""}`, h.line, { verb: h.verb, target: h.target, steps: h.steps }, refsOfAll(...h.steps, ...stmtText(h.body)));
  for (const ep of app.endpoints ?? []) add("endpoint", ep.name, ep.line, { method: ep.method, path: ep.path, params: ep.params.map((p) => ({ in: p.in, name: p.name, type: p.type })), returns: ep.returns, answers: ep.answers, effect: ep.effect, undoneBy: ep.undoneBy, steps: ep.steps }, [...ep.params.flatMap((p) => typesOf(p.type)), ...(ep.returns ? typesOf(ep.returns) : []), ...refsOfAll(...ep.steps, ...stmtText(ep.body))]);
  for (const e of app.events ?? []) add("event", e.name, e.line, e.type, typesOf(e.type));
  for (const j of app.jobs ?? []) add("every", j.name.slice(5), j.line, { every: j.every, steps: j.steps }, refsOfAll(...j.steps, ...stmtText(j.body)));
  for (const l of app.layers ?? []) add("layer", l.alias, l.line, l, []);
  for (const c of app.clients ?? []) if (c.through) add("through", c.alias, c.through.line, c.through, []);
  // An api the screen calls: a changed contract (an endpoint, a type, an event) dirties what uses the alias.
  for (const c of app.clients ?? []) add("uses", c.alias, c.through?.line ?? 0, { contract: c.contract.endpoints, events: c.contract.events, records: c.contract.records }, []);
  app.rules.forEach((r, i) => add("rule", String(i + 1), app.ruleLines?.[i] ?? 0, r, refsOf(r)));
  for (const a of app.invariants ?? []) add("always", `${a.line}`, a.line, a.text, refsOf(a.text));
  for (const ex of app.examples) {
    const deps = ex.steps.flatMap((s) => [...("target" in s ? [s.target] : []), ...("at" in s && s.at?.list ? [s.at.list] : [])]);
    add("example", ex.name, ex.line, ex.steps, deps);
  }
  return out;
}

export interface Diff {
  dirty: string[]; // the behaviour units to rewrite: changed or new, plus everything that depends on them
  removed: string[]; // the behaviour units whose region is gone
  clean: string[]; // the behaviour units whose region must stay byte-identical
}

/** The units the compiler writes code for (and so has a region): the rest is the generated interface. */
const BEHAVIOUR = new Set(["element", "derive", "on", "endpoint", "every", "through", "layer"]);

/** Which units an incremental build must rewrite: changed, new, removed, and their dependents. */
export function diffUnits(prev: Unit[], next: Unit[]): Diff {
  const before = new Map(prev.map((u) => [u.key, u]));
  const after = new Set(next.map((u) => u.key));
  const removed = new Set(prev.filter((u) => !after.has(u.key)).map((u) => u.key));
  // A unit changed if it is new or its canonical text changed; a removed unit dirties what read it.
  const gone = new Set(next.filter((u) => before.get(u.key)?.digest !== u.digest).map((u) => u.key));
  for (const k of removed) gone.add(k);
  // A name as the spec reads it: without its screen (`about/title`) or its list (`items.done`).
  const bare = (name: string) => name.split("/").pop()!.split(".").pop()!;
  const goneNames = new Set([...gone].map((k) => bare(k.slice(k.indexOf(" ") + 1))));
  // A rule is prose the compiler reads for everything: a changed rule rewrites all behaviour.
  const everything = [...gone].some((k) => k.startsWith("rule "));
  // Propagate: a unit that names a changed or removed unit is affected too, transitively.
  for (let pass = 0; pass < next.length; pass++) {
    let grew = false;
    for (const u of next) {
      if (gone.has(u.key)) continue;
      if (everything || u.depends.some((d) => goneNames.has(d))) {
        gone.add(u.key);
        goneNames.add(bare(u.name));
        grew = true;
      }
    }
    if (!grew) break;
  }
  const behaviour = next.filter((u) => BEHAVIOUR.has(u.kind));
  const dirty = behaviour.filter((u) => gone.has(u.key)).map((u) => u.key).sort();
  const dirtySet = new Set(dirty);
  const clean = behaviour.filter((u) => !dirtySet.has(u.key)).map((u) => u.key).sort();
  const removedBehaviour = [...removed].filter((k) => BEHAVIOUR.has(k.slice(0, k.indexOf(" ")))).sort();
  return { dirty, removed: removedBehaviour, clean };
}
