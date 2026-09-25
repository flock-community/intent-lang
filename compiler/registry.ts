// Dependencies and a registry. A project lists what it requires in `intent.project`; versions
// are chosen with minimal version selection (Go modules): for every bundle, the highest of the
// minimum versions anyone requires — never a newer release nobody asked for. Downloads land in
// .intent/deps/ and are pinned (version + hash) in intent.lock. A local lib/ bundle always wins,
// so bundles can be developed in place.
//
// The registry is static files, so any file server can host it:
//   <registry>/index.json                     { bundles: { "std.list": { versions: { "1.0.0": { sha, file, requires, published } } } } }
//   <registry>/<bundle path>/<version>.intent
import { fromBraces } from "./braces.ts";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import type { App } from "./ast.ts";
import { PROJECT_ROOT } from "./gen.ts";
import { parseSyntax } from "./parse.ts";

export const PROJECT = join(PROJECT_ROOT, "intent.project");
export const DEPS = join(PROJECT_ROOT, ".intent/deps");

export interface Project {
  name: string;
  registry?: string;
  requires: { name: string; version: string; line: number }[];
  /** How the compiler runs (the `compiler` block: `model …`, `twin …`): option → raw value, checked in config.ts. */
  compiler?: Record<string, string>;
}

export interface IndexEntry {
  sha: string;
  file: string;
  requires: Record<string, string>;
  published: string;
  api: string[]; // the exported surface, for computing the next version
  examples: string[]; // fingerprints of the demo's examples: behaviour is part of the contract
}
export type RegistryIndex = { bundles: Record<string, { versions: Record<string, IndexEntry> }> };

// ---------------------------------------------------------------- versions

export const parseVersion = (v: string): [number, number, number] => {
  const [a = 0, b = 0, c = 0] = v.split(".").map(Number);
  return [a, b, c];
};
export const cmpVersion = (x: string, y: string): number => {
  const a = parseVersion(x), b = parseVersion(y);
  return a[0] - b[0] || a[1] - b[1] || a[2] - b[2];
};
const fmtVersion = (v: [number, number, number]) => v.join(".");

// ---------------------------------------------------------------- project file

