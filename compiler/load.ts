// Loading a spec with its imports: resolve bundles from lib/, verify them against intent.lock,
// merge their declarations, expand `use` of behaviour components, then check the whole app.
// Lines of imported files are encoded as fileIndex * LINE_BASE + line (see App.sources).
import { createHash } from "node:crypto";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join, relative } from "node:path";
import { LINE_BASE, type App, type Component, type Diagnostic, type Design } from "./ast.ts";
import { expandUses } from "./expand.ts";
import { ROOT } from "./gen.ts";
import { checkApp, parseSyntax } from "./parse.ts";
import { baseTarget, refine, targetOf } from "./refine.ts";
import { MODEL } from "./llm.ts";

export const LIB = join(ROOT, "lib");
export const LOCK = join(ROOT, "intent.lock");

export interface Loaded {
  app?: App; // undefined when there are errors
  diagnostics: Diagnostic[];
  sources: { file: string; text: string }[];
  bundles: { name: string; file: string; sha: string }[];
  base?: App; // the published app this spec extends
}

export const bundlePath = (name: string) => join(LIB, ...name.split(".")) + ".intent";
export const sha = (text: string) => createHash("sha256").update(text).digest("hex").slice(0, 16);

export function readLock(): Map<string, string> {
  const lock = new Map<string, string>();
  if (!existsSync(LOCK)) return lock;
  for (const line of readFileSync(LOCK, "utf8").split("\n")) {
    const m = line.match(/^([a-z][\w.]*)\s+sha256:([0-9a-f]+)/);
    if (m) lock.set(m[1], m[2]);
  }
  return lock;
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
  else if (v && typeof v === "object") for (const [k, x] of Object.entries(v)) k === "line" && typeof x === "number" ? (v[k] = x + base) : offsetLines(x, base);
}

