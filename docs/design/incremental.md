# Design: spec units, code regions, and incremental builds

Status: built. Today every change to a spec compiles
the app again from nothing, twice, and a twin build that stops on an ambiguity starts over after the
fix. That is safe but slow and costly. Building on the previous code is only safe when we know, for
every part of the spec, which part of the code it produced, and what else depends on it. Otherwise
an edit can leave stale code behind, and nobody notices.

Built: the **units and their dependencies** (`compiler/units.ts`, written to `units.json` beside
`sourcemap.json` on every build; `diffUnits` says which behaviour units an edit dirties, following
dependencies transitively; `tests/units.test.ts`). Built (small): the `always` checks are keyed by
what they depend on (the `- sentence` lines, the derived values, the data shape and the platforms)
rather than the whole spec, so changing an example, screen or handler reuses the checks and skips
their LLM calls (measured: a second build of the habits app with a new example logs no `checks for
always`). Built too: a second cache key, the spec **without its examples**, so a build whose only
change is an example copies the previous app code and just runs the new examples — no LLM calls at
all (measured: a second build of a small app with a new example logs `the app code is unchanged;
reused it` and costs $0.00). Built too (v49, `incremental auto`, off by default): **regions and an
incremental rewrite**. The compiler marks each derived value and handler (`// @spec on click up` …
`// @end`, `--` in Elm) and the harness checks the marks like it checks examples
(`compiler/regions.ts`, `tests/regions.test.ts`). On an edit the compiler gets the last verified
build and the dirty units, rewrites only their regions, and the harness refuses the answer unless
the code outside the regions and every clean region are byte-identical — otherwise it compiles from
scratch. Measured: a tiny app whose `on click up` handler changed rebuilt with `reusing the previous
build's clean regions (2 kept, 1 rewritten)` and passed its examples. Built too (`cleanCheck always`,
off by default): **the from-scratch clean check** (step 5) — after an incremental build the same spec
is also built from scratch and the two are compared on the twin's sessions, so a build the code's
history decided is caught; measured on the same app: A (incremental), B (probe) and A′ (from scratch)
agreed over 24 sessions. Built too (`incremental auto`): **resuming a stopped twin build** — A and B
each keep their own previous code (`.intent/incremental/<app>/<target>/main` and `/probe`), so after
a spec fix both resume from their own clean regions and only the dirty ones are rewritten; measured
on the same app: changing one handler, both A and B logged `reusing the previous build's clean
regions (2 kept, 1 rewritten)` and the twin still verified. Built too: the twin's sessions are
ordered so the ones touching a dirty unit run first (`orderByDirty`), so a remaining ambiguity is
found quickly. What is left is the measurement suite (recorded edits per app, and the planted bad
edits of "How it is measured") before `incremental` can default to `auto`.

## Units

A spec is already a set of named units, and the source map knows each one's line:
records, choices, refined types, state fields, derived values, elements, handlers
(`on click add`), endpoints, jobs, layers bound, clients (`uses`), rules, `always` checks and
examples. Each unit gets a digest of its canonical text (`intent expand`), so reformatting or
moving a unit is no change.

## Dependencies

A unit depends on the units it names: `@` references in its sentences (`refsIn`), the
element or field it binds (`text total` reads `total`), the types it uses, the endpoint it calls.
The checker already resolves all of these. The dependency graph is part of every build
(`units.json`, beside `sourcemap.json`).

A changed unit is **dirty**, and so is every unit that depends on it, transitively: change the
type of `@tickets`, and every handler, derived value and element that reads `@tickets` is dirty.
Examples and `always` checks are never skipped: all of them run on every build.

## Regions

The compiler marks the code each unit produced:

```ts
// @spec on click add
case "AddClicked": { … }
// @end
```

```elm
-- @spec derive total
total : Model -> Int
…
-- @end
```

The harness checks the marks like it checks examples: every behaviour unit has exactly one
region, regions do not overlap, and there is no logic outside a region beyond what the
generated interface requires (imports, the Model type, the dispatch). A missing, doubled or
unknown mark is a compile problem that goes back to the compiler with the unit's name. So the
map from spec to code is checked, not trusted.

## An incremental build

1. Compare the new spec's units with the last verified build's `units.json`: clean, dirty, new,
   removed.
2. The compiler gets the previous code and the dirty, new and removed units, and rewrites only
   their regions (and the Model, when a state field changed).
3. The harness checks that every clean region is byte-identical to the previous code. Anything
   else changed is refused: nothing changes silently.
4. Everything runs as always: every example, every `always` check, and the twin comparison. The
   twin's sessions are ordered so that those touching dirty units (by their elements, handlers and
   endpoints in the source map) run first, so a remaining ambiguity is found quickly; then the
   full set runs.
5. **History must not leak in.** An incrementally built app must behave exactly like one built
   from scratch from the same spec. A clean build runs in the background after an incremental one
   (and always before `publish` and in `converge`); if the two differ in any session, the
   incremental result is discarded and the difference is reported as a spec ambiguity, because the
   spec did not decide what the code's history decided.

## A twin build that stopped

When A and B build different apps, the harness keeps both builds, the differing sessions and the
units they touch (from the source map), and reports the ambiguity per unit ("`on click add`: A
trims the draft, B does not"). After the spec is fixed, only the units the fix touches are dirty:
both compilers resume from their own previous code with steps 2–5, and the sessions that differed
run first.

## Options

`incremental auto | off` in the `compiler` block (default `auto` once measured), and
`clean-check always | background | publish` for step 5.

## How it is measured before it becomes the default

- `converge` on all apps, from scratch, as the baseline (first-try rate, same-app rate, cost).
- ~~A set of recorded edits per app (a new rule, a renamed element, a changed type, a new example)
  applied incrementally: cost and time per edit, and the share of incremental builds that the
  clean check confirms. Target: all of them; any that are not is a finding about the spec.~~ Built
  (`tests/incremental/edits.ts`, run with an LLM; it clears the build cache, seeds the app, applies
  the edits one after another and reports cost, what was reused and the twin+clean verdict). Run on
  the counter (`runs/incremental-edits.md`): a new example reused the app code ($0.00), a changed
  handler rewrote one region (2 kept, 1 rewritten, confirmed), and a changed element label correctly
  fell back to a full build. It found a flaw on the way — an element change was once accepted without
  being applied — now refused (`planIncremental` requires every dirty unit to have a region). Run it
  across more apps before `incremental` defaults to `auto`.
- ~~Planted problems: a compiler that edits a clean region, and one that leaves a removed unit's
  code behind. Both must be refused.~~ Done (`tests/regions.test.ts`).
