// A team's own quality rules, next to std.quality. Use it from intent.project:
//
//   quality {
//     use std.quality
//     use examples/quality/team.ts
//     MONEY_IN_CENTS error
//   }
//
// A rule set is a module whose default export is { name, rules }; each rule has an id, a level, what
// it asks for, and a check that returns findings (a line and a message, optionally a fix).
import type { QualityContext, RuleSet } from "../../compiler/quality.ts";

const team: RuleSet = {
  name: "team",
  rules: [
    {
      id: "MONEY_IN_CENTS",
      level: "warning",
      about: "money is counted in whole cents (an Int), never a Decimal",
      check: (ctx: QualityContext) =>
        ctx.app.records.flatMap((r) =>
          r.fields
            .filter((f) => /^(price|amount|total|cost|fee)$/i.test(f.name) && f.type.k === "Decimal")
            .map((f) => ({ line: f.line, message: `${r.name}.${f.name} is money as a Decimal`, fix: "make it an Int of cents" })),
        ),
    },
  ],
};
export default team;
