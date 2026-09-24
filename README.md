# Intent: a spec language plus a harness that makes an LLM a stable compiler

You write **what an app must be** in a small, readable language. The harness turns an LLM
(`claude -p`, Opus 5.5) into a compiler that emits a working app in **Elm** or
**TypeScript**. A pipeline builds the same spec many times and checks that every build is
*the same app*.

```
app Board {
  "A tiny kanban board with three columns and at most three cards in progress."
}

choice Column: Todo | Doing | Done

record Card {
  title: Text
  column: Column
}

state {
  cards: List Card = []
  draft: Text = ""
}

screen {
  field draft "New card"
  button add "Add" {
    enabled when @draft is not blank
  }
  list todo of Card = the @cards in @Todo {
    text title
    button start "Start" {
      enabled when not @full
    }
  }
  …
}

on click add {
  - add a card with the @draft, trimmed, as @title to @Todo
  - clear @draft
}

always {
  see doing has at most 3 rows
}

example "the limit" {
  type "A" into draft
  click add
  …
  see start on row with "D" is disabled
}
```

**New here? Start with [`docs/GUIDE.md`](docs/GUIDE.md), Intent by example:** a counter, a
todo list, `always` rules, reusable components and designs, improving someone else's app, an
HTTP API with a contract, layers for CORS and API keys, a screen that talks to the API and
follows other people's changes, and signing in with a key. Every snippet is from a real spec.

What the language covers today:

| | |
|---|---|
| Screens | state, derived values, lists, sections, templates, handlers, examples, `always` rules, a clock |
| Looks | a `design`, presentations (`as table`, `as sidebar`), `look "…"` in words, styled builds checked in a browser |
| Reuse | bundles, behaviour components (`use pager = Pager`), refinement (`extends`, `override`), a registry with versions |
| APIs | `profile api`, endpoints, contracts with every answer and event, layers (`std.http.cors`, `std.http.apiKey`, `std.http.secure`) |
| Screens + APIs | `uses <contract>`, calls and answers, events from other clients, client layers (`through std.http.sendKey`) |

