// std.quality: the default rule set. Its hints (hints.ts) judge the spec as the compiler resolved it,
// from its model and the facts the compiler recorded; a project sets each rule's level, and a few
// rules look at the spec as a whole.
import type { QualityContext, Rule, RuleSet } from "../quality.ts";
import { LINE_BASE } from "../ast.ts";
import * as h from "./hints.ts";
import type { Warn } from "./hints.ts";
import { accessUnproven } from "../access.ts";

// A hint from hints.ts as a rule: its warnings are the rule's findings.
const hint = (id: string, about: string, run: (app: QualityContext["app"], warn: Warn) => void): Rule => ({
  id,
  level: "warning",
  about,
  check: (ctx) => {
    const found: { line: number; message: string }[] = [];
    run(ctx.app, (line, code, message) => code === id && found.push({ line, message }));
    return found;
  },
});

const rules: Rule[] = [
  hint("UNPROVEN", "every dynamic element is checked by some example, and every endpoint is called in one", h.unproven),
  hint("UNMARKED", "a declared name in a sentence is written with @", h.unmarked),
  hint("UNCHECKED", "a rule that reads like an invariant is in `always`, where it is checked", h.unchecked),
  hint("UNTYPED", "a derived value that matters has a known or declared type", h.untyped),
  hint("UNANCHORED", "a sentence mentions a declared name", h.unanchored),
  hint("UNSTRUCTURED", "control words are structure (`if`, `stop`, `answer`), not prose", h.unstructured),
  hint("SPELLING", "a form is written the language's way (`whose`, not `where`; a reference is followed, not looked up; `never goes down`, not `only goes up`; `a random @Token`, not `@newToken`)", (app, warn) => (h.spelling(app, warn), h.changeSpelling(app, warn))),
  hint("PIVOT", "a call that cannot be undone comes after the calls that can", h.pivot),
  hint("NO_EXAMPLES", "the spec has examples", h.noExamples),
  hint("NO_HANDLER", "a button, a call's answer, an undo and a clock are handled", h.noHandler),
  hint("SHADOWED", "a row's field does not share its name with an app-level name", h.shadowed),
  hint("UNUSED", "declared components and `only` entries are used", h.unused),
  hint("OVERRIDES_PROOF", "a refinement does not override what its base proves", h.overridesProof),
  hint("BREAKS_RULE", "a handler step does not write what a change rule freezes, unless a condition before it can exclude the frozen rows", h.breaksRule),
  hint("REDRAW", "an endpoint that stores a drawn value answers with that value, not a new draw", h.redraw),
  hint("UNSTEERED", "an example that compares a drawn value with a literal steers it first (`steer random T = …`)", h.unsteered),
  hint("GUESSABLE", "a random type accepted as input has 128 bits or more, or an attempt limit", h.guessable),
  hint("NO_ACCESS", "an api that says who is calling also says what they may do (an `access` block)", h.noAccess),
  hint("HAND_ACCESS", "with an `access` block, no endpoint refuses by hand on a condition about the caller", h.handAccess),
  hint("ACCESS_UNPROVEN", "every access rule is proven both ways by the examples: a call it permits and one it refuses", accessUnproven),
  hint("UNENFORCED", "a screen-only app does not promise who may do what (only a service can keep that promise)", h.unenforced),
  hint("TRANSITION_UNPROVEN", "every change a transition table allows (`only changes from @A to @B`) is made by some example", h.transitionUnproven),
  {
    id: "NEVER_UNCHECKED",
    level: "warning",
    about: "a promise in the app's purpose (never, always, at most, no two) is an `always` rule",
    // An app's promise is kept by an `always` rule, or proven by an example that says so in its name
    // ("never below zero", "a slow answer charges once"). Libraries, contracts and layers describe, they do not promise.
    check: (ctx: QualityContext) => {
      const a = ctx.app;
      if (a.kind === "bundle" || a.kind === "platform" || a.kind === "contract" || a.kind === "layer") return [];
      if (!a.purpose.some((p) => /\b(never|always|at most|at least|no two)\b/i.test(p)) || a.invariants?.length || a.always.length) return [];
      if (a.examples.some((ex) => /\b(never|once|twice|at most|at least|no two|not twice)\b/i.test(ex.name))) return [];
      return [{ line: 1, message: `the purpose promises something (never / always / at most / no two), but no \`always\` rule checks it and no example says it proves it${a.purpose.some((p) => h.CHANGE_CLAIM.test(p)) ? h.CHANGE_FORMS : ""}`, fix: "say it in `always { - … }`, or prove it with an example named after the promise" }];
    },
  },
  {
    id: "STATUS_UNPROVEN",
    level: "warning",
    about: "every status an endpoint answers is seen in some example",
    check: (ctx: QualityContext) => {
      // A contract is proven by its implementation's examples; a status every endpoint answers
      // (`every endpoint answers 401`, one line for all) is proven once, on any endpoint.
      if (ctx.app.kind === "contract") return [];
      const seen = new Set<string>();
      for (const ex of ctx.app.examples)
        for (const s of ex.steps) if (s.do === "see" && /^[a-z]\w*\.status$/.test(s.target) && s.check.is === "eq") seen.add(`${s.target.split(".")[0]} ${s.check.value}`);
      // A check on an answer's body (`see listAlerts.body has 2 rows`) sees its one success status too.
      for (const ex of ctx.app.examples)
        for (const s of ex.steps)
          if (s.do === "see" && /^[a-z]\w*\.body\b/.test(s.target)) {
            const ep = (ctx.app.endpoints ?? []).find((e) => e.name === s.target.split(".")[0]);
            const ok = (ep?.answers ?? []).filter((a) => a.status < 300);
            if (ep && ok.length === 1) seen.add(`${ep.name} ${ok[0].status}`);
          }
      const shared = new Map<number, number>(); // answer line → how many endpoints share it
      for (const ep of ctx.app.endpoints ?? []) for (const a of ep.answers ?? []) shared.set(a.line, (shared.get(a.line) ?? 0) + 1);
      const seenAnywhere = (status: number) => [...seen].some((k) => k.endsWith(` ${status}`));
      return (ctx.app.endpoints ?? []).flatMap((ep) =>
        ep.line >= LINE_BASE ? [] : (ep.answers ?? []).filter((a) => a.status !== 500 && !seen.has(`${ep.name} ${a.status}`) && !((shared.get(a.line) ?? 0) > 1 && seenAnywhere(a.status))).map((a) => ({ line: ep.line, message: `no example sees \`${ep.name}\` answer ${a.status}`, fix: `add an example that ends in \`see ${ep.name}.status = ${a.status}\`` })),
      );
    },
  },
  {
    id: "LONG_SENTENCE",
    level: "warning",
    about: "a sentence stays short enough to read (40 words); name its parts in `derive`",
    check: (ctx: QualityContext) =>
      ctx.sentences.filter((s) => s.line < LINE_BASE && s.where !== "rules" && s.text.split(/\s+/).length > 40).map((s) => ({ line: s.line, message: `this sentence has ${s.text.split(/\s+/).length} words (${s.where})`, fix: "name its parts in `derive`" })),
  },
  {
    id: "JUDGEMENT",
    level: "off",
    about: "each sentence left untyped (to judgement) is listed, so it is judgement on purpose",
    check: (ctx: QualityContext) => ctx.coverage.filter((c) => !c.typed).map((c) => ({ line: c.line, message: `left to judgement (${c.where}): prove it with an example, or write it with the typed forms` })),
  },
];

const std: RuleSet = { name: "std.quality", rules };
export default std;
