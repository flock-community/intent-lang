# Design: spec units, code regions, and incremental builds

Status: design, with one safe increment built. Today every change to a spec compiles the app again
from nothing, twice, and a twin build that stops on an ambiguity starts over after the fix. That is
safe but slow and costly. Building on the previous code is only safe when we know, for every part of
the spec, which part of the code it produced, and what else depends on it. Otherwise an edit can
leave stale code behind, and nobody notices.

Built (small): the `always` checks are keyed by what they depend on (the `- sentence` lines, the
derived values, the data shape and the platforms) rather than the whole spec, so changing an
example, screen or handler reuses the checks and skips their LLM calls (measured: a second build of
the habits app with a new example logs no `checks for always`). The regions and the resumable build
below are the rest.

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
- A set of recorded edits per app (a new rule, a renamed element, a changed type, a new example)
  applied incrementally: cost and time per edit, and the share of incremental builds that the
  clean check confirms. Target: all of them; any that are not is a finding about the spec.
- Planted problems: a compiler that edits a clean region, and one that leaves a removed unit's
  code behind. Both must be refused.