- Language reference: [`docs/LANGUAGE.md`](docs/LANGUAGE.md) (also the compiler's prompt: one source of truth).
- Example specs of increasing difficulty: [`apps/`](apps) (16 screens) and [`apps/api/`](apps/api) (2 APIs).
- `language.md` is the earlier, broader v0.1 design (in Dutch). This project is its app profile.

## For LLMs: the spec-writing skill

[`skills/intent-spec/SKILL.md`](skills/intent-spec/SKILL.md) teaches an LLM to use Intent well:
interviewing the user, reusing bundles, writing, checking and building, changing an existing
app, tracing from the UI back to the spec, and writing bundles. Claude Code loads it
automatically in this repo (it is linked from `.claude/skills/`). It lives next to the language
reference on purpose: whoever changes the language updates the skill in the same commit.

## Quick start

```sh
npm install
node compiler/cli.ts check apps/*.intent            # syntax + consistency checker (add --json for editors)
node compiler/cli.ts review apps/09-board.intent    # what does the spec leave to defaults? (1 LLM call)
node compiler/cli.ts expand apps/14-supportdesk.intent   # the spec exactly as the compiler reads it
node compiler/cli.ts build apps/02-todo.intent      # → runs/single/02-todo/{elm,ts}/index.html
node compiler/cli.ts build apps/16-desk-ui.intent   # builds the desk API (and its layers) first, then the screen
node compiler/cli.ts converge apps/*.intent --builds 5 --tag my-run
node compiler/cli.ts converge apps/10-helpdesk.intent --styled --kit --builds 3   # styled, in Chromium
npm test                                            # checker regression + Elm/TS Fmt parity
```

Open any build's `index.html` directly in a browser.

## How the harness makes the LLM stable

The idea: **take away every degree of freedom that does not need judgement**, and check
the rest.

```
 .intent ──► parse + check ──► IR ──► generated per target (deterministic, not LLM):
             (errors with            • domain types, Screen record, Event type
              line:col and           • toNode / fromWire, renderer, test driver
              suggestions)           • Fmt helpers (formatting, parsing, rounding)
                                          │
                     LLM writes only ─────┘  Model, init, update, view  (one module)
                                          │
              compile (elm make / tsc) ──► run every example ──► hunt for `always` violations
                     ▲                                               │
                     └──────── repair loop: exact errors fed back ───┘  (max 4 attempts)
                     or the LLM answers "SPEC CONFLICT: <lines>" and the build stops
```

1. **The screen is the contract.** The spec names every observable element. The harness
   generates a typed `Screen` record and an `Event` type from it, so the compiler (tsc/elm)
   rejects any build that shows something else. Rendering is harness code, not LLM code.
2. **Both targets observe the same way.** A build is driven by abstract events and
   observed as a JSON tree of named elements. Elm and TS builds are therefore comparable
   step by step.
3. **Silence has a default.** Where the spec says nothing (trimming, number formats, list
   order, rounding), §9 of the language decides. The LLM is told to apply it, not to choose.
4. **No home-made numerics.** Formatting, parsing and rounding go through `Fmt`, which is
   written once per target and proven identical by `tests/fmt-parity`.
5. **Pure calls.** `claude -p` runs with no tools, no settings, no session, a neutral cwd
   and a fixed system prompt. The prompt is the language reference, the generated
   interface and the spec.
6. **Examples and invariants gate every build.** Failures come back as the spec line, the
   message and a screen dump. A contradictory spec gets a `SPEC CONFLICT` error, the way a
   compiler errors on bad source.

## How "the same app" is measured

`converge` builds every spec N times per target, independently, then replays user
sessions on every build and compares the screens after every action:

- **Blind sessions** are generated from the spec alone, before any build exists.
- **Guided sessions** are explored on a reference build: they only take actions the screen
  offers, and they start from prefixes of the spec's examples, so they reach deep states
  (settled debts, applied discount codes, lost games, long breaks).
- **Invariants** (`always`) are checked after every action of every session.

It reports: builds OK / first-try OK, `always` held, **same app** (the share of sessions
in which all builds agree on every screen), Elm≡TS, code similarity, cost, and for every
divergence the action sequence and the differing screens. That sequence is ready to paste
into the spec as an example.

The detector is validated: a planted rounding bug that passes every example was caught
in 20 of 40 sessions.

## Results

Final run (r5): 9 apps × 2 targets × 5 independent builds = 90 builds, 80 sessions × 30 actions per app.

| App | Builds OK | First-try OK | `always` held | Same app: all | Elm | TS | Elm≡TS | Code sim. Elm / TS | Cost |
|---|---|---|---|---|---|---|---|---|---|
| Counter | 10/10 | 10/10 | 10/10 | 100% | 100% | 100% | 100% | 100% / 100% | $0.58 |
| Todo | 10/10 | 10/10 | 10/10 | 100% | 100% | 100% | 100% | 75% / 53% | $0.81 |
| TipSplit | 10/10 | 10/10 | 10/10 | 100% | 100% | 100% | 100% | 69% / 72% | $0.88 |
| Pomodoro | 10/10 | 10/10 | 10/10 | 100% | 100% | 100% | 100% | 96% / 85% | $0.76 |
| Wordle | 10/10 | 10/10 | 10/10 | 100% | 100% | 100% | 100% | 49% / 53% | $1.04 |
| Expenses | 10/10 | 10/10 | 10/10 | 100% | 100% | 100% | 100% | 42% / 48% | $1.62 |
| Shop | 10/10 | 10/10 | 10/10 | 100% | 100% | 100% | 100% | 70% / 40% | $1.28 |
| Calculator | 10/10 | 10/10 | 10/10 | 100% | 100% | 100% | 100% | 48% / 63% | $1.23 |
| Board | 10/10 | 10/10 | 10/10 | 100% | 100% | 100% | 100% | 45% / 46% | $0.97 |

*Same app* = share of random sessions in which every build showed identical screens after every action.
Code similarity is only 40–75%: the builds are written differently but behave identically,
which is the point. A build takes about 20–40 s and $0.06–0.16. The whole experiment
(5 converge runs, about 200 builds) cost about $21.

What each round taught (all numbers are from `runs/history.jsonl`):

| Round | Change | Finding |
|---|---|---|
| r1 (v1) | baseline, 5 apps | 30/30 builds OK first try, 100% same app. But the builds used **6 different home-made epsilons** for "round up to cents": latent divergence that random sessions did not hit. |
| r2 (v2) | `Fmt.roundTo/roundUpTo/roundDownTo/cents`, rule "never your own rounding"; `table` seed data; `select … from`; `SPEC CONFLICT` escape; 2 harder apps | Every build now rounds through `Fmt`. A wrong example (mine) went from 4 futile repair attempts ($1.36) to one precise error ($0.11). |
| r2 re-test | guided exploration from example prefixes | Blind sessions never reached a single debt settlement in Expenses (75% of actions unavailable). Guided: 0% unavailable, twice as many distinct screens. Still 100% same app. |
| r3 (v3) | calculator (edge-case heavy), casually written board; `on row with "…"`, `Fmt.decimal` | Even the casual spec converged 100%, including states like **"Doing 4/3"**. **Stable is not correct:** a literal compiler turns a vague spec into consistent, unintended behaviour. |
| r4 (v4) | `always` invariants, `intent review` | All 6 board builds refused to compile, each with the same `SPEC CONFLICT` pointing at the missing guard. After a one-line fix: 6/6 OK, invariant held. `review` then found all 5 remaining gaps for $0.07. |
| r5 (v4) | final: 9 apps × 2 targets × 5 builds | see table above |

## Phase 2: styled apps (the hard part)

In phase 1 the harness owned all rendering, so the LLM only wrote logic. In phase 2 a second
LLM stage writes the **whole UI**: Elm `Html`, or Preact TSX, styled with **Tailwind v4**.
It is checked in real Chromium:

- **DOM contract:** every spec element carries `data-el`, rows carry `data-row`, and options
  carry `data-option`. The harness drives the page with real clicks and typing.
- **Render fidelity:** after every step, the DOM must show exactly what the logic's `Screen` says.
- **Visual sameness:** at `snapshot "…"` checkpoints, screenshots are compared pixel by pixel
  and element boxes are compared (the share of boxes within 8px on every edge). Contact sheets
  are written to `runs/<run>/<app>/sheets/`.

Test apps: `10-helpdesk` (3 pages, sidebar nav, stat cards, filter chips, sort dropdown, a
paged table with badges, an empty state, a drawer with a comment timeline, a dialog with a
segmented control and a toggle, toasts, progress and bar chart, a settings form: about 30
component types) and `11-storefront` (product-card grid, category tabs, cart panel, discount
form, summary lines, toast). They use different designs (comfortable/indigo/large radius and
compact/emerald/small radius).

| Round | Change | Helpdesk boxes within 8px (Elm / TS / Elm↔TS) | Pixels differ Elm↔TS |
|---|---|---|---|
| v5 | LLM writes Tailwind freely; the theme comes from `design` | 93% / 58% / 74% (end states) | 2.3% |
| v6 | `snapshot` checkpoints (incl. drawer, dialog); rule "show only what the spec names" | 72% / 35% / 53% | 2.4% |
| v7 | **Kit**: class recipes per presentation, generated from `design` | 81% / 83% / 85% | 0.8% |
| v8 | layout defaults (spec order, button rows, sidebar footer); `data-el` placement precise | 98% / 73% / 85% | 0.7% |
| v9 | card composition rules; components with a base presentation (`component X as card`) | **99% / 97% / 98%** | **0.1%** |

Storefront at v9: 90% / 92% / 91%, pixels differ 0.1%. At every round all builds behaved
100% the same and every page matched its logic. In the last two rounds all builds passed on
the first attempt.

What moved the numbers, in order of effect:
1. **A design system generated from the spec (the Kit)** gave one shared scale for spacing,
   type and colour. It is the biggest lever. Without it every build invents its own scale.
2. **Defaults for silence in layout:** order, button rows, what a `card` does with a table,
   where a sidebar footer goes. Each one came from a concrete divergence in the report.
3. **Typed components** (`component StatCard as card "…"`): a look sentence then only
   describes a *difference* from a known presentation.
4. **A precise measurement contract** (which element carries `data-el`). Part of the "variance"
   was the measurement, not the look.

A harness bug is worth recording. The Kit had a recipe named `main`, which Elm reserves.
The Elm builds "repaired" the compile error by silently not using the Kit, and their numbers
dropped. The pipeline showed the drop, and counting Kit references per build explained it.

## Phase 3: reuse — bundles, behaviour components, lockfile, source map

Specs can now reuse specs. A **bundle** (`lib/std/list.intent`, starting with `bundle std.list`)
holds records, choices, components and a design. An app pulls it in with `import std.list`.

```
component Pager as footer "The page info on the left; previous and next on the right." {
  param items "the list to show one page at a time"
  param size = 5
  state {
    page: Int = 1
  }
  derive {
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

An app uses it with `use pager = Pager` and bindings in its block (`items = sorted`). The
compiler expands this deterministically: names become `pager.next`, `pager.page`, and the
DOM gets `data-el="pager.next"`.

- `intent.lock` pins every bundle by content hash. A bundle that changes without being re-locked
  fails the check.
- `intent expand` prints the canonical, expanded spec. The LLM always reads this form, with the
  origin of each line (`# from lib/std/list.intent:13`). End-of-line comments are kept as notes.
- Each build writes `sourcemap.json`: every element, handler, state field and derived value →
  spec file:line, plus the component instance and bundle when it came from one. Pointing at a
  button in the app leads to the spec line that made it.
- Bundles in `lib/`: `std.list` (Pager, with a demo app that proves it), `std.feedback`
  (Toast), `ui.admin` (design system: design, StatCard, EmptyState) and `support.tickets`
  (the ticket domain with its badges).

Results (styled, 3 builds per target):

| App | Built on | Same app | Boxes within 8px Elm / TS / Elm↔TS | Pixels differ |
|---|---|---|---|---|
| Helpdesk (rewritten) | ui.admin, std.list, std.feedback, support.tickets | 100% | 96% / 94% / 96% | 0.2% |
| CRM (new, untuned) | ui.admin, std.list, std.feedback | 100% | 74% / 72% / 81% | 0.3% |
| CRM after one language fix | the same | 100% | **100% / 98% / 99%** | **0.0%** |

The CRM was the first app written after the styling work, so it is a held-out test for looks.
Almost all of its divergence was one undefined thing: how wide a `search` field is and whether
its label shows. That became a language rule (v10), not a CRM fix. One TS build per CRM run also
needed a repair: the Toast's empty section was not rendered. The contract now says an empty
section may be left out. That code was re-checked afterwards and passes.

### Held-out test: specs by independent authors

Two authors (fresh agents) wrote specs from a plain description, knowing only the reference
and `lib/`: a workshop sign-up app with a waiting list, and a warehouse inventory. Neither was
tuned for; both reuse `ui.admin`, `std.list` and `std.feedback`.

| App | Builds OK first try | Same app (Elm / TS / Elm≡TS) | Page = logic | Local layout (Elm / TS / Elm↔TS) | Pixels differ |
|---|---|---|---|---|---|
| Workshops | 6/6 | 100% / 100% / 100% | 6/6 | 40% / 43% / 49% | 1.3–1.7% |
| Inventory | 6/6 | 100% / 100% / 100% | 6/6 | 48% / 95% / 64% | 0.5–2.7% |

- **Behaviour generalises:** every build of both apps is the same app. The first report said
  otherwise (70% same app, the page matching its logic in 1 of 12 builds). Both causes were
  harness bugs: the browser driver sent an empty value for "choose option N", and the page
  comparison did not collapse whitespace the way HTML does. Both are fixed, and the builds
  were re-measured without rebuilding.
- **Looks generalise less.** By eye the contact sheets are nearly identical: same layout, same
  components. The box metrics count small padding differences inside cards, which cascade.
  A "local layout" metric (position relative to the parent) was added next to the absolute
  one; it is fairer but not perfect. The gap with tuned apps (87–99%) is real: more Kit
  recipes and layout defaults are needed before new specs converge as tightly.
- **The authors' feedback became language v11:** reserved names listed and narrowed
  (`Event` is free; the generated type is now `Msg`), `visible when` on `use`, `as` on its own
  line, handler idioms (`and stop`, `otherwise`, `its`), a Pager that never shows a page past
  the end, and the module system documented in the reference (they had to learn it from a
  demo app).

### Second held-out round (after v11/v12)

Two new authors wrote a restaurant reservations app and a library loans app from the
v12 reference and skill.

| App | First try | Same app | Page = logic | Local layout (Elm / TS / Elm↔TS) | Pixels differ |
|---|---|---|---|---|---|
| Reservations | 6/6 | 100% | 6/6 | 86% / 97% / 87% | 1.6–2.0% |
| Library | 6/6 | 100% | 6/6 | 59% / 56% / 63% | 0.8–1.0% |

The first measurement said 0% same app for both. The cause was one language silence: how a
dropdown shows "nothing chosen". Some builds rendered an empty placeholder option, others did
not. The language now says `""` is a placeholder, never an option, and observations normalise
it. Looks on new specs improved (Reservations 82–97%, against 40–64% in the first round), but
still vary per spec.

## Phase 4: refinement — improving someone else's app

A spec can `extends` a published app and name its changes: `override`, `add to … after …`,
`drop` (language v13, §4c). Test: the bundled helpdesk was published as
`lib/support/helpdesk.intent`, and `apps/14-supportdesk.intent` refines it. It gets a
different title, triages by priority by default, and adds an SLA note.

- **The base's proofs run on the child.** The first version of the child changed the default
  sort and dropped only the example it knowingly broke. The compiler refused before writing
  code: *"sorting defaults to ByPriority …, so row 1 of page 2 is "#7", but the "paging"
  example expects "#3""*. With two more explicit drops and two new examples, it built first
  try on both targets (9/9 examples).
- **The checker warns statically** (`OVERRIDES_PROOF`) when a base example checks something
  the child changed.
- **The base is pinned with a fingerprint per overridden part.** In a test, a base change to
  the overridden title raised `BASE_CHANGED` on exactly that override line. A base change
  elsewhere asked only for the normal lock review.

## Phase 5: twin compilation, dependencies and a registry

**`intent build` compiles twice.** Compiler A builds the spec the obvious way. Compiler B is a
*probe*: it follows every sentence, example and default, but wherever the spec still leaves a
choice it deliberately takes a different reasonable reading. If the two apps behave
differently, the spec is ambiguous. The build stops and explains, per spec line, what compiler
A and compiler B read, and the sentence or example to add. Two *identical* compilers were not
enough: on a deliberately vague word counter they agreed, because the same model reads the same
way. The probe found three open questions (what separates words, punctuation at the edges,
apostrophes and decimal points inside a word). A twin-verified build is cached by the canonical
spec plus the pinned compiler, so building an unchanged spec again is instant and free.

**Dependencies:** `intent.project` lists a registry and requirements. `intent install` resolves
them with minimal version selection, downloads into `.intent/deps/` and pins versions and
hashes in `intent.lock`. `intent publish` computes the version from the bundle's names and its
demo's behaviour. `examples/consumer/` depends only on the published helpdesk (which pulls in
four more bundles) and refines it, with no local `lib/`. `registry/` is a sample registry.

