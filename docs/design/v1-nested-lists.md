# Design: lists inside list rows

Status: proposed for v1. Today a `list` inside a list row is `NOT_YET` (`compiler/parse.ts`, "a
list inside a list row is not in the language yet"), a list in a seed table cell is `NOT_YET`, the
`data-el` contract says "rows are never nested" (`compiler/look.ts` rule 8), and a row is named by
one `on row N`. Real apps need sub-items: a task's checklist, an order's lines, a recipe's
ingredients, an invoice's line items, a ticket's tags. This design lets a record hold a list of
records and a screen show it as a list inside the row, with editing, adding, removing and choosing
inside the inner list.

## What experts and mature systems do

| Source | What it does | What we take |
|---|---|---|
| **DDD aggregates** (Evans, *Domain-Driven Design*, 2003) | An aggregate root owns its parts (order → lines); parts are reached through the root and live and die with it. | A nested list is for **owned** parts. Things that live on their own (tickets and comments) keep being two lists and a `ref`. |
| **Datomic** `:db/isComponent` | A component attribute's entities belong to their parent: retracting the parent retracts them; pull returns them nested. | Removing a row removes its inner rows; there is no cascade question because they are in the row. |
| **Codd's 1NF / Redux "Normalizing State Shape"** | Relational and Redux advice: flatten nested collections into their own tables keyed by parent, to avoid update anomalies and deep updates. | We **depart**: the spec shows the shape users think in; the harness owns the deep update (see Elm below), so the anomalies normalisation protects against do not arise in handlers. Shared or independently living data still goes into its own list with a `ref`. |
| **Elm** (Elm guide; Feldman, *Scaling Elm Apps*, 2017) | Nested updates are written as `List.map (\t -> if t.id == id then { t \| items = … } else t)`; messages carry the ids of every level (`ToggleItem taskId itemId`). | The harness generates the message with a key per level and the helper that updates one inner item, so the LLM never writes the nested map. |
| **React** (docs, "Rendering Lists") | `key` must be stable and unique **among siblings**, not globally; nested lists have their own keys. | An inner row's key is unique within its parent; the full key is the path of keys. |
| **MongoDB** arrays of subdocuments, **JSON Pointer** (RFC 6901) | `orders.$[o].lines.$[l]` and `/orders/0/lines/2` address a nested item by one index or filter per level. | An example names a nested row by one `on row …` per level. |
| **Playwright** locators, **Testing Library** `within` | Tests scope a query to a container and chain: `getByRole('listitem').filter({ hasText: 'Groceries' }).getByRole('listitem').nth(1)`. | Row addressing chains: innermost first, each level by position or by what it shows. |
| **WAI-ARIA** (HTML nested `ul/li`, APG *Tree View* and *Treegrid* patterns, `aria-level`, `aria-setsize`, `aria-posinset`) | A list nested in a list item is a native, accessible structure; a table whose rows expand into child rows is a treegrid with levels. A table nested in a table cell is discouraged. | Default rendering is a nested list inside the row; inside a `table` row it sits in its own cell. `table` inside `table` stays `NOT_YET`; a treegrid (expand/collapse) is a later presentation. |

## The language

### Data

A record field may be `List R` of another record (it already parses: api bodies use it):

```
record Item {
  id: Int
  label: Text
  done: Bool = false
}

record Task {
  id: Int
  title: Text
  items: List Item = []
  newItem: Text = ""          # the text typed into this task's "add item" field
}
```

- One level: an inner record may not itself hold a list of records (`NOT_YET`, see open questions).
  A list of plain values (`tags: List Text`) is allowed at the inner level too.
- An inner record's key (`id`, or the field marked `key`) is unique **within its parent row**. The
  harness checks it after every step, like a primary key (see below).

**Seed data.** A table cell holds a list of records, written with the literal the language already
has for call arguments (`[{ … }, …]`):

```
state {
  stored tasks: List Task = table {
    id | title        | items
    1  | "Groceries"  | [{ id = 1, label = "Milk" }, { id = 2, label = "Eggs", done = true }]
    2  | "Taxes"      | []
  }
}
```

The checker matches each record's fields with the inner record (omitted fields take their
defaults), as it does for call arguments. One spelling: no second table syntax for children.

