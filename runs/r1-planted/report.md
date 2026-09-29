# Planted bugs — is the v1 measurement sound?

Language 1, 2026-09-28. One realistic bug per app, planted by hand in a **copy** of a verified build
from rounds A and B (`runs/r1-converge/`, `runs/r1-all/`), never in the build itself. Each mutant then
went through what a build goes through, with the harness's own code and no LLM: the randomness check,
the compile, every example, the `always` and change-rule hunt (40 sessions × 25 actions, as `intent
build` runs it), and converge's differential sessions against the unchanged build (40 × 25: half blind,
half guided on the good build). Access rules were checked with `intent mutate` (rule mutation), which
is the planted-bug check the access design asks for. The runner is `runs/r1-planted/plant.ts` (not
tracked, like every build output); each mutant and its output (`result*.txt`) are in its folder.

| # | App (build) | Covers | Planted bug | Examples | `always` / change-rule hunt | Differential sessions | Caught |
|---|---|---|---|---|---|---|---|
| 1 | `06-expenses` (elm-1) | examples, Elm | the remainder cents go to the **last** people instead of the first (`if i >= n - rest`) | 4/5: "remainder cents and settling up" fails (`-3.33` for `-3.34`) | — (no rule covers it) | 1/40 | yes |
| 2 | `07-shop` (ts-1) | `always` | `plus` in the cart no longer checks the stock (guard and button) | 7/8: "stock runs out" fails | 32/40 sessions break `left is at least 0` (shows `-1`) | 27/40 | yes |
| 3 | `31-frozen-approvals` (ts-1) | change rules | saving an edit no longer re-checks that the expense is still Pending (edit opened, expense approved meanwhile, then saved) | 9/10: "an edit of an expense approved in the meantime is dropped" fails on the change rule: `expense id 1 (status was Approved): amount 120.5 → 99 (at the event click save)` | 5/40 sessions break `an @Expense whose @status was @Approved never changes` | 0/40 | yes (example + hunt) |
| 4 | `api/expenses-api`, `api/desk-api`, `api/payouts-api`, `api/members-api` (ts-1) | access rules | `intent mutate`: every rule removed, and every rule's condition removed, one at a time | — | — | — | expenses 8/8 and desk 8/8 (with their screens), payouts 7/7, members 2/2: **0 surviving** |
| 5a | `api/invites-api` (ts-1) | random draws | the code drawn **without** `not among` (`draws.freeCode1([])`) | 5/6: "two invitations never share a code" fails on `no two @invites have the same @code` | 27/40 sessions break it | 33/40 | yes |
| 5b | `api/invites-api` (ts-1) | random draws | the code made with `Math.random` | 1/6 (each draw refuses: "an app does not make its own randomness") | — | 40/40 | yes: **rejected before it runs** (`ownRandomness`) |
| 5c | `36-table` (ts-1) | random draws | an off-by-one die (0–5: `draws.roll1() - 1`) | 4/6: "a double six" and "the dice are drawn in the order the steps say" fail | 27/40 sessions break `total is at least 2` | 40/40 | yes |
| 6 | `32-checklists` (elm-1) | lists inside rows, Elm | removing an item removes the item with that key from **every** task, not from its own (outer key ignored) | 6/7: "new ids count per task" fails | — | 13/40 | yes |
| 7 | `34-ref-navigation` (ts-1) | references | the open ticket's subject shows `""` instead of the fallback `"(removed)"` after the ticket is removed | 3/4: "the open ticket is removed" fails | — | 25/40 | yes |

**Every planted bug was caught, each by at least one check a build or converge runs.** Nine mutants
over eight apps (plus rule mutation on four apis), both targets (two in Elm), screens and services.

## Access rules in detail

`intent mutate` runs each api's examples, and the examples of the screens tested with it, against the
api with one rule removed (or its condition removed), and reports the mutants no example tells apart
(outputs in `runs/r1-planted/access/`, not tracked):

- `api/expenses-api` with `37-expenses-ui`: 8 mutants, 8 caught. **Without the screen, 3 survive**: the
  event rules (`an @Employee may hear @expenseDecided when its body's @submitter is the @caller`, that rule
  without its condition, and `a @Manager may hear every event`). Only a screen hears events, so only the
  screen's examples prove them: run `intent mutate` with `--screen` for an api with event rules.
- `api/desk-api` with `16-desk-ui`: 8 mutants, 8 caught (without the screen, the same 3 kinds of event
  rule survive).
- `api/payouts-api`: 7 mutants, 7 caught, including the amount condition and separation of duty.
- `api/members-api`: 2 mutants, 2 caught.

## What this says about the measurement

- Examples catch every bug that changes what an example shows; the hunt catches every bug that breaks a
  rule (`always`, change rules, a data sentence), also where no example looks (the shop's stock, the
  table's die); converge's differential sessions tell every mutant but one apart from the good build.
- The exception is the frozen-approvals mutant: 0 of 40 differential sessions. Its bug needs one order
  (open an edit, approve that expense, then save), which the example and the hunt (sessions that explore
  the mutant itself) find, but replays of sessions explored on the good build did not. That is what the
  hunt is for, and why a build is never accepted on converge's sessions alone.
- Harness-owned code (the nested-list helpers, `Draws`, `Fmt`, access enforcement) is where a model
  cannot plant these bugs by accident: the mutants above had to go around it (filter every task by hand,
  subtract from a draw, drop the `not among` list) — and were then caught.
