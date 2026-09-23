# Intent — language reference (v5, app profile)

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
| | `header` | a row at the top of its parent: title left, actions right |
| | `toolbar` | a row of controls, wrapping when needed |
| | `card` | a surface with border, radius, padding; tables, menus, toolbars and footers inside it run edge to edge |
| | `grid` | children in equal columns |
| | `row` | children side by side |
| | `form` | fields stacked with labels above them |
| | `footer` | a row at the bottom of its parent: info left, actions right |
| | `banner` | a full-width strip |
| | `dialog` | a modal centered over a dimmed backdrop, with its title on top |
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
examples.

**Locking.** `intent.lock` pins every bundle by content hash. A bundle that changed since it
was locked fails the check until someone reviews it and runs `intent lock <app>`. Builds never
pick up a library change silently.

**Notes.** A comment at the end of a line (`remaining: Int = 1500  # seconds left`) is a note:
the compiler reads it too. A comment on a line of its own is only for people.

`intent expand <app>` prints the app as the compiler reads it: imports resolved, components
expanded, and each line marked with where it came from.

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
the differential sessions.

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
| `RESERVED` | error | a name that clashes with target keywords or generated names |
| `STEP` | error | an example step that does not match the element (click a text, …) |
| `NOT_YET` | error | a construct the language does not have yet (see "Growing the language") |
| `NO_HANDLER` | warning | a button without `on click` |
| `UNPROVEN` | warning | a dynamic element never checked by any `see` |
| `UNANCHORED` | warning | a rule or handler sentence that mentions no declared name |
| `NO_EXAMPLES` | warning | the app has no examples |
| `LOCK` | error | a bundle is not locked, or changed since it was locked (§4b) |
| `UNSCOPED` | warning | inside a component, one of its own names is not written in braces |
| `UNUSED` | warning | a declared component is never used |

## 8. What the compiler produces

For every target the harness generates, deterministically from the spec:

- the domain types (records, choices),
- `Screen` — a typed record with one field per dynamic element (`Maybe` when it has
  `visible when`, a list of row records for lists),
- `Event` — one variant per possible user action,
- rendering, the event wiring and the test driver.

The LLM writes only the app module: `Model`, `init`, `update : Event → Model → Model`
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
   (except `search`). Layout follows the spec: elements
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
- richer `always` checks (sums, relations between elements);
- explicit layout sizes (`look` is still words; a closed size vocabulary could replace them).

## Changelog

- v1: records, choices, state, screen, events, examples, §9 defaults.
- v2: `table` seed data, `select … from list.field`, rounding vocabulary (`Fmt.roundTo`, …).
- v3: `on row with "…"` in examples, `Fmt.decimal`.
- v4: `always` invariants, `has at most/at least N rows`.
- v10: modules: `bundle`, `import`, `intent.lock`; behaviour components (`param`, `state`,
  `derive`, `screen`, `on`, `always` inside `component`; `use x = Component`); end-of-line
  comments are notes; `search` fields defined (placeholder label, fixed width).
- v9: components with a base presentation (`component X as card "…"`).
- v8: sections inside list rows (component cards); `NOT_YET` instead of hard "unsupported"; layout defaults: spec order, button rows, sidebar footer.
- v6: `snapshot "…"` visual checkpoints; the look shows only what the spec names.
- v5: styling: `design`, `component`, `as <presentation>`, `look`, `progress`, choice labels,
  label + value on `progress`.
