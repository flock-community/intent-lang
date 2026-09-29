// Sizes (`sizes Compact | Standard`): the size the host shows the app at comes from
// `globalThis.__intentSize` (a host sets it), else `?size=` in the address, else the first size
// (runtime/ts/clock.ts hostSize). A host that changes it dispatches `intentsize` on window, and both
// targets' browser entries show the app again at once with the new size: they are generated for
// apps/29-sized.intent, bundled, and run here against a stand-in window, without an LLM.
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { build } from "esbuild";
import { hostSize } from "../runtime/ts/clock.ts";
import { load } from "../compiler/load.ts";
import { scaffold } from "../compiler/gen.ts";

const g = globalThis as any;
const SIZES = ["Compact", "Standard"];
const at = (search: string | undefined, size?: string) => {
  if (search === undefined) delete g.location;
  else g.location = { search, hash: "" };
  if (size === undefined) delete g.__intentSize;
  else g.__intentSize = size;
  return hostSize(SIZES);
};
assert.equal(at(undefined), "Compact", "no host, no address (a server, a worker): the first size");
assert.equal(at(""), "Compact", "no ?size=: the first size");
assert.equal(at("?size=standard"), "Standard", "?size= picks a size, in any case");
assert.equal(at("?size=STANDARD"), "Standard");
assert.equal(at("?size=huge"), "Compact", "an unknown size: the first");
assert.equal(at("?size=compact", "Standard"), "Standard", "the host's __intentSize wins over the address");
assert.equal(at(undefined, "compact"), "Compact", "__intentSize in any case");
assert.equal(at("?other=1&size=standard"), "Standard", "among other parameters");

// The entries: a stand-in window (an EventTarget), no timers, and the host changes the size.
const { app } = load(new URL("../apps/29-sized.intent", import.meta.url).pathname, { ignoreLock: true });
assert.ok(app?.sizes, "apps/29-sized.intent has sizes");
const dir = mkdtempSync(join(tmpdir(), "sizes-"));
const bundle = async (entry: string, out: string, stubs: Record<string, string> = {}) => {
  for (const [f, text] of Object.entries(stubs)) writeFileSync(join(dir, f), text);
  await build({ entryPoints: [join(dir, entry)], bundle: true, format: "esm", platform: "neutral", outfile: join(dir, out), logLevel: "error" });
  return import(pathToFileURL(join(dir, out)).href);
};
const intervals: unknown[] = [];
g.setInterval = (f: unknown) => intervals.push(f);
g.window = new EventTarget();
try {
  // Elm: the glue sends the clock, with the size, to the app's clockTicks port.
  scaffold(app!, "elm", dir);
  await bundle("glue.ts", "glue.mjs");
  at("?size=standard");
  assert.equal(g.intentClock().size, "Standard", "the flags carry the size from the address");
  const ticks: { size: string }[] = [];
  g.intentConnect({ ports: { clockTicks: { send: (c: { size: string }) => ticks.push(c) } } });
  at("", "Compact");
  g.window.dispatchEvent(new Event("intentsize"));
  assert.deepEqual(ticks.map((t) => t.size), ["Compact"], "Elm: `intentsize` sends the clock with the new size at once");

  // TypeScript: the page is shown again (a no-op event re-renders it), and the view reads the size.
  rmSync(dir, { recursive: true, force: true });
  scaffold(app!, "ts", dir);
  g.__seen = [];
  g.__dispatched = [];
  g.document = { createElement: () => ({}), head: { append: () => {} }, getElementById: () => ({}) };
  at("?size=standard");
  await bundle("main.ts", "main.mjs", {
    "app.ts": "export const init = () => 0; export const update = (e: unknown, m: number) => m; export const view = (m: number, clock: { size: string }) => clock.size;\n",
    "spec.ts": "export const fromWire = () => null; export const toNode = (v: unknown) => v;\n",
    // The page, as ui.ts's mount: render at the start, and again after every event.
    "ui.ts": "export const STYLE = ''; export function mount(el: unknown, p: any) { let m = p.init(); (globalThis as any).__seen.push(p.render(m)); return (w: any) => { (globalThis as any).__dispatched.push(w); m = p.step(w, m); (globalThis as any).__seen.push(p.render(m)); }; }\n",
  });
  assert.deepEqual(g.__seen, ["Standard"], "TypeScript: the first view has the size from the address");
  at("?size=standard", "Compact");
  g.window.dispatchEvent(new Event("intentsize"));
  assert.deepEqual(g.__dispatched, [{ on: "noop", target: "" }], "TypeScript: `intentsize` shows the page again");
  assert.deepEqual(g.__seen, ["Standard", "Compact"], "TypeScript: with the new size");
} finally {
  rmSync(dir, { recursive: true, force: true });
}
console.log("ok sizes: __intentSize, ?size= and the first size; `intentsize` shows both targets' apps again at the new size");
