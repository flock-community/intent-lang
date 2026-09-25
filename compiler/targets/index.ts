// The targets there are. A new language is a module in targets/ (implementing TargetModule) and a
// line here; nothing else in the compiler changes.
import { elmTarget } from "./elm.ts";
import { tsTarget } from "./ts.ts";
import { tsService } from "./ts-service.ts";
import type { TargetModule } from "./target.ts";
import type { Target } from "./shared.ts";

// TypeScript also builds services (the api profile and layers).
export const TARGETS: Record<Target, TargetModule> = { elm: elmTarget, ts: { ...tsTarget, service: tsService } };

export const targetModule = (t: Target): TargetModule => TARGETS[t];
