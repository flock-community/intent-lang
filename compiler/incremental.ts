// Keeps the last verified build of an app per target, so the next build can reuse the code of the
// units the spec did not change (`incremental auto`, docs/design/incremental.md). The code and the
// unit digests live in `.intent/incremental/<app>/<target>/`.
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import type { App } from "./ast.ts";
import { ROOT, type Target } from "./gen.ts";
import { regionUnits } from "./regions.ts";
import { diffUnits, units, type Diff, type Unit } from "./units.ts";

const STORE = join(ROOT, ".intent/incremental");
const dirFor = (app: App, target: Target) => join(STORE, app.name, target);

/** Remember a verified build's code and units, for the next incremental build. */
export function saveIncremental(app: App, target: Target, appFile: string, code: string) {
  const dir = dirFor(app, target);
  mkdirSync(join(dir, dirname(appFile)), { recursive: true });
  writeFileSync(join(dir, appFile), code);
  writeFileSync(join(dir, "units.json"), JSON.stringify(units(app), null, 2));
}

/** The last verified build's code and units, if there is one. */
export function loadIncremental(app: App, target: Target, appFile: string): { code: string; units: Unit[] } | undefined {
  const file = join(dirFor(app, target), appFile);
  const unitsFile = join(dirFor(app, target), "units.json");
  if (!existsSync(file) || !existsSync(unitsFile)) return undefined;
  try {
    return { code: readFileSync(file, "utf8"), units: JSON.parse(readFileSync(unitsFile, "utf8")) as Unit[] };
  } catch {
    return undefined;
  }
}

/** Forget the remembered build (its code no longer matches the spec). */
export function forgetIncremental(app: App, target: Target) {
  rmSync(dirFor(app, target), { recursive: true, force: true });
}

/** What an incremental build would rewrite, or undefined when there is nothing to reuse. */
export function planIncremental(app: App, prev: { code: string; units: Unit[] }): { diff: Diff; regions: string[] } | undefined {
  const regions = regionUnits(app);
  // Nothing is marked: the previous build cannot be reused region by region.
  if (!regions.length) return undefined;
  const diff = diffUnits(prev.units, units(app));
  // Only new units (or everything dirty): a full build is as cheap and simpler.
  if (!diff.clean.length) return undefined;
  return { diff, regions };
}
