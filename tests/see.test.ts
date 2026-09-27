// Checking an element's properties (the profile's `shows`): `see x.value = "…"`, `see x.enabled is
// disabled`, `see x.checked is checked`, `see x.label = "…"`, `see x.rows = N`
// (docs/design/profiles.md, step 2).
import assert from "node:assert/strict";
import { checkSee } from "../compiler/exec.ts";

const obs = {
  c: [
    { k: "text", n: "title", v: "Hi" },
    { k: "button", n: "go", label: "Go", enabled: false },
    { k: "checkbox", n: "done", label: "Done", checked: true },
    { k: "list", n: "rows", rows: [{ key: "1", c: [] }, { key: "2", c: [] }] },
  ],
};
const see = (target: string, check: object) => checkSee(obs, { do: "see", target, check, line: 1 } as never);

assert.equal(see("title.value", { is: "eq", value: "Hi" }), undefined, "x.value = …");
assert.match(see("title.value", { is: "eq", value: "Ho" }) ?? "", /expected `title.value`/, "x.value = … (wrong)");
assert.equal(see("go.label", { is: "eq", value: "Go" }), undefined, "x.label = …");
assert.equal(see("go.enabled", { is: "disabled" }), undefined, "x.enabled is disabled");
assert.match(see("go.enabled", { is: "enabled" }) ?? "", /expected `go.enabled` to be enabled/, "x.enabled is enabled (wrong)");
assert.equal(see("done.checked", { is: "checked" }), undefined, "x.checked is checked");
assert.match(see("done.checked", { is: "unchecked" }) ?? "", /expected `done.checked`/, "x.checked is unchecked (wrong)");
assert.equal(see("rows.rows", { is: "eq", value: "2" }), undefined, "x.rows = N");
assert.match(see("rows.rows", { is: "eq", value: "3" }) ?? "", /expected `rows.rows` = 3 rows, got 2/, "x.rows = N (wrong)");
assert.match(see("go.size", { is: "eq", value: "x" }) ?? "", /not a property/, "an unknown property");
assert.match(see("missing.value", { is: "eq", value: "x" }) ?? "", /not on the screen/, "a missing element still fails");

console.log("ok see: element properties (value, label, enabled, checked, rows)");
