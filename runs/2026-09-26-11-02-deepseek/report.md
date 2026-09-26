# Convergence report — deepseek

2 builds per target (elm, ts), 12 random sessions × 12 actions per app.

| App | Builds OK | First-try OK | `always` held | Same app: all | Elm | TS | Elm≡TS | Code sim. Elm / TS | Cost |
|---|---|---|---|---|---|---|---|---|---|
| Approval | 4/4 | 2/4 | 4/4 | 100% | 100% | 100% | 100% | 85% / 71% | $0.00 |
| Tags | 4/4 | 4/4 | 4/4 | 100% | 100% | 100% | 100% | 63% / 59% | $0.00 |
| Hash | 4/4 | 4/4 | 4/4 | 100% | 100% | 100% | 100% | 81% / 83% | $0.00 |

*Same app* = share of random sessions in which every build showed identical screens after every action.

## Approval

Builds: elm-1 ✓, elm-2 ✓, ts-1 ✓ (2 attempts), ts-2 ✓ (2 attempts)

- ts-1 first problem: app.ts(103,48): error TS2339: Property 'error' does not exist on type '{ status: 400; body: Problem; } | { status: 0; error: string; }'.   Property 'error' does not exist on type '{ status: 400; body: Problem; }'.
- ts-2 first problem: app.ts(75,13): error TS2353: Object literal may only specify known properties, and 'message' does not exist in type 'Model'. app.ts(84,13): error TS2353: Object literal may only specify known properties, and 'message' does not exist in type 'Model'. app.ts(93,13): error TS2353: Object literal may on

Agreement with the majority: elm-1 100%, elm-2 100%, ts-1 100%, ts-2 100%

## Tags

Builds: elm-1 ✓, elm-2 ✓, ts-1 ✓, ts-2 ✓


Agreement with the majority: elm-1 100%, elm-2 100%, ts-1 100%, ts-2 100%

## Hash

Builds: elm-1 ✓, elm-2 ✓, ts-1 ✓, ts-2 ✓


Agreement with the majority: elm-1 100%, elm-2 100%, ts-1 100%, ts-2 100%
