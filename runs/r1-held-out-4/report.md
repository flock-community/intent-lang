# Held-out round 4 — `language 1`

Three fresh authors wrote specs from `docs/LANGUAGE.md`, `docs/TOOLS.md` and `skills/intent-spec/SKILL.md`
only (they could run `check`, `fix`, `expand`; C also `build`). Files in `apps/held-out-4/`:
A (from a description): chores contract, api (with `access`) and screen. B (a simulated interview):
clinic booking contract, api and screen. C (incremental refinement): `todo` plus `todo-api` (from step 5).

A's and B's contracts only resolve from `lib/<a>/<b>.intent`, which the authors could not write, so
their files were checked and built in scratch projects with the contract copied into `lib/` and locked.

## Results

First try = the twin build's first attempt; builds OK = converge (2 builds per target, 40 sessions × 25 actions).

| Spec | First try | Builds OK | Same app | Elm≡TS | `always` held | Cost |
|---|---|---|---|---|---|---|
| chores-api (A) | ts 1/1, 22/22 examples | 2/2 (ts) | 100% | – | 2/2 | $1.43 + $1.07 |
| chores screen (A) | not buildable: harness bug H1 (confirmed without an LLM call) | – | – | – | – | $0 |
| clinic-api (B) | ts 1/1, 32/32 examples | 2/2 (ts) | 100% | – | 2/2 | $1.54 + $1.14 (+ $2.06 stopped run) |
| clinic screen (B) | 0/4: 6 of 8 examples crash in every attempt (H1) | – | – | – | – | $6.25 |
| todo steps 0–6 (C) | 7/7 steps on both targets, twin-verified, 1 attempt each | – | – | – | – | $12.92 (incl. a failed $3.15 attempt at step 2) |
| todo-api (C, step 5) | ts 1/1, 11/11 examples | 2/2 | 100% | – | 2/2 | $0.91 + $0.90 |
| todo final, step 8 (C) | – | 4/4, first try 4/4 | 100% | 100% | 4/4 | $1.98 |

Code similarity: Todo 63% (Elm) / 54% (TS), TodoApi 75%, ChoresApi 66%, ClinicApi 89%. Spend ≈ $32.

## C: the refinement steps

| Step | Request | Lines changed | Local? | Build |
|---|---|---|---|---|
| 0 | minimal todo | 80 new | – | OK |
| 1 | add a due date | +28 −4 | local; a picker, as there is no date input | OK |
| 2 | never let a done item change | +27 −3 | local, guards in 3 places | SPEC CONFLICT (R1/K2), then OK |
| 3 | filter overdue | +23 −1 | local | OK |
| 4 | add subtasks | +72 −3 | local but large: step 2's rule reaches every inner element | OK |
| 5 | only the owner may delete | +28 −5, plus a new 254-line api | not local; the screen could not be connected to the api (G1) | OK / OK |
| 6 | random quote | +30 | local; needs a button (a draw `on start` is refused) | OK |
| 7 | compact on phones | +1 | a prose `look` sentence nothing checks | in step 8 |
| 8 | undo last delete | +52 | local; 3 handlers, 1 untyped sentence | converge 4/4 |

Seven of eight requests were small local changes; "only the owner may delete" needed a service, a
contract in `lib/` and every handler rewritten as a call.

## Difficulties, classified

