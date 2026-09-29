---
name: intent-spec
description: Write, refine, review and debug Intent specs (.intent files) and spec bundles, and turn a user's wishes into spec changes instead of code. Use when creating an app from a description, adding a feature or rule to an existing spec, fixing a bug in an Intent-built app, pointing from the running app back to its spec, or writing a reusable bundle in lib/.
---

# Writing Intent specs well

Intent describes **what an app must be**; the compiler (an LLM held in place by a harness)
makes the code. You never edit generated code: every change is a spec change. The full
reference is `docs/LANGUAGE.md` — read it before writing, it is also exactly what the
compiler reads. This skill is about using the language *well*.

Language version this skill matches: **1**, Intent 1, the first stable version (`docs/STABILITY.md`
says what stays the same across 1.x; `docs/CHANGELOG.md` holds the pre-1 history, v1–v73). If the
changelog shows a newer version (1.1, …), read what it adds first.

## 1. Understand the intent (interview)

Rules you add yourself go in `rules by ai { … }`; the user's go in `rules { … }`. Revise your own
freely; change the user's only when they ask.

Before writing, make sure you can answer these. Ask the user only what you cannot decide
sensibly yourself, and state the defaults you chose instead of asking about everything.

- **Data:** what things exist (records), their fields, the closed sets of values (choices),
  and realistic seed data (a `table`, 5–15 rows, including edge cases such as "almost full").
- **Screen:** what the user sees, top to bottom; what can they type, click, choose, toggle?
- **Several people or devices?** Then there is a service (an api, §5d) and a contract between it
  and the screens (§5e): what does it accept and answer, which statuses, and what does the screen
  show for each refusal?
- **Who may do what:** who are the callers, which roles do they hold (one grant per person and
  role), what may each role do, which rows are theirs ("only the owner deletes"), may anyone act on
  their own row ("four eyes")? Only a service keeps such a promise (§5g).
- **Time:** deadlines, expiry, "due", "overdue", recurring work. What is the clock at the start of
  the examples, and at the exact boundary ("exactly 24 hours before") is it in or out?
- **Generated codes and secrets:** is anything handed out at random (a booking code, a pickup
  code, a key)? How long, from which characters (read aloud? typed back?), unique among what, and
  can it be guessed (§5n)?
- **Rules:** what must always hold ("never below zero", "at most 3 in progress"). These
  become `always` checks where they can be observed, and sentences otherwise.
- **Edge cases:** empty input, invalid input, duplicates, nothing found, the limit being
  reached, the last page, a row someone else changed or removed. For each one, decide what happens
  and write it down.
- **Order and ties:** every list needs an order. Every sort needs a tie-breaker.
- **Exact texts:** every message the user sees, written as an exact template.

**What you decide, and what you ask.** Decide what has one sensible answer and say what you chose:
trimming input, a blank field disabling its button, the tie-breaker (the id), the order of a new
row, what an empty list shows, the wording of a plain refusal. Ask what is a policy of the user's:
deadlines and their boundary, who may do what (and whether a person may undo their own action),
what happens to other data when something is cancelled or removed (does the slot free up?), limits
and quotas, how codes look to the people who read them, and anything about money. Ask one question
at a time, and propose an answer they can accept.

A spec is ready when you could compute every example's expected value by hand.

## 2. Reuse first

Look at the project's bundles and the standard library before writing anything yourself (the
tools' reference lists the standard library, with every param):

- Paging: `use pager = Pager { items = sorted }` (from `std.list`): show `@pager.visible`; `size`
  is 5 unless you say.
- Messages after an action: `use toast = Toast` (from `std.feedback`); set `@toast.message`.
- Emails and secrets: `import std.text` gives `Email` and `Token` (128 bits).
- A service's plumbing: the layers `std.http.secure`, `std.http.cors`, `std.http.apiKey`, and
  `std.http.sendKey` for the screen (§5g); agreement before an external call: `std.actions` (§5i).
- A domain bundle of the project (records and choices that several apps share), when there is one.

Import with `import std.list`. Import every bundle whose names you use, also when they would
arrive through another spec: a screen that `uses support.ticketsApi` gets the contract's own records
with that line, and writes `import support.tickets` only for the names of the domain bundle the
contract imports (`Ticket`, `@Solved`). A contract is never imported. Place a component with `use name = Component { … }`, with its
bindings in the block (`items = sorted`, no braces around the value) and, when needed, `visible when …`. Then refer to its
names as `@name.x` in your sentences and handlers (`set @toast.message to "Saved"`), and as
`name.x` in examples (`click pager.next`). A bundle's `design` becomes yours; your own
`design` lines override it. If a bundle
*almost* fits, do not copy it into the app: note what is missing (a param, a component) as a
candidate change to the bundle, and tell the user.

## 3. Write the spec

Order: `app` → `language 1` → `import` → `design` / `component` → `choice` → `record` → `state` →
`derive` → `screen` → `on …` → `rules` → `always` → `example`s.

Every spec says `language 1` on the line after its header: the lowest version it needs (write
`language 1.2` only when it uses something 1.2 added). A spec without the line means `language 1`,
but `intent publish` refuses it, and `intent fix` adds it. An old `language v73` line reads as
`language 1` with a `LANGUAGE` warning; `intent fix` rewrites it.

