# Intent by example

This guide walks through the language with real specs from this repository, from a counter
to a screen that signs in to an API and follows changes made by other people. Every snippet
is taken from a file that passes the checker; the file name is given with each one.

The full reference is [`LANGUAGE.md`](LANGUAGE.md). It is complete but dense, because it is
also what the compiler reads. Read this guide first.

## The idea in one minute

You write **what an app must be**: its data, its screen, what happens when someone clicks,
the rules that always hold, and examples that prove it. You never write the code.

```
spec (.intent)  →  harness + LLM  →  app (Elm or TypeScript)
                        ↑
            examples, rules and twin builds keep it honest
```

- **The harness** generates everything that needs no judgement: the types, the screen
  rendering, the wiring, the test driver.
- **The LLM** writes only the logic: what each click does, what each endpoint answers.
- **Your examples** are run against every build. A build that fails one is repaired or rejected.
- **Twin builds:** every new spec is compiled twice. The second compiler deliberately picks a
  different reading wherever your text leaves room. If the two apps behave differently, the
  build stops and tells you which sentence was ambiguous, and what to add.

So the same spec gives the same app, and a vague spec is caught instead of guessed.

---

## 1. A first app: a counter

`apps/01-counter.intent`, complete:

```
app Counter {
  "Count things up and down, never below zero."
}

state {
  count: Int = 0
}

screen {
  text count
  button down "−" {
    enabled when count is above 0
  }
  button up "+"
  button reset "Reset"
}

on click up {
  - increase count by 1
}

on click down {
  - decrease count by 1
}

on click reset {
  - set count to 0
}

example "counting up and down" {
  click up
  click up
  see count = 2
  click down
  see count = 1
}

example "never below zero" {
  see down is disabled
  click up
  see down is enabled
  click down
  see count = 0
  see down is disabled
}
```

Reading it top to bottom:

- **Blocks** open with `{` at the end of a line and close with `}`. What is inside belongs to
  that line: the steps of a handler, the modifiers of a button, the rows of a list.
- **`app`** gives the app a name and a purpose (the quoted line). The compiler reads the
  purpose too.
- **`state`** is what the app remembers, with a type and a starting value.
- **`screen`** lists what the user sees. `text count` shows the state `count`. A button has a
  name (`down`) and a label (`"−"`). `enabled when …` is a condition, written as a sentence.
- **`on click up`** says what a click does. Each `- …` line is one step, in plain English,
  using the names you declared.
- **`example`** is a test: steps a user takes (`click`, `type`, `choose`, `toggle`) and what
  they then see (`see …`). Every example starts from the initial state.

Names matter: `data-el="down"` is on the button in the running app, so anything you point at
in the app leads back to its line in the spec.

## 2. Lists, records, choices and derived values

`apps/02-todo.intent`:

```
app Todo {
  "A short list of things to do today."
}

record Item {
  title: Text
  done: Bool = false
}

choice Filter: All | Open | Finished

state {
  items: List Item = []
  draft: Text = ""
  filter: Filter = All
}

derive {
  shown = the items that match filter: All shows every item, Open the items not done, Finished the items that are done
}

screen {
  heading "Today"
  field draft "New item"
  button add "Add" {
    enabled when draft is not blank
  }
  select filter "Show"
  list shown of Item {
    checkbox done
    text title
    button remove "Delete"
  }
  text empty = "Nothing here" {
    visible when shown is empty
  }
  text remaining = "{number of items not done} left"
}

on click add {
  - if an item with the same title (trimmed, ignoring case) exists, do not add anything
  - otherwise add an Item with title = draft trimmed to the end of items
  - clear draft in both cases
}

on click remove {
  - remove that item from items
}

example "finishing and filtering" {
  type "Milk" into draft
  click add
  type "Bread" into draft
  click add
  toggle done on row 1
  see done on row 1 is checked
  see remaining = "1 left"
  choose Open in filter
  see shown has 1 row
  see title on row 1 = "Bread"
}
```

- **`record`** is a kind of thing with fields; **`choice`** is a closed set of values.
- **`derive`** names a value that is computed from state, never stored. `shown` is always
  "the items that match filter".
- **`list shown of Item`** shows one row per item. The elements under it (`checkbox done`,
  `text title`, `button remove`) appear in every row. In a row's handler, "that item" is the
  row's item.
- Some behaviour is **built in**: typing into `field draft` sets `draft`, choosing in
  `select filter` sets `filter`, and toggling `checkbox done` flips that item's `done`.
- **Templates** such as `"{number of items not done} left"` are exact: every character outside
  the braces is kept.
- **`visible when`** hides an element. Examples check it with `see empty is hidden`.
- Rows are addressed in examples by number (`on row 1`) or by what they show
  (`on row with "Milk"`).

## 3. Rules that always hold

