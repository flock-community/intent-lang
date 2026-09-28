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
  - shuffle the @items the way a card player would
}
`);
assert.ok(app, diagnostics.map((d) => `${d.line}:${d.code} ${d.message}`).join("; "));
const cov = typedCoverage(app!);
const typed = (fragment: string) => cov.find((c) => c.text.includes(fragment))?.typed;
assert.equal(typed("the @items whose @done"), true, "a filtered list is typed");
assert.equal(typed("the number of @open"), true, "a count of a derived list is typed");
assert.equal(typed("add an @Item"), true, "a new record: every field and value typed");
assert.equal(typed("@count plus 1"), true, "arithmetic, and a second step, typed");
assert.equal(typed("shuffle"), false, "a sentence of judgement stays untyped (and is reported as such)");
console.log(`ok typed: ${cov.filter((c) => c.typed).length}/${cov.length} typed, judgement left untyped`);
