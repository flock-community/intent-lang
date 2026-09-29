# Intent — language reference (1)

Intent describes **what an interactive app must be**: its data, what is on screen, what
happens when the user acts, and examples that prove it. A compiler (an LLM held in place
by a harness) turns it into an app. The spec is the source; code is a disposable
derivative that must be rebuildable at any moment and behave the same every time.


## 1. Principles

1. **What, never how.** No functions, loops or code. Behaviour is short sentences; exactness
   comes from declared names, templates and examples.
2. **The screen is the contract.** Everything observable is a named element on `screen`.
   Two builds are "the same app" when every sequence of user actions produces the same
   screens.
3. **Examples are proof.** Behaviour that matters has an `example`. Every build must pass
   every example before it is accepted.
4. **Closed vocabulary.** Element kinds, event verbs and example steps are fixed. Unknown
   words are errors, never guesses.
5. **Silence has a default.** Where a spec says nothing, §9 decides — not the compiler.

## 2. Files and lexical rules

- One app per `.intent` file. UTF‑8.
- **Blocks:** a line that ends with `{` opens a block; `}` on a line of its own closes it. Inside
  a block, indent 2 spaces per level. Tabs are an error.

  ```intent-excerpt
  screen {
    button add "Add" {
      enabled when @draft is not blank
    }
  }
  ```

  A file without braces is read by its indentation alone.
