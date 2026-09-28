# Convergence report — v63

3 builds per target (elm, ts), 40 random sessions × 25 actions per app.

| App | Builds OK | First-try OK | `always` held | Same app: all | Elm | TS | Elm≡TS | Code sim. Elm / TS | Cost |
|---|---|---|---|---|---|---|---|---|---|
| Counter | 6/6 | 6/6 | 6/6 | 100% | 100% | 100% | 100% | 85% / 100% | $1.84 |
| Todo | 6/6 | 6/6 | 6/6 | 100% | 100% | 100% | 100% | 74% / 58% | $2.00 |
| Pomodoro | 6/6 | 6/6 | 6/6 | 100% | 100% | 100% | 100% | 93% / 86% | $1.97 |
| Wordle | 6/6 | 6/6 | 6/6 | 100% | 100% | 100% | 100% | 62% / 60% | $2.12 |
| Expenses | 6/6 | 6/6 | 6/6 | 100% | 100% | 100% | 100% | 40% / 30% | $2.50 |
| Shop | 6/6 | 6/6 | 6/6 | 100% | 100% | 100% | 100% | 54% / 76% | $2.31 |
| Calculator | 6/6 | 6/6 | 6/6 | 100% | 100% | 100% | 100% | 58% / 78% | $2.21 |
| Board | 6/6 | 6/6 | 6/6 | 100% | 100% | 100% | 100% | 43% / 44% | $2.06 |
| Crm | 6/6 | 6/6 | 6/6 | 100% | 100% | 100% | 100% | 69% / 66% | $2.96 |
| Habits | 6/6 | 6/6 | 6/6 | 100% | 100% | 100% | 100% | 65% / 65% | $2.44 |
| Library | 6/6 | 3/6 | 6/6 | 100% | 100% | 100% | 100% | 60% / 58% | $4.40 |
| Reservations | 6/6 | 6/6 | 6/6 | 100% | 100% | 100% | 100% | 49% / 57% | $3.01 |

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

Builds: elm-1 ✓ (2 attempts), elm-2 ✓ (2 attempts), elm-3 ✓ (2 attempts), ts-1 ✓, ts-2 ✓, ts-3 ✓

- elm-1 first problem: -- TOO MANY ARGS ------------------------------------------------ src/Worker.elm  The `view` function expects 1 argument, but it got 2 instead.  64|                         Ui.encode (Spec.toNode (App.view clock next))                                                     ^^^^^^^^ Are there any missin
- elm-2 first problem: -- TOO MANY ARGS ------------------------------------------------ src/Worker.elm  The `view` function expects 1 argument, but it got 2 instead.  64|                         Ui.encode (Spec.toNode (App.view clock next))                                                     ^^^^^^^^ Are there any missin
- elm-3 first problem: -- TOO MANY ARGS ------------------------------------------------ src/Worker.elm  The `view` function expects 1 argument, but it got 2 instead.  64|                         Ui.encode (Spec.toNode (App.view clock next))                                                     ^^^^^^^^ Are there any missin

Agreement with the majority: elm-1 100%, elm-2 100%, elm-3 100%, ts-1 100%, ts-2 100%, ts-3 100%

## Reservations

Builds: elm-1 ✓, elm-2 ✓, elm-3 ✓, ts-1 ✓, ts-2 ✓, ts-3 ✓


Agreement with the majority: elm-1 100%, elm-2 100%, elm-3 100%, ts-1 100%, ts-2 100%, ts-3 100%
