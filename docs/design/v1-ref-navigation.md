# Design: following a reference

Status: proposed for v1. Since v59 a field `ticket: ref Ticket` holds a Ticket's key, and the
checker refuses to read it like a record: `@c's @ticket's @title` is a `TYPE` error that shows the
lookup to write (`tests/checker/fit.intent` line 120, `compiler/fit.ts` "`@a's @b`: … look it up").
So every read through a reference is spelled out:

```
text ticketTitle = the @subject of the ticket whose @id is its @ticket, or "(removed)" when there is none
```

That is precise but long, it repeats the key's name and the list, and it is the most common
sentence in apps with relations. This design lets a sentence **follow** a reference:
`its @ticket's @subject, or "(removed)" when there is none`, with the same meaning, the same
checks and no null.

## What experts and mature systems do

| Source | What it does | What we take |
|---|---|---|
| **Alloy** (Jackson, *Software Abstractions*): relational join `c.ticket.title` | Navigation is join. A missing link is the empty set, and the join of the empty set is empty: nothing propagates, no error, no null. `some c.ticket` asks whether it is there. | Navigation composes through several hops, and "nothing" propagates to the end of the chain. A condition over a missing link does not hold. |
| **SQL foreign keys** (`REFERENCES tickets(id)`, `ON DELETE …`) and joins | A foreign key names the table and column it points at. `INNER JOIN` drops rows whose link is missing; `LEFT JOIN` gives NULL; three-valued logic makes both `x = v` and `x <> v` unknown (filtered out) when `x` is NULL. `PRIMARY KEY` makes the target unique. | The reference resolves in one declared list (the record's home). The key is unique in it (checked). In a `whose` filter, a missing link makes the condition false both ways, as SQL's `WHERE`. Where SQL gives NULL, Intent requires the sentence to say what then. |
| **Datomic** (ref attributes, the pull API, `:ticket/_comments` reverse refs) | A ref attribute holds an entity id; pull follows it and nests the entity; a retracted target is simply absent from the result. | Following is a read, not a copy: the key is the stored fact; the row is looked up at read time. |
| **ORMs** (Rails `belongs_to`, `optional: true`; Django `ForeignKey`, `on_delete`) | `comment.ticket.title` reads through; a missing target is `nil` and the next `.title` raises, unless the association is declared optional and code guards it. | The navigation syntax, without the crash: the "or … when there is none" is required where an ORM would raise. |
| **Kotlin** `?.` and `?:`, C# `?.` and `??`, **Elm** `Maybe.andThen` / `Maybe.withDefault` | Safe navigation: `comment.ticket?.customer?.name ?: "(none)"`. Absence propagates through the chain; one default at the end. | Exactly this shape: a chain of `'s` is a chain of `?.`, and `, or X when there is none` is the one `?:` at its end. |
| **TLA+ / Z functions** | A function applied outside its domain is undefined; specs guard with `x ∈ DOMAIN f`. | "Defined when there is none" is part of the sentence, not an error at run time. |

Where we **follow**: a reference names one target list and its key (SQL FK), the target key is
unique (SQL PK, Alloy `lone`), absence propagates through a chain and is resolved once at its end
(Kotlin, Elm, Alloy), a condition over a missing row is false (SQL `WHERE`, Alloy's `some`).

Where we **depart**:

- **No null result, ever** (SQL, ORMs): a value read through a reference is `T or nothing`, and the
  sentence says what it is when there is none, as a lookup must today.
- **No reverse navigation** (Datomic `_ticket`, Rails `has_many`, Alloy `~ticket`) in v1:
  `the @comments whose @ticket is @id` already reads well and names the list. See the open questions.
- **No cascades** (SQL `ON DELETE CASCADE`, Django `on_delete`): §9.12 stays. Removing a ticket
  leaves the comments' keys as they are; navigation finds none.
- **Not a join over lists by default.** A chain through a *list* of rows drops the rows whose link
  is missing (Alloy), but keeps duplicates and order (SQL `JOIN` with `ORDER BY` of the source), not
  Alloy's set semantics: Intent lists are ordered and may repeat.

## The language

### Where a reference looks: its home list

A `ref Ticket` resolves in the record's **home list**: the one state field of type `List Ticket`
(not a derived value, not a component's state). When the app has none or several, the field names
it, as a SQL foreign key names its table:

```
record Comment {
  ticket: ref Ticket in tickets      # the ticket whose key it holds lives in @tickets
  body: Text
}
```

Without `in`, and without exactly one home, following the reference is `HOME` (an error; the same
rule and code as change rules in `v1-changes.md`). Holding and comparing the key needs no home, as
today. The seeded-reference check (a seeded comment points at a seeded ticket) uses the home too.

**The home's key is unique.** Navigation is a function only if two tickets never share an id.
The harness checks it after every step, like a primary key (and the checker checks it in seed
data): two rows with one key fail the build with the step that made them.

### Following

A reference followed by `'s @field` reads the field of the row it points at:

- `@comment's @ticket's @subject`, `its @ticket's @subject`, `that comment's @ticket's @status`,
  `@c's @ticket's @customer's @name` (several hops), `the @subject of @comment's @ticket`.
- `@comment's @ticket` alone is still the key (a `ref Ticket`): it is compared with a Ticket's key
  and stored as before. Only a following `'s @field` (or `the @f of …`) navigates.

**When there is none.** A value read through a reference is `T or nothing`: the target may have
been removed since (§9.12). The sentence says what then, with the same words as a lookup:

```
text ticketTitle = its @ticket's @subject, or "(removed)" when there is none
```

One `, or … when there is none` at the end of the chain covers every hop (Kotlin's single `?:`).

**In a condition**, a comparison through a missing reference does not hold, whether it says `is`
or `is not` (SQL's `WHERE`, Alloy's `some c.ticket and …`): `the @comments whose @ticket's @status
is not @Closed` leaves out the comments whose ticket was removed. This is a §9 default, so the
condition needs no fallback; a spec that wants those rows says so (`or whose @ticket does not
exist`).

**Asking whether it is there**: `@x exists` / `@x does not exist`, where `@x` is a reference
(`if that comment's @ticket exists { … }`). A reference is never nothing (its key is always there);
what may be missing is its row, so it has its own word, apart from `there is a @x` for a
`T or nothing`. Inside `if … exists { … }`, and after `if … does not exist { stop }`, the row is
there: "that ticket" names it (it satisfies `NO_ROW`), and reads through it need no fallback.

**Writing through a reference** is only allowed where the row is known to be there:

```
on click close {
  if that comment's @ticket does not exist {
    - set @toast.message to "That ticket was removed"
    stop
  }
  - set the @status of that ticket to @Closed
}
```

`set @comment's @ticket's @status to …` outside such a guard is `NAV_WRITE` (an error): a write
has no "or … when there is none".

**Through a list**, a chain flattens and drops the missing: `@comments's @ticket's @subject` is the
subjects of the tickets that the comments point at and that exist, one per comment, in the
comments' order (duplicates kept). It needs no fallback: an empty result is a list.

### Examples

A comment thread that stays correct when a ticket is removed (today's `apps/24-references.intent`
plus a removal):

```
list comments of Comment as timeline {
  text body
  text about = "on {its @ticket's @subject, or "a removed ticket" when there is none}"
  button openTicket "Open ticket" {
    enabled when its @ticket exists
  }
}

on click openTicket {
  - set @chosen to that comment's @ticket
}
```

Books, authors and countries (two hops, a filter through a reference):

```
record Country {
  key code: Text
  name: Text
}

record Author {
  id: Int
  name: Text
  country: ref Country
}

record Book {
  id: Int
  title: Text
  author: ref Author
}

derive {
  dutchBooks = the @books whose @author's @country is "NL"
  byline = @chosenBook's @author's @country's @name, or "unknown" when there is none
}
```

(`@chosenBook` is a `Book or nothing`: the chain starts from a value that may be nothing, and the
one fallback covers that too. `whose @author's @country is "NL"` compares the Author's `ref Country`
with a literal key.)

A loop over assignments that notifies owners (an api, `for each` with a guard):

```
every 1h {
  for each @task in @tasks where @task's @dueAt is before @now {
    if @task's @owner exists {
      - publish @overdue with @task's @owner's @email and @task's @title
    }
  }
}
```

## The checker

The `@a's @b` rule in `compiler/fit.ts` changes from "a reference is looked up first" (a `TYPE`
error) to: a `ref R` followed by `'s @b` has the type of `R.b`, made `or nothing`. The chain typer
(`typeExpr`, "a chain of fields") follows `Ref` like a record once `R` has a home, and marks the
result optional; a list in the chain flattens. Guards (`exists`) narrow it, as `there is a` narrows
`T or nothing` today.

| Rule | Code |
|---|---|
| following a `ref R` when `R` has no home or several, and the field has no `in` | `HOME` (new, error) |
| `ticket: ref Ticket in xs` where `xs` is not a state `List Ticket` | `TYPE` |
| `@c's @ticket's @nope` — `nope` is not a field of Ticket | `UNKNOWN_NAME` |
| a value read through a reference with no `, or … when there is none` and no `exists` guard | `UNGUARDED` (as a lookup) |
| `@x exists` where `@x` is not a reference | `TYPE` (write `there is a @x` for a `T or nothing`) |
| `set` / `increase` / `add … to` / `remove` through a reference outside an `exists` guard | `NAV_WRITE` (new, error) |
| `the ticket whose @id is @c's @ticket` — the lookup of a reference's key in its own home | `SPELLING` (hint; `intent fix` rewrites it to navigation) |
| comparing a navigated value: types as the field's (`@c's @ticket's @status is @Open` checks `Open` against Ticket.status) | `TYPE` |
| the home's key repeated in seed data | `DUPLICATE` |

`tests/checker/fit.intent` line 120 (`- set @draft to @c's @ticket's @title   # expect: TYPE`)
becomes `# expect: UNGUARDED` (the ticket may be gone), and a sibling line with `, or "" when there
is none` expects nothing.

The `SPELLING` hint keeps one spelling per form: reading a reference's own target is navigation;
a lookup stays the form for everything else (by a non-key field, in another list, by a value that is
not a reference).

## How it expands for the compiler

Resolving a key needs no judgement, so the harness owns it:

- **Generated helpers.** For every `ref` field with a home, the domain module gets a typed lookup:
  Elm `Refs.commentTicket : List Ticket -> Comment -> Maybe Ticket`, TS
  `commentTicket(tickets: Ticket[], c: Comment): Ticket | undefined`, both a first-match on the
  home's key. The invariants stage's `data.ts` gets the same helpers, so `always` sentences read
  through references the same way the app does.
- **`intent expand`** prints each navigation with its reading as a note, so the compiler (and a
  person) sees exactly what it means:

  ```
  text about = "on {its @ticket's @subject, or "a removed ticket" when there is none}"
    # its @ticket's @subject: Refs.commentTicket @tickets (the comment) → .subject; none → "a removed ticket"
  ```

- **The prompt** (`docs/LANGUAGE.md` §2 and §9) says: a chain through a reference uses the
  generated `Refs` helper and `Maybe.andThen` / `?.` per hop, and the sentence's fallback once at the
  end; a condition through a missing reference is false.
- **The source map** records, per sentence, the references it follows (`follows: ["Comment.ticket"]`),
  so a wrong value on screen leads to the sentence and to the relation it read.

## Runtime and harness behaviour

- Reads are lookups at the moment of reading; nothing is cached or copied. A removed ticket shows
  the fallback on the next render.
- The home's key is checked unique after every step (screens, apis, jobs), with the step that
  broke it.
- The fuzzer already removes rows; with navigation it matters most that sessions remove a target
  and then show its referrers. Action templates that remove rows of a home list are weighted up when
  some other list refers to it, so "(removed)" paths are exercised.
- Twin builds compare screens as now; a build that forgets the fallback shows something else
  than the other and fails the comparison, and the example that removes a ticket fails it directly.

## Example steps

No new steps. Examples see what the screen shows through navigation, and prove the missing case by
removing the target:

```
example "a comment on a removed ticket" {
  click open on row with "Cannot log in"
  click removeTicket
  see about on row 1 = "on a removed ticket"
  see openTicket on row 1 is disabled
}
```

## Test plan

Checker tests (`tests/checker/refnav.intent`, and `tests/checker/fit.intent` line 120):

1. `text t = its @ticket's @subject, or "(removed)" when there is none` in a Comment row — no diagnostic.
2. `text t = its @ticket's @subject` — `UNGUARDED`.
3. `its @ticket's @nope, or "" when there is none` — `UNKNOWN_NAME`.
4. Two `List Ticket` state fields, `ticket: ref Ticket` followed — `HOME`; with `in tickets` — none.
5. `ticket: ref Ticket in comments` — `TYPE`.
6. `@b's @author's @country's @name, or "?" when there is none` (two hops) — none; typed Text.
7. `the @books whose @author's @country is "NL"` — none; typed List Book.
8. `the @books whose @author's @country is 7` (Country key is Text) — `TYPE`.
9. `if that comment's @ticket exists { - set the @status of that ticket to @Closed }` — none.
10. `- set that comment's @ticket's @status to @Closed` without a guard — `NAV_WRITE`.
11. `if @draft exists { stop }` — `TYPE`.
12. `the ticket whose @id is its @ticket, or …` — `SPELLING` (and `intent fix` rewrites it, in `tests/fix.test.ts`).
13. A seed table of tickets with two `id = 1` — `DUPLICATE`.
14. `@comments's @ticket's @subject` typed as `List Text` (`tests/typed.test.ts`).
15. `@comment's @ticket is @id` still compares keys; `@comment's @ticket is @chosenComment` (a
    Comment's key) still `TYPE`.

Harness tests:

- `tests/harness/snapshot.ts`: the `Refs` helpers in both targets' domain modules and `data.ts`,
  and the expanded notes (`--update`, reviewed).
- A runtime test that two rows with one key in a home list fail the step that made them.
- A planted-bug converge run: a build that shows `""` instead of the fallback after a removal is
  caught.

Example apps to add or change:

- `apps/34-ref-navigation.intent`: the comment thread above with ticket removal, "Open ticket"
  enabled only while the ticket exists, and examples for both paths.
- `apps/24-references.intent`: rewrite its lookups as navigation where they read a reference's
  target (`intent fix` does it; measure converge before and after).
- `apps/api/library-api.intent` or a change to `apps/held-out-2/library.intent`: books → authors →
  countries, the two-hop chain and a filter through a reference.

## Open questions, with a recommendation

1. **A condition through a missing reference: false, or require a fallback?** Recommend **false,
   as a §9 default** (SQL's `WHERE`, Alloy's join): conditions are mostly filters, where dropping the
   orphan is what people mean, and a required fallback on every `whose` would be noise. Values keep
   their required fallback, because a value on screen must be something.
2. **Should `UNGUARDED` become an error for navigation?** Recommend keeping it the same level as for
   lookups (one rule for one meaning), and deciding the level for both together; a v1 that means
   "no null" should make it an error for both.
3. **Reverse navigation** (`@ticket's @comments`)? Recommend **not in v1**. `the @comments whose
   @ticket is @id` names the list and reads fine; a reverse name would be a second spelling and
   needs a declaration (which list, which field) that the lookup already carries. Revisit when specs
   show the same reverse lookup many times.
4. **Cascades** (`ON DELETE CASCADE`, restrict)? Recommend **no**: §9.12 stays, and what should
   happen to referrers is a handler step ("remove every comment whose @ticket is that ticket's @id")
   or a change rule (`a @Ticket is never removed` while comments point at it, `v1-changes.md`).
5. **`exists` next to `there is a`.** Recommend both, each for one thing: `there is a @x` for a
   `T or nothing`, `@x exists` for the row behind a reference. They are different facts (a key is
   always there; its row may not be), and the checker refuses each in the other's place (`TYPE`).
