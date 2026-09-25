# Working plan

Where the work stands (2026-09-25, language v37) and what comes next, in order. Each step: build,
verify (examples, twin build, harness snapshot, `npm test`, a planted bug where it applies), update
`docs/LANGUAGE.md` + changelog, `skills/intent-spec/SKILL.md`, README, then commit and push.

## State

- Language v37; last converge: v35, 12 apps, 72/72 first try (`runs/r35-converge/`), calculator
  ambiguity fixed. Independent score at v36: 78.4 (`docs/reviews/scores/v36.md`).
- `npm test` includes the harness snapshot (`tests/harness/`): refactors must leave it unchanged;
  deliberate changes `--update` and review the diff.
- Targets and providers are modules (`compiler/targets/`, `compiler/providers/`); options in
  `intent.project` `compiler { … }` (`intent config`).

## In progress: undo (effects phase 3, `docs/design/effects.md`)

Done, not yet proven end to end:
- checker: `undo @alias.endpoint` must name an endpoint with `undone by` (EFFECT), and its undo
  endpoint's answer should be handled (NO_HANDLER) — `compiler/parse.ts`;
- `undoables(app)` in `compiler/calls.ts`; TypeScript Call variant `{ undo: "pay.charge"; answer;
  args? }` and `callToJson` computing the `undone by` args from the binding — `compiler/targets/ts.ts`;
- guard: a non-TS build of an app with `undo` stops with a message (`compiler/build.ts`).

Next:
1. Elm: `PayChargeUndo { answer : Charge }` in `genElmCalls` (`compiler/targets/elm.ts`, `type Call`
   and `callToJson`), then drop the guard.
2. Prompt: one line in each target's `calls` rule about `undo`.
3. Reference §4f/§4g: `undo @pay.charge` step; skill; changelog v38.
4. Prove it: add a Refund button to `apps/18-checkout.intent` (`undo @pay.charge` with the charge
   kept in state, `on answer pay.refund`), examples incl. `steer pay lose answer` on the refund (no
   double refund: keyed replay), twin-build both targets, a planted bug (refund args wrong).

## Then, in order

1. **Agreement** (`std.actions`, effects design): external calls wait for approve / edit / reject;
   standing permissions (count, period, amount); emergency stop; pending calls in stored state.
2. **Durable outbox**: a pending call and its key survive a restart of the screen; faults `slow`,
   `restart after effect`, `expire keys`.
3. **From the v36 score** (`docs/reviews/scores/v36.md`):
   - stored-data migration (a record change must not silently reset data) and identity/references
     between records (replacing `the ticket whose @id is @id`);
   - loops and lookups as parser forms with a checked "none" case;
   - twin-compile the `always` checks; put APIs and screens-with-calls in `converge`; run doc
     snippets through `check` in `npm test`; fix the stale doc lines it lists (LANGUAGE.md:62, :220,
     :652, :1101; README counts; `Maybe T` in a checker message).
4. **Incremental builds** (`docs/design/incremental.md`): units, dependencies, `@spec` regions,
   resume a stopped twin build; measure on recorded edits before making it the default.
5. **Distribution**: an `intent` bin and npm package; `intent doctor`; a second provider
   (Anthropic API, OpenAI-compatible) measured with converge; a probe from another vendor.
6. **Smaller**: platforms for screens and Elm (with a parity test); `list x of Text`; plain-text
   answers; per-screen element names; `budget` option; Spectavity adopting v35–v37 features.
