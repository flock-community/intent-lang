// How much of a spec is typed whole (compiler/fit.ts `typedCoverage`, `intent check --typed`): the
// sentences with references that the typer types, and the ones left to judgement.
import assert from "node:assert/strict";
import { parse } from "../compiler/parse.ts";
import { typedCoverage } from "../compiler/fit.ts";

const { app, diagnostics } = parse(`app Typed {
  "Coverage."
}

record Item {
  id: Int
  title: Text
  done: Bool
}

state {
  items: List Item = []
  draft: Text = ""
  count: Int = 0
}

derive {
  open = the @items whose @done is false
  total = the number of @open
}

screen {
  field draft "New"
  button add "Add"
  text total
}

on click add {
  - add an @Item to the end of @items with @id = the highest @id in @items + 1 (1 when there are none), @title = @draft trimmed and @done = false
  - set @count to @count plus 1, and clear @draft
  - arrange the @items the way a card player would
}
`);
assert.ok(app, diagnostics.map((d) => `${d.line}:${d.code} ${d.message}`).join("; "));
const cov = typedCoverage(app!);
const typed = (fragment: string) => cov.find((c) => c.text.includes(fragment))?.typed;
assert.equal(typed("the @items whose @done"), true, "a filtered list is typed");
assert.equal(typed("the number of @open"), true, "a count of a derived list is typed");
assert.equal(typed("add an @Item"), true, "a new record: every field and value typed");
assert.equal(typed("@count plus 1"), true, "arithmetic, and a second step, typed");
assert.equal(typed("arrange"), false, "a sentence of judgement stays untyped (and is reported as such)");
console.log(`ok typed: ${cov.filter((c) => c.typed).length}/${cov.length} typed, judgement left untyped`);

// Lists inside rows (v68): a chain through two lists flattens (`@orders's @lines` is every line of
// every order), a row's inner list is typed where it is read, filtered and written.
const nested = parse(`app Lines {
  "Nested."
}

record Line {
  id: Int
  qty: Int
  price: Decimal
}

record Order {
  id: Int
  lines: List Line = []
  note: Text = ""
}

state {
  orders: List Order = []
  draft: Text = ""
  total: Int = 0
}

derive {
  units = the sum of @qty over @orders's @lines
  count = the number of @orders's @lines
}

screen {
  list orders of Order {
    text value = "{the sum of @qty times @price over its @lines as money}"
    list lines of Line {
      button drop "Drop"
    }
    button add "Add"
  }
  text units
}

on click add {
  - add a @Line to the end of that order's @lines with @id = the highest @id in that order's @lines + 1 (1 when there are none), @qty = 1 and @price = 2.5
  - clear that order's @note
}

on click drop {
  - remove that line from that order's @lines
  - set @total to the number of @orders's @lines
}
`);
assert.ok(nested.app, nested.diagnostics.map((d) => `${d.line}:${d.code} ${d.message}`).join("; "));
const ncov = typedCoverage(nested.app!);
const ntyped = (fragment: string) => ncov.find((c) => c.text.includes(fragment))?.typed;
assert.equal(ntyped("the sum of @qty over @orders's @lines"), true, "a sum over a flattened chain is typed (an Int)");
assert.equal(ntyped("the number of @orders's @lines"), true, "a count of a flattened chain is typed");
assert.equal(ntyped("@qty times @price over its @lines"), true, "a sum of a value per row over a row's inner list is typed");
assert.equal(ntyped("add a @Line to the end of that order's @lines"), true, "adding to a row's inner list: every field typed");
assert.equal(ntyped("remove that line from that order's @lines"), true, "removing from a row's inner list is typed");
const wrong = parse(nested.app ? `app W {\n  "w"\n}\n\nrecord Line {\n  id: Int\n}\n\nrecord Order {\n  id: Int\n  lines: List Line = []\n}\n\nstate {\n  orders: List Order = []\n  draft: Text = ""\n}\n\nscreen {\n  button go "Go"\n}\n\non click go {\n  - set @draft to @orders's @lines\n}\n` : "");
assert.ok(wrong.diagnostics.some((d) => d.code === "TYPE" && /List Line, but it is Text/.test(d.message)), `a flattened chain is a List Line, not a List (List Line): ${wrong.diagnostics.map((d) => d.message).join("; ")}`);
console.log(`ok typed (lists inside rows): ${ncov.filter((c) => c.typed).length}/${ncov.length} typed`);
