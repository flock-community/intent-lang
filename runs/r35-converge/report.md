# Convergence report — v35

3 builds per target (elm, ts), 40 random sessions × 25 actions per app.

| App | Builds OK | First-try OK | `always` held | Same app: all | Elm | TS | Elm≡TS | Code sim. Elm / TS | Cost |
|---|---|---|---|---|---|---|---|---|---|
| Counter | 6/6 | 6/6 | 6/6 | 100% | 100% | 100% | 100% | 85% / 94% | $1.28 |
| Todo | 6/6 | 6/6 | 6/6 | 100% | 100% | 100% | 100% | 71% / 70% | $1.44 |
| Pomodoro | 6/6 | 6/6 | 6/6 | 100% | 100% | 100% | 100% | 97% / 86% | $1.40 |
| Wordle | 6/6 | 6/6 | 6/6 | 100% | 100% | 100% | 100% | 69% / 68% | $1.56 |
| Expenses | 6/6 | 6/6 | 6/6 | 100% | 100% | 100% | 100% | 31% / 41% | $1.95 |
| Shop | 6/6 | 6/6 | 6/6 | 100% | 100% | 100% | 100% | 51% / 54% | $1.72 |
| Calculator | 6/6 | 6/6 | 6/6 | 90% | 90% | 100% | 100% | 57% / 55% | $1.65 |
| Board | 6/6 | 6/6 | 6/6 | 100% | 100% | 100% | 100% | 45% / 51% | $1.51 |
| Crm | 6/6 | 6/6 | 6/6 | 100% | 100% | 100% | 100% | 62% / 50% | $2.41 |
| Habits | 6/6 | 6/6 | 6/6 | 100% | 100% | 100% | 100% | 60% / 66% | $1.69 |
| Library | 6/6 | 6/6 | 6/6 | 100% | 100% | 100% | 100% | 63% / 71% | $2.38 |
| Reservations | 6/6 | 6/6 | 6/6 | 100% | 100% | 100% | 100% | 54% / 48% | $2.47 |

*Same app* = share of random sessions in which every build showed identical screens after every action.

## Counter

Builds: elm-1 ✓, elm-2 ✓, elm-3 ✓, ts-1 ✓, ts-2 ✓, ts-3 ✓


Agreement with the majority: elm-1 100%, elm-2 100%, elm-3 100%, ts-1 100%, ts-2 100%, ts-3 100%

## Todo

Builds: elm-1 ✓, elm-2 ✓, elm-3 ✓, ts-1 ✓, ts-2 ✓, ts-3 ✓


Agreement with the majority: elm-1 100%, elm-2 100%, elm-3 100%, ts-1 100%, ts-2 100%, ts-3 100%

## Pomodoro

Builds: elm-1 ✓, elm-2 ✓, elm-3 ✓, ts-1 ✓, ts-2 ✓, ts-3 ✓


Agreement with the majority: elm-1 100%, elm-2 100%, elm-3 100%, ts-1 100%, ts-2 100%, ts-3 100%

## Wordle

Builds: elm-1 ✓, elm-2 ✓, elm-3 ✓, ts-1 ✓, ts-2 ✓, ts-3 ✓


Agreement with the majority: elm-1 100%, elm-2 100%, elm-3 100%, ts-1 100%, ts-2 100%, ts-3 100%

## Expenses

Builds: elm-1 ✓, elm-2 ✓, elm-3 ✓, ts-1 ✓, ts-2 ✓, ts-3 ✓


Agreement with the majority: elm-1 100%, elm-2 100%, elm-3 100%, ts-1 100%, ts-2 100%, ts-3 100%

## Shop

Builds: elm-1 ✓, elm-2 ✓, elm-3 ✓, ts-1 ✓, ts-2 ✓, ts-3 ✓


Agreement with the majority: elm-1 100%, elm-2 100%, elm-3 100%, ts-1 100%, ts-2 100%, ts-3 100%

## Calculator

Builds: elm-1 ✓, elm-2 ✓, elm-3 ✓, ts-1 ✓, ts-2 ✓, ts-3 ✓


Agreement with the majority: elm-1 100%, elm-2 100%, elm-3 90%, ts-1 100%, ts-2 100%, ts-3 100%

### Divergence in session 22 after 15 action(s)

```
  click press on row 1 of keys
  click press on row 13 of keys
  click press on row 14 of keys
  click press on row 12 of keys
  click press on row 12 of keys
  click press on row 5 of keys
  click press on row 2 of keys
→ click press on row 12 of keys
```

**elm-1, elm-2, ts-1, ts-2, ts-3** see:
```
text display = "822"
list keys (16 rows)
  row 1:
    button press "7"
  row 2:
    button press "8"
  row 3:
    button press "9"
  row 4:
    button press "÷"
  row 5:
    button press "4"
  row 6:
    button press "5"
  row 7:
    button press "6"
  row 8:
    button press "×"
  row 9:
    button press "1"
  row 10:
    button press "2"
  row 11:
    button press "3"
  row 12:
    button press "−"
  row 13:
    button press "0"
  row 14:
    button press "."
  row 15:
    button press "="
  row 16:
    button press "+"
button clear "C"
```
**elm-3** see:
```
text display = "-48"
list keys (16 rows)
  row 1:
    button press "7"
  row 2:
    button press "8"
  row 3:
    button press "9"
  row 4:
    button press "÷"
  row 5:
    button press "4"
  row 6:
    button press "5"
  row 7:
    button press "6"
  row 8:
    button press "×"
  row 9:
    button press "1"
  row 10:
    button press "2"
  row 11:
    button press "3"
  row 12:
    button press "−"
  row 13:
    button press "0"
  row 14:
    button press "."
  row 15:
    button press "="
  row 16:
    button press "+"
button clear "C"
```

