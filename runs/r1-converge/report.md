# Convergence report — r1-converge

3 builds per target (elm, ts), 40 random sessions × 25 actions per app.

| App | Builds OK | First-try OK | `always` held | Same app: all | Elm | TS | Elm≡TS | Code sim. Elm / TS | Cost |
|---|---|---|---|---|---|---|---|---|---|
| Counter | 6/6 | 6/6 | 6/6 | 100% | 100% | 100% | 100% | 100% / 100% | $2.03 |
| Todo | 6/6 | 6/6 | 6/6 | 100% | 100% | 100% | 100% | 65% / 55% | $2.19 |
| Pomodoro | 6/6 | 6/6 | 6/6 | 100% | 100% | 100% | 100% | 90% / 81% | $2.14 |
| Wordle | 6/6 | 6/6 | 6/6 | 100% | 100% | 100% | 100% | 61% / 66% | $2.31 |
| Expenses | 6/6 | 6/6 | 6/6 | 100% | 100% | 100% | 100% | 42% / 36% | $2.69 |
| Shop | 6/6 | 6/6 | 6/6 | 100% | 100% | 100% | 100% | 69% / 48% | $2.48 |
| Calculator | 6/6 | 6/6 | 6/6 | 100% | 100% | 100% | 100% | 58% / 63% | $2.41 |
| Board | 6/6 | 6/6 | 6/6 | 100% | 100% | 100% | 100% | 40% / 44% | $2.25 |
| Crm | 6/6 | 6/6 | 6/6 | 100% | 100% | 100% | 100% | 64% / 66% | $3.16 |
| Habits | 6/6 | 6/6 | 6/6 | 100% | 100% | 100% | 100% | 69% / 66% | $2.62 |
| Library | 6/6 | 4/6 | 6/6 | 100% | 100% | 100% | 100% | 52% / 49% | $4.21 |
| Reservations | 6/6 | 6/6 | 6/6 | 100% | 100% | 100% | 100% | 54% / 52% | $3.19 |

*Same app* = share of random sessions in which every build showed identical screens after every action.

## Counter

Builds: elm-1 ✓, elm-2 ✓, elm-3 ✓, ts-1 ✓, ts-2 ✓, ts-3 ✓


Agreement with the majority: elm-1 100%, elm-2 100%, elm-3 100%, ts-1 100%, ts-2 100%, ts-3 100%

## Todo

Builds: elm-1 ✓, elm-2 ✓, elm-3 ✓, ts-1 ✓, ts-2 ✓, ts-3 ✓


Agreement with the majority: elm-1 100%, elm-2 100%, elm-3 100%, ts-1 100%, ts-2 100%, ts-3 100%

## Pomodoro

Builds: elm-1 ✓, elm-2 ✓, elm-3 ✓, ts-1 ✓, ts-2 ✓, ts-3 ✓


Agreement with the majority: elm-1 100%, elm-2 100%, elm-3 100%, ts-1 100%, ts-2 100%, ts-3 100%

## Wordle

Builds: elm-1 ✓, elm-2 ✓, elm-3 ✓, ts-1 ✓, ts-2 ✓, ts-3 ✓


Agreement with the majority: elm-1 100%, elm-2 100%, elm-3 100%, ts-1 100%, ts-2 100%, ts-3 100%

## Expenses

Builds: elm-1 ✓, elm-2 ✓, elm-3 ✓, ts-1 ✓, ts-2 ✓, ts-3 ✓


Agreement with the majority: elm-1 100%, elm-2 100%, elm-3 100%, ts-1 100%, ts-2 100%, ts-3 100%

## Shop

Builds: elm-1 ✓, elm-2 ✓, elm-3 ✓, ts-1 ✓, ts-2 ✓, ts-3 ✓


Agreement with the majority: elm-1 100%, elm-2 100%, elm-3 100%, ts-1 100%, ts-2 100%, ts-3 100%

## Calculator

Builds: elm-1 ✓, elm-2 ✓, elm-3 ✓, ts-1 ✓, ts-2 ✓, ts-3 ✓


Agreement with the majority: elm-1 100%, elm-2 100%, elm-3 100%, ts-1 100%, ts-2 100%, ts-3 100%

## Board

Builds: elm-1 ✓, elm-2 ✓, elm-3 ✓, ts-1 ✓, ts-2 ✓, ts-3 ✓


Agreement with the majority: elm-1 100%, elm-2 100%, elm-3 100%, ts-1 100%, ts-2 100%, ts-3 100%

## Crm

Builds: elm-1 ✓, elm-2 ✓, elm-3 ✓, ts-1 ✓, ts-2 ✓, ts-3 ✓


Agreement with the majority: elm-1 100%, elm-2 100%, elm-3 100%, ts-1 100%, ts-2 100%, ts-3 100%

## Habits

Builds: elm-1 ✓, elm-2 ✓, elm-3 ✓, ts-1 ✓, ts-2 ✓, ts-3 ✓


Agreement with the majority: elm-1 100%, elm-2 100%, elm-3 100%, ts-1 100%, ts-2 100%, ts-3 100%

## Library

Builds: elm-1 ✓, elm-2 ✓, elm-3 ✓ (2 attempts), ts-1 ✓, ts-2 ✓ (2 attempts), ts-3 ✓

- elm-3 first problem: -- TOO MANY ARGS ------------------------------------------------ src/Worker.elm  The `view` function expects 1 argument, but it got 2 instead.  64|                         Ui.encode (Spec.toNode (App.view clock next))                                                     ^^^^^^^^ Are there any missin
- ts-2 first problem: main.ts(10,24): error TS2554: Expected 0 arguments, but got 1. main.ts(13,33): error TS2554: Expected 2 arguments, but got 3. main.ts(15,37): error TS2554: Expected 1 arguments, but got 2. test-entry.ts(10,20): error TS2554: Expected 0 arguments, but got 1. test-entry.ts(12,65): error TS2554: Expect

Agreement with the majority: elm-1 100%, elm-2 100%, elm-3 100%, ts-1 100%, ts-2 100%, ts-3 100%

## Reservations

Builds: elm-1 ✓, elm-2 ✓, elm-3 ✓, ts-1 ✓, ts-2 ✓, ts-3 ✓


Agreement with the majority: elm-1 100%, elm-2 100%, elm-3 100%, ts-1 100%, ts-2 100%, ts-3 100%

## Notes (final v1 measurement, round A)

Language 1 (`intent.lock`: `@language 1 sha256:c3ddc8eff0f4494f`, model `claude-opus-5-5` via `llm claude-cli`),
2026-09-28. The same 12 apps, builds and session depth as r63 (3 builds per target, 40 sessions × 25
actions, concurrency 3), so the two rounds compare directly.

- **72/72 builds OK, 70/72 first try, `always` held in all 72, 100% the same app, Elm≡TS 100%** on every
  app (r63: 72/72, 69/72 first try, 100%).
- **Cost: $31.68** (r63: $29.82).
- The two builds that needed a repair are both Library, both the same known slip as r63: the model
  left out the clock argument of `view` (elm-3: `App.view clock next`; ts-2: the `main.ts` /
  `test-entry.ts` arities). Class 1 (the model, fixed by the first repair); no failure remains.
- No divergence, no violated `always`, no harness bug.
