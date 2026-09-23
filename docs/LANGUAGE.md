# Intent — language reference (v15, app profile)

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

- One app per `.intent` file. UTF‑8. Indentation is 2 spaces per level; tabs are an error.
- `#` starts a comment (outside strings). Blank lines are ignored.
- Names: element, field and state names are `lowerCamel`; app, record and choice names and
  choice values are `UpperCamel`.
- Strings: `"…"` with `\"` and `\\` escapes. Inside a template string `{…}` is a hole.
- Numbers: `12`, `-3`, `2.50`. Durations: `1s`, `250ms`, `2m`.

## 3. Blocks

A file is a sequence of top-level blocks, in any order:

```
app Name                    # first line of an app; indented lines = purpose (strings)
bundle std.name             # first line of a library file instead (§4b)
import std.list             # reuse a bundle (§4b)
extends support.helpdesk    # refine a published app (§4c): override, add to, drop
record Name                 # a data shape; indented `field: Type [= default]`
choice Name: A | B "Bee" | C  # a closed set of values; an optional "label" is what users see
design                      # optional: how the app looks (§4a)
component Name "look"       # optional: a reusable look for sections/elements (§4a)
state                       # what the app remembers; indented `field: Type = default`
clock every 1s              # optional: the app receives a tick every interval
derive                      # named values computed from state: `name = sentence`
screen                      # what the user sees, top to bottom (§4)
on <verb> <element>         # what happens (§5); indented `- sentence` lines
rules                       # invariants in words; indented `- sentence` lines
always                      # invariants the harness checks after every action; indented `see` steps
example "name"              # proof (§6); indented steps
```

Types: `Text`, `Int`, `Decimal`, `Bool`, `List T`, `Maybe T`, a record name, a choice name.
Every `state` field needs a default. Literals: `"text"`, numbers, `true`/`false`, `[]`,
`nothing`, choice values.

Seed data for a `List <Record>` is written as a table. Columns are record fields; omitted
fields take the record's defaults:

```
state
  products: List Product = table
    name      | price | stock
    "Apple"   | 0.40  | 10
    "Bread"   | 2.35  | 3
```

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

Modifiers, indented under an element:

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
`= …` sentence), put it on an indented line of its own instead:

```
text places = "Full" when its signups reach its capacity, otherwise "{n} places left"
  as badge
```

## 4a. Look: design, components, presentations

```
design
  look "A calm SaaS admin: light neutral page, white surfaces with a thin border …"
  brand: indigo          # colour roles → Tailwind palettes: brand, neutral, accent,
  neutral: slate         #   success, warning, danger, info
  danger: rose
  font: sans             # sans | serif | mono
  radius: large          # none | small | medium | large | xl | full
  density: comfortable   # compact | comfortable | spacious

component StatCard as card "A small uppercase muted label above a large number."

section openStat as StatCard
  text openLabel = "Open"
  text openValue = the number of Open tickets
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

All imported names share one namespace; a name declared twice is an error. A bundle's
`design` becomes the app's design; the app's own `design` lines override it.

**Behaviour components** have parameters and their own state, derived values, screen,
events, rules and `always` checks:

```
component Pager as footer "The page info on the left; previous and next on the right."
  param items "the list to show one page at a time"   # required
  param size = 5                                      # with a default
  state
    page: Int = 1
  derive
    pageCount = the number of {items} divided by {size}, rounded up, but at least 1
    visible = the {items} on page {page}, {size} per page
  screen
    text pageInfo = "Page {page} of {pageCount}"
    button next "Next" as secondary
      enabled when {page} is below {pageCount}
  on click next
    - increase {page} by 1
```

Inside a component, write its own names and its params in braces (`{page}`, `{items}`), so
that every use gets its own copy. The checker warns (`UNSCOPED`) when you don't.

An app places a component with `use`, and binds its params in indented lines:

```
screen
  list shown of Ticket = {pager.visible} as table
    text subject
  use pager = Pager
    items = sorted
    size = 5

on type search
  - set {pager.page} to 1

example "paging"
  click pager.next
  see pager.pageInfo = "Page 2 of 2"
```

Everything in the component is then called `<use name>.<name>`: `pager.next`, `pager.page`,
`pager.visible`. The app can read and set these names in its own sentences, handlers and
examples (`set {toast.message} to "Saved"`). Braces mark a name as a reference; they are
required inside components, and recommended in app sentences. A binding value
(`items = sorted`) is a name or a literal, without braces.

A `use` can also take `visible when …` and `look "…"`, like any element:

```
  use pager = Pager
    items = sorted
    visible when sorted is not empty
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
app SupportDesk
  "Our support desk: the standard helpdesk, tuned to how we triage."

