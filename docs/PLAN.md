# Working plan

Where the work stands (2026-09-25, language v38) and what comes next, in order. Each step: build,
verify (examples, twin build, harness snapshot, `npm test`, a planted bug where it applies), update
`docs/LANGUAGE.md` + changelog, `skills/intent-spec/SKILL.md`, README, then commit and push.

## State

- Language v38; last converge: v35, 12 apps, 72/72 first try (`runs/r35-converge/`), calculator
  ambiguity fixed. Independent score at v36: 78.4 (`docs/reviews/scores/v36.md`). Undo proven
  (below) but not yet in `converge` (it does not build providers for screens-with-calls).
- `npm test` includes the harness snapshot (`tests/harness/`): refactors must leave it unchanged;
  deliberate changes `--update` and review the diff.
- Targets and providers are modules (`compiler/targets/`, `compiler/providers/`); options in
  `intent.project` `compiler { … }` (`intent config`).

## Done: undo (effects phase 3, `docs/design/effects.md`)

v38: `undo @pay.charge` in a handler calls the `undone by` endpoint with its arguments from the
original call's answer, through the effectively-once path with its own key. Elm and TypeScript both
generate the call (`PayChargeUndo { answer }` / `{ undo: "pay.charge", answer }`). Proven by
`apps/18-checkout.intent`'s Refund button: 6/6 examples on both targets, twin-verified; a lost
answer refunds once (the retry replays; with replay off the example fails 409 "Already refunded");
a planted wrong refund id fails "No such charge"; Elm≡TS on every screen in 25 sessions. The
Elm error message for an undeclared status now matches TypeScript's.

## Then, in order

1. **Agreement** (`std.actions`, effects design): external calls wait for approve / edit / reject;
   standing permissions (count, period, amount); emergency stop; pending calls in stored state.
2. **Durable outbox**: a pending call and its key survive a restart of the screen; faults `slow`,
   `restart after effect`, `expire keys`.
3. **From the v36 score** (`docs/reviews/scores/v36.md`):
   - ~~stored-data migration~~ done (`migrate` in `runtime/ts/api.ts`: a removed field is dropped,
     a new `T or nothing` or list field is filled, an unmigratable stored field keeps only its
     default; both browsers and the api server use it, tested in `tests/migrate.test.ts`);
     identity/references between records (replacing `the ticket whose @id is @id`) still open;
   - ~~loops as a parser form~~ done (v39: `for each @x in @xs where … { … }`; the notices API
     uses it); lookups ("the @xs where …, ordered by …", with a checked none case) still open;
   - ~~twin-compile the `always` checks~~ done (`invariants-probe.mjs`: a second, independent
     reading, compared on the app's data; a disagreement stops the build and names the sentence);
   - ~~put APIs and screens-with-calls in `converge`~~ done (v38: `buildDeps` resolves providers
     and layers for `converge` too; checkout 4/4, 100%);
   - ~~run doc snippets through `check` in `npm test`, and fix the stale doc lines~~ done
     (`tests/docs/snippets.ts`, ```` ```intent ```` blocks; durations, names, events, publish,
     randomness, `T or nothing`, README counts).
   - ~~`intent fix`~~ done (criterion 11): applies `Maybe T` → `T or nothing`, an unmarked name
     (`@name`), a missing `import`, and the `language vN` line, only when it adds no error
     (`compiler/fix.ts`, `tests/fix.test.ts`).
4. **Incremental builds** (`docs/design/incremental.md`): units, dependencies, `@spec` regions,
   resume a stopped twin build; measure on recorded edits before making it the default.
5. **Distribution**: an `intent` bin and npm package; `intent doctor`; a second provider
   (Anthropic API, OpenAI-compatible) measured with converge; a probe from another vendor.
6. **Smaller**: platforms for screens and Elm (with a parity test); `list x of Text`; plain-text
   answers; per-screen element names; `budget` option; Spectavity adopting v35–v38 features.
