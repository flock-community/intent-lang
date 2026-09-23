# Convergence report — v3

3 builds per target (elm, ts), 80 random sessions × 30 actions per app.

| App | Builds OK | First-try OK | Same app: all | Elm | TS | Elm≡TS | Code sim. Elm / TS | Cost |
|---|---|---|---|---|---|---|---|---|
| Calculator | 6/6 | 6/6 | 100% | 100% | 100% | 100% | 58% / 50% | $0.71 |
| Board | 6/6 | 6/6 | 100% | 100% | 100% | 100% | 44% / 38% | $0.49 |

*Same app* = share of random sessions in which every build showed identical screens after every action.

## Calculator

Builds: elm-1 ✓, elm-2 ✓, elm-3 ✓, ts-1 ✓, ts-2 ✓, ts-3 ✓


Agreement with the majority: elm-1 100%, elm-2 100%, elm-3 100%, ts-1 100%, ts-2 100%, ts-3 100%

## Board

Builds: elm-1 ✓, elm-2 ✓, elm-3 ✓, ts-1 ✓, ts-2 ✓, ts-3 ✓


Agreement with the majority: elm-1 100%, elm-2 100%, elm-3 100%, ts-1 100%, ts-2 100%, ts-3 100%
