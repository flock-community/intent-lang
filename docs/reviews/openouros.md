# Intent against a real app: openouros

Reviewed: `openouros` (read only): `CLAUDE.md`, `ARCHITECTURE.md`, `docs/concept/02` and `04`,
`docs/specs/uc-04`, the 38 contracts in `contracts/std/`, the six `startset/` recipes, the
connectors, and the Kotlin behind notes, notifications, the action gate and the outbox. Against
Intent v21. Date: 2026-09-23.

The three specs are in `runs/openouros/`. That folder is its own project, with its own
`intent.project`, `intent.lock` and `lib/`, so the checker can resolve the contract and the
layer there. `lib/std/http/apiKey.intent` is a copy. Every place where a spec bends, drops or
fakes something is marked `# GAP:`.

---

## 1. What openouros is, and how it relates

openouros ("Open OurOS") is a single-user **intent OS**. The user states an intent in the chat.
The system then finds, adapts or builds (with an LLM) a component that appears on their
desktop.

- An intent is a recipe (`intent.yaml`) with these parts:
  - a goal;
  - requirements, each marked `human` or `ai`;
  - Given/When/Then scenarios;
  - a manifest of the contracts it may use, per target (`web`, `terminal`).
- Components talk only through JSON-Schema **contracts** of three kinds: `query`, `action`
  and `event`. The contracts travel over a WebSocket bus.
- Actions carry an **effect class**: `local`, `shared`, `external-reversible` or
  `external-irreversible`. External actions wait for a preview and approval, unless a
  **standing permission** with bounds covers them. They go out through an outbox with
  idempotency keys. They can be undone through their declared **compensation**, and an
  **emergency stop** holds everything.
- Data lives in encrypted, event-sourced **databoxes**, stored in SQLite.
- The code: a Kotlin/Ktor kern (hexagonal, about 54k lines), a Lit web shell, a Deno terminal
  client, and headless agents in sandboxed workers.
- Connectors are MCP servers mapped onto contracts. Until a real one exists, the connector is
  a recorded mock.

**How it relates to Intent.** The two projects share their core claim almost word for word:
the description is the asset and code is replaceable, scenarios are proof, and requirements
are either human- or machine-made. openouros's decision 0011 compiles prose scenarios into a
closed test vocabulary, which is Intent's §6 by another route. `language.md` v0.1 designed an
`ouros.lock`, which points to a common origin. But no openouros file mentions `intentlang` or
`language.md`, and openouros has no typed spec language. Behaviour is Dutch prose in YAML;
types are JSON Schema.

This makes openouros a natural customer of Intent:

- An openouros recipe is roughly an Intent app.
- An openouros contract is roughly an Intent contract (§4f).
- The startset is roughly `lib/`.

**What Intent should borrow:**

1. **Effect classes and compensation on actions.**
   - `effect: external-reversible, compensation: std.booking.reservation.cancel`.
   - The effect class decides who must agree before an action runs.
   - The pairing makes "undo" a platform route instead of app code.
2. **Semantic roles on fields.** `x-ouros-role: id | title | body | time | ref`, with
   `x-ouros-ref: <contract>`. This is exactly the missing "declared references" of
   language-review #2, already in use.
3. **Event contracts.** A contract kind for what is published, next to what is asked.
4. **A per-target manifest.** The manifest lists which queries, events and actions a
   component may use. Undeclared use is refused at run time (`CONTRACT_NOT_DECLARED`).
5. **Provenance on requirements** (`origin: human | ai`). This fits the interview flow in
   `AGENTS.md`: the LLM may revise its own rules, never the user's.
6. **Steerable test controls.** Examples need these once time and integrations exist:
   - `OUROS_CLOCK=steerable` opens `/demo/clock`.
   - `OUROS_CONNECTOR=steerable` can drop the next answer.
   - A recorded connector keeps a ledger per idempotency key.
