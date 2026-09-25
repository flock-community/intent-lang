// The stability pipeline: build every spec N times per target, then check that all builds
// are the same app (examples + differential traces). Writes report.md / report.json.
import { appendFileSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { basename, join, resolve } from "node:path";
import type { App } from "./ast.ts";
import { buildOnce, type BuildResult } from "./build.ts";
import { buildDeps } from "./twin.ts";
import { runJobsIsolated, type Action, type ExploreResult, type TraceResult, type Violation } from "./exec.ts";
import { apiTraces, callText } from "./api.ts";
import { layerTraces, readLayerConfig, requestText } from "./layer.ts";
import { actionText, compare, exploreJobs, makeTraces, type Divergence } from "./fuzz.ts";
import { ROOT, type Target } from "./gen.ts";
import { runStyledTraces } from "./look.ts";
import { closeBrowser } from "./browser.ts";
import { compareVisuals, contactSheet, type VisualReport } from "./visual.ts";
import { load as loadSpec } from "./load.ts";
import { printApp } from "./print.ts";

export interface ConvergeOptions {
  builds: number;
  targets: Target[];
  out: string;
  traces: number;
  length: number;
  concurrency: number;
  tag: string;
  styled?: boolean;
  kit?: boolean;
}

function pool(limit: number) {
  let active = 0;
  const queue: (() => void)[] = [];
  return async <T,>(fn: () => Promise<T>): Promise<T> => {
    if (active >= limit) await new Promise<void>((r) => queue.push(r));
    active++;
    try {
      return await fn();
    } finally {
      active--;
      queue.shift()?.();
    }
  };
}

function similarity(a: string, b: string): number {
  const norm = (s: string) => new Set(s.split("\n").map((l) => l.trim()).filter(Boolean));
  const A = norm(a);
  const B = norm(b);
  const inter = [...A].filter((x) => B.has(x)).length;
  return inter / (A.size + B.size - inter || 1);
}

interface AppReport {
  app: string;
  file: string;
  builds: { id: string; ok: boolean; attempts: number; failedAttempts?: number; costUsd: number; seconds: number; firstFailure?: string }[];
  agreement: { all?: number; elm?: number; ts?: number; crossTarget?: number };
  matchMajority: Record<string, number>;
  codeSimilarity: Partial<Record<Target, number>>;
  divergences: Divergence[];
  violations: Record<string, { sessions: number; first: Violation }>;
  fidelity?: Record<string, { sessions: number; first: string }>;
  visual?: VisualReport;
  traces: number;
}

export async function converge(files: string[], o: ConvergeOptions): Promise<AppReport[]> {
  mkdirSync(o.out, { recursive: true });
  const run = pool(o.concurrency);
  const reports: AppReport[] = [];

  const perApp = await Promise.all(
    files.map(async (file) => {
      const { app } = loadSpec(resolve(file));
      const src = app ? printApp(app) : "";
      if (!app) throw new Error(`${file} does not pass the checker`);
      const name = basename(file, ".intent");
      // The builds an app is tested against (its providers and layers), as `build` resolves them.
      const deps = await buildDeps(app, { styled: o.styled, kit: o.kit, twin: "auto", sessions: o.traces, length: o.length, repairs: 3, log: (m) => console.log(`${name}: ${m}`) });
      if ("problem" in deps) throw new Error(`${file}: ${deps.problem}`);
      const jobs: Promise<BuildResult & { id: string }>[] = [];
      for (const target of o.targets)
        for (let i = 1; i <= o.builds; i++) {
          const id = `${target}-${i}`;
          jobs.push(
            run(() => buildOnce(app, basename(file), src, target, join(o.out, name, id), { styled: o.styled, kit: o.kit, providers: deps.providers, layers: deps.layers, log: (m) => console.log(`${name} ${id}: ${m}`) })).then((r) => ({ ...r, id })),
          );
        }
      return { file, name, app, results: await Promise.all(jobs) };
    }),
  );

  for (const { file, name, app, results } of perApp) reports.push(await analyse(file, name, app, results, o));
  await closeBrowser();
  return writeReports(reports, o);
}

/** Re-run only the analysis on the builds of an earlier run (e.g. after improving the fuzzer). */
export async function reanalyse(files: string[], o: ConvergeOptions): Promise<AppReport[]> {
  const reports: AppReport[] = [];
  for (const file of files) {
    const { app } = loadSpec(resolve(file));
    const name = basename(file, ".intent");
    const dir = join(o.out, name);
    const results = readdirSync(dir)
      .filter((id) => /^(elm|ts)-\d+$/.test(id))
      .map((id) => ({ ...(JSON.parse(readFileSync(join(dir, id, "build.json"), "utf8")) as BuildResult), id }));
    reports.push(await analyse(file, name, app!, results, o));
  }
  await closeBrowser();
  return writeReports(reports, o, `report-${o.tag}`);
}

function writeReports(reports: AppReport[], o: ConvergeOptions, name = "report"): AppReport[] {
  writeFileSync(join(o.out, `${name}.json`), JSON.stringify(reports, null, 2));
  writeFileSync(join(o.out, `${name}.md`), renderReport(reports, o));
  appendFileSync(
    join(ROOT, "runs/history.jsonl"),
    JSON.stringify({
      at: new Date().toISOString(),
      tag: o.tag,
      out: o.out,
      apps: reports.map((r) => ({ app: r.app, ok: r.builds.filter((b) => b.ok).length, of: r.builds.length, agreement: r.agreement, cost: +r.builds.reduce((s, b) => s + b.costUsd, 0).toFixed(2) })),
    }) + "\n",
  );
  return reports;
}

async function analyse(file: string, name: string, app: App, results: (BuildResult & { id: string })[], o: ConvergeOptions): Promise<AppReport> {
  const ok = results.filter((r) => r.ok);
  const layer = app.kind === "layer";
  const api = app.profile === "api" && !layer;
  // Screens: half blind sessions (from the spec), half guided on a reference build. APIs and layers:
  // their calls/requests, generated from the spec.
  let traces: Action[][] = api || layer ? [] : makeTraces(app, Math.ceil(o.traces / 2), o.length, 7);
  const calls = api ? apiTraces(app, o.traces, o.length, 7) : [];
  const requests = layer ? layerTraces(app, o.traces, o.length, 7) : [];
  const ref = ok.find((r) => r.target === "ts") ?? ok[0];
  if (ref && !api && !layer) {
    const ex = await runJobsIsolated(ref.dir, ref.target, exploreJobs(app, Math.floor(o.traces / 2), o.length), 600_000);
    if (!("error" in ex)) traces = traces.concat((ex as ExploreResult[]).map((e) => e.actions));
  }
  const n = api ? calls.length : layer ? requests.length : traces.length;
  const perBuild = new Map<string, (string[] | null)[]>();
  const violations: Record<string, { sessions: number; first: Violation }> = {};
  const fidelity: Record<string, { sessions: number; first: string }> = {};
  let visual: VisualReport | undefined;
  if (o.styled && !api && !layer) {
    // Styled builds: sessions go through the real page; the screen is what the DOM shows.
    await Promise.all(
      ok.map(async (r) => {
        const res = await runStyledTraces(r.dir, app, traces);
        perBuild.set(r.id, res.map((t) => t.steps));
        const bad = res.filter((t) => t.mismatch);
        if (bad.length) fidelity[r.id] = { sessions: bad.length, first: bad[0].mismatch! };
      }),
    );
    const builds = ok.map((r) => ({ id: r.id, dir: r.dir })).sort((a, b) => a.id.localeCompare(b.id, undefined, { numeric: true }));
    visual = compareVisuals(builds);
    mkdirSync(join(o.out, name, "sheets"), { recursive: true });
    for (const st of visual.states) contactSheet(builds, st, join(o.out, name, "sheets", `${st}.png`));
  } else await Promise.all(
    ok.map(async (r) => {
      const jobs = layer
        ? requests.map((rs) => ({ kind: "layer-trace" as const, requests: rs, config: readLayerConfig(r.dir) }))
        : api
          ? calls.map((c) => ({ kind: "api-trace" as const, calls: c, always: app.always }))
          : traces.map((actions) => ({ kind: "trace" as const, actions, always: app.always }));
      const res = await runJobsIsolated(r.dir, r.target, jobs, 600_000);
      perBuild.set(r.id, "error" in res ? Array.from({ length: n }, () => null) : (res as TraceResult[]).map((t) => (t.error ? null : t.steps)));
      if (!("error" in res)) {
        const vs = (res as TraceResult[]).filter((t) => t.violation);
        if (vs.length) violations[r.id] = { sessions: vs.length, first: vs[0].violation! };
      }
    }),
  );
  const ordered = new Map([...perBuild.entries()].sort(([a], [b]) => a.localeCompare(b, undefined, { numeric: true })));
  const sub = (pred: (id: string) => boolean) => new Map([...ordered].filter(([id]) => pred(id)));
  const cmp = (m: Map<string, (string[] | null)[]>) => (api ? compare(calls, m, callText, false) : layer ? compare(requests, m, requestText, false) : compare(traces, m));
  const rate = (m: Map<string, (string[] | null)[]>) => (m.size >= 2 ? cmp(m).agree / n : undefined);
  // (with fewer than two builds there is nothing to compare)
  const all = ordered.size ? cmp(ordered) : { agree: 0, total: n, divergences: [], matchMajority: new Map<string, number>() };

  // Cross-target: does the majority behaviour of Elm equal that of TS?
  let crossTarget: number | undefined;
  const elmIds = [...ordered.keys()].filter((k) => k.startsWith("elm"));
  const tsIds = [...ordered.keys()].filter((k) => k.startsWith("ts"));
  if (elmIds.length && tsIds.length) {
    let same = 0;
    for (let ti = 0; ti < n; ti++) {
      const major = (ids: string[]) => {
        const counts = new Map<string, number>();
        for (const id of ids) {
          const k = ordered.get(id)![ti]?.join("\n") ?? "CRASH";
          counts.set(k, (counts.get(k) ?? 0) + 1);
        }
        return [...counts.entries()].sort((a, b) => b[1] - a[1])[0][0];
      };
      if (major(elmIds) === major(tsIds)) same++;
    }
    crossTarget = same / n;
  }

  const codeSimilarity: Partial<Record<Target, number>> = {};
  for (const t of o.targets) {
    const codes = ok.filter((r) => r.target === t).map((r) => readFileSync(join(r.dir, layer ? "layer.ts" : t === "elm" ? "src/App.elm" : "app.ts"), "utf8"));
    const sims: number[] = [];
    for (let i = 0; i < codes.length; i++) for (let j = i + 1; j < codes.length; j++) sims.push(similarity(codes[i], codes[j]));
    if (sims.length) codeSimilarity[t] = sims.reduce((a, b) => a + b, 0) / sims.length;
  }

  return {
    app: app.name,
    file,
    builds: results.map((r) => ({
      id: r.id,
      ok: r.ok,
      attempts: r.attempts.length,
      failedAttempts: r.attempts.filter((a) => !String(a.stage).endsWith("ok")).length,
      costUsd: +r.costUsd.toFixed(3),
      seconds: Math.round(r.ms / 1000),
      firstFailure: r.attempts.find((a) => !String(a.stage).endsWith("ok"))?.detail.slice(0, 300),
    })),
    agreement: { all: ordered.size >= 2 ? all.agree / n : undefined, elm: rate(sub((id) => id.startsWith("elm"))), ts: rate(sub((id) => id.startsWith("ts"))), crossTarget },
    matchMajority: Object.fromEntries([...all.matchMajority].map(([k, v]) => [k, v / n])),
    codeSimilarity,
    divergences: all.divergences,
    violations,
    fidelity,
    visual,
    traces: n,
  };
}

const pct = (x?: number) => (x === undefined ? "–" : `${Math.round(x * 100)}%`);

export function renderReport(reports: AppReport[], o: ConvergeOptions): string {
  const out: string[] = [`# Convergence report — ${o.tag}`, "", `${o.builds} builds per target (${o.targets.join(", ")}), ${o.traces} random sessions × ${o.length} actions per app.`, ""];
  out.push("| App | Builds OK | First-try OK | `always` held | Same app: all | Elm | TS | Elm≡TS | Code sim. Elm / TS | Cost |", "|---|---|---|---|---|---|---|---|---|---|");
  for (const r of reports) {
    const ok = r.builds.filter((b) => b.ok).length;
    const first = r.builds.filter((b) => b.ok && (b.failedAttempts ?? b.attempts - 1) === 0).length;
    const cost = r.builds.reduce((s, b) => s + b.costUsd, 0);
    const held = r.builds.filter((b) => b.ok && !r.violations?.[b.id]).length;
    out.push(`| ${r.app} | ${ok}/${r.builds.length} | ${first}/${r.builds.length} | ${held}/${ok} | ${pct(r.agreement.all)} | ${pct(r.agreement.elm)} | ${pct(r.agreement.ts)} | ${pct(r.agreement.crossTarget)} | ${pct(r.codeSimilarity.elm)} / ${pct(r.codeSimilarity.ts)} | $${cost.toFixed(2)} |`);
  }
  out.push("", "*Same app* = share of random sessions in which every build showed identical screens after every action.", "");
  const styled = reports.filter((r) => r.visual);
  if (styled.length) {
    out.push("### Looks (styled builds)", "", "| App | Page = logic | Pixels differ: Elm / TS / Elm↔TS | Local layout agrees: Elm / TS / Elm↔TS | Boxes within 8px (absolute) | Median box offset (px) |", "|---|---|---|---|---|---|");
    for (const r of styled) {
      const v = r.visual!.byGroup;
      const okBuilds = r.builds.filter((b) => b.ok).length;
      const faithful = okBuilds - Object.keys(r.fidelity ?? {}).length;
      const p = (x: number) => (Number.isNaN(x) ? "–" : `${(x * 100).toFixed(1)}%`);
      out.push(`| ${r.app} | ${faithful}/${okBuilds} | ${p(v.elm.pixelDiff)} / ${p(v.ts.pixelDiff)} / ${p(v.cross.pixelDiff)} | ${pct(v.elm.local)} / ${pct(v.ts.local)} / ${pct(v.cross.local)} | ${pct(v.elm.within8)} / ${pct(v.ts.within8)} / ${pct(v.cross.within8)} | ${[v.elm.median, v.ts.median, v.cross.median].map((m) => (Number.isNaN(m) ? "–" : m.toFixed(0))).join(" / ")} |`);
    }
    out.push("", "*Page = logic*: builds whose page showed exactly the logic's screen in every session. *Pixels differ*: average share of differing pixels between two builds' screenshots of the same state. *Local layout agrees*: share of elements whose position relative to their parent, and whose size, are within 8px, so one taller block counts once instead of shifting everything below it. *Boxes within 8px (absolute)*: the same on absolute page positions.", "");
  }
  for (const r of reports) {
    out.push(`## ${r.app}`, "");
    out.push(`Builds: ${r.builds.map((b) => `${b.id} ${b.ok ? "✓" : "✗"}${b.attempts > 1 ? ` (${b.attempts} attempts)` : ""}`).join(", ")}`, "");
    const failed = r.builds.filter((b) => !b.ok || (b.failedAttempts ?? b.attempts - 1) > 0);
    for (const b of failed) out.push(`- ${b.id} first problem: ${b.firstFailure?.replace(/\n/g, " ").slice(0, 400)}`);
    for (const [id, f] of Object.entries(r.fidelity ?? {})) out.push(`- **${id}: the page differs from the logic in ${f.sessions} session(s):** ${f.first}`);
    if (r.visual) out.push("", `Contact sheets: \`${join(basename(o.out), r.file.replace(/^.*\//, "").replace(".intent", ""), "sheets")}/\``, "");
    for (const [id, v] of Object.entries(r.violations ?? {})) {
      out.push(`- **${id} breaks \`always\` (line ${v.first.line}) in ${v.sessions} session(s):** ${v.first.message}`, "", "```", ...v.first.actions.slice(-8).map(actionText), "```");
    }
    out.push("", `Agreement with the majority: ${Object.entries(r.matchMajority).map(([k, v]) => `${k} ${pct(v)}`).join(", ")}`, "");
    // Group divergences by their first diverging action, show a few.
    const seen = new Set<string>();
    let shown = 0;
    for (const d of r.divergences) {
      const sig = d.actions[d.actions.length - 1] + " | " + d.groups.map((g) => g.builds.join(",")).join(" / ");
      if (seen.has(sig) || shown >= 6) continue;
      seen.add(sig);
      shown++;
      out.push(`### Divergence in session ${d.trace + 1} after ${d.actions.length} action(s)`, "", "```", ...d.actions.slice(-8).map((a, i, xs) => `${i === xs.length - 1 ? "→" : " "} ${a}`), "```", "");
      for (const g of d.groups) out.push(`**${g.builds.join(", ")}** see:`, "```", g.screen, "```");
      out.push("");
    }
    if (r.divergences.length > shown) out.push(`(${r.divergences.length} diverging sessions in total)`, "");
  }
  return out.join("\n");
}
