// One build: spec → scaffold → LLM → compile → examples, with a bounded repair loop.
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { App } from "./ast.ts";
import { runJobsIsolated, type ExampleResult, type ExploreResult } from "./exec.ts";
import { actionText, exploreJobs } from "./fuzz.ts";
import { scaffold, type Target } from "./gen.ts";
import { complete, extractCode } from "./llm.ts";
import { buildPrompt, repairPrompt, SYSTEM } from "./prompt.ts";
import { compile } from "./toolchain.ts";
import { readFileSync } from "node:fs";
import { buildLook } from "./look.ts";

export interface BuildResult {
  target: Target;
  dir: string;
  ok: boolean;
  attempts: { stage: "llm" | "compile" | "examples" | "always" | "spec" | "ok"; detail: string }[];
  examples: { passed: number; total: number };
  costUsd: number;
  ms: number;
}

export interface BuildOptions {
  maxAttempts?: number;
  log?: (msg: string) => void;
  styled?: boolean; // also let the LLM write the presentation (Look) with Tailwind
  kit?: boolean; // give the Look stage the generated design-system Kit
}

export async function buildOnce(app: App, specFile: string, specText: string, target: Target, dir: string, opts: BuildOptions = {}): Promise<BuildResult> {
  const maxAttempts = opts.maxAttempts ?? 4;
  const log = opts.log ?? (() => {});
  const t0 = Date.now();
  const { appFile, specSource } = scaffold(app, target, dir);
  mkdirSync(join(dir, "log"), { recursive: true });
  const base = buildPrompt(target, specFile, specText, specSource);
  const res: BuildResult = { target, dir, ok: false, attempts: [], examples: { passed: 0, total: app.examples.length }, costUsd: 0, ms: 0 };

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

    const errors = await compile(target, dir);
    if (errors) {
      problems = `The module does not compile:\n\n\`\`\`\n${errors}\n\`\`\``;
      res.attempts.push({ stage: "compile", detail: errors.slice(0, 1500) });
      log(`attempt ${attempt}: compile errors`);
      continue;
    }

    const results = await runJobsIsolated(dir, target, app.examples.map((example) => ({ kind: "example" as const, example, always: app.always })));
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
      const ex = await runJobsIsolated(dir, target, exploreJobs(app, 40, 25, 11), 300_000);
      const v = "error" in ex ? undefined : (ex as ExploreResult[]).find((e) => e.violation)?.violation;
      if (v) {
        const lines = specText.split("\n");
        problems = `All examples pass, but this session breaks the rule on line ${v.line} (\`${lines[v.line - 1]?.trim()}\`): ${v.message}\n\nThe session, from the initial screen:\n\`\`\`\n${v.actions.map(actionText).join("\n")}\n\`\`\`\n\nScreen after the last step:\n\`\`\`\n${v.screen}\n\`\`\``;
        res.attempts.push({ stage: "always", detail: `line ${v.line}: ${v.message}` });
        log(`attempt ${attempt}: breaks always (line ${v.line})`);
        continue;
      }
    }
    if (!failed.length) {
      res.ok = true;
      res.attempts.push({ stage: "ok", detail: `${exs.length}/${exs.length} examples pass` });
      log(`attempt ${attempt}: ok`);
      break;
    }
    const lines = specText.split("\n");
    problems =
      `It compiles, but ${failed.length} of ${exs.length} examples fail:\n\n` +
      failed
        .map((f) => `## example "${f.name}"\nfails at line ${f.failure!.line}: \`${lines[f.failure!.line - 1]?.trim()}\`\n${f.failure!.message}\n\nScreen at that moment:\n\`\`\`\n${f.failure!.screen}\n\`\`\``)
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