- **References:** in a sentence (a step, a condition, a derived value, a rule, an endpoint's or
  a layer's steps), a name from the spec is written with `@`: `@draft`, `@Item`, `@Open`,
  `@pager.visible`, `@tickets.createTicket`. Everything else in the sentence is prose.

  ```intent-excerpt
  on click add {
    if no item in @items has the same @title as @draft {
      - add an @Item with @title = @draft trimmed to the end of @items
    }
  }
  ```

  Declarations and fixed places need no `@`: `button add`, `on click add`, `click add`,
  `see count = 2`, bindings (`items = sorted`). In a template string, a hole holds a lone name
  (`"Page {page} of {pageCount}"`) or a phrase with references (`"{number of @items not @done} left"`).
  The checker reports an `@name` that is not declared, and hints (`UNMARKED`) when a sentence
  uses a declared name without `@`: mark it if you mean it, or reword if you mean the English word.

  **References fit where they are used.** The English between references is free, but the
  phrases the language knows relate two references, and the checker holds each pair to its types
  (`TYPE`, or `UNKNOWN_NAME` for a missing field):

  | Phrase | Must hold |
  |---|---|
  | `set @x to @y` / `set @x to @Value` | `@y` is a value `@x` can hold (an Int fits a Decimal, a T fits a `T or nothing`) |
  | `increase` / `decrease @x by …` | `@x` is a number |
  | `@x is @Value`, `whose @field is @Value` | the value belongs to `@x`'s choice |
  | `@a's @b`, `the @b of the ticket`, `its body's @b` | `b` is a field of that record (of the answer's or event's body; of the row a `ref` points at) |
  | `add @y to (the end of) @xs` | `@y` fits the items of `@xs` |
  | `add a @Ticket … with @f = @y, @g @Value, the given @h` | each is a field of Ticket, and each value fits it; the list holds Tickets |
  | `call @api.endpoint with @p = @y` | `p` is a param of the endpoint, and `@y` fits it |
  | `@x is @y` / `@x is above @y` (below, at least, at most, after, before, …) | comparable types; an order needs numbers or moments |
  | `the ticket whose @f is @y` / `the @tickets whose …` | `f` is a field of Ticket, and `@y` fits it |

  **Relations are checked as relations.** A `ref Ticket` holds a Ticket's key and fits nothing
  else: it is compared with a Ticket's key (`@comment's @ticket is @id`), never with another
  record's key or another record's reference; it is followed to the row it points at
  (`@comment's @ticket's @subject`, §3), which may be gone; and a seeded row's reference must point
  at a seeded row (`comments` row 2 holding ticket 9 when no ticket 9 is seeded is an error).

  **The common operators have types.** A value built with them is typed whole, and a wrong operand
  is an error before any build:

  | Form | Takes | Gives |
  |---|---|---|
  | `@a plus / minus / times @b`, `+ - × *` | numbers | a number (Decimal when either is) |
  | `@a divided by @b`, `/` | numbers | a Decimal (`, rounded down` makes it whole) |
  | `@x trimmed`, `@x in capitals` | text | text |
  | `@x read as a whole number / a decimal` | text | the number; ask first with `@x reads as a decimal (above 0)`, a condition |
  | `@x, rounded (to cents / down / up)` | a number | the number, whole when down/up |
  | `@x as money / a date / a clock` | a number or a moment | text (money: two decimals, no currency sign; write `"€ {@x as money}"`) |
  | `the minutes between @a and @b`, `the hours between …` | two moments (DateTime) | an Int (§3b) |
  | `the days between @a and @b` | two days (Date) | an Int (§3b) |
  | `3 days after @today`, `@n hours before @now` (minutes, hours, days, weeks) | a whole number, and a day or a moment (minutes and hours: a moment) | the same kind: a day or a moment (§3b) |
  | `@xs sorted by @due, earliest first, then by @id` | a list of records; fields of its rows | the same list, in that order (§9.19) |
  | `the number of @xs`, `there are 3 @xs` | a list | an Int / a condition |
  | `the sum of @xs's @f`, `the sum of @f over @xs`, `the sum of the @f of @xs` | a list of records with a number field | that number |
  | `the sum of @qty times @price over @xs` | a list of records; a number computed in each row | that number |
  | `@xs's @ys` (a list field of each row) | a list of records | one list: every row's items, in order (a join) |
  | `the highest / lowest @f in @xs` | a list of records | the field's type, or nothing (the list may be empty) |
  | `@x is empty / blank`, `@x contains @y` | text or a list | a condition |
  | `@x exists`, `@x does not exist` | a reference (`@comment's @ticket`) | a condition: whether the row it points at is there |
  | `@x is a valid @Email` | the refined type's base | a condition |
  | `A when C; B when D`, `A when C, otherwise B` | values of one type (in a template: anything shown); every case is said: an `otherwise`, or conditions that name every value of one choice (`… when @f is @A; … when @f is @B`) | that type |
  | `A, or B when there is none` | A of type `T` or `T or nothing`, B a `T` | a `T` (a `T or nothing` when B is nothing) |
  | `a random @T` | `T` lists its values: a choice, an `Int from a to b`, a code (`Text of 6 digits`, §3a) | a `T`, drawn (§3c) |
  | `a random @T not among @xs` | as above, and a list of `T` (`the @code of @waiting`) | a `T or nothing` (a `T` when `T` has 2^64 values or more) |
  | `3 random @T`, `@n random @T` | a whole number | a `List T` (the values may repeat) |
  | `a random one of @xs` | a list | an item, or nothing (the list may be empty) |
  | `@xs shuffled` | a list | the same items in a random order |
  | `the first 5 of @xs` | a list | a list of at most that many (`the first 5 of @deck shuffled`: five of the shuffled deck) |
  | `its body`, `its body's @f`, `the error`, `its @f`, `that ticket's @f` | an answer, an event, a row | its type |

  Everything else between references is English, left to judgement (and to the examples that prove
  it).

  A derived value has the type its form gives (`the number of …` is an Int, `the @tickets whose …` a
  list of tickets, `the ticket whose …` a ticket or nothing) or the one it declares (`total: Decimal
  = …`, checked against its form); when neither is known and it is used where its type matters, the
  checker hints (`UNTYPED`) to declare it. A reference followed by more words that compute
  (`@count plus 1`, `@draft, trimmed`) is left alone: this check never guesses — except about
  nothing, below.

  **Nothing is handled before it is used** (Kotlin's null safety). A `T or nothing` is not a `T`.
  It comes from a field or state declared so, a lookup (`the ticket whose …`), `the highest / lowest
  …` of a list, and a read through a reference (`@comment's @ticket's @subject`, §3). Where a `T` is
  needed — a number to add, an order (`is above`, also on a row's field in a filter: `whose @due is
  before @today`), text to trim or show (a template's hole, an element's value), a list to count or
  walk, a field or state of type `T`, `increase … by` — a value
  that may be nothing is an error (`NOTHING`), until the sentence handles it, in one of these ways
  only (there is no forced unwrap):

  - **the fallback**: `…, or B when there is none`: B is what the value is then, and must be a `T`;
    under it, nothing propagates through the whole value before it (`@a plus @b's @n, or 0 when
    there is none`). `…, or nothing when there is none` keeps it a `T or nothing`, which fits only
    a `T or nothing`.
  - **a smart cast**: a condition that asks, `there is a @x` or `there is no @x`, makes it a `T`
    where it holds (a field of the row a sentence is in is named alone: `visible when there is a
    @due` in a list row, `the @items whose there is a @due and @due is before @today`) — inside `if there is a @x { … }`, after `if there is no @x { stop }` (or
    `answer`), in the `else` of `if there is no @x`, in the rest of `there is a @x and …`, in the
    other alternative of `A when there is a @x, otherwise B`, and in an element (and the elements
    inside it) that is `visible when there is a @x`: it is only shown then. A cast from `visible
    when` reaches values shown inside the element, never the handlers of its buttons. `@x exists` /
    `does not exist` do the same for the row a reference points at, which is then "that ticket"
    (§3), and `if that ticket does not exist { answer 404 "…" }` for the row an endpoint's request
    names (§4f); `if there is no locker in @empty whose … { stop }` does it for `the lowest … of the
    @empty whose …`. A smart cast ends at the first step that may change what it is about (`set
    @x`, `clear @x`, `add`/`remove` on its list, any step for a list asked about): the value may be
    nothing again.
  - **assigning** it to a `T or nothing` (`set @chosen to the ticket whose …`).

  `nothing` is a value, never a question: `set @x to nothing`, `from nothing to @A` in a change
  rule, `see x = nothing` in an example. Equality needs none of the above: `@x is "a"` is false when
  `@x` is nothing and `@x is not "a"` is true (Kotlin's `==`; the one exception is an access
  condition, §4f), and a row's field in a lookup is compared with the value (`the @tickets whose
  @assignee is nothing`). A derived value may itself be a `T or nothing`; it is handled where it is
  used. A sentence the checker cannot type whole is held to the same rule: when it reads a value that
  may be nothing, a lookup or a reference's row, and neither says what then nor sits under a smart
  cast, it is a `NOTHING` error.
- `#` starts a comment (outside strings). Blank lines are ignored.
- Names: element, field and state names are `lowerCamel`; app, record and choice names and
  choice values are `UpperCamel`. Records, choices, refined types and choice values share one
  namespace, so `@Member` names one thing: a choice value named like a type is `DUPLICATE`.
- Strings: `"…"` with `\"`, `\\`, `\n` (a new line) and `\t` (a tab) escapes. Inside a template string `{…}` is a hole.
- Numbers: `12`, `-3`, `2.50`. Durations: `250ms`, `1s`, `2m`, `1h`, `1d`.

## 3. Blocks

A file is a sequence of top-level blocks, in any order:

```
app Name { "purpose" }      # first line of an app; its block holds the purpose (strings)
bundle std.name             # first line of a library file instead (§4d)
import std.list             # reuse a bundle (§4d)
extends support.helpdesk    # refine a published app (§4e): override, add to, drop
record Name { … }           # a data shape: `field: Type [= default]` lines
choice Name: A | B "Bee" | C  # a closed set of values; an optional "label" is what users see
choice Level: Info = "info" | Urgent = "urgent"   # a wire name: how the value is written in JSON (§4h)
type Email = Text matching /…/  # a refined type: a base type with one precise rule (§3a)
design                      # optional: how the app looks (§4c)
component Name "look"       # optional: a reusable look for sections/elements (§4c)
state { … }                 # what the app remembers: `[stored] field: Type = default` lines
clock every 1s              # optional: the app receives a tick every interval
derive { … }                # named values computed from state: `name = sentence`, or `name: Type = sentence` (its type, checked)
screen { … }                # what the user sees, top to bottom (§4)
screen name "/path" { … }   # or several screens, each with its address (§4a)
layer auth = std.http.apiKey { … }   # an api runs behind a layer (§4j), its params bound in the block
on <verb> <element> { … }   # what happens (§5): `- sentence` lines
rules { … }                 # guidance in words: `- sentence` lines; `rules by ai { … }` for rules an LLM wrote
always { … }                # what must always hold, checked after every step: `see` steps (the screen) and `- sentence` lines (the data, also before and after a step)
example "name" { … }        # proof (§6): steps
```

Types: `Text`, `Int`, `Decimal`, `Bool`, `Date`, `DateTime`, `List T`, `T or nothing`, a
record name, a choice name, and `ref X` — a field holding record `X`'s key (see the next
paragraph). `T or nothing` is a value that may be absent, and works like Kotlin's `T?`: nothing
is what other languages call null or none. Say so instead of using a stand-in such as `0` or `""`
(`selected: Int or nothing = nothing`, then `visible when there is a @selected` and `set @selected
to nothing`). A `T or nothing` is not a `T`: wherever a sentence needs a `T`, it says what happens
when there is none (the rules are in §2). On the wire nothing is `null` (§9.18).
Literals of the time types: `2026-09-24` (a Date) and `2026-09-24 09:00`
(a DateTime, to the minute, in the app's own local time). In JSON a Date is `"2026-09-24"` and a
DateTime `"2026-09-24T09:00"`; an example compares them as written in the spec
(`see deposit.body.expiresAt = 2026-09-27 09:00`).

**A reference is declared, not left in a comment.** `ticket: ref Ticket` says the field holds a
`Ticket`'s key. A record's key is the field marked `key` (`key code: Text`), or else its field named
`id`; the order of the fields never matters. A key is an `Int` or a `Text` (or a refined type of
one) and is always there. The checker resolves and types the reference, so a seeded row must hold a
key of the right type, and a record with no key cannot be referenced (`NO_KEY`).

```intent-excerpt
record Ticket {
  id: Int                   # the key: the field named `id`
  subject: Text
}

record Comment {
  ticket: ref Ticket        # holds a Ticket's id
  body: Text
}
```

A reference that may be absent is `ref Person or nothing` (nothing: it points at no row; following it
gives nothing, as for a row that is gone).

The field holds the key, not the row. **Following it** reads the row it points at, in the record's
**home list**: the one state field of type `List Ticket` (not a derived value, not a component's).
When the app has none or several, the field names it — `ticket: ref Ticket in tickets` — else
following it is an error (`HOME`); holding and comparing the key needs no home. The home's key is
unique: the checker checks the seeded rows (`DUPLICATE`), the harness every step.

- `@comment's @ticket` is the key (compared with a Ticket's key, stored as it is); a following
  `'s @field` reads the row: `@comment's @ticket's @subject`, `its @ticket's @subject`,
  `that comment's @ticket's @status`, `the @subject of @comment's @ticket`, several hops
  (`@book's @author's @country's @name`). Each `'s` is a safe call (Kotlin's `?.`): the row may
  have been removed since, so the value is a `T or nothing`, and one `…, or X when there
  is none` at the end covers every hop: `its @ticket's @subject, or "(removed)" when there is none`.
  A chain that starts from a `T or nothing` (`@chosen's @subject`) is one too.
- In a condition it is compared as any `T or nothing` (§9.12): `the @comments whose @ticket's
  @status is @Open` leaves out the comments whose ticket is gone.
- `@x exists` / `@x does not exist` asks whether the row behind a reference is there (a reference is
  never nothing; its row may be). Inside `if that comment's @ticket exists { … }`, and after
  `if that comment's @ticket does not exist { stop }`, the row is there: "that ticket" names it, and
  reads through it need no fallback. `there is a @x` is for a `T or nothing`; each is refused in
  the other's place (`TYPE`).
- A write through a reference (`set`, `increase`, `add … to`, `remove … from`) needs the row: only
  where it is known to be there, else `NAV_WRITE`: `if that comment's @ticket does not exist { stop }`,
  then `- set the @status of that ticket to @Closed`.
- Through a list, a chain flattens and drops the missing: `@comments's @ticket's @subject` is the
  subjects of the tickets the comments point at that are there, in the comments' order.

Reading a reference's own row is following it: `the @subject of the ticket whose @id is
@c's @ticket` is written `@c's @ticket's @subject` (`SPELLING`). A lookup
stays the form for everything else (by another field, in another list). Removing a row does not
remove the rows that refer to it (§9.12). A lookup's `@` names the list or derived value it looks
in, and the checker requires it (a typo is `UNKNOWN_NAME`).
Every `state` field needs a default. Literals: `"text"`, numbers, `true`/`false`, `[]`,
`nothing`, choice values.

**Stored state.** A field marked `stored` survives a restart; every other field starts from its
default each time the app starts. Mark what the user would be upset to lose (their habits, their
tickets), not what belongs to one visit (a draft, a filter, an open drawer):

```intent-excerpt
state {
  stored habits: List Habit = []
  draft: Text = ""
}
```

The harness keeps stored fields: a screen in the browser's local storage, an api in a data file
on the server. The spec's default is used the first time.
Stored fields are restored before `on start` runs; `on start` sees what the app remembered (§9.20).
When the app's records change, the kept data is **migrated** to the new types rather than reset: a
removed field is dropped, a new `T or nothing` field becomes nothing, a new list an empty list;
only a stored field that cannot be migrated at all keeps its default, and the rest is still read.
In examples, `restart` starts the app again (§6), and random sessions restart now and then; after
every restart the harness checks that the stored fields came back exactly as they were. Stored
fields live in the app's own state, not in a component's.

Seed data for a `List <Record>` is written as a table. Columns are record fields; omitted
fields take the record's defaults:

```intent-excerpt
state {
  products: List Product = table {
    name      | price | stock
    "Apple"   | 0.40  | 10
    "Bread"   | 2.35  | 3
  }
}
```

A cell holds one value, a list of plain values for a `List Text` (or `Int`, …) field (`["Ann",
"Ben"]`, `[]`), or the row's inner list (below): `[{ id = 1, label = "Milk" }, …]`, each
record with the inner record's fields (omitted ones take their defaults), `[]` for none, and no two
with one key in a row (`DUPLICATE`).

**A list inside a record: parts a row owns.** A record may hold a list of another record: a task's
checklist items, an order's lines, a recipe's ingredients. Use it for parts that are **owned**:
created, shown and removed only through their row, and gone when it is removed. Things that live on
their own or are shared (a ticket's comments, a book's author) are a list of their own with a `ref`
back. An inner record's key is unique **within its row** (two orders may both have line 1): a row
inside a row is named by the path of keys, its row's and its own. The inner record may hold a list
of plain values (`tags: List Text`) but not a list of records again (a third level is `NOT_YET`),
and a record never holds a list of its own kind (a tree).

```intent-excerpt
record Item {
  id: Int
  label: Text
  done: Bool = false
}

record Task {
  id: Int
  title: Text
  items: List Item = []
  newItem: Text = ""        # what is typed into this task's "New item" field
}

state {
  stored tasks: List Task = table {
    id | title       | items
    1  | "Groceries" | [{ id = 1, label = "Milk" }, { id = 2, label = "Eggs", done = true }]
    2  | "Taxes"     | []
  }
}
```

A chain through two lists **flattens**, as a join does: `@tasks's @items` is every item of every
task, in order (a `List Item`, not a list of lists), so `the number of @tasks's @items whose @done is
false` is a number. A sentence that wants one row's items says `its @items` in that row, or `that
task's @items`. Removing a row removes the rows inside it; a draft that belongs to one row (a text
typed into a field in that row) is a field of the row's record, as above.

## 3a. Refined types

A refined type is a base type with one precise rule. It is defined once, and every build checks
it the same way:

```intent-excerpt
type Email = Text matching /[^@\s]+@[^@\s]+\.[^@\s]+/    # the whole text must match
type Age = Int from 0 to 150                              # inclusive
type Price = Decimal from 0
type Title = Text of length 1 to 80                       # characters; also `at most 80`, `at least 1`
type PickupCode = Text of 6 digits                        # a code: exactly 6 characters of an alphabet
```

- Use it like any type: `mail: Email`, `body email: Email`, `List Email`.
- A text's length counts characters (an emoji is one), the same on every target.
- In sentences, "is a valid Email" means exactly the rule. The harness generates the check for
  every target, and builds never write their own.
- The checker checks seed data, defaults and literals against the rule before any build.
- An api answers a value that breaks the rule with `400 {"error": "<name> must be a valid Email"}`.
  A contract that answers a refined type is checked against it too.
- Common ones are in bundles: `import std.text` gives `Email`, and `Token` (`Text of 32 hex digits`,
  a secret of 128 bits).

**Codes.** `Text of <n> <alphabet>` is a text of exactly n characters from an alphabet. Its values
are listed, so a value can be drawn from it (§3c). The alphabets are a closed set:

| Alphabet | Characters | Bits per character |
|---|---|---|
| `digits` | `0`–`9` | 3.32 |
| `hex digits` | `0`–`9`, `a`–`f` | 4 |
| `capitals and digits` | `A`–`Z`, `0`–`9` | 5.17 |
| `letters and digits` | `A`–`Z`, `a`–`z`, `0`–`9` | 5.95 |
| `unambiguous letters and digits` | 32: `0`–`9` and `A`–`Z` without `I`, `L`, `O`, `U` (Crockford's) | 5 |
| `from "…"` | the characters given, each once, at least two | log2 of how many |

A code of n characters from k has k^n values: `Text of 6 digits` has 1,000,000 (19.9 bits), `Text
of 8 unambiguous letters and digits` 32^8 (40 bits). An `unambiguous` code is made in capitals and
read forgivingly as input (a request's param, a field checked with `is a valid`): lower case is
accepted, `o` and `O` are read as `0`, `i`, `I`, `l` and `L` as `1`, and hyphens are ignored, so
`"k7mq-or1z"` typed by a person is the code `"K7MQ0R1Z"`. Every other alphabet is read exactly: a
code that must avoid 0, O, 1, I and L altogether lists its characters, `Text of 6 from
"23456789ABCDEFGHJKMNPQRSTUVWXYZ"`.
The value an app keeps is the normal form: the harness reads a text as the code it is, or nothing,
next to the check. Literals (seed data, defaults, examples) are written in the normal form.

## 3b. Time

A spec reads the clock with `@today` (a Date) and `@now` (a DateTime), in any sentence:

```intent-excerpt
button done "Done today" {
  enabled when this habit has no @Done on @today
}
text date = "{the weekday of @today} {@today as a date}"
```

- Dates and moments compare and sort as you would expect ("before", "after", "the latest").
  "the weekday of", "as a date" ("4 Sep 2026") and "as a moment" ("4 Sep 2026 09:05") are computed
  the same in every target. Time moves and is measured in words, typed whole:

  | Form | Takes | Gives |
  |---|---|---|
  | `3 minutes after @now`, `@n hours before @now` | a whole number and a moment | a moment |
  | `14 days after @today`, `2 weeks before @due` | a whole number and a day (or a moment) | a day (a moment) |
  | `the day after @today`, `the day before @today` | a day | a day |
  | `the minutes between @a and @b`, `the hours between @a and @b` | two moments | an Int: whole minutes / hours from `@a` to `@b`, counted toward zero (the hours between 09:00 and 10:59 are 1), negative when `@b` comes first |
  | `the days between @a and @b` | two days | an Int: calendar days from `@a` to `@b` |

  The units are minutes, hours, days and weeks (7 days); a day has 24 hours (a moment is local time,
  without daylight saving). Months and years are not units: their length varies, so say the days.
  Minutes and hours move a moment, not a day (`2 hours after @today` is a `TYPE` error), and the days
  between two moments are said as hours or minutes. A value that may be nothing is handled first (§2):
  `the hours between @now and that booking's @start is below 24` reads the hours, not the start.
- **In tests the clock is the harness's.** Every example and random session starts at the same
  moment: `examples start at 2026-09-24 09:00` (a top-level line; without it, Monday 2026-01-05
  09:00). `wait 1d`, `wait 2h`, `wait 15m` move the clock on and show the screen again. With a
  `clock every …` tick, `wait` also ticks that often. Random sessions mix in waits too.
- In the browser and on the server, the clock is the local time.

**The size a host shows the app at.** A widget that a host shows small or large declares its sizes,
smallest first, as choice values: `sizes Compact | Standard` (a top-level line). The app reads
`@size`, a value of the choice `Size` the line declares (`@Compact`, `@Standard`), like it reads the
clock, and never stores it:

```intent-excerpt
sizes Compact | Standard

screen {
  list notes of Note {
    visible when @size is @Standard
    text body
  }
}
```

- The host picks the size, in any case: `globalThis.__intentSize = "standard"` (then an
  `intentsize` event on `window`), or `?size=standard` in the address; otherwise it is the first size.
- In tests every example starts at the first size; the step `size Standard` shows the app at another
  size, and random sessions switch sizes too, so both are compared.

**Recurring work** (apis): `every 15m { - … }` runs its steps on that interval, reading
`@now`. On the server it runs on a timer; in tests, whenever a `wait` moves the clock past its
next time (counted from the start), in order, before the next step.

## 3c. Chance

A random value is drawn from a **type that lists its values**: a choice, an `Int from a to b`
(both bounds, at most 2^32 values), or a code (`Text of 6 digits`, §3a). The type is the space, and
every draw is uniform over it:

```intent-excerpt
type Die = Int from 1 to 6
type PickupCode = Text of 6 digits

on click roll {
  - set @first to a random @Die
  - set @second to a random @Die          # two draws: two values
}

on click deal {
  - set @hand to the first 5 of @deck shuffled
}
```

| Form | Gives |
|---|---|
| `a random @T` | a `T` |
| `a random @T not among @xs` | a `T` that is not in the list; a `T or nothing` when `T` has fewer than 2^64 values (it can run out), so the sentence says what then |
| `3 random @T` | a `List T` of independent values (they may repeat); drawing without repeats is a shuffle: `the first 6 of @balls shuffled` |
| `a random one of @xs` | an item, or nothing for an empty list |
| `@xs shuffled` | the same items in a random order |

- **Each draw is one value.** A draw in a step gives a new value each time the step runs (each row,
  in a `for each`). To use a value twice, keep it and refer to it: `add an @ApiKey … with @secret =
  a random @Token`, then `answer 201 with … the new api key's @secret`. A derived value that draws
  (an api's `freeCode = a random @PickupCode not among the @code of @waiting`) is drawn once per
  event (a request, a click, a tick, a run of recurring work) and keeps that value for the whole
  event: every sentence that reads it in that event gets the same value, also after what it
  excludes has changed. The next event draws again.
- **Uniqueness is asked for, never assumed.** `not among` excludes the values given. A record's key
  filled from a draw says `not among` unless its type has 128 bits or more:

  ```intent-excerpt
  derive {
    freeCode = a random @PickupCode not among the @code of @waiting
  }

  endpoint deposit {
    if there is no @freeCode {
      answer 409 "No pickup code is free"
    }
    - add a @Parcel to the end of @parcels with @code = @freeCode, …
  }
  ```
- **Where draws are.** In handlers, endpoints, recurring work and an api's derived values. The
  screen shows state: a draw in an element, a screen's derived value, an `always` rule or `on
  start` is refused. A draw inside a loop inside a loop is not in the language yet.
- **Secure by default, the only kind.** In the browser and on the server every draw comes from the
  platform's cryptographic generator, keyed per event. A screen's draws are secret from other
  people but not from the user of that browser: a code that protects something from other users (an
  invitation, a pickup code) is drawn by a service. Weights, decimals and other distributions are
  not in the language yet.
- **In tests the chance is the harness's.** An example steers the values it needs (`steer random
  Die = 6, 6`, §6). A draw nothing steered comes from a seed made from the example's name: the same
  in every run and every build, and changed by no other example. Random sessions draw from their
  own seed, lean toward the edges (a range's bounds, an alphabet's first and last character, a value
  already taken, an order kept or reversed), and write a failing session down with `steer random`
  steps to paste.

## 4. Screen elements

| Element | Form | Shows | User can |
|---|---|---|---|
| `heading` | `heading "Static text"` | fixed text | — |
| `text` | `text name` or `text name = expr` | a text value | — |
| `field` | `field name "Label"` | an editable text box | type |
| `button` | `button name "Label"` or `button name = expr` | a button | click |
| `checkbox` | `checkbox name ["Label"]` | a tick box | toggle |
| `select` | `select name ["Label"]` | one value of a choice | choose |
| `select … from` | `select name ["Label"] from list.field` | one of the texts `field` of the items in `list`, or none | choose |
| `list` | `list name of Type [= expr]` | rows; children are the row's elements | act on a row |
| `section` | `section name ["Title"]` | a group; children are elements | — |
| `progress` | `progress name ["Label"] [= expr]` | a value 0–100 as a bar | — |
| `use` | `use name = Component` + bindings | a behaviour component (§4d) | what it offers |

Modifiers, in the element's block:

- `visible when <sentence>` — the element (or section) is absent from the screen otherwise. Its value (and
  the values inside a section) is only read while it is visible: `visible when there is a @x`
  makes `@x` a value there, not a `T or nothing` (§2).
- `enabled when <sentence>` — buttons only; a disabled button cannot be clicked. An example proves
  that it is disabled with `see add is disabled` and never clicks it: the harness refuses the click,
  so no build could pass the step, and the checker refuses it first wherever it can tell (`STEP`).
- `look "<sentence>"` — how this element looks, in words (§4c).

Any element can end with `as <presentation>`: a built-in presentation (below) or a declared
`component`. Presentation changes the look, never the behaviour.

Binding (checked by the compiler):

- `text x` without `=` shows state `x`, derived value `x`, or — inside a list — the row
  item's field `x`. With `= expr`, `expr` is either a template string (`"{count} left"`)
  or a sentence.
- Inside a template hole `{…}`: a declared name (`{count}`, `{toast.message}`), a field of
  the row's item inside a list (`{title}`), a name with a display format (`{total as money}`),
  or a short phrase over declared names (`{the number of attendees}`, `{14 days after @today}`). Keep
  holes short: name longer computations in `derive`. Display formats: `as money` (two
  decimals), `as decimal` (up to 8 decimals), `as clock` (m:ss), `as percent` (a whole number
  and `%`). A hole that can be empty (nothing chosen yet) needs an explicit text for that case.
- `field x` edits state `x`, which must be `Text`. Typing replaces `x` with the typed text.
- `select x` edits state `x`, which must be a choice; its options are the choice values in
  declared order.
- `select x from items.name` edits state `x`, a `Text or nothing` (`x: Text or nothing =
  nothing`): nothing while none is chosen. Its options are the `name` of every item of `items`, in
  list order; choosing sets `x` to that text. A select that always has a choice may edit a `Text`
  with a default of its own.
- `checkbox x` edits state `x` (a `Bool`), or inside a list the row item's `Bool` field
  `x`. Toggling flips it.
- `list x` without `=` shows state or derived value `x`, which must be a list.
- `list x of Record { … }` shows the rows of that record (the row's elements are declared inside
  the block). `list x of Text` (or Int, Decimal, Bool, Date, DateTime) shows each value as a row:
  it has no row elements, so `see x has N rows` is how an example checks it.
- **A list inside a row.** Inside a list row, `list x of R` without `=` shows the row item's field
  `x`, which must be a `List R` (as `text x` shows the row's field `x`; `BAD_BINDING` without it,
  `TYPE` for a list of another record). With `= expr` it shows that value, computed per row
  (`list open of Item = its @items whose @done is false`). Its block holds the inner row's
  elements; they act on that inner row ("that item"), in that outer row ("that task"), and read
  the outer row by that name (`visible when that task's @done is false`), the inner one as "its". Rows go two
  levels deep: a list inside a row of an inner list is `NOT_YET`. Without `as`, the inner list is a
  list inside the row; inside a `table` row it sits in a cell of its own, as a plain stacked list
  (a `table` inside a `table` is `NOT_YET`).

  ```intent-excerpt
  list tasks of Task as cards {
    text title
    list items of Item {
      checkbox done
      text label
      button removeItem "Remove" as icon
    }
    field newItem "New item"
    button addItem "Add"
    text left = "{the number of its @items whose @done is false} left"
  }
  ```
- Element names are unique within a screen, and two screens may reuse one (`back` on both, §4a):
  the handler (`on click back`) belongs to the name, so both screens share its behaviour. Inside a
  list, row elements have their own scope. A row and the rows of a list inside it share one scope,
  so `on click removeItem` names one element (a name in both is `DUPLICATE`). Sections do not create
  a scope.
- `select x from items.name` inside an inner row may also take its options from a list field of
  the row around it (`items` is state, a derived value, or a field of the outer row).
- A section title and a field label are fixed text. To show a changing title, use
  `text x = … as title` as the section's first element.
- `select x from items.name` shows no option as chosen while `x` is nothing (an empty
  placeholder, never one of the options), or holds a text that is not among them. To un-pick, a
  handler clears it (`clear @x`, or `set @x to nothing`).
- A relation between records is a `ref` field (`ticket: ref Ticket`, §3): it holds the related
  record's key, and a sentence that needs the row follows the reference (`@comment's @ticket's
  @subject`, §3).
- A filter with an "all" option is its own choice, with its own value names:
  `choice CategoryFilter: AnyCategory "All" | OnlyBrakes "Brakes" | …`. Value names are unique
  across the app.

`as <presentation>` goes at the end of the element's line. When that line is long (a long
`= …` sentence), put it in the element's block instead:

```intent-excerpt
text places = "Full" when its signups reach its capacity, otherwise "{n} places left" {
  as badge
}
```

## 4a. Several screens

An app with more than one page gives each screen a name and an address; a part of the address
can be a param, declared like an endpoint's:

```intent-excerpt
screen list "/" {
  list tickets of Ticket {
    text subject
    button open "Open"
  }
}

screen ticket "/tickets/{ticketId}" {
  path ticketId: Int
  text title = "#{@ticketId} {the @subject of the ticket whose @id is @ticketId, or "No such ticket" when there is none}"
  button back "Back"
}

on click open {
  - go to @ticket with @ticketId = that ticket's @id
}

on click back {
  - go back
}

on open ticket {
  - increase @visits by 1
}
```

- `path x: T` is the value in the address, `@x` while that screen is shown: an `Int`, a `Text`, a
  `Date` or a `DateTime` (`screen day "/day/{day}" { path day: Date }`).
- `go to @screen with @x = …` shows another screen (a new entry in the history); `go back` is the
  back button. Every path param of the screen gone to is given.
- `on open <screen>` runs every time that screen is shown: by a link, by its address, or going
  back. It is where a screen loads what it shows. `on start` runs once, before the first.
- State belongs to the app, not to a screen: every screen reads and changes the same state.
- Element names are unique within a screen; two screens may reuse one (`back` on both), and the
  one `on click back` handler serves both. In an example, `see`/`click` name the element on the
  screen the example is on (the checker follows `open`, `go back` and a button's `go to`).
- The harness keeps where the app is. In the browser that is the address after `#`
  (`index.html#/tickets/3`), with the history and the back button. An address that fits no
  screen shows the first screen; `go back` on the first entry does nothing.
- Examples: `open "/tickets/3"` arrives by address, `go back` presses the back button, and
  `see screen = ticket` / `see path = "/tickets/3"` check where the app is. Every example starts
  at `/`. Random sessions go back and open the examples' addresses too. The checker follows an
  example's `open`, `go back` and a clicked button's `go to`, so a `see` of an element that is on
  another screen is an error (the checker names the screen it is on).

## 4b. Platform functions

Some work needs no judgement but cannot be written well in sentences: a hash, a format, running a
checker. A **platform** declares such functions; the Intent installation implements them in
reviewed code, never the compiler, so every build calls the same code:

```intent-excerpt
platform std.crypto
function sha256(text: Text): Text          # 64 lower-case hex digits

example "the standard's test vectors" {
  call sha256 with text = "abc"
  see sha256 = "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad"
}
```

An app imports a platform like a bundle and names its functions in sentences:
`import std.crypto`, then `@digest = the @sha256 of the given @source`. A platform's examples run
against its implementation in the installation's tests. Platforms so far: `std.crypto`
(`sha256`) and `intent.tools` (`check`: a spec's checker result, public names, example
fingerprints and digest, as `intent publish` computes them; a spec with imports is not checked
alone). A **screen** can use a platform too, for example the `@sha256` of what the user types
(`std.crypto` has a reviewed implementation per target, and they give the same results). A platform whose code runs in the harness (like `intent.tools`) is for services
only, and an app that uses a platform with no Elm implementation builds on TypeScript only: an Elm
build stops with the reason before any model call.

## 4c. Look: design, components, presentations

```intent-excerpt
design {
  look "A calm SaaS admin: light neutral page, white surfaces with a thin border …"
  brand: indigo          # colour roles → Tailwind palettes: brand, neutral, accent,
  neutral: slate         #   success, warning, danger, info
  danger: rose
  font: sans             # sans | serif | mono
  radius: large          # none | small | medium | large | xl | full
  density: comfortable   # compact | comfortable | spacious
}

component StatCard as card "A small uppercase muted label above a large number."

screen {
  section openStat as StatCard {
    text openLabel = "Open"
    text openValue = the number of @Open @tickets
  }
}
```

A component can start from a built-in presentation (`component StatCard as card "…"`). Its
look sentence then only describes how it differs from that presentation. Every element
shown `as StatCard` must be able to take that presentation.

Built-in presentations (closed set; each has one meaning):

| Kind | Presentation | Meaning |
|---|---|---|
| section | `main` | the main content column |
| | `sidebar` | a fixed-width column at the left, full height |
| | `header` | a row at the top of its parent: the first element left, the others together on the right |
| | `toolbar` | a row of controls: the first left, the others together on the right, wrapping when needed |
| | `card` | a surface with border, radius, padding; tables, menus, toolbars and footers inside it run edge to edge |
| | `grid` | children in equal columns |
| | `row` | children side by side |
| | `form` | fields stacked with labels above them |
| | `footer` | a row at the bottom of its parent: info left, actions right |
| | `banner` | a full-width strip |
| | `dialog` | a modal centered over a dimmed backdrop, with its title on top |
| | `empty` | a centered "nothing here" block: a muted circle, then its texts stacked |
| | `drawer` | a panel over the right side of the page, full height |
| heading | `title`, `subtitle` | a page or panel title; a smaller title |
| text | `title` | a page or panel title |
| | `caption` | small muted text |
| | `badge` | a small rounded pill |
| | `avatar` | initials in a circle |
| | `alert` | a tinted box with a warning colour |
| | `toast` | a floating message at the bottom right |
| | `stat` | a large number |
| | `code` | monospace text |
| button | `primary` | filled with the brand colour |
| | `secondary` | white with a border |
| | `danger` | filled with the danger colour |
| | `ghost` | no border, no fill |
| | `link` | looks like a text link |
| | `icon` | a small square button; its label is its accessible name |
| select | `tabs`, `chips`, `segmented`, `nav`, `dropdown`, `radio` | one option chosen; `nav` is a vertical menu, `dropdown` a native select |
| checkbox | `toggle` | a switch |
| field | `search` | a search box: its label is the placeholder (no visible label); 20rem wide in a toolbar or header |
| | `textarea`, `password` | |
| list | `table`, `cards`, `grid`, `timeline`, `bars`, `menu` | `bars` is a horizontal bar chart |
| progress | `bar`, `ring` | |

## 4d. Reuse: bundles, imports and behaviour components

A **bundle** is a library file under the project's `lib/`: `lib/std/list.intent` starts with
`bundle std.list`. It holds records, choices, components and a `design`. State, screens and
behaviour live inside its components. A bundle is proven by its demo app, next to it
(`lib/std/list.demo.intent`).

```intent-excerpt
import std.list                      # everything std.list declares
import std.list.Pager                # one name
import std.list.Pager as TicketPager # one name, renamed (a component, a record, a choice or a refined type)
```

All imported names share one namespace; a name declared twice is an error. Renaming a record or
choice also renames the references to it inside that bundle, so two bundles that both declare a
`Ticket` can be used side by side (`import support.tickets.Ticket as Issue`).

**Import what you use.** A name used in a file (in a sentence, `@Solved`, or as a type,
`mine: List Ticket`) must be declared in that file or in a spec the file names itself: `import`,
`uses`, `implements`, `extends`. A name that only arrives through another spec (a contract's own
import, say) is an `IMPORT` error that names the spec to import. So a reader can always find
where a name comes from without leaving the file. A bundle's
`design` becomes the app's design; the app's own `design` lines override it.

**Behaviour components** have parameters and their own state, derived values, screen,
events, rules and `always` checks:

```intent-excerpt
component Pager as footer "The page info on the left; previous and next on the right." {
  param items "the list to show one page at a time"   # required
  param size = 5                                      # with a default
  state {
    page: Int = 1
  }
  derive {
    pageCount = the number of @items divided by @size, rounded up, but at least 1
    visible = the @items on page @page, @size per page
  }
  screen {
    text pageInfo = "Page {page} of {pageCount}"
    button next "Next" as secondary {
      enabled when @page is below @pageCount
    }
  }
  on click next {
    - increase @page by 1
  }
}
```

Inside a component, write its own names and its params with `@` (`@page`, `@items`), so that
every use gets its own copy. The checker warns (`UNSCOPED`) when you don't. A component has no
examples of its own (`NOT_YET`): the demo app of its bundle proves it, through a `use`.

An app places a component with `use`, and binds its params in its block:

```intent-excerpt
screen {
  list shown of Ticket = @pager.visible as table {
    text subject
  }
  use pager = Pager {
    items = sorted
    size = 5
  }
}

on type search {
  - set @pager.page to 1
}

example "paging" {
  click pager.next
  see pager.pageInfo = "Page 2 of 2"
}
```

Everything in the component is then called `<use name>.<name>`: `pager.next`, `pager.page`,
`pager.visible`. The app can read and set these names in its own sentences, handlers and
examples (`set @toast.message to "Saved"`). A binding value (`items = sorted`) is a name or a
literal, without `@`.

A `use` can also take `visible when …` and `look "…"`, like any element:

```intent-excerpt
  use pager = Pager {
    items = sorted
    visible when @sorted is not empty
  }
```

The look of a bundle component's elements belongs to the bundle; an app cannot restyle
them one by one. Change the design, or propose a change to the bundle.

**Pinned.** Every bundle a spec uses is pinned by its content: a bundle that changed is reviewed
before a build uses it, so a build never picks up a library change silently.

**Version.** A spec says the lowest language version it needs, on a line of its own right after its
header: after `bundle std.list`, or after the closing `}` of a header with a purpose (`app Chores {`,
its strings, `}`), before anything else: `language 1` (later `language 1.2`, or `language 2` for a
new edition). A spec without the
line means `language 1`. A spec that needs a newer version than the compiler reads is an error; a
line from before language 1 (`language v12`) reads as `language 1`, with a warning.

**Notes.** A comment at the end of a line (`remaining: Int = 1500  # seconds left`) is a note:
the compiler reads it too. A comment on a line of its own is only for people.

The compiler reads the app expanded: imports resolved, components placed, and each line marked with
where it came from. There a component's names are qualified (`pager.page: Int = 1`, `button
pager.next`), and the expanded spec says so on its first line; an author never declares a
qualified name (`SYNTAX`): it is declared inside its component, and written `@pager.page` where it
is used.

## 4e. Refinement: improving someone else's app

A published app (an `app` file in `lib/`, such as `support.helpdesk`) can be the base
of another spec. The new spec starts as a copy of the base and names every change:

```intent
app SupportDesk {
  "Our support desk: the standard helpdesk, tuned to how we triage."
}

extends support.helpdesk

override text pageTitle = the text users see for @page: "Queue", "Reports" or "Settings" as title

override state {
  sort: Sort = ByPriority          # we triage by priority first
}

add to header after pageTitle {
  text slaNote = "Urgent tickets are answered within the hour." as caption
}

drop example "paging"              # pages follow priority order now

example "paging in priority order" {
  click pager.next
  see ticketId on row 1 = "#7"
}
```

- `override <element line>` replaces an element, by name. `override derive`,
  `override state`, `override on <verb> <element>` and `override component` replace one
  derived value, state field, handler or component.
- `add to <section> [after <element>]` places new elements. A refining spec has no `screen`
  block. New state, derived values, handlers, rules, `always` checks and examples are declared
  as usual and are added to the base's.
- `drop element x`, `drop example "…"` and `drop on click x` remove a part.
- **The base's proofs still apply.** Every base example and `always` check runs on the new
  spec, unless it is dropped. The checker warns (`OVERRIDES_PROOF`) when a base example
  checks something you changed; the compiler reports `SPEC CONFLICT` when an override breaks
  a base example in a less direct way.
- **The base is pinned**, with a fingerprint of every part you override. When the base changes,
  the check stops and marks each override whose base part changed, so you review exactly those.
- One level deep: a base does not itself extend another spec. Compose components for more.
- An override that many specs make is a sign that the base is missing something (a param,
  a rule); propose it to the base's author.

## 4f. The api profile

A spec with `profile api` describes an HTTP service instead of a screen. Its vocabulary is
the `api` profile (a spec itself, like the screen profile `ui`). Records, choices, state, derive, rules, `always`,
examples, imports and refinement work as everywhere else.

```intent-excerpt
app TicketsApi {
  "The support desk's tickets over HTTP."
}

profile api
import support.tickets

endpoint createTicket POST "/tickets" {
  body subject: Text
  body customer: Text
  body priority: Priority
  answers 201 Ticket
  answers 400 Problem
  if @subject, trimmed, is blank {
    answer 400 "Subject is required"
  }
  - add a @Ticket to the end of @tickets with @id = @nextId, …
  - increase @nextId by 1
  answer 201 with the new ticket
}

example "creating a ticket" {
  call createTicket with subject = "Printer on fire", customer = "Ann", priority = Urgent
  see createTicket.status = 201
  see createTicket.body.id = 9
  see listTickets.body[1].id = 9          # after `call listTickets`; lists count from 1
}
```

- A path is `/` and then letters, digits, `. _ ~ - /` and `{x}` holes (`"/tickets/{id}/solve"`);
  anything else is a query or body param (`SYNTAX`). The same holds for a screen's path.
- `path x: T` (appears in the path as `{x}`), `query x: T` and `body x: T` are the input; a path
  param is an `Int`, a `Text`, a `Date`, a `DateTime`, a refined type of one (a code: `path code:
  BookingCode`) or a `ref`. `answers <status> <Type>` says what it answers, one line per status
  (`answers 201 Ticket`, `answers 200 List Ticket`, `answers 404 Problem`, `answers 204` without a
  body; `Problem` is built in: `{ "error": "…" }`). `every endpoint answers 401 Problem` adds a status
  to every endpoint, in a contract or in an api that has none.
  Steps are sentences, as in handlers: "answer 200 with …", `answer 404 "…"` (which ends the
  endpoint), inside `if <condition> { … }` where it applies.
- **The row a request names.** A param that holds a row's key is a reference, `path id: ref
  Ticket` (on the wire the Ticket's key; in the query or the body too: `body slotId: ref Slot`, then
  "that slot"). The endpoint asks whether the row is there, `if that
  ticket does not exist { answer 404 "No such ticket" }`, and after it "that ticket" is the row (a
  smart cast, §2): `set that ticket's @status to @Solved`, `answer 200 with that ticket`. Reading
  it before asking is a `NOTHING` error.
  In a step, `@x` is the param, and `@path.x` / `@query.x` / `@body.x` say which part it is —
  useful when a field has the same name (`the ticket whose @id is @path.id`); the checker refuses
  the wrong part.
- The harness routes requests and checks their input before the service sees them. It answers
  these itself, with fixed messages: `404 {"error":"Not found"}`, `405 {"error":"Method not
  allowed"}`, `400 {"error":"<name> is required"}` and `400 {"error":"<name> must be <type>"}`
  (§9.18). Refusals written in the spec have the same shape: `{"error": "…"}`.
- `call x with a = 1, b = "…"` sends a request, and `see x.status` / `see x.body.<path>` check the
  latest answer of `x`. `has N rows`, numeric checks and `see every row of x.body: …` work on
  lists. A param left out of a `call` is not sent, which tests the harness's `is required` answer.
  A value is a literal, a list `[a, b]`, or a record `{ bundle = "std.list", minimum = "1.0" }`
  (`needs = [{ bundle = "std.list", minimum = "1.0" }]`); the checker matches records' fields
  with the param's type.
- A fresh secret is a draw (§3c): `a random @Token` (`import std.text`: 32 hex characters, 128
  bits), drawn once and referred to after.
- A code in a request (a path, query or body param of a code type, §3a) is read as its alphabet
  says, and the endpoint sees its normal form; one that is not a code is answered `400 {"error":
  "<name> must be a valid <Type>"}`. In JSON a code is a string.
- A build is an HTTP server plus the same pure handler under test. Every answer can name the spec
  line that gave it (the step that answers that status, the endpoint, or the layer that refused),
  and every element, handler, step, endpoint, event, layer, rule and example is mapped to its file
  and line. Twin compilation, examples, `always` and random call sessions work as for screens.
- Headers: `call x with header x-api-key = "…", a = 1` sends a request header;
  `see x.header.vary = "origin"` and `see x.header.vary is absent` check an answer's header
  (names are lower case). `see x.body.due = nothing` checks a value that is nothing (it is written,
  as `null`); `is absent` is for a header, an event (`see ticketCreated is absent`) and a path
  outside the answer's declared type, and on a declared field it is a `STEP` error.
- A raw request, for what is not an endpoint (a preflight, an unknown path):
  `request OPTIONS "/tickets" with header origin = "…", query status = Open, body text = "…"`,
  then `see request.status`, `see request.header.<name>`, `see request.body…`.

**Access: who may do what.** Who is calling is a layer's to say (`std.http.apiKey` provides
`@caller`, §4j); what they may do is the api's `access` block. Its rules are declared once, checked
before any build, and enforced by the harness on the server before the endpoint runs: an endpoint
never checks who calls, and no build writes an access check of its own.

```intent-excerpt
choice Role: Agent | Lead

record Grant {
  who: Text                   # a caller, as the key layer names them
  role: Role
}

state {
  stored grants: List Grant = table {
    who   | role
    "Ann" | Agent
    "Lin" | Lead
  }
}

access {
  roles = grants
  - anyone, without a key, may call @health
  - any caller may call @me
  - an @Agent may call @myTickets, @takeTicket and @addComment
  - an @Agent may call @solveTicket when that ticket's @assignee is the @caller: "Only the assignee can solve this ticket"
  - a @Lead may call every endpoint
  - no one may call @reopenTicket when that ticket's @status is @Archived: "Archived tickets stay closed"
  - an @Agent may hear @ticketAssigned when its body's @assignee is the @caller
  - a @Lead may hear every event
}
```

- **Roles are data.** `roles = grants` names a state list of records with `who: Text` and exactly
  one field whose type is a choice (the roles). A caller holds the role of every grant whose `who`
  is the caller; a person with several roles has several grants. Grants are read on every request,
  so a role an endpoint grants or revokes counts from the next request on. Separation of duty is an
  `always` sentence over them (`- no two @grants have the same @who with one @Clerk and the other
  @Approver`).
- **Permits:** `anyone, without a key, may call …` (no key needed; no condition), `any caller may
  call …` (any key holder), `any caller with a role may call …` (a key holder who holds any grant),
  `a @Role may call …` (`a @Clerk or an @Approver`, `a @Clerk, an @Approver or a @Lead`). The
  endpoints are `@a`, `@a and @b`, `@a, @b and @c`, or `every endpoint`. Events are heard: `may hear
  @event`, `may hear every event`.
- **Forbids:** `no one may call <endpoints> when <condition>`. A forbid that holds refuses, whatever
  permits. A forbid always has a condition.
- **Default deny.** In an api with an `access` block, a request no rule permits is refused (also to
  an endpoint added later), and an event no rule lets a caller hear reaches no stream of theirs.
- **The refusal.** A known caller gets `403 {"error": …}` with the message after the rule's `:` — the
  forbid's that holds, or else that of a permit that covers the caller but whose condition does not
  hold — and `"Not allowed"` otherwise. A request without a key gets the key layer's `401`, except
  where `anyone, without a key, may` call. The contract declares both: `every endpoint answers 401 Problem` and
  `every endpoint answers 403 Problem`.
- **The order:** the layers (the key), the route and its input (404, 405, 400), access, then a
  remembered answer (`idempotency-key`, §4h) and the endpoint. A refused request changes nothing:
  no state, no events, no calls. A caller whose role was revoked does not get a remembered answer
  back.

**A condition is typed whole**, so the harness can enforce it: one of these forms, joined with
`and` (for "or", write a second rule).

| Form | Example |
|---|---|
| a field of the row is (not) the caller | `that ticket's @assignee is the @caller`, `that expense's @submitter is not the @caller` |
| the caller is (not) in a list field of the row | `the @caller is in that project's @members` |
| a choice field of the row has a value | `that ticket's @status is @Archived`, `that payout's @status is not @Requested` |
| a param compared with a literal or a state field | `@amount is at most 100000`, `@amount is at most @approvalLimit`, `@kind is @Refund` |
| a field of an event's payload is the caller | `its body's @assignee is the @caller`, `the @caller is in its body's @watchers` |

- **The row.** "that ticket" is the row the endpoint names with a `ref` param, `path id: ref
  Ticket`. A path through the row may follow references (`that ticket's @project's @owner`), each
  looked up in its record's home list (§3).
- **Nothing is undecided.** In an access condition a value that is nothing — a `T or nothing`
  field, an absent param, a reference to a row that is gone, a request without a key (it has no
  caller) — makes the condition undecided, not false: a permit does not hold and a forbid does
  (fail securely). This is the one place §9.12's Kotlin equality does not apply: `that ticket's
  @assignee is not the @caller` on an unassigned ticket is not true, so it refuses; write a second
  rule if that case must be let through. An order (`is at most`) on a `T or nothing` is a
  `NOTHING` error.
- **Nothing to protect.** The exception: when the `ref` param's key finds no row, the row's
  conditions do not refuse (a permit's hold, a forbid's do not), and the endpoint answers for the
  missing row itself (404). The role part still applies. A request let through only that way whose
  endpoint then answers 2xx with that row there (it made it, or found it) is refused (403), and
  nothing it did is kept.

**The audit.** The harness logs every refusal (the key layer's 401s too, with no caller and the
layer's line as the rule) and every permitted request with a method that changes something: `at` (the clock), `caller`, `endpoint`, `decision` (`allowed` or `refused`),
`rules` (the rules that decided, as `file:line`), `status`, and the idempotency key when there is
one; never a key's secret. On the server it is kept with the stored state of the same request; no
endpoint reads or changes it. Examples read
it: `see audit has 2 rows`, `see audit[1].caller = "Ann"`, `see audit[2].decision = "refused"`
(entries count from 1).

**Events, per listener.** On `GET /events` each event goes only to the streams whose caller may hear
it. With an `access` block the stream itself needs no rule. Before every event a stream passes the
layers again with the request that opened it: a stream whose key was revoked since is closed.

**Acting as someone.** `call solveTicket as "Ann" with id = 4` makes the call with Ann's key (the key
layer says how: `acts as`, §4j). A call without `as` and without a key header is anonymous, and `with
header x-api-key = "…"` still sends a key of the example's own (a wrong one, say). Random sessions
call as each caller the examples act as, as every key's owner (a key without a grant too) and
anonymously, and check after every call that a refused one changed nothing.

## 4g. Jobs: an app without a screen

A **job** (`profile job`) is an app that nobody looks at: an agent or a background worker. It has
state, `uses` apis (calls, answers, events, the agreement), `on start`, `on event`, a `clock` and
`on tick`, rules, `always` and examples, and no `screen` and no endpoints.

```intent-excerpt
app UrgentWatch {
  "Passes urgent alerts on to the on-call channel."
}

profile job
import notify.alerts

uses notify.alertsApi as alerts only raise, alertRaised {
  tested with "services/alerts-api.intent"
}

state {
  stored passedOn: Int = 0
}

on event alerts.alertRaised {
  if its body's @level is @Urgent {
    - increase @passedOn by 1
    - call @alerts.raise with @text = "On-call told: {its body's @text}" and @level = @Info
  }
}

example "an urgent alert is passed on" {
  call alerts.raise with text = "Disk full", level = Urgent
  see passedOn = 1
}
```

- **What a job shows is its state.** The harness gives it a screen of its state fields (a `text`
  per value, a `list` per list with its rows' plain fields), so examples `see` state by name
  (`see passedOn = 1`, `see told has 2 rows`), and twin builds and random sessions compare it as for
  any app. The expanded spec shows that screen as a comment; nobody writes it.
- **Its entry** is `job.mjs` (the TypeScript target writes it; a job does not build on Elm): an ES
  module whose default export is `{ run }`. The host imports it,
  sets its transport (`globalThis.__intentTransport`) if calls do not go
  over HTTP, and calls `run({ event: { event: "alerts.alertRaised", body } })` per event, or `run()`
  to let it start. `run` resolves with the job's data once every call the event set off has been
  answered. The browser entry (`index.html`) still works and shows the state, for debugging.

## 4h. Contracts: what goes over the wire

**Wire names.** A choice value is written in JSON as its own name (`"Urgent"`), unless the choice
gives every value a wire name (`choice Level: Info = "info" | Urgent = "urgent"`), for an api whose
names are already fixed. The harness translates at the edge: requests, answers and events carry the
wire names; the app, its examples, its stored data and its screen use the spec's names. A request
with an unknown name is refused with the wire names (`level must be one of info, urgent`).

A **contract** is a publishable file that says what a service accepts and answers, and nothing
about how. It holds records, choices, endpoint signatures with every status they may answer,
and examples. The app that provides the service `implements` it and writes only behaviour.

**Where a contract lives.** Like a bundle, a contract is a file in the project's `lib/`, one area
deep: `contract support.ticketsApi` is `lib/support/ticketsApi.intent`. It is locked like a bundle
(`intent lock`), and it is always named, never given as a path: `implements support.ticketsApi` in
the service, `uses support.ticketsApi as tickets` in a screen or job that calls it. Its records,
choices and refined types come with that line; a contract is never imported (`import` is for
bundles: import the domain bundle a contract imports when you use its names yourself). The service
and the screens that call it are apps, anywhere outside `lib/`; `tested with` names the service's
file from the project's root (`tested with "services/tickets-api.intent"`).

```intent-excerpt
contract support.ticketsApi
import support.tickets

endpoint createTicket POST "/tickets" {
  body subject: Text
  body customer: Text
  body priority: Priority
  answers 201 Ticket
  answers 400 Problem                # Problem is built in: { "error": "…" }
}

example "solving a new ticket" {
  call createTicket with subject = "Printer on fire", customer = "Ann", priority = Urgent
  call solveTicket with id = {createTicket.body.id}    # a value from an earlier answer
  see solveTicket.status = 200
}
```

```intent-excerpt
app TicketsApi {
  "The support desk's tickets over HTTP."
}

implements support.ticketsApi

endpoint createTicket {  # the signature comes from the contract
  if @subject, trimmed, is blank {
    answer 400 "Subject is required"
  }
  - …
  answer 201 with the new ticket
}
```

Contracts cannot fail silently:

- **The checker** requires every contract endpoint to be implemented, no endpoint outside the
  contract, and every status a step answers to be declared (`CONTRACT` errors).
- **The compiler** types each handler by its answers: only the declared statuses and body types
  compile.
- **Every answer in every test** is checked against the contract at run time, including the
  shape of the body. The contract's examples run on every implementation.
- **The consumer** uses a typed client generated from the same contract version.
- **Events** are part of the contract: `event ticketCreated: Ticket` says the service announces
  that something happened, with a payload. An endpoint's step says when:
  `- publish @ticketCreated with the new ticket`. The implementation may publish only declared
  events, and every payload is checked against its type in every test. In examples,
  `see ticketCreated.body.subject = "…"` checks what the latest call published, and
  `see ticketCreated is absent` checks that it published nothing of that kind. The server sends
  events to every open `GET /events` stream (Server-Sent Events, `{ "event": …, "body": … }`),
  after the layers let the stream through.
- **Versions are computed on publish:** a removed endpoint, param, answer or event, or a changed
  type or wire name, makes a new major version.

**Effects.** An endpoint that reaches outside the system (money, mail, another company's service)
says so, and says what takes it back:

```intent-excerpt
contract pay.paymentsApi

endpoint charge POST "/charges" {
  body amount: Int
  body description: Text
  answers 201 Charge
  answers 400 Problem
  effect external
  undone by refund with id = @charge.body.id
}

endpoint sendReceipt POST "/charges/{id}/receipt" {
  path id: ref Charge
  body email: Text
  answers 204
  effect external                     # an email cannot be unsent
}
```

- `effect external` is the only effect word. Without it an endpoint changes only the service's own
  data (a GET only reads). Retrying safely follows from the method, not from a declaration.
  `effect external of @amount` also names the param that says how much the effect is (a number):
  a standing permission's amount limit reads it (§4i).
- `undone by <endpoint> with <param> = …` names the endpoint that compensates. It is a new action,
  not a rollback (a refund, a cancellation), with its params bound to this call's params (`@amount`)
  or its answer (`@charge.body.id`). An `external` endpoint without `undone by` is a **point of no
  return**.
- The checker requires the undo endpoint to exist, to be bound completely, and not to have an undo
  of its own (`EFFECT`). In a screen's handler, a call that cannot be undone should come after the
  calls that can (`PIVOT`): what can still fail goes first.
- The effects a handler can cause are not written; they follow from the endpoints it calls, and
  the source map lists them per handler (`effects`).
- **Effectively once.** A service recognises a repeated request: a request with a non-safe method
  and an `idempotency-key` header that it answered before gets the same answer again (with
  `idempotent-replayed: true`), and the endpoint does not run twice. The same key with a different
  request is refused (422); an `effect external` endpoint refuses a request without a key (400).
  Keys are kept per caller for 24 hours, with the stored state. A caller without a key layer's
  caller (anonymous) shares one space with every other anonymous caller, so an anonymous key is
  kept only when it cannot be guessed: 32 or more hex digits (128 random bits); a shorter one is no
  key (an `effect external` endpoint refuses it, 400). Screens send a key with every call (the same
  for every attempt; 128 random bits). "Exactly once" is not promised: no system can over a network; this
  is delivered at least once, and recognised when repeated.
- A screen takes an effect back with `undo @alias.endpoint` (§4i); agreement before an external
  call is `through std.actions` (§4i).

## 4i. Calling an API from a screen

A screen that talks to a service names the service's contract and calls its endpoints. The
answers come back as events:

```intent-excerpt
app TicketsUi {
  "The support desk's tickets, on one screen."
}

uses support.ticketsApi as tickets {  # the contract; its types come with it
  tested with "services/tickets-api.intent"     # the provider the examples run against
}

on start {
  - call @tickets.listTickets
}

on answer tickets.listTickets {
  if its status is 200 {
    - set @rows to its body
  }
}

on click add {
  - call @tickets.createTicket with @subject = @draft, @customer = "Web" and @priority = @Normal
}

on answer tickets.createTicket {
  if its status is 201 {
    - clear @draft
    - clear @problem
    - call @tickets.listTickets
  } else {
    - set @problem to the error
  }
}
```

- `uses <contract> as <alias>` makes the contract's endpoints callable as `<alias>.<endpoint>`.
  Its records and choices (and `Problem`) are available to the app.
- `uses <contract> as <alias> only listNotes, noteCreated` is the app's **manifest** for that api:
  the endpoints and events it may use. Calling, undoing through or handling anything else is an
  error (`UNDECLARED`), and a listed name the app never uses is a hint (`UNUSED`). Every build
  writes `manifest.json` (per api: its contract, endpoints and events; what the handlers use when
  there is no `only`), so a host can grant exactly that.
- `call <alias>.<endpoint> with a = …, b = …` in a handler step sends a request. An optional
  argument that is not given is nothing (sent as `null`).
- `on answer <alias>.<endpoint>` handles the answer. "its status" is the status; "its body" is
  the body, typed by the contract for that status. An answer the contract does not allow (the
  network is down, or the body has the wrong shape) is not any declared status: an `else`
  covers it, and "the error" is the harness's message for it (a `Problem`'s message, too).
- A call is sent again, with the same idempotency key, when its answer is lost, or is a 5xx or
  a 429, up to three attempts in all; the app sees only the last answer. A call to an
  `effect external` endpoint that still has no answer may or may not have happened: its answer is
  **unknown** (`if its status is unknown { … }`), not a failure. Say what the screen shows then;
  don't offer to do it again as if it failed.
- `on start` runs once when the app starts, after its stored fields are back (§9.20): it sees what
  the app remembered.
- Where a service is hosted is not in the spec: it is the deployment's. In the browser, calls to
  `<alias>` go where the page says, `<meta name="intent-api" content="desk=https://desk.example/api">`
  (`content="https://…"` for every api), else to the page's own origin. Never where the page's
  address says: a link cannot send calls, and the keys a client layer adds, elsewhere.
- `on event <alias>.<event>` handles an event of the contract, whoever caused it: this screen,
  or another client. "its body" is the payload. Events the screen does not handle are ignored.
  In the browser, the screen listens to the service's `/events` stream.

**Tests run against the real provider, not mocks.** The examples of the screen run against a
build of the app named in `tested with` (built first, and cached). A call is answered right
after the step that made it, before the next `see`; calls made in one step are answered in the
order they were made, and calls made by answers are answered in turn, until nothing is pending.
Every example starts with a fresh provider, so the screen's examples read the provider's seed
data (`see rows has 8 rows`). The events a call publishes reach the screen right after its
answer, in the order published, before the calls that answer made.

The provider lives in the example's time and chance. Its requests carry the example's clock (the
screen's `examples start at`, or the provider's when the screen reads no clock), `wait` moves it
and runs the provider's recurring work that falls in the wait, and its draws are the example's: a
value only the provider draws is steered from the screen's example like the screen's own (`steer
random BookingCode = "M8TX3Q"`, then `see code on row 3 = "M8TX3Q"`), and one nothing steers comes
from the example's seed, the same in every build. A type that both the screen and its provider draw
cannot be steered from the screen (`STEP`): give one of them its own type.

**Other clients.** In a screen's example, `call tickets.createTicket with subject = "…", …` is
another client calling the provider: the screen does not see the answer, only the events it
publishes (the ones its own caller may hear, when the provider has an `access` block).
`call desk.solveTicket as "Lin" with id = 4` is another client acting as Lin, with Lin's key in the
provider (§4f). That is how an example proves that the screen follows changes made elsewhere:

```intent-excerpt
example "another agent adds a ticket" {
  call tickets.createTicket with subject = "Coffee machine broken", customer = "Iris", priority = Low
  see rows has 9 rows
  see subject on row 1 = "Coffee machine broken"
}
```

Random sessions mix in the other-client calls the examples make (with whole numbers varied), so
two builds that handle someone else's change differently count as different apps.

The checker reports a call to an endpoint the contract does not have, and warns when a call's
answer is never handled.

**Taking an effect back.** `undo @alias.endpoint` in a handler calls the endpoint the contract
names in `undone by`, with its arguments taken from the answer the original call got. The app keeps
that answer (for example `charge: Charge or nothing`); the step reads it and the harness builds the
compensating call, so an app never reassembles a refund itself. The undo's own answer is handled
like any other (`on answer pay.refund`; without it the checker warns `NO_HANDLER`). It goes out
through the same effectively-once path with its own key, so a lost answer is sent again with the
same key and the provider replays instead of refunding twice.

```intent-excerpt
on click refund {
  - set @refunding to true
  if there is a @charge {
    - undo @pay.charge
  }
}

on answer pay.refund {
  - set @refunding to false
  if its status is 200 {
    - set @charge to nothing
    - set @message to "Refunded: charge {its body's @id}"
  } else {
    - set @message to "Refund failed: {the error}"
  }
}
```

## 4j. Layers: reusable parts of an HTTP service

CORS, API keys and safe headers are the same for every API and easy to get subtly wrong. They
are **layers**: specs of their own (`lib/std/http/`), compiled once, proven by their own
examples, and reused by every api that runs behind them.

```intent-excerpt
app DeskApi {
  "The support desk's API for agents."
}

profile api

layer secure = std.http.secure          # safe headers on every answer
layer cors = std.http.cors {  # which web pages may call
  origins = "https://desk.example"
  headers = "content-type", "x-api-key"
}
layer auth = std.http.apiKey {  # who calls; provides `caller`
  keys = table {
    secret       | owner
    "k-ann-7f3a" | "Ann"
  }
}

access {                              # what each caller may do (§4f)
  - anyone, without a key, may call @health
  - any caller may call @solveTicket when that ticket's @assignee is the @caller: "Only the assignee can solve this ticket"
}

endpoint solveTicket POST "/tickets/{id}/solve" {
  path id: ref Ticket
  answers 200 Ticket
  answers 404 Problem
  if that ticket does not exist {
    answer 404 "No such ticket"
  }
  - set that ticket's @status to @Solved
  answer 200 with that ticket
}
```

- `layer <name> = <layer>` binds the layer's params in its block: a literal, literals
  separated by commas (a list), a `table`, or a state field of the app (`keys = apiKeys`): the
  layer then reads it on every request, so endpoints can change it (sign-up adds a key). The
  layer's records (`ApiKey`) are the app's too. Params with a default may be left out.
- Layers run in the order of the `layer` lines: the first sees every request first and every
  answer last. A layer that answers (a refused key, a preflight) stops the request: later layers
  and the app are not reached, and the answer goes back out through the layers before it. So put
  `secure` first (every answer gets its headers) and `cors` before `auth` (a page can read a 401).
- A layer can **provide** values to every endpoint: `std.http.apiKey` provides `caller`, the
  owner of the key. Endpoint steps use it by name ("the caller").
- A layer's answers are not the app's: the contract of an endpoint (§4h) covers what the app
  answers, not a 401 from `auth`.
- In an api with an `access` block (§4f), what needs no key is said once, as `anyone, without a
  key, may call …` in the block: the harness binds the key layer's `public` from those rules (binding `public` by
  hand there is an `ACCESS` error), and the key layer checks a key wherever one is sent.

Available layers:

| Layer | Params (default) | What it answers itself |
|---|---|---|
| `std.http.secure` | none | nothing: it sets x-content-type-options, x-frame-options, referrer-policy, cache-control and content-security-policy on every answer |
| `std.http.cors` | `origins` (`[]`: any origin), `headers` (`"content-type"`), `maxAge` (`600` seconds) | a preflight: `204` with the allow headers; a page from another origin: `403 {"error": "Origin not allowed"}` |
| `std.http.apiKey` | `keys` (a `List ApiKey`: `secret`, `owner`), `keyHeader` (`"x-api-key"`), `public` (`[]`) | no key, or a blank one: `401 {"error": "Missing API key"}`; a key it does not know: `401 {"error": "Unknown API key"}`; both with header `www-authenticate: ApiKey` |
| `std.http.sendKey` (a client's layer) | `key`, `keyHeader` (`"x-api-key"`) | nothing: it adds the key to every call and to the event stream |

`std.http.apiKey` provides `caller` (the key's owner), compares secrets in constant time, and says
how a test `acts as` a caller. A `public` entry is a path (`"/health"`), every path under a prefix
(`"/bundles/*"`), or either for one method only (`"GET /bundles/*"`, `"POST /signup"`). A screen shows
a refusal's message with `the error` (`"Unknown API key"`), so an example can check it.

**Writing a layer** (`layer std.http.cors`): `param name: Type [= default]`, `provides name:
Type`, `before every request` (steps that may `answer`, which stops the request, or pass it on) and
`after every answer` (steps that change the answer on its way out, usually its headers; this
runs for every answer, including the harness's 404 and 400). Examples send raw requests and
check the answer with `see status = 204`, `see header vary = "origin"`, `see body.error = "…"`.
They run the layer around a stub app that answers `200 { "reached": true, … }` with what the
layer provided (`see body.caller = "Sam"`). `examples with` binds the params the examples use;
`given key = ""` changes one from that step on. A layer that provides `caller` says how a test acts
as a caller (`call x as "Ann"`, §4f), in one typed line the harness reads: `acts as @caller with
header @keyHeader = the @secret of the key in @keys whose @owner is @caller`.

**A client's layer** wraps the calls a screen makes instead of a service: it has only
`before every call`, which changes each call as it leaves (usually: adds a header). It also
runs for the screen's event stream. `std.http.sendKey` sends the user's key in `x-api-key`,
the client side of `std.http.apiKey`. Its examples send `request …` and see the call as it
leaves: `see header x-api-key = "…"`, `see body.path = "/tickets/mine"`.

```intent-excerpt
uses support.deskApi as desk {
  tested with "services/desk-api.intent"
  through std.http.sendKey {
    key = apiKey                    # bound to the screen's state: the key the user typed
  }
}
```

A client layer's params bind to the screen's **state** (a name) or to literals. The harness
gives each call the values of the state after the step that made the call, and reopens the
event stream when they change, so signing in is just setting `apiKey`. In tests, events reach
the screen only if its event stream would pass the provider's layers: a screen that is not
signed in gets none, as in the browser.

**Agreement before an external call.** `through std.actions` gates the calls a screen makes: an
endpoint the contract marks `effect external` goes out only when a standing permission covers it
(`agree`, a list of `Permission` records in the screen's state), and none goes out while the
emergency stop is on (`stop`). A `Permission` says the endpoint, how many calls it lets through
(`count`) per `per` minutes (nothing: ever), the most each call may amount to (`upTo`, read from the
param the contract names in `effect external of @amount`; nothing: no limit) and who granted it
(`approver`). Each permission counts the calls it let through, so two one-time grants are two calls.
With `fourEyes` on, a permission the requester (`requester`) granted themselves does not count.

A call no permission covers is **held for approval**: it does not reach the service yet, and its
answer handler hears `its status is held` at once, so the screen can show that it waits. Adding a
permission that covers it sends it, with its original key, and its real answer follows. Adding the
endpoint to `rejected` drops the calls held for it at that moment, and each one's handler hears
`its status is rejected`; a later call is held again (a person rejects one payment, not every
payment to come). Only such a call is held or rejected: `its status is held` (or `rejected`) in the
answer handler of an endpoint that is not `effect external`, or of an api not used `through
std.actions`, is an `EFFECT` error.

```intent-excerpt
on answer pay.charge {
  if its status is held {
    - set @message to "Waiting for approval"
    stop
  }
  if its status is rejected {
    - set @message to "Payment rejected"
  } else if its status is 201 {
    - set @message to "Paid"
  }
}
```

A call while stopped is answered at once with the reason (`{the error}`), so the screen can
show it. The held calls, what each permission let through and the rejections applied survive a
reload.

```intent-excerpt
uses pay.paymentsApi as pay {
  tested with "services/payments-api.intent"
  through std.actions {
    agree = permissions           # List Permission: endpoint, count, per, upTo, approver
    rejected = rejected           # List Text: each entry drops the calls held for that endpoint when it is added
    stop = stopped                # Bool: the emergency stop
  }
}
```

The gate runs in the screen: it is a brake, not access control. It protects against the app's own
mistakes and an agent acting too fast (the host is trusted there, the agent is not), not against a
person, who controls the browser. Who may do what is the service's `access` block (§4f): an approval
that must hold against the user is a state change on the service by a second person, refused by a
forbid when it is the same person (`no one may call @approveExpense when that expense's @submitter
is the @caller`). A spec that needs both writes both.

**What every endpoint may answer.** A service behind layers answers things its endpoints do not
(a 401 from `std.http.apiKey`). The contract says so once, and every endpoint's answers include
it, so a screen gets the Problem's message instead of a failed call:
`every endpoint answers 401 Problem`.

## 5. Events

```
on click add            # button
on click remove         # button inside a list: "that <item>" is the row's item
on toggle done          # checkbox (in addition to the built-in flip)
on type draft           # field (in addition to the built-in assignment)
on choose filter        # select (in addition to the built-in assignment)
on tick                 # requires `clock`
on start                # once, when the app starts; stored fields are back by then (§9.20)
on open tickets         # a screen is shown: what it loads and sets (§4a)
on answer tickets.listTickets   # the answer to a call (§4i)
on event tickets.ticketCreated  # an event of a call's api, whoever caused it (§4i)
```

Each `- sentence` in the block is one step, applied in order. Refer to declared names exactly.
Choices are structure (`if … { } else { }`, below); the steps themselves are plain sentences.

Idioms the compiler reads the same way every time:

- **Choices are structure, not prose.** The conditions are sentences; which steps they guard,
  and where that ends, is language:

  ```intent-excerpt
  on click lend {
    if @chosen is empty {
      stop
    } else if @chosenCount is 3 or more {
      - set @toast.message to "{chosen} already has 3 books out"
      stop
    }
    - add a @Loan to @loans with …
  }
  ```

  Of an `if … else if … else` chain exactly one branch runs: the first whose condition holds
  (`else` when none does). Without an `else`, nothing runs when no condition holds. Steps after
  the chain run in any case, unless a branch ended with `stop` (a handler) or `answer …` (an
  endpoint, or a layer's `before every request`). A step after `stop` or `answer` in the same
  block never runs, and is an error. An endpoint must `answer` on every path.
- **Loops are structure, not prose.** Running steps once per row of a list is a `for each` block.
  `whose` (optional) picks the rows, naming their fields alone as a lookup does; inside the block
  the loop's name is the row, and its fields are read with `'s` (`@notice's @expiresAt`):

  ```intent-excerpt
  every 1m {
    for each @notice in @notices whose @expiresAt is at or before @now {
      - remove @notice from @notices
      - publish @noticeExpired with @notice
    }
  }
  ```

  A loop is a step of a handler, an endpoint or recurring work. Its list is a state list, a derived
  list, or a row's inner list (`for each @step in that chore's @steps { - set @step's @done to false
  }`). The block runs once for each row the list had when the loop began, in the list's order; removing
  or adding rows inside the block does not change which rows it visits (§9.13), so the example above
  is well defined. A list that may be empty needs no guard: with no rows, the block runs no times.
  The row's name (`@notice`) exists only inside its block, must not hide a name the app already
  has, and `in @xs` must be a list (the checker says so).
- A step written as prose control ("- if …, … and stop", "- otherwise …") is a hint
  (`UNSTRUCTURED`): write it as structure.
- **The row's item:** in a handler for a button (or checkbox, field or select) inside a list, "that
  <item>" (e.g. "that ticket") is the item of the clicked row. In an expression inside a row, "its"
  and "this <item>" refer to the row's item: `text left = its @capacity minus its number of sign-ups`.
- **A row inside a row:** in a handler of an element in an inner row, two rows are there: the inner
  row by its record ("that item") and the row around it ("that task"); "its" is the inner one.
  An element of the outer row has no inner row (`NO_ROW` for "that item"). The inner list is the
  row's field: `add … to the end of that task's @items`, `remove that item from that task's @items`,
  `set that item's @done to …`, `clear that task's @newItem`.

  ```intent-excerpt
  on click addItem {
    if that task's @newItem, trimmed, is blank {
      stop
    }
    - add an @Item to the end of that task's @items with @id = the highest @id in that task's @items + 1, or 1 when there is none, @label = that task's @newItem, trimmed
    - clear that task's @newItem
  }

  on click removeItem {
    - remove that item from that task's @items
  }
  ```

  An inner key is unique only within its row, so a selection of an inner row keeps both keys
  (`chosenOrder` and `chosenLine`), and a handler finds the row in two steps: `if there is no order
  in @orders whose @id is @chosenOrder { stop }`, then `if there is no line in that order's @lines
  whose @id is @chosenLine { stop }`, then `increase the @qty of that line by 1`.
- **Adding a record:** `- add a @Ticket to the end of @tickets with @subject = @draft, trimmed,
  and @status @Open`. **New ids** come from a counter in state that only goes up, so a key is never
  handed out twice: `stored nextId: Int = 1` (the first free id after the seeded rows), then `@id =
  @nextId` and `- increase @nextId by 1`. `the highest @id in @tickets + 1` gives a removed row's id
  to the next new row, so an undo that puts the row back, a reference to it, or a client that kept
  its id finds another row (`REUSED_KEY`); use it only where rows are never removed.
- **Which row a phrase names.** After a lookup (`the ticket whose @id is @chosen`, `if there is no
  ticket whose … { stop }`, `if there is a booking in @active whose @slot is @id { … }`), "the ticket"
  and "that ticket" name the row it found; after `add a
  @Ticket …`, "the new ticket" names the row just added; in the handler of an element in a row,
  "that ticket" is the clicked row; in an endpoint with a `ref Ticket` param, "that ticket" is the
  row the request names (§4f). A phrase with no such row before it is `NO_ROW`.
- **Messages in handlers** refer to the clicked row's fields by name: `set @toast.message to
  "Cancelled {guest} at {time}"` inside `on click cancel` of a row.
- **Named intermediate values:** give a value a name in `derive` and use that name (for
  example `quantity = @amount read as a whole number`), instead of repeating the phrase.

## 6. Examples

An example starts from the initial state and runs steps in order. Steps (closed set):

```
type "Milk" into draft
type "Bread" into title on row 1   # a field inside a list row: it edits that row's item (§9.7)
click add
click remove on row 2 [of visible]
toggle done on row 1 [of visible]
choose Done in filter
choose Done in status on row 1 [of tasks]   # a select inside a list row: sets that row's item
choose "Ann" in payer       # select … from: options are texts
wait 3s                     # = 3 ticks with `clock every 1s`; without a tick: the clock moves on (§3b)
tick 5 times
see count = "2"             # text/field value; numbers and choice values are allowed: see count = 2
see title on row 1 [of visible] = "Milk"
click remove on row with "Milk"   # the first row showing that exact text
see visible has 2 rows
see add is disabled         # also: enabled, hidden, shown, checked, unchecked
snapshot "dialog open"      # a visual checkpoint: every build must look the same here
restart                     # the app starts again: `stored` fields keep their values, the rest starts from its default (§3)
size Standard               # the host shows the app at another size (§3b)
steer pay lose answer       # the next call to the api `pay` is done, but its answer is lost (a screen's provider)
steer pay slow              # a retry arrives while the first attempt still runs: the same key, sent again
steer pay restart after effect  # the service restarts after the effect, its keys kept
steer pay expire keys       # a late retry after the keys expired: the same key is treated as new
steer random Die = 6, 6     # the next two Dies drawn are 6 and 6 (§3c)
steer random shuffle keeps order   # the next shuffle leaves the list as it is (or: reverses order)
steer random pick 3         # the next `a random one of` takes the third item
```

`has 1 row` and `has 3 rows` are both fine. `see x on row 2 is hidden` checks an element inside a
row. A step acts only on what the screen offers: `click` a disabled button is refused (prove it with
`see add is disabled`, §4). A list hidden by `visible when` counts as not on the screen: check it with
`see list is hidden`, not with a row count.

Rows are counted from 1, in screen order. `of <list>` is needed only if the element name
exists in more than one list.

An api's examples (§4f) `call` its endpoints, as a caller (`call solveTicket as "Ann" with id = 4`)
or anonymously, and read the access audit (`see audit has 2 rows`, `see audit[1].decision =
"refused"`).

`steer random <Type> = <value>, …` queues values for the next draws of that type, in the order
written, in the step that follows or later; a value that `not among` excludes is skipped, as a
drawn one would be (steer the taken value first, then a free one, to prove the collision path).
The values are checked against the type (`TYPE`), and the type must be drawn somewhere (`STEP`): in
the spec, or, for a screen, in the provider its examples run against (§4i). A
steered value still queued when the example ends fails it: the draw did not happen where the
example expected. Draws happen in the order the steps say. An example may carry an unsteered value
forward (`code = {deposit.body.code}`), but a `see` that compares one with a literal gets
`UNSTEERED`: that value changes when the spec's draws change (a seeded value was never drawn, and
needs no steering).

`steer <api> lose request | lose answer | duplicate | slow | restart after effect | expire keys | fail <n>`
makes the way to an api go wrong for its next attempts: the request never arrives; it is done but
the answer is lost; it arrives twice; a retry arrives while the first still runs (the service
answers 409 in progress, and the client sends the same key again); the service restarts after the
effect but keeps its keys, so the retry replays; the keys have expired, so a late retry is treated
as new and runs again; or the next `n` attempts answer 503. The screen's calls are sent again as in
the browser, so an example can prove what the screen shows after a lost answer, and that nothing
happened twice. Random sessions steer too.

`always` holds `see` checks that must be true after every action, in every session, not
only in the examples. A check on an element that is not on the screen is skipped. For
counting rows, `has at most N rows` and `has at least N rows` are allowed too:

```intent-excerpt
always {
  see doing has at most 3 rows
}
```

The harness checks `always` rules in examples, in its own exploration of each build, and in
the differential sessions. `see x has N rows` (exactly N) works too.

Numbers and rows:

```intent-excerpt
always {
  see lowCount is at least 0                                 # the number an element shows
  see every row of cart: qty is at least 1                   # checked on each row
  see every row of events: confirmed is at most capacity     # against another element of the same row
  see every row of shown: status = "Open"                    # also: is shown / hidden / …
}
```

The number is read from what the element shows ("10 left" → 10, "× 2" → 2, a progress bar's
value). Comparisons: `at least`, `at most`, `above`, `below`, against a number or another
element. In `see every row of …` that other element is in the same row; in a plain check it is
on the screen. These also work as example steps.

**Sentences over the data.** Anything that must always hold about the data, also what the
screen does not show, is a `- sentence` in `always`:

```intent-excerpt
always {
  see every row of habits: streak is at least 0
  - no two @dones have the same @habit and the same @day
  - no @Done has a @day after @today
}
```

The harness checks every such sentence after every step of every example and random session.
A separate compiler stage turns the sentences into checks, once per spec and apart from the
app's code, so an app cannot bend a check to its own reading; every build of the spec runs the
same checks. A check is only as right as its reading of the sentence, so the stage compiles a
second, independent reading (a probe) as well, and the driver compares the two on the app's real
data: where they disagree, the sentence is ambiguous and the build stops and says so instead of
trusting one reading. The app hands its data over (every state field, generated as `Data`). A
sentence that does not hold fails the build like any `always` check, with the steps that led there
and the data at that moment. `rules` stays for guidance the compiler reads but nothing checks (how
something is done, what a word means); a rule that reads like an invariant gets an `UNCHECKED`
hint to move it to `always`.

**Change rules: before and after a step.** Some promises are about what a step may do, not about
one moment: an approved expense never changes, a balance only moves with deposits and
withdrawals, an id is never reused. A `- sentence` in `always` that uses one of these forms is
a change rule. The named forms need no judgement; the harness checks them itself:

| Form | Means |
|---|---|
| `<subject> never changes` | after every step, the subject is what it was before |
| `<subject> never goes down` / `never goes up` | a number or a moment: after ≥ before / after ≤ before |
| `<subject> only changes from @A to @B [or @C][, from @D to @E …]` | a choice (or yes/no) field: every change is one of the listed pairs; a value with no `from` never changes once reached (`nothing` is a value too, for a `T or nothing`) |
| `<rows> is never removed` | every such row that was there before the step is still there |

The subject is a state field (`@currency`, `@settings's @version`), a field of every row of a
record (`a @Ticket's @id`), or the rows of a record (`an @Expense`, narrowed with a condition on
one row: `an @Expense whose @status was @Approved`). A record's rows are read in its home list,
the one state list of that record, as a `ref` is followed; with several, name it: `an @Expense in
@archive never changes`. Rows are matched by their key before and after, so the record needs one.
`never changes` on rows means each row is still there with every field equal (removing it changes
it); on a field (`a @Ticket's @subject never changes`) it compares only rows that are there before
and after. `whose … was …` picks the rows by the state before the step, `whose … is …` by the
state after.

```intent-excerpt
always {
  - no two @expenses have the same @id
  - an @Expense whose @status was @Approved never changes
  - an @Expense's @status only changes from @Pending to @Approved or @Rejected
  - every @status in the new @expenses is @Pending
  - an @Expense is never removed
  - @nextId never goes down
}
```

For what the named forms cannot say, a sentence may read the state before the step: `@x before`
is `@x`'s value before it (of `@x`'s type; for a field of a row that was not there before, it is
nothing, and the sentence says what then); `was` is `is` in the state before (`@phase was
@Done`); `the new @xs` are the rows of `@xs` whose key was not there before, `the removed @xs`
the rows that were there and are not now, both in list order (a list of plain values compares as
a multiset). A reference without `before` is its value after the step; there is no other word for
it. These sentences are compiled like the one-moment ones, with the second reading:

```intent-excerpt
always {
  - @balance is @balance before plus the sum of @amount over the new @deposits minus the sum of @amount over the new @withdrawals
}
```

A change rule is about one update, so it is checked on every event the app handles: a click, each
answer and event that arrives, each tick and each run of recurring work, each request to an api,
each `on open`. A step that changes nothing passes every change rule (stuttering), and a restart
is not a step (stored state comes back as it was). The forms read two states, so they belong in
`always` only: a handler, a derived value or the screen reads one state (`CHANGE`); a handler that
needs the old value names it first (`set @previous to @x`). A broken change rule fails the build
like any `always` rule, with the event that broke it, the rows that changed, and the session,
shortened, as an example to paste into the spec. Components and bundles may have change rules;
they are renamed with the component's names like its other sentences.

**Who wrote a rule.** `rules { … }` are the person's; `rules by ai { … }` are rules an LLM added
while writing or refining the spec. The compiler reads both the same way; the difference is who may
change them: an LLM revises its own rules, and a person's only when the person asks. The source map
marks an LLM's rule (`"origin": "ai"`).

**A row inside a row** is named by one `on row …` per level, **innermost first** ("item 2 on task
1"), each by position or by what the row shows, each with an optional `of <list>`:

```
toggle done on row 2 on row 1                          # item 2 of task 1
click removeItem on row with "Milk" on row with "Groceries"
see label on row 3 of items on row 1 of tasks = "Bread"
type "Bread" into newItem on row 1                     # a field of the outer row: one level
see items on row 1 has 3 rows                          # the inner list of task 1
see items on row 2 is hidden
see every row of items: label is shown                 # every item of every task
```

A step names as many rows as the element is deep (`STEP` otherwise, with the rows it needs). `on
row with "…"` at the outer level matches what the outer row's own elements show, not its inner
rows'. `see every row of items: …` checks every inner row of every outer row.

## 7. Checks

The checker runs before any compile, and a spec with an error does not build. The compiler's own
checks decide whether a spec means one thing — syntax, references, types, relations, which row
"that ticket" is — and cannot be switched off. Quality rules (completeness, style, a team's policy)
are warnings unless a project makes them errors; they never change what a spec means. Each check
has a code (`NOTHING`, `NO_ROW`, `SPELLING`, …), named in this reference where it applies. A form
written with another word than the language's is a `SPELLING` warning, and the tooling rewrites it.

**Reserved names** are Intent's own words: `key`, `nothing`, `true`, `false`, `random` and the type
words (`Text`, `Int`, `Decimal`, `Bool`, `Date`, `DateTime`, `List`); in an api also `path`,
`query` and `body` for state and derived values, and `random` as an api's alias (it is what `steer
random` steers). Every other name is free: a name that is a keyword of a target language or a name
the harness generates (`type`, `in`, `class`, `when`, a record `Model`) is written differently in
generated code, and as itself on the screen, on the wire and in examples.

## 8. What the compiler produces

For every target the harness generates, deterministically from the spec:

- the domain types (records, choices),
- `Screen` — a typed record with one field per dynamic element (a value that may be absent when it
  has `visible when`, a list of row records for lists),
- per reference, a lookup of the row it points at, in its home list (by the referring row, and by
  key): nothing when the row is gone. A chain through references uses them hop by hop, and the
  sentence's fallback once at the end,
- `Msg` — one variant per possible user action; an element in a row inside a row carries both
  keys, the outer row's and its own (`TasksItemsRemoveItemClicked outerKey key`),
- for a list inside a row, the key each row gets (`taskRowKey`, `itemRowKey`) and the update of one
  inner row found by the two keys (`updateTaskItems`, `removeFromTaskItems`), so the app module
  never writes the nested update,
- per place a sentence draws (§3c), a function in `Draws` (`roll1`, `deposit1`), made from the
  event's seed by the harness; `update` (an endpoint's handler, recurring work) gets the event's
  draws,
- rendering, the event wiring and the test driver.

The LLM writes only the app module: `Model`, `init`, `update : Msg → Model → Model`
and `view : Model → Screen`, using the standard helpers for formatting, parsing and rounding. A
build is accepted when it type-checks and passes every example.

An app that calls APIs (§4i) also gets a `Call` type (one variant per endpoint), an answer type
per endpoint (one variant per declared status, plus a failure) and one `…Answered` message per
endpoint. Its `init` and `update` return the calls to make next to the model. In the browser the
runtime sends them with `fetch` to the page's origin, or where the page's `intent-api` meta tags say
(§4i).

An api with an `access` block (§4f) also hands over its data (`data(model)`, every state field):
the harness reads the grants and the rows the rules are about from it, and decides every request
and every event itself, before the handler runs. The handler only ever sees requests the block
permits, and never checks who is calling.

## 9. Defaults when the spec is silent

These are part of the language. A compiler must apply them, and a spec only needs to say
something when it wants different behaviour.

1. **Text.** Comparisons are exact and case-sensitive. "Blank" means empty after trimming
   whitespace. Stored text is kept as typed, unless the spec says "trimmed".
2. **Numbers shown.** An `Int` is shown as plain digits (`-3`, `1200`). A `Decimal` is shown
   with exactly two decimals, rounding half away from zero.
3. **Parsing input.** A number typed into a field is read the same way on every target:
   surrounding spaces are ignored, and `,` and `.` are both accepted as the decimal separator.
   Anything else is "not a number".
4. **Lists.** They keep insertion order. New items go at the end. Removing keeps the order
   of the rest.
5. **Look.** Without `as`, an element uses a plain default look that fits `design`. Without
   `design`, the app is neutral grey on white with an indigo brand. The look shows only what
   the spec names: no extra logos, icons, column headers, labels, helper texts or
   decorations unless a `look` sentence asks for them. A field shows its label above it
   (except `search`). Without a sidebar, the screen is one centered column. A section
   without `as` stacks its elements vertically. Table columns size themselves unless a
   `look` sets widths. Layout follows the spec: elements
   appear in the order they are listed (top to bottom; left to right inside a `row`,
   `header`, `toolbar` or `footer`). Consecutive buttons in one section form a single action
   row, in spec order, aligned to the end. Inside a `sidebar`, elements stack from the top and
   a `footer` section is pinned to the bottom.
6. **Buttons.** Without `enabled when`, a button is always enabled. A disabled button cannot be
   clicked: in the browser a click on it does nothing, and an example may not click it (§4).
7. **Fields and selections.** Typing only changes the field's value unless an `on type` handler
   says more: the state field of a top-level field, or — for a field inside a list row — that
   item's field (the row's key names the item; in a row inside a row, the two keys name the inner
   item). Choosing a value in a select likewise changes the select's value: the state field of a
   top-level select, or that item's field for a select inside a list row. Nothing is cleared unless
   a sentence says "clear".
8. **Time and chance.** In tests both come from the harness (§3b, §3c).
9. **Durations** shown as time are `m:ss`, or `h:mm:ss` from one hour up. **Rounding words** have
   one meaning each: "rounded" rounds half away from zero, "rounded up" toward the larger value,
   "rounded down" toward the smaller one; money in whole cents rounds half away from zero. Builds
   never invent their own rounding or epsilon.
10. **Row keys.** Every row of a list carries a key that names the item it shows: the record's key
    (§3) when the record has one, else the item's place in the state list it came from. A button,
    field or select inside a row acts on the item with that key ("that ticket", §9.7), also when
    the list on screen is filtered or derived from a state list. A row that shows a value with no
    item in any state list (computed on the fly) cannot be edited: its fields and selects change
    nothing (§9.11). A row inside a row (a list inside a row) has the inner record's key, else its
    place in its row's list; that key is unique within its row only, so the inner row is named by
    the path of keys, its row's and its own. The keys of a list inside a row stay unique within
    each row, and the keys of the list around it stay unique: a step that makes two the same fails.
    Removing a row removes the rows inside it. The key itself is never shown and never appears in
    examples, which name rows by position (`on row 2`) or by what they show (`on row with "Milk"`),
    one `on row` per level.
11. **Impossible or ignored actions** leave the state unchanged.
12. **References and nothing.** Removing a row leaves the `ref` fields that held its key as they
    are: nothing cascades; following such a reference gives nothing (§3). Comparing with nothing is
    Kotlin's `==` (§2): `whose @ticket's @status is @Open` does not hold when the ticket is gone. Two
    rows of a list a reference points into never share a key: a step that makes them fails.
13. **Loops** visit the rows a list had when the loop began, in its order (§5).
14. **Change rules** are checked on every event the app handles, on the data before and after it;
    rows are matched by their key, and a row that was not there before has no value before it (§6).
15. **Access** (an api with an `access` block): what no rule permits is refused, and a forbid that
    holds wins; a condition that reads nothing is undecided: a permit does not hold and a forbid
    does, the one exception to item 12 (§4f). An api with a key layer needs an `access` block.
16. **Requests.** A request body is at most 1 MiB by default; a larger one is answered `413
    {"error": …}` and not read. An anonymous caller's idempotency key is kept only when it has 32 or
    more hex digits (§4h). An open event stream passes the layers again before every event.
17. **Examples read what is there.** `see every … = …` in an example fails when the list is not on
    the screen (or not in the answer), or when a row lacks the element or field (in `always` those
    are skipped: the rule holds on every screen). A number on the screen is read as the harness
    writes numbers: a `.` for decimals and no thousands separator; `1,250` is read two ways and fails.
18. **Nothing on the wire.** A `T or nothing` is always written as `null`, never left out. On input,
    `null` and a missing key are both nothing. For a `T`, a missing key is `400 {"error": "<name> is
    required"}` and `null` is `400 {"error": "<name> must be <type>"}`.
19. **Order.** `sorted by` is a stable sort: rows equal on every key keep their list order. A key
    without a direction sorts lowest first (a number), earliest first (a day or a moment), A to Z (a
    text, character by character by the characters' codes: capitals before small letters, never by
    a locale), in its declared order (a choice), false before true. A field that may be nothing
    sorts its nothing last, in either direction. Every build sorts with the harness's sort, never one of its own.
20. **Starting.** Stored fields are restored before `on start` runs; `on start` sees what the app
    remembered, the first time (the defaults) and after every restart. Every other field starts from
    its default. An api has no `on start`: it starts from its defaults and what it stored.