Write every block with braces (`screen {` … `}`), indented 2 spaces inside, and run
`intent fmt <file>` when unsure: it lays the file out the canonical way. `intent fix <file>`
applies the mechanical fixes the checker names (an unmarked name, a missing `import`, and every
older spelling the checker marks `SPELLING`), each only when it adds no error. Read its output: `not fixed — …: it would add …` is a
fix it left out (with the error it would have caused), `needs you — …` is a judgement it will not
guess (a word that may be the request's `@path.id` or a field, a name a sentence has twice), and it
lists every error left. Running it twice changes nothing. Every command and
diagnostic code is in `docs/TOOLS.md`; the language itself is `docs/LANGUAGE.md`.

In every sentence, mark what you refer to with `@`: `- set @count to 0`,
`enabled when @draft is not blank`, `add an @Item with @title = @draft`. Words without `@` are
prose. When the checker hints `UNMARKED`, decide: mark the word, or reword the sentence if you
meant the English word ("the page shown" when `page` is also state).

Habits that make builds identical *and* correct:

- **Name everything the user sees** on the `screen`. Anything not named there does not exist.
- **Templates are exact:** `text left = "{count} left"`. Formats come from §9 (money,
  decimals, clock); rounding uses the words "rounded", "rounded up" and "rounded down".
- **Put logic in `derive`,** one named value per concept, in plain but exact sentences:
  `the @tickets whose @status fits @statusFilter sorted by @id, highest first`. Say the order, the ties
  and what "empty" means.
- **Handlers are ordered steps,** one per line, including the "otherwise" branch and what
  gets cleared.
- **Turn the purpose into `always` rules.** If the purpose says "at most three in
  progress", write `always see doing has at most 3 rows`, and guard every path that could
  break it. The compiler will refuse (`SPEC CONFLICT`) when a path is unguarded.
- **Examples prove behaviour:** one per important behaviour and edge case. Compute the
  expected values by hand, and re-check the arithmetic: wrong examples are the most common
  spec bug. Use `on row with "…"` rather than row numbers where a row is known by its text.
- **Mark `snapshot "…"` at the states whose look matters** (dialog open, empty result,
  the main page).
- **Looks:** set a `design` (or import one), use presentations (`as card`, `as table`,
  `as dialog`, …), and give components a base (`component StatCard as card "…"`), so their
  look sentence only describes the difference. The look shows only what the spec names.
- **End-of-line comments are notes the compiler reads.** Use them to explain a field's
  meaning (`remaining: Int = 1500  # seconds left`).
- **Structure, not prose, for choices:** `if <condition> { … } else if … { … } else { … }`;
  `stop` ends a handler, `answer …` ends an endpoint. Give a chain of statuses one `if … else if
  … else`, never separate `if`s (with separate ones, more than one can apply). Use "that <item>"
  for the clicked row in a handler, and "its" for the row's item in a row expression (§5 of the
  reference).
- **Structure, not prose, for loops:** run steps once per row with
  `for each @notice in @notices whose @expiresAt is at or before @now { … }` (`whose` names the
  rows' fields alone, as a lookup does); inside, read the row's fields with `'s`: `@notice's
  @expiresAt`. The loop's name exists only inside the block (don't reuse an app name for it), the block visits the rows
  the list had when it began, in order, so removing the current row is fine, and an empty list
  runs it no times.
- **Lists:** `list items of Item { … }` declares the row's elements inside the block; `list tags
  of Text` shows each value as a row and has no row block. Check either with `see x has N rows`.
  A `field` inside a row edits that row's item (type into it with `type "…" into x on row N`); a
  `select` inside a row sets that item's choice field (`choose Done in status on row N`). The row's
  key names the item, and §9.7 is the default.
- **Parts a row owns are a list inside the row** (a task's checklist, an order's lines, a recipe's
  ingredients): `items: List Item = []` in `record Task`, and `list items of Item { … }` inside the
  `tasks` row. Things that live on their own or are shared (a ticket's comments, a book's author)
  stay a list of their own with a `ref` back. Seed inner rows in the table cell:
  `[{ id = 1, label = "Milk" }, { id = 2, label = "Eggs", done = true }]`. In an inner row's
  handler, "that item" is the inner row and "that task" the row around it; write to the row's list:
  `add an @Item to the end of that task's @items with @id = the highest @id in that task's @items + 1,
  or 1 when there is none, …`, `remove that item from that task's @items`, `clear that task's
  @newItem` (a per-row draft is a field of the row's record). Name inner rows innermost first in
  examples: `toggle done on row 2 on row 1`, `click removeItem on row with "Milk" on row with
  "Groceries"`, `see items on row 1 has 3 rows`; give one example that acts in the second outer row,
  so a build that finds the right item in the wrong row fails. An inner key is unique only within
  its row (a drawn inner key says `not among that task's @items's @code`): a selection of an inner
  row keeps both keys (`chosenOrder`, `chosenLine`) and a handler
  finds it in two steps (`if there is no order in @orders whose @id is @chosenOrder { stop }`, `if
  there is no line in that order's @lines whose @id is @chosenLine { stop }`). `@orders's @lines`
  is every line of every order (it flattens). Two levels only: a list inside an inner row, or a
  record that holds a list of its own kind, is `NOT_YET`.
- **Absent is `nothing`, and it works like Kotlin's null:** a value that may be missing is
  `T or nothing` with default `nothing`; never a stand-in like `0` or `""` with a comment explaining
  it. A `T or nothing` is not a `T`: the checker refuses it (`NOTHING`, an error) wherever a `T` is
  needed — adding, ordering (`is above`), trimming, showing it (an element's value, a template's
  hole), counting, `increase … by`, a field or state of type `T` — until the sentence handles it.
  Lookups (`the ticket whose …`), `the highest … in @xs` and reads through a reference
  (`its @ticket's @subject`) give one too. The ways to handle it (there is no forced unwrap):
  - **say what then** (the elvis), always as `…, or B when there is none` after the value it is
    for: `@discount, or 0 when there is none`, `the highest @id in @items + 1, or 1 when there is
    none`. It covers everything before it that may be nothing. The fallback is a `T`; `…, or
    nothing when there is none` only fits a `T or nothing`.
  - **ask first** (a smart cast): `if there is a @selected { … }`, an early
    `if there is no @selected { stop }` (or `answer 404 …`), the `else` of `if there is no @x`,
    `there is a @x and @x is above 3`, `@x when there is a @x, otherwise 0`, `visible when there is
    a @selected` on the element or a section around it, and for a reference's row
    `if that comment's @ticket does not exist { stop }`. Ask only with `there is a @x` / `there is
    no @x` (`@x is set`, `@x is not nothing` are older spellings); `nothing` is a value: `set @x to
    nothing`. A step that changes @x (`set`, `clear`, or a step inside an `if` that may run) ends
    the cast: ask again after it. A cast from `visible when` reaches the values shown inside the
    element, never the handlers of its buttons: a handler asks again (`if there is no @x { stop }`).
  - **keep it nothing**: assign it to a `T or nothing` (`set @chosen to the ticket whose …`).
  Comparing is always allowed (`@x is "a"` is false when there is none; `is not "a"` is true).
  When you add a fallback, pick what the examples and the purpose imply, and prove it with an example
  where there is none (a removed row, an empty list); `intent fix` never invents it.
