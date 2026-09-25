// One build: spec → scaffold → LLM → compile → examples, with a bounded repair loop.
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { App } from "./ast.ts";
import { runJobsIsolated, type ExampleResult, type ExploreResult } from "./exec.ts";
import { actionText, exploreJobs } from "./fuzz.ts";
import { scaffold, type Target } from "./gen.ts";
import { complete, extractCode } from "./llm.ts";
import { buildPrompt, layerPrompt, repairPrompt, SYSTEM } from "./prompt.ts";
import { targetModule } from "./targets/index.ts";
import { apiTraces, callText, type Call } from "./api.ts";
import { readFileSync } from "node:fs";
import { buildLook } from "./look.ts";
import { compilerPins, sourceMap, where } from "./load.ts";
import { callDescs, hasClients, hasThrough } from "./calls.ts";
import { usesClock } from "./refs.ts";
import { prepareInvariants } from "./invariants.ts";
import { dataField, hasData, hasInvariants, hasStored } from "./gen.ts";
import { readLayerConfig } from "./layer.ts";

export interface BuildResult {
  target: Target;
  dir: string;
  ok: boolean;
  attempts: { stage: "llm" | "compile" | "examples" | "always" | "spec" | "ok"; detail: string }[];
  examples: { passed: number; total: number };
  compiler?: { language: string; languageVersion: string; model: string }; // what this build was compiled with
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
}

/** Apps that make calls: which provider build answers which alias, for the test driver. */
export function writeProviders(app: App, dir: string, providers: Record<string, string>) {
  writeFileSync(join(dir, "providers.json"), JSON.stringify({ endpoints: callDescs(app), providers }, null, 2));
}

export async function buildOnce(app: App, specFile: string, specText: string, target: Target, dir: string, opts: BuildOptions = {}): Promise<BuildResult> {
  const maxAttempts = opts.maxAttempts ?? 4;
  const log = opts.log ?? (() => {});
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
    res.attempts.push({ stage: "compile", detail: "platform functions are for services (the api profile) so far: a screen cannot use them yet (docs/design/platform.md)" });
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
  if (api) writeFileSync(join(dir, "endpoints.json"), JSON.stringify((app.endpoints ?? []).map((e) => ({ name: e.name, method: e.method, path: e.path, params: e.params.map((p) => ({ in: p.in, name: p.name })), ...(e.effect ? { external: true } : {}) }))));
  writeFileSync(join(dir, "sourcemap.json"), JSON.stringify(sourceMap(app), null, 2));
  // Apps that read the clock: where it starts in tests, and how far one clock tick moves it.
  if (usesClock(app)) writeFileSync(join(dir, "clock.json"), JSON.stringify({ start: app.startsAt ?? "2026-01-05T09:00", tickMs: app.clockMs ?? 0, jobs: (app.jobs ?? []).map((j) => ({ name: j.name, every: j.every })) }));
  // Several screens: their addresses, for the test driver (which keeps the history).
  if (app.screens?.length) writeFileSync(join(dir, "screens.json"), JSON.stringify(app.screens.map((s) => ({ name: s.name, path: s.path }))));
  // Stored state: which fields of the data a restart keeps (the driver saves them, restarts, and checks they came back).
  if (hasStored(app) && !layer) writeFileSync(join(dir, "stored.json"), JSON.stringify(app.state.filter((f) => f.stored).map((f) => ({ field: dataField(f.name), line: f.line }))));
  mkdirSync(join(dir, "log"), { recursive: true });
  // Sentences in `always` over the data: their checks are compiled once per spec, apart from the app.
  if (hasInvariants(app) && !layer) {
    const inv = await prepareInvariants(app, specText, dir, log);
    res.costUsd += inv.costUsd;
    if (inv.error) {
      res.attempts.push({ stage: "compile", detail: inv.error });
      res.ms = Date.now() - t0;
      return res;
    }
  }
  const base = layer ? layerPrompt(specFile, specText, specSource, !!opts.probe, !!app.beforeCall) : buildPrompt(target, specFile, specText, specSource, !!opts.probe, api, hasClients(app), hasThrough(app), usesClock(app), hasData(app), hasStored(app), !!app.screens?.length, !!app.platforms?.length);

  let code = "";
  let problems = "";
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    const prompt = problems ? repairPrompt(base, target, code, problems) : base;
    writeFileSync(join(dir, `log/prompt-${attempt}.md`), prompt);
    const r = await complete(SYSTEM, prompt);
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
    if (!failed.length && app.always.length) {
      // Examples pass; now hunt for a session that breaks an `always` rule.
      const ex = api
        ? await runJobsIsolated(dir, target, apiTraces(app, 40, 25, 11).map((calls) => ({ kind: "api-trace" as const, calls, always: app.always })), 300_000)
        : await runJobsIsolated(dir, target, exploreJobs(app, 40, 25, 11), 300_000);
      const v = "error" in ex ? undefined : (ex as ExploreResult[]).find((e) => e.violation)?.violation;
      if (v) {
        const w = where(app, v.line);
        const head = v.ambiguous
          ? `The sentence in \`always\` at ${w.file}:${w.line} (\`${w.text}\`) is read two ways`
          : `All examples pass, but this session breaks the rule at ${w.file}:${w.line} (\`${w.text}\`)`;
        problems = `${head}: ${v.message}\n\nThe session, from the initial screen:\n\`\`\`\n${v.actions.map((a) => ("endpoint" in a ? callText(a as unknown as Call) : actionText(a))).join("\n")}\n\`\`\`\n\nScreen after the last step:\n\`\`\`\n${v.screen}\n\`\`\``;
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
  res.ms = Date.now() - t0;
  writeFileSync(join(dir, "build.json"), JSON.stringify(res, null, 2));
  return res;
}