7. **Errors with a code.** Errors are `{code, message}`, and one table maps codes to statuses
   (`statusFor` in `HttpRoutes.kt`). Intent's `Problem` has only `error`.

---

## 2. The slices

The checker passes on all five files: 0 errors and 0 warnings on the final versions. I ran
`node ../../compiler/cli.ts check` from inside `runs/openouros/`. Nothing was built.

"The checker passes" means less than it sounds. The checker checks names, forms and
endpoints. It does not check the sentences, and it does not check `see x.body.<path>` against
the answer type: a probe with `see undo.body.nonsense = "x"` passed. The first real test of
these specs would be `intent build`.

### 2.1 `01-notes.intent`: the Notitie widget (easy)

Files:
- `runs/openouros/01-notes.intent` (the screen)
- `lib/ouros/notes.intent` (the contract)
- `providers/notes-api.intent` (the provider it is tested with)

From:
- `startset/notitie/{intent.yaml, web.js, terminal.js}`
- `contracts/std/std.note.*.json`
- `kern/domain/.../fabric/FabricService.kt`, `note/model/Note.kt`
- `e2e/startset_widgets_test.ts`

**Expressible, and a close fit:**
- the list, the draft, the add button and an undo button per row;
- the refusal of an empty note, and that typing clears the refusal;
- list / create / remove as a contract with typed answers per status;
- a provider that issues `note_1`, `note_2`, … and refuses a second undo with 409.

The three recipe scenarios map onto four examples. §4g (`uses … tested with`) was made for
this.

**Not expressible:**
- **Events.** The widget never re-lists. It appends when `std.note.created` arrives and drops a
  row when `std.note.removed` arrives, so a note added or undone in another client appears
  here too. Intent can only re-list after its own calls. The scenario "disappears in the
  browser *and* in the terminal" cannot be written.
- **The terminal target.** The same recipe is built twice: the web version, and a read-only
  terminal version with its own "empty" state. Intent has one screen per app.
- **The manifest.** The terminal version may list but not remove. `uses` grants every
  endpoint.
- **Loading.** A pending call is never visible in Intent's tests.
- **Action metadata on the contract:** effect, compensation, box, index policy.
- **Details:**
  - `createdAt` has no time type.
  - The exact contract error message cannot be kept.
  - A length rule has to be written as a regex.
  - Requirement provenance is written as notes.

### 2.2 `02-notifications.intent`: the notification API (medium)

From:
- `contracts/std/std.notify*.json`, `std.notification.list.json`
- `kern/domain/.../notify/NotifyService.kt`, `rules/NotificationRules.kt`
- `HttpRoutes.kt` (the `/notifications` routes and `statusFor`)
- `UserLayer.kt` (the expiry sweep)
- `docs/specs/18-notificaties.md`

**Expressible:**
- notify, retract, list with three optional filters, and the PATCH transitions (only
  `new→seen` and `seen→done`; everything else is 409);
- 404 for an unknown id and 400 for an unknown status;
- the source is filled in by the platform, never by the sender. The `std.http.apiKey` layer
  providing `caller` is a good stand-in for "the acting component". This is the part where
  v21 layers paid off;
- retract is refused as a whole (403) when any match belongs to another source.

**Bent:**
- **Time.** `createdAt`, `expiresAt` and the rate limit (20 per rolling hour per component)
  need a clock. They are Ints on a test clock, moved by a `/demo/clock` endpoint. openouros
  has the same steerable clock for its own tests.
- **The expiry sweep.** In openouros it is a background job every 15 s. Here it is folded into
  that clock endpoint.
- **Wire names.** Choice values are `info`/`new` on the wire; Intent sends `Info`/`New`.
- **Repetition.** The limit example calls `notify` 21 times, written out.

**Dropped:**
- **`actions`**: an array of `{type: "open"} | {type: "action", contract, payload}`. It needs
  a union type and a contract as a value. With it went
  `POST /notifications/{id}/actions/{index}`.
