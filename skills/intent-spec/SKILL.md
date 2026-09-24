---
name: intent-spec
description: Write, refine, review and debug Intent specs (.intent files) and spec bundles, and turn a user's wishes into spec changes instead of code. Use when creating an app from a description, adding a feature or rule to an existing spec, fixing a bug in an Intent-built app, pointing from the running app back to its spec, or writing a reusable bundle in lib/.
---

# Writing Intent specs well

Intent describes **what an app must be**; the compiler (an LLM held in place by a harness)
makes the code. You never edit generated code: every change is a spec change. The full
reference is `docs/LANGUAGE.md` — read it before writing, it is also exactly what the
compiler reads. This skill is about using the language *well*.

Language version this skill matches: **v26** (see the changelog at the end of
`docs/LANGUAGE.md`). If the changelog shows a newer version, read what changed first.

## 1. Understand the intent (interview)

Before writing, make sure you can answer these. Ask the user only what you cannot decide
sensibly yourself, and state the defaults you chose instead of asking about everything.

- **Data:** what things exist (records), their fields, the closed sets of values (choices),
  and realistic seed data (a `table`, 5–15 rows, including edge cases such as "almost full").
- **Screen:** what the user sees, top to bottom; what can they type, click, choose, toggle?
- **Rules:** what must always hold ("never below zero", "at most 3 in progress"). These
  become `always` checks where they can be observed, and sentences otherwise.
- **Edge cases:** empty input, invalid input, duplicates, nothing found, the limit being
  reached, the last page. For each one, decide what happens and write it down.
- **Order and ties:** every list needs an order. Every sort needs a tie-breaker.
- **Exact texts:** every message the user sees, written as an exact template.

A spec is ready when you could compute every example's expected value by hand.

## 2. Reuse first

List `lib/` and read the bundles before writing anything yourself:

- Paging: `use pager = Pager` (from `std.list`). Its demo app, `lib/std/list.demo.intent`,
  shows how to use it.
- Messages after an action: `use toast = Toast` (from `std.feedback`); set `@toast.message`.
- An admin look: `import ui.admin` gives you the design, `StatCard` and `EmptyState`.
- Domains: `support.tickets`, and more over time.

Import with `import std.list`. Import every spec whose names you use, also when they would
arrive through another one (a screen that `uses` a tickets contract still writes
`import support.tickets` to use `Ticket` and `@Solved`). Place a component with `use name = Component { … }`, with its
bindings in the block (`items = sorted`, no braces around the value) and, when needed, `visible when …`. Then refer to its
names as `@name.x` in your sentences and handlers (`set @toast.message to "Saved"`), and as
`name.x` in examples (`click pager.next`). A bundle's `design` becomes yours; your own
`design` lines override it. If a bundle
*almost* fits, do not copy it into the app: note what is missing (a param, a component) as a
candidate change to the bundle, and tell the user.

## 3. Write the spec

Order: `app` → `import` → `design` / `component` → `choice` → `record` → `state` →
`derive` → `screen` → `on …` → `rules` → `always` → `example`s.

Write every block with braces (`screen {` … `}`), indented 2 spaces inside, and run
`intent fmt <file>` when unsure: it lays the file out the canonical way.

In every sentence, mark what you refer to with `@`: `- set @count to 0`,
`enabled when @draft is not blank`, `add an @Item with @title = @draft`. Words without `@` are
prose. When the checker hints `UNMARKED`, decide: mark the word, or reword the sentence if you
meant the English word ("the page shown" when `page` is also state).

Habits that make builds identical *and* correct:

- **Name everything the user sees** on the `screen`. Anything not named there does not exist.
- **Templates are exact:** `text left = "{count} left"`. Formats come from §9 (money,
  decimals, clock); rounding uses the words "rounded", "rounded up" and "rounded down".
- **Put logic in `derive`,** one named value per concept, in plain but exact sentences:
  "the tickets whose status fits statusFilter, highest id first". Say the order, the ties
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
- **Stop explicitly:** a validation step ends with "… and stop", otherwise later steps still
  run. Use "otherwise" for the other branch, "that <item>" for the clicked row in a handler,
  and "its" for the row's item in a row expression (§5 of the reference).
- **Name intermediate values** in `derive` (`quantity = amount read as a whole number`)
  and use the name in templates and sentences, instead of repeating phrases.
- **Watch templates with holes that can be empty** (`"{date} · {location}"` shows ` · `
  when nothing is chosen). Give the empty case its own text or hide the element.
- **Validity rules are types, not sentences.** For an email, a code, an age or an amount, use or
  declare a refined type (`import std.text` for `Email`, `type Age = Int from 0 to 150`) and
  write "is a valid Email". Don't describe the rule in words: two compilers read words
  differently, but they check a type the same way.
- **Template holes** hold a name, a row field, a name with a format (`{total as money}`) or a
  short phrase over names; name anything longer in `derive`. A hole that can be empty
  (nothing chosen yet) needs its own text for that case.
