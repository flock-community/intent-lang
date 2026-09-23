# Convergence report — v3-always

3 builds per target (elm, ts), 80 random sessions × 30 actions per app.

| App | Builds OK | First-try OK | `always` held | Same app: all | Elm | TS | Elm≡TS | Code sim. Elm / TS | Cost |
|---|---|---|---|---|---|---|---|---|---|
| Board | 6/6 | 6/6 | 0/6 | 100% | 100% | 100% | 100% | 44% / 38% | $0.49 |

*Same app* = share of random sessions in which every build showed identical screens after every action.

## Board

Builds: elm-1 ✓, elm-2 ✓, elm-3 ✓, ts-1 ✓, ts-2 ✓, ts-3 ✓

- **ts-3 breaks `always` (line 48) in 8 session(s):** expected at most 3 rows in `doing`, got 4

```
click finish on row 3 of doing
click finish on row 2 of doing
click reopen on row 1 of done
click back on row 2 of doing
click reopen on row 3 of done
click start on row 1 of todo
click add
click reopen on row 2 of done
```
- **ts-1 breaks `always` (line 48) in 8 session(s):** expected at most 3 rows in `doing`, got 4

```
click finish on row 3 of doing
click finish on row 2 of doing
click reopen on row 1 of done
click back on row 2 of doing
click reopen on row 3 of done
click start on row 1 of todo
click add
click reopen on row 2 of done
```
- **ts-2 breaks `always` (line 48) in 8 session(s):** expected at most 3 rows in `doing`, got 4

```
click finish on row 3 of doing
click finish on row 2 of doing
click reopen on row 1 of done
click back on row 2 of doing
click reopen on row 3 of done
click start on row 1 of todo
click add
click reopen on row 2 of done
```
- **elm-1 breaks `always` (line 48) in 8 session(s):** expected at most 3 rows in `doing`, got 4

```
click finish on row 3 of doing
click finish on row 2 of doing
click reopen on row 1 of done
click back on row 2 of doing
click reopen on row 3 of done
click start on row 1 of todo
click add
click reopen on row 2 of done
```
- **elm-3 breaks `always` (line 48) in 8 session(s):** expected at most 3 rows in `doing`, got 4

```
click finish on row 3 of doing
click finish on row 2 of doing
click reopen on row 1 of done
click back on row 2 of doing
click reopen on row 3 of done
click start on row 1 of todo
click add
click reopen on row 2 of done
```
- **elm-2 breaks `always` (line 48) in 8 session(s):** expected at most 3 rows in `doing`, got 4

```
click finish on row 3 of doing
click finish on row 2 of doing
click reopen on row 1 of done
click back on row 2 of doing
click reopen on row 3 of done
click start on row 1 of todo
click add
click reopen on row 2 of done
```

Agreement with the majority: elm-1 100%, elm-2 100%, elm-3 100%, ts-1 100%, ts-2 100%, ts-3 100%