- **The broadcasts** `notification.new` / `notification.updated`, which are events again.
- **The delivery rules**: channel per urgency, quiet hours in a time zone, focus per space.
  They are configuration data that the runtime reads.
- **Invariants over all notifications** ("never back to New"). `always` sees only the latest
  answer.

### 2.3 `03-yoga-booking.intent`: UC4, sport classes booked automatically (hard)

From:
- `docs/specs/uc-04-sportlessen-boeken.md`
- `contracts/std/std.booking.*.json`
- `kern/domain/.../action/{ActionGate, OutboxProcessor}.kt`, `permission/*`
- `ApprovalRoutes.kt`, `RecordedActionExecutor.kt`
- `FixtureAgents.kt` (`YOGA_BOOKING_AGENT`)
- `e2e/uc04_sport_classes_test.ts`

All six scenarios (S-U4.1..6) are written as examples with openouros's exact values: the
`cls_01` preview for `2026-09-22T19:00:00Z`, the tally 0 → 1 → 2, the Thursday class waiting
with "classId valt buiten de grens: cls_02", `reservation_1` once after a lost answer,
`ALREADY_COMPENSATED`, and "run · overgeslagen · noodstop". Two more examples (seven in all) cover the week
bound and reject / revoke. So the *behaviour* can be pinned down.

The *structure* cannot. The spec folds five things into one api app:
- the trigger (a user intent);
- the agent (sandboxed code built from the recipe);
- the kern's gate and outbox (handwritten, "not changeable by agents");
- the connector;
- the booking system on the other side.

What follows from that:
- **Events are faked as input.** The class opening is an endpoint the examples call.
- **Background work is faked.** The outbox and triggers are ticked by hand.
- **Actions are specialised.** A generic `{contract, payload}` action is flattened into two
  kinds, Reserve and Cancel.
- **Bounds are flattened.** The permission bounds are a list of a union (`{count, period}` or
  `{fields}`), checked in order. They became one record.
- **Dates are sentences.** Date arithmetic ("the first Tuesday 19:00 after now, in UTC") is a
  sentence over `Text`.
- **The core is rules, not checks.** "Deliver" and "attempt" are the heart of UC4
  (idempotency, retry after 3 attempts, compensation on confirm). They are shared by three
  endpoints, and there is no named procedure, so they are `rules` sentences.
- **The main invariant is a proxy.** "Never booked twice" (R-U4.4) became the proxy
  `always see connector.body.effects is at most 2`, which is the same proxy problem as
  language-review #3.
- **Restart is not expressible.** S-U4.4 restarts the kern between the lost answer and the
  retry. Intent has no restart and no persistence.
- **The preview card is not written.** It is the second screen, the one where a person
  approves. It would be another app, and nothing ties the two together.

Small finding: `key` is reserved (row keys), so `idempotencyKey` had to be used instead.

---

## 3. The gaps, ranked

Shares are estimates over openouros's features and its 38 contracts:
- 20 of the 38 contracts have a date-time field.
- 14 are events.
- 14 are actions: 8 local, 6 external.
- 14 have an enum with lower-case wire values.

"Blocks" means the spec cannot say it, or can only fake it. Persistence ranks below its share
because an in-memory fake behaves the same in examples; it blocks running the app, not
specifying it.

### G1. Events and subscriptions (about 70% of features; every widget)

Category: **language + harness.**

Proposal, in Wirespec's `channel` spirit (already on the roadmap):

```
contract ouros.notes
event noteCreated Note                 # published after createNote answers 201
event noteRemoved RemovedNote

endpoint createNote POST "/notes"
  body text: NoteText
  answers 201 Note
  publishes noteCreated                # the answer's body is the event

# screen
on event notes.noteCreated
  - add its body to the end of rows

# examples
publish notes.noteCreated with id = "note_9", text = "from the terminal"   # another client did it
see rows has 1 row
```

How it would be verified:
- The checker requires every `publishes` to name a declared event, and warns when an event is
  never handled.