Harness bugs:
- **H1** A screen cannot be tested against a provider that draws: the providers loop in `compiler/exec.ts`
  calls `client.send(…)` without draws or clock, and the service throws "draws need a 32-byte seed".
  Repairs cannot fix it. (Also G5: a screen example cannot steer or read its provider's draws.)
- **H2** `INTENT_INCREMENTAL=auto` reused nothing across C's steps; the store is keyed by app name
  (`apps/02-todo.intent` is also `app Todo`).

Checker bugs:
- **K1** `its @due exists` hints "write `there is a its @due`", which then fails; `there is a @due` works but is undocumented for row fields.
- **K2** Clicking a disabled button passes the check but stops every build with SPEC CONFLICT.
- **K3** A misleading `ACCESS … has no key layer` cascades from PROVIDER/LOCK errors.
- **K4** `implements "./x.intent"` / `uses "apps/…"` report an unknown block instead of the bad argument.
- **K5** `GUESSABLE` never fires for endpoints declared in a contract; the TOOLS row states the condition backwards.
- **K6** `UNSTEERED` fires on a seeded, never-drawn value (matches by field name).
- **K7** `UNENFORCED` misses `rules { - only the @owner of an item may delete it }`.
- **K8** `the minutes between @now and that booking's @start is below 1440` is split as `@start is below 1440`.
- **K9** `was` outside `always` gives no CHANGE; ordering a `Date or nothing` gives no NOTHING.

Reference error:
- **R1** §4 says a disabled button cannot be clicked, §9.6 says clicking it does nothing; the harness refuses the click.

Reference gaps:
- **G1** Where a contract lives and that it must be locked (all three authors).
- **G2** The skill says to import a contract's domain; importing a contract fails.
- **G3** No typed sort (order plus tie-breaker).
- **G4** `for each` is a SYNTAX error inside an endpoint.
- **G6** `N hours after @now` works but is undocumented.
- **G7** The key layer's 401 message is undocumented.
- **G8** No rule for one role only (a deadline for patients, not the desk); filtering to the caller's own rows is a step, not access.
- **G9** No viewport breakpoint for `sizes`.
- **G10** Missing forms: next in turn (wrapping), put a row back at its place, a date input, `enabled when` on a checkbox, frozen but deletable, `ref X or nothing` and comparing a ref with the caller, an alphabet without 0/O/1/I/L.
- **G11** The grants list shape is narrow; no "any caller with a role" permit.
- **G12** Choice values share a namespace with type names (undocumented).
- **G13** Accepted but undocumented forms (`body x: ref T` then `that x`, refined Text path params, `there is a booking in @xs whose …`, `that item's @x` in inner rows, completeness of `A when C; B when D`, plain-text lists in table cells, `answers 200 List T`, `every endpoint answers 401 Problem` without a contract, where `language 1` goes after a multi-line header).
- **G14** §5's `highest @id + 1` reuses a deleted row's id, which breaks undo.
- **G15** The skill's interview is screen-only; roles, deadlines and codes are only in later sections.
- **G16** The skill points to `lib/` and `apps/` files; std bundles' params are not in the reference.

## B's interview (summary)

13 turns: data, seed data, layout, rules, the 24-hour cancellation deadline, roles, the exact-24-hours
boundary, a cancelled slot frees up, the desk may always cancel (raised only when asked), past or
booked slots, ordering and ties, message texts, and a scenario (Bob books and gets code M8TX3Q).

## After fixes

The fixes of this round (docs/CHANGELOG.md, "1", *From held-out round 4*) were checked without an LLM
by `npm test` (new: tests/provider-draws.test.ts, tests/heldout4.test.ts; extended: tests/units.test.ts,
tests/answers-parity.test.ts, tests/fmt-parity), `npx tsc --noEmit -p .`, and `intent check` on every
spec in apps/ and lib/ (0 FAIL, no LANGUAGE, SPELLING or LOCK warning). The chores and clinic
contracts now live in lib/home/choresApi.intent and lib/clinic/bookingsApi.intent, so every file in
apps/held-out-4 checks and builds in this repository as the authors wrote it (only names and paths
changed; `intent fix` rewrote clinic-api's four orders to `sorted by`, and todo.intent got a
`nextId` counter and `there is a @due and …` in its overdue filter).

**Builds** (`intent build`, twin-verified, both targets for screens; costs include the provider and
layer builds made for them):

| Spec | Result | First try | Cost |
|---|---|---|---|
| chores screen + chores-api | OK, twin-verified (elm, ts) | api 1/1; screen: every compiler failed one example on attempt 1, then passed (below) | $7.68 |
| clinic screen + clinic-api | OK, twin-verified (elm, ts) | all first attempts ok; the 6 examples that crashed with H1 pass | $5.83 |
| 38-raffle + raffle-api (the regression pair for H1/G5) | OK, twin-verified | all first attempts ok | $2.60 |
| 15-tickets-ui | OK, twin-verified | ok | $2.72 |
| 18-checkout | OK, twin-verified | ok | $2.61 |

**Converge** (2 builds per target, 40 sessions × 25 actions; after-fixes/report.md):

| App | Builds OK | First try | `always` held | Same app | Elm≡TS | Code sim. Elm / TS | Cost |
|---|---|---|---|---|---|---|---|
| Chores | 4/4 | 0/4 | 4/4 | 100% | 100% | 60% / 46% | $8.45 |
| ClinicBooking | 4/4 | 4/4 | 4/4 | 100% | 100% | 92% / 77% | $4.03 |

The cost column now includes the twin builds of each app's provider and layers made for the run
(the chores run rebuilt std.http.sendKey and the chores api). Spend for this round: ≈ $34, over the
≈ $25 planned.

**Still open (found by these builds):** every compiler's first attempt at the chores screen fails
"still signed in after a restart": the harness calls `init` (the spec's `on start`) before it
restores the stored fields, on both targets and in the browser, so `on start`'s `if @apiKey is
blank { stop }` sees the default and loads nothing. Repairs work around it. The fix belongs in the
harness (restore stored state before `on start` runs), not in the spec.

## After the start fix

The harness now restores stored fields before `on start` runs (docs/CHANGELOG.md, "1", held-out
round 4, *Found by the builds after these fixes*; §9.20): in an app with stored fields and
`on start`, `init` is the app from its defaults and `on start` is the message `Started`, which every
entry sends after putting the stored fields back. Checked without an LLM by tests/start.test.ts
(stand-ins on both targets: test worker, test entry, a real browser reload, styled entries), and
`npm test`, `npx tsc --noEmit -p .`, `intent check` on every spec in apps/ and lib/ (0 FAIL, no
LANGUAGE, SPELLING or LOCK).

**Builds** (`intent build --twin always`): chores + chores-api twin-verified on Elm and TypeScript,
first attempt ok on both (the first Elm build hit a harness bug in the new entry, two arguments of
`started` in the wrong order, fixed and rebuilt: $9.11 of the spend below); 17-habits (stored, no
`on start`, unchanged harness) twin-verified on both, first attempt ok.

**Converge** (2 builds per target, 40 sessions × 25 actions; after-start-fix/report.md):

| App | Builds OK | First try | `always` held | Same app | Elm≡TS | Code sim. Elm / TS | Cost |
|---|---|---|---|---|---|---|---|
| Chores | 4/4 | 4/4 (was 0/4) | 4/4 | 100% | 100% | 75% / 49% | $5.98 |

Spend: ≈ $23 (chores first build $10.58 incl. the failed Elm, Elm rebuild $4.49, habits $1.85,
converge $5.98), over the ≈ $15 planned because of the harness bug.