An example checks one path. An **`always`** rule is checked after *every* step of many random
sessions (40 sessions of 25 steps per build). From `apps/09-board.intent`, a kanban board with at most three cards in
progress:

```
always {
  see doing has at most 3 rows
}
```

If a build lets a fourth card in, the harness finds the session that does it and hands the
steps back to the compiler to repair. Numeric checks work too, on every row of a list
(`apps/07-shop.intent`):

```
always {
  see every row of products: left is at least 0
  see every row of cart: qty is at least 1
}
```

## 4. Reuse: bundles, components and a design

Specs reuse specs. A **bundle** is a library under `lib/`. `lib/std/list.intent` offers a
pager as a **behaviour component**: it has params, its own state, a screen and handlers.

```
bundle std.list {
  "Showing long lists in pieces."
}

component Pager as footer "The page info on the left; the previous and next buttons on the right." {
  param items "the list to show one page at a time: a state or derived list"
  param size = 5
  state {
    page: Int = 1
  }
  derive {
    pageCount = the number of {items} divided by {size}, rounded up, but at least 1
    current = the smaller of {page} and {pageCount}
    visible = the {items} from position ({current} - 1) × {size} + 1 on, at most {size} of them
  }
  screen {
    text pageInfo = "Page {current} of {pageCount}"
    button previous "Previous" as secondary {
      enabled when {current} is above 1
    }
    button next "Next" as secondary {
      enabled when {current} is below {pageCount}
    }
  }
  on click previous {
    - set {page} to {current} - 1
  }
  on click next {
    - set {page} to {current} + 1
  }
}
```

An app imports the bundle and places the component with `use`, binding its params
(`apps/12-helpdesk-bundled.intent`):

```
import ui.admin
import std.list
import std.feedback
import support.tickets
…
      use pager = Pager {
        items = sorted
        size = 5
      }
```

Everything inside is then called `pager.…`: an example says `click pager.next` and
`see pager.pageInfo = "Page 2 of 2"`.

**Looks** are words too. A bundle can carry a `design` (`lib/ui/admin.intent`):

```
design {
  look "A calm, modern SaaS admin. Light neutral page background; white surfaces with a thin neutral border and a subtle shadow; …"
  brand: indigo
  neutral: slate
  radius: large
}
```

Elements take a presentation (`as table`, `as sidebar`, `as secondary`) and an optional
`look "…"`. Styled builds are checked in a real browser for layout and consistency.

**Refined types** give a kind of text or number one precise rule (`lib/std/text.intent`):

```
type Email = Text matching /[^@\s]+@[^@\s]+\.[^@\s]+/
```

"is a valid Email" in any sentence then means exactly that rule, in every target.

## 5. Improving someone else's app

`extends` takes a whole published app and changes named parts of it. Nothing is copied.
`apps/14-supportdesk.intent` tunes the standard helpdesk:

```
app SupportDesk {
  "Our support desk: the standard helpdesk, tuned to how we triage."
}

extends support.helpdesk

override text pageTitle = the label of page: "Queue", "Reports" or "Settings" as title

override state {
  sort: Sort = ByPriority          # we triage by priority first
}

add to header after pageTitle {
  text slaNote = "Urgent tickets are answered within the hour." as caption {
    visible when page is Inbox
  }
}

drop example "paging"                   # pages follow priority order now

example "triage by priority" {
  see pageTitle = "Queue"
  see ticketId on row 1 = "#8"
}
```

The base's examples still run unless you `drop` them by name. When the base changes, the
checker tells you which of your overrides touch the part that changed.

## 6. Projects and dependencies

A project lists where its bundles come from and which versions it needs
(`examples/consumer/intent.project`):

```
project consumer
registry ../../registry
requires {
  support.helpdesk 1.0
}
```

`intent install` downloads them and pins exact versions and hashes in `intent.lock`.
`intent publish` computes a bundle's version from its names *and* the behaviour of its demo
app, so a change that breaks users is a new major version.

---

## 7. An API instead of a screen

`profile api` describes an HTTP service. From `apps/api/tickets-api.intent`:

```
app TicketsApi {
  "The support desk's tickets and comments, as an HTTP API."
}

implements support.ticketsApi

state {
  tickets: List Ticket = table {
    id | subject                        | customer        | priority | status  | assignee
    1  | "Cannot log in after reset"    | "Mara Jansen"   | Urgent   | Open    | "Sam"
    …
  }
}

endpoint createTicket {
  - if subject, trimmed, is blank, answer 400 "Subject is required" and stop
  - if customer, trimmed, is blank, answer 400 "Customer is required" and stop
  - add a Ticket to the end of tickets with id = the highest id in tickets + 1, subject and customer trimmed, the given priority, status Open and assignee ""
  - publish ticketCreated with the new ticket
  - answer 201 with the new ticket
}

example "creating a ticket" {
  call createTicket with subject = "  Printer on fire ", customer = "Ann", priority = Urgent
  see createTicket.status = 201
  see createTicket.body.id = 9
  see createTicket.body.subject = "Printer on fire"
  see ticketCreated.body.id = 9
  call listTickets
  see listTickets.body has 9 rows
}
```

