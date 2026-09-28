// One build: spec → scaffold → LLM → compile → examples, with a bounded repair loop.
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { App } from "./ast.ts";
import { runJobsIsolated, type Action, type ExampleResult, type ExploreResult, type TraceResult } from "./exec.ts";
import { actionText, asExample, exploreJobs, shrink } from "./fuzz.ts";
import { changePlan, hasChangeRules } from "./changes.ts";
import { ROOT, scaffold, type Target } from "./gen.ts";
import { complete, extractCode } from "./llm.ts";
import { buildPrompt, incrementalPrompt, layerPrompt, repairPrompt, SYSTEM } from "./prompt.ts";
import { targetModule } from "./targets/index.ts";
import { apiTraces, callText, type Call } from "./api.ts";
import { readFileSync } from "node:fs";
import { buildLook } from "./look.ts";
import { compilerPins, sourceMap, where } from "./load.ts";
import { units } from "./units.ts";
import { checkIncremental, checkRegions, regionUnits } from "./regions.ts";
import { loadIncremental, planIncremental, saveIncremental } from "./incremental.ts";
import { typeDescOf } from "./targets/ts-service.ts";
import { callDescs, eventWireTypes, hasClients, hasThrough, manifest, wireType } from "./calls.ts";
import { usesClock } from "./refs.ts";
import { prepareInvariants, stageSentences } from "./invariants.ts";
import { dataField, hasData, hasHomes, hasInvariants, hasStored } from "./gen.ts";
import { keyedLists } from "./homes.ts";
import { ownRandomness, usesDraws } from "./draws.ts";
import { drawTable, loadDrawTable, simplerDraws } from "./drawer.ts";
import { readLayerConfig } from "./layer.ts";
import { accessPlan, actsAsOf } from "./access.ts";

export interface BuildResult {
  target: Target;
  dir: string;
  ok: boolean;
  attempts: { stage: "llm" | "compile" | "examples" | "always" | "spec" | "ok"; detail: string }[];
  examples: { passed: number; total: number };
  compiler?: { language: string; languageVersion: string; model: string }; // what this build was compiled with
  incremental?: boolean; // this build reused the previous build's clean regions
  dirtyUnits?: string[]; // the units an incremental build rewrote (for the twin's session order)
  costUsd: number;
  ms: number;
}

export interface BuildOptions {
  maxAttempts?: number;
  log?: (msg: string) => void;
  styled?: boolean; // also let the LLM write the presentation (Look) with Tailwind
  probe?: boolean; // the probe compiler of a twin build: takes different readings where the spec allows
  kit?: boolean; // give the Look stage the generated design-system Kit
  providers?: Record<string, string>; // apps that make calls: per alias, the provider build that answers them in tests
  layers?: Record<string, string>; // api apps behind layers: per alias, the verified layer build to reuse
  incremental?: boolean; // reuse the previous verified build's clean regions (docs/design/incremental.md)
}

/** Apps that make calls: which provider build answers which alias, for the test driver. */
export function writeProviders(app: App, dir: string, providers: Record<string, string>) {
  const events = eventWireTypes(app);
  writeFileSync(join(dir, "providers.json"), JSON.stringify({ endpoints: callDescs(app), providers, ...(Object.keys(events).length ? { events } : {}) }, null, 2));
}

