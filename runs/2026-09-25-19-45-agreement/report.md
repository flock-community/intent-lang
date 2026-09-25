# Convergence report — agreement

2 builds per target (elm, ts), 10 random sessions × 10 actions per app.

| App | Builds OK | First-try OK | `always` held | Same app: all | Elm | TS | Elm≡TS | Code sim. Elm / TS | Cost |
|---|---|---|---|---|---|---|---|---|---|
| Approval | 4/4 | 4/4 | 4/4 | 100% | 100% | 100% | 100% | 91% / 70% | $1.28 |

*Same app* = share of random sessions in which every build showed identical screens after every action.

## Approval

Builds: elm-1 ✓, elm-2 ✓, ts-1 ✓, ts-2 ✓


Agreement with the majority: elm-1 100%, elm-2 100%, ts-1 100%, ts-2 100%
