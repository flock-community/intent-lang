// `intent build`: a verified build is a cache hit; anything new is compiled twice, independently.
// When the two compilers build different apps, the spec is ambiguous: stop and say where,
// instead of shipping whichever way one compiler happened to fall.
import { cpSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { App } from "./ast.ts";
import { buildOnce, writeProviders, type BuildResult } from "./build.ts";
import { hasClients } from "./calls.ts";
import { load } from "./load.ts";
import { printApp } from "./print.ts";
import { runJobsIsolated, type Action, type ExploreResult, type TraceResult } from "./exec.ts";
import { compare, exploreJobs, makeTraces, type Divergence } from "./fuzz.ts";
import { PROJECT_ROOT, ROOT, type Target } from "./gen.ts";
import { complete } from "./llm.ts";
import { compilerPins, sha } from "./load.ts";
import { runStyledTraces } from "./look.ts";
import { apiTraces, callText } from "./api.ts";
import { layerTraces, readLayerConfig, requestText } from "./layer.ts";

const EXPLAIN_SYSTEM = `You help the author of an Intent spec make it unambiguous.
Two compilers built different apps from the same spec; you explain where the spec left them room to differ, briefly and concretely, citing the spec.`;

export const CACHE = join(PROJECT_ROOT, ".intent/cache");

export interface TwinOptions {
  styled?: boolean;
  kit?: boolean;
  twin: "auto" | "always" | "off"; // auto: twin unless a verified build is cached
  sessions?: number;
  length?: number;
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

/** What makes two builds the same build: the canonical spec, the compiler, the target and options. */
export function cacheKey(specText: string, target: Target, o: Pick<TwinOptions, "styled" | "kit">): string {
  return sha(JSON.stringify({ specText, compiler: compilerPins(), target, styled: !!o.styled, kit: !!o.kit }));
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
      providerBuilds.set(dir, compileApp(loaded.app, c.testedWith, text, "ts", dir, { twin: o.twin, sessions: o.sessions, length: o.length, log: (m) => o.log(`provider ${c.alias}: ${m}`) }));
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
      layerBuilds.set(dir, compileApp(l.spec!, `${l.layer}.intent`, printApp(l.spec!), "ts", dir, { twin: o.twin, sessions: o.sessions, length: o.length, log: (m) => o.log(`layer ${l.alias}: ${m}`) }));
    }
    const r = await layerBuilds.get(dir)!;
    costUsd += r.cached ? 0 : r.costUsd;
    if (!r.ok) return { problem: `the layer ${l.layer} did not build${r.ambiguous ? " (its spec is ambiguous)" : ""}`, costUsd };
    layers[l.alias] = dir;
  }
  return { layers };
}

export async function compileApp(app: App, specFile: string, specText: string, target: Target, out: string, o: TwinOptions): Promise<TwinResult> {
  let layerDirs: Record<string, string> | undefined;
  if (app.layers?.length || app.clients?.some((c) => c.through)) {
    const r = await ensureLayers(app, o);
    if ("problem" in r) {
      o.log(r.problem);
      return { target, ok: false, dir: out, cached: false, verified: "none", builds: [], costUsd: r.costUsd };
    }
    layerDirs = r.layers;
  }
  let providers: Record<string, string> | undefined;
  if (hasClients(app)) {
    const p = await ensureProviders(app, o);
    if ("problem" in p) {
      o.log(p.problem);
      return { target, ok: false, dir: out, cached: false, verified: "none", builds: [], costUsd: p.costUsd };
    }
    providers = p.providers;
  }
  const key = cacheKey(specText, target, o);
  const cached = join(CACHE, key);
  const meta = existsSync(join(cached, "intent-build.json")) ? JSON.parse(readFileSync(join(cached, "intent-build.json"), "utf8")) : undefined;
  if (meta && o.twin !== "always" && (meta.verified === "twin" || o.twin === "off")) {
    rmSync(out, { recursive: true, force: true });
    cpSync(cached, out, { recursive: true });
    if (providers) writeProviders(app, out, providers);
    o.log(`cache hit (${meta.verified}-verified build of this exact spec and compiler)`);
    return { target, ok: true, dir: out, cached: true, verified: meta.verified, builds: [], costUsd: 0 };
  }
  const opts = { styled: o.styled, kit: o.kit, providers, layers: layerDirs };
  if (o.twin === "off") {
    const r = await buildOnce(app, specFile, specText, target, out, { ...opts, log: o.log });
    if (r.ok) store(out, cached, "single", key);
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
  if (!a.ok) return { ...base, ok: false, verified: "none" };
  if (!b.ok) {
    // The probe could not find a different reading that passes every example: nothing to compare.
    o.log("the probe found no different reading that passes the examples");
    store(out, cached, "twin", key);
    return { ...base, ok: true, verified: "twin" };
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
  }
  const perBuild = new Map<string, (string[] | null)[]>();
  for (const [id, r] of [["A", a], ["B", b]] as const) {
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
    store(out, cached, "twin", key);
    rmSync(twinDir, { recursive: true, force: true });
    o.log(`the probe's reading behaves the same (${cmp.total} sessions): the spec is unambiguous here`);
    return { ...base, ok: true, verified: "twin" };
  }

  // They differ: the spec leaves something open. Stop and say what.
  const report = renderDivergences(cmp.divergences, cmp.total - cmp.agree, cmp.total);
  const explanation = await explain(specFile, specText, report);
  const full = `${report}\n## What the spec leaves open\n\n${explanation.text}\n`;
  writeFileSync(join(out, "..", `ambiguity-${target}.md`), full);
  return { ...base, ok: false, verified: "none", costUsd: cost + explanation.costUsd, ambiguous: { sessions: cmp.total - cmp.agree, of: cmp.total, report: full } };
}

function store(dir: string, cached: string, verified: "twin" | "single", key: string) {
  rmSync(cached, { recursive: true, force: true });
  mkdirSync(cached, { recursive: true });
  cpSync(dir, cached, { recursive: true });
  writeFileSync(join(cached, "intent-build.json"), JSON.stringify({ key, verified, at: new Date().toISOString(), compiler: compilerPins() }, null, 2));
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
