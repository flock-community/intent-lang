// Who wrote a rule (`rules by ai { … }`): kept per rule, printed back in its own block, and in the
// source map, so an LLM revising a spec knows which rules are its own and which are the person's.
import assert from "node:assert/strict";
import { parse } from "../compiler/parse.ts";
import { printApp } from "../compiler/print.ts";
import { sourceMap } from "../compiler/load.ts";

const src = `app Rules {
  "Rules from a person and from an LLM."
}

state {
  count: Int = 0
}

screen {
  text count
  button up "+"
}

rules {
  - @count is shown large
}

rules by ai {
  - @count is shown in the brand colour
}

on click up {
  - increase @count by 1
}
`;
const { app, diagnostics } = parse(src);
assert.ok(app, diagnostics.map((d) => d.message).join("; "));
assert.deepEqual(app!.ruleBy, ["human", "ai"], "each rule keeps who wrote it");
const printed = printApp(app!);
assert.match(printed, /^rules {\n  - @count is shown large\n}$/m, "a person's rules print as `rules`");
assert.match(printed, /^rules by ai {\n  - @count is shown in the brand colour\n}$/m, "an LLM's as `rules by ai`");
assert.deepEqual(parse(printed).app?.ruleBy, ["human", "ai"], "and read back the same");
const map = sourceMap(app!);
assert.equal(map["rule 2"].origin, "ai", "the source map says a rule is the LLM's");
assert.equal(map["rule 1"].origin, undefined);
assert.ok(parse(src.replace("rules by ai", "rules by bot")).diagnostics.some((d) => d.code === "SYNTAX"), "only `by ai` or `by human`");

console.log("ok rules: who wrote each rule is kept, printed and in the source map");