export function readProject(path = PROJECT): Project | undefined {
  if (!existsSync(path)) return undefined;
  const p: Project = { name: "", requires: [] };
  let inRequires = false;
  let inCompiler = false;
  fromBraces(readFileSync(path, "utf8")).text.split("\n").forEach((raw, i) => {
    const line = raw.replace(/#.*$/, "").trimEnd();
    if (!line.trim()) return;
    let m: RegExpMatchArray | null;
    if ((m = line.match(/^project\s+(\S+)$/))) (p.name = m[1]), (inRequires = inCompiler = false);
    else if ((m = line.match(/^registry\s+(\S+)$/))) (p.registry = m[1]), (inRequires = inCompiler = false);
    else if (line === "requires") (inRequires = true), (inCompiler = false);
    else if (line === "compiler") (inCompiler = true), (inRequires = false), (p.compiler ??= {});
    else if (inRequires && (m = line.match(/^\s+([a-z][\w.]*)\s+(\d+(?:\.\d+){0,2})$/))) p.requires.push({ name: m[1], version: m[2], line: i + 1 });
    else if (inCompiler && (m = line.match(/^\s+(llm|model|targets|twin|sessions|length|repairs)\s+(.+)$/))) p.compiler![m[1]] = m[2].trim();
    else if (inCompiler) throw new Error(`intent.project:${i + 1}: in \`compiler\`: \`llm\`, \`model\`, \`targets\`, \`twin\`, \`sessions\`, \`length\` or \`repairs\`, then its value (keys stay in the environment)`);
    else throw new Error(`intent.project:${i + 1}: expected \`project <name>\`, \`registry <folder or url>\`, \`requires\` with \`<bundle> <version>\` lines, or \`compiler\` with options, in its block`);
  });
  return p;
}

// ---------------------------------------------------------------- registry access (folder or http)

function registryBase(project: Project): string {
  const r = project.registry ?? "./registry";
  return /^https?:\/\//.test(r) ? r.replace(/\/$/, "") : join(PROJECT_ROOT, r);
}

async function fetchText(base: string, path: string): Promise<string> {
  if (/^https?:\/\//.test(base)) {
    const res = await fetch(`${base}/${path}`);
    if (!res.ok) throw new Error(`registry: ${base}/${path}: ${res.status}`);
    return res.text();
  }
  return readFileSync(join(base, path), "utf8");
}

export async function readIndex(base: string): Promise<RegistryIndex> {
  try {
    return JSON.parse(await fetchText(base, "index.json"));
  } catch {
    return { bundles: {} };
  }
}

// ---------------------------------------------------------------- minimal version selection

/**
 * For every bundle reachable from the project's requirements: the highest of the minimum
 * versions required anywhere in the graph (Go's MVS). Deterministic, and it never picks a
 * release that nobody asked for.
 */
export function selectVersions(project: Project, index: RegistryIndex): { selected: Map<string, string>; problems: string[] } {
  const selected = new Map<string, string>();
  const problems: string[] = [];
  const queue: [string, string][] = project.requires.map((r) => [r.name, r.version]);
  while (queue.length) {
    const [name, min] = queue.shift()!;
    const versions = Object.keys(index.bundles[name]?.versions ?? {}).sort(cmpVersion);
    // The lowest published version that satisfies the minimum (same major).
    const pick = versions.find((v) => cmpVersion(v, min) >= 0 && parseVersion(v)[0] === parseVersion(min)[0]);
    if (!pick) {
      problems.push(`no published version of ${name} satisfies ${min} (published: ${versions.join(", ") || "none"})`);
      continue;
    }
    const prev = selected.get(name);
    if (prev && parseVersion(prev)[0] !== parseVersion(pick)[0]) problems.push(`${name}: both ${prev} and ${pick} are required, and they are different major versions`);
    if (!prev || cmpVersion(pick, prev) > 0) {
      selected.set(name, pick);
      for (const [dep, v] of Object.entries(index.bundles[name].versions[pick].requires)) queue.push([dep, v]);
    }
  }
  return { selected, problems };
}

/** Download the selected versions into .intent/deps and return what to pin. */
export async function install(project: Project): Promise<{ installed: { name: string; version: string; sha: string; file: string }[]; problems: string[] }> {
  const base = registryBase(project);
  const index = await readIndex(base);
  const { selected, problems } = selectVersions(project, index);
  const installed: { name: string; version: string; sha: string; file: string }[] = [];
  mkdirSync(DEPS, { recursive: true });
  for (const [name, version] of [...selected].sort()) {
    const entry = index.bundles[name].versions[version];
    const target = depPath(name, version);
    if (!existsSync(target)) {
      const text = await fetchText(base, entry.file);
      const { sha } = await import("./load.ts");
      if (sha(text) !== entry.sha) {
        problems.push(`${name} ${version}: the downloaded file does not match the registry's hash`);
        continue;
      }
      writeFileSync(target, text);
    }
    installed.push({ name, version, sha: entry.sha, file: relative(PROJECT_ROOT, target) });
  }
  return { installed, problems };
}

export const depPath = (name: string, version: string) => join(DEPS, `${name}@${version}.intent`);

// ---------------------------------------------------------------- publishing

/** The exported surface of a bundle: names, record fields, choice values, component params and elements. */
export function apiOf(b: App): string[] {
  const out: string[] = [];
  for (const r of b.records) for (const f of r.fields) out.push(`record ${r.name}.${f.name}${f.default ? "?" : ""}`);
  for (const c of b.choices) for (const v of c.values) out.push(`choice ${c.name}.${v}`);
  for (const c of b.components) {
    out.push(`component ${c.name}`);
    for (const p of c.params ?? []) out.push(`param ${c.name}.${p.name}${p.default !== undefined ? "?" : ""}`);
    const walk = (els: App["screen"]) => els.forEach((e) => (e.kind !== "heading" && out.push(`element ${c.name}.${e.name}`), walk(e.children)));
    walk(c.body?.screen ?? []);
    for (const f of c.body?.state ?? []) out.push(`state ${c.name}.${f.name}`);
    for (const d of c.body?.derive ?? []) out.push(`derive ${c.name}.${d.name}`);
  }
  if (b.design) out.push("design");
  for (const r of b.refined ?? []) out.push(`type ${r.name} = ${r.base} ${r.pattern ?? ""}${r.min ?? ""}..${r.max ?? ""}`);
  // A contract's surface is the wire: endpoint signatures, param and answer types, and field types.
  if (b.kind === "contract") {
    const ty = (t: import("./ast.ts").Type): string => (t.k === "List" || t.k === "Maybe" ? `${t.k} ${ty(t.of)}` : t.k === "Named" ? t.name : t.k);
    for (const r of b.records) for (const f of r.fields) out.push(`field ${r.name}.${f.name}: ${ty(f.type)}`);
    for (const e of b.endpoints ?? []) {
      out.push(`endpoint ${e.name} ${e.method} ${e.path}`);
      for (const p of e.params) out.push(`param ${e.name}.${p.in}.${p.name}: ${ty(p.type)}${p.type.k === "Maybe" ? "?" : ""}`);
      for (const a of e.answers ?? []) out.push(`answers ${e.name} ${a.status}${a.type ? `: ${ty(a.type)}` : ""}`);
    }
  }
  return out.sort();
}

/**
 * The next version is computed, not chosen: a removed or changed name, a new required param, or a
 * changed or removed demo example is a breaking change (major); anything new is a minor; else patch.
 */
export function nextVersion(prev: IndexEntry | undefined, prevVersion: string | undefined, api: string[], examples: string[]): { version: string; why: string[] } {
  if (!prev || !prevVersion) return { version: "1.0.0", why: ["first release"] };
  const [maj, min, pat] = parseVersion(prevVersion);
  const removed = prev.api.filter((a) => !api.includes(a) && !api.includes(a.replace(/\?$/, "")) && !api.includes(a + "?"));
  const newRequired = api.filter((a) => a.startsWith("param ") && !a.endsWith("?") && !prev.api.includes(a));
  const nowRequired = api.filter((a) => a.startsWith("param ") && !a.endsWith("?") && prev.api.includes(a + "?"));
  const changedExamples = prev.examples.filter((e) => !examples.includes(e));
  const breaking = [...removed.map((r) => `removed: ${r}`), ...newRequired.map((r) => `new required: ${r}`), ...nowRequired.map((r) => `now required: ${r}`), ...(changedExamples.length ? [`${changedExamples.length} demo example(s) changed or removed: its behaviour changed`] : [])];
  if (breaking.length) return { version: fmtVersion([maj + 1, 0, 0]), why: breaking };
  const added = api.filter((a) => !prev.api.includes(a) && !prev.api.includes(a.replace(/\?$/, "")));
  const newExamples = examples.filter((e) => !prev.examples.includes(e));
  if (added.length || newExamples.length) return { version: fmtVersion([maj, min + 1, 0]), why: [...added.map((a) => `added: ${a}`), ...(newExamples.length ? [`${newExamples.length} new demo example(s)`] : [])] };
  return { version: fmtVersion([maj, min, pat + 1]), why: ["no change in names or demo behaviour"] };
}

export async function publish(bundleFile: string, registry: string, sha: (t: string) => string, demoExamples: string[]): Promise<{ name: string; version: string; why: string[] }> {
  if (/^https?:\/\//.test(registry)) throw new Error("publishing goes to a registry folder (upload that folder to your server)");
  const text = readFileSync(bundleFile, "utf8");
  const { app } = parseSyntax(text);
  if (app.kind !== "bundle" && app.kind !== "app" && app.kind !== "contract") throw new Error(`${bundleFile} is not a bundle, app or contract`);
  const name = app.name.includes(".") ? app.name : relative(join(PROJECT_ROOT, "lib"), bundleFile).replace(/\.intent$/, "").split("/").join(".");
  const index = await readIndex(registry);
  const versions = Object.keys(index.bundles[name]?.versions ?? {}).sort(cmpVersion);
  const prevVersion = versions[versions.length - 1];
  const prev = prevVersion ? index.bundles[name].versions[prevVersion] : undefined;
  const api = apiOf(app);
  const next = nextVersion(prev, prevVersion, api, demoExamples);
  const digest = sha(text);
  if (prev && prev.sha === digest) return { name, version: prevVersion!, why: ["unchanged: already published"] };
  const file = `${name.split(".").join("/")}/${next.version}.intent`;
  mkdirSync(dirname(join(registry, file)), { recursive: true });
  writeFileSync(join(registry, file), text);
  // What this version requires: the versions its imports resolve to right now (the publisher's lock).
  const { readLockVersions } = await import("./load.ts");
  const pinned = readLockVersions();
  const requires: Record<string, string> = {};
  for (const imp of app.imports ?? []) requires[imp.bundle] = pinned.get(imp.bundle) ?? "1.0.0";
  if (app.extends) requires[app.extends.name] = pinned.get(app.extends.name) ?? "1.0.0";
  index.bundles[name] ??= { versions: {} };
  index.bundles[name].versions[next.version] = { sha: digest, file, requires, published: new Date().toISOString(), api, examples: demoExamples };
  writeFileSync(join(registry, "index.json"), JSON.stringify(index, null, 2) + "\n");
  return { name, version: next.version, why: next.why };
}
