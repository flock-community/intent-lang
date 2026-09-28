# Design: invariants over changes

Status: built in v67 (see "As built" at the end); proposed for v1. Before v67, `always` saw one moment: every `- sentence` is compiled to
`holds(data, clock)` (`compiler/invariants.ts`) and run on the data after every observation
(`compiler/exec.ts` `openSession`, `compiler/api.ts` `runApiJobs`). A rule about before and after
("an approved expense never changes") can only be a guard in the handlers plus an example, and the
changelog lists it as a next candidate. This design adds **change rules**: `always` sentences that
relate the data before a step to the data after it.

## What experts and mature systems do

| Source | What it does | What we take |
|---|---|---|
| **TLA+** (Lamport, *Specifying Systems*, 2002, ch. 2–8) | An *action* is a formula over unprimed (before) and primed (after) variables: `balance' >= balance`. A property of every step is `[][A]_vars`: every step satisfies `A` **or leaves `vars` unchanged** (stuttering). `UNCHANGED x` is `x' = x`. TLC checks action properties on every transition it explores. | Change rules are predicates over a *pair* of states. Steps that change nothing always pass (stuttering is allowed). "never changes" is `UNCHANGED`. |
| **Z** (Spivey, *The Z Notation*) | Operation schemas include `ΔState` (before and after, `x` and `x'`) or `ΞState` (nothing changes). | `never changes` is a Ξ over a part of the state. |
| **Event-B** (Abrial, *Modeling in Event-B*, 2010) | Invariants are single-state; each event has a *before-after predicate*; proof obligation INV: every event preserves every invariant. *Variants* (a natural number that every convergent event decreases) prove progress. | Keep single-state `always` as it is; change rules are the before-after part stated once for the whole app, not per event. `never goes down` is the dual of a variant. |
| **Alloy 6** (Jackson, *Software Abstractions*; Alloy 6 added mutable `var` fields, 2021) | `var` fields, prime `'` for the next state, temporal `always`. Facts like `always all t: Ticket \| t.id' = t.id`. | Same shape; we keep Alloy's point that frame conditions ("what does not change") are what people forget, so we give them a named form. |
| **Dafny** (reference manual: `old(e)`, `unchanged(e)`, `twostate predicate`, `modifies`) | Postconditions read the pre-state with `old(e)`; `twostate` predicates relate two heaps; `modifies` frames what may change. Also JML `\old`, Eiffel `old`, Ada 2012 `X'Old`. | A general form with one "before" operator for the cases the named forms do not cover: `@balance before`. |
| **SQL** | `CHECK` sees one row in one state; SQL-92 `CREATE ASSERTION` (whole-database invariants) was never widely implemented. Transition rules are written as `BEFORE UPDATE` triggers comparing `OLD.col` with `NEW.col` and raising. ORMs have `attr_readonly` (Rails), immutable columns. | Transition rules are common and wanted, but mature systems scatter them in imperative triggers. We state them declaratively, and keep the *check* in the harness (not in the app), as a trigger lives outside the application code. |
| **Statecharts / UML state machines** (Harel 1987) | Allowed transitions of a status are a table; anything else is not a transition. | `only changes from @A to @B` is that table, per choice field. |
| **QuickCheck state-machine testing** (Claessen & Hughes 2000; Hughes, *Experiences with QuickCheck*, eqc_statem), **Hypothesis** `RuleBasedStateMachine` | Random command sequences; postconditions relate the model before and after each command; failures are shrunk to a minimal sequence. | The fuzzer already generates sessions; change rules become postconditions checked after every event, and failures are reported as a paste-ready example. |

Where we **follow**: two-state predicates over whole steps (TLA+, Dafny), stuttering always allowed
(TLA+), a named frame form (Z Ξ, TLA+ `UNCHANGED`, Dafny `unchanged`), transition tables
(statecharts), checking by exploring random steps (TLC, QuickCheck).

Where we **depart**:

