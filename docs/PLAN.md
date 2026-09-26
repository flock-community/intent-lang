# Working plan

Where the work stands (2026-09-26, language v48) and what comes next, in order. Each step: build,
verify (examples, twin build, harness snapshot, `npm test`, a planted bug where it applies), update
`docs/LANGUAGE.md` + changelog, `skills/intent-spec/SKILL.md`, README, then commit and push.

## State

- Language v48. Last Claude converge: v35, 12 apps, 72/72 first try (`runs/r35-converge/`).
  Independent score at v36: 78.4 (`docs/reviews/scores/v36.md`). The language also converged under
  DeepSeek through the OpenAI-compatible provider (v45): every build that succeeded was 100% the
  same app and Elm≡TS 100% (`runs/2026-09-26-11-0*-deepseek*/`).
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

1. **Agreement** (`std.actions`, effects design): ~~the gate, pending / approve / reject, permissions
   with count / period / amount, a durable held box, and four eyes~~ done (v40–v45; unit-tested in
   `tests/gate.test.ts`; `apps/20-approval.intent`, both targets, 6/6 examples, 25/25 identical).
2. **Durable outbox**: ~~a pending call and its key survive a restart~~ done (`runtime/ts/outbox.ts`:
   a call is written with its key before it goes out, cleared on the answer, and re-sent after a
   reload with the same key; wired into both targets' browser entries, tested in
   `tests/outbox.test.ts`); the faults `slow`, `restart after effect`, `expire keys` still open.
3. **From the v36 score** (`docs/reviews/scores/v36.md`):
   - ~~stored-data migration~~ done (`migrate` in `runtime/ts/api.ts`: a removed field is dropped,
     a new `T or nothing` or list field is filled, an unmigratable stored field keeps only its
     default; both browsers and the api server use it, tested in `tests/migrate.test.ts`);
     ~~relations between records are declared and checked~~ done (v47: a `relations` block names
     both sides and the checker requires both records, both fields and equal key types; a reference
     field whose own type is the record remains a `NOT_YET` candidate);
     ~~told a param from a field with the same name~~ done (v46: `@path.x` / `@query.x` /
     `@body.x`; `apps/api/payments-api.intent` uses it);
   - ~~loops as a parser form~~ done (v39: `for each @x in @xs where … { … }`; the notices API
     uses it); ~~a lookup that can find nothing is now guarded~~ (`UNGUARDED` covers
     `the ticket whose …` and optional record fields); a lookup *form* and declared references
     ("the @xs where …") still open;
   - ~~`see` on the wrong screen~~ done: the checker follows an example's `open`, `go back` and a
     clicked button's `go to`, so `see` of an element on another screen is an error
     (`tests/checker/screens.intent`);
   - ~~twin-compile the `always` checks~~ done (`invariants-probe.mjs`: a second, independent
     reading, compared on the app's data; a disagreement stops the build and names the sentence);
   - ~~put APIs, layers and screens-with-calls in `converge`~~ done (`buildDeps` resolves
     providers and layers; `analyse` uses `apiTraces`/`layerTraces` for those profiles.
     payments-api 2/2, std.actions 2/2, 20-approval 4/4 — all 100% same app, Elm≡TS 100%);
   - ~~run doc snippets through `check` in `npm test`, and fix the stale doc lines~~ done
     (`tests/docs/snippets.ts`, ```` ```intent ```` blocks; durations, names, events, publish,
     randomness, `T or nothing`, README counts).
   - ~~`intent fix`~~ done (criterion 11): applies `Maybe T` → `T or nothing`, an unmarked name
     (`@name`), a missing `import`, and the `language vN` line, only when it adds no error
     (`compiler/fix.ts`, `tests/fix.test.ts`).
   - ~~profiles as checked files~~ done (criterion 4, step 1): `intent check lib/profile/*.intent`
     now checks a profile with `checkProfile` (duplicate kinds/presentations, the name, bad lines);
     `tests/profile.test.ts`; the profile already drives the vocabulary. The rest of
     `docs/design/profiles.md` (generic element lines, a profile-driven harness) remains.
4. **Incremental builds** (`docs/design/incremental.md`): ~~the `always` checks are keyed by what
   they depend on~~ done (an example/screen/handler change reuses them; measured on the habits app);
   units, dependencies, `@spec` regions and resume a stopped twin build still open.
5. **Distribution**: ~~an `intent` bin~~ and ~~`intent doctor`~~ done; the **Anthropic API provider**
   and an **OpenAI-compatible provider** done, and ~~measured with converge~~ done
   (DeepSeek via `llm openai`: 20-approval, 21-tags, 22-hash 12/12; counter, board, helpdesk,
   ticket-pages, calculator 19/20 — every successful build 100% same app, Elm≡TS 100%; the one
   failure is DeepSeek not getting the calculator's second Elm build right, not a divergence;
   `runs/2026-09-26-11-0*-deepseek*/`); a probe from another vendor still open.
6. **Smaller**: ~~platforms for screens, both targets~~ done (v44: a screen re-exports a pure
   platform and calls it; `apps/22-hash.intent`; Elm has its own `Crypto.elm`, kept in step with
   TypeScript by the parity test in `tests/fmt-parity`); ~~`list x of Text`~~ done (v41);
   ~~plain-text answers~~ already work; ~~per-screen element names~~ done (v48: a name is unique
   within a screen, two screens may reuse one, and the one handler serves both;
   `apps/23-tabs.intent`); ~~`budget`~~ done; Spectavity adopting v35–v38 features.
