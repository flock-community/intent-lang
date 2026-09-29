# Convergence report — r1-all (language 1: every other spec)

1 build per target for screens (so Elm≡TS is measured), 2 independent TypeScript builds for services and the job; 40 random sessions × 25 actions per app.

| App | Builds OK | First-try OK | `always` held | Same app: all | Elm | TS | Elm≡TS | Code sim. Elm / TS | Cost |
|---|---|---|---|---|---|---|---|---|---|
| TipSplit | 2/2 | 2/2 | 2/2 | 100% | – | – | 100% | – / – | $0.74 |
| Helpdesk | 2/2 | 2/2 | 2/2 | 100% | – | – | 100% | – / – | $1.16 |
| Storefront | 2/2 | 2/2 | 2/2 | 100% | – | – | 100% | – / – | $0.88 |
| Helpdesk | 2/2 | 2/2 | 2/2 | 100% | – | – | 100% | – / – | $1.14 |
| SupportDesk | 2/2 | 2/2 | 2/2 | 100% | – | – | 100% | – / – | $1.17 |
| TicketsUi | 2/2 | 2/2 | 2/2 | 100% | – | – | 100% | – / – | $0.84 |
| DeskUi | 2/2 | 2/2 | 2/2 | 100% | – | – | 100% | – / – | $0.87 |
| Checkout | 2/2 | 2/2 | 2/2 | 100% | – | – | 100% | – / – | $0.83 |
| TicketPages | 2/2 | 2/2 | 2/2 | 100% | – | – | 100% | – / – | $0.75 |
| Approval | 2/2 | 2/2 | 2/2 | 100% | – | – | 100% | – / – | $0.86 |
| Tags | 2/2 | 2/2 | 2/2 | 100% | – | – | 100% | – / – | $0.68 |
| Hash | 2/2 | 2/2 | 2/2 | 100% | – | – | 100% | – / – | $0.67 |
| Tabs | 2/2 | 2/2 | 2/2 | 100% | – | – | 100% | – / – | $0.69 |
| References | 2/2 | 2/2 | 2/2 | 100% | – | – | 100% | – / – | $0.74 |
| InlineEdit | 2/2 | 2/2 | 2/2 | 100% | – | – | 100% | – / – | $0.68 |
| RowStatus | 2/2 | 2/2 | 2/2 | 100% | – | – | 100% | – / – | $0.68 |
| RowAssign | 2/2 | 2/2 | 2/2 | 100% | – | – | 100% | – / – | $0.68 |
| AlertsUi | 2/2 | 2/2 | 2/2 | 100% | – | – | 100% | – / – | $0.77 |
| Sized | 2/2 | 2/2 | 2/2 | 100% | – | – | 100% | – / – | $0.70 |
| FrozenApprovals | 2/2 | 2/2 | 2/2 | 100% | – | – | 100% | – / – | $0.98 |
| Checklists | 2/2 | 2/2 | 2/2 | 100% | – | – | 100% | – / – | $0.93 |
| OrderLines | 2/2 | 2/2 | 2/2 | 100% | – | – | 100% | – / – | $0.81 |
| RefNavigation | 2/2 | 2/2 | 2/2 | 100% | – | – | 100% | – / – | $0.76 |
| Recipes | 2/2 | 2/2 | 2/2 | 100% | – | – | 100% | – / – | $0.76 |
| Table | 2/2 | 2/2 | 2/2 | 100% | – | – | 100% | – / – | $0.95 |
| ExpensesUi | 2/2 | 2/2 | 2/2 | 100% | – | – | 100% | – / – | $0.97 |
| CommunityWorkshops | 2/2 | 2/2 | 2/2 | 100% | – | – | 100% | – / – | $1.15 |
| Inventory | 2/2 | 2/2 | 2/2 | 100% | – | – | 100% | – / – | $1.03 |
| ExpenseApprovals | 2/2 | 2/2 | 2/2 | 100% | – | – | 100% | – / – | $1.17 |
| AlertsApi | 2/2 | 2/2 | 2/2 | 100% | – | 100% | – | – / 77% | $0.72 |
| DeskApi | 2/2 | 2/2 | 2/2 | 100% | – | 100% | – | – / 63% | $0.88 |
| ExpensesApi | 2/2 | 2/2 | 2/2 | 100% | – | 100% | – | – / 78% | $0.96 |
| InvitesApi | 2/2 | 2/2 | 2/2 | 100% | – | 100% | – | – / 94% | $0.83 |
| LedgerApi | 2/2 | 2/2 | 2/2 | 100% | – | 100% | – | – / 88% | $0.88 |
| MembersApi | 2/2 | 2/2 | 2/2 | 100% | – | 100% | – | – / 80% | $0.74 |
| NoticesApi | 2/2 | 2/2 | 2/2 | 100% | – | 100% | – | – / 73% | $0.76 |
| PaymentsApi | 2/2 | 2/2 | 2/2 | 100% | – | 100% | – | – / 83% | $0.80 |
| PayoutsApi | 2/2 | 2/2 | 2/2 | 100% | – | 100% | – | – / 100% | $1.00 |
| RecipesApi | 2/2 | 2/2 | 2/2 | 100% | – | 100% | – | – / 75% | $0.71 |
| SpecsApi | 2/2 | 2/2 | 2/2 | 100% | – | 100% | – | – / 70% | $0.73 |
| TicketsApi | 2/2 | 2/2 | 2/2 | 100% | – | 100% | – | – / 72% | $0.88 |
| LockersApi | 2/2 | 2/2 | 2/2 | 100% | – | 100% | – | – / 37% | $1.02 |
| UrgentWatch | 2/2 | 2/2 | 2/2 | 100% | – | 100% | – | – / 55% | $0.76 |