- At run time, every published payload is checked against the contract, like answers are now.
- A provider example can check an event with `see noteCreated.body.text = "…"`.
- A screen example can inject an event with `publish`, which is how "another client" gets
  tested without two browsers.
- Twin compilation compares screens after each event, as after each click.

Cost: a transport in the harness (SSE is enough), an `…Published` message per event in the
generated `Msg`, and the `publish` step. Medium.

### G2. Time, and a clock in api apps (about 60%: 20 of 38 contracts; plus all background work at about 35%)

Category: **language + harness.**

```
type Time                               # built in: an instant, ISO 8601 on the wire, UTC
record Notification
  createdAt: Time
  expiresAt: Maybe Time

every 15s                               # an api job, on the harness's clock
  - every notification that is New or Seen and whose expiresAt is at or before now becomes Expired

# examples, api and screen alike
clock at "2026-09-21T09:00:00Z"
wait 7d
```

How it would be verified:
- `now` is provided by the harness and is steerable. There is still no wall clock (§9.8
  stays true).
- Helpers generated once (`Fmt.iso`, "the next Tuesday 19:00 after …", ISO week) replace
  sentences like the one in slice 3.
- Examples pin exact instants. Twins must agree after every `wait`.

Cost: a `Time` type in every target, a deterministic clock in the api harness, and `every`
blocks. Medium. It also closes "clock in styled apps" from the candidates list.

### G3. Actions with effects: approval, standing permissions, outbox, compensation (about 50%)

Category: **mostly a bundle/layer, plus a small language addition.**

The language part is two lines on a contract endpoint:

```
endpoint reserve POST "/reservations"
  body classId: Text
  body date: Time
  answers 201 Reservation
  effect external reversible             # local | shared | external reversible | external irreversible
  undone by cancelReservation with id = {reserve.body.id}
```

The rest is a layer, `std.actions`, like `std.http.apiKey`:
- the gate (effect class → run now / wait for approval / run under a permission);
- permissions with bounds;
- the outbox with idempotency keys and N attempts;
- undo through the declared compensation;
- the emergency stop.

It is proven once by its own examples: openouros's six UC4 scenarios are a ready-made set.
Apps only declare effects.

How it would be verified:
- the layer's examples;
- `always` checks on the layer's own state ("no two reservations share an idempotency key",
  which needs review #3's model-level invariants);
- a recorded provider that can drop answers (`steer <alias> drop 1` as an example step).

Cost: large, but most of it is written once. The harness needs persistent state (G5) for the
outbox to mean anything.

### G4. Unions of records, and wire names for choice values (about 35%)

Category: **language.**

Examples in openouros:
- notification `actions`;
- permission bounds;
- trigger conditions (`at | interval | event`) and effects (`act | run | refresh`);
- 14 contracts with lower-case enum values.

```
choice Urgency: Info = "info" | Normal = "normal" | Urgent = "urgent"      # the wire name
union Bound = CountBound | FieldsBound tagged by kind                     # records, one tag field
```

How it would be verified: generated decoders reject untagged or unknown variants, and every
answer is checked at run time as now. Examples choose a variant with `kind = "count"`.

Cost: small for wire names, medium for unions. Wirespec already showed both.

### G5. Stored state and restart (about 85% of features persist; blocking only for real use and restart scenarios)

Category: **harness, with one example step.**

```
state stored                            # survives a restart; the harness owns the store
  notes: List StoredNote = []

# examples
restart                                 # the provider stops and starts on the same store
```

How it would be verified: a `restart` in the middle of an example must not change any later
`see`. Twins run on their own stores.

