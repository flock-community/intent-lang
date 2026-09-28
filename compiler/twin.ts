// `intent build`: a verified build is a cache hit; anything new is compiled twice, independently.
// When the two compilers build different apps, the spec is ambiguous: stop and say where,
// instead of shipping whichever way one compiler happened to fall.
import { cpSync, existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import type { App } from "./ast.ts";
import { buildOnce, writeProviders, type BuildResult } from "./build.ts";
import { hasClients } from "./calls.ts";
import { load } from "./load.ts";
import { printApp } from "./print.ts";
import { runJobsIsolated, type Action, type ExploreResult, type TraceResult } from "./exec.ts";
import { compare, exploreJobs, makeTraces, orderByDirty, type Divergence } from "./fuzz.ts";
import { PROJECT_ROOT, ROOT, type Target } from "./gen.ts";
import { complete } from "./llm.ts";
import { compilerPins, sha } from "./load.ts";
import { runStyledTraces } from "./look.ts";
import { putDir, withLock } from "./cachedir.ts";
import { apiTraces, callText } from "./api.ts";
import { layerTraces, readLayerConfig, requestText } from "./layer.ts";

const EXPLAIN_SYSTEM = `You help the author of an Intent spec make it unambiguous.
Two compilers built different apps from the same spec; you explain where the spec left them room to differ, briefly and concretely, citing the spec.`;

export const CACHE = join(PROJECT_ROOT, ".intent/cache");

export interface TwinOptions {
  styled?: boolean;
  kit?: boolean;
  twin: "auto" | "always" | "off"; // auto: twin unless a verified build is cached
  incremental?: boolean; // reuse the previous verified build's clean regions (docs/design/incremental.md)
  cleanCheck?: boolean; // after an incremental build, also build from scratch and compare
  sessions?: number;
  length?: number;
  repairs?: number; // how often a failing build goes back to the compiler with its problems
  log: (m: string) => void;
}

export interface TwinResult {
  target: Target;
  ok: boolean;
  dir: string;
  cached: boolean;
  verified: "twin" | "single" | "none";
  ambiguous?: { sessions: number; of: number; report: string };
  builds: BuildResult[];
  costUsd: number;
}

/**
 * The harness a build was made with: every compiler module a build runs (the transitive imports of
 * the build's entry modules, so a new module is never missed), every target and provider, the
 * runtime copied into builds, the standard library, and the versions of the tools that compile and
 * run it. A change to any of them is a new build.
 */
let harness: string | undefined;
const filesIn = (dir: string): string[] => readdirSync(dir, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? filesIn(join(dir, e.name)) : [join(dir, e.name)]));
/** A module and every module it imports (static and dynamic, relative paths), transitively. */
export function importClosure(entries: string[]): string[] {
  const seen = new Set<string>();
  const stack = [...entries];
  while (stack.length) {
    const f = stack.pop()!;
    if (seen.has(f) || !existsSync(f)) continue;
    seen.add(f);
    for (const m of readFileSync(f, "utf8").matchAll(/(?:\bfrom\s*|\bimport\s*\(\s*|^\s*import\s+)["'](\.{1,2}\/[^"']+)["']/gm)) stack.push(resolve(dirname(f), m[1]));
  }
  return [...seen].sort();
}
const toolVersions = () =>
  Object.fromEntries(
    ["elm", "typescript", "esbuild", "tailwindcss", "@tailwindcss/cli", "playwright"].map((p) => {
      try {
        return [p, JSON.parse(readFileSync(join(ROOT, "node_modules", p, "package.json"), "utf8")).version];
      } catch {
        return [p, null];
      }
    }),
  );
export function harnessFiles(): string[] {
  const c = (f: string) => join(ROOT, "compiler", f);
  return [
    ...new Set([
      ...importClosure([c("twin.ts"), c("converge.ts"), c("build.ts"), c("exec.ts"), c("api.ts"), c("layer.ts"), c("invariants.ts"), c("mutate.ts")]),
      ...filesIn(join(ROOT, "compiler/targets")),
      ...filesIn(join(ROOT, "compiler/providers")),
      ...filesIn(join(ROOT, "compiler/quality")),
      ...filesIn(join(ROOT, "runtime")),
      ...filesIn(join(ROOT, "lib/std")),
    ]),
  ].sort();
}
export function harnessDigest(): string {
  return (harness ??= sha(JSON.stringify({ files: harnessFiles().map((f) => [relative(ROOT, f), readFileSync(f, "utf8")]), node: process.versions.node, tools: toolVersions() })));
}

/** What makes two builds the same build: the canonical spec, the compiler (language, model, harness), the target, options, and how deeply it was verified. */
export function cacheKey(specText: string, target: Target, o: Pick<TwinOptions, "styled" | "kit" | "sessions" | "length" | "repairs">): string {
  return sha(JSON.stringify({ specText, compiler: compilerPins(), harness: harnessDigest(), target, styled: !!o.styled, kit: !!o.kit, depth: { sessions: o.sessions ?? 24, length: o.length ?? 20, repairs: o.repairs ?? null } }));
}

const providerBuilds = new Map<string, Promise<TwinResult>>();

/**
 * Apps that make calls are tested against the real provider: build each \`tested with\` app first
 * (twin-verified and cached like any build; once per provider spec, shared by every target).
 */
async function ensureProviders(app: App, o: TwinOptions): Promise<{ providers: Record<string, string> } | { problem: string; costUsd: number }> {
  const providers: Record<string, string> = {};
  let costUsd = 0;
  for (const c of app.clients ?? []) {
    if (!c.testedWith) continue;
    const loaded = load(join(PROJECT_ROOT, c.testedWith));
    if (!loaded.app) return { problem: `the provider ${c.testedWith} has errors`, costUsd };
    const text = printApp(loaded.app);
    const dir = join(PROJECT_ROOT, ".intent/providers", c.providerDigest ?? c.alias);
    if (!providerBuilds.has(dir)) {
      o.log(`building the provider ${c.testedWith} first`);
      // Another process may build the same provider: one at a time per directory (the second gets the cache hit).
      providerBuilds.set(dir, withLock(dir, () => compileApp(loaded.app!, c.testedWith!, text, "ts", dir, { twin: o.twin, sessions: o.sessions, length: o.length, repairs: o.repairs, log: (m) => o.log(`provider ${c.alias}: ${m}`) })));
    }
    const r = await providerBuilds.get(dir)!;
    costUsd += r.cached ? 0 : r.costUsd;
    if (!r.ok) return { problem: `the provider ${c.testedWith} did not build`, costUsd };
    providers[c.alias] = dir;
  }
  return { providers };
}

const layerBuilds = new Map<string, Promise<TwinResult>>();

/** An api behind layers: each layer spec is built once (twin-verified, cached) and its module reused. */
async function ensureLayers(app: App, o: TwinOptions): Promise<{ layers: Record<string, string> } | { problem: string; costUsd: number }> {
  const layers: Record<string, string> = {};
  let costUsd = 0;
  for (const l of [...(app.layers ?? []), ...(app.clients ?? []).flatMap((c) => (c.through?.spec ? [c.through] : []))]) {
    const dir = join(PROJECT_ROOT, ".intent/layers", `${l.layer}-${l.digest}`);
    if (!layerBuilds.has(dir)) {
      o.log(`building the layer ${l.layer} first`);
      layerBuilds.set(dir, withLock(dir, () => compileApp(l.spec!, `${l.layer}.intent`, printApp(l.spec!), "ts", dir, { twin: o.twin, sessions: o.sessions, length: o.length, repairs: o.repairs, log: (m) => o.log(`layer ${l.alias}: ${m}`) })));
    }
    const r = await layerBuilds.get(dir)!;
    costUsd += r.cached ? 0 : r.costUsd;
    if (!r.ok) return { problem: `the layer ${l.layer} did not build${r.ambiguous ? " (its spec is ambiguous)" : ""}`, costUsd };
    layers[l.alias] = dir;
  }
  return { layers };
}

/**
 * The builds an app is tested against before it is built itself: its `tested with` providers (for
 * a screen that makes calls) and the layers its api runs behind. `converge` resolves the same ones
 * `build` does, so a screen-with-calls or an api behind layers converges too.
 */
export async function buildDeps(app: App, o: TwinOptions): Promise<{ providers?: Record<string, string>; layers?: Record<string, string> } | { problem: string }> {
  let layerDirs: Record<string, string> | undefined;
  if (app.layers?.length || app.clients?.some((c) => c.through)) {
    const r = await ensureLayers(app, o);
    if ("problem" in r) return { problem: r.problem };
    layerDirs = r.layers;
  }
  let providers: Record<string, string> | undefined;
  if (hasClients(app)) {
    const p = await ensureProviders(app, o);
    if ("problem" in p) return { problem: p.problem };
    providers = p.providers;
  }
  return { providers, layers: layerDirs };
}

export async function compileApp(app: App, specFile: string, specText: string, target: Target, out: string, o: TwinOptions): Promise<TwinResult> {
  const deps = await buildDeps(app, o);
  if ("problem" in deps) {
    o.log(deps.problem);
    return { target, ok: false, dir: out, cached: false, verified: "none", builds: [], costUsd: 0 };
  }
  const { providers, layers: layerDirs } = deps;
  const key = cacheKey(specText, target, o);
  const cached = join(CACHE, key);
  // A cache hit is copied out under the key's lock (no other process is writing it), and its
  // examples run again before it is used: a hit is a build that still passes, not only a digest.
  const meta = o.twin === "always" ? undefined : await takeCached(cached, out, (m) => m.verified === "twin" || o.twin === "off");
  if (meta) {
    if (providers) writeProviders(app, out, providers);
    const failed = await examplesFail(app, out, target);
    if (!failed) {
      o.log(`cache hit (${meta.verified}-verified build of this exact spec and compiler; ${app.examples.length}/${app.examples.length} examples pass again)`);
      return { target, ok: true, dir: out, cached: true, verified: meta.verified, builds: [], costUsd: 0 };
    }
    o.log(`the cached build fails its examples again (${failed}); compiling again`);
  }
  const opts = { styled: o.styled, kit: o.kit, providers, layers: layerDirs, incremental: o.incremental, maxAttempts: o.repairs === undefined ? undefined : o.repairs + 1 };
  // Incremental: the generated app code depends on everything but the examples. A second cache key
  // (the spec without its examples) lets a later example-only edit reuse the code.
  const codeKey = o.twin !== "off" && app.kind !== "layer" && app.profile !== "api" ? cacheKey(printApp({ ...app, examples: [] }), target, o) : undefined;
  if (codeKey) {
    const codeCached = join(CACHE, codeKey);
    const codeMeta = await takeCached(codeCached, out, (m) => m.verified === "twin");
    if (codeMeta) {
      if (providers) writeProviders(app, out, providers);
      if (!(await examplesFail(app, out, target))) {
        await store(out, cached, "twin", key);
        o.log(`the app code is unchanged; reused it (${app.examples.length}/${app.examples.length} examples pass)`);
        return { target, ok: true, dir: out, cached: false, verified: "twin", builds: [], costUsd: 0 };
      }
      o.log("the reused app code failed the new examples; compiling again");
    }
  }
  if (o.twin === "off") {
    const r = await buildOnce(app, specFile, specText, target, out, { ...opts, log: o.log });
    if (r.ok) await store(out, cached, "single", key);
    return { target, ok: r.ok, dir: out, cached: false, verified: r.ok ? "single" : "none", builds: [r], costUsd: r.costUsd };
  }

  // Two independent compilations of the same spec.
  const twinDir = `${out}.twin`;
  const [a, b] = await Promise.all([
    buildOnce(app, specFile, specText, target, out, { ...opts, log: (m) => o.log(`A: ${m}`) }),
    // B probes: same spec, same defaults, but a different reading wherever the spec leaves a choice.
    buildOnce(app, specFile, specText, target, twinDir, { ...opts, probe: true, log: (m) => o.log(`B (probe): ${m}`) }),
  ]);
  const cost = a.costUsd + b.costUsd;
  const base = { target, dir: out, cached: false, builds: [a, b], costUsd: cost };
  // The budget stopped a compiler: do not ship a half-built twin as verified.
  const overBudget = (r: BuildResult) => r.attempts.some((x) => x.stage === "llm" && String(x.detail).startsWith("over budget"));
  if (overBudget(a) || overBudget(b)) {
    o.log("stopped: over the LLM budget");
    return { ...base, ok: false, verified: "none" };
  }
  if (!a.ok) return { ...base, ok: false, verified: "none" };
  if (!b.ok) {
    // The probe could not find a different reading that passes every example: nothing to compare.
    o.log("the probe found no different reading that passes the examples");
    if (a.incremental && o.cleanCheck) o.log("the clean check is skipped: there is no session comparison to make");
    await store(out, cached, "twin", key);
    if (codeKey) await store(out, join(CACHE, codeKey), "twin", codeKey);
    return { ...base, ok: true, verified: "twin" };
  }

  // History must not leak in: after an incremental build, also build the spec from scratch and
  // compare (docs/design/incremental.md). A difference is a spec that the code's history decided.
  const aClean = o.cleanCheck && a.incremental && !o.styled && app.kind !== "layer" && app.profile !== "api"
    ? await buildOnce(app, specFile, specText, target, `${out}.clean`, { ...opts, incremental: false, log: (m) => o.log(`clean: ${m}`) })
    : undefined;
  if (aClean) {
    base.builds.push(aClean);
    base.costUsd += aClean.costUsd;
    if (aClean.ok) o.log("also built this spec from scratch, to compare");
    else o.log("the clean build did not finish; the incremental build stands");
  }

  // Do they build the same app? Random sessions from the spec plus guided exploration.
  const n = o.sessions ?? 24;
  const length = o.length ?? 20;
  const layer = app.kind === "layer";
  const api = app.profile === "api" && !layer;
  let traces: Action[][] = api || layer ? [] : makeTraces(app, Math.ceil(n / 2), length, 7);
  const calls = api ? apiTraces(app, n, length, 7) : [];
  const requests = layer ? layerTraces(app, n, length, 7) : [];
  if (!api && !layer) {
    const ex = await runJobsIsolated(a.dir, target, exploreJobs(app, Math.floor(n / 2), length), 600_000);
    if (!("error" in ex)) traces = traces.concat((ex as ExploreResult[]).map((e) => e.actions));
    // An incremental build: run the sessions that touch a rewritten unit first (docs/design/incremental.md).
    traces = orderByDirty(traces, a.dirtyUnits ?? []);
  }
  const perBuild = new Map<string, (string[] | null)[]>();
  const builds: [string, BuildResult][] = [["A", a], ["B", b], ...(aClean?.ok ? [["A'", aClean] as [string, BuildResult]] : [])];
  for (const [id, r] of builds) {
    if (layer) {
      const config = readLayerConfig(r.dir);
      const res = await runJobsIsolated(r.dir, target, requests.map((rs) => ({ kind: "layer-trace" as const, requests: rs, config })), 600_000);
      perBuild.set(id, "error" in res ? requests.map(() => null) : (res as TraceResult[]).map((t) => (t.error ? null : t.steps)));
    } else if (api) {
      const res = await runJobsIsolated(r.dir, target, calls.map((c) => ({ kind: "api-trace" as const, calls: c })), 600_000);
      perBuild.set(id, "error" in res ? calls.map(() => null) : (res as TraceResult[]).map((t) => (t.error ? null : t.steps)));
    } else if (o.styled) perBuild.set(id, (await runStyledTraces(r.dir, app, traces)).map((t) => t.steps));
    else {
      const res = await runJobsIsolated(r.dir, target, traces.map((actions) => ({ kind: "trace" as const, actions })), 600_000);
      perBuild.set(id, "error" in res ? traces.map(() => null) : (res as TraceResult[]).map((t) => (t.error ? null : t.steps)));
    }
  }
  const cmp = layer ? compare(requests, perBuild, requestText, false) : api ? compare(calls, perBuild, callText, false) : compare(traces, perBuild);
  if (cmp.agree === cmp.total) {
    await store(out, cached, "twin", key);
    if (codeKey) await store(out, join(CACHE, codeKey), "twin", codeKey);
    rmSync(twinDir, { recursive: true, force: true });
    o.log(`the probe's reading behaves the same (${cmp.total} sessions): the spec is unambiguous here`);
    return { ...base, ok: true, verified: "twin" };
  }

  // A build that crashes on most sessions is broken, not a reading of the spec: the build fails.
  const crashes = [...perBuild].map(([id, seqs]) => ({ id, n: seqs.filter((x) => !x).length })).filter((c) => c.n);
  const broken = crashes.filter((c) => c.n * 2 > cmp.total);
  if (broken.length) {
    o.log(`build ${broken.map((c) => `${c.id} crashed on ${c.n} of ${cmp.total} sessions`).join(", ")}: not verified`);
    return { ...base, ok: false, verified: "none" };
  }
  // They differ (a session some build crashed on differs too): the spec leaves something open. Stop and say what.
  const report = renderDivergences(cmp.divergences, cmp.total - cmp.agree, cmp.total);
  const explanation = await explain(specFile, specText, report);
  const full = `${report}\n## What the spec leaves open\n\n${explanation.text}\n`;
  writeFileSync(join(out, "..", `ambiguity-${target}.md`), full);
  return { ...base, ok: false, verified: "none", costUsd: cost + explanation.costUsd, ambiguous: { sessions: cmp.total - cmp.agree, of: cmp.total, report: full } };
}

/** Keep a verified build under its key: whole or not at all, under the key's lock (cachedir.ts). */
export async function store(dir: string, cached: string, verified: "twin" | "single", key: string) {
  await withLock(cached, () => putDir(dir, cached, { "intent-build.json": JSON.stringify({ key, verified, at: new Date().toISOString(), compiler: compilerPins() }, null, 2) }));
}

/** Copy a cached build out (under its lock) when its record says it may be used: its record, or undefined. */
export async function takeCached(cached: string, out: string, usable: (meta: { key: string; verified: "twin" | "single" }) => boolean): Promise<{ key: string; verified: "twin" | "single" } | undefined> {
  return withLock(cached, () => {
    const file = join(cached, "intent-build.json");
    const meta = existsSync(file) ? JSON.parse(readFileSync(file, "utf8")) : undefined;
    if (!meta || !usable(meta)) return undefined;
    // The same build is there already (another build of this process's dependencies copied it): keep it, do not rewrite a directory someone may be reading.
    const here = join(out, "intent-build.json");
    if (existsSync(here) && JSON.parse(readFileSync(here, "utf8")).key === meta.key) return meta;
    rmSync(out, { recursive: true, force: true });
    cpSync(cached, out, { recursive: true });
    return meta;
  });
}

/** Run a build's examples again: undefined when all pass, else what failed. */
async function examplesFail(app: App, dir: string, target: Target): Promise<string | undefined> {
  const jobs = app.kind === "layer" ? app.examples.map((example) => ({ kind: "layer-example" as const, example, config: readLayerConfig(dir) })) : app.profile === "api" ? app.examples.map((example) => ({ kind: "api-example" as const, example, always: app.always })) : app.examples.map((example) => ({ kind: "example" as const, example, always: app.always }));
  const results = await runJobsIsolated(dir, target, jobs as never);
  if ("error" in results) return results.error;
  const failed = (results as { name?: string; pass?: boolean }[]).filter((r) => !r.pass);
  return failed.length ? failed.map((r) => r.name).join(", ") : undefined;
}

/** The differing sessions, grouped by what differs, as a readable report. */
function renderDivergences(divs: Divergence[], bad: number, total: number): string {
  const out = [`# Two compilers built different apps from this spec`, "", `They differ in ${bad} of ${total} sessions. The first differences:`, ""];
  const seen = new Set<string>();
  for (const d of divs) {
    const [x, y] = d.groups;
    if (!x || !y) continue;
    const onlyA = x.screen.split("\n").filter((l) => !y.screen.split("\n").includes(l));
    const onlyB = y.screen.split("\n").filter((l) => !x.screen.split("\n").includes(l));
    const sig = [...onlyA, "|", ...onlyB].join("\n");
    if (seen.has(sig)) continue;
    seen.add(sig);
    out.push(`## After these steps`, "", "```", ...d.actions.slice(-6), "```", "", `Compiler ${x.builds.join(",")} shows:`, "```", ...(onlyA.length ? onlyA : ["(nothing extra)"]), "```", `Compiler ${y.builds.join(",")} shows:`, "```", ...(onlyB.length ? onlyB : ["(nothing extra)"]), "```", "");
    if (seen.size >= 3) break;
  }
  return out.join("\n");
}

/** Ask one question per open point, with the spec line and the sentence or example that would settle it. */
async function explain(specFile: string, specText: string, report: string): Promise<{ text: string; costUsd: number }> {
  const language = readFileSync(join(ROOT, "docs/LANGUAGE.md"), "utf8");
  const numbered = specText.split("\n").map((l, i) => `${String(i + 1).padStart(3)}  ${l}`).join("\n");
  const prompt = `# Language reference\n\n${language}\n\n# The spec (${specFile}), as the compilers read it\n\n\`\`\`\n${numbered}\n\`\`\`\n\n${report}\n\nTwo compilers read this spec independently and built apps that behave differently after the steps above. For each difference (at most 3), write:\n\n### <a question the spec does not answer>\n- Where: <the spec line(s) involved, quoted>\n- Compiler A read it as: <…>; compiler B as: <…>\n- To settle it, add: <the exact sentence or example steps>\n\nDo not decide which reading is right when it is a real choice for the author; say what the choice is.`;
  const r = await complete(EXPLAIN_SYSTEM, prompt);
  return { text: r.error ? `(could not explain: ${r.error})` : r.text.trim(), costUsd: r.costUsd };
}
