# Convergence report — v38-converge

2 builds per target (elm, ts), 20 random sessions × 20 actions per app.

| App | Builds OK | First-try OK | `always` held | Same app: all | Elm | TS | Elm≡TS | Code sim. Elm / TS | Cost |
|---|---|---|---|---|---|---|---|---|---|
| Checkout | 4/4 | 4/4 | 4/4 | 100% | 100% | 100% | 100% | 68% / 82% | $1.14 |

*Same app* = share of random sessions in which every build showed identical screens after every action.

## Checkout

Builds: elm-1 ✓, elm-2 ✓, ts-1 ✓, ts-2 ✓


Agreement with the majority: elm-1 100%, elm-2 100%, ts-1 100%, ts-2 100%
