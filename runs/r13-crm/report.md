# Convergence report — v10b-search

3 builds per target (elm, ts), 30 random sessions × 20 actions per app.

| App | Builds OK | First-try OK | `always` held | Same app: all | Elm | TS | Elm≡TS | Code sim. Elm / TS | Cost |
|---|---|---|---|---|---|---|---|---|---|
| Crm | 6/6 | 5/6 | 6/6 | 100% | 100% | 100% | 100% | 62% / 65% | $4.20 |

*Same app* = share of random sessions in which every build showed identical screens after every action.

### Looks (styled builds)

| App | Page = logic | Pixels differ: Elm / TS / Elm↔TS | Boxes within 8px: Elm / TS / Elm↔TS | Median box offset (px) |
|---|---|---|---|---|
| Crm | 6/6 | 0.0% / 0.0% / 0.0% | 100% / 98% / 99% | 0 / 0 / 0 |

*Page = logic*: builds whose page showed exactly the logic's screen in every session. *Pixels differ*: average share of differing pixels between two builds' screenshots of the same state. *Boxes within 8px*: share of elements whose box is within 8px on every edge.

## Crm

Builds: elm-1 ✓ (2 attempts), elm-2 ✓ (2 attempts), elm-3 ✓ (2 attempts), ts-1 ✓ (3 attempts), ts-2 ✓ (2 attempts), ts-3 ✓ (2 attempts)

- ts-1 first problem: the initial screen:; example "contacts at a glance", initial screen:; example "searching and paging contacts", initial screen:; example "deals by value", initial screen:; example "moving a deal forward", initial screen:; example "losing a deal", initial screen:; example "adding a contact", initial s

Contact sheets: `r13-crm/13-crm/sheets/`


Agreement with the majority: elm-1 100%, elm-2 100%, elm-3 100%, ts-1 100%, ts-2 100%, ts-3 100%
