# Convergence report — api-converge

2 builds per target (ts), 10 random sessions × 10 actions per app.

| App | Builds OK | First-try OK | `always` held | Same app: all | Elm | TS | Elm≡TS | Code sim. Elm / TS | Cost |
|---|---|---|---|---|---|---|---|---|---|
| PaymentsApi | 2/2 | 2/2 | 2/2 | 100% | – | 100% | – | – / 76% | $0.57 |

*Same app* = share of random sessions in which every build showed identical screens after every action.

## PaymentsApi

Builds: ts-1 ✓, ts-2 ✓


Agreement with the majority: ts-1 100%, ts-2 100%
