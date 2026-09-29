# Convergence report — r1-all-rerun

1 builds per target (elm, ts), 40 random sessions × 25 actions per app.

| App | Builds OK | First-try OK | `always` held | Same app: all | Elm | TS | Elm≡TS | Code sim. Elm / TS | Cost |
|---|---|---|---|---|---|---|---|---|---|
| TicketsUi | 2/2 | 2/2 | 2/2 | 100% | – | – | 100% | – / – | $0.84 |
| DeskUi | 1/2 | 1/2 | 1/1 | – | – | – | – | – / – | $0.44 |
| Checkout | 2/2 | 2/2 | 2/2 | 100% | – | – | 100% | – / – | $0.83 |
| Approval | 2/2 | 2/2 | 2/2 | 100% | – | – | 100% | – / – | $0.86 |
| AlertsUi | 2/2 | 2/2 | 2/2 | 100% | – | – | 100% | – / – | $0.77 |
| Recipes | 2/2 | 2/2 | 2/2 | 100% | – | – | 100% | – / – | $0.76 |
| ExpensesUi | 2/2 | 2/2 | 2/2 | 100% | – | – | 100% | – / – | $0.97 |

*Same app* = share of random sessions in which every build showed identical screens after every action.

## TicketsUi

Builds: elm-1 ✓, ts-1 ✓


Agreement with the majority: elm-1 100%, ts-1 100%

## DeskUi

Builds: elm-1 ✓, ts-1 ✗

- ts-1 first problem: over budget ($12.35 of $12.00): raise `budget` or INTENT_BUDGET

Agreement with the majority: elm-1 100%

## Checkout

Builds: elm-1 ✓, ts-1 ✓


Agreement with the majority: elm-1 100%, ts-1 100%

## Approval

Builds: elm-1 ✓, ts-1 ✓


Agreement with the majority: elm-1 100%, ts-1 100%

## AlertsUi

Builds: elm-1 ✓, ts-1 ✓


Agreement with the majority: elm-1 100%, ts-1 100%

## Recipes

Builds: elm-1 ✓, ts-1 ✓


Agreement with the majority: elm-1 100%, ts-1 100%

## ExpensesUi

Builds: elm-1 ✓, ts-1 ✓


Agreement with the majority: elm-1 100%, ts-1 100%