extends support.helpdesk

override text pageTitle = the label of page: "Queue", "Reports" or "Settings" as title

override state
  sort: Sort = ByPriority          # we triage by priority first

add to header after pageTitle
  text slaNote = "Urgent tickets are answered within the hour." as caption

drop example "paging"              # pages follow priority order now

example "paging in priority order"
  click pager.next
  see ticketId on row 1 = "#7"
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
requires
  support.helpdesk 1.0
  std.list 1.2
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

## 5. Events

```
on click add            # button
on click remove         # button inside a list: "that <item>" is the row's item
on toggle done          # checkbox (in addition to the built-in flip)
on type draft           # field (in addition to the built-in assignment)
on choose filter        # select (in addition to the built-in assignment)
on tick                 # requires `clock`
```

Each indented `- sentence` is one step, applied in order. Refer to declared names exactly.
Sentences may be conditional ("if draft is blank, do nothing").

Idioms the compiler reads the same way every time:

- **Stop early:** `- if quantity is not a whole number above 0, set {toast.message} to "…" and stop`.
  "and stop" skips the remaining steps. Without it, the next steps still run.
- **Otherwise:** an `otherwise …` step applies only when the step before it did not.
- **The row's item:** in a handler for a button inside a list, "that <item>" (e.g. "that
  ticket") is the item of the clicked row. In an expression inside a row, "its" and "this
  <item>" refer to the row's item: `text left = its capacity minus its number of sign-ups`.
- **Adding a record:** `- add a Ticket to the end of tickets with subject = {draft}, trimmed,
  and status Open`. New ids: `id = the highest id in tickets + 1` (1 when there are none).
- **Messages in handlers** refer to the clicked row's fields by name: `set {toast.message} to
  "Cancelled {guest} at {time}"` inside `on click cancel` of a row.
- **Named intermediate values:** give a value a name in `derive` and use that name (for
  example `quantity = amount read as a whole number`), instead of repeating the phrase.

## 6. Examples

An example starts from the initial state and runs steps in order. Steps (closed set):

```
type "Milk" into draft
click add
click remove on row 2 [of visible]
toggle done on row 1 [of visible]
choose Done in filter
choose "Ann" in payer       # select … from: options are texts
wait 3s                     # = 3 ticks with `clock every 1s`
tick 5 times
see count = "2"             # text/field value; numbers and choice values are allowed: see count = 2
see title on row 1 [of visible] = "Milk"
click remove on row with "Milk"   # the first row showing that exact text
see visible has 2 rows
see add is disabled         # also: enabled, hidden, shown, checked, unchecked
snapshot "dialog open"      # a visual checkpoint: every build must look the same here
```

`always` holds `see` checks that must be true after every action, in every session, not
only in the examples. A check on an element that is not on the screen is skipped. For
counting rows, `has at most N rows` and `has at least N rows` are allowed too:

```
always
  see doing has at most 3 rows
```

The harness checks `always` rules in examples, in its own exploration of each build, and in
the differential sessions. `see x has N rows` (exactly N) works too.

Numbers and rows:

```
always
  see lowCount is at least 0                                 # the number an element shows
  see every row of cart: qty is at least 1                   # checked on each row
  see every row of events: confirmed is at most capacity     # against another element of the same row
  see every row of shown: status = "Open"                    # also: is shown / hidden / …
```

The number is read from what the element shows ("10 left" → 10, "× 2" → 2, a progress bar's
value). Comparisons: `at least`, `at most`, `above`, `below`, against a number or another
element in the same row (or on the screen). These also work as example steps.

An invariant across rows ("no table is booked twice") cannot be an `always` check yet. Until
it can: derive a count of the violations, show it in an alert that is only visible when the
count is above 0, and write `always see <alert> is hidden`.

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
| `UNSCOPED` | warning | inside a component, one of its own names is not written in braces |
| `UNUSED` | warning | a declared component is never used |
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
8. **Time.** Only `clock` ticks move time. There is no wall clock and no randomness.
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
- several screens with navigation, and state that survives a reload;
- effects the harness owns, such as HTTP and randomness with a seed;
- invariants across rows ("no table is booked twice") and over state that is not on screen;
- restyling a bundle component's elements from the app;
- type parameters and slots, so a component can render the app's own rows;
- a checker warning for templates whose hole can be empty (`"{date} · {location}"` showing ` · `);
- explicit layout sizes (`look` is still words; a closed size vocabulary could replace them).

## Changelog

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
