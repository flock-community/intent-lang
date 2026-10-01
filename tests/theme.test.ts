// Themes (1.1, compiler/theme.ts, docs/design/look.md), without an LLM: a theme spec and its W3C
// tokens are read; a skin's text may hold colours only in tokens; the gallery verifier passes a skin
// that draws everything readably and tells presentations and tones apart (one the model wrote for
// intent-speclib's `default` theme), and refuses the plain renderer's bare default look.
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { applySkins, flattenTokens, parseTheme, staticProblems, verifySkin } from "../compiler/theme.ts";
import { closeBrowser } from "../compiler/browser.ts";
import { STYLE } from "../runtime/ts/ui.ts";

const dir = mkdtempSync(join(tmpdir(), "theme-test-"));
try {
  writeFileSync(join(dir, "t.tokens.json"), JSON.stringify({ color: { ink: { $type: "color", $value: "#112233" }, text: { $value: "{color.ink}" } }, space: { md: { $value: "8px" } } }));
  writeFileSync(join(dir, "night.intent"), 'theme night {\n  "Dark and quiet."\n}\nlanguage 1.1\ntokens "t.tokens.json"\n');
  const { theme, errors } = parseTheme(join(dir, "night.intent"));
  assert.deepEqual(errors, []);
  assert.deepEqual(theme!.look, ["Dark and quiet."]);
  assert.deepEqual(theme!.tokens!.flat, { "--color-ink": "#112233", "--color-text": "#112233", "--space-md": "8px" }, "tokens flattened, references resolved");
  assert.deepEqual(flattenTokens({ a: { $value: { colorSpace: "srgb", components: [0, 0, 0], hex: "#000000" } } }), { "--a": "#000000" }, "a DTCG 2025 colour object reads as its hex");
  writeFileSync(join(dir, "bad.intent"), "theme bad {\n}\n");
  assert.match(parseTheme(join(dir, "bad.intent")).errors.join(), /says its look in words/);

  assert.deepEqual(staticProblems(":root{--ink:#123}\n.button{color:var(--ink);border:1px solid var(--ink)}"), [], "colours in tokens only");
  assert.match(staticProblems(".button{color:#123}").join(), /a colour outside a token/);
  assert.match(staticProblems(".button{background:rgb(1 2 3)}").join(), /a colour outside a token/);
  assert.match(staticProblems('@import url("x.css");').join(), /nothing from outside/);

  const good = await verifySkin(dir, readFileSync(new URL("theme/default.skin.css", import.meta.url), "utf8"));
  assert.deepEqual(good, [], "a skin that passes the gallery");
  const bare = await verifySkin(dir, STYLE);
  assert.ok(bare.some((p) => /look the same/.test(p)), "the bare default look does not tell buttons apart");
  assert.ok(bare.some((p) => /colour outside a token/.test(p)), "and has colours outside tokens");
  assert.ok(bare.some((p) => /dialog must be over the page/.test(p)), "and no dialog over the page");
  // Several themes in one build: picked by ?theme=, or switched live by the host (`__intentTheme`, `intenttheme`).
  writeFileSync(join(dir, "index.html"), "<!doctype html><html><head><style>body{background:red}</style></head><body><p>x</p></body></html>");
  writeFileSync(join(dir, "light.css"), ":root{--bg:#ffffff}body{background:var(--bg)}");
  writeFileSync(join(dir, "dark.css"), ":root{--bg:#000000}body{background:var(--bg)}");
  applySkins(dir, [join(dir, "light.css"), join(dir, "dark.css")]);
  const { getBrowser } = await import("../compiler/browser.ts");
  const tab = await (await getBrowser()).newPage();
  const bg = () => tab.evaluate(() => [document.documentElement.dataset.theme, getComputedStyle(document.body).backgroundColor]);
  await tab.goto(`file://${join(dir, "index.html")}`);
  assert.deepEqual(await bg(), ["light", "rgb(255, 255, 255)"], "the first theme, and no default style");
  await tab.evaluate(() => { (globalThis as any).__intentTheme = "dark"; dispatchEvent(new Event("intenttheme")); });
  await tab.waitForFunction(() => getComputedStyle(document.body).backgroundColor === "rgb(0, 0, 0)", null, { timeout: 3000 });
  assert.deepEqual(await bg(), ["dark", "rgb(0, 0, 0)"], "the host switches it live");
  await tab.goto(`file://${join(dir, "index.html")}?theme=dark`);
  await tab.waitForFunction(() => getComputedStyle(document.body).backgroundColor === "rgb(0, 0, 0)", null, { timeout: 3000 });
  await tab.close();
} finally {
  await closeBrowser();
  rmSync(dir, { recursive: true, force: true });
}
console.log("ok theme: a theme spec and its W3C tokens; colours only in tokens; the gallery passes a good skin and refuses the bare default look; several themes in one build, switched live");