- Endpoint steps are sentences, like handlers. "answer 400 "…" and stop" refuses; the body
  is always `{ "error": "…" }`.
- The harness routes requests and checks their input before your steps run, with fixed
  messages (`400 "priority must be one of Urgent, High, Normal, Low"`).
- Examples `call` endpoints and `see` the answer: `status`, `body.<path>`, and headers.
- The build is a Node server (`node server.mjs`).

## 8. Contracts: what goes over the wire

The endpoint above has no method or path: they come from a **contract**, a file that says what
the service accepts and answers, and nothing about how (`lib/support/ticketsApi.intent`):

```
contract support.ticketsApi {
  "The support desk's tickets and comments over HTTP: what clients send, and what they get back."
}

import support.tickets

event ticketCreated: Ticket          # a ticket was created, by anyone
event ticketSolved: Ticket           # a ticket was solved, by anyone

endpoint createTicket POST "/tickets" {
  body subject: Text
  body customer: Text
  body priority: Priority
  answers 201 Ticket
  answers 400 Problem
}

endpoint solveTicket POST "/tickets/{id}/solve" {
  path id: Int
  answers 200 Ticket
  answers 404 Problem
  answers 409 Problem               # already solved
}
```

The contract is checked everywhere: the checker (every endpoint implemented, every status
declared), the compiler (only declared statuses compile), and every answer and every event in
every test. **Events** are part of it: `publish ticketCreated with …` in a step sends one to
everyone listening.

## 9. Layers: the parts of a service nobody wants to rewrite

CORS, API keys and safe headers are the same for every API. They are **layers**: specs of
their own in `lib/std/http/`, built and verified once, reused by every API
(`apps/api/desk-api.intent`):

```
app DeskApi
implements support.deskApi

# The first layer sees every request first and every answer last.
use secure = std.http.secure
use cors = std.http.cors {
  origins = "https://desk.example"
  headers = "content-type", "x-api-key"
}
use auth = std.http.apiKey {
  keys = table {
    secret         | owner
    "k-ann-7f3a"   | "Ann"
    "k-sam-91bc"   | "Sam"
  }
  public = "/health"
}

endpoint solveTicket {
  - if no ticket has that id, answer 404 "No such ticket" and stop
  - if that ticket's assignee is not the caller, answer 403 "Only the assignee can solve this ticket" and stop
  - …
}
```

`std.http.apiKey` **provides** `caller` (the owner of the key) to every endpoint, so steps can
say "the caller". Examples send headers: `call solveTicket with header x-api-key = "k-sam-91bc", id = 4`.

A layer is a small spec too. The whole of `lib/std/http/secure.intent`:

```
layer std.http.secure {
  "Safe headers for a JSON API: answers are not sniffed, framed, cached, or leak where a request came from."
}

after every answer {
  - set header x-content-type-options to "nosniff"
  - set header x-frame-options to "DENY"
  - set header referrer-policy to "no-referrer"
  - set header cache-control to "no-store"
  - set header content-security-policy to "default-src 'none'; frame-ancestors 'none'"
  - every other header, the status and the body stay as they are
}

example "every answer gets the headers" {
  request GET "/tickets"
  see status = 200
  see header x-content-type-options = "nosniff"
}
```

## 10. A screen that talks to an API

A screen `uses` a contract, calls its endpoints, and handles the answers and events
(`apps/15-tickets-ui.intent`):

```
app TicketsUi {
  "A small front end for the tickets API: list, add and solve tickets."
}

uses support.ticketsApi as tickets {
  tested with "apps/api/tickets-api.intent"
}

state {
  rows: List Ticket = []            # the tickets, newest first
  draft: Text = ""
  problem: Text = ""
}

on start {
  - call tickets.listTickets
}

on answer tickets.listTickets {
  - if its status is 200, set rows to its body
}

on click add {
  - call tickets.createTicket with subject = draft, customer = "Web" and priority = Normal
}

on answer tickets.createTicket {
  - if its status is 201, clear draft and problem
  - otherwise set problem to the error in its body
}

on event tickets.ticketCreated {
  - if no row in rows has the id of its body, add its body at the start of rows
}

example "another agent adds a ticket" {
  call tickets.createTicket with subject = "Coffee machine broken", customer = "Iris", priority = Low
  see rows has 9 rows
  see subject on row 1 = "Coffee machine broken"
}
```

- **No mocks.** `tested with` names the real API spec. The examples run against a build of it,
  with its seed data: that is why the list has 8 rows.
