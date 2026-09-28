# Convergence report — v63-held-out-3-reanalysed

3 builds per target (elm, ts), 40 random sessions × 25 actions per app.

| App | Builds OK | First-try OK | `always` held | Same app: all | Elm | TS | Elm≡TS | Code sim. Elm / TS | Cost |
|---|---|---|---|---|---|---|---|---|---|
| ExpenseApprovals | 6/6 | 6/6 | 6/6 | 100% | 100% | 100% | 100% | 65% / 76% | $3.26 |
| LockersApi | 3/3 | 3/3 | 3/3 | 100% | – | 100% | – | – / 43% | $1.55 |

*Same app* = share of random sessions in which every build showed identical screens after every action.

## ExpenseApprovals

Builds: elm-1 ✓, elm-2 ✓, elm-3 ✓, ts-1 ✓, ts-2 ✓, ts-3 ✓


Agreement with the majority: elm-1 100%, elm-2 100%, elm-3 100%, ts-1 100%, ts-2 100%, ts-3 100%

## LockersApi

Builds: ts-1 ✓, ts-2 ✓, ts-3 ✓


Agreement with the majority: ts-1 100%, ts-2 100%, ts-3 100%