- **No primes, no `old()`.** Intent is English with `@` references. The named forms cover most
  rules; the one general operator is a word (`before`), and there is no way to talk about the
  after-state explicitly: a reference without `before` *is* the after-state (as in Dafny's
  postconditions, unlike TLA+'s symmetric prime).
- **Not per event.** Event-B and Dafny attach the before-after predicate to each operation. Intent
  states it once for the app, like TLA+'s `[][A]_vars` and Alloy facts: a rule holds for every
  handler, answer, event, tick and request, including the ones written later. That is the point of
  a spec that grows by small changes.
- **Checked, not proved.** Like TLC and QuickCheck, not like Event-B or Dafny: the harness checks
  the rule on every step of every example and random session. Proof is out of scope.
- **Rows are matched by key**, not by object identity (Alloy atoms) or position: a record list
  needs a key (`NO_KEY`), as a `ref` does.

## The language

A change rule is a `- sentence` in `always` that uses one of the change forms below. Everything
else in `always` stays a one-moment rule. Change rules are in the same block because they are the
same kind of promise ("this holds, whatever the user does"); they differ only in what they read.

### Named forms (harness-compiled, no judgement)

| Form | Means |
|---|---|
| `<subject> never changes` | after every step, the subject is what it was before |
| `<subject> never goes down` / `never goes up` | a number or a moment: after ≥ before / after ≤ before |
| `<subject> only changes from @A to @B [or @C][, from @D to @E …]` | a choice (or `Bool`) field: each change is one of the listed pairs; a value with no `from` never changes once reached |
| `<rows> is never removed` | every such row that was there before is still there (by key) |

Subjects:

- a state field: `@currency`, `@balance`;
- a field of every row of a record: `a @Ticket's @id` (the rows of the record's home list, below);
- the rows of a record, optionally narrowed: `an @Expense`, `an @Expense whose @status was @Approved`;
- `in @xs` names the list when the record has more than one (`an @Expense in @archive never changes`).

**The home list** of a record is the one state field of type `List R` in the app (not a derived
value, not a component's). With none, or more than one, a rule that says `a @Ticket` must say
`in @xs` (`HOME`, an error). The same rule gives a `ref Ticket` its list in
`v1-ref-navigation.md`: one concept, one check.

**Row rules** read one row across the step: the row with the same key before and after. For
`never changes` a row rule means the row is still there with every field equal (removing an
approved expense changes it); a *field* rule (`a @Ticket's @id never changes`) only compares rows
that are there in both states (removing a ticket does not change an id). `whose … was …` picks the
rows by the state before the step; `whose … is …` by the state after.

### The general form (compiled by the invariants stage, with its probe)

For what the named forms cannot say, a sentence may read the state before the step:

- `@x before` is `@x`'s value before the step (Dafny `old(x)`). It has `@x`'s type.
- `was` is `is` in the state before the step, in a condition: `whose @status was @Approved`,
  `@phase was @Done`.
- `the new @xs` are the rows of `@xs` whose key was not there before; `the removed @xs` the rows
  that were there and are not now. Both are lists of `@xs`'s items, in list order. A list of plain
  values (`List Text`) compares as a multiset.

Everything else in the sentence is the language that one-moment `always` sentences already use.

### Examples

An expense approval app (`apps/held-out-3/approvals.intent`, with the rules it wanted to state):

```
always {
  - no two @expenses have the same @id
  - an @Expense whose @status was @Approved never changes
  - an @Expense whose @status was @Rejected never changes
  - an @Expense's @status only changes from @Pending to @Approved or @Rejected
  - every @status in the new @expenses is @Pending
  - an @Expense is never removed
}
```

A ledger (an api, where each request is a step):

```
record Deposit {
  id: Int
  amount: Decimal
}

record Withdrawal {
  id: Int
  amount: Decimal
}

state {
  stored balance: Decimal = 0
  stored deposits: List Deposit = []
  stored withdrawals: List Withdrawal = []
}

always {
  - @balance is @balance before plus the sum of @amount over the new @deposits minus the sum of @amount over the new @withdrawals
  - a @Deposit is never removed
  - a @Deposit's @amount never changes
}
```

A helpdesk (frames and a state machine):

```
always {
  - a @Ticket's @id never changes
  - a @Ticket's @customer never changes
  - a @Ticket's @status only changes from @Open to @Solved, from @Solved to @Open or @Closed
  - a @Ticket's @openedAt never changes
  - @nextId never goes down
}
```

A habit tracker (a moment that only moves forward, and history that is append-only):

```
always {
  - @lastSync never goes down
  - a @Done is never removed
  - every @day in the new @dones is @today
}
```

## The checker

A sentence in `always` is a change rule when it has one of the change forms (`never changes`,
`never goes down/up`, `only changes from`, `is never removed`, `before` after a reference, `was` in
a condition, `the new @xs`, `the removed @xs`). Its types:

| Form | Must hold | Code |
|---|---|---|
| `a @R's @f never changes` | `f` is a field of `R`; `R` has a key | `UNKNOWN_NAME`, `NO_KEY` |
| `an @R [whose … was/is …] never changes`, `is never removed` | `R` has a key; the condition is a typed condition over `R`'s fields | `NO_KEY`, `TYPE` |
| `@x never goes down/up` | `@x` is a number or a moment (or a field of one) | `TYPE` |
| `… only changes from @A to @B …` | the subject is a choice or `Bool` field; every value belongs to that choice; no pair is listed twice; no `from @A to @A` | `TYPE`, `DUPLICATE` |
| `@x before` | `@x` is state, a derived value, or a field of a row the sentence reads; the result has `@x`'s type | `TYPE` |
| `whose @f was @V` | as `whose @f is @V` | `TYPE` |
| `the new @xs`, `the removed @xs` | `@xs` is a list in state (or derived); a list of records has a key | `NO_KEY`, `TYPE` |
| `a @R` without `in @xs` | `R` has exactly one home list | `HOME` |

New diagnostic codes:

| Code | Level | When |
|---|---|---|
| `HOME` | error | a sentence says `a @Ticket` (a change rule) or navigates a `ref Ticket` (`v1-ref-navigation.md`), and the app has no state list of Tickets, or several: name it (`in @tickets`) |
| `CHANGE` | error | a change form outside `always` (`@x before` in a handler, `was` in a derived value): a handler runs in one state; name the old value first (`set @previous to @x`) |
| `BREAKS_RULE` | warning (std.quality) | a handler step writes what a change rule freezes, with no guard that excludes the frozen rows: `set that expense's @amount to …` while `an @Expense whose @status was @Approved never changes`, and the handler has no `if that expense's @status is @Approved { stop }` |
| `TRANSITION_UNPROVEN` | warning (std.quality) | a pair in `only changes from … to …` that no example makes (the transition table is proven like statuses are, `STATUS_UNPROVEN`) |
| `SPELLING` | warning | `only goes up` / `can only increase` for `never goes down`; `stays the same` / `is immutable` for `never changes`; `intent fix` rewrites them |

`UNCHECKED` and `NEVER_UNCHECKED` already point `rules` and the purpose at `always`; their hints
now also suggest the change forms when the sentence says "never changes", "only … from … to",
"only goes up" or "is never deleted".

`intent check --typed` counts named forms as typed whole; general-form sentences are typed where
their phrases are known, as today.

## The harness

### Compiling the checks

- **Named forms are the harness's.** They need no judgement, so `compiler/invariants.ts` does not
  send them to the LLM. The harness generates `changes.mjs` from the typed form: key matching,
  equality on the record's fields (as stored JSON, the same canonical form `restartable` uses), the
  transition table, the numeric/temporal order. A row condition (`whose @status was @Approved`) is a
  typed condition on one row's fields; when the checker typed it whole the harness generates it
  too, and only an untyped condition goes to the stage. These checks need no probe: there is one
  reading.
- **General-form sentences** go to the existing stage with its probe. The prompt's module shape
  changes to

  ```ts
  export const changes: { line: number; holds: (before: Data, after: Data, clock: Clock) => boolean }[];
  ```

  and it gets two helpers so no reading has to invent them: `Fmt.added(before, after, key)` and
  `Fmt.removed(before, after, key)` (plain lists: multiset difference). Derived values used with
  `before` are computed on both states.
- The cache key (`prepareInvariants`) adds the change sentences; the checks remain apart from the
  app's code and shared by every build, as now.

### When the checks run

A change rule is about **one update**, so it is checked per event the app handles, not per
settled example step: a click, each answer to a call, each event, each tick, each `wait`'s ticks,
each `on open`. Checking per settled step would miss a transient violation, and would report a
false one for a legal chain (Open → Solved → Closed inside one step, where Open → Closed is not a
declared pair).

- Screens: `Program.step(w, m)` is pure, so the driver takes `data(m)` before and `data(step(w, m))`
  after every wire it dispatches (the user's event, and each answer and event the provider settles
  after it). `openSession` gets a `pairs()` hook next to `data()`.
- Apis: each request is one step (the handler is pure over the data), and each run of recurring
  work (`every 15m`) is one.
- Jobs: each `run({ event })` and each answer it awaits.
- **`restart` is not a step.** Stored fields are already checked to come back exactly
  (`restartable`); the rest starts from its defaults, which is not a change the app made. The pair
  across a restart is skipped.
- Stuttering: a step that changes nothing passes every change rule without running it.

A violation fails the build like any `always` rule, with the steps so far and the difference:

```
always (line 14) "an @Expense whose @status was @Approved never changes" does not hold
  after: type "50" into amountDraft, click submit, click edit on row 2, type "50" into amount on row 2
  expense 2: amount 45.00 → 50.00 (status was Approved)
  as an example:
    example "an approved expense never changes" {
      click edit on row 2
      type "50" into amount on row 2
      see amount on row 2 = "45.00"
    }
```

`sourcemap.json` lists every change rule with its line, like `always` sentences now, so the
report leads back to the spec line (traceability).

### The fuzzer

Random sessions already check `always` after every step; change rules come along for free. Three
additions make them find violations rather than wait for luck:

1. **Poke the frozen rows.** A row rule has a condition the harness can evaluate on the data (the
   generated `covers(row)` of a named form). When a list on screen shows a row that the condition
   covers, action templates on that list's rows are weighted towards that row (typing into its
   fields, clicking its buttons, choosing in its selects). This is reach-then-poke: the session
   first has to reach an approved expense, then tries every way to touch it.
2. **Walk the transition table.** For `only changes from … to …`, the fuzzer records which pairs
   its sessions made. Declared pairs never made are reported with the converge results (a
   coverage note, not a failure); a pair outside the table is a violation.
3. **Shrink.** A violation's session is shrunk (drop steps while it still fails, as QuickCheck
   does) before it is reported, so the paste-ready example is short.

The measurement must be sound (AGENTS.md): a planted-bug run builds a mutant of the approvals app
whose `approve` handler also sets the amount, and converge must catch it within the default depth.

### Examples

No new example steps. Every example step already runs every `always` rule, and change rules are
checked on its events. To prove that the app *refuses* a change, an example makes the attempt and
`see`s that nothing moved, as now; the rule is what makes random sessions try the same.

## Test plan

Checker tests (`tests/checker/changes.intent`, with `# expect:` lines):

1. `- a @Ticket's @id never changes` — no diagnostic.
2. `- a @Ticket's @nope never changes` — `UNKNOWN_NAME`.
3. `- a @Note's @text never changes` where `Note` has no key — `NO_KEY`.
4. `- @title never goes down` (Text) — `TYPE`.
5. `- @lastSync never goes down` (DateTime) — none.
6. `- a @Ticket's @status only changes from @Open to @Urgent` (Urgent is a Priority) — `TYPE`.
7. `- a @Ticket's @status only changes from @Open to @Open` — `TYPE`.
8. `- a @Ticket's @status only changes from @Open to @Solved, from @Open to @Solved` — `DUPLICATE`.
9. `- a @Ticket's @subject only changes from @Open to @Solved` (Text field) — `TYPE`.
10. `- an @Expense whose @status was @Approved never changes` — none.
11. `- an @Expense whose @status was @Urgent never changes` — `TYPE`.
12. `- a @Ticket is never removed` with two `List Ticket` state fields — `HOME`; with `in @tickets` — none.
13. `- @balance is @balance before plus the sum of @amount over the new @deposits` — none; typed whole.
14. `- @balance is @title before plus 1` — `TYPE`.
15. `on click x { - set @old to @count before }` — `CHANGE`.
16. `derive { gone = the removed @tickets }` — `CHANGE`.
17. `- @count only goes up` — `SPELLING` (and `intent fix` gives `never goes down`, in `tests/fix.test.ts`).
18. A handler `set that ticket's @id to 9` with rule 1 — `BREAKS_RULE` (in `tests/quality.test.ts`).
19. A transition pair no example makes — `TRANSITION_UNPROVEN` (in `tests/quality.test.ts`).

Harness tests:

- `tests/changes.test.ts`: the generated named-form checks on hand-made before/after data: key
  matching, removal, stuttering, a transition outside the table, a multiset difference for
  `List Text`, a restart pair skipped.
- `tests/harness/snapshot.ts`: `changes.mjs` for the new apps, and the invariants prompt with the
  two-state module shape (`--update`, reviewed).
- A planted-bug converge run (approvals mutant above), recorded in `runs/history.jsonl`.

Example apps to add:

- `apps/31-frozen-approvals.intent`: expenses with Approve/Reject/Edit per row, the rules of the
  first example block, and examples for each declared transition. Edit on an approved expense is
  disabled; the rules prove that no other path edits it.
- `apps/api/ledger-api.intent`: the ledger above, with `deposit` and `withdraw` endpoints and a
  recurring fee (`every 1d`), so the general form is checked per request and per job run.
- Update `apps/held-out-3/approvals.intent`'s `always` with its change rules (its purpose promises
  them), and measure converge before and after.

