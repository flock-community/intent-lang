# Intent — language reference (v32)

Intent describes **what an interactive app must be**: its data, what is on screen, what
happens when the user acts, and examples that prove it. A compiler (an LLM held in place
by a harness) turns it into an app. The spec is the source; code is a disposable
derivative that must be rebuildable at any moment and behave the same every time.

Lineage: this is the app profile of `language.md` (v0.1). It keeps *scenarios as proof*,
*closed vocabularies*, *text anchored to declared names* and *build is a pure function*,
and narrows the scope to single-screen apps so that "is it the same app?" can be measured.

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
  a block, indent 2 spaces per level (`intent fmt` lays a file out). Tabs are an error.

  ```
  screen {
    button add "Add" {
      enabled when @draft is not blank
    }
  }
  ```

  A file without braces is read by its indentation alone (the form before v24); `intent fmt`
  turns it into braces.
- **References:** in a sentence (a step, a condition, a derived value, a rule, an endpoint's or
  a layer's steps), a name from the spec is written with `@`: `@draft`, `@Item`, `@Open`,
  `@pager.visible`, `@tickets.createTicket`. Everything else in the sentence is prose.

  ```
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
- `#` starts a comment (outside strings). Blank lines are ignored.
- Names: element, field and state names are `lowerCamel`; app, record and choice names and
  choice values are `UpperCamel`.
- Strings: `"…"` with `\"` and `\\` escapes. Inside a template string `{…}` is a hole.
- Numbers: `12`, `-3`, `2.50`. Durations: `1s`, `250ms`, `2m`.

## 3. Blocks

A file is a sequence of top-level blocks, in any order:

```
app Name { "purpose" }      # first line of an app; its block holds the purpose (strings)
bundle std.name             # first line of a library file instead (§4b)
import std.list             # reuse a bundle (§4b)
extends support.helpdesk    # refine a published app (§4c): override, add to, drop
record Name { … }           # a data shape: `field: Type [= default]` lines
choice Name: A | B "Bee" | C  # a closed set of values; an optional "label" is what users see
type Email = Text matching /…/  # a refined type: a base type with one precise rule (§3a)
design                      # optional: how the app looks (§4a)
component Name "look"       # optional: a reusable look for sections/elements (§4a)
state { … }                 # what the app remembers: `[stored] field: Type = default` lines
clock every 1s              # optional: the app receives a tick every interval
derive { … }                # named values computed from state: `name = sentence`
screen { … }                # what the user sees, top to bottom (§4)
on <verb> <element> { … }   # what happens (§5): `- sentence` lines
rules { … }                 # invariants in words: `- sentence` lines
always { … }                # what must always hold, checked after every step: `see` steps (the screen) and `- sentence` lines (the data)
example "name" { … }        # proof (§6): steps
```

Types: `Text`, `Int`, `Decimal`, `Bool`, `Date`, `DateTime`, `List T`, `T or nothing`, a
record name, a choice name. `T or nothing` is a value that may be absent: say so instead of
using a stand-in such as `0` or `""` (`selected: Int or nothing = nothing`, then
`visible when there is a @selected` and `set @selected to nothing`). `Maybe T` still reads.
There is no null and no stand-in: wherever a sentence uses such a value, it says what happens
when there is none, in the sentence ("…, or nothing when there is no @selected") or around it
(`if there is a @selected { … }`, or an early `if there is no @selected { stop }`). The checker
warns (`UNGUARDED`) when it does not. Literals of the time types: `2026-09-24` (a Date) and `2026-09-24 09:00`
(a DateTime, to the minute, in the app's own local time).
Every `state` field needs a default. Literals: `"text"`, numbers, `true`/`false`, `[]`,
`nothing`, choice values.

**Stored state.** A field marked `stored` survives a restart; every other field starts from its
default each time the app starts. Mark what the user would be upset to lose (their habits, their
tickets), not what belongs to one visit (a draft, a filter, an open drawer):

```
state {
  stored habits: List Habit = []
  draft: Text = ""
}
```

The harness keeps stored fields: a screen in the browser's local storage, an api in a data file
on the server (`INTENT_DATA`, default `data.json`). The spec's default is used the first time,
and whenever the kept data cannot be read. In examples, `restart` starts the app again (§6), and
random sessions restart now and then; after every restart the harness checks that the stored
fields came back exactly as they were. Stored fields live in the app's own state, not in a
component's.

Seed data for a `List <Record>` is written as a table. Columns are record fields; omitted
fields take the record's defaults:

```
state {
  products: List Product = table {
    name      | price | stock
    "Apple"   | 0.40  | 10
    "Bread"   | 2.35  | 3
  }
}
```

## 3a. Refined types

A refined type is a base type with one precise rule. It is defined once, and every build checks
it the same way:

```
type Email = Text matching /[^@\s]+@[^@\s]+\.[^@\s]+/    # the whole text must match
type Age = Int from 0 to 150                              # inclusive
type Price = Decimal from 0
```

- Use it like any type: `mail: Email`, `body email: Email`, `List Email`.
- In sentences, "is a valid Email" means exactly the rule. The compiler generates the check
  (`isEmail`) for every target, and builds never write their own.
- The checker checks seed data, defaults and literals against the rule before any build.
- An api answers a value that breaks the rule with `400 {"error": "<name> must be a valid Email"}`.
  A contract that answers a refined type is checked against it too.
- Common ones are in bundles: `import std.text` gives `Email`.

## 3b. Time

A spec reads the clock with `@today` (a Date) and `@now` (a DateTime), in any sentence:

```
button done "Done today" {
  enabled when this habit has no @Done on @today
}
text date = "{the weekday of @today} {@today as a date}"
```

- Dates and moments compare and sort as you would expect ("before", "after", "the latest").
  "N days after", "the day before", "the weekday of", "minutes between", "as a date"
  ("4 Sep 2026") and "as a moment" ("4 Sep 2026 09:05") are computed with the standard helpers,
  the same in every target.
- **In tests the clock is the harness's.** Every example and random session starts at the same
  moment: `examples start at 2026-09-24 09:00` (a top-level line; without it, Monday 2026-01-05
  09:00). `wait 1d`, `wait 2h`, `wait 15m` move the clock on and show the screen again. With a
  `clock every …` tick, `wait` also ticks that often. Random sessions mix in waits too.
- In the browser and on the server, the clock is the local time.

**Recurring work** (apis): `every 15m { - … }` runs its steps on that interval, reading
`@now`. On the server it runs on a timer; in tests, whenever a `wait` moves the clock past its
next time (counted from the start), in order, before the next step.

## 4. Screen elements

| Element | Form | Shows | User can |
|---|---|---|---|
| `heading` | `heading "Static text"` | fixed text | — |
| `text` | `text name` or `text name = expr` | a text value | — |
| `field` | `field name "Label"` | an editable text box | type |
| `button` | `button name "Label"` or `button name = expr` | a button | click |
| `checkbox` | `checkbox name ["Label"]` | a tick box | toggle |
| `select` | `select name ["Label"]` | one value of a choice | choose |
| `select … from` | `select name ["Label"] from list.field` | one of the texts `field` of the items in `list` | choose |
| `list` | `list name of Type [= expr]` | rows; children are the row's elements | act on a row |
| `section` | `section name ["Title"]` | a group; children are elements | — |
| `progress` | `progress name ["Label"] [= expr]` | a value 0–100 as a bar | — |
| `use` | `use name = Component` + bindings | a behaviour component (§4b) | what it offers |

Modifiers, in the element's block:

- `visible when <sentence>` — the element (or section) is absent from the screen otherwise.
- `enabled when <sentence>` — buttons only; a disabled button cannot be clicked.
- `look "<sentence>"` — how this element looks, in words (§4a).

Any element can end with `as <presentation>`: a built-in presentation (below) or a declared
`component`. Presentation changes the look, never the behaviour.

Binding (checked by the compiler):

- `text x` without `=` shows state `x`, derived value `x`, or — inside a list — the row
  item's field `x`. With `= expr`, `expr` is either a template string (`"{count} left"`)
  or a sentence.
- Inside a template hole `{…}`: a declared name (`{count}`, `{toast.message}`), a field of
  the row's item inside a list (`{title}`), a name with a display format (`{total as money}`),
  or a short phrase over declared names (`{the number of attendees}`, `{today + 14}`). Keep
  holes short: name longer computations in `derive`. Display formats: `as money` (two
  decimals), `as decimal` (up to 8 decimals), `as clock` (m:ss), `as percent` (a whole number
  and `%`). A hole that can be empty (nothing chosen yet) needs an explicit text for that case.
- `field x` edits state `x`, which must be `Text`. Typing replaces `x` with the typed text.
- `select x` edits state `x`, which must be a choice; its options are the choice values in
  declared order.
- `select x from items.name` edits state `x`, which must be `Text`; its options are the
  `name` of every item of `items`, in list order. Choosing sets `x` to that text.
- `checkbox x` edits state `x` (a `Bool`), or inside a list the row item's `Bool` field
  `x`. Toggling flips it.
- `list x` without `=` shows state or derived value `x`, which must be a list.
- Names are unique on the screen, except inside a list, where row elements have their own
  scope. Sections do not create a scope.
- A section title and a field label are fixed text. To show a changing title, use
  `text x = … as title` as the section's first element.
- `select x from items.name` with `x` = `""`, or a text that is not among the options,
  shows no option as chosen. `""` is shown as an empty placeholder; it is never one of the
  options. To un-pick, a handler sets `x` to `""` (for example a "Clear" button).
- Relations between records are by value: keep the related record's name, title or id in a
  field (`workshop: Text`, `ticket: Int`), and match on it.
- A filter with an "all" option is its own choice, with its own value names:
  `choice CategoryFilter: AnyCategory "All" | OnlyBrakes "Brakes" | …`. Value names are unique
  across the app.

`as <presentation>` goes at the end of the element's line. When that line is long (a long
`= …` sentence), put it in the element's block instead:

```
text places = "Full" when its signups reach its capacity, otherwise "{n} places left" {
  as badge
}
```

## 4a. Look: design, components, presentations

```
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

section openStat as StatCard {
  text openLabel = "Open"
  text openValue = the number of @Open @tickets
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

## 4b. Reuse: bundles, imports and behaviour components

A **bundle** is a library file under `lib/`: `lib/std/list.intent` starts with
`bundle std.list`. It holds records, choices, components and a `design`. State, screens and
behaviour live inside its components. A bundle is proven by its demo app (for example
`lib/std/list.demo.intent`).

```
import std.list                      # everything std.list declares
import std.list.Pager                # one name
import std.list.Pager as TicketPager # one component, renamed
```

All imported names share one namespace; a name declared twice is an error.

**Import what you use.** A name used in a file (in a sentence, `@Solved`, or as a type,
`mine: List Ticket`) must be declared in that file or in a spec the file names itself: `import`,
`uses`, `implements`, `extends`. A name that only arrives through another spec (a contract's own
import, say) is an `IMPORT` error that names the spec to import. So a reader can always find
where a name comes from without leaving the file. A bundle's
`design` becomes the app's design; the app's own `design` lines override it.

**Behaviour components** have parameters and their own state, derived values, screen,
events, rules and `always` checks:

```
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
every use gets its own copy. The checker warns (`UNSCOPED`) when you don't.

An app places a component with `use`, and binds its params in its block:

```
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

```
  use pager = Pager {
    items = sorted
    visible when @sorted is not empty
  }
```

The look of a bundle component's elements belongs to the bundle; an app cannot restyle
them one by one yet (`NOT_YET`). Change the design, or propose a change to the bundle.

**Locking.** `intent.lock` (one per repository, at its root) pins every bundle by content hash,
plus the language reference and the model the compiler uses. A bundle that changed since it
was locked fails the check until someone reviews it and runs `intent lock <app>`. Builds never
pick up a library change silently.

**Version.** A spec may say which language version it was written for, on a line of its own:
`language v12`. The checker warns when the language has moved on since.

**Notes.** A comment at the end of a line (`remaining: Int = 1500  # seconds left`) is a note:
the compiler reads it too. A comment on a line of its own is only for people.

`intent expand <app>` prints the app as the compiler reads it: imports resolved, components
expanded, and each line marked with where it came from.

## 4c. Refinement: improving someone else's app

A published app (an `app` file in `lib/`, e.g. `lib/support/helpdesk.intent`) can be the base
of another spec. The new spec starts as a copy of the base and names every change:

```
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
- **The base is pinned.** `intent lock` records the base and a fingerprint of every part you
  override. When the base changes, the check stops (`LOCK`), and marks each override whose
  base part changed (`BASE_CHANGED`), so you review exactly those.
- One level deep: a base does not itself extend another spec. Compose components for more.
- An override that many specs make is a sign that the base is missing something (a param,
  a rule); propose it to the base's author.

## 4d. Projects, dependencies and the registry

A project lists the bundles it needs in `intent.project`, at its root:

```
project our-desk
registry https://registry.example.org       # or a folder: ./registry
requires {
  support.helpdesk 1.0
  std.list 1.2
}
```

`intent install` (and `intent build`, before compiling) picks versions with **minimal version
selection**: for every bundle, the highest of the minimum versions required anywhere, within
the same major version. It never picks a release that nobody asked for. Downloads go to
`.intent/deps/`, and `intent.lock` pins each version with its hash. A bundle in the project's
own `lib/` always wins, so bundles can be developed in place.

`intent publish lib/x/y.intent` publishes a bundle with a **computed** version:

- **major:** a name, field, choice value, param, element, state or derived value is removed,
  a param becomes required, or an example of the bundle's demo app changed or disappeared
  (its behaviour changed);
- **minor:** something is added;
- **patch:** anything else.

A bundle is published together with its demo app (`lib/x/y.demo.intent`), which must pass the
checker. A published app is its own demo. The registry is static files (`index.json` plus one
file per version), so any file server can host it.

## 4e. The api profile

A spec with `profile api` describes an HTTP service instead of a screen. Its vocabulary is
the profile spec `lib/profile/api.intent`. Records, choices, state, derive, rules, `always`,
examples, imports and refinement work as everywhere else.

```
app TicketsApi
profile api
import support.tickets

endpoint createTicket POST "/tickets" {
  body subject: Text
  body customer: Text
  body priority: Priority
  returns Ticket
  if @subject, trimmed, is blank {
    answer 400 "Subject is required"
  }
  - add a @Ticket to the end of @tickets with @id = the highest @id in @tickets + 1, …
  answer 201 with the new ticket
}

example "creating a ticket" {
  call createTicket with subject = "Printer on fire", customer = "Ann", priority = Urgent
  see createTicket.status = 201
  see createTicket.body.id = 9
  see listTickets.body[1].id = 9          # after `call listTickets`; lists count from 1
}
```

- `path x: T` (appears in the path as `{x}`), `query x: T` and `body x: T` are the input;
  `returns T` is the answer's body. Steps are sentences, as in handlers: "answer 200 with …",
  `answer 404 "…"` (which ends the endpoint), inside `if <condition> { … }` where it applies.
- The harness routes requests and checks their input before the service sees them. It answers
  these itself, with fixed messages: `404 {"error":"Not found"}`, `405 {"error":"Method not
  allowed"}`, `400 {"error":"<name> is required"}` and `400 {"error":"<name> must be <type>"}`.
  Refusals written in the spec have the same shape: `{"error": "…"}`.
- `call x with a = 1, b = "…"` sends a request, and `see x.status` / `see x.body.<path>` check the
  latest answer of `x`. `has N rows`, numeric checks and `see every row of x.body: …` work on
  lists. A param left out of a `call` is not sent, which tests the harness's `is required` answer.
- A build is a Node server (`node server.mjs`, `PORT`) plus the same pure handler under test.
  With `INTENT_TRACE=1`, every answer carries `x-intent-source`: the spec line that gave it (the
  step that answers that status, the endpoint, or the layer that refused). Leave it off in
  production: it names files. A build's `sourcemap.json` maps every element, handler, step,
  endpoint, event, layer, rule and example to its file and line.
  Twin compilation, examples, `always` and random call sessions work as for screens.
- Headers: `call x with header x-api-key = "…", a = 1` sends a request header;
  `see x.header.vary = "origin"` and `see x.header.vary is absent` check an answer's header
  (names are lower case). `see x.body.field is absent` checks that a value is not there.
- A raw request, for what is not an endpoint (a preflight, an unknown path):
  `request OPTIONS "/tickets" with header origin = "…", query status = Open, body text = "…"`,
  then `see request.status`, `see request.header.<name>`, `see request.body…`.

## 4f. Contracts: what goes over the wire

A **contract** is a publishable file that says what a service accepts and answers, and nothing
about how. It holds records, choices, endpoint signatures with every status they may answer,
and examples. The app that provides the service `implements` it and writes only behaviour:

```
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
  call solveTicket with id = @createTicket.body.id     # a value from an earlier answer
  see solveTicket.status = 200
}
```

```
app TicketsApi
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
- **The consumer** uses a typed client generated from the same contract version:
  `intent client support/ticketsApi.intent`.
- **Events** are part of the contract: `event ticketCreated: Ticket` says the service announces
  that something happened, with a payload. An endpoint's step says when:
  `- publish ticketCreated with the new ticket`. The implementation may publish only declared
  events, and every payload is checked against its type in every test. In examples,
  `see ticketCreated.body.subject = "…"` checks what the latest call published, and
  `see ticketCreated is absent` checks that it published nothing of that kind. The server sends
  events to every open `GET /events` stream (Server-Sent Events, `{ "event": …, "body": … }`),
  after the layers let the stream through.
- **Versions are computed on publish:** a removed endpoint, param or answer, or a changed type,
  makes a new major version.

## 4g. Calling an API from a screen

A screen that talks to a service names the service's contract and calls its endpoints. The
answers come back as events:

```
app TicketsUi
uses support.ticketsApi as tickets {  # the contract; its types come with it
  tested with "apps/api/tickets-api.intent"     # the provider the examples run against
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
    - clear @draft and @problem, and call @tickets.listTickets
  } else {
    - set @problem to the error in its body
  }
}
```

- `uses <contract> as <alias>` makes the contract's endpoints callable as `<alias>.<endpoint>`.
  Its records and choices (and `Problem`) are available to the app.
- `call <alias>.<endpoint> with a = …, b = …` in a handler step sends a request. An optional
  argument that is not given is absent.
- `on answer <alias>.<endpoint>` handles the answer. "its status" is the status; "its body" is
  the body, typed by the contract for that status. An answer the contract does not allow (the
  network is down, or the body has the wrong shape) is not any declared status: an `else`
  covers it.
- `on start` runs once when the app starts.
- Where a service is hosted is not in the spec: in the browser, calls to `<alias>` go to the
  `api.<alias>` query parameter, else `api`, else the page's own origin
  (`index.html?api.desk=https://desk.example/api`).
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

**Other clients.** In a screen's example, `call tickets.createTicket with subject = "…", …` is
another client calling the provider: the screen does not see the answer, only the events it
publishes. That is how an example proves that the screen follows changes made elsewhere:

```
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

## 4h. Layers: reusable parts of an HTTP service

CORS, API keys and safe headers are the same for every API and easy to get subtly wrong. They
are **layers**: specs of their own (`lib/std/http/`), compiled once, proven by their own
examples, and reused by every api that runs behind them.

```
app DeskApi
profile api

use secure = std.http.secure          # safe headers on every answer
use cors = std.http.cors {  # which web pages may call
  origins = "https://desk.example"
  headers = "content-type", "x-api-key"
}
use auth = std.http.apiKey {  # who calls; provides `caller`
  keys = table {
    secret       | owner
    "k-ann-7f3a" | "Ann"
  }
  public = "/health"
}

endpoint solveTicket POST "/tickets/{id}/solve" {
  path id: Int
  if that ticket's @assignee is not the @caller {
    answer 403 "Only the assignee can solve this ticket"
  }
}
```

- `use <name> = <layer>` binds the layer's params in its block: a literal, literals
  separated by commas (a list), or a `table`. Params with a default may be left out.
- Layers run in the order of the `use` lines: the first sees every request first and every
  answer last. A layer that answers (a refused key, a preflight) stops the request: later layers
  and the app are not reached, and the answer goes back out through the layers before it. So put
  `secure` first (every answer gets its headers) and `cors` before `auth` (a page can read a 401).
- A layer can **provide** values to every endpoint: `std.http.apiKey` provides `caller`, the
  owner of the key. Endpoint steps use it by name ("the caller").
- A layer's answers are not the app's: the contract of an endpoint (§4f) covers what the app
  answers, not a 401 from `auth`.

Available layers: `std.http.secure` (x-content-type-options, x-frame-options, referrer-policy,
cache-control, content-security-policy), `std.http.cors` (`origins`, `headers`, `maxAge`),
`std.http.apiKey` (`keys`, `keyHeader`, `public`; provides `caller`; secrets compared in
constant time).

**Writing a layer** (`layer std.http.cors`): `param name: Type [= default]`, `provides name:
Type`, `before every request` (steps that may `answer`, which stops the request, or pass it on) and
`after every answer` (steps that change the answer on its way out, usually its headers; this
runs for every answer, including the harness's 404 and 400). Examples send raw requests and
check the answer with `see status = 204`, `see header vary = "origin"`, `see body.error = "…"`.
They run the layer around a stub app that answers `200 { "reached": true, … }` with what the
layer provided (`see body.caller = "Sam"`). `examples with` binds the params the examples use;
`given key = ""` changes one from that step on.

**A client's layer** wraps the calls a screen makes instead of a service: it has only
`before every call`, which changes each call as it leaves (usually: adds a header). It also
runs for the screen's event stream. `std.http.sendKey` sends the user's key in `x-api-key`,
the client side of `std.http.apiKey`. Its examples send `request …` and see the call as it
leaves: `see header x-api-key = "…"`, `see body.path = "/tickets/mine"`.

```
uses support.deskApi as desk {
  tested with "apps/api/desk-api.intent"
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
on start                # once, when the app starts
on answer tickets.listTickets   # the answer to a call (§4g)
```

Each `- sentence` in the block is one step, applied in order. Refer to declared names exactly.
Choices are structure (`if … { } else { }`, below); the steps themselves are plain sentences.

Idioms the compiler reads the same way every time:

- **Choices are structure, not prose.** The conditions are sentences; which steps they guard,
  and where that ends, is language:

  ```
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
- A step written as prose control ("- if …, … and stop", "- otherwise …") still reads, but the
  checker hints (`UNSTRUCTURED`) to write it as structure.
- **The row's item:** in a handler for a button inside a list, "that <item>" (e.g. "that
  ticket") is the item of the clicked row. In an expression inside a row, "its" and "this
  <item>" refer to the row's item: `text left = its @capacity minus its number of sign-ups`.
- **Adding a record:** `- add a @Ticket to the end of @tickets with @subject = @draft, trimmed,
  and @status @Open`. New ids: `@id = the highest @id in @tickets + 1` (1 when there are none).
- **Messages in handlers** refer to the clicked row's fields by name: `set @toast.message to
  "Cancelled {guest} at {time}"` inside `on click cancel` of a row.
- **Named intermediate values:** give a value a name in `derive` and use that name (for
  example `quantity = @amount read as a whole number`), instead of repeating the phrase.

## 6. Examples

An example starts from the initial state and runs steps in order. Steps (closed set):

```
type "Milk" into draft
click add
click remove on row 2 [of visible]
toggle done on row 1 [of visible]
choose Done in filter
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
```

`always` holds `see` checks that must be true after every action, in every session, not
only in the examples. A check on an element that is not on the screen is skipped. For
counting rows, `has at most N rows` and `has at least N rows` are allowed too:

```
always {
  see doing has at most 3 rows
}
```

The harness checks `always` rules in examples, in its own exploration of each build, and in
the differential sessions. `see x has N rows` (exactly N) works too.

Numbers and rows:

```
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

```
always {
  see every row of habits: streak is at least 0
  - no two @dones have the same @habit and the same @day
  - no @Done has a @day after @today
}
```

The harness checks every such sentence after every step of every example and random session.
A separate compiler stage turns the sentences into checks, once per spec and apart from the
app's code, so an app cannot bend a check to its own reading; every build of the spec runs the
same checks. The app hands its data over (every state field, generated as `Data`). A sentence
that does not hold fails the build like any `always` check, with the steps that led there and the
data at that moment. `rules` stays for guidance the compiler reads but nothing checks (how
something is done, what a word means); a rule that reads like an invariant gets an `UNCHECKED`
hint to move it to `always`.

`has 1 row` and `has 3 rows` are both fine. `see x on row 2 is hidden` checks an element inside a
row. A list hidden by `visible when` counts as not on the screen: check it with
`see list is hidden`, not with a row count.

Rows are counted from 1, in screen order. `of <list>` is needed only if the element name
exists in more than one list.

## 7. Checker (`intent check`)

The checker runs before any compile. Errors stop the build; warnings are the backlog of
places where the spec is not yet precise.

| Code | Level | When |
|---|---|---|
| `SYNTAX` | error | a line does not match any form |
| `INDENT` | error | tabs, odd indentation, or a child where none is allowed |
| `SYNTAX` | error | also: a `}` without its `{`, or a `{` that is never closed |
| `UNKNOWN_NAME` | error | a reference to an undeclared element, field, type or value |
| `BAD_BINDING` | error | e.g. `field x` where state `x` is not Text |
| `DUPLICATE` | error | a name declared twice in one scope |
| `RESERVED` | error | a name that clashes with target keywords or generated names (see below) |
| `STEP` | error | an example step that does not match the element (click a text, …) |
| `NOT_YET` | error | a construct the language does not have yet (see "Growing the language") |
| `NO_HANDLER` | warning | a button without `on click` |
| `UNPROVEN` | warning | a dynamic element never checked by any `see` |
| `UNANCHORED` | warning | a rule or handler sentence that mentions no declared name |
| `NO_EXAMPLES` | warning | the app has no examples |
| `LOCK` | error | a bundle is not locked, or changed since it was locked (§4b) |
| `UNSCOPED` | warning | inside a component, one of its own names is not written with `@` |
| `IMPORT` | error | a name comes from a spec this file does not import itself (add the `import` it names) |
| `UNREACHABLE` | error | a step after `stop` or `answer` in the same block |
| `NO_ANSWER` | error | an endpoint that does not `answer` on every path |
| `UNSTRUCTURED` | warning | control words written as prose ("and stop", "otherwise"): write `if … { } else { }`, `answer`, `stop` |
| `UNGUARDED` | warning | a sentence uses a `T or nothing` value without saying what happens when there is none |
| `UNCHECKED` | warning | a `rules` sentence reads like an invariant: move it to `always { - … }` so it is checked |
| `UNMARKED` | warning | a sentence uses a declared name without `@` (mark it, or reword if it is English) |
| `UNUSED` | warning | a declared component is never used |
| `CONTRACT` | error | an implementation does not match its contract (missing or extra endpoint, undeclared status) |
| `SHADOWED` | warning | inside a list, an element's name is both a field of the row and an app-level name |
| `LANGUAGE` | warning | the spec was written for an older language version |
| `OVERRIDES_PROOF` | warning | a base example or `always` check is about something this spec overrides |
| `BASE_CHANGED` | warning | the base changed a part this spec overrides (see §4c) |

Reserved names: the keywords of Elm and TypeScript (`if`, `then`, `else`, `case`, `of`, `let`,
`in`, `type`, `module`, `import`, `class`, `const`, `function`, `new`, `return`, `this`,
`true`, `false`, `null`, …), `key` (row keys), and these type names: `Model`, `Msg`,
`Screen`, `Button`, `LabeledButton`, `Pick`, `Node`, `Wire`, `Ui`, `Fmt`, `Spec`, `App`,
`Main`, `Worker`, `Maybe`, `List`, `Text`, `Int`, `Decimal`, `Bool`, `String`, `Float`,
`Just`, `Nothing`, `True`, `False`, `Tick`, `Ok`, `Err`, `Result`, `Html`, `Sub`, `Cmd`,
`Json`, `Dict`, `Set`, `Array`, `Char`, `Basics`, `Debug`, `Platform`, `Time`, `Browser`.
Domain words such as `Event`, `event`, `Task`, `update` or `view` are free to use.

## 8. What the compiler produces

For every target the harness generates, deterministically from the spec:

- the domain types (records, choices),
- `Screen` — a typed record with one field per dynamic element (`Maybe` when it has
  `visible when`, a list of row records for lists),
- `Msg` — one variant per possible user action,
- rendering, the event wiring and the test driver.

The LLM writes only the app module: `Model`, `init`, `update : Msg → Model → Model`
and `view : Model → Screen`, using the standard helpers (`Fmt`). A build is accepted when
it type-checks and passes every example.

An app that calls APIs (§4g) also gets a `Call` type (one variant per endpoint), an answer type
per endpoint (one variant per declared status, plus a failure) and one `…Answered` message per
endpoint. Its `init` and `update` return the calls to make next to the model. In the browser the
runtime sends them with `fetch` to the page's origin, or to the `api` query parameter
(`index.html?api=http://localhost:3000`).

## 9. Defaults when the spec is silent

These are part of the language. A compiler must apply them, and a spec only needs to say
something when it wants different behaviour.

1. **Text.** Comparisons are exact and case-sensitive. "Blank" means empty after trimming
   whitespace. Stored text is kept as typed, unless the spec says "trimmed".
2. **Numbers shown.** An `Int` is shown as plain digits (`-3`, `1200`). A `Decimal` is shown
   with exactly two decimals (`Fmt.fixed 2`), rounding half away from zero.
3. **Parsing input.** A number typed into a field is read with `Fmt.parseDecimal` /
   `Fmt.parseInt`. Surrounding spaces are ignored, and `,` and `.` are both accepted as the
   decimal separator. Anything else is "not a number".
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
6. **Buttons.** Without `enabled when`, a button is always enabled. Clicking a disabled
   button does nothing.
7. **Fields.** Typing only changes the field's state unless an `on type` handler says more.
   Nothing is cleared unless a sentence says "clear".
8. **Time.** In tests only `clock` ticks and `wait` move time, from `examples start at` (§3b).
   There is no randomness.
9. **Durations** shown as time use `Fmt.clock` (`m:ss`, or `h:mm:ss` from one hour up).
   **Rounding words** map to fixed helpers: "rounded" is `Fmt.roundTo` (half away from
   zero), "rounded up" is `Fmt.roundUpTo`, and "rounded down" is `Fmt.roundDownTo`. Money in
   whole cents is `Fmt.cents`. Builds never invent their own rounding or epsilon.
10. **Row keys** are internal. Any stable, unique string is fine.
11. **Impossible or ignored actions** leave the state unchanged.

## Growing the language

Intent is a language in progress. When a spec needs something the language cannot say
yet, the checker reports `NOT_YET`. That is a candidate for the next version, not a rule.
Each version below was added because a real spec needed it. Next candidates:

- fields, selects and nested lists inside list rows (inline editing, sub-items);
- `clock` in styled apps;
- several screens with navigation;
- effects the harness owns, such as HTTP and randomness with a seed;
- invariants across rows ("no table is booked twice") and over state that is not on screen;
- restyling a bundle component's elements from the app;
- type parameters and slots, so a component can render the app's own rows;
- a checker warning for templates whose hole can be empty (`"{date} · {location}"` showing ` · `);
- explicit layout sizes (`look` is still words; a closed size vocabulary could replace them).

## Changelog

- v32: `stored` state fields survive a restart (a screen keeps them in the browser, an api in a
  data file); `restart` in examples, also in random sessions, and a check that stored fields come
  back unchanged. The app hands over `data` and a `restore` for them (generated interface).

- v31: `- sentence` lines in `always`: invariants over the data, checked after every step by a
  separately compiled check; the app hands over its data (`Data`); `UNCHECKED` hint for rules that
  read like invariants; `UNGUARDED` hint when a `T or nothing` value is used without saying what
  happens when there is none (the helpdesk's drawer now says it).

- v30: `T or nothing` for a value that may be absent (was `Maybe T`, which still reads); the
  helpdesk's "0 for none" became `Int or nothing`.

- v29: control words are structure: `if <condition> { … } else if … { … } else { … }`, `answer …`
  (ends an endpoint), `stop` (ends a handler). Unreachable steps and endpoints that do not answer
  on every path are errors; prose "and stop" / "otherwise" gets a hint.

- v28: time: `Date` and `DateTime` types and literals, `@today` and `@now` in sentences,
  `examples start at …`, `wait 1d` moves the clock in tests, date helpers in Fmt (the same in
  every target), and `every 15m { … }` recurring work in apis.

- v27: traceability: checker errors point at the step's own line; `see x.body… = value` must
  be a value the field can hold; the source map covers endpoints, steps, events, layers, rules
  and examples; `INTENT_TRACE=1` makes every api answer name its spec line.

- v26: import what you use: names in a file's sentences and declarations must come from the
  file or from a spec it names itself (`import`, `uses`, `implements`, `extends`).

- v25: references in sentences are marked with `@` (`@draft`, `@Item`, `@pager.visible`), also
  inside components (was `{page}`); unknown `@names` are errors, unmarked names a hint.

- v24: blocks with braces (`screen { … }`), the canonical form; files without braces are still
  read by indentation. `intent fmt` lays a file out in braces. The compiler reads braces.

- v23: a client's layers: `before every call` in a layer, `through <layer>` under `uses` with
  params bound to state or literals (`std.http.sendKey`); `given` in a layer's examples;
  `every endpoint answers 401 Problem` in contracts; a base URL per api in the browser
  (`api.<alias>`); event streams in tests only reach a screen the provider's layers let through.

- v22: events: `event name: Type` in contracts and apis, `publish x with …` in endpoint steps,
  `see x.body…` / `see x is absent` on what a call published, `on event <alias>.<event>` in
  screens, another client's `call <alias>.<endpoint>` in a screen's examples; Server-Sent
  Events at `/events`. The checker checks `see x.body.<path>` against the answer types.

- v21: layers (`layer`, `param`, `provides`, `before every request`, `after every answer`,
  `examples with`) and `use <name> = <layer>` in api apps; `std.http.secure`, `std.http.cors`
  and `std.http.apiKey`; request and answer headers in api examples (`call … with header h =
  …`, `see x.header.h`), raw `request` steps and `is absent`.

- v20: screens call APIs through contracts: `uses <contract> as <alias>` (with `tested with
  "<provider spec>"`), `call <alias>.<endpoint> with …` in handlers, `on answer <alias>.<endpoint>`
  and `on start`. Examples run against the real provider build, settled after every step.

- v19: refined types (`type Email = Text matching /…/`, `type Age = Int from 0 to 150`) with
  generated checks for every target, checked seed data and api validation; `std.text`.
- v18: contracts: `contract`, `answers <status> [Type]`, `implements`, endpoints by name only in
  the implementation, `Problem`; checked by the checker, the TypeScript compiler (typed
  handlers) and at run time; `intent client`; `{endpoint.body.x}` in `call` arguments.
- v17: the api profile (`profile api`, `endpoint`, `call` / `see x.status|body…`), with a
  TypeScript/Node harness; the same domain bundle serves a screen and an API.
- v16: the UI vocabulary is a profile spec (`lib/profile/ui.intent`): element kinds, what they
  show, their verbs, presentations and meanings; the checker reads it (docs/design/profiles.md).
- v15: projects: `intent.project` (`registry`, `requires`), `intent install` with minimal
  version selection, `intent publish` with computed versions (names + demo behaviour).
- v14: numeric checks (`is at least|at most|above|below`) and per-row checks
  (`see every row of <list>: …`), in `always` and in examples.
- v13: refinement: `extends`, `override`, `add to … after …`, `drop`; base proofs run on the
  refining spec; overrides fingerprinted in `intent.lock` (`BASE_CHANGED`).
- v12: `empty` presentation; a select's `""` is a placeholder, never an option; template holes
  and display formats documented; `language vN` line; the lock pins the language and model;
  `SHADOWED` warning; header/toolbar grouping; a screen without a sidebar is one
  centered column; plain sections stack; table columns size themselves.
- v11: `visible when` and `look` on `use`; `as` on its own line; handler idioms (`and stop`,
  `otherwise`, `its`); reserved names listed and narrowed (domain words like `Event` are free;
  the generated message type is now `Msg`); `std.list.Pager` never shows a page past the end.
- v10: modules: `bundle`, `import`, `intent.lock`; behaviour components (`param`, `state`,
  `derive`, `screen`, `on`, `always` inside `component`; `use x = Component`); end-of-line
  comments are notes; `search` fields defined (placeholder label, fixed width).
- v9: components with a base presentation (`component X as card "…"`).
- v8: sections inside list rows (component cards); `NOT_YET` instead of hard "unsupported";
  layout defaults: spec order, button rows, sidebar footer.
- v7: no language change; the harness gained the Kit (class recipes derived from `design`).
- v6: `snapshot "…"` visual checkpoints; the look shows only what the spec names.
- v5: styling: `design`, `component`, `as <presentation>`, `look`, `progress`, choice labels,
  label + value on `progress`.
- v4: `always` invariants, `has at most/at least N rows`.
- v3: `on row with "…"` in examples, `Fmt.decimal`.
- v2: `table` seed data, `select … from list.field`, rounding vocabulary (`Fmt.roundTo`, …).
- v1: records, choices, state, screen, events, examples, §9 defaults.