- **Per-row and numeric invariants** go straight into `always`: `see every row of cart:
  qty is at least 1`, `see every row of events: confirmed is at most capacity`. Write one for
  every "never" in the user's words.
- **An invariant across rows** ("no table booked twice"): derive a count of the
  violations, show it in an alert visible only when it is above 0, and add
  `always see <alert> is hidden`.
- **Un-picking a select:** a handler sets it to `""` (for example a Clear button); `""` shows
  as an empty placeholder.
- **Don't give a row element the same name as an app-level value** (`SHADOWED`).
- **Filters with "all"** are their own choice (`AnyCategory "All" | OnlyBrakes "Brakes"`).
  Relations between records are by value (keep the title or id in a field).

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
- `LOCK`: a bundle changed. Review what changed before running `intent lock`.

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
- **New rule:** an `always` check (if observable) or a `rules` sentence, and an example of
  the case it prevents.
- **Bug:** first write an example that reproduces it (it must fail), then fix the sentence,
  then confirm the example passes. The example stays, so the bug cannot come back.
- **Look change:** the element's `look`, its presentation, a component's look, or the
  `design`. Prefer the most general place that is right: a design token over a component
  over an element.
- **The user points at something in the app:** its `data-el` is its spec name. Look it up
  in the build's `sourcemap.json` (`"pager.next" → lib/std/list.intent:16, component Pager,
  bundle std.list`). If it comes from a bundle, decide whether the change belongs in the
  bundle (every app gets it) or in the app (for example a param, or an app-level handler).

## 5b. Build on someone else's app (refinement)

When a published app in `lib/` is close to what the user wants, `extends` it instead of
copying it (§4c of the reference):

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

Write `profile api` and `endpoint` blocks (§4e of the reference). Reuse the same domain bundle
as the screen. Every endpoint needs examples: the happy path, each refusal ("answer 404 … and
stop"), and a missing or invalid input (the harness answers those itself). Check list order
explicitly (`see listTickets.body[1].id = 9`).

## 5e. Contracts between services

When a service is used by anyone else, write its **contract** first (§4f): records, endpoint
signatures and every status each may answer, plus examples that work on any implementation
(use `{createTicket.body.id}` instead of ids from seed data). Publish it. The service
`implements` it and writes only steps. Consumers generate a typed client with `intent client`.
Inside one app (between components, or a screen and its logic), there is no wire and no
contract to write: component params and the generated interfaces are the contract.

## 5g. What every API needs: use layers, don't write them

Never write CORS, API-key checks or security headers as endpoint steps. Use the layers in
`lib/std/http/` (§4h): `use secure = std.http.secure` first, then `std.http.cors` with the
exact origins of the web pages, then `std.http.apiKey`, and use "the caller" in steps for what
depends on who calls (only the assignee solves; a comment's author is the caller). Keys in the
spec are test keys. Examples then send `header x-api-key = "…"`, and cover: no key, an unknown
key, a public path, each role doing what it may and what it may not, and a preflight from the
allowed origin. If a concern repeats across APIs and no layer covers it, write a new layer
(with its own examples against the stub app) instead of copying steps.

A screen that calls such an API sends the user's key through a client layer: under its `uses`,
`through std.http.sendKey` with `key = <the state that holds the key>`. Signing in is then just
a field and a button that sets that state. The contract says `every endpoint answers 401
Problem`, so the screen can show the refusal's message. Examples: a wrong key, the right key,
and "before signing in, nothing arrives" (events from another client do not reach a screen
that is not signed in).

## 5f. A screen that uses an API

`uses <contract> as <alias>` plus `tested with "<provider spec>"` (§4g). Load data `on start`,
and handle every call's answer with `on answer`: the success status, and `otherwise` for the
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
- Publish with `intent publish lib/area/name.intent`. The version is computed: a removed name
  or a changed demo example is a new major version. Add, don't change, when you can.

## Lessons from authors

Two authors who knew only the reference and `lib/` wrote specs that built as **the same app
in every build** on the first attempt. Their looks converged less than specs written with
the harness in view. What they stumbled over, now fixed in the reference, is worth
remembering when you write or review a spec:

- the module system was missing from the reference, so they learned it from the demo app:
  keep the reference complete, and keep demos for every bundle;
- natural names were rejected (`Event`): check the reserved list in §7;
- `visible when` under `use` and `as` after a long expression were unclear;
- a component's own state can go stale (a page past the end): components must clamp
  or reset their own state, not every app;
- "confirmed never exceeds capacity" can now be an `always` check per row (v14); authors
  before v14 had to keep it in words;
- the second round of authors (reservations, library) asked what may go inside `{…}`, how to
  add a record and hand out ids, and how to un-pick a select; these are now in the reference
  (§4, §5).

## Keep this skill current

When the language changes (a new version in the changelog), update the version line at the
top and any section it affects. When a spec author, human or LLM, stumbles over something,
add the lesson here.
