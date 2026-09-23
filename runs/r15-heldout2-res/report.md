# Convergence report — v12-heldout2-reservations

3 builds per target (elm, ts), 30 random sessions × 20 actions per app.

| App | Builds OK | First-try OK | `always` held | Same app: all | Elm | TS | Elm≡TS | Code sim. Elm / TS | Cost |
|---|---|---|---|---|---|---|---|---|---|
| Reservations | 6/6 | 6/6 | 6/6 | 0% | 0% | 100% | 0% | 45% / 54% | $4.10 |

*Same app* = share of random sessions in which every build showed identical screens after every action.

### Looks (styled builds)

| App | Page = logic | Pixels differ: Elm / TS / Elm↔TS | Local layout agrees: Elm / TS / Elm↔TS | Boxes within 8px (absolute) | Median box offset (px) |
|---|---|---|---|---|---|
| Reservations | 6/6 | 1.9% / 2.0% / 1.6% | 86% / 97% / 87% | 82% / 97% / 84% | 5 / 5 / 4 |

*Page = logic*: builds whose page showed exactly the logic's screen in every session. *Pixels differ*: average share of differing pixels between two builds' screenshots of the same state. *Local layout agrees*: share of elements whose position relative to their parent, and whose size, are within 8px, so one taller block counts once instead of shifting everything below it. *Boxes within 8px (absolute)*: the same on absolute page positions.

## Reservations

Builds: elm-1 ✓ (2 attempts), elm-2 ✓ (2 attempts), elm-3 ✓ (2 attempts), ts-1 ✓ (2 attempts), ts-2 ✓ (2 attempts), ts-3 ✓ (2 attempts)


Contact sheets: `r15-heldout2-res/reservations/sheets/`


Agreement with the majority: elm-1 0%, elm-2 100%, elm-3 0%, ts-1 100%, ts-2 100%, ts-3 100%

### Divergence in session 1 after 0 action(s)

```
```

**elm-1, elm-2, elm-3, ts-1, ts-2, ts-3** see:
```
section page
  heading "Tonight's service"
  section stats
    section coversStat
      text coversLabel = "Covers booked"
      text covers = "24"
    section countStat
      text countLabel = "Reservations"
      text reservationCount = "7"
    section arrivedStat
      text arrivedLabel = "Guests arrived"
      text arrivedCovers = "2"
  section bookForm
    section bookFields
      field guestName = ""
      field phoneNumber = ""
      field partyText = ""
      select slotChoice = 
    button book "Book table"
  section board
    section overview
      list reservationsShown (7 rows)
        row 1:
          text time = "18:00"
          text tableLabel = "Table 1"
          text guest = "Jansen"
          text phone = "06 1234 5602"
          text partyLabel = "2 guests"
          text status = "Arrived"
          button arrive "Mark arrived" (disabled)
          button cancel "Cancel"
        row 2:
          text time = "18:30"
          text tableLabel = "Table 4"
          text guest = "De Vries"
          text phone = "06 1234 5604"
          text partyLabel = "4 guests"
          text status = "Booked"
          button arrive "Mark arrived"
          button cancel "Cancel"
        row 3:
          text time = "19:00"
          text tableLabel = "Table 5"
          text guest = "Visser"
          text phone = "06 1234 5606"
          text partyLabel = "3 guests"
          text status = "Booked"
          button arrive "Mark arrived"
          button cancel "Cancel"
        row 4:
          text time = "19:00"
          text tableLabel = "Table 7"
          text guest = "Bakker"
          text phone = "06 1234 5603"
          text partyLabel = "6 guests"
          text status = "Booked"
          button arrive "Mark arrived"
          button cancel "Cancel"
        row 5:
          text time = "19:30"
          text tableLabel = "Table 1"
          text guest = "Smit"
          text phone = "06 1234 5605"
          text partyLabel = "2 guests"
          text status = "Booked"
          button arrive "Mark arrived"
          button cancel "Cancel"
        row 6:
          text time = "20:00"
          text tableLabel = "Table 7"
          text guest = "Mulder"
          text phone = "06 1234 5601"
          text partyLabel = "5 guests"
          text status = "Booked"
          button arrive "Mark arrived"
          button cancel "Cancel"
        row 7:
          text time = "20:30"
          text tableLabel = "Table 1"
          text guest = "Meijer"
          text phone = "06 1234 5607"
          text partyLabel = "2 guests"
          text status = "Booked"
          button arrive "Mark arrived"
          button cancel "Cancel"
    section availability
      list slotGrid (7 rows)
        row 1:
          text label = "18:00"
          text freeTables = "T2, T3, T4, T5, T6, T7, T8"
          text freeCount = "7 free"
        row 2:
          text label = "18:30"
          text freeTables = "T2, T3, T5, T6, T7, T8"
          text freeCount = "6 free"
        row 3:
          text label = "19:00"
          text freeTables = "T1, T2, T3, T6, T8"
          text freeCount = "5 free"
        row 4:
          text label = "19:30"
          text freeTables = "T2, T3, T4, T6, T8"
          text freeCount = "5 free"
        row 5:
          text label = "20:00"
          text freeTables = "T2, T3, T4, T5, T6, T8"
          text freeCount = "6 free"
        row 6:
          text label = "20:30"
          text freeTables = "T2, T3, T4, T5, T6, T8"
          text freeCount = "6 free"
        row 7:
          text label = "21:00"
          text freeTables = "T2, T3, T4, T5, T6, T7, T8"
          text freeCount = "7 free"
      text availabilityHint = "A new booking also needs its table free for the next slot."
```

(30 diverging sessions in total)
