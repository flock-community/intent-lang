# Convergence report — v10-heldout-fixed

3 builds per target (elm, ts), 30 random sessions × 20 actions per app.

| App | Builds OK | First-try OK | `always` held | Same app: all | Elm | TS | Elm≡TS | Code sim. Elm / TS | Cost |
|---|---|---|---|---|---|---|---|---|---|
| CommunityWorkshops | 6/6 | 6/6 | 6/6 | 100% | 100% | 100% | 100% | 51% / 54% | $4.51 |
| Inventory | 6/6 | 6/6 | 6/6 | 100% | 100% | 100% | 100% | 71% / 51% | $4.11 |

*Same app* = share of random sessions in which every build showed identical screens after every action.

### Looks (styled builds)

| App | Page = logic | Pixels differ: Elm / TS / Elm↔TS | Boxes within 8px: Elm / TS / Elm↔TS | Median box offset (px) |
|---|---|---|---|---|
| CommunityWorkshops | 6/6 | 1.7% / 1.3% / 1.7% | 32% / 34% / 43% | 43 / 43 / 36 |
| Inventory | 6/6 | 2.3% / 0.5% / 2.7% | 33% / 92% / 4% | 43 / 2 / 29 |

*Page = logic*: builds whose page showed exactly the logic's screen in every session. *Pixels differ*: average share of differing pixels between two builds' screenshots of the same state. *Boxes within 8px*: share of elements whose box is within 8px on every edge.

## CommunityWorkshops

Builds: elm-1 ✓ (2 attempts), elm-2 ✓ (2 attempts), elm-3 ✓ (2 attempts), ts-1 ✓ (2 attempts), ts-2 ✓ (2 attempts), ts-3 ✓ (2 attempts)


Contact sheets: `r14-heldout/events/sheets/`


Agreement with the majority: elm-1 100%, elm-2 100%, elm-3 100%, ts-1 100%, ts-2 100%, ts-3 100%

## Inventory

Builds: elm-1 ✓ (2 attempts), elm-2 ✓ (2 attempts), elm-3 ✓ (2 attempts), ts-1 ✓ (2 attempts), ts-2 ✓ (2 attempts), ts-3 ✓ (2 attempts)


Contact sheets: `r14-heldout/inventory/sheets/`


Agreement with the majority: elm-1 100%, elm-2 100%, elm-3 100%, ts-1 100%, ts-2 100%, ts-3 100%