### Screen

Inside a list row, `list x of R` without `=` shows the row item's field `x` (as `text x` shows the
row's field `x`). With `= expr`, the inner list shows that value, computed per row ("its @items whose
…"). Its block holds the inner row's elements:

```
screen {
  list tasks of Task as cards {
    text title
    list items of Item {
      checkbox done
      text label
      button removeItem "Remove" as icon
    }
    field newItem "New item"
    button addItem "Add"
    text left = "{the number of its @items whose @done is false} left"
  }
}
```

Scopes and names:

- An inner row's elements are a scope inside the outer row's scope. A name may not be declared in
  both (`DUPLICATE`), so `on click removeItem` names one element and handlers stay unqualified.
- `data-el` is the element's spec name, as for any row element (`data-el="removeItem"`); the row
  it belongs to is its nearest `data-row`. The source map's key for a nested element is its list
  path, `tasks.items.removeItem`, so pointing at a checkbox in the running app leads to that line.

### Handlers: the rows in context

In a handler of an element in an inner row, **two rows are introduced**: the inner row by its
record ("that item") and the outer row by its record ("that task"). `its` means the innermost row.
Both satisfy `NO_ROW`.

```
on click removeItem {
  - remove that item from that task's @items
}

on click addItem {
  if that task's @newItem, trimmed, is blank {
    stop
  }
  - add an @Item to the end of that task's @items with @id = the highest @id in that task's @items + 1, @label = that task's @newItem, trimmed
  - clear that task's @newItem
}

on toggle done {
  if every @done in that task's @items is true {
    - set @toast.message to "{that task's @title} is complete"
  }
}
```

An order with lines, where the selection is an inner row (it holds both keys, because inner keys
are unique only within their order):

```
record Line {
  id: Int
  product: Text
  qty: Int
  price: Decimal
}

record Order {
  id: Int
  customer: Text
  lines: List Line = []
}

state {
  stored orders: List Order = …
  chosenOrder: Int or nothing = nothing
  chosenLine: Int or nothing = nothing
}

screen {
  list orders of Order as cards {
    text customer
    text total = "€ {the sum of @qty times @price over its @lines as money}"
    list lines of Line as menu {
      text product
      text qty
      button pick "Edit"
    }
  }
  section editor as drawer {
    visible when there is a @chosenLine
    button more "+1"
  }
}

on click pick {
  - set @chosenOrder to the @id of that order
  - set @chosenLine to the @id of that line
}
```