## Open questions, with a recommendation

1. **Should `never changes` on a row forbid removal?** Recommend **yes** (the row rule above): in
   the domains we have (approvals, ledgers, audit logs) deleting a frozen row is the worst change.
   A rule that allows removal says the field form (`a @Expense's @amount never changes`) or
   `…, unless it is removed` later if specs ask for it.
2. **Per event or per settled step?** Recommend **per event**: transition tables are about single
   updates, and a settled step can hide a transient break. The cost is one `data()` call per event,
   which is small next to rendering.
3. **`was` and `before`: two words for one idea?** They sit in different places (a condition, a
   value), like `is` and `the … of`. Recommend keeping both and nothing else (no "previously", "old",
   "used to be": `SPELLING`). There is no after-marker: the unmarked reference is the new state.
4. **Should the checker prove handlers against rules statically?** Recommend **no**, beyond the
   `BREAKS_RULE` hint. Handler sentences are English; a proof would guess. The runtime checks and
   the fuzzer's reach-then-poke do the work (TLC's approach, not Event-B's).
5. **Change rules in components and bundles?** Recommend **yes, from the start**: a bundle's
   `always` is its conformance test (AGENTS.md), and `std.list`'s pager or a ledger bundle would
   want `never goes down`. They expand with the component's `@` renaming like one-moment rules.