## Phase 6: APIs, contracts, layers, and screens that call them

**The api profile** (v17) builds HTTP services from the same kind of spec: endpoints with
steps, examples that `call` and `see` answers. The harness owns the router, input validation and
error messages; the LLM writes only handlers. **Contracts** (v18) say what goes over the wire,
in the spirit of Wirespec: every status an endpoint may answer, with its body type. The checker,
the typed handlers and a run-time check on every answer in every test hold implementations to
it. **Refined types** (v19, `type Email = Text matching /…/`) get generated checks on every target.

**Screens call APIs through contracts** (v20). `uses support.ticketsApi as tickets` plus
`tested with "apps/api/tickets-api.intent"`; handlers `call tickets.createTicket with …`, and
`on answer tickets.createTicket` handles the typed answer. The harness generates the call and
answer types (with JSON decoders for Elm), performs calls with `fetch` in the browser, and in
tests answers them from the **real provider build**, not mocks. After each step the calls are
answered until nothing is pending, so the observed screen is settled and the same in every
build. The call log is part of the observation, so two builds that call differently count as
different apps. First run of `apps/15-tickets-ui.intent`: the provider and the screen built on
the first attempt in Elm and TypeScript, both twin-verified (24 sessions each), and 60 of 60
sessions identical across the two targets (801 steps made calls).