*Same app* = share of random sessions in which every build showed identical screens after every action.

## TipSplit

Builds: elm-1 ✓, ts-1 ✓


Agreement with the majority: elm-1 100%, ts-1 100%

## Helpdesk

Builds: elm-1 ✓, ts-1 ✓


Agreement with the majority: elm-1 100%, ts-1 100%

## Storefront

Builds: elm-1 ✓, ts-1 ✓


Agreement with the majority: elm-1 100%, ts-1 100%

## Helpdesk

Builds: elm-1 ✓, ts-1 ✓


Agreement with the majority: elm-1 100%, ts-1 100%

## SupportDesk

Builds: elm-1 ✓, ts-1 ✓


Agreement with the majority: elm-1 100%, ts-1 100%

## TicketsUi

Builds: elm-1 ✓, ts-1 ✓


Agreement with the majority: elm-1 100%, ts-1 100%

## DeskUi

Builds: elm-1 ✓, ts-1 ✓


Agreement with the majority: elm-1 100%, ts-1 100%

## Checkout

Builds: elm-1 ✓, ts-1 ✓


Agreement with the majority: elm-1 100%, ts-1 100%

## TicketPages

Builds: elm-1 ✓, ts-1 ✓


Agreement with the majority: elm-1 100%, ts-1 100%

## Approval

Builds: elm-1 ✓, ts-1 ✓


Agreement with the majority: elm-1 100%, ts-1 100%

## Tags

Builds: elm-1 ✓, ts-1 ✓


Agreement with the majority: elm-1 100%, ts-1 100%

## Hash

Builds: elm-1 ✓, ts-1 ✓


Agreement with the majority: elm-1 100%, ts-1 100%

## Tabs

Builds: elm-1 ✓, ts-1 ✓


Agreement with the majority: elm-1 100%, ts-1 100%

## References

Builds: elm-1 ✓, ts-1 ✓


Agreement with the majority: elm-1 100%, ts-1 100%

## InlineEdit

Builds: elm-1 ✓, ts-1 ✓


Agreement with the majority: elm-1 100%, ts-1 100%

## RowStatus

Builds: elm-1 ✓, ts-1 ✓


Agreement with the majority: elm-1 100%, ts-1 100%

## RowAssign

Builds: elm-1 ✓, ts-1 ✓


Agreement with the majority: elm-1 100%, ts-1 100%

## AlertsUi

Builds: elm-1 ✓, ts-1 ✓


Agreement with the majority: elm-1 100%, ts-1 100%

## Sized

Builds: elm-1 ✓, ts-1 ✓


Agreement with the majority: elm-1 100%, ts-1 100%

## FrozenApprovals

Builds: elm-1 ✓, ts-1 ✓


Agreement with the majority: elm-1 100%, ts-1 100%

## Checklists

Builds: elm-1 ✓, ts-1 ✓


Agreement with the majority: elm-1 100%, ts-1 100%

## OrderLines

Builds: elm-1 ✓, ts-1 ✓


Agreement with the majority: elm-1 100%, ts-1 100%

## RefNavigation

Builds: elm-1 ✓, ts-1 ✓


Agreement with the majority: elm-1 100%, ts-1 100%

## Recipes

Builds: elm-1 ✓, ts-1 ✓


Agreement with the majority: elm-1 100%, ts-1 100%

## Table

Builds: elm-1 ✓, ts-1 ✓


Agreement with the majority: elm-1 100%, ts-1 100%

## ExpensesUi

Builds: elm-1 ✓, ts-1 ✓


Agreement with the majority: elm-1 100%, ts-1 100%

## CommunityWorkshops

Builds: elm-1 ✓, ts-1 ✓


Agreement with the majority: elm-1 100%, ts-1 100%

## Inventory

Builds: elm-1 ✓, ts-1 ✓


Agreement with the majority: elm-1 100%, ts-1 100%

## ExpenseApprovals

Builds: elm-1 ✓, ts-1 ✓


Agreement with the majority: elm-1 100%, ts-1 100%

## AlertsApi

Builds: ts-1 ✓, ts-2 ✓


Agreement with the majority: ts-1 100%, ts-2 100%

## DeskApi

Builds: ts-1 ✓, ts-2 ✓


Agreement with the majority: ts-1 100%, ts-2 100%