A read-only nesting from an api (the contract's `Recipe` has `ingredients: List Ingredient`):

```
list recipes of Recipe {
  text name
  list ingredients of Ingredient {
    text amount = "{qty} {unit}"
    text what
  }
}
```

### Sentences over nested data

- `that task's @items`, `its @items`: the inner list of that row (a list, typed).
- A chain through two lists **flattens**: `@orders's @lines` is every line of every order, in
  order (Alloy's join and SQL's join are flat too). So `the sum of @qty over @orders's @lines` is a
  number, and `the number of @tasks's @items whose @done is false` is an Int. Today the typer would
  give `List (List Line)`; it gives `List Line`.
- `add … to (the end of) that task's @items`, `remove that item from that task's @items`, `set
  that item's @done to …`, `clear that task's @newItem` are checked like their top-level forms,
  with the row's field as the list.

## The checker

| Rule | Code |
|---|---|
| `list x of R` in a row without `=`: the row's record has a field `x: List R` | `BAD_BINDING` |
| `list x of R = expr` in a row: `expr` is a list of `R` | `TYPE` |
| a list inside an inner row (a third level) | `NOT_YET` |
| a record field `List R` where `R` itself has a `List` of records | `NOT_YET` |
| a name in an inner row that is also in its outer row | `DUPLICATE` |
| "that item" in a handler with no inner row clicked; "that task" in a handler of a top-level element | `NO_ROW` |
| a seeded cell's list: each `{ … }` has only fields of the inner record, with values that fit | `UNKNOWN_NAME`, `TYPE` |
| a seeded cell's list repeats an inner key within one row | `DUPLICATE` |
| an example step's `on row …` count differs from the element's depth; `of` names a list the element is not in | `STEP` |
| a `select … from items.name` inside an inner row: `items` is state or a field of the outer row | `UNKNOWN_NAME` |

No new codes: the existing ones cover every case, with messages that name both levels
(`removeItem is inside list items, inside list tasks: say which rows: \`… on row 1 on row 1\``).

`SHADOWED` extends: an inner row's element named like a field of the inner record *and* of the
outer record hints which one it shows (the inner one).

## The harness

- **Types.** The generated `Screen` has a row record per list; an inner list is a field of the
  outer row record (`items : List TasksItemsRow`). The Node tree already nests (`list` rows hold
  `Node[]`), so `runtime/ts/ui.ts` renders an inner list inside the row with no new node kind.
- **Messages and keys.** Every inner-row event carries the outer and inner key. Wire:
  `{ on: "click", target: "tasks.items.removeItem", key: "2", keys: ["1", "2"] }` (`keys` is the
  path, outer first; `key` stays the innermost for code that reads one). Elm:
  `ClickedTasksItemsRemoveItem String String`. §9.10 extends: an inner row's key is the inner
  record's key, else its place in the parent's list; the full key is the path.
- **Updates the harness owns.** For each nested list the harness generates the update of one inner
  item (`Rows.updateIn : (Task -> Bool) -> (Item -> Bool) -> (Item -> Item) -> List Task -> List
  Task` and the TS equivalent), so typing into a field or choosing in a select inside an inner row
  (§9.7: it edits that inner item's field) needs no generated judgement, and the LLM uses the same
  helper for "set that item's @done …".
- **Keys stay unique.** After every step the harness checks that inner keys are unique within each
  parent (a key collision would make "that item" ambiguous), and that top-level keys of a record
  list are unique. A collision fails the build with the step that made it.
- **The DOM contract** (`compiler/look.ts` rule 8) becomes: "list: `data-el` on the list container;
  each row is one element with `data-row`. A row may hold an inner list (its own `data-el`) whose rows
  are `data-row` elements inside it; a row element belongs to its nearest `data-row`." The browser
  driver (`compiler/browser.ts`) already finds a row element by `closest("[data-row]")`; locating
  becomes a walk down the path: outer list → row N → inner list → row M. `Rects` keys become
  `tasks[1].items[2].removeItem`.
- **Rendering.** Default: a nested list in the row. Inside a `table` row, the inner list sits in
  its own cell (the "list in a table cell" candidate) as a plain stacked list. Inner presentations:
  `cards`, `menu`, `timeline`, `bars` and none; `table` inside `table` is `NOT_YET` (a nested table is
  an accessibility anti-pattern; a treegrid comes as its own presentation). An inner list renders as
  `ul` inside the row's `li`, which assistive tech reads as a nested list with its level.
- **Stored state.** A nested list is part of its stored row; migration (§3) already handles a new
  `List` field (empty) and removed inner fields.
- **`always`.** `see every row of items: …` checks every inner row of every outer row;
  `see items on row 1 has 3 rows` counts one outer row's inner list. Data sentences see nested data
  as it is (`Data` holds it).

## Example steps

One `on row …` per level, **innermost first**, each by position or by what the row shows, each
with an optional `of <list>`:

```
toggle done on row 2 on row 1                          # item 2 of task 1
click removeItem on row with "Milk" on row with "Groceries"
type "Bread" into label on row 1 of items on row 2 of tasks
type "Bread" into newItem on row 1                     # an outer-row field: one level
click addItem on row 1
see label on row 3 on row 1 = "Bread"
see items on row 1 has 3 rows                          # the inner list of task 1
see items on row 2 is hidden
see every row of items: label is not blank
```

- `on row with "…"` at the outer level matches what the outer row's own elements show, not its
  inner rows' (so "Groceries" is the task, not an item that happens to say it).
- Innermost first reads as English ("item 2 on task 1") and extends today's grammar without a new
  word: a step keeps its one-level form, and nested steps add a suffix.
- `RowRef` in `compiler/ast.ts` becomes a list (`at?: RowRef[]`, innermost first).
- Random sessions pick an outer row, then an inner row, for inner elements (`compiler/fuzz.ts`
  action templates), and add and remove inner rows as they do outer ones. Their generated reports
  print nested steps in the syntax above, so a divergence is a paste-ready example.

## Test plan

Checker tests (`tests/checker/nested.intent`):

1. The checklist app above — no errors.
2. `list items of Item` where `Task` has no `items` — `BAD_BINDING`.
3. `list items of Tag` where `items: List Item` — `TYPE`.
4. A list inside an inner row — `NOT_YET`.
5. `record Order { lines: List Line }` where `Line` has `parts: List Part` — `NOT_YET`.
6. `button remove` in both the outer and inner row — `DUPLICATE`.
7. `on click addItem { - remove that item from that task's @items }` (addItem is an outer-row button) — `NO_ROW`.
8. A seed cell `[{ id = 1, lable = "Milk" }]` — `UNKNOWN_NAME`; `[{ id = "x" }]` — `TYPE`; two `id = 1` in one cell — `DUPLICATE`.
9. `toggle done on row 1` for an inner checkbox — `STEP`; `click addItem on row 1 on row 1` for an outer button — `STEP`.
10. `click removeItem on row 1 of tasks on row 1 of items` (levels swapped) — `STEP`.
11. `the sum of @qty over @orders's @lines` typed as Int (`tests/typed.test.ts`); `set @draft to @orders's @lines` — `TYPE`.
12. Remove the "a list in a cell" `NOT_YET` expectation in existing tests and the parse error at
    `compiler/parse.ts` (the depth-2 case).

Harness tests:

- `tests/harness/snapshot.ts`: the Screen and Msg types, wiring and `Rows.updateIn` for the new apps,
  both targets (`--update`, reviewed).
- `tests/checker/run.ts`'s presentation check still passes (no new presentation).
- A browser-driver test that finds `data-el` in a nested row by path, and rejects a build that
  puts inner rows outside their outer row.
- A planted bug for converge: a build that removes the item at the right index in the **wrong
  task** must be caught by the fuzzer (nested keys are the risk to measure).

Example apps to add:

- `apps/32-checklists.intent`: the tasks/items app above, with examples for adding, toggling and
  removing inner rows, a per-task "n left", and `always { see every row of items: label is not blank }`.
- `apps/33-order-lines.intent`: orders with lines, a per-order total, choosing a line into a
  drawer and changing its quantity (the two-key selection), removing an order with its lines.
- `apps/api/recipes-api.intent` + a screen that shows recipes with ingredients from its answer (a
  nested list from a contract, read-only).

## Open questions, with a recommendation

1. **How deep?** Recommend **two levels in v1**. Two cover the apps we have (order/lines,
   task/items, recipe/ingredients). A third level makes steps long and needs a tree or treegrid, and
   arbitrary depth is recursion (comment threads), which is a different feature (a record that holds
   its own type) with its own presentation (ARIA tree).
2. **Nested field or flat list with a `ref`?** Recommend the rule from DDD: **nested when the
   parts are owned** (created, shown and removed only through the parent), a `ref` when they live
   on their own or are shared. The skill (`skills/intent-spec/SKILL.md`) should teach this with
   one sentence and the two examples.
3. **Per-row drafts** (`newItem` in `Task`). A row's field edits the row item's field, so the draft
   lives in the record and, for a stored list, is stored. Recommend accepting that in v1 (typed,
   simple, one rule) and noting it as a candidate: a `row state` declaration for view-only fields
   of a row (Elm keeps such state in a `Dict id draft`).
4. **Selections across levels.** An inner key is unique only within its parent, so a selection
   needs both keys. Recommend keeping that explicit (two state fields, as in the orders example)
   rather than a new path type; a spec that wants one field gives the inner record a globally
   unique id and the `always` rule that says so.
5. **Flattening chains.** `@orders's @lines` flattens. Recommend it (it is what the English means
   and what joins do); a sentence that wants per-order values says "its @lines" in a row or loops
   with `for each`.
