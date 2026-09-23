# Convergence report — v12-reanalysed

3 builds per target (elm, ts), 30 random sessions × 20 actions per app.

| App | Builds OK | First-try OK | `always` held | Same app: all | Elm | TS | Elm≡TS | Code sim. Elm / TS | Cost |
|---|---|---|---|---|---|---|---|---|---|
| Library | 6/6 | 6/6 | 6/6 | 100% | 100% | 100% | 100% | 68% / 60% | $4.20 |

*Same app* = share of random sessions in which every build showed identical screens after every action.

### Looks (styled builds)

| App | Page = logic | Pixels differ: Elm / TS / Elm↔TS | Local layout agrees: Elm / TS / Elm↔TS | Boxes within 8px (absolute) | Median box offset (px) |
|---|---|---|---|---|---|
| Library | 6/6 | 1.0% / 0.8% / 0.9% | 59% / 56% / 63% | 59% / 53% / 62% | 14 / 13 / 12 |

*Page = logic*: builds whose page showed exactly the logic's screen in every session. *Pixels differ*: average share of differing pixels between two builds' screenshots of the same state. *Local layout agrees*: share of elements whose position relative to their parent, and whose size, are within 8px, so one taller block counts once instead of shifting everything below it. *Boxes within 8px (absolute)*: the same on absolute page positions.

## Library

Builds: elm-1 ✓ (2 attempts), elm-2 ✓ (2 attempts), elm-3 ✓ (2 attempts), ts-1 ✓ (2 attempts), ts-2 ✓ (2 attempts), ts-3 ✓ (2 attempts)


Contact sheets: `r15-heldout2/library/sheets/`


Agreement with the majority: elm-1 100%, elm-2 100%, elm-3 100%, ts-1 100%, ts-2 100%, ts-3 100%