## ExpensesApi

Builds: ts-1 ✓, ts-2 ✓


Agreement with the majority: ts-1 100%, ts-2 100%

## InvitesApi

Builds: ts-1 ✓, ts-2 ✓


Agreement with the majority: ts-1 100%, ts-2 100%

## LedgerApi

Builds: ts-1 ✓, ts-2 ✓


Agreement with the majority: ts-1 100%, ts-2 100%

## MembersApi

Builds: ts-1 ✓, ts-2 ✓


Agreement with the majority: ts-1 100%, ts-2 100%

## NoticesApi

Builds: ts-1 ✓, ts-2 ✓


Agreement with the majority: ts-1 100%, ts-2 100%

## PaymentsApi

Builds: ts-1 ✓, ts-2 ✓


Agreement with the majority: ts-1 100%, ts-2 100%

## PayoutsApi

Builds: ts-1 ✓, ts-2 ✓


Agreement with the majority: ts-1 100%, ts-2 100%

## RecipesApi

Builds: ts-1 ✓, ts-2 ✓


Agreement with the majority: ts-1 100%, ts-2 100%

## SpecsApi

Builds: ts-1 ✓, ts-2 ✓


Agreement with the majority: ts-1 100%, ts-2 100%

## TicketsApi

Builds: ts-1 ✓, ts-2 ✓


Agreement with the majority: ts-1 100%, ts-2 100%

## LockersApi

Builds: ts-1 ✓, ts-2 ✓


Agreement with the majority: ts-1 100%, ts-2 100%

## UrgentWatch

Builds: ts-1 ✓, ts-2 ✓


Agreement with the majority: ts-1 100%, ts-2 100%

## Notes (final v1 measurement, round B)

Language 1, model `claude-opus-5-5`, 2026-09-28. Every spec in `apps/` and `apps/*/` that round A does not
measure: 29 screens (Elm and TypeScript, one build each) and 14 services and jobs (TypeScript only:
two independent builds each, so that "same app" is measured for them too). `apps/held-out-4/` is not
included: another agent was writing it during this round and it does not pass the checker yet.

How the report was made: converge ran in parts (`report-services.md`: services, first build;
`runs/r1-all-services-b2/`: their second build, copied in as `ts-2`; `report-screens.md`: the screens,
before the fix below; `runs/r1-all-rerun*/`: the seven screens that make calls, rebuilt after the fix),
then `intent reanalyse` over all 43 specs gave this report (`report-r1-all.md`, the same table). The
builds from before the fix are kept beside the new ones as `pre-fix-elm-1` / `pre-fix-ts-1`.

- **Builds: 86/86 OK, 86/86 first try, `always` held in all, 100% the same app on every spec,
  Elm≡TS 100% on all 29 screens** (after the fix).
- **Two divergences before the fix — class 4, root cause class 3 (a harness bug), a v1 blocker, fixed:**
  - *Checkout* (`18-checkout`, Elm≡TS 90%, 4 of 40 sessions): when a call got an answer with a status the
    contract does not declare (`steer pay fail 3` → 503), the harness's message listed the declared
    statuses in declaration order on Elm (`200, 404, 409, 401, 403`) and in ascending order on TypeScript
    (`Object.keys` on a record with number keys: `200, 401, 403, 404, 409`).
  - *TicketsUi* (`15-tickets-ui`, Elm≡TS 98%, 1 of 40 sessions): a call still in progress after its last
    attempt (`steer tickets slow` after two failures) arrives as `{ status: 409, error, inProgress }`
    with no body. TypeScript's `fromAnswer` treats any answer with an `error` as a failure with that
    error; Elm's `Spec.fromAnswer` read the status first and reported "the body does not fit".
  - Fix (`compiler/targets/elm.ts`, the generated `Spec.fromAnswer`): an answer with an `error` is a
    failure with that error before its status is read (as in TypeScript), a missing error reads "no
    answer" (as in TypeScript), and the undeclared-status message lists the statuses in ascending order.
    Test: `tests/answers-parity.test.ts` (in `npm test`) scaffolds the checkout app for both targets and
    feeds six answers the drivers deliver through both `fromAnswer`s; it failed before the fix and passes
    after. The harness snapshot changed only for the Elm `Spec.elm` and prompts of the eight apps that
    make calls (24 entries), and was updated.
  - Rerun: all seven screens that make calls were rebuilt on both targets with the fix
    (`runs/r1-all-rerun/`, and the desk screen's TypeScript build in `runs/r1-all-rerun-desk/`, whose
    first attempt stopped at this round's budget cap, not at a problem): 100% the same app, Elm≡TS 100%.
- **Cost:** screens $25.02 (before the fix), services $6.09 + $5.59, the rerun after the fix $5.46 +
  $0.43 (the table's Cost column shows each spec's builds as they stand now), plus the twin builds of the
  providers and client layers the call-making screens are tested against, which converge's report does
  not count: about $5.6 in the screens run and $6.9 in the rerun (built again because the harness
  changed). **Total about $55.**
