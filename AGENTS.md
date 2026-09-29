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

**Intent 1 is stamped:** `language 1`, the first stable version (the language of v73). It covers
screens (several, with lists inside rows, typed references, `T or nothing`, time, stored state,
random values), rules (examples, `always`, rules over the data and over changes), reuse (bundles,
components, refinement, a registry with computed versions), APIs (contracts, events, layers,
effects that happen once, `access`), screens that call them, and jobs. The promise is
`docs/STABILITY.md`; the history (v1–v73, reviews, converge rounds) is `docs/CHANGELOG.md`,
`docs/reviews/` and `runs/history.jsonl`.

The final measurements on language 1 are done (README, "Phase 7"; `runs/r1-*`).

Next:

1. **The candidates in `docs/CHANGELOG.md`, "Next candidates"**, for `1.x` (additions) or
   `language 2` (an edition). The main ones: a terminal renderer of the same screens (explicit
   sizes first), trees and a third level of rows, access beyond v1 (field-level, tenants, bearer
   tokens), type parameters and slots for components, weighted draws, liveness over changes, and,
   from the earlier list, unions of records, several targets per app, styled builds of screens that
   make calls, refinement of bundles' components and Kotlin as a second API target.

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
  the next version, not a prohibition. Every addition goes in the changelog,
  `docs/CHANGELOG.md`; the reference (`docs/LANGUAGE.md`) is the compiler's prompt and says only
  what the language is — no history, no paths into this repository.

## The spec-writing skill

`skills/intent-spec/SKILL.md` (linked from `.claude/skills/` so Claude Code finds it) teaches LLMs to use the language well: interviewing,
reuse first, writing, checking, building, changing an app, tracing from the UI to the spec,
and writing bundles. **Every language change updates it too:** its version line, the
affected section, and lessons from authors who struggled. Feedback from held-out authors
goes there first.

## Where things are

`README.md` covers usage, architecture and results. `docs/LANGUAGE.md` is the reference;
it is also the compiler's prompt, so keep it accurate. `apps/` holds the example specs.
`compiler/` holds the parser/checker (references and types in `fit.ts`), code generation, the LLM
stages, the drivers and the pipeline; quality rule sets live apart from the compiler's checks
(`compiler/quality.ts`, `std.quality` in `compiler/quality/std.ts`). Target languages are modules in `compiler/targets/` (one interface, `target.ts`) and
LLM providers in `compiler/providers/` (`llm.ts`): a new language or provider is a module and a
line in a registry, and must pass the same examples, `always` rules and twin builds, with a
converge run recorded for it. `runs/history.jsonl` holds every measured round.
Checks: `npm test`, `npx tsc --noEmit -p .`, `node compiler/cli.ts check apps/*.intent`.
`npm test` includes the harness snapshot (`tests/harness/snapshot.ts`): every generated file and
prompt for every spec and target. A refactor must leave it unchanged; a deliberate change updates
it (`--update`) and the diff shows what builds will now get.