Cost: a generated store per target (SQLite or a JSON file is enough), plus a migration story
once records change. The migration part is the large part; defer it. This is also where
identity (review #2) becomes unavoidable.

### G6. Several targets and screens for one app (about 30%)

Category: **language + harness.**

Examples in openouros: web and terminal targets; widget sizes (`compact | standard`); the
preview card shown in the chat and behind a notification.

```
screen                                   # the default target
  …
screen terminal                          # same state, derive and handlers; its own elements
  list rows of Note
    text text
size compact                             # the host picks; elements can say `visible when size is standard`
```

How it would be verified: examples say `on terminal` to drive the other screen, and one
`always` holds on both.

Cost: a terminal renderer is large. Sizes are small. Do sizes first.

### Smaller ones, found on the way

- **Checker: body paths.** `see x.body.<path>` is not checked against the answer's type. This
  is a checker fix, and small.
- **Language: a list literal in `call` arguments.** Slice 3 passes `allowedClassIds = "cls_01"`
  and relies on the layer-param reading.
- **Language: named step lists in api apps.** Slice 3's "deliver" and "attempt" need them. This
  folds into review #1 (a structured grammar for behaviour).
- **Language: repetition in examples** (`call notify 20 times with …`).
- **Language: provenance on rules** (`rules` lines marked `human` or `ai`). Small and cheap,
  and it fits the interview workflow.
- **Language: a per-alias manifest.** `uses ouros.notes as notes only listNotes`. Small.
- **Language: error codes in `Problem`.** `answers 409 Problem "ALREADY_COMPENSATED"`. Small.

---

## 4. What Intent does better than openouros today

- **Scenarios with values.** openouros scenarios are Dutch prose ("toont het 'Ja, jas
  mee'"), compiled into test documents by an LLM (decision 0011). The exact values live in the
  Kotlin and Playwright tests and in the status tables of the use-case specs. In Intent the
  example *is* the test, with exact values, before any code exists. Slice 3 put openouros's
  whole UC4 status table into 7 examples.
- **A checker before any build.** An openouros recipe is YAML with free text; nothing checks
  that a scenario names a real element. Intent catches unknown names, unused endpoints
  (`UNPROVEN` found two in slice 3) and contract mismatches before a model is called.
- **Computed versions.** openouros contracts carry a hand-written `"version": "1.0.0"`. Intent
  computes the version from names *and* examples, and pins by hash. One openouros contract
  even has a duplicated key (`"box"` twice in `std.note.create.json`), which a checked format
  would refuse.
- **Contract examples run on every implementation.** openouros contract `examples` are sample
  data for mocks. Intent runs them against the provider.
- **Refinement.** openouros's concept has "variation points" and "adapt instead of build"
  (decision 0036), but no mechanism. Intent's `extends` / `override` / `drop` with base proofs
  is that mechanism.
- **Twins.** openouros accepts a component when its scenarios pass once. Intent also requires
  two builds to agree.

openouros is ahead on everything that makes an app *run for a person over time*: stored,
encrypted data; live updates; background work; permissions and approval; real integrations.
Those are exactly G1–G5.

---

## 5. Recommended order

1. **v22: events.** `event`, `publishes`, `on event`, the `publish` example step, and SSE in
   the harness. It is already on the roadmap as `channel`, and it unblocks the most (every
   openouros widget). Take choice wire names along, since they are small and hit the same
   contracts.
2. **v23: time.** The `Time` type, a steerable `now`, `clock at` / `wait` in all examples, and
   `every` jobs in api apps. It unblocks expiry, rate limits, triggers and schedules, and
   replaces the `Int`-minutes and `Text` dates of slices 2 and 3.
3. **v24: effects on contracts, and `std.actions` as a layer.** `effect …` and `undone by …`
   on endpoints. The layer holds the gate, outbox, permissions and stop, proven with UC4's
   scenarios. Needs model-level invariants (review #3) for "never twice".
4. **v25: stored state and `restart`.** Without migrations at first. Pair it with identity and
   references (review #2), because a store forces the question of what a reference points to.
5. **v26: unions of records and screen sizes.** Then a second target (terminal) if a real app
   asks for it.

Throughout, fix the body-path check in the checker. It is small, and today it lets a wrong
`see` through to the build.