- **References are checked, the English is not:** `set @count to @draft`, `increase @draft`,
  `@status is @Urgent` (a value of another choice) and `@ticket's @name` (no such field) are errors
  before any build. So are relations: a `ref Ticket` is compared with a Ticket's key only, is
  followed to its row (`@comment's @ticket's @subject`, which may be nothing), and seeded rows point
  at seeded rows. Give a derived value its type when the checker asks (`UNTYPED`:
  `total: Decimal = …`), so every sentence that uses it is checked too.
- **Say which row.** "that ticket", "this habit", "its @status" need a row found or chosen before
  them: the clicked row, a loop row, a lookup, or a new record. After a lookup (`the ticket whose
  …`, `if there is no ticket whose … { stop }`) it is "the ticket" or "that ticket"; after `add a
  @Ticket …` it is "the new ticket". In an endpoint whose request names the row (`path id: ref
  Ticket`), "that ticket" is that row once you ask: `if that ticket does not exist { answer 404
  "No such ticket" }` (reading it before is `NOTHING`). Otherwise the checker stops (`NO_ROW`):
  two compilers would each pick one.
- **Quality rules are the project's.** `std.quality` is on by default; a team adds its own rule
  set and sets levels in `intent.project` (`quality { use ./quality/team.ts  UNMARKED off }`).
  Fix what the project raises to `error`; treat the rest as the backlog.
- **Prefer the typed forms** (`plus`, `divided by, rounded down`, `trimmed`, `the number of`, `the sum
  of … over …`, `A when C, otherwise B`): the checker types them whole. Run `intent check --typed`
  on a spec: the sentences it lists are the ones left to judgement — make sure each is judgement on
  purpose, and prove it with an example.
- **References are declared, not a comment:** write `ticket: ref Ticket` for a field that holds
  another record's key. The key is the field named `id`, or the one marked `key` (`key code:
  Text`); never rely on field order. **Follow it** to read the row: `its @ticket's @subject, or
  "(removed)" when there is none` — one fallback for the whole chain, several hops allowed
  (`@book's @author's @country's @name`); the row may be gone, so a value says what then. It is
  found in the record's home list (the one `List Ticket` in state); with several, name it on the
  field: `ticket: ref Ticket in tickets` (else `HOME`). Ask whether the row is there with
  `its @ticket exists` (enable a button, guard a handler); to change the row, guard first and write
  to "that ticket" (`if that comment's @ticket does not exist { stop }` then `- set the @status of
  that ticket to @Closed`), else `NAV_WRITE`. A filter through a reference (`the @comments whose
  @ticket's @status is @Open`) leaves out rows whose target is gone. Don't look a reference's row up
  by its key (`the @subject of the ticket whose @id is @ticket`): that is following it (`SPELLING`,
  `intent fix` rewrites it). Other lookups say `whose` (not `where`) and what happens when they find
  none. Give an example where the target is removed.
- **Name intermediate values** in `derive` (`quantity = amount read as a whole number`)
  and use the name in templates and sentences, instead of repeating phrases.
- **Watch templates with holes that can be empty** (`"{date} · {location}"` shows ` · `
  when nothing is chosen). Give the empty case its own text or hide the element.
- **Validity rules are types, not sentences.** For an email, a code, an age, an amount or a
  length, use or declare a refined type (`import std.text` for `Email`, `type Age = Int from 0 to
  150`, `type Title = Text of length 1 to 80`) and
  write "is a valid Email". Don't describe the rule in words: two compilers read words
  differently, but they check a type the same way.
- **Template holes** hold a name, a row field, a name with a format (`{total as money}`) or a
  short phrase over names; name anything longer in `derive`. A hole that can be empty
  (nothing chosen yet) needs its own text for that case.
- **Per-row and numeric invariants** go straight into `always`: `see every row of cart:
  qty is at least 1`, `see every row of events: confirmed is at most capacity`. Write one for
  every "never" in the user's words.
- **Anything that must always hold about the data** (across rows, over state not on screen,
  against the clock) is a sentence in `always`: `- no two @bookings have the same @table and
  @slot`, `- no @Done has a @day after @today`. It is compiled separately and checked after every
  step of every example and random session. `rules` is only guidance: a rule with "never",
  "at most" or "no two" belongs in `always` (else `UNCHECKED`).