- Calls are answered right after the step that made them; the screen you `see` is settled.
- **Other clients.** In a screen's example, `call tickets.createTicket …` is *someone else*
  calling the API. The screen only sees the event, so this example proves the list follows
  other people's changes.
- In the browser, calls go out with `fetch` and events arrive over Server-Sent Events.

## 11. Signing in: a key from the screen

A screen sends the user's key through a **client layer**, bound to its state
(`apps/16-desk-ui.intent`):

```
app DeskUi {
  "An agent's own tickets, after signing in with their API key."
}

uses support.deskApi as desk {
  tested with "apps/api/desk-api.intent"
  through std.http.sendKey {
    key = apiKey
  }
}

state {
  apiKey: Text = ""                # the key the agent signed in with
  mine: List Ticket = []
  problem: Text = ""
}

screen {
  field apiKey "API key"
  button signIn "Show my tickets" {
    enabled when apiKey is not blank
  }
  …
}

on answer desk.myTickets {
  - if its status is 200, set mine to its body and clear problem
  - if its status is 401, clear mine and set problem to the error in its body
  - otherwise set problem to "Could not load your tickets"
}

example "a wrong key" {
  type "k-bob-0000" into apiKey
  click signIn
  see problem = "Unknown API key"
}

example "before signing in, nothing arrives" {
  call desk.takeTicket with header x-api-key = "k-ann-7f3a", id = 4
  see mine has 0 rows
  see problem is hidden
}
```

Signing in is just setting `apiKey`: every call and the event stream carry it from then on.
The last example proves that a screen without a key gets no events, because the API's key
layer refuses its event stream, in tests as in the browser.

---

## 12. Examples: the steps you can use

```
type "Milk" into draft              choose Open in filter          toggle done on row 1
click add                           click remove on row with "Milk"
see count = 2                       see add is disabled            see empty is hidden
see shown has 1 row                 see stock is at least 0        see every row of cart: qty is at least 1
wait 3s / tick 5 times              snapshot "queue"               (screens)
call createTicket with a = 1        see createTicket.body.id = 9   see ticketCreated is absent   (apis)
call x with header x-api-key = "…"  see x.header.vary = "origin"   request OPTIONS "/tickets" with header origin = "…"
```

Write examples you could compute by hand. They are the only thing that says what "right" is:
a literal compiler turns a vague spec into consistent, *unintended* behaviour.

## 13. Working with it

```sh
npm install
node compiler/cli.ts check apps/02-todo.intent     # the checker: names, types, bindings, examples
node compiler/cli.ts expand apps/14-supportdesk.intent   # the spec exactly as the compiler reads it
node compiler/cli.ts build apps/02-todo.intent     # twin build → runs/single/02-todo/{elm,ts}/index.html
node compiler/cli.ts build apps/api/desk-api.intent  # → runs/single/desk-api/ts/server.mjs
```

- **The checker** runs in milliseconds and catches most mistakes with a file and line: an
  unknown name, a button without a handler, an element no example checks, a call to an
  endpoint the contract does not have.
- **A build** compiles twice, runs every example and `always` rule, and compares the two apps
  on random sessions. The result is cached: building an unchanged spec again is instant.
- **When a build stops**, it says why in terms of your spec: an example that fails (with the
  screen at that moment), a rule a session broke (with the steps), or an ambiguity (the two
  readings, and the sentence or example that would settle it).
- **Open a UI build** by opening its `index.html`. A screen that uses an API reads its address
  from the URL: `index.html?api.desk=http://localhost:3000`.

## 14. Where to look next

| File | What it shows |
|---|---|
| `apps/01-counter.intent` | state, a screen, handlers, examples |
| `apps/02-todo.intent` | records, choices, `derive`, lists, templates, built-in behaviour |
| `apps/04-pomodoro.intent` | a clock (`clock every 1s`, `on tick`, `wait 3s` in examples) |
| `apps/07-shop.intent` | a cart, numeric `always` rules on every row |
| `apps/09-board.intent` | `always` rules |
| `apps/10-helpdesk.intent` | a large styled app: sections, a drawer, a table, a chart |
| `apps/12-helpdesk-bundled.intent` | the same app built from bundles |
| `apps/14-supportdesk.intent` | refinement: `extends`, `override`, `add to`, `drop` |
| `apps/api/tickets-api.intent` | an API implementing a contract, publishing events |
| `apps/api/desk-api.intent` | an API behind layers, with rules per caller |
| `apps/15-tickets-ui.intent` | a screen calling an API, following events |
| `apps/16-desk-ui.intent` | signing in with a key through a client layer |
| `lib/` | bundles, contracts and layers to reuse |
| [`LANGUAGE.md`](LANGUAGE.md) | the full reference, with the changelog |
| [`../skills/intent-spec/SKILL.md`](../skills/intent-spec/SKILL.md) | how an LLM should write specs with you |
