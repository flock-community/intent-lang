// Loading a spec with its imports: resolve bundles from lib/, verify them against intent.lock,
// merge their declarations, expand `use` of behaviour components, then check the whole app.
// Lines of imported files are encoded as fileIndex * LINE_BASE + line (see App.sources).
import { bareWords, refsIn, sentences } from "./refs.ts";
import { createHash } from "node:crypto";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join, relative } from "node:path";
import { LINE_BASE, type App, type Component, type Diagnostic, type Design, type Element, type Type } from "./ast.ts";
import { expandUses } from "./expand.ts";
import { PROJECT_ROOT, ROOT } from "./gen.ts";
import { checkApp, parseSyntax, typeToString } from "./parse.ts";
import { baseTarget, refine, targetOf } from "./refine.ts";
import { MODEL } from "./llm.ts";
import { printApp } from "./print.ts";

export const LIB = join(PROJECT_ROOT, "lib");
export const LOCK = join(PROJECT_ROOT, "intent.lock");

export interface Loaded {
  app?: App; // undefined when there are errors
  diagnostics: Diagnostic[];
  sources: { file: string; text: string }[];
  bundles: { name: string; file: string; sha: string }[];
  base?: App; // the published app this spec extends
}

/**
 * Where a bundle's source is: the local lib/ first (so bundles can be developed in place), else
 * the version pinned in intent.lock and downloaded by `intent install` into .intent/deps/.
 */
export const bundlePath = (name: string): string => {
  const local = join(LIB, ...name.split(".")) + ".intent";
  if (existsSync(local)) return local;
  const version = readLockVersions().get(name);
  return version ? join(PROJECT_ROOT, ".intent/deps", `${name}@${version}.intent`) : local;
};
export const sha = (text: string) => createHash("sha256").update(text).digest("hex").slice(0, 16);

export function readLock(): Map<string, string> {
  const lock = new Map<string, string>();
  if (!existsSync(LOCK)) return lock;
  for (const line of readFileSync(LOCK, "utf8").split("\n")) {
    const m = line.match(/^([a-z][\w.]*)\s+(?:\d+\.\d+\.\d+\s+)?sha256:([0-9a-f]+)/);
    if (m) lock.set(m[1], m[2]);
  }
  return lock;
}

/** Bundles installed from a registry, with the version pinned for each. */
export function readLockVersions(): Map<string, string> {
  const out = new Map<string, string>();
  if (!existsSync(LOCK)) return out;
  for (const line of readFileSync(LOCK, "utf8").split("\n")) {
    const m = line.match(/^([a-z][\w.]*)\s+(\d+\.\d+\.\d+)\s+sha256:/);
    if (m) out.set(m[1], m[2]);
  }
  return out;
}

/**
 * The compiler is part of what a build depends on: the language reference is the compiler's
 * prompt, and the model turns it into code. Both are pinned in intent.lock like bundles.
 */
