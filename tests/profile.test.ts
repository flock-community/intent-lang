// A profile file is a checked kind of spec (compiler/profile.ts checkProfile): the UI and API
// profiles check clean, and a duplicate kind or presentation is an error.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { checkProfile } from "../compiler/profile.ts";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const errors = (text: string) => checkProfile(text, "x").filter((d) => d.level === "error");
for (const f of ["lib/profile/ui.intent", "lib/profile/api.intent"]) assert.equal(errors(readFileSync(join(ROOT, f), "utf8")).length, 0, `${f} checks clean`);

const bad = `profile demo {
  "a demo profile"
}

element button "a button" {
  verb click "the user clicks it"
  presentation big "large"
  presentation big "large again"
}

element button "another button" {
}
`;
const e = errors(bad);
assert.ok(e.some((d) => d.message.includes("element kind `button` is declared twice")), "a duplicate kind is an error");
assert.ok(e.some((d) => d.message.includes("presentation `big` is declared twice")), "a duplicate presentation is an error");
assert.equal(errors("nonsense line\n").length, 1, "a line that is not a profile line is an error");
assert.equal(errors('element a "x"\n').length, 1, "a profile needs a name");

console.log("ok profile: ui and api check clean; duplicates and bad lines are errors");
