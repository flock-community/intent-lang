// Code regions: the compiler marks the code each unit produced (`// @spec on click send` … `// @end`
// in TypeScript, `-- @spec …` … `-- @end` in Elm), and the harness checks the marks like it checks
// examples. For an incremental build it also checks that the code outside the regions and every
// clean region are byte-identical to the previous build, so nothing changes silently
// (docs/design/incremental.md).
import type { App } from "./ast.ts";
import { units } from "./units.ts";

export interface Region {
  key: string;
  body: string; // the lines between the markers, without the markers
  start: number; // the line of the `@spec` marker (0-based)
  end: number; // the line of the `@end` marker
}

const markers = (target: "ts" | "elm") =>
  target === "elm"
    ? { start: /^\s*--\s*@spec\s+(.+?)\s*$/, end: /^\s*--\s*@end\s*$/, spec: (k: string) => `-- @spec ${k}`, close: "-- @end" }
    : { start: /^\s*\/\/\s*@spec\s+(.+?)\s*$/, end: /^\s*\/\/\s*@end\s*$/, spec: (k: string) => `// @spec ${k}`, close: "// @end" };

/** The units the compiler must mark in the app module: the derived values and the handlers (a screen's
 * elements are composed into one `view`, so they have no region of their own). */
export function regionUnits(app: App): string[] {
  const kinds = app.profile === "api" || app.kind === "layer" ? new Set(["endpoint", "every", "on"]) : new Set(["derive", "on"]);
  return units(app).filter((u) => kinds.has(u.kind)).map((u) => u.key);
}

/** The regions in a generated module, or the first structural problem with the marks. */
export function extractRegions(code: string, target: "ts" | "elm"): { regions: Region[]; problem?: string } {
  const m = markers(target);
  const regions: Region[] = [];
  let open: { key: string; start: number; body: string[] } | undefined;
  let problem: string | undefined;
  code.split("\n").forEach((line, i) => {
    if (problem) return;
    const s = line.match(m.start);
    if (s) {
      if (open) return void (problem = "a `@spec` marker inside a region");
      open = { key: s[1], start: i, body: [] };
      return;
    }
    if (m.end.test(line)) {
      if (!open) return void (problem = "an `@end` without a `@spec`");
      regions.push({ key: open.key, body: open.body.join("\n"), start: open.start, end: i });
      open = undefined;
      return;
    }
    if (open) open.body.push(line);
  });
  if (!problem && open) problem = "a region is never closed";
  return { regions, problem };
}

/** The problems with a module's marks, given the units that must each have exactly one region. */
export function checkRegions(code: string, target: "ts" | "elm", expected: string[]): string[] {
  const { regions, problem } = extractRegions(code, target);
  if (problem) return [problem];
  const problems: string[] = [];
  const seen = new Map<string, number>();
  for (const r of regions) seen.set(r.key, (seen.get(r.key) ?? 0) + 1);
  for (const k of expected) if (!seen.has(k)) problems.push(`no region marked \`${k}\``);
  for (const [k, n] of seen) {
    if (!expected.includes(k)) problems.push(`a region marked \`${k}\`, which is not a unit to mark`);
    if (n > 1) problems.push(`\`${k}\` is marked in ${n} places`);
  }
  return problems;
}

/** The code with every region (markers and body) removed: the interface and scaffolding around them. */
export function outsideRegions(code: string, target: "ts" | "elm"): string {
  const m = markers(target);
  const out: string[] = [];
  let inRegion = false;
  for (const line of code.split("\n")) {
    if (m.start.test(line)) { inRegion = true; continue; }
    if (m.end.test(line)) { inRegion = false; continue; }
    if (!inRegion) out.push(line);
  }
  return out.join("\n");
}

/** Whether `next` may replace `prev` incrementally: the same code outside the regions, and every
 * clean region byte-identical. Returns the problems (empty: accept `next`). */
export function checkIncremental(prev: string, next: string, target: "ts" | "elm", dirty: string[], expected: string[]): string[] {
  const problems = checkRegions(next, target, expected);
  if (problems.length) return problems;
  if (outsideRegions(prev, target) !== outsideRegions(next, target)) problems.push("the code outside the regions changed");
  const before = new Map(extractRegions(prev, target).regions.map((r) => [r.key, r.body]));
  for (const r of extractRegions(next, target).regions)
    if (!dirty.includes(r.key) && before.has(r.key) && before.get(r.key) !== r.body) problems.push(`\`${r.key}\` is not dirty, but its region changed`);
  return problems;
}
