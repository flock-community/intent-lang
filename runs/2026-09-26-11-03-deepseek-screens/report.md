# Convergence report — deepseek-screens

2 builds per target (elm, ts), 12 random sessions × 12 actions per app.

| App | Builds OK | First-try OK | `always` held | Same app: all | Elm | TS | Elm≡TS | Code sim. Elm / TS | Cost |
|---|---|---|---|---|---|---|---|---|---|
| Counter | 4/4 | 4/4 | 4/4 | 100% | 100% | 100% | 100% | 85% / 86% | $0.02 |
| Calculator | 3/4 | 2/4 | 3/3 | 100% | – | 100% | 100% | – / 24% | $0.06 |
| Board | 4/4 | 4/4 | 4/4 | 100% | 100% | 100% | 100% | 62% / 18% | $0.03 |
| Helpdesk | 4/4 | 0/4 | 4/4 | 100% | 100% | 100% | 100% | 45% / 35% | $0.10 |
| TicketPages | 4/4 | 3/4 | 4/4 | 100% | 100% | 100% | 100% | 55% / 28% | $0.04 |

*Same app* = share of random sessions in which every build showed identical screens after every action.

## Counter

Builds: elm-1 ✓, elm-2 ✓, ts-1 ✓, ts-2 ✓


Agreement with the majority: elm-1 100%, elm-2 100%, ts-1 100%, ts-2 100%

## Calculator

Builds: elm-1 ✓ (2 attempts), elm-2 ✗ (4 attempts), ts-1 ✓, ts-2 ✓

- elm-1 first problem: typing numbers: expected `display` = "12.53", got "012.53"
- elm-2 first problem: no precedence: expected `display` = "5", got "915107"; decimals: expected `display` = "0.33333333", got "831014"; typing numbers: expected `display` = "0", got "12"; operators in a row: expected `display` = "-1", got "97111014"; going on after equals: expected `display` = "20", got "91510147414"; di

Agreement with the majority: elm-1 100%, ts-1 100%, ts-2 100%

## Board

Builds: elm-1 ✓, elm-2 ✓, ts-1 ✓, ts-2 ✓


Agreement with the majority: elm-1 100%, elm-2 100%, ts-1 100%, ts-2 100%

## Helpdesk

Builds: elm-1 ✓ (2 attempts), elm-2 ✓ (2 attempts), ts-1 ✓ (2 attempts), ts-2 ✓ (2 attempts)

- elm-1 first problem: -- MISSING PATTERNS ------------------------------------------------ src/App.elm  This `case` does not have branches for all possibilities:   52|>    case msg of  53|>        PageChosen p ->  54|>            { model | page = p, selected = Nothing }  55|>  56|>        SearchTyped text ->  57|>       
- elm-2 first problem: -- TYPE MISMATCH --------------------------------------------------- src/App.elm  I am struggling with this boolean operation:  165|                     || (isSolved && t.status == Solved)                              ^^^^^^^^ Both sides of (&&) must be Bool values, but the left side is:      String
- ts-1 first problem: app.ts(4,3): error TS2305: Module '"./spec.ts"' has no exported member 'Model'.
- ts-2 first problem: app.ts(1,28): error TS2305: Module '"./spec.ts"' has no exported member 'Model'.

Agreement with the majority: elm-1 100%, elm-2 100%, ts-1 100%, ts-2 100%

## TicketPages

Builds: elm-1 ✓, elm-2 ✓, ts-1 ✓ (2 attempts), ts-2 ✓

- ts-1 first problem: app-nav.ts(19,16): error TS2339: Property 'go' does not exist on type 'Model | { model: Model; go?: "back" | Route | undefined; }'.   Property 'go' does not exist on type 'Model'. app-nav.ts(19,49): error TS2339: Property 'go' does not exist on type 'Model | { model: Model; go?: "back" | Route | und

Agreement with the majority: elm-1 100%, elm-2 100%, ts-1 100%, ts-2 100%
