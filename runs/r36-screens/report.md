# Convergence report — v36-screens

2 builds per target (elm, ts), 40 random sessions × 25 actions per app.

| App | Builds OK | First-try OK | `always` held | Same app: all | Elm | TS | Elm≡TS | Code sim. Elm / TS | Cost |
|---|---|---|---|---|---|---|---|---|---|
| TicketPages | 4/4 | 4/4 | 4/4 | 100% | 100% | 100% | 100% | 83% / 59% | $1.03 |

*Same app* = share of random sessions in which every build showed identical screens after every action.

## TicketPages

Builds: elm-1 ✓, elm-2 ✓, ts-1 ✓, ts-2 ✓


Agreement with the majority: elm-1 100%, elm-2 100%, ts-1 100%, ts-2 100%
