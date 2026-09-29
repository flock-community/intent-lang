# Convergence report — r1-all-screens

1 builds per target (elm, ts), 40 random sessions × 25 actions per app.

| App | Builds OK | First-try OK | `always` held | Same app: all | Elm | TS | Elm≡TS | Code sim. Elm / TS | Cost |
|---|---|---|---|---|---|---|---|---|---|
| TipSplit | 2/2 | 2/2 | 2/2 | 100% | – | – | 100% | – / – | $0.74 |
| Helpdesk | 2/2 | 2/2 | 2/2 | 100% | – | – | 100% | – / – | $1.16 |
| Storefront | 2/2 | 2/2 | 2/2 | 100% | – | – | 100% | – / – | $0.88 |
| Helpdesk | 2/2 | 2/2 | 2/2 | 100% | – | – | 100% | – / – | $1.14 |
| SupportDesk | 2/2 | 2/2 | 2/2 | 100% | – | – | 100% | – / – | $1.17 |
| TicketsUi | 2/2 | 2/2 | 2/2 | 98% | – | – | 98% | – / – | $0.84 |
| DeskUi | 2/2 | 2/2 | 2/2 | 100% | – | – | 100% | – / – | $0.86 |
| Checkout | 2/2 | 2/2 | 2/2 | 90% | – | – | 90% | – / – | $0.83 |
| TicketPages | 2/2 | 2/2 | 2/2 | 100% | – | – | 100% | – / – | $0.75 |
| Approval | 2/2 | 2/2 | 2/2 | 100% | – | – | 100% | – / – | $0.85 |
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
| ExpensesUi | 2/2 | 2/2 | 2/2 | 100% | – | – | 100% | – / – | $0.96 |
| CommunityWorkshops | 2/2 | 2/2 | 2/2 | 100% | – | – | 100% | – / – | $1.15 |
| Inventory | 2/2 | 2/2 | 2/2 | 100% | – | – | 100% | – / – | $1.03 |
| ExpenseApprovals | 2/2 | 2/2 | 2/2 | 100% | – | – | 100% | – / – | $1.17 |

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


Agreement with the majority: elm-1 100%, ts-1 98%

### Divergence in session 20 after 21 action(s)

```
  call tickets.solveTicket with id = 2  # another client
  click add
  type "" into draft
  click add
  type "3" into draft
  steer tickets slow
  steer tickets lose request
→ click solve on row 2 of rows
```

**elm-1** see:
```
field draft = "3"
button add "Add"
text problem = "tickets.solveTicket answered 409, but the body does not fit: Problem with the given value:\n\n{\n        \"endpoint\": \"tickets.solveTicket\",\n        \"status\": 409,\n        \"error\": \"another attempt is in progress\",\n        \"inProgress\": true\n    }\n\nExpecting an OBJECT with a field named `body`"
list rows (11 rows)
  row 1:
    text subject = "Café Ünïcode"
    text status = "Open"
    button solve "Solve"
  row 2:
    text subject = "Coffee machine broken"
    text status = "Solved"
    button solve "Solve" (disabled)
  row 3:
    text subject = "0"
    text status = "Solved"
    button solve "Solve" (disabled)
  row 4:
    text subject = "Refund for double charge"
    text status = "Open"
    button solve "Solve"
  row 5:
    text subject = "Password rules unclear"
    text status = "Open"
    button solve "Solve"
  row 6:
    text subject = "Export to CSV is empty"
    text status = "Open"
    button solve "Solve"
  row 7:
    text subject = "Change billing address"
    text status = "Solved"
    button solve "Solve" (disabled)
  row 8:
    text subject = "App crashes on upload"
    text status = "Pending"
    button solve "Solve"
  row 9:
    text subject = "Feature request: dark mode"
    text status = "Pending"
    button solve "Solve"
  row 10:
    text subject = "Invoice shows wrong VAT"
    text status = "Solved"
    button solve "Solve" (disabled)
  row 11:
    text subject = "Cannot log in after reset"
    text status = "Open"
    button solve "Solve"
calls made and answered in this step:
  tickets.solveTicket {"id":10} → 409 (503, 503, 200, still running)
  event tickets.ticketSolved
```
**ts-1** see:
```
field draft = "3"
button add "Add"
text problem = "another attempt is in progress"
list rows (11 rows)
  row 1:
    text subject = "Café Ünïcode"
    text status = "Open"
    button solve "Solve"
  row 2:
    text subject = "Coffee machine broken"
    text status = "Solved"
    button solve "Solve" (disabled)
  row 3:
    text subject = "0"
    text status = "Solved"
    button solve "Solve" (disabled)
  row 4:
    text subject = "Refund for double charge"
    text status = "Open"
    button solve "Solve"
  row 5:
    text subject = "Password rules unclear"
    text status = "Open"
    button solve "Solve"
  row 6:
    text subject = "Export to CSV is empty"
    text status = "Open"
    button solve "Solve"
  row 7:
    text subject = "Change billing address"
    text status = "Solved"
    button solve "Solve" (disabled)
  row 8:
    text subject = "App crashes on upload"
    text status = "Pending"
    button solve "Solve"
  row 9:
    text subject = "Feature request: dark mode"
    text status = "Pending"
    button solve "Solve"
  row 10:
    text subject = "Invoice shows wrong VAT"
    text status = "Solved"
    button solve "Solve" (disabled)
  row 11:
    text subject = "Cannot log in after reset"
    text status = "Open"
    button solve "Solve"
calls made and answered in this step:
  tickets.solveTicket {"id":10} → 409 (503, 503, 200, still running)
  event tickets.ticketSolved
```

## DeskUi

Builds: elm-1 ✓, ts-1 ✓


Agreement with the majority: elm-1 100%, ts-1 100%

## Checkout

Builds: elm-1 ✓, ts-1 ✓


Agreement with the majority: elm-1 100%, ts-1 90%

### Divergence in session 2 after 18 action(s)

```
  click buy
  type "" into staffKey
  steer pay duplicate
  type "9" into staffKey
  click buy
  type "0.1" into staffKey
  steer pay fail 3
→ click refund
```

**elm-1** see:
```
text pass = "Yoga, 10 classes: € 125.00"
field staffKey = "0.1"
button buy "Pay"
button refund "Refund"
text message = "Refund failed: pay.refund answered 503, which the contract does not declare (200, 404, 409, 401, 403)"
calls made and answered in this step:
  pay.refund {"id":8} → 503 (503, 503, 503)
```
**ts-1** see:
```
text pass = "Yoga, 10 classes: € 125.00"
field staffKey = "0.1"
button buy "Pay"
button refund "Refund"
text message = "Refund failed: pay.refund answered 503, which the contract does not declare (200, 401, 403, 404, 409)"
calls made and answered in this step:
  pay.refund {"id":8} → 503 (503, 503, 503)
```

(4 diverging sessions in total)

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