export async function buildOnce(app: App, specFile: string, specText: string, target: Target, dir: string, opts: BuildOptions = {}): Promise<BuildResult> {
  const maxAttempts = opts.maxAttempts ?? 4;
  const log = opts.log ?? (() => {});
  const which = opts.probe ? "probe" : "main"; // each compiler of a twin keeps its own previous code
  const t0 = Date.now();
  const layer = app.kind === "layer";
  const api = app.profile === "api" && !layer;
  const res: BuildResult = { target, dir, ok: false, attempts: [], examples: { passed: 0, total: app.examples.length }, compiler: compilerPins(), costUsd: 0, ms: 0 };
  const tm = targetModule(target);
  const svc = tm.service;
  if ((api || layer) && !svc) {
    res.attempts.push({ stage: "compile", detail: `the api profile has a TypeScript harness only (so far); ${target} is not in the harness yet` });
    return res;
  }
  if (app.platforms?.length && !api && !layer) {
    // The Elm side exists for the pure platform whose code was ported (std.crypto); anything else
    // is TypeScript-only, and a platform that reads the compiler cannot run in a screen at all.
    if (target === "elm") {
      const unported = app.platforms.find((p) => p.name !== "std.crypto");
      if (unported) {
        res.attempts.push({ stage: "compile", detail: `platform \`${unported.name}\` is not ported to Elm (so far; docs/design/platform.md)` });
        return res;
      }
    }
    const serviceOnly = app.platforms.find((p) => {
      const file = join(ROOT, "runtime/ts/platform", `${p.name}.ts`);
      return existsSync(file) && readFileSync(file, "utf8").includes("compiler/");
    });
    if (serviceOnly) {
      res.attempts.push({ stage: "compile", detail: `platform \`${serviceOnly.name}\` runs in the harness, so a screen cannot use it (docs/design/platform.md)` });
      return res;
    }
  }
  if (app.profile === "job" && !tm.job) {
    // Without its entry (job.mjs) a job's build is a page of its state, which no host can run.
    res.attempts.push({ stage: "compile", detail: `a job (\`profile job\`) has its entry for the host (job.mjs) in the TypeScript harness only (so far); ${target} is not in the harness yet: build it with the ts target` });
    return res;
  }
  if (app.screens?.length && !tm.prompt.screens) {
    res.attempts.push({ stage: "compile", detail: `apps with several screens are not in the ${target} harness yet (docs/design/screens.md)` });
    return res;
  }
  if (hasClients(app) && opts.styled) {
    res.attempts.push({ stage: "compile", detail: "styled builds of apps that make calls are not in the harness yet" });
    return res;
  }
  const { appFile, specSource } = layer ? svc!.scaffoldLayer(app, dir) : api ? svc!.scaffoldApi(app, dir, opts.layers) : tm.scaffold(app, dir, opts.layers);
  if (hasClients(app)) writeProviders(app, dir, opts.providers ?? {});
  // What this app may use of each api (its `only` lists, else what its handlers use): a host grants these.
  if (app.clients?.length) writeFileSync(join(dir, "manifest.json"), JSON.stringify(manifest(app), null, 2));
  if (api) writeFileSync(join(dir, "endpoints.json"), JSON.stringify((app.endpoints ?? []).map((e) => ({ name: e.name, method: e.method, path: e.path, params: e.params.map((p) => ({ in: p.in, name: p.name, ...(wireType(app, p.type) ? { type: typeDescOf(app, p.type) } : {}) })), ...(e.effect ? { external: true } : {}) }))));
  writeFileSync(join(dir, "sourcemap.json"), JSON.stringify(sourceMap(app), null, 2));
  writeFileSync(join(dir, "units.json"), JSON.stringify(units(app), null, 2));
  // Apps that read the clock: where it starts in tests, and how far one clock tick moves it.
  if (usesClock(app)) writeFileSync(join(dir, "clock.json"), JSON.stringify({ start: app.startsAt ?? "2026-01-05T09:00", tickMs: app.clockMs ?? 0, jobs: (app.jobs ?? []).map((j) => ({ name: j.name, every: j.every })), ...(app.sizes ? { sizes: app.sizes } : {}) }));
  // Several screens: their addresses, for the test driver (which keeps the history).
  if (app.screens?.length) writeFileSync(join(dir, "screens.json"), JSON.stringify(app.screens.map((s) => ({ name: s.name, path: s.path }))));
  // Stored state: which fields of the data a restart keeps (the driver saves them, restarts, and checks they came back).
  // Lists a reference points into: their keys stay unique (the driver checks the data after every step).
  // Lists inside rows too: an inner row's key stays unique within its outer row (the path of keys finds one row).
  if (hasHomes(app) && !layer) writeFileSync(join(dir, "keys.json"), JSON.stringify(keyedLists(app).map((h) => ({ field: dataField(h.list), list: h.list, key: h.key, record: h.record, line: app.state.find((f) => f.name === h.list)?.line ?? 0, ...(h.inner ? { inner: h.inner } : {}) }))));
  if (hasStored(app) && !layer) writeFileSync(join(dir, "stored.json"), JSON.stringify(app.state.filter((f) => f.stored).map((f) => ({ field: dataField(f.name), line: f.line }))));
  // Change rules: the named forms the harness checks itself, and the sentences the stage compiles (their lines).
  if (hasChangeRules(app) && !layer) writeFileSync(join(dir, "changes.json"), JSON.stringify(changePlan(app), null, 2));
  // Draws: every place a sentence draws, and what it draws from (the driver steers and seeds them).
  if (usesDraws(app) && !layer) writeFileSync(join(dir, "draws.json"), JSON.stringify(drawTable(app), null, 2));
  // Access (v70): the plan the harness enforces (the drivers read it for rule mutation), and how a test acts as a caller.
  if (api && app.access) writeFileSync(join(dir, "access.json"), JSON.stringify(accessPlan(app), null, 2));
  if (api && actsAsOf(app)) writeFileSync(join(dir, "acting.json"), JSON.stringify(actsAsOf(app), null, 2));
  mkdirSync(join(dir, "log"), { recursive: true });
  // Sentences in `always` over the data: their checks are compiled once per spec, apart from the app
  // (the change rules the harness reads itself need no stage).
  const stage = stageSentences(app);
  if (hasInvariants(app) && !layer && (stage.invariants.length || stage.changes.length)) {
    const inv = await prepareInvariants(app, specText, dir, log);
    res.costUsd += inv.costUsd;
    if (inv.error) {
      res.attempts.push({ stage: "compile", detail: inv.error });
      res.ms = Date.now() - t0;
      return res;
    }
  }
  const regions = opts.incremental && !layer && !api && !opts.styled ? regionUnits(app) : [];
  const base = layer ? layerPrompt(specFile, specText, specSource, !!opts.probe, !!app.beforeCall) : buildPrompt(target, specFile, specText, specSource, !!opts.probe, api, hasClients(app), hasThrough(app), usesClock(app), hasData(app), hasStored(app), !!app.screens?.length, !!app.platforms?.length, regions, usesDraws(app), !!app.access);

  let code = "";
  let problems = "";
  let usedIncremental = false;
  // An incremental build: ask for the dirty regions only, keep the previous clean ones, and accept
  // the answer only if nothing else moved. Any problem falls back to a full build below.
  if (regions.length) {
    const prev = loadIncremental(app, target, which, tm.appFile);
    const plan = prev && planIncremental(app, prev);
    if (prev && plan) {
      const r = await complete(SYSTEM, incrementalPrompt(base, target, prev.code, plan.diff.dirty, plan.diff.removed), !!opts.probe);
      res.costUsd += r.costUsd;
      if (!r.error) {
        const candidate = extractCode(r.text);
        const why = checkIncremental(prev.code, candidate, target, plan.diff.dirty, plan.regions);
        if (!why.length) {
          code = candidate;
          usedIncremental = true;
          res.dirtyUnits = plan.diff.dirty;
          const kept = plan.regions.filter((r) => plan.diff.clean.includes(r)).length;
          log(`reusing the previous build's clean regions (${kept} kept, ${plan.regions.length - kept} rewritten)`);
        } else log(`the incremental edit is not safe (${why[0]}); compiling from scratch`);
      }
    }
  }
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    // The incremental candidate is attempt 1's code; from attempt 2 on (or a problem), the compiler runs.
    if (attempt === 1 && code) {
      writeFileSync(appFile, code);
    } else {
      const prompt = problems ? repairPrompt(base, target, code, problems) : base;
      writeFileSync(join(dir, `log/prompt-${attempt}.md`), prompt);
      const r = await complete(SYSTEM, prompt, !!opts.probe);
      res.costUsd += r.costUsd;
      if (r.error) {
        res.attempts.push({ stage: "llm", detail: r.error });
        log(`attempt ${attempt}: llm error ${r.error}`);
        if (r.error.startsWith("over budget")) break; // no point in trying again
        continue;
      }
      writeFileSync(join(dir, `log/response-${attempt}.md`), r.text);
      const conflict = r.text.match(/SPEC CONFLICT:.*/);
      if (conflict && !r.text.includes("```")) {
        // The compiler reports an error in the source instead of guessing.
        res.attempts.push({ stage: "spec", detail: conflict[0] });
        log(`attempt ${attempt}: ${conflict[0]}`);
        break;
      }
      code = extractCode(r.text);
      writeFileSync(appFile, code);
      // The marks for an incremental build: every behaviour unit exactly once. Best-effort: marks
      // that are missing or wrong only mean this build cannot be reused region by region, so it is
      // still built and shipped (the next build falls back to a full one).
      if (regions.length) {
        const rp = checkRegions(code, target, regions);
        if (rp.length) log(`attempt ${attempt}: the region marks are wrong (${rp[0]}); building without incremental reuse`);
      }
    }

    // Randomness is the harness's: a module that makes its own is rejected before anything runs.
    const own = layer ? undefined : ownRandomness(readFileSync(appFile, "utf8"), target);
    if (own) {
      problems = `The module makes its own randomness (${own}). Draws come from the harness: use the \`Draws\` functions of the generated interface where a sentence draws, and nothing else random.`;
      res.attempts.push({ stage: "compile", detail: `rejected: the module makes its own randomness (${own})` });
      log(`attempt ${attempt}: rejected, the module makes its own randomness (${own})`);
      continue;
    }
    const errors = layer ? await svc!.compileLayer(dir) : api ? await svc!.compileApi(dir) : await tm.compile(dir);
    if (errors) {
      problems = `The module does not compile:\n\n\`\`\`\n${errors}\n\`\`\``;
      res.attempts.push({ stage: "compile", detail: errors.slice(0, 1500) });
      log(`attempt ${attempt}: compile errors`);
      continue;
    }

    const results = await runJobsIsolated(dir, target, layer ? app.examples.map((example) => ({ kind: "layer-example" as const, example, config: readLayerConfig(dir) })) : api ? app.examples.map((example) => ({ kind: "api-example" as const, example, always: app.always })) : app.examples.map((example) => ({ kind: "example" as const, example, always: app.always })));
    if ("error" in results) {
      problems = `Running the examples failed: ${results.error}`;
      res.attempts.push({ stage: "examples", detail: results.error });
      log(`attempt ${attempt}: ${results.error}`);
      continue;
    }
    const exs = results as ExampleResult[];
    const failed = exs.filter((e) => !e.pass);
    res.examples.passed = exs.length - failed.length;
    // An api with an access block is hunted too: every session checks that a refusal changes nothing.
    if (!failed.length && (app.always.length || hasChangeRules(app) || (api && app.access))) {
      // Examples pass; now hunt for a session that breaks an `always` rule.
      const ex = api
        ? await runJobsIsolated(dir, target, apiTraces(app, 40, 25, 11).map((calls) => ({ kind: "api-trace" as const, calls, always: app.always })), 300_000)
        : await runJobsIsolated(dir, target, exploreJobs(app, 40, 25, 11), 300_000);
      // A batch that could not run, or a session that crashed, proves nothing: it is a failure too.
      const broke = sessionsBroke(ex);
      if (broke) {
        problems = `All examples pass, but ${broke.problem}`;
        res.attempts.push({ stage: "always", detail: broke.detail });
        log(`attempt ${attempt}: ${broke.detail.slice(0, 160)}`);
        continue;
      }
      let v = (ex as ExploreResult[]).find((e) => e.violation)?.violation;
      if (v && !v.ambiguous) v = await shortest(dir, target, app, api, v);
      if (v) {
        const w = where(app, v.line);
        const head = v.ambiguous
          ? `The sentence in \`always\` at ${w.file}:${w.line} (\`${w.text}\`) is read two ways`
          : `All examples pass, but this session breaks the rule at ${w.file}:${w.line} (\`${w.text}\`)`;
        const steps = v.actions.map((a) => ("endpoint" in a ? callText(a as unknown as Call) : actionText(a)));
        problems = `${head}: ${v.message}\n\nThe session, from the initial screen:\n\`\`\`\n${steps.join("\n")}\n\`\`\`\n\nAs an example (it fails until the app keeps the rule):\n\`\`\`intent\n${asExample(w.text.replace(/^- /, ""), steps, `(${w.file}:${w.line})`)}\n\`\`\`\n\nScreen after the last step:\n\`\`\`\n${v.screen}\n\`\`\``;
        res.attempts.push({ stage: "always", detail: `line ${v.line}: ${v.message}` });
        log(`attempt ${attempt}: ${v.ambiguous ? "always is read two ways" : "breaks always"} (line ${v.line})`);
        continue;
      }
    }
    if (!failed.length) {
      res.ok = true;
      res.attempts.push({ stage: "ok", detail: `${exs.length}/${exs.length} examples pass` });
      log(`attempt ${attempt}: ok`);
      break;
    }
    problems =
      `It compiles, but ${failed.length} of ${exs.length} examples fail:\n\n` +
      failed
        .map((f) => `## example "${f.name}"\nfails at ${where(app, f.failure!.line).file}:${where(app, f.failure!.line).line}: \`${where(app, f.failure!.line).text}\`\n${f.failure!.message}\n\nScreen at that moment:\n\`\`\`\n${f.failure!.screen}\n\`\`\``)
        .join("\n\n");
    res.attempts.push({ stage: "examples", detail: failed.map((f) => `${f.name}: ${f.failure!.message}`).join("; ") });
    log(`attempt ${attempt}: ${failed.length} example(s) fail`);
  }
  if (res.ok && opts.styled) {
    // Stage 2: the presentation, checked in a real browser.
    const specModule = readFileSync(join(dir, target === "elm" ? "src/Spec.elm" : "spec.ts"), "utf8");
    const look = await buildLook(app, specFile, specText, target, dir, specModule, log, !!opts.kit);
    res.costUsd += look.costUsd;
    res.ok = look.ok;
    res.attempts.push(...look.attempts.map((a) => ({ stage: `look-${a.stage}` as any, detail: a.detail })));
  }
  // Remember this build so the next one can reuse the units the spec did not change, but only when
  // its marks are valid (a build without marks is still shipped, just not reusable).
  if (res.ok && regions.length && !opts.probe && checkRegions(readFileSync(appFile, "utf8"), target, regions).length === 0)
    saveIncremental(app, target, which, tm.appFile, readFileSync(appFile, "utf8"));
  if (usedIncremental) res.incremental = true;
  res.ms = Date.now() - t0;
  writeFileSync(join(dir, "build.json"), JSON.stringify(res, null, 2));
  return res;
}