6. **Liveness** ("a pending expense is eventually decided")? Recommend **not in v1**. It needs
   fairness and unbounded runs (TLA+ `WF`/`SF`, Alloy's `eventually`); random bounded sessions cannot
   check it honestly. It stays a candidate in the changelog.

## As built (v67), and where it departs

Built in v67 on top of v66's nothing-safety and following a reference (the home list rule is
`compiler/homes.ts`'s `homeOf`, shared with `ref`). The open questions are answered as recommended:
a frozen row may not be removed (1), checks run per event (2), `was` and `before` both, with the
other words as `SPELLING` (3), no static proof beyond `BREAKS_RULE` (4), change rules in components
from the start (5), no liveness (6). Departures and details:

- **The named checks are data, not generated code.** `changePlan(app)` (`compiler/changes.ts`)
  writes `changes.json` (the typed forms: list, key, field, values as JSON, the transition table),
  and the harness interprets it (`checkStep`). One implementation for both targets, tested once
  (`tests/changes.test.ts`), instead of a `changes.mjs` per build. `sourcemap.json` lists every
  `always` sentence as `always <file>:<line>` (kind `change` with its form, or `always`).
- **What the harness reads itself**: a subject that is a state field (or a field of a record
  through it), `a @R's @f`, or rows, with a condition of `@f was/is [not] <value>` parts joined by
  `and`. Anything else, a derived subject, or a condition in other words, goes to the stage whole,
  as a general sentence. `whose … is …` with `is never removed` reads the state before the step (a
  removed row has no state after it).
- **Nothing-safety.** `@x before` has `@x`'s type for a state field or derived value; for a row's
  field (`its @amount before`, a loop's `@amount before`) it is `T or nothing`, since the row may be
  new, and an order on it is `NOTHING` until the sentence says what then. `never goes down/up` on a
  `T or nothing` subject is `NOTHING` (an order needs a value before and after). A transition table
  on a `T or nothing` field may list `nothing` as a value; without it, a value never becomes or
  leaves nothing. `whose @f was @X` does not hold for a new row (§9.14), like Kotlin's `==`.
- **Where the subject's rows live**: `a @R in @xs`, `a @R's @f in @xs` and `a @R in @xs's @f` all
  name the list; `in @xs` that is not a state list of R is `TYPE`.
- **`CHANGE`** covers `@x before`, `@x was` and `the new/removed @xs` in handler steps and
  conditions, derived values, element values and conditions, endpoints and recurring work; not in
  `rules` (guidance in words). `before` counts as the operator only where a value ends (`@due before
  @today` is still an order).
- **Per event.** The screen driver wraps the target's raw session below the provider's settling
  (`watching` in `compiler/exec.ts`): data before and after every wire, the user's event, each
  answer and event, each tick (a `wait` is a noop event), each `navigate` (`on open`). A job
  (`profile job`) is driven by the same screen driver, so its event and every answer it awaits are
  steps there; there is no separate job driver. The api driver takes a step per request (also a raw
  `request`) and per run of recurring work. A violation names the event (`at the event click
  expenses.reject (row 1)`, `at every 1d`).
- **The example to paste** has the (shrunk) steps and a comment naming the rule; it has no `see`
  line, since the harness does not know what the screen should show at that point. Shrinking is
  QuickCheck-style delta debugging (halves, quarters, …, single steps; at most 25 rounds): a
  1-minimal session, not always the shortest one (dropping an earlier step can make a later step
  unavailable). It runs in the build's hunt and in converge.
- **The fuzzer.** Reach-then-poke weighs actions (×6) in rows whose key on the screen is a key the
  frozen or kept rows have now (`coveredKeys`); a list whose row keys are not the record's keys
  gets no poke. Fields and selects inside rows now carry their row (before, random sessions typed
  into them without one, and the action was unavailable). Converge reports declared transitions
  no session made (`transitions at line …`), from the pairs the watch records.
- **The build's hunt** now also runs for apps with change rules (it ran only for `see` checks in
  `always`); an app with one-moment sentences only is still hunted in converge, not in the build
  (unchanged).
- **`TRANSITION_UNPROVEN` is static**: an example makes A → B when one of its steps triggers a
  handler (or calls an endpoint) that sets the field to B, after the field was A (its default, a
  seeded row, or an earlier step's handler). An approximation, like `STATUS_UNPROVEN`.
- **`BREAKS_RULE`**: a write to a frozen field (any write), to a frozen row or a removal of a kept
  row with no condition before or around it on the field that picks the rows (its polarity is not
  checked), and `decrease` / `reset` / `clear` of a state that never goes down (`increase` for up).
- **`SPELLING`** also rewrites `the previous @x` / `the old @x` / `@x previously` to `@x before`, and
  `can only increase` / `can only decrease`.
- **Components**: a component's `- sentence` lines in `always` are now expanded into the app,
  renamed; before v67 they were dropped (one-moment ones too).
- **The stage.** Only when there are general change sentences does the prompt get the second
  export and the rules for `before`, and the stage's Fmt the two helpers; for every other spec the
  invariants prompt and its cache key are as before.
- **Apps.** `apps/31-frozen-approvals.intent` (Approve, Reject, Edit per row; Edit disabled once
  decided; an edit whose expense was approved in the meantime is dropped), `apps/api/ledger-api.intent`
  (deposits, withdrawals, a daily fee recorded as a withdrawal with `fee = true`, only while the
  balance allows it), and `apps/held-out-3/approvals.intent`'s `rules` sentence became its change rules.
- **Not built**: the planted-bug *converge* run recorded in `runs/history.jsonl` (the planted
  violations were shown with the drivers on copies of verified builds instead), and converge
  before and after for `apps/held-out-3/approvals.intent`.
