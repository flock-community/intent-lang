// Spec text never becomes code: every template puts spec text in a comment through `doc()` (nothing in
// it ends the comment, opens a nested one or starts a line) and in an Elm string through `elmQ` (Elm's
// escapes, not JSON's); the checker keeps paths to a closed alphabet. A hostile path, note or phrase that
// got past the checker (an AST built by hand) stays inside its comment: the generated module runs clean.
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { doc, elmQ, html } from "../compiler/targets/shared.ts";
import { load } from "../compiler/load.ts";
import { parse } from "../compiler/parse.ts";
import { genApiSpec, genClient } from "../compiler/targets/ts-service.ts";
import { genTsCalls } from "../compiler/targets/ts.ts";
import { elmLiteral, genElmCalls } from "../compiler/targets/elm.ts";

// ---------------------------------------------------------------- the escapers
for (const bad of ["*/", "-}", "{-", "\n", "\r", " ", " ", "\u0000"]) assert.ok(!doc(`a ${bad} b`).includes(bad), `doc() neutralises ${JSON.stringify(bad)}`);
assert.equal(doc("GET /tickets/{id}"), "GET /tickets/{id}", "ordinary text is kept");
assert.equal(elmQ("a\u0001b"), '"a\\u{0001}b"');
assert.equal(elmQ("\b\f"), '"\\u{0008}\\u{000C}"');
assert.equal(elmQ('\\u0001 "x"\n'), '"\\\\u0001 \\"x\\"\\n"', "a backslash in the text stays one");
assert.equal(elmLiteral({ k: "text", v: "bell\u0007" }, { k: "Text" }), '"bell\\u{0007}"', "an Elm string literal with a control character compiles");
assert.ok(html("A</title><script>", "", false).includes("A&lt;/title&gt;&lt;script&gt;"), "the page title is escaped");

// ---------------------------------------------------------------- the checker keeps paths to a closed alphabet
{
  const api = (path: string) => `app Notes {\n  "Notes."\n}\n\nprofile api\n\nrecord Note {\n  id: Int\n}\n\nstate {\n  notes: List Note = []\n}\n\nendpoint list GET "${path}" {\n  returns List Note\n  answer 200 with the @notes\n}\n\nexample "lists" {\n  call list\n  see list.status = 200\n}\n`;
  const errs = (src: string) => parse(src).diagnostics.filter((d) => d.level === "error").map((d) => `${d.line}:${d.code}`);
  assert.deepEqual(errs(api("/notes*/;globalThis.PWNED=1;/*")), ["15:SYNTAX"], "a path that would leave its comment is refused");
  assert.deepEqual(errs(api("/notes/`+x+`")), ["15:SYNTAX"]);
  assert.deepEqual(errs(api("/notes/a b")), ["15:SYNTAX"]);
  assert.deepEqual(errs(api("/v1/notes/sub-items.json_~x")), [], "every safe path character is allowed");
  const screen = (path: string) => `app Pages {\n  "Pages."\n}\n\nscreen home "${path}" {\n  text hello = "Hi"\n}\n\nexample "home" {\n  see hello = "Hi"\n}\n`;
  assert.deepEqual(errs(screen("/home`+alert(1)+`")), ["5:SYNTAX"], "a screen's path too");
}

// ---------------------------------------------------------------- hostile text past the checker stays in its comment
const HOSTILE = "*/;globalThis.PWNED=1;/* -} PWNED {-";
const dir = mkdtempSync(join(tmpdir(), "templates-"));
try {
  const runs = async (name: string, ts: string) => {
    const f = join(dir, name);
    writeFileSync(f, ts.replace(/^import .*$/gm, "").replace(/^export (type )?\{.*$/gm, "").replace(/^export declare function .*$/gm, ""));
    delete (globalThis as { PWNED?: number }).PWNED;
    await import(pathToFileURL(f).href).catch(() => undefined);
    return (globalThis as { PWNED?: number }).PWNED;
  };
  // An api: the endpoint's path, and a layer's note on what it provides.
  const api = load("apps/api/desk-api.intent", { ignoreLock: true }).app!;
  api.endpoints![0].path = "/x" + HOSTILE;
  const auth = api.layers!.find((l) => l.spec?.provides?.length)!;
  auth.spec!.provides![0].note = HOSTILE;
  const spec = genApiSpec(api);
  assert.ok(spec.includes("* /;globalThis.PWNED=1;/ *"), "the path is in its comment, escaped");
  assert.equal(await runs("api.ts", spec), undefined, "the api's spec module does not run spec text");
  // A contract's typed client.
  const contract = load("lib/support/deskApi.intent", { ignoreLock: true }).app!;
  contract.endpoints![0].path = "/x" + HOSTILE + "`+(globalThis.PWNED=2)+`${globalThis.PWNED=3}";
  const client = genClient(contract);
  assert.equal(await runs("client.ts", client), undefined, "the client's comment is not broken");
  const mod = await import(pathToFileURL(join(dir, "client.ts")).href + "?again");
  let asked = "";
  const fake = (async (url: string) => ((asked = url), { status: 200, text: async () => "null" })) as unknown as typeof fetch;
  await mod.client("http://h", fake)[contract.endpoints![0].name]({});
  assert.equal((globalThis as { PWNED?: number }).PWNED, undefined, "nor its path's template literal");
  assert.ok(asked.startsWith("http://h/x*/;globalThis.PWNED=1;/*"), `the path is sent as written: ${asked}`);
  // A screen's calls, in both targets.
  const checkout = load("apps/18-checkout.intent", { ignoreLock: true }).app!;
  checkout.clients![0].contract.endpoints![0].path = "/x" + HOSTILE;
  assert.ok(!/\/\*\*[^\n]*\*\/;globalThis/.test(genTsCalls(checkout)) && genTsCalls(checkout).includes("* /;globalThis.PWNED=1;/ *"), "TypeScript calls: the comment is not broken");
  const elm = genElmCalls(checkout);
  assert.ok(!elm.includes("-} PWNED") && elm.includes("- } PWNED"), "Elm calls: the comment is not broken");
  // Every `{-` in the Elm module is closed by its own `-}` (Elm's comments nest).
  let depth = 0;
  for (const m of elm.matchAll(/\{-|-\}/g)) depth += m[0] === "{-" ? 1 : -1;
  assert.equal(depth, 0);
} finally {
  rmSync(dir, { recursive: true, force: true });
}

console.log("ok templates: doc() and elmQ, paths in a closed alphabet, hostile spec text stays in its comment (api spec, client, calls in both targets)");
