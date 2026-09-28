// Quality checks: pluggable rule sets on top of the compiler's own checks (docs/LANGUAGE.md §7).
// The compiler's checks decide whether a spec means one thing: they are built in and cannot be
// switched off. Quality rules are about completeness, style and a team's policy: a project picks
// rule sets (`quality { use std.quality  use ./quality/team.ts }` in intent.project) and sets each
// rule's level (`UNMARKED off`, `UNPROVEN error`). `std.quality` is the default set.
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import type { App, Diagnostic } from "./ast.ts";
import { sourceMap, type SourceEntry } from "./load.ts";
import { units, type Unit } from "./units.ts";
import { typedCoverage, type Coverage } from "./fit.ts";
import { sentences } from "./refs.ts";
import stdQuality from "./quality/std.ts";

export type Level = "off" | "warning" | "error";

/** What a rule found: the line (in the spec, as the checker counts lines), what is wrong, and optionally how to fix it. */
export interface Finding {
  line: number;
  message: string;
  fix?: string;
}

/**
 * What a rule sees: the loaded spec and what the compiler knows of it. The spec (`app`) is the
 * compiler's model (compiler/ast.ts); `units`, `sourceMap`, `coverage` and `sentences` are the
 * stable views, the same as in a build's units.json and sourcemap.json.
 */
export interface QualityContext {
  file: string;
  app: App;
  units: Unit[];
  sourceMap: Record<string, SourceEntry>;
  coverage: Coverage[];
  sentences: { text: string; line: number; where: string }[];
}

/** A rule: its id (the code in reports), its default level, what it asks for, and its check. A rule
 *  without `check` is one the checker emits under that code: the rule set gives it a level. */
export interface Rule {
  id: string;
  level: Level;
  about: string;
  check?: (ctx: QualityContext) => Finding[];
}

export interface RuleSet {
  name: string;
  rules: Rule[];
}

export interface QualityConfig {
  use: string[]; // rule sets: `std.quality`, or a path to a module whose default export is a RuleSet
  levels: Record<string, Level>; // rule id → level
}

export const DEFAULT_QUALITY: QualityConfig = { use: ["std.quality"], levels: {} };

/** What a rule sees, built only as far as the rules ask for it (a rule that reads only `app` costs nothing more). */
function context(file: string, app: App): QualityContext {
  let u: Unit[] | undefined, map: Record<string, SourceEntry> | undefined, cov: Coverage[] | undefined, sen: QualityContext["sentences"] | undefined;
  return {
    file,
    app,
    get units() {
      return (u ??= units(app));
    },
    get sourceMap() {
      return (map ??= sourceMap(app));
    },
    get coverage() {
      return (cov ??= typedCoverage(app));
    },
    get sentences() {
      return (sen ??= sentences(app));
    },
  };
}

/**
 * std.quality at the project's levels, as every load applies it (a project's own rule sets need
 * `intent check`, which loads them). Levels for rules std.quality does not have are the check's.
 */
export function withStdQuality(file: string, app: App, diagnostics: Diagnostic[], levels: Record<string, Level> = {}): Diagnostic[] {
  const own = new Set(stdQuality.rules.map((r) => r.id));
  const mine = Object.fromEntries(Object.entries(levels).filter(([id]) => own.has(id)));
  return applyQuality(file, app, diagnostics, [stdQuality], { use: ["std.quality"], levels: mine });
}

/** Load the rule sets a project uses. */
export async function loadRuleSets(config: QualityConfig, root = process.cwd()): Promise<RuleSet[]> {
  const sets: RuleSet[] = [];
  for (const u of config.use) {
    const mod = u === "std.quality" ? { default: stdQuality } : await import(pathToFileURL(resolve(root, u)).href);
    const set = (mod.default ?? mod) as RuleSet;
    if (!set?.name || !Array.isArray(set.rules)) throw new Error(`quality: \`${u}\` does not export a rule set ({ name, rules })`);
    sets.push(set);
  }
  return sets;
}

/**
 * The compiler's diagnostics with quality applied: the codes a rule set owns get the project's
 * level (off removes them), and the rules with a check add their findings. Every other diagnostic
 * (the compiler's own) stays as it is.
 */
export function applyQuality(file: string, app: App | undefined, diagnostics: Diagnostic[], sets: RuleSet[], config: QualityConfig): Diagnostic[] {
  const rules = new Map<string, Rule>();
  for (const set of sets) for (const r of set.rules) rules.set(r.id, r);
  for (const id of Object.keys(config.levels)) if (!rules.has(id)) throw new Error(`quality: no rule \`${id}\` in ${sets.map((s) => s.name).join(", ") || "the rule sets used"}`);
  const levelOf = (id: string) => config.levels[id] ?? rules.get(id)!.level;
  const out: Diagnostic[] = [];
  for (const d of diagnostics) {
    const rule = rules.get(d.code);
    // A rule set owns only the checker's warnings; the compiler's errors cannot be lowered.
    if (!rule || d.level === "error") {
      out.push(d);
      continue;
    }
    const level = levelOf(d.code);
    if (level !== "off") out.push({ ...d, level });
  }
  if (!app) return out;
  const ctx = context(file, app);
  for (const rule of rules.values()) {
    if (!rule.check) continue;
    const level = levelOf(rule.id);
    if (level === "off") continue;
    for (const f of rule.check(ctx)) out.push({ level, code: rule.id, line: f.line, col: 1, message: f.fix ? `${f.message} (${f.fix})` : f.message });
  }
  return out.sort((a, b) => a.line - b.line);
}
