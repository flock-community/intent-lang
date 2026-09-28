// Rule mutation (v70): do the examples prove the access rules? For each mutant of an api's access
// plan (a rule dropped, a condition dropped: compiler/access.ts `mutants`), run the api's examples,
// and the examples of the screens tested with it, on existing verified builds with that plan. A
// mutant no example catches is a rule nothing proves: add an example that permits or refuses a call
// (or lets a screen hear an event) that the mutant would decide the other way. No LLM calls: access
// is harness code, so a mutant is the same build with another plan.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { App } from "./ast.ts";
import { mutants } from "./access.ts";
import { runApiJobs } from "./api.ts";
import { runJobs, useProviderPlans, type ExampleResult } from "./exec.ts";
import type { Plan } from "../runtime/ts/access.ts";

export interface MutantResult {
  what: string;
  source: string; // file:line of the rule mutated
  caughtBy: string[]; // the examples that fail with it ("api: <name>", "<screen>: <name>")
}

/** A screen tested with the api: its spec, its build, its target, and the alias it calls the api by. */
export interface ScreenBuild {
  name: string;
  app: App;
  dir: string;
  target: string;
  alias: string;
}

/** The examples that pass (a batch that did not run passes none). */
export const greenOf = (results: unknown): Set<string> => new Set((Array.isArray(results) ? (results as ExampleResult[]) : []).filter((r) => r.pass).map((r) => r.name));
/** The examples that passed at the baseline and fail now: what catches a mutant. */
export const newlyRed = (green: Set<string>, results: unknown): string[] => (Array.isArray(results) ? (results as ExampleResult[]) : []).filter((r) => !r.pass && green.has(r.name)).map((r) => r.name);

export async function mutateAccess(api: App, apiDir: string, screens: ScreenBuild[] = [], log: (m: string) => void = () => {}): Promise<MutantResult[]> {
  const plan: Plan = JSON.parse(readFileSync(join(apiDir, "access.json"), "utf8"));
  const out: MutantResult[] = [];
  // The builds must pass as they are: a mutant is only measured against a green baseline.
  const baseline = (await runApiJobs(apiDir, api.examples.map((example) => ({ kind: "api-example" as const, example })))) as ExampleResult[];
  const red = baseline.filter((r) => !r.pass);
  if (red.length) throw new Error(`the api build does not pass its own examples (${red.map((r) => r.name).join(", ")}): mutation needs a verified build`);
  // The screens' examples too: only an example that passes with the real plan can catch a mutant
  // (one that is red already, or does not run, says nothing about the rule).
  const green = new Map<string, Set<string>>();
  for (const s of screens) {
    useProviderPlans(undefined);
    const sr = await runJobs(s.dir, s.target, s.app.examples.map((example) => ({ kind: "example" as const, example })));
    green.set(s.name, greenOf(sr));
    const notGreen = s.app.examples.filter((e) => !green.get(s.name)!.has(e.name));
    if (notGreen.length) log(`${s.name}: ${notGreen.length} example(s) do not pass with the real plan (${notGreen.map((e) => e.name).join(", ")}); they are not counted`);
  }
  for (const m of mutants(plan)) {
    const caughtBy: string[] = [];
    const res = (await runApiJobs(apiDir, api.examples.map((example) => ({ kind: "api-example" as const, example })), { plan: m.plan })) as ExampleResult[];
    caughtBy.push(...(Array.isArray(res) ? res : []).filter((r) => !r.pass).map((r) => `api: ${r.name}`));
    for (const s of screens) {
      useProviderPlans({ [s.alias]: m.plan });
      try {
        const sr = await runJobs(s.dir, s.target, s.app.examples.map((example) => ({ kind: "example" as const, example })));
        // Caught: an example that passed with the real plan and fails with the mutant.
        caughtBy.push(...newlyRed(green.get(s.name)!, sr).map((n) => `${s.name}: ${n}`));
      } finally {
        useProviderPlans(undefined);
      }
    }
    log(`${caughtBy.length ? "caught " : "SURVIVES"} ${m.what}${caughtBy.length ? ` (by ${caughtBy[0]}${caughtBy.length > 1 ? ` and ${caughtBy.length - 1} more` : ""})` : ""}`);
    out.push({ what: m.what, source: m.source, caughtBy });
  }
  return out;
}
