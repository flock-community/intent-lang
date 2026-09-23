# Intent: vision and working agreements

## The goal

Move application creation from writing code to stating intent, and to reusing refined
specs. The spec is the source of truth; code is a disposable, reproducible derivative. Same
spec in, same app out.

## How the language will be used

People rarely write specs from scratch. Mostly:

- **An LLM interviews the user.** It asks for the details a good spec needs (examples,
  rules, edge cases) and writes the spec. `intent review` is an early form of this.
- **Users refine incrementally:** "add a filter here", "this should never go below zero", "also email
  the customer". Each request becomes a small spec change: a sentence, an `always` rule, an
  example, a new element. Then the compiler runs again.
- **Specs reuse specs.** Quality comes from well-written, well-proven specs that others
  import instead of rewriting.

So the language must stay readable for people and precise for machines. Every change
should be small and local in the spec.

## App ↔ code ↔ spec traceability (a core requirement)

Anything a user sees or hits must lead back to the spec line that caused it:

- **UI:** the user points at a place in the running app; we know the element (its `data-el`
  is its spec name), so we know the spec lines. We change the spec there and recompile.
- **API:** when a request fails or misbehaves, the error leads to the endpoint, rule or
  example in the spec. The fix is a spec change (often a new example that reproduces the
  bug), never a hand-patch of generated code.

Already in place: `data-el` = spec element names (qualified for component instances, e.g.
`pager.next`), `sourcemap.json` per build (element/handler/state/derive → spec file:line,
component, bundle), checker and `SPEC CONFLICT` messages with file:line, `always` violations
and divergence reports as ready-to-paste example steps. Still missing: the UI to point at an
element, and bug reports that turn into failing examples automatically.

## Reuse: spec bundles

The goal is a standard library (`std.*`) plus community libraries of spec bundles: a
domain (tickets, people, invoices), a behaviour component (paged search list, comment
thread, toast), a design system, an API resource.

- A bundle carries its own examples and `always` rules. They are its conformance tests,
  and every app that uses it must pass them too.
- Bundles are versioned and pinned in a lockfile (`language.md` v0.1 designed
  `package`/`import`/`ouros.lock`). A verified bundle's generated code can be pinned and
  reused: reuse is a cache hit, and code that is not regenerated cannot diverge.
- Things that are now hard-coded in the harness belong in bundles: the Kit becomes
  `std.design.web`, `Fmt` becomes `std.fmt`, and the presentations become `std.ui`.

## Direction

Done: modules and bundles (v10), held-out testing (four independent authors), the
language review (`docs/reviews/language-review.md`). Next, in this order:

1. **Refinement: `extends` + explicit `override` / `add` / `drop`.** Reuse someone's whole spec
   and improve it. Overrides are named units (elements, derived values, handlers, texts,
   design, seed data), never line ranges. The base's examples and `always` rules must still
   pass unless explicitly dropped (Liskov for specs). The base is pinned, and upgrading it
   re-applies the overrides with conflict detection. One level deep; compose beyond that.
   Overrides that many apps share flow upstream into the base as params.
2. **A small structured grammar for behaviour** (review #1): early exits, branches,
   "A when C, otherwise B", list operations and templates as forms the parser knows, with
   English only in the leaves.
3. **Identity and references** (review #2): relations as declared references instead of text
   columns with a comment, and defined behaviour when a selection points at nothing.
4. **Real invariants** (review #3): a small closed expression form for `always` over state
   and per row, plus a warning for `rules` sentences that no check covers.
5. **Bundles as versioned behavioural contracts** (review #4): a demo for every bundle, a
   semantic version computed from names *and* examples, namespaced imports, immutable
   versions.
6. An API profile (generic core + UI profile + API profile), then Kotlin as its second backend.

## Lessons from the experiments (keep applying them)

- **The harness owns everything that needs no judgement:** typed interfaces, rendering
  glue, formatting, rounding, design tokens and recipes. The LLM writes only what needs
  judgement.
- **Silence has a default.** Every gap the pipeline finds becomes a documented default in
  `docs/LANGUAGE.md` §9, or a spec change. It is never left to the model.
- **Stable is not correct.** A literal compiler turns a vague spec into consistent,
  unintended behaviour. Correctness comes from examples and `always` rules.
- **Measure before and after every change** with `intent converge`, and check that the
  measurement itself is sound (fuzzer depth, planted bugs, `data-el` placement).
- **The language is a work in progress.** A missing construct is `NOT_YET`, a candidate for
  the next version, not a prohibition. Every addition goes in the changelog in
  `docs/LANGUAGE.md`.

## The spec-writing skill

`skills/intent-spec/SKILL.md` (linked from `.claude/skills/` so Claude Code finds it) teaches LLMs to use the language well: interviewing,
reuse first, writing, checking, building, changing an app, tracing from the UI to the spec,
and writing bundles. **Every language change updates it too:** its version line, the
affected section, and lessons from authors who struggled. Feedback from held-out authors
goes there first.

## Where things are

`README.md` covers usage, architecture and results. `docs/LANGUAGE.md` is the reference;
it is also the compiler's prompt, so keep it accurate. `apps/` holds the example specs.
`compiler/` holds the parser/checker, code generation, the LLM stages, the drivers and the
pipeline. `runs/history.jsonl` holds every measured round.
Checks: `npm test`, `npx tsc --noEmit -p .`, `node compiler/cli.ts check apps/*.intent`.