**Events** (v22) keep screens up to date with changes made elsewhere. A contract declares
`event ticketCreated: Ticket`, the service's steps `publish` it, and a screen handles it with
`on event tickets.ticketCreated`. A screen's example can let *another client* call the provider
(`call tickets.createTicket with …`) and check that the screen follows. In the browser, events
arrive over Server-Sent Events. `apps/15-tickets-ui.intent` now keeps its list up to date from
events. It built on the first attempt in Elm and TypeScript, twin-verified, and 60 of 60 random
sessions (with 286 calls by another client) were identical across the two targets. In
Chromium, a second page showed a ticket added in the first.

**Choices as structure** (v29): `if <condition> { … } else if … { … } else { … }`, `answer …`
(ends an endpoint) and `stop` (ends a handler) are language; the conditions and steps stay
prose. The checker reports steps that can never run and endpoints that do not answer on every
path. All specs moved over; todo, shop, pomodoro, library (a held-out author's), both API
screens with their APIs and layers, and the notices API rebuilt on the first attempt with it,
twin-verified.

**Time** (v28): `Date` and `DateTime`, `@today` and `@now` in sentences, and a clock the tests
control: every example starts at `examples start at …`, and `wait 1d` moves it on. Services get
recurring work (`every 1m { … }`). Date arithmetic is in the standard helpers, identical in Elm
and TypeScript (checked by the parity test, including leap years and dates before 1970).
`apps/17-habits.intent` (streaks per day) and `apps/api/notices-api.intent` (notices that expire,
at most three an hour) built on the first attempt and twin-verified; the habits screen is the
same in Elm and TypeScript in 60 of 60 random sessions with 286 waits.

**Client layers** (v23) let a screen call a key-protected API. `through std.http.sendKey`
under `uses`, with `key = apiKey` bound to the screen's state, adds the key to every call and
to the event stream. The layer is a verified spec of its own, run by the runtime for both
targets. `apps/16-desk-ui.intent` signs in to the desk API, shows the agent's tickets, and
follows changes made in another tab. Before signing in, the provider's key layer refuses the
screen's event stream, in tests as in the browser. The contract declares
`every endpoint answers 401 Problem`, so a wrong key shows the service's message. Each api
has its own address in the browser (`?api.desk=…`), because hosting is deployment, not intent.

**Layers** (v21) are the parts of an HTTP service nobody wants to think through again:
`std.http.secure` (safe headers), `std.http.cors` (which web pages may call) and
`std.http.apiKey` (who calls; provides `caller` to every endpoint). Each is a spec of its own
with examples, compiled once, twin-verified and cached. An api uses one with
`use cors = std.http.cors` and binds its params, and the verified module is copied in, not
recompiled. `apps/api/desk-api.intent` runs behind all three, and what an agent may do depends
on the caller. All three layers and the desk API built on the first attempt and were
twin-verified. Random sessions reached every status the spec names (401, 403, 404, 409 and the
successes). Eight planted bugs (any origin allowed, keys matched ignoring case or spaces, a
forgotten public path, a missing header) were each caught by a layer's own examples. On a
rebuild, the twin probe found a real gap in the CORS spec: does a header sent with an empty value
count? One compiler treated `access-control-request-method: ""` as a preflight and the other did
not. The spec now says a blank header counts as absent, with an example. The same run exposed an
off-by-one in the ambiguity report for api and layer sessions (it stopped one request before the
request that differed), which is fixed.

## Layout

```
docs/LANGUAGE.md      language reference (also sent to the LLM)
apps/*.intent         example specs, easy → hard
compiler/
  parse.ts            parser + checker (syntax checker, lints)
  gen.ts              deterministic codegen: types, Screen, Event, glue, entry points
  prompt.ts, llm.ts   the compiler prompt; one pure `claude -p` call
  build.ts            one build: scaffold → LLM → compile → examples → invariants, repair loop
  exec.ts             runs examples / sessions against a build (Elm worker or TS bundle)
  fuzz.ts             blind + guided sessions, divergence analysis
  converge.ts         the multi-build pipeline and report
  review.ts           pre-build ambiguity review
  styled.ts, kit.ts   styled profile: theme from `design`, the Kit, entry points
  look.ts             stage 2: the LLM writes the Look; checked in the browser
  browser.ts          Playwright driver: DOM contract, fidelity, screenshots, boxes
  visual.ts           pixel diff, box agreement, contact sheets
  load.ts             imports, bundles, intent.lock, source map
  expand.ts           instantiating behaviour components (`use x = Component`)
  print.ts            canonical printer (`intent expand`): what the LLM reads
  twin.ts             `intent build`: twin compilation, the build cache, providers first
  api.ts              api profile harness: typed handlers, router, test client, `intent client`
  calls.ts            screens that call APIs: Call / answer types, JSON, answer messages
  layer.ts            layers: generated interface, stub app, driver, random requests
  registry.ts         `intent install` / `intent publish`
lib/                  bundles: std.list, std.feedback, ui.admin, support.tickets
runtime/{elm,ts}      Ui (renderer, node model) and Fmt, identical per target
tests/                checker regression, Fmt parity
runs/                 build outputs and reports (history.jsonl is kept)
```

## Limits and next steps

- Phase 1 apps (unstyled) have no layout control; phase 2 adds presentations such as
  `grid`, `row` and `sidebar`, but sizes are still words in `look`.
- The Kit's drawer has no backdrop and overlaps the page: consistent in every build, but a
  design flaw. Stable is not the same as good.
- One screen per app. No navigation, persistence or randomness yet. HTTP calls (v20) show
  the pattern for each: the harness owns the effect, and the spec names it.
- Styled builds of screens that make calls are not in the harness yet.
- Behaviour sentences are natural language. Stability comes from the typed interface,
  the defaults, the examples and the invariants, not from a formal semantics. The
  pipeline measures what that buys, and so far it buys a lot.
- `always` supports `see` checks (including row counts). Richer properties, such as sums
  or relations between elements, would need a small expression form.
- Stability across *spec edits* (rebuild only what changed, keep the rest) is not tested.
  Every build here is from scratch.
