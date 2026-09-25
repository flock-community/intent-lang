// The targets there are. A new language is a module in targets/ (implementing TargetModule) and a
// line here; nothing else in the compiler changes.
import { elmTarget } from "./elm.ts";
import { tsTarget } from "./ts.ts";
import type { TargetModule } from "./target.ts";
import type { Target } from "./shared.ts";

export const TARGETS: Record<Target, TargetModule> = { elm: elmTarget, ts: tsTarget };

export const targetModule = (t: Target): TargetModule => TARGETS[t];