/**
 * The random sessions that hunt for a broken rule: when the batch could not run, or a session crashed
 * and none broke a rule, what to tell the compiler (a crashed session is never a clean one).
 */
export function sessionsBroke(ex: unknown): { problem: string; detail: string } | undefined {
  if (ex && typeof ex === "object" && "error" in ex) return { problem: `the random sessions that check the rules could not run: ${(ex as { error: string }).error}`, detail: `sessions failed: ${(ex as { error: string }).error}` };
  const all = ex as { violation?: unknown; error?: string; actions?: unknown[] }[];
  if (all.some((e) => e.violation)) return undefined;
  const crashed = all.filter((e) => e.error);
  if (!crashed.length) return undefined;
  const steps = (crashed[0].actions ?? []).map((a) => (a && typeof a === "object" && "endpoint" in a ? callText(a as unknown as Call) : actionText(a as Action)));
  return {
    problem: `${crashed.length} of ${all.length} random sessions crashed: ${crashed[0].error}${steps.length ? `\n\nThe first of them, from the initial screen:\n\`\`\`\n${steps.join("\n")}\n\`\`\`` : ""}`,
    detail: `${crashed.length} session(s) crashed: ${crashed[0].error}`,
  };
}

/**
 * A session that breaks an \`always\` rule, shrunk to the fewest steps that still break it (the same
 * rule), so the example it becomes is short. Best-effort: the original session when shrinking fails.
 */
export async function shortest<V extends { line: number; actions: unknown[] }>(dir: string, target: Target, app: App, api: boolean, v: V): Promise<V> {
  let last: V | undefined;
  const stillFails = async (tries: unknown[][]) => {
    const r = api
      ? await runJobsIsolated(dir, target, tries.map((calls) => ({ kind: "api-trace" as const, calls: calls as Call[], always: app.always })), 300_000)
      : await runJobsIsolated(dir, target, tries.map((actions) => ({ kind: "trace" as const, actions: actions as Action[], always: app.always })), 300_000);
    if ("error" in r) return -1;
    const at = (r as TraceResult[]).findIndex((t) => t.violation?.line === v.line && !t.violation.ambiguous);
    if (at >= 0) last = (r as TraceResult[])[at].violation as unknown as V;
    return at;
  };
  await shrink(v.actions, stillFails);
  // Then the draws: every steered value at its simplest, kept when the session still fails the same way.
  const simpler = simplerDraws((last ?? v).actions, loadDrawTable(dir));
  if (simpler) await stillFails([simpler]);
  return last ? { ...v, ...last } : v;
}