export function load(file: string, opts: { ignoreLock?: boolean } = {}): Loaded {
  const sources = [{ file: relative(ROOT, file), text: readFileSync(file, "utf8") }];
  const diagnostics: Diagnostic[] = [];
  const at = (line: number): { file: string; line: number } => ({ file: sources[Math.floor(line / LINE_BASE)]?.file ?? sources[0].file, line: line % LINE_BASE });
  const push = (level: "error" | "warning") => (line: number, code: string, message: string, col = 1) => diagnostics.push({ level, code, line, col, message });
  const err = push("error");
  const warn = push("warning");

  const main = parseSyntax(sources[0].text);
  diagnostics.push(...main.diagnostics);
  let app = main.app;
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
    if (!existsSync(path)) err(base.line, "UNKNOWN_NAME", `no published app \`${base.name}\` (looked for ${relative(ROOT, path)})`);
    else {
      const text = readFileSync(path, "utf8");
      const idx = sources.push({ file: relative(ROOT, path), text }) - 1;
      const parsed = parseSyntax(text);
      offsetLines(parsed.app, idx * LINE_BASE);
      diagnostics.push(...parsed.diagnostics.map((d) => ({ ...d, line: d.line + idx * LINE_BASE })));
      if (parsed.app.kind !== "app") err(base.line, "BAD_BINDING", `${relative(ROOT, path)} is a bundle; \`extends\` takes a published app`);
      if (parsed.app.extends) err(base.line, "NOT_YET", "the base extends another spec itself; refinement is one level deep (compose components beyond that)");
      const digest = sha(text);
      bundles.push({ name: base.name, file: relative(ROOT, path), sha: digest });
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

  // Load bundles depth-first; every bundle once.
  const loaded = new Map<string, App>();
  const loadBundle = (name: string, fromLine: number): App | undefined => {
    if (loaded.has(name)) return loaded.get(name);
    const path = bundlePath(name);
    if (!existsSync(path)) {
      err(fromLine, "UNKNOWN_NAME", `no bundle \`${name}\` (looked for ${relative(ROOT, path)})`);
      return;
    }
    const text = readFileSync(path, "utf8");
    const idx = sources.push({ file: relative(ROOT, path), text }) - 1;
    const parsed = parseSyntax(text);
    offsetLines(parsed.app, idx * LINE_BASE);
    diagnostics.push(...parsed.diagnostics.map((d) => ({ ...d, line: d.line + idx * LINE_BASE })));
    if (parsed.app.kind !== "bundle") err(fromLine, "BAD_BINDING", `${relative(ROOT, path)} is not a bundle (it starts with \`${parsed.app.kind ?? "?"}\`)`);
    else if (parsed.app.name !== name) err(idx * LINE_BASE + 1, "BAD_BINDING", `this file must declare \`bundle ${name}\` (it declares \`bundle ${parsed.app.name}\`)`);
    const digest = sha(text);
    bundles.push({ name, file: relative(ROOT, path), sha: digest });
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

  for (const c of app.components) if (c.body) lintComponent(c, warn);
  const used = expandUses(app, err, warn);
  app.sources = sources;
  if (app.name && app.kind !== "bundle") {
    diagnostics.push(...checkApp(app, main.clockLine, used));
  }
  const out = diagnostics.map((d) => ({ ...d, ...at(d.line) }));
  out.sort((a, b) => (a.file === b.file ? a.line - b.line || a.col - b.col : a.file === sources[0].file ? -1 : 1));
  return { app: out.some((d) => d.level === "error") ? undefined : app, diagnostics: out, sources, bundles, base: baseApp };
}

/** Inside a component, its own names must be anchored in braces so they can be renamed per instance. */
function lintComponent(c: Component, warn: (line: number, code: string, message: string) => void) {
  const body = c.body!;
  const locals = new Set([...body.state.map((f) => f.name), ...body.derive.map((d) => d.name), ...(c.params ?? []).map((p) => p.name)]);
  const check = (text: string | undefined, line: number) => {
    if (!text) return;
    const outside = text.replace(/\{[^{}]*\}/g, " ").replace(/"(?:[^"\\]|\\.)*"/g, " ");
    for (const w of outside.match(/[a-z][A-Za-z0-9]*/g) ?? [])
      // "on page {page}": the bare word is ordinary English when the name is anchored in the same sentence.
      if (locals.has(w) && !text.includes(`{${w}}`)) return warn(line, "UNSCOPED", `\`${w}\` belongs to component ${c.name}; write \`{${w}}\` so each use gets its own`);
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
export function writeLock(files: string[]): { name: string; sha: string; file: string }[] {
  const all = new Map<string, { name: string; sha: string; file: string }>();
  const overrides: string[] = [];
  if (existsSync(LOCK))
    for (const line of readFileSync(LOCK, "utf8").split("\n")) if (line.startsWith("@override") && !files.some((f) => line.split(/\s+/)[1] === relative(ROOT, f))) overrides.push(line);
  for (const [name, digest] of readLock()) all.set(name, { name, sha: digest, file: relative(ROOT, bundlePath(name)) });
  for (const f of files) {
    const loaded = load(f, { ignoreLock: true });
    for (const b of loaded.bundles) all.set(b.name, b);
    const child = parseSyntax(readFileSync(f, "utf8")).app;
    if (loaded.base)
      for (const r of child.refinements ?? []) overrides.push(`@override ${relative(ROOT, f)} sha256:${sha(JSON.stringify(baseTarget(loaded.base, { ...r } as never) ?? null))} ${targetOf(r)}`);
  }
  const rows = [...all.values()].sort((a, b) => a.name.localeCompare(b.name));
  const width = Math.max(10, ...rows.map((r) => r.name.length)) + 2;
  const pins = compilerPins();
  writeFileSync(
    LOCK,
    `# intent.lock — generated by \`intent lock\`. Commit it.\n# A bundle, the language or the model changing must be reviewed and locked again; builds never pick up a change silently.\n@language ${pins.languageVersion} sha256:${pins.language}  docs/LANGUAGE.md\n@model    ${pins.model}\n${rows.map((r) => `${r.name.padEnd(width)}sha256:${r.sha}  ${r.file}`).join("\n")}\n${overrides.length ? overrides.join("\n") + "\n" : ""}`,
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
  for (const h of app.handlers) map[`on ${h.verb}${h.target ? " " + h.target : ""}`] = { kind: "handler", ...where(app, h.line) };
  // Tag everything that belongs to a component instance.
  for (const [key, entry] of Object.entries(map)) {
    const name = key.replace(/^(state|derive|on \w+) /, "");
    const inst = [...instances.keys()].filter((i) => name.startsWith(i + ".")).sort((a, b) => b.length - a.length)[0];
    if (inst) Object.assign(entry, { instance: inst, component: instances.get(inst)!.component, bundle: instances.get(inst)!.bundle });
  }
  return map;
}
