# Convergence report — r1-deepseek

2 builds per target (elm, ts), 12 random sessions × 12 actions per app.

| App | Builds OK | First-try OK | `always` held | Same app: all | Elm | TS | Elm≡TS | Code sim. Elm / TS | Cost |
|---|---|---|---|---|---|---|---|---|---|
| Counter | 4/4 | 4/4 | 4/4 | 100% | 100% | 100% | 100% | 100% / 62% | $0.03 |
| FrozenApprovals | 4/4 | 3/4 | 4/4 | 100% | 100% | 100% | 100% | 53% / 44% | $0.06 |
| Checklists | 4/4 | 4/4 | 4/4 | 100% | 100% | 100% | 100% | 39% / 25% | $0.05 |
| RefNavigation | 4/4 | 3/4 | 4/4 | 100% | 100% | 100% | 100% | 55% / 40% | $0.06 |
| Table | 4/4 | 4/4 | 4/4 | 100% | 100% | 100% | 100% | 68% / 60% | $0.05 |
| ExpensesApi | 2/2 | 2/2 | 2/2 | 100% | – | 100% | – | – / 33% | $0.03 |

*Same app* = share of random sessions in which every build showed identical screens after every action.

## Counter

Builds: elm-1 ✓, elm-2 ✓, ts-1 ✓, ts-2 ✓


Agreement with the majority: elm-1 100%, elm-2 100%, ts-1 100%, ts-2 100%

## FrozenApprovals

Builds: elm-1 ✓, elm-2 ✓, ts-1 ✓, ts-2 ✓ (2 attempts)

- ts-2 first problem: app.ts(1,28): error TS2305: Module '"./spec.ts"' has no exported member 'Model'.

Agreement with the majority: elm-1 100%, elm-2 100%, ts-1 100%, ts-2 100%

## Checklists

Builds: elm-1 ✓, elm-2 ✓, ts-1 ✓, ts-2 ✓


Agreement with the majority: elm-1 100%, elm-2 100%, ts-1 100%, ts-2 100%

## RefNavigation

Builds: elm-1 ✓, elm-2 ✓, ts-1 ✓ (3 attempts), ts-2 ✓

- ts-1 first problem: app.ts(1,21): error TS2305: Module '"./spec.ts"' has no exported member 'Model'. app.ts(23,40): error TS7006: Parameter 't' implicitly has an 'any' type. app.ts(28,44): error TS7006: Parameter 'c' implicitly has an 'any' type. app.ts(36,44): error TS7006: Parameter 'c' implicitly has an 'any' type. 

Agreement with the majority: elm-1 100%, elm-2 100%, ts-1 100%, ts-2 100%

## Table

Builds: elm-1 ✓, elm-2 ✓, ts-1 ✓, ts-2 ✓


Agreement with the majority: elm-1 100%, elm-2 100%, ts-1 100%, ts-2 100%

## ExpensesApi

Builds: ts-1 ✓, ts-2 ✓

- transitions at line 99 (`an @Expense's @status only changes from @Pending to @Approved or @Rejected`) no session made: Pending → Rejected

Agreement with the majority: ts-1 100%, ts-2 100%

## Notes (final v1 measurement, round D: a second provider)

DeepSeek (`deepseek-chat`) through `llm openai` (`OPENAI_BASE_URL=https://api.deepseek.com/v1`, the key
read from the gitignored `.deepseek-token` into `OPENAI_API_KEY` for the process only), as in the
2026-09-26 runs; 2 builds per target, 12 sessions × 12 actions, on six apps that cover the new
language-1 features: `31-frozen-approvals` (change rules), `32-checklists` (lists inside rows, stored
state), `34-ref-navigation` (references), `36-table` (random draws), `api/expenses-api` (`access`, a
service) and `01-counter`.

- **22/22 builds OK, 20/22 first try, `always` held in all, 100% the same app, Elm≡TS 100%. Cost $0.28.**
- Repairs: FrozenApprovals ts-2 (a TypeScript compile error, fixed on attempt 2), RefNavigation ts-1
  (a compile error, then one failing example, fixed on attempt 3). Class 1, repaired; no failure remains.
- How it was run: `intent converge` refuses a model other than the one `intent.lock` pins (by
  design: builds never pick up a new model silently). The shared lock pins `claude-opus-5-5` and other
  builds were running, so the round ran from a scratch project (a copy of `intent.lock` with
  `@model deepseek-chat`, and `apps/` and `lib/` linked in); the language pin and the bundle hashes
  are the same files. Nothing in the repository's lock changed. A second provider needs its own lock
  to be measured; this is a note for the docs, not a bug.
