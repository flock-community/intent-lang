# Convergence report — v8b-styled

3 builds per target (elm, ts), 30 random sessions × 20 actions per app.

| App | Builds OK | First-try OK | `always` held | Same app: all | Elm | TS | Elm≡TS | Code sim. Elm / TS | Cost |
|---|---|---|---|---|---|---|---|---|---|
| Helpdesk | 6/6 | 6/6 | 6/6 | 100% | 100% | 100% | 100% | 64% / 57% | $4.87 |
| Storefront | 6/6 | 5/6 | 6/6 | 100% | 100% | 100% | 100% | 72% / 48% | $3.36 |

*Same app* = share of random sessions in which every build showed identical screens after every action.

### Looks (styled builds)

| App | Page = logic | Pixels differ: Elm / TS / Elm↔TS | Boxes within 8px: Elm / TS / Elm↔TS | Median box offset (px) |
|---|---|---|---|---|
| Helpdesk | 6/6 | 0.6% / 0.0% / 1.2% | 63% / 99% / 65% | 8 / 0 / 7 |
| Storefront | 6/6 | 2.6% / 0.2% / 9.6% | 74% / 91% / 31% | 4 / 0 / 15 |

*Page = logic*: builds whose page showed exactly the logic's screen in every session. *Pixels differ*: average share of differing pixels between two builds' screenshots of the same state. *Boxes within 8px*: share of elements whose box is within 8px on every edge.

## Helpdesk

Builds: elm-1 ✓ (2 attempts), elm-2 ✓ (2 attempts), elm-3 ✓ (2 attempts), ts-1 ✓ (2 attempts), ts-2 ✓ (2 attempts), ts-3 ✓ (2 attempts)


Contact sheets: `r10-styled/10-helpdesk/sheets/`


Agreement with the majority: elm-1 100%, elm-2 100%, elm-3 100%, ts-1 100%, ts-2 100%, ts-3 100%

## Storefront

Builds: elm-1 ✓ (2 attempts), elm-2 ✓ (3 attempts), elm-3 ✓ (2 attempts), ts-1 ✓ (2 attempts), ts-2 ✓ (2 attempts), ts-3 ✓ (2 attempts)

- elm-2 first problem: -- TOO MANY ARGS -------------------------------------------------- src/Look.elm  The `p` value is not a function, but it was given 2 arguments.  96|                 [ p [ dataEl "name", class Kit.label ] [ text p.name ]                       ^ Are there any missing commas? Or missing parentheses?

Contact sheets: `r10-styled/11-storefront/sheets/`


Agreement with the majority: elm-1 100%, elm-2 100%, elm-3 100%, ts-1 100%, ts-2 100%, ts-3 100%
