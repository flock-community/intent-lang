// Deterministic code generation: everything except the app logic. Each target (a language) is a
// module in targets/; this is the door the rest of the compiler uses.
import type { App } from "./ast.ts";
import { targetModule } from "./targets/index.ts";
import type { Target } from "./targets/shared.ts";

export * from "./targets/shared.ts";
export * from "./targets/elm.ts";
export * from "./targets/ts.ts";

export function scaffold(app: App, target: Target, dir: string, layerDirs: Record<string, string> = {}): { appFile: string; specSource: string } {
  return targetModule(target).scaffold(app, dir, layerDirs);
}