export function compilerPins(): { language: string; languageVersion: string; model: string } {
  const doc = readFileSync(join(ROOT, "docs/LANGUAGE.md"), "utf8");
  return { language: sha(doc), languageVersion: doc.match(/language reference \((v\d+)/)?.[1] ?? "?", model: MODEL };
}

export function readCompilerLock(): { language?: string; model?: string } {
  if (!existsSync(LOCK)) return {};
  const text = readFileSync(LOCK, "utf8");
  return { language: text.match(/^@language\s+\S+\s+sha256:([0-9a-f]+)/m)?.[1], model: text.match(/^@model\s+(\S+)/m)?.[1] };
}

/** Add every node's line offset for an imported file. */
function offsetLines(v: any, base: number) {
  if (Array.isArray(v)) v.forEach((x) => offsetLines(x, base));
  else if (v && typeof v === "object")
    for (const [k, x] of Object.entries(v))
      if (k === "line" && typeof x === "number") v[k] = x + base;
      else if ((k === "stepLines" || k === "ruleLines") && Array.isArray(x)) v[k] = x.map((n: number) => n + base);
      else offsetLines(x, base);
}

export function load(file: string, opts: { ignoreLock?: boolean } = {}): Loaded {
  const sources = [{ file: relative(PROJECT_ROOT, file), text: readFileSync(file, "utf8") }];
  const diagnostics: Diagnostic[] = [];
  const at = (line: number): { file: string; line: number } => ({ file: sources[Math.floor(line / LINE_BASE)]?.file ?? sources[0].file, line: line % LINE_BASE });
  const push = (level: "error" | "warning") => (line: number, code: string, message: string, col = 1) => diagnostics.push({ level, code, line, col, message });
  const err = push("error");
  const warn = push("warning");

  const main = parseSyntax(sources[0].text);
  diagnostics.push(...main.diagnostics);
  let app = main.app;
  // What this file names itself (for the direct-imports rule): its own imports, before anything is merged in.
  const ownImports = new Set([...(app.imports ?? []).map((i) => i.bundle), ...[app.extends?.name, app.implements?.name, ...(app.uses ?? []).map((u) => u.contract)].filter((x): x is string => !!x)]);
  if (app.kind === "contract") app.profile = "api"; // a contract is checked with the api vocabulary
  const lock = readLock();
  let baseApp: App | undefined;
  if (!opts.ignoreLock && app.kind !== "bundle") {
    const pins = compilerPins();
    const locked = readCompilerLock();
    if (locked.language && locked.language !== pins.language)
      warn(1, "LOCK", `the language reference changed since intent.lock was written (now ${pins.languageVersion}); builds will read the new version. Review the changelog, then run \`intent lock\``);
    if (locked.model && locked.model !== pins.model) warn(1, "LOCK", `the compiler model is ${pins.model}, but intent.lock pins ${locked.model}`);
    if (main.language && main.language !== pins.languageVersion)
      warn(main.languageLine, "LANGUAGE", `this spec was written for language ${main.language}; the language is now ${pins.languageVersion}. Read the changelog in docs/LANGUAGE.md for what changed`);
  }
  const bundles: Loaded["bundles"] = [];

  // Refinement: start from the published base app, apply the explicit overrides.
  if (app.extends) {
    const base = app.extends;
    const path = bundlePath(base.name);
    if (!existsSync(path)) err(base.line, "UNKNOWN_NAME", `no published app \`${base.name}\` (looked for ${relative(PROJECT_ROOT, path)})`);
    else {
      const text = readFileSync(path, "utf8");
      const idx = sources.push({ file: relative(PROJECT_ROOT, path), text }) - 1;
      const parsed = parseSyntax(text);
      offsetLines(parsed.app, idx * LINE_BASE);
      diagnostics.push(...parsed.diagnostics.map((d) => ({ ...d, line: d.line + idx * LINE_BASE })));
      if (parsed.app.kind !== "app") err(base.line, "BAD_BINDING", `${relative(PROJECT_ROOT, path)} is a bundle; \`extends\` takes a published app`);
      if (parsed.app.extends) err(base.line, "NOT_YET", "the base extends another spec itself; refinement is one level deep (compose components beyond that)");
      const digest = sha(text);
      bundles.push({ name: base.name, file: relative(PROJECT_ROOT, path), sha: digest });
      if (!opts.ignoreLock) {
        const locked = lock.get(base.name);
        if (!locked) err(base.line, "LOCK", `the base \`${base.name}\` is not locked; run \`intent lock ${sources[0].file}\``);
        else if (locked !== digest) {
          // Which of this spec's overrides touch a part the base changed?
          const fp = readOverrideLock(sources[0].file);
          const changed = (app.refinements ?? []).filter((r) => fp.has(targetOf(r)) && fp.get(targetOf(r)) !== sha(JSON.stringify(baseTarget(parsed.app, r) ?? null)));
          for (const r of changed) warn(r.line, "BASE_CHANGED", `the base changed the part this overrides (${targetOf(r)}): review your override against the new base`);
          err(base.line, "LOCK", `the base \`${base.name}\` changed since it was locked; review it${changed.length ? ` (it changed ${changed.length} part(s) you override)` : ""}, then run \`intent lock ${sources[0].file}\``);
        }
      }
      app = refine(parsed.app, app, app.refinements ?? [], err, warn);
      baseApp = parsed.app;
    }
  } else if (app.refinements?.length) err(app.refinements[0].line, "SYNTAX", "`override`, `add to` and `drop` need an `extends <published app>` line");

  // A contract: the app implements it. Its types and endpoint signatures come from the contract;
  // the app adds only behaviour. Anything that does not match is an error, never a silent drift.
  if (app.implements) {
    const c = app.implements;
    const path = bundlePath(c.name);
    if (!existsSync(path)) err(c.line, "UNKNOWN_NAME", `no contract \`${c.name}\` (looked for ${relative(PROJECT_ROOT, path)})`);
    else {
      const text = readFileSync(path, "utf8");
      const idx = sources.push({ file: relative(PROJECT_ROOT, path), text }) - 1;
      const parsed = parseSyntax(text);
      offsetLines(parsed.app, idx * LINE_BASE);
      diagnostics.push(...parsed.diagnostics.map((d) => ({ ...d, line: d.line + idx * LINE_BASE })));
      if (parsed.app.kind !== "contract") err(c.line, "BAD_BINDING", `${relative(PROJECT_ROOT, path)} is not a contract`);
      const digest = sha(text);
      bundles.push({ name: c.name, file: relative(PROJECT_ROOT, path), sha: digest });
      if (!opts.ignoreLock) {
        const locked = lock.get(c.name);
        if (!locked) err(c.line, "LOCK", `the contract \`${c.name}\` is not locked; run \`intent lock ${sources[0].file}\``);
        else if (locked !== digest) err(c.line, "LOCK", `the contract \`${c.name}\` changed since it was locked; review it, then run \`intent lock ${sources[0].file}\``);
      }
      implementContract(app, parsed.app, err);
    }
  }

  // Layers: `use cors = std.http.cors` in an api app. Each layer is a checked, locked spec of its
  // own; the app binds its params. Its build is reused by every app (keyed by its canonical text).
  for (const l of app.layers ?? []) {
    if (app.profile !== "api") err(l.line, "BAD_BINDING", "layers wrap an api: add `profile api`");
    const path = bundlePath(l.layer);
    if (!existsSync(path)) {
      err(l.line, "UNKNOWN_NAME", `no layer \`${l.layer}\` (looked for ${relative(PROJECT_ROOT, path)})`);
      continue;
    }
    const loaded = load(path, opts);
    if (!loaded.app) {
      err(l.line, "BAD_BINDING", `the layer ${l.layer} has errors; run \`intent check ${relative(PROJECT_ROOT, path)}\``);
      continue;
    }
    if (loaded.app.kind !== "layer") {
      err(l.line, "BAD_BINDING", `${l.layer} is not a layer`);
      continue;
    }
    const text = readFileSync(path, "utf8");
    bundles.push({ name: l.layer, file: relative(PROJECT_ROOT, path), sha: sha(text) });
    if (!opts.ignoreLock) {
      const locked = lock.get(l.layer);
      if (!locked) err(l.line, "LOCK", `the layer \`${l.layer}\` is not locked; run \`intent lock ${sources[0].file}\``);
      else if (locked !== sha(text)) err(l.line, "LOCK", `the layer \`${l.layer}\` changed since it was locked; review it, then run \`intent lock ${sources[0].file}\``);
    }
    l.spec = loaded.app;
    l.digest = sha(printApp(loaded.app)).slice(0, 12);
    const params = new Map((loaded.app.params ?? []).map((p) => [p.name, p]));
    for (const b of l.bindings) {
      const p = params.get(b.name);
      if (!p) err(b.line, "UNKNOWN_NAME", `layer ${l.layer} has no param \`${b.name}\` (${[...params.keys()].join(", ") || "none"})`);
      else if (Array.isArray(b.value) && p.type.k !== "List") err(b.line, "BAD_BINDING", `\`${b.name}\` is one ${p.type.k === "Named" ? p.type.name : p.type.k}, not a list`);
      else if (!Array.isArray(b.value) && b.value.k === "table" && p.type.k !== "List") err(b.line, "BAD_BINDING", `\`${b.name}\` is not a list; a table does not fit`);
    }
    for (const p of params.values()) if (p.default === undefined && !l.bindings.some((b) => b.name === p.name)) err(l.line, "BAD_BINDING", `layer ${l.layer} needs \`${p.name}\`: bind it in an indented line (\`${p.name} = …\`)`);
    for (const pv of loaded.app.provides ?? [])
      for (const ep of app.endpoints ?? []) if (ep.params.some((x) => x.name === pv.name)) err(ep.line, "DUPLICATE", `endpoint ${ep.name} has a param \`${pv.name}\`, which layer ${l.alias} also provides`);
  }

  // Clients: `uses <contract> as <alias>` brings the contract's types, and its endpoints as calls.
  for (const u of app.uses ?? []) {
    const path = bundlePath(u.contract);
    if (!existsSync(path)) {
      err(u.line, "UNKNOWN_NAME", `no contract \`${u.contract}\` (looked for ${relative(PROJECT_ROOT, path)})`);
      continue;
    }
    const text = readFileSync(path, "utf8");
    const idx = sources.push({ file: relative(PROJECT_ROOT, path), text }) - 1;
    const parsed = parseSyntax(text);
    offsetLines(parsed.app, idx * LINE_BASE);
    diagnostics.push(...parsed.diagnostics.map((d) => ({ ...d, line: d.line + idx * LINE_BASE })));
    if (parsed.app.kind !== "contract") err(u.line, "BAD_BINDING", `${relative(PROJECT_ROOT, path)} is not a contract`);
    const digest = sha(text);
    bundles.push({ name: u.contract, file: relative(PROJECT_ROOT, path), sha: digest });
    if (!opts.ignoreLock) {
      const locked = lock.get(u.contract);
      if (!locked) err(u.line, "LOCK", `the contract \`${u.contract}\` is not locked; run \`intent lock ${sources[0].file}\``);
      else if (locked !== digest) err(u.line, "LOCK", `the contract \`${u.contract}\` changed since it was locked; review it, then run \`intent lock ${sources[0].file}\``);
    }
    let providerDigest: string | undefined;
    if (u.testedWith && !existsSync(join(PROJECT_ROOT, u.testedWith))) err(u.line, "UNKNOWN_NAME", `no provider spec at ${u.testedWith}`);
    else if (u.testedWith) {
      // The provider the examples run against: it must implement this contract, and build.
      const p = load(join(PROJECT_ROOT, u.testedWith), opts);
      if (!p.app) err(u.line, "PROVIDER", `the provider ${u.testedWith} has errors; run \`intent check ${u.testedWith}\``);
      else if (p.app.implements?.name !== u.contract) err(u.line, "PROVIDER", `${u.testedWith} does not implement \`${u.contract}\``);
      else providerDigest = sha(printApp(p.app)).slice(0, 12);
    }
    app.imports = [...(parsed.app.imports ?? []), ...(app.imports ?? [])];
    for (const r of parsed.app.refined ?? []) (app.refined ??= []).push(r);
    app.records.push(...parsed.app.records.filter((r) => !app.records.some((x) => x.name === r.name)));
    app.choices.push(...parsed.app.choices.filter((c) => !app.choices.some((x) => x.name === c.name)));
    // A client's layer (`through std.http.sendKey`): checked and locked like a service's layer; its params bind to state or literals.
    if (u.through) {
      const l = u.through;
      const lpath = bundlePath(l.layer);
      const loaded = existsSync(lpath) ? load(lpath, opts) : undefined;
      if (!loaded) err(l.line, "UNKNOWN_NAME", `no layer \`${l.layer}\` (looked for ${relative(PROJECT_ROOT, lpath)})`);
      else if (!loaded.app) err(l.line, "BAD_BINDING", `the layer ${l.layer} has errors; run \`intent check ${relative(PROJECT_ROOT, lpath)}\``);
      else if (!loaded.app.beforeCall) err(l.line, "BAD_BINDING", `${l.layer} is not a client's layer (it has no \`before every call\`)`);
      else {
        const text = readFileSync(lpath, "utf8");
        bundles.push({ name: l.layer, file: relative(PROJECT_ROOT, lpath), sha: sha(text) });
        if (!opts.ignoreLock) {
          const locked = lock.get(l.layer);
          if (!locked) err(l.line, "LOCK", `the layer \`${l.layer}\` is not locked; run \`intent lock ${sources[0].file}\``);
          else if (locked !== sha(text)) err(l.line, "LOCK", `the layer \`${l.layer}\` changed since it was locked; review it, then run \`intent lock ${sources[0].file}\``);
        }
        l.spec = loaded.app;
        l.digest = sha(printApp(loaded.app)).slice(0, 12);
        const params = new Map((loaded.app.params ?? []).map((p) => [p.name, p]));
        for (const b of l.bindings) {
          const p = params.get(b.name);
          const st = b.state ? app.state.find((f) => f.name === b.state) : undefined;
          if (!p) err(b.line, "UNKNOWN_NAME", `layer ${l.layer} has no param \`${b.name}\` (${[...params.keys()].join(", ") || "none"})`);
          else if (b.state && !st) err(b.line, "UNKNOWN_NAME", `no state \`${b.state}\` to bind \`${b.name}\` to`);
          else if (st && JSON.stringify(st.type) !== JSON.stringify(p.type)) err(b.line, "BAD_BINDING", `\`${b.name}\` is ${typeToString(p.type)}, but state \`${b.state}\` is ${typeToString(st.type)}`);
        }
        for (const p of params.values()) if (p.default === undefined && !l.bindings.some((b) => b.name === p.name)) err(l.line, "BAD_BINDING", `layer ${l.layer} needs \`${p.name}\`: bind it in an indented line (\`${p.name} = <state or literal>\`)`);
      }
    }
    (app.clients ??= []).push({ alias: u.alias, contract: parsed.app, testedWith: u.testedWith, providerDigest, through: u.through });
  }

  // Load bundles depth-first; every bundle once.
  const loaded = new Map<string, App>();
  const loadBundle = (name: string, fromLine: number): App | undefined => {
    if (loaded.has(name)) return loaded.get(name);
    const path = bundlePath(name);
    if (!existsSync(path)) {
      err(fromLine, "UNKNOWN_NAME", `no bundle \`${name}\` (looked for ${relative(PROJECT_ROOT, path)})`);
      return;
    }
    const text = readFileSync(path, "utf8");
    const idx = sources.push({ file: relative(PROJECT_ROOT, path), text }) - 1;
    const parsed = parseSyntax(text);
    offsetLines(parsed.app, idx * LINE_BASE);
    diagnostics.push(...parsed.diagnostics.map((d) => ({ ...d, line: d.line + idx * LINE_BASE })));
    if (parsed.app.kind !== "bundle") err(fromLine, "BAD_BINDING", `${relative(PROJECT_ROOT, path)} is not a bundle (it starts with \`${parsed.app.kind ?? "?"}\`)`);
    else if (parsed.app.name !== name) err(idx * LINE_BASE + 1, "BAD_BINDING", `this file must declare \`bundle ${name}\` (it declares \`bundle ${parsed.app.name}\`)`);
    const digest = sha(text);
    bundles.push({ name, file: relative(PROJECT_ROOT, path), sha: digest });
    if (!opts.ignoreLock) {
      const locked = lock.get(name);
      if (!locked) err(fromLine, "LOCK", `bundle \`${name}\` is not locked; run \`intent lock ${sources[0].file}\``);
      else if (locked !== digest) err(fromLine, "LOCK", `bundle \`${name}\` changed since it was locked (${locked} → ${digest}); review the change, then run \`intent lock ${sources[0].file}\``);
    }
    loaded.set(name, parsed.app);
    for (const imp of parsed.app.imports ?? []) loadBundle(imp.bundle, imp.line);
    return parsed.app;
  };
  for (const imp of app.imports ?? []) loadBundle(imp.bundle, imp.line);

  // Merge declarations of all loaded bundles. One flat namespace: a clash is an error.
  const owner = new Map<string, string>();
  for (const r of app.records) owner.set(r.name, "this file");
  for (const c of app.choices) owner.set(c.name, "this file");
  for (const r of app.refined ?? []) owner.set(r.name, "this file");
  for (const c of app.components) owner.set(c.name, "this file");
  const claim = (name: string, by: string, line: number) => {
    const prev = owner.get(name);
    if (prev && prev !== by) err(line, "DUPLICATE", `\`${name}\` comes from both ${prev} and ${by}; rename one with \`import ${by}.${name} as Other${name}\``);
    owner.set(name, by);
  };
  const aliases = new Map<string, Map<string, string>>(); // bundle → name → alias
  for (const imp of app.imports ?? []) {
    if (!imp.name) continue;
    const b = loaded.get(imp.bundle);
    if (b && ![...b.records, ...b.choices, ...b.components].some((d) => d.name === imp.name))
      err(imp.line, "UNKNOWN_NAME", `bundle ${imp.bundle} has no \`${imp.name}\``);
    if (imp.alias) {
      const isComponent = b?.components.some((c) => c.name === imp.name);
      if (b && !isComponent) err(imp.line, "NOT_YET", "renaming a record or choice on import is not in the language yet; only components can be renamed");
      if (!aliases.has(imp.bundle)) aliases.set(imp.bundle, new Map());
      aliases.get(imp.bundle)!.set(imp.name, imp.alias);
    }
  }
  const designs: Design[] = [];
  for (const [name, b] of loaded) {
    for (const r of b.records) (claim(r.name, name, r.line), app.records.push(r));
    for (const c of b.choices) (claim(c.name, name, c.line), app.choices.push(c));
    for (const r of b.refined ?? []) (claim(r.name, name, r.line), (app.refined ??= []).push(r));
    for (const c of b.components) {
      const alias = aliases.get(name)?.get(c.name);
      const comp: Component = { ...c, name: alias ?? c.name, from: name };
      claim(comp.name, name, c.line);
      app.components.push(comp);
    }
    if (b.design) designs.push(b.design);
  }
  // Design: bundles in import order, then the app's own settings on top.
  if (designs.length) {
    const merged: Design = { colors: {} };
    for (const d of [...designs, ...(app.design ? [app.design] : [])]) {
      Object.assign(merged.colors, d.colors);
      for (const k of ["look", "font", "radius", "density"] as const) if (d[k]) merged[k] = d[k];
    }
    app.design = merged;
  }

  // `Problem` is the body of every refusal: { "error": "…" }. Built in for services and contracts.
  if ((app.profile === "api" || app.kind === "contract" || app.clients?.length) && !app.records.some((r) => r.name === "Problem"))
    app.records.push({ name: "Problem", fields: [{ name: "error", type: { k: "Text" }, line: 0 }], line: 0 });
  for (const c of app.components) if (c.body) lintComponent(c, warn);
  const used = expandUses(app, err, warn);
  app.sources = sources;
  if (app.name && app.kind !== "bundle") {
    // (a contract is checked as an api without behaviour)
    diagnostics.push(...checkApp(app, main.clockLine, used));
    checkDirectImports(app, sources, bundles, ownImports, err);
  }
  const out = diagnostics.map((d) => ({ ...d, ...at(d.line) }));
  out.sort((a, b) => (a.file === b.file ? a.line - b.line || a.col - b.col : a.file === sources[0].file ? -1 : 1));
  return { app: out.some((d) => d.level === "error") ? undefined : app, diagnostics: out, sources, bundles, base: baseApp };
}

/**
 * A name used in this file must be declared in it, or in a spec it names itself (`import`, `uses`,
 * `implements`, `extends`): not one that only arrives through another spec. Checked for references
 * in sentences (`@Solved`) and for types in this file's own declarations (`mine: List Ticket`).
 */
function checkDirectImports(app: App, sources: { file: string }[], bundles: { name: string; file: string }[], ownImports: Set<string>, err: (line: number, code: string, message: string) => void) {
  const fileOf = (line: number) => sources[Math.floor(line / LINE_BASE)]?.file;
  const direct = new Set<string | undefined>([sources[0]?.file]);
  for (const b of bundles) if (ownImports.has(b.name)) direct.add(b.file);
  // Where each type, field, choice and value is declared (a name may be declared in several places).
  const decls = new Map<string, { line: number; what: string }[]>();
  const add = (name: string, line: number, what: string) => decls.set(name, [...(decls.get(name) ?? []), { line, what }]);
  for (const r of app.records) {
    add(r.name, r.line, `record ${r.name}`);
    for (const f of r.fields) add(f.name, r.line, `a field of ${r.name}`);
  }
  for (const c of app.choices) {
    add(c.name, c.line, `choice ${c.name}`);
    for (const v of c.values) add(v, c.line, `a value of choice ${c.name}`);
  }
  for (const r of app.refined ?? []) add(r.name, r.line, `type ${r.name}`);
  // One report per missing import: at the first use, with the names this file takes from it.
  const missing = new Map<string, { line: number; file: string; names: string[] }>();
  const check = (name: string, line: number, how: string) => {
    const ds = decls.get(name);
    if (!ds || ds.some((d) => d.line === 0 || direct.has(fileOf(d.line)))) return;
    const file = fileOf(ds[0].line)!;
    const bundle = bundles.find((b) => b.file === file)?.name ?? file;
    const m = missing.get(bundle) ?? missing.set(bundle, { line, file, names: [] }).get(bundle)!;
    if (line < m.line) m.line = line;
    if (!m.names.includes(how)) m.names.push(how);
  };
  for (const s of sentences(app)) if (s.line < LINE_BASE) for (const r of refsIn(s.text)) check(r.split(".")[0], s.line, `\`@${r.split(".")[0]}\``);
  const types = (t: Type): string[] => (t.k === "Named" ? [t.name] : t.k === "List" || t.k === "Maybe" ? types(t.of) : []);
  for (const f of app.state) if (f.line < LINE_BASE) for (const n of types(f.type)) check(n, f.line, `\`${n}\``);
  for (const r of app.records) if (r.line < LINE_BASE && r.line > 0) for (const f of r.fields) for (const n of types(f.type)) check(n, r.line, `\`${n}\``);
  const walk = (els: Element[]) => els.forEach((el) => (el.line < LINE_BASE && el.of && check(el.of, el.line, `\`${el.of}\``), walk(el.children)));
  walk(app.screen);
  if (!app.implements) for (const ep of app.endpoints ?? []) if (ep.line < LINE_BASE) for (const t of [...ep.params.map((p) => p.type), ...(ep.returns ? [ep.returns] : []), ...(ep.answers ?? []).flatMap((a) => (a.type ? [a.type] : []))]) for (const n of types(t)) check(n, ep.line, `\`${n}\``);
  for (const e of app.events ?? []) if (e.line < LINE_BASE) for (const n of types(e.type)) check(n, e.line, `\`${n}\``);
  for (const [bundle, m] of missing) {
    const shown = m.names.slice(0, 5).join(", ") + (m.names.length > 5 ? ` and ${m.names.length - 5} more` : "");
    err(m.line, "IMPORT", `this file uses ${shown} from ${bundle} (${m.file}), but does not import it: add \`import ${bundle}\``);
  }
}

/** Merge a contract into the app that implements it, and check that the app matches it exactly. */
function implementContract(app: App, contract: App, err: (line: number, code: string, message: string) => void) {
  app.profile ??= "api";
  app.imports = [...(contract.imports ?? []), ...(app.imports ?? [])];
  app.records.unshift(...contract.records);
  app.choices.unshift(...contract.choices);
  app.refined = [...(contract.refined ?? []), ...(app.refined ?? [])];
  const own = new Map((app.endpoints ?? []).map((e) => [e.name, e]));
  const merged: NonNullable<App["endpoints"]> = [];
  for (const sig of contract.endpoints ?? []) {
    const impl = own.get(sig.name);
    if (!impl) {
      err(app.implements!.line, "CONTRACT", `endpoint \`${sig.name}\` of the contract is not implemented: add \`endpoint ${sig.name}\` with its steps`);
      continue;
    }
    own.delete(sig.name);
    if (!impl.signatureOnly) {
      const same = impl.method === sig.method && impl.path === sig.path && JSON.stringify(impl.params.map((p) => [p.in, p.name, p.type])) === JSON.stringify(sig.params.map((p) => [p.in, p.name, p.type]));
      if (!same) err(impl.line, "CONTRACT", `endpoint \`${sig.name}\` differs from its contract (${sig.method} ${sig.path}); write only \`endpoint ${sig.name}\` and its steps`);
    }
    if (impl.params.length && impl.signatureOnly) err(impl.line, "CONTRACT", `endpoint \`${sig.name}\`: its params come from the contract`);
    merged.push({ ...sig, steps: impl.steps, stepLines: impl.stepLines, line: impl.line, note: impl.note ?? sig.note, returns: sig.returns ?? sig.answers?.find((a) => a.status < 300 && a.type)?.type });
  }
  for (const extra of own.values()) err(extra.line, "CONTRACT", `endpoint \`${extra.name}\` is not in the contract; a contract is the whole public surface. Add it to the contract first`);
  app.endpoints = merged;
  // Events are part of the public surface too: the contract declares them, the app publishes them.
  for (const e of app.events ?? []) if (!contract.events?.some((c) => c.name === e.name)) err(e.line, "CONTRACT", `event \`${e.name}\` is not in the contract; add it to the contract first`);
  app.events = [...(contract.events ?? [])];
  // The contract's examples run on every implementation (consumer-facing behaviour).
  app.examples.unshift(...contract.examples);
}

/** Inside a component, its own names must be marked (`@page`) so they can be renamed per instance. */
function lintComponent(c: Component, warn: (line: number, code: string, message: string) => void) {
  const body = c.body!;
  const locals = new Set([...body.state.map((f) => f.name), ...body.derive.map((d) => d.name), ...(c.params ?? []).map((p) => p.name)]);
  const check = (text: string | undefined, line: number) => {
    if (!text) return;
    for (const w of bareWords(text))
      // "on page @page": the bare word is ordinary English when the name is marked in the same sentence.
      if (locals.has(w) && !refsIn(text).includes(w) && !text.includes(`{${w}}`)) return warn(line, "UNSCOPED", `\`${w}\` belongs to component ${c.name}; write \`@${w}\` so each use gets its own`);
  };
  for (const d of body.derive) check(d.sentence, d.line);
  for (const h of body.handlers) for (const s of h.steps) check(s, h.line);
  for (const r of body.rules) check(r, c.line);
  const walk = (els: typeof body.screen) => {
    for (const el of els) {
      check(el.visibleWhen, el.line);
      check(el.enabledWhen, el.line);
      if (el.expr && !el.expr.startsWith('"')) check(el.expr, el.line);
      walk(el.children);
    }
  };
  walk(body.screen);
}

/** Fingerprints of the base parts a refining spec overrides, as locked: target → sha. */
export function readOverrideLock(file: string): Map<string, string> {
  const out = new Map<string, string>();
  if (!existsSync(LOCK)) return out;
  for (const line of readFileSync(LOCK, "utf8").split("\n")) {
    const m = line.match(/^@override\s+(\S+)\s+sha256:([0-9a-f]+)\s+(.+)$/);
    if (m && m[1] === file) out.set(m[3], m[2]);
  }
  return out;
}

/** Write intent.lock for every bundle the given files use. */
export function writeLock(files: string[], installed: { name: string; version: string; sha: string; file: string }[] = []): { name: string; sha: string; file: string; version?: string }[] {
  const all = new Map<string, { name: string; sha: string; file: string; version?: string }>();
  const versions = readLockVersions();
  const overrides: string[] = [];
  if (existsSync(LOCK))
    for (const line of readFileSync(LOCK, "utf8").split("\n")) if (line.startsWith("@override") && !files.some((f) => line.split(/\s+/)[1] === relative(PROJECT_ROOT, f))) overrides.push(line);
  for (const [name, digest] of readLock()) all.set(name, { name, sha: digest, file: relative(PROJECT_ROOT, bundlePath(name)), version: versions.get(name) });
  for (const d of installed) all.set(d.name, d);
  for (const f of files) {
    const loaded = load(f, { ignoreLock: true });
    for (const b of loaded.bundles) all.set(b.name, { ...b, version: b.file.includes(".intent/deps/") ? all.get(b.name)?.version : undefined });
    const child = parseSyntax(readFileSync(f, "utf8")).app;
    if (loaded.base)
      for (const r of child.refinements ?? []) overrides.push(`@override ${relative(PROJECT_ROOT, f)} sha256:${sha(JSON.stringify(baseTarget(loaded.base, { ...r } as never) ?? null))} ${targetOf(r)}`);
  }
  const rows = [...all.values()].sort((a, b) => a.name.localeCompare(b.name));
  const width = Math.max(10, ...rows.map((r) => r.name.length)) + 2;
  const pins = compilerPins();
  writeFileSync(
    LOCK,
    `# intent.lock — generated by \`intent lock\`. Commit it.\n# A bundle, the language or the model changing must be reviewed and locked again; builds never pick up a change silently.\n@language ${pins.languageVersion} sha256:${pins.language}  docs/LANGUAGE.md\n@model    ${pins.model}\n${rows.map((r) => `${r.name.padEnd(width)}${r.version ? `${r.version} ` : ""}sha256:${r.sha}  ${r.file}`).join("\n")}\n${overrides.length ? overrides.join("\n") + "\n" : ""}`,
  );
  return rows;
}

/** Where a (possibly encoded) line comes from, with its text. */
export function where(app: App, line: number): { file: string; line: number; text: string } {
  const src = app.sources?.[Math.floor(line / LINE_BASE)] ?? app.sources?.[0];
  const l = line % LINE_BASE;
  return { file: src?.file ?? "", line: l, text: src?.text.split("\n")[l - 1]?.trim() ?? "" };
}

export interface SourceEntry {
  kind: string;
  file: string;
  line: number;
  text: string;
  instance?: string; // the component instance it belongs to (e.g. "pager")
  component?: string; // and that instance's component, with its bundle
  bundle?: string;
}

/**
 * Where everything in the app comes from: element names (the DOM's data-el), handlers, state and
 * derived values → spec file and line. The basis for "point at the app, change the spec".
 */
export function sourceMap(app: App): Record<string, SourceEntry> {
  const map: Record<string, SourceEntry> = {};
  const instances = new Map<string, { component: string; bundle?: string }>();
  const walk = (els: App["screen"], list?: string) => {
    for (const el of els) {
      if (el.kind === "heading") continue;
      const comp = el.as && app.components.find((c) => c.name === el.as && c.body);
      if (comp) instances.set(el.name, { component: comp.name, bundle: comp.from });
      const key = list ? `${list}[].${el.name}` : el.name;
      map[key] = { kind: el.kind, ...where(app, el.line) };
      walk(el.children, el.kind === "list" ? el.name : list);
    }
  };
  walk(app.screen);
  for (const f of app.state) map[`state ${f.name}`] = { kind: "state", ...where(app, f.line) };
  for (const d of app.derive) map[`derive ${d.name}`] = { kind: "derive", ...where(app, d.line) };
  for (const h of app.handlers) {
    const key = `on ${h.verb}${h.target ? " " + h.target : ""}`;
    map[key] = { kind: "handler", ...where(app, h.line) };
    h.stepLines?.forEach((l, i) => (map[`${key} step ${i + 1}`] = { kind: "step", ...where(app, l) }));
  }
  // Services: every endpoint and its steps, the events, and the layers it runs behind.
  for (const ep of app.endpoints ?? []) {
    map[`endpoint ${ep.name}`] = { kind: "endpoint", ...where(app, ep.line) };
    ep.stepLines?.forEach((l, i) => (map[`endpoint ${ep.name} step ${i + 1}`] = { kind: "step", ...where(app, l) }));
  }
  for (const e of app.events ?? []) map[`event ${e.name}`] = { kind: "event", ...where(app, e.line) };
  for (const l of app.layers ?? []) map[`layer ${l.alias}`] = { kind: "layer", ...where(app, l.line) };
  for (const c of app.clients ?? []) if (c.through) map[`through ${c.alias}`] = { kind: "layer", ...where(app, c.through.line) };
  app.rules.forEach((_, i) => app.ruleLines?.[i] && (map[`rule ${i + 1}`] = { kind: "rule", ...where(app, app.ruleLines[i]) }));
  for (const ex of app.examples) map[`example ${ex.name}`] = { kind: "example", ...where(app, ex.line) };
  // Tag everything that belongs to a component instance.
  for (const [key, entry] of Object.entries(map)) {
    const name = key.replace(/^(state|derive|on \w+) /, "");
    const inst = [...instances.keys()].filter((i) => name.startsWith(i + ".")).sort((a, b) => b.length - a.length)[0];
    if (inst) Object.assign(entry, { instance: inst, component: instances.get(inst)!.component, bundle: instances.get(inst)!.bundle });
  }
  return map;
}