- **Rules about change** ("an approved expense can no longer change", "the balance only moves
  with deposits", "ids are never reused") are change rules in `always`. Reach for a named form
  first; the harness checks them itself on every event: `- an @Expense whose @status was
  @Approved never changes`, `- a @Ticket's @subject never changes`, `- @nextId never goes down`,
  `- a @Ticket's @status only changes from @Open to @Solved, from @Solved to @Open or @Closed`
  (list every allowed step; a value with no `from` is final), `- an @Expense is never removed`.
  Never a rule on the key itself (`a @Ticket's @id never changes` is `CHANGE`): rows are matched
  by their key, so a new key is another row; `a @Ticket is never removed` says it. Never through a
  reference either (`a @Comment's @ticket's @subject never changes` is `CHANGE`): write it on the
  record it belongs to, `a @Ticket's @subject never changes`.
  Only when those cannot say it, read the state before the step: `@balance is @balance before
  plus the sum of @amount over the new @deposits`, `every @status in the new @expenses is
  @Pending`. `@x before`, `was` and `the new @xs` work in `always` only (`CHANGE` elsewhere: a
  handler names the old value first). Rows are matched by key (`NO_KEY` without one) in the
  record's one state list (`HOME` with several: `an @Expense in @archive`). Still guard the
  handlers (`if that expense's @status is not @Pending { stop }`, else `BREAKS_RULE`), and prove
  each allowed transition with an example (else `TRANSITION_UNPROVEN`): the rule is what makes
  random sessions try every other path.
- **A select from a list** (`select payer from people.name`) edits a `Text or nothing` (`payer:
  Text or nothing = nothing`): nothing is "none chosen", shown as an empty placeholder. Un-pick with
  `clear @payer` or `set @payer to nothing` (never `""`), and have the handler that needs a choice
  ask first (`if there is no @payer { stop }`). A select that always has a choice (a default of its
  own, never un-picked) may stay `Text`.
- **Don't give a row element the same name as an app-level value** (`SHADOWED`).
- **Filters with "all"** are their own choice (`AnyCategory "All" | OnlyBrakes "Brakes"`).
  Relations between records are `ref` fields (`ticket: ref Ticket`), followed with `'s`.
- **Dates move in words:** `14 days after @today`, `the day before @today` (never `@today + 14`);
  moments by minutes and hours (`24 hours after @now`); measure with `the minutes between @now and
  that booking's @start` (or hours; `the days between` two days). Months and years are not units.
- **Order a list with `sorted by`:** `@chores sorted by @due, earliest first, then by @id`. Every
  sort names its tie-breaker; nothing sorts last, text A to Z by character codes (§9 of the
  reference). `, highest @id first` is the older spelling (`intent fix` rewrites it).
- **Say every case:** `A when @f is @X; B when @f is @Y` names every value of the choice, or ends
  with `, otherwise …` (a `TYPE` error otherwise).
- **A disabled button is proven, not clicked:** `see add is disabled`. An example that clicks it
  can never pass (the checker says so where it can tell).
- **Name things by their domain:** `type`, `class`, `when`, `new` or a record `Model` are fine
  names. Only Intent's own words are reserved (`key`, `nothing`, `true`, `false`, `random`, and the
  type words). A component's own names are qualified only where you use them (`@pager.page`, `click
  pager.next`); never declare `pager.page` yourself: that is what `intent expand` prints.

## 4. Check, review, build

`intent build` compiles twice: once normally, and once as a **probe** that takes a different
reading wherever the spec leaves room. If the two apps behave differently, the build stops
and explains what the spec leaves open, with the lines and the sentence or example to add.
Answer those questions in the spec, don't work around them. A spec that built identically
before is reused from the cache, at no cost.

```
node compiler/cli.ts check <spec>      # fix every error; read every warning
node compiler/cli.ts review <spec>     # what the defaults will decide for you (one LLM call)
node compiler/cli.ts expand <spec>     # what the compiler will read
node compiler/cli.ts build <spec> --styled --kit
node compiler/cli.ts converge <spec> --styled --kit --builds 3   # does it build the same app every time?
```

What the checker's warnings usually mean:

- `UNPROVEN`: the element is never checked by an example. Add a `see`.
- `UNANCHORED`: the sentence names nothing declared, so it is probably vague.
- `UNSCOPED`: inside a component, write its own names with `@` (`@page`).
- `UNMARKED`: a sentence uses a declared name without `@`. Mark it, or reword if you meant the English word.
- `IMPORT`: a name arrives through another spec. Add the `import` the message names.
- `NOT_YET`: the language cannot say this yet. Tell the user, and propose the addition
  (see "Growing the language" in the reference) instead of working around it.
- `LOCK`: a bundle changed. Review what changed before running `intent lock`. A changed model
  in intent.lock is a warning for `check`, but `build` and `converge` refuse it until `intent lock`.
- `NOTHING` on a template hole (`"Taken by {that ticket's @assignee}"`, in an `answer` message
  too): the value may be nothing. Say what then (`{…, or "someone" when there is none}`) or ask
  first (`if there is a @x { … }`).

When a build fails:

- **`SPEC CONFLICT: …`:** the spec contradicts itself. Fix the spec at the lines it names.
- **An example fails in every build, on both targets:** the example is probably wrong
  (check the arithmetic), not the compiler.
- **A divergence in the `converge` report:** the spec is silent about something (an order,
  a tie, a width). Add a sentence or an example. If the same silence would hurt every app,
  it belongs in the language: a default in §9 or a presentation's meaning.

## 5. Change an existing app

Always change the spec in the smallest local way, then check, then build.

- **New feature:** add the state and derived values, the screen elements, the handler, and
  an example proving it. Reuse a bundle if one fits.
- **New rule:** an `always` check (if observable), a sentence in `always` (also a change rule:
  "X can no longer change" is `- an @X whose … was … never changes`), or a `rules` sentence
  for guidance, and an example of the case it prevents.
- **Bug:** first write an example that reproduces it (it must fail), then fix the sentence,
  then confirm the example passes. The example stays, so the bug cannot come back.
  For an API, run the server with `INTENT_TRACE=1`: the `x-intent-source` header of the wrong
  answer names the spec line that gave it (a step, an endpoint, or a layer).
- **Look change:** the element's `look`, its presentation, a component's look, or the
  `design`. Prefer the most general place that is right: a design token over a component
  over an element.
- **The user points at something in the app:** its `data-el` is its spec name. Look it up
  in the build's `sourcemap.json` (`"pager.next" → the bundle's file and line, component Pager,
  bundle std.list`). If it comes from a bundle, decide whether the change belongs in the
  bundle (every app gets it) or in the app (for example a param, or an app-level handler).

## 5b. Build on someone else's app (refinement)

When a published app in `lib/` is close to what the user wants, `extends` it instead of
copying it (§4e of the reference):

- Change only what differs, each change named: `override text …`, `override state` / `derive`
  / `on …`, `add to <section> after <element>`, `drop …`.
- Run `check`. For every `OVERRIDES_PROOF` warning, decide: the base example still holds
  (keep it), or your change makes it wrong (`drop example "…"` and write your own version).
  The compiler reports `SPEC CONFLICT` for the less direct breaks; handle them the same way.
- `intent lock` pins the base. After a base update, review every `BASE_CHANGED` override.
- If your override would help everyone, propose it to the base (as a param or a rule)
  instead of keeping it private.

## 5c. Dependencies

Bundles from a registry are listed in `intent.project` (`requires std.list 1.2`) and
installed by `intent install` or `intent build`. Ask for the lowest version that has what you
need: minimal version selection never upgrades behind your back.

## 5d. An API instead of a screen

Write `profile api` and `endpoint` blocks (§4f of the reference). Reuse the same domain bundle
as the screen. New ids come from a counter in state (`stored nextId: Int = 9`, `@id = @nextId`, then
`increase @nextId by 1`): `the highest @id + 1` hands a deleted row's id out again (`REUSED_KEY`).
`for each` works in an endpoint too, also over a row's inner list. Every endpoint needs examples: the happy path, each refusal (`if … { answer 404 "…" }`), and a missing or invalid input (the harness answers those itself). Check list order
explicitly (`see listTickets.body[1].id = 9`). Declare what each endpoint answers, one line per
status: `answers 201 Ticket`, `answers 400 Problem` (never `returns`). When the request names a row,
declare its param a reference (`path id: ref Ticket`) and ask first: `if that ticket does not exist
{ answer 404 "No such ticket" }`; after it, "that ticket" is the row (`- set that ticket's @status
to @Solved`). When a field has the same name as a request param, write `@path.id` / `@body.room` in
the step to say which you mean (`the ticket whose @id is @path.id`). On the wire nothing is `null`,
always written; check it with `see x.body.assignee = nothing`, never `is absent` (that is only for
headers, events and paths outside the declared type). A `T` sent as `null` is refused with `400 … must
be …`, a missing one with `400 … is required`.

## 5e. Contracts between services

When a service is used by anyone else, write its **contract** first (§4h): records, endpoint
signatures and every status each may answer, plus examples that work on any implementation
(use `{createTicket.body.id}` instead of ids from seed data). A contract is a file in the
project's `lib/`, one area deep: `contract shop.ordersApi` is `lib/shop/ordersApi.intent`. Name it,
never give its path: `implements shop.ordersApi` in the service, `uses shop.ordersApi as orders` in
the screen, and `tested with "<the service's file, from the project's root>"` under `uses`. Run
`intent lock` after writing or changing it. Publish it. The service
`implements` it and writes only steps. Consumers generate a typed client with `intent client`.
Inside one app (between components, or a screen and its logic), there is no wire and no
contract to write: component params and the generated interfaces are the contract.

## 5g. What every API needs: use layers, don't write them

Never write CORS, API-key checks or security headers as endpoint steps. Use the standard layers
(§4j): `layer secure = std.http.secure` first, then `layer cors =
std.http.cors { … }` with the exact origins of the web pages, then `layer auth = std.http.apiKey {
… }` (`use` is for components). Keys in the spec are test keys. The key layer answers `401
"Missing API key"` or `401 "Unknown API key"`: an example can `see me.body.error = "Unknown API key"`. If a
concern repeats across APIs and no layer covers it, write a new layer (with its own examples
against the stub app) instead of copying steps.

**Who may do what goes in `access`, never in endpoint steps** (§4f). The key layer says who calls;
the `access` block says what they may do, and from then on everything else is refused (default
deny). Interview for it: who are the callers, which roles do they hold (a `choice`, and a `stored`
list of grants with `who: Text`, so an admin endpoint can change them), what may each role call,
and which rows are theirs ("only the assignee solves" is `an @Agent may call @solveTicket when that
ticket's @assignee is the @caller: "…"`, with the endpoint's param declared `path id: ref Ticket`).
A value is `that ticket's @status is @Archived` (name the field). Open endpoints are `- anyone,
without a key, may call @health`; `any caller` is any key holder. A `T or nothing` in a condition
is undecided when it is nothing: `is not the @caller` on an unassigned row refuses (so does a forbid
that reads it); write a second rule if that case must be let through.
Four eyes is a forbid on the row (`no one may call @approve when that expense's @submitter is the
@caller: "Someone else must decide on your own expense"`), and separation of duty an `always`
sentence over the grants. Write only the typed condition forms; for "or", write a second rule. Use
"the caller" in steps for what the endpoint records (a comment's author is the caller), never for a
refusal: an `if … the @caller … { answer 403 }` step is `HAND_ACCESS`. Declare the refusals in the
contract: `every endpoint answers 401 Problem` and `every endpoint answers 403 Problem`.

**Prove every rule both ways**: one call it permits and one it refuses, with `call x as "Ann" with
…` (the key layer knows Ann's key). Cover no key, an unknown key (`with header x-api-key =
"wrong"`), a key whose owner has no role, each role doing what it may and what it may not, each
forbid with its message, and `see audit[1].decision = "refused"` where the log matters.
`ACCESS_UNPROVEN` names a rule no example proves; after a build, `intent mutate <api> --build <dir>`
drops each rule in turn and lists the ones no example misses. A rule about hearing an event is proven
by a screen that shows what it heard (`--screen <screen.intent>=<dir>`).

A screen that calls such an API sends the user's key through a client layer: under its `uses`,
`through std.http.sendKey` with `key = <the state that holds the key>`. Signing in is then just
a field and a button that sets that state. The contract says `every endpoint answers 401
Problem`, so the screen can show the refusal's message. Examples: a wrong key, the right key,
and "before signing in, nothing arrives" (events from another client do not reach a screen
that is not signed in). With an `access` block on the api, another client in the screen's example
acts as someone (`call desk.solveTicket as "Lin" with id = 1`), the screen shows a 403's message
(`else { - set @problem to the error }`; a field of an answer or event is `its body's @f`), and it may leave out a button its user may not
use, from what a `me` endpoint answers (`visible when @manager`): a convenience, never protection.
A screen hears only the events its user may hear: show them (a list of what it heard), so an example
proves who hears what.

## 5h. Time

Use `Date` for days and `DateTime` for moments, and read the clock as `@today` / `@now`; never
invent a day counter or a "next day" button to fake time. Put `examples start at …` at the top
so every example has a known "now", and prove time-dependent behaviour with `wait 1d`,
`wait 30m`: the day after, the moment something expires, the edge ("exactly 60 minutes later"
is either in or out: say which). Recurring work in a service is an `every 15m { … }` block,
proven with a `wait` that passes its time.

**What survives a restart:** mark the state the user would be upset to lose as `stored` (their
items, their history, an API's records), and leave what belongs to one visit (a draft, a
filter, an open drawer) unmarked. Prove it with an example that changes both kinds, says
`restart`, and sees the stored part kept and the rest back at its default. For an API, also
check that new ids continue after a restart. Stored fields are back before `on start` runs, so
`on start` can use them (`if @apiKey is blank { stop }`, then load with the kept key); prove it
with an example that signs in, says `restart` and sees what `on start` loaded. An api has no
`on start`: what it starts with is its state's default.

## 5n. Chance: dice, shuffles, codes

A random value is drawn from a **type that lists its values**, never described in words: a
choice, an `Int from 1 to 6`, or a code, `type PickupCode = Text of 6 digits` (alphabets: `digits`,
`hex digits`, `capitals and digits`, `letters and digits`, `unambiguous letters and digits` for
codes people read out, or `from "…"`). Then `a random @Die`, `3 random @Die`, `a random one of
@deck`, `@deck shuffled`, `the first 5 of @deck shuffled`. Never derive a random value from a hash,
a clock or a counter (the held-out lockers api once made its pickup code from "the first 6 digits
in the @sha256 of @newToken": four judgements in one sentence, and an example that had to
hard-code the digest). `random` or `shuffled` outside those forms is an error (`RANDOM`):
`a random number from 1 to 6` is `a random @Die` with `type Die = Int from 1 to 6`.

- **Unique only when you say so.** A code that must not repeat is `a random @PickupCode not among
  the @code of @waiting`; under 2^64 values it can run out, so it is a `T or nothing`: name it in
  `derive`, then `if there is no @freeCode { answer 409 "…" }` and use `@freeCode` after. A key
  filled from a draw without `not among` is `COLLISION` (unless the type has 128 bits or more).
- **Each draw is one value.** Two dice are two draws. A secret that is stored and answered is
  drawn once and referred to (`… with @secret = a random @Token`, then `the @secret of the new …`),
  never drawn again in the answer (`REDRAW`). A fresh secret is `a random @Token` (`import std.text`).
  A derived value that draws is one value per request (or recurring run): read it as often as you
  like in that endpoint, also after storing it; to keep it for later requests, store it (`add … with
  @code = @freeCode`).
- **Draw in handlers and endpoints**, keep the value in state, and show the state: a draw in an
  element, a screen's derived value, `always` or `on start` is refused (`RANDOM`).
- **Steer in examples.** `steer random Die = 6, 6` before `click roll`; `steer random shuffle keeps
  order` to deal from the top; `steer random pick 3`; `steer random PickupCode = "308122",
  "308122", "555001"` proves that a taken code is skipped. Steered values go to the draws in the
  order the steps say (the spec's order, whatever order a build evaluates in). A steered value
  never drawn fails the example, so steer right before the step that draws. Never compare an
  unsteered value with a literal (`UNSTEERED`); carry it forward (`code = {deposit.body.code}`).
- **Guessing.** A code taken back as input (a pickup code, an invitation) under 128 bits can be
  guessed without an attempt limit (`GUESSABLE`): prefer longer codes, or say so in the purpose.
  Codes for people to type: `unambiguous letters and digits` (read forgivingly: `k7mq-or1z` is
  `K7MQ0R1Z`). For no 0, O, 1, I or L at all, list the characters: `Text of 6 from
  "23456789ABCDEFGHJKMNPQRSTUVWXYZ"`.
- **A screen over a service that draws** steers the service's draws from its own examples:
  `steer random BookingCode = "M8TX3Q"`, click, then `see code on row 3 = "M8TX3Q"`. `wait` moves the
  service's clock too.

## 5l. Hashing, checking specs: platform functions

Never describe a hash, a checksum or a checker in sentences. Import the platform that has it
(`import std.crypto` for `@sha256`, `import intent.tools` for `@check`) and name the function in a
sentence. If a service must not trust what a client sends (a version, a digest), compute it with
a platform function (`@digest = the @sha256 of the given @source`). A screen can use a pure platform
too, in both targets (`std.crypto`'s `@sha256`); `intent.tools` runs in the harness, so it is for
services.

## 5m. Jobs and sizes

An agent or background worker nobody looks at is a job: `profile job`, no `screen`, the rest as
usual (`uses`, `on event`, `on start`, a clock). Its state is what examples `see`: write
`see passedOn = 1`, not a screen. A job builds on the TypeScript target only (its entry, `job.mjs`,
is TypeScript); `intent build` picks it. A widget a host shows small or large declares
`sizes Compact | Standard` (choice values) and says what each shows with `visible when @size is
@Standard`; prove both with `size Standard` in an example.

## 5k. Several screens

When an app has pages (a list and a detail, a catalogue and a publisher page), give each screen a
name and an address: `screen ticket "/tickets/{id}" { path id: Int … }`. Move with
`go to @ticket with @id = …` and `go back`; load what a screen shows in `on open <screen>`, not in
the click that led there, so the address and the back button work too. Element names are unique
within a screen; two screens may reuse a name (`back` on both) for the *same* element: one kind,
one `on click back` handler for both. If the two should behave differently, give them different
names. The build's `sourcemap.json` keys them by screen (`about/back`). Prove it with examples that `open "/tickets/3"`, `go back`, and
`see screen = …`. Don't fake pages with
sections shown or hidden.

## 5j. Sign-up, keys and secrets

Keys that users create live in the app's stored state and the key layer reads them from there:

```
layer auth = std.http.apiKey {
  keys = apiKeys
  public = "POST /signup"
}

state {
  stored apiKeys: List ApiKey = []
}
```

 A new secret is `a random @Token` (`import std.text`: 32 hex digits, 128 bits; never invent one
from a name or a counter), drawn once where it is stored and referred to after (§5n); examples
steer it (`steer random Token = "0123…"`). Open only what must be open, and by method:
`"GET /bundles/*"`, not `"/bundles/*"`, when writes must stay behind a key. With an `access` block
(§5g), say it there instead: `- anyone, without a key, may call @signup` (the harness binds
`public` from it).

## 5i. Effects: money, mail, other companies

When an endpoint reaches outside the system, mark it `effect external` in the contract and say
what takes it back: `undone by refund with id = @charge.body.id`. If nothing can take it back
(an email, a message to another company), leave out `undone by`: it is a point of no return, and
in a handler it goes after every call that can still fail. Don't mark endpoints that only change
the service's own data, and never annotate handlers: their effects follow from what they call.

The harness makes calls effectively once (keys, sending again, recognising repeats); you don't
write any of that. What you do write: what the screen shows when the outcome of an external
call is **unknown** (`else if its status is unknown { … }`: "don't pay again, we'll let you
know"), and examples that make the way go wrong: `steer pay lose answer` then two clicks prove
nothing was charged twice; `steer pay fail 3` proves the unknown message; `steer pay slow` (a retry
while the first still runs), `steer pay restart after effect` (the service restarts with its keys
kept) and `steer pay expire keys` (a late retry after the keys expired runs again) prove the rest.

To take an effect back, keep the original call's answer in state (`charge: Charge or nothing`) and
write `undo @pay.charge` in the handler; the harness calls the `undone by` endpoint with the bound
arguments from that answer, so you never reassemble a refund. Handle the undo's answer with
`on answer pay.refund` (the checker warns `NO_HANDLER` without it), and prove a lost answer does
not refund twice: charge, then `steer pay lose answer`, then click refund and see one refund.

When a person must agree first, add `through std.actions { agree = permissions  rejected = rejected
stop = stopped }` under `uses`: an `effect external` call goes out only when a `Permission` in
`permissions` covers it (`endpoint`, `count` calls per `per` minutes, the most each may `upTo`, and
`approver`; `per`, `upTo` and `approver` may be `nothing`); with no permission it waits. For an
amount limit, the contract says which param is the amount: `effect external of @amount`. Give the
user an Approve button that adds a permission (the harness then sends the held call with its
original key) and a Reject button that adds the endpoint to `rejected` (the calls held then are
dropped; the next one waits again); none goes out while `stopped` is true. A one-time grant is
`@count = 1, @per = nothing`, and each grant is used once. With `fourEyes = true` a permission the
`requester` granted themselves does not count. The answer handler hears `its status is held` when the call waits and `its status is rejected`
when it is dropped, so show the wait from there (only for an `effect external` endpoint of an api
used `through std.actions`: anywhere else `held`/`rejected` is an `EFFECT` error). Prove held → approved, rejected then the next one
approved, and stopped. `std.actions` is a brake, not access control: it
holds an agent's calls until a person agrees (the host is trusted, the agent is not), and it cannot
hold back a person, who controls the browser. An approval that must hold against the user is a
state change on the service by a second person, refused by a forbid when it is the same person
(§5g). A spec that needs both writes both.

## 5f. A screen that uses an API

When an existing api spells choice values its own way (`"info"`), give the choice wire names in
the contract (`choice Level: Info = "info" | Urgent = "urgent"`) and keep writing `Info` everywhere
else: the harness translates at the edge.

Ask only for what the screen uses: `uses ouros.notes as notes only listNotes, noteCreated`. The
checker holds the app to that list and every build writes it to `manifest.json`, so a host grants
exactly those rights.

`uses <contract> as <alias>` plus `tested with "<provider spec>"` (§4i). Load data `on start`,
and handle every call's answer with `on answer`: the success status, and `else` for the
rest (show the Problem's error). The screen's examples run against the real provider with
its seed data, so write them from that data (`see rows has 8 rows`, the provider's newest
first). After a change (add, solve), call the list endpoint again instead of editing the list
locally: the screen then shows what the service holds, and two builds cannot drift apart.
When other people change the same data (shared lists, dashboards, chat), declare events in the
contract (`event ticketCreated: Ticket`), publish them in the service's steps, and handle them
with `on event` in the screen. Prove it with an example in which another client calls
(`call tickets.createTicket with …` in the screen's example) and the screen shows the change.
Handle each change in one place: if the event updates the list, the answer to your own call
should not update it again.

## 6. Write a bundle

- Start the file with `bundle area.name` in `lib/area/name.intent`. A bundle holds records,
  choices, components and a design. Behaviour lives inside components.
- In components, declare `param`s (with defaults where sensible), and write every own name
  and param with `@` (`@page`, `@items`).
- Prove the bundle with a demo app, `lib/area/name.demo.intent`, whose examples cover its
  behaviour. Build it before other apps rely on it.
- After any change: check the demo and the apps that use the bundle, then run `intent lock`.
  A bundle change affects every app, so review it like an API change.
- Publish with `intent publish lib/area/name.intent` (the spec needs its `language 1` line). The
  version is computed: a removed or changed name, field type, wire name, `always` or change rule,
  contract event, or a changed demo example is a new major version. Add, don't change, when you can.

## Lessons from authors

Two authors who knew only the reference and the bundles wrote specs that built as **the same app
in every build** on the first attempt. Their looks converged less than specs written with
the harness in view. What they stumbled over, now fixed in the reference, is worth
remembering when you write or review a spec:

- the module system was missing from the reference, so they learned it from the demo app:
  keep the reference complete, and keep demos for every bundle;
- natural names were rejected (`Event`, `type`, `class`): only Intent's own words are reserved now;
- `visible when` under `use` and `as` after a long expression were unclear;
- a component's own state can go stale (a page past the end): components must clamp
  or reset their own state, not every app;
- "confirmed never exceeds capacity" can now be an `always` check per row (v14); authors
  before v14 had to keep it in words;
- the second round of authors (reservations, library) asked what may go inside `{…}`, how to
  add a record and hand out ids, and how to un-pick a select; these are now in the reference
  (§4, §5);
- the third round of authors (expense approvals, parcel lockers; v63) wrote specs that check
  clean from the reference alone. What they had to piece together:
  - a number typed into a field is asked with `@amount reads as a decimal above 0`, then used
    as `@amount read as a decimal`; "more than zero" in cents is `Decimal from 0.01`;
  - `as money` gives two decimals and no currency sign: write `"€ {@total as money}"`;
  - "cannot change once approved" was a rule about changes, which `always` could not say before
    v67: now it is `- an @Expense whose @status was @Approved never changes`, next to the guard
    in the handlers (`if that expense's @status is not @Pending { stop }`) and an example;
  - a random code of digits had no form (v69 added it: `type PickupCode = Text of 6 digits`,
    `a random @PickupCode not among the @code of @waiting`, and `steer random` in examples);
  - a contract example that needs a key only runs against an implementation with that key:
    keep it in the implementation's examples;
  - "a manager approves or rejects" could not be said: a screen has no notion of who is acting, so
    anyone approved anything, their own expense too. Since v70 that promise lives on a service
    (roles, and four eyes as a forbid), and a screen-only app that
    makes it gets `UNENFORCED`;
- an independent review of the harness (v71) found checks that passed on nothing: `see every` on
  a list that is not there, a crash counted as twin agreement, a refinement's access rules never
  checked. A check of nothing now fails. Write `see every` about a list the screen shows, and give
  a path only the characters of a URL path (`/tickets/{id}`).
- a weaker model extending the language (v38–v58) added second spellings (`where` for `whose`,
  `see x.enabled` for `see x is enabled`, `relations` next to `ref`), stand-ins (`0` for "forever"),
  and prose guards to silence a warning (", when there is one"). Before adding a construct, look
  for the one that already says it; write a guard as `if there is a … { }`; and never edit a
  held-out author's spec to quiet the checker.
- an independent language review before the freeze (v73) found several spellings for one thing.
  Each has one now, and `intent fix` rewrites the others (`SPELLING`): ask with `there is a @x` /
  `there is no @x`; fall back with `…, or B when there is none`; a loop picks rows with `whose`
  and reads `@row's @f`; an endpoint lists `answers <status> <Type>`; a server's layers are
  `layer auth = …`; an answer's message is `the error`; a select's "none" is `nothing`, never `""`.
  Two meanings were sharpened: nothing is `null` on the wire and always written, and in an access
  condition nothing is undecided (a permit does not hold, a forbid does).
- stamping language 1 found `answer 409 "Already taken by {that ticket's @assignee}"` in a
  reviewed api: an `answer` message's holes were not checked, and the assignee can be nothing.
  Every template hole is checked now; give a hole that can be empty its text for that case.
- the fourth round (language 1: a chores app, a clinic booking app, a to-do list built step by
  step) found:
  - all three authors wrote their contract next to their app and gave it as a path; a contract is
    named and lives in the project's `lib/` (§5e), and `tested with` gives the service's file from
    the project's root;
  - a screen could not be tested against a service that draws (a booking code): the harness now
    gives the service the example's draws and clock, so steer its codes from the screen's example;
  - an example clicked a disabled button to prove "nothing happens": prove it with `see x is
    disabled`;
  - a row field that may be nothing is asked about with `there is a @due` in the row, and in a
    filter as `whose there is a @due and @due is before @today`;
  - `the highest @id + 1` gave an undone delete a clash: new ids come from a counter;
  - "only the owner may delete" on a screen alone is a promise nobody keeps (`UNENFORCED`): it
    needs a service with an `access` block, and every handler becomes a call;
  - the interview that went best asked about the deadline's exact boundary, whether a cancelled
    slot frees up, and whether the desk may always cancel; the user raised that last one only when
    asked. Ask about policy; decide the mechanics.

## Keep this skill current

When the language changes (a new version in the changelog), update the version line at the
top and any section it affects. When a spec author, human or LLM, stumbles over something,
add the lesson here.