### Divergence in session 25 after 15 action(s)

```
  click press on row 8 of keys
  click press on row 2 of keys
  click press on row 16 of keys
  click press on row 5 of keys
  click press on row 11 of keys
  click press on row 6 of keys
  click press on row 14 of keys
→ click press on row 16 of keys
```

**elm-1, elm-2, ts-1, ts-2, ts-3** see:
```
text display = "-25309"
list keys (16 rows)
  row 1:
    button press "7"
  row 2:
    button press "8"
  row 3:
    button press "9"
  row 4:
    button press "÷"
  row 5:
    button press "4"
  row 6:
    button press "5"
  row 7:
    button press "6"
  row 8:
    button press "×"
  row 9:
    button press "1"
  row 10:
    button press "2"
  row 11:
    button press "3"
  row 12:
    button press "−"
  row 13:
    button press "0"
  row 14:
    button press "."
  row 15:
    button press "="
  row 16:
    button press "+"
button clear "C"
```
**elm-3** see:
```
text display = "-25744"
list keys (16 rows)
  row 1:
    button press "7"
  row 2:
    button press "8"
  row 3:
    button press "9"
  row 4:
    button press "÷"
  row 5:
    button press "4"
  row 6:
    button press "5"
  row 7:
    button press "6"
  row 8:
    button press "×"
  row 9:
    button press "1"
  row 10:
    button press "2"
  row 11:
    button press "3"
  row 12:
    button press "−"
  row 13:
    button press "0"
  row 14:
    button press "."
  row 15:
    button press "="
  row 16:
    button press "+"
button clear "C"
```

### Divergence in session 38 after 19 action(s)

```
  click press on row 16 of keys
  click clear
  click press on row 6 of keys
  click press on row 7 of keys
  click press on row 14 of keys
  click press on row 16 of keys
  click press on row 3 of keys
→ click press on row 4 of keys
```

**elm-1, elm-2, ts-1, ts-2, ts-3** see:
```
text display = "65"
list keys (16 rows)
  row 1:
    button press "7"
  row 2:
    button press "8"
  row 3:
    button press "9"
  row 4:
    button press "÷"
  row 5:
    button press "4"
  row 6:
    button press "5"
  row 7:
    button press "6"
  row 8:
    button press "×"
  row 9:
    button press "1"
  row 10:
    button press "2"
  row 11:
    button press "3"
  row 12:
    button press "−"
  row 13:
    button press "0"
  row 14:
    button press "."
  row 15:
    button press "="
  row 16:
    button press "+"
button clear "C"
```
**elm-3** see:
```
text display = "9"
list keys (16 rows)
  row 1:
    button press "7"
  row 2:
    button press "8"
  row 3:
    button press "9"
  row 4:
    button press "÷"
  row 5:
    button press "4"
  row 6:
    button press "5"
  row 7:
    button press "6"
  row 8:
    button press "×"
  row 9:
    button press "1"
  row 10:
    button press "2"
  row 11:
    button press "3"
  row 12:
    button press "−"
  row 13:
    button press "0"
  row 14:
    button press "."
  row 15:
    button press "="
  row 16:
    button press "+"
button clear "C"
```

(4 diverging sessions in total)

## Board

Builds: elm-1 ✓, elm-2 ✓, elm-3 ✓, ts-1 ✓, ts-2 ✓, ts-3 ✓


Agreement with the majority: elm-1 100%, elm-2 100%, elm-3 100%, ts-1 100%, ts-2 100%, ts-3 100%

## Crm

Builds: elm-1 ✓, elm-2 ✓, elm-3 ✓, ts-1 ✓, ts-2 ✓, ts-3 ✓


Agreement with the majority: elm-1 100%, elm-2 100%, elm-3 100%, ts-1 100%, ts-2 100%, ts-3 100%

## Habits

Builds: elm-1 ✓, elm-2 ✓, elm-3 ✓, ts-1 ✓, ts-2 ✓, ts-3 ✓


Agreement with the majority: elm-1 100%, elm-2 100%, elm-3 100%, ts-1 100%, ts-2 100%, ts-3 100%

## Library

Builds: elm-1 ✓, elm-2 ✓, elm-3 ✓, ts-1 ✓, ts-2 ✓, ts-3 ✓


Agreement with the majority: elm-1 100%, elm-2 100%, elm-3 100%, ts-1 100%, ts-2 100%, ts-3 100%

## Reservations

Builds: elm-1 ✓, elm-2 ✓, elm-3 ✓, ts-1 ✓, ts-2 ✓, ts-3 ✓


Agreement with the majority: elm-1 100%, elm-2 100%, elm-3 100%, ts-1 100%, ts-2 100%, ts-3 100%
