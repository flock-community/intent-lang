# Convergence report — v12-heldout2-library

3 builds per target (elm, ts), 30 random sessions × 20 actions per app.

| App | Builds OK | First-try OK | `always` held | Same app: all | Elm | TS | Elm≡TS | Code sim. Elm / TS | Cost |
|---|---|---|---|---|---|---|---|---|---|
| Library | 6/6 | 6/6 | 6/6 | 0% | 100% | 0% | 100% | 68% / 60% | $4.20 |

*Same app* = share of random sessions in which every build showed identical screens after every action.

### Looks (styled builds)

| App | Page = logic | Pixels differ: Elm / TS / Elm↔TS | Local layout agrees: Elm / TS / Elm↔TS | Boxes within 8px (absolute) | Median box offset (px) |
|---|---|---|---|---|---|
| Library | 6/6 | 1.0% / 0.8% / 0.9% | 59% / 56% / 63% | 59% / 53% / 62% | 14 / 13 / 12 |

*Page = logic*: builds whose page showed exactly the logic's screen in every session. *Pixels differ*: average share of differing pixels between two builds' screenshots of the same state. *Local layout agrees*: share of elements whose position relative to their parent, and whose size, are within 8px, so one taller block counts once instead of shifting everything below it. *Boxes within 8px (absolute)*: the same on absolute page positions.

## Library

Builds: elm-1 ✓ (2 attempts), elm-2 ✓ (2 attempts), elm-3 ✓ (2 attempts), ts-1 ✓ (2 attempts), ts-2 ✓ (2 attempts), ts-3 ✓ (2 attempts)


Contact sheets: `r15-heldout2/library/sheets/`


Agreement with the majority: elm-1 100%, elm-2 100%, elm-3 100%, ts-1 100%, ts-2 0%, ts-3 100%

### Divergence in session 1 after 0 action(s)

```
```

**elm-1, elm-2, elm-3, ts-1, ts-2, ts-3** see:
```
section top
  heading "Neighbourhood library"
  text todayLabel = "Day 20"
  button nextDay "Next day"
section stats
  section overdueStat
    text overdueLabel = "Overdue loans"
    text overdueValue = "0"
  section onLoanStat
    text onLoanLabel = "Books on loan"
    text onLoanValue = "6"
section desk
  section catalogue
    section catalogueBar
      text catalogueTitle = "Books"
      field search = ""
    list shown (5 rows)
      row 1:
        text title = "Beloved"
        text author = "Toni Morrison"
        text availability = "1 of 2 available"
      row 2:
        text title = "Dune"
        text author = "Frank Herbert"
        text availability = "1 of 2 available"
      row 3:
        text title = "Emma"
        text author = "Jane Austen"
        text availability = "0 of 1 available"
      row 4:
        text title = "Hamlet"
        text author = "William Shakespeare"
        text availability = "0 of 1 available"
      row 5:
        text title = "Jane Eyre"
        text author = "Charlotte Bronte"
        text availability = "2 of 2 available"
    section pager
      text pager.pageInfo = "Page 1 of 3"
      button pager.previous "Previous" (disabled)
      button pager.next "Next"
  section memberPanel
    text memberPanelTitle = "Member"
    select chosen = 
    section noMember
      text noMemberTitle = "No member picked"
      text noMemberHint = "Pick a member to see their loans and lend books."
```

(30 diverging sessions in total)
