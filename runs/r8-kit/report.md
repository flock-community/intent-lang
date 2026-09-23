# Convergence report — v7-kit-elm

3 builds per target (elm), 30 random sessions × 20 actions per app.

| App | Builds OK | First-try OK | `always` held | Same app: all | Elm | TS | Elm≡TS | Code sim. Elm / TS | Cost |
|---|---|---|---|---|---|---|---|---|---|
| Helpdesk | 3/3 | 3/3 | 3/3 | 100% | 100% | – | – | 75% / – | $2.81 |

*Same app* = share of random sessions in which every build showed identical screens after every action.

### Looks (styled builds)

| App | Page = logic | Pixels differ: Elm / TS / Elm↔TS | Boxes within 8px: Elm / TS / Elm↔TS | Median box offset (px) |
|---|---|---|---|---|
| Helpdesk | 3/3 | 0.5% / – / – | 81% / NaN% / NaN% | 0 / – / – |

*Page = logic*: builds whose page showed exactly the logic's screen in every session. *Pixels differ*: average share of differing pixels between two builds' screenshots of the same state. *Boxes within 8px*: share of elements whose box is within 8px on every edge.

## Helpdesk

Builds: elm-1 ✓ (2 attempts), elm-2 ✓ (2 attempts), elm-3 ✓ (2 attempts)


Contact sheets: `r8-kit/10-helpdesk/sheets/`


Agreement with the majority: elm-1 100%, elm-2 100%, elm-3 100%
