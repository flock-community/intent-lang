// The build cache, without an LLM. What a build is keyed on: every module the harness runs (the
// import closure, so a new module is never missed), the runtime, the tools, and how deeply it was
// verified. And several processes at once: a lock per key (one holder at a time; a dead holder's lock
// is taken over) and directories that appear whole, so a reader never copies a half-written build.
import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { cacheKey, harnessFiles } from "../compiler/twin.ts";
import { withLock } from "../compiler/cachedir.ts";

const run = promisify(execFile);
const here = new URL("..", import.meta.url).pathname;

// ---------------------------------------------------------------- H4: what a build is keyed on
{
  const files = harnessFiles().map((f) => f.slice(here.length));
  for (const f of ["compiler/access.ts", "compiler/draws.ts", "compiler/drawer.ts", "compiler/refs.ts", "compiler/kit.ts", "compiler/keys.ts", "compiler/fuzz.ts", "compiler/look.ts", "compiler/browser.ts", "compiler/alphabets.ts", "compiler/homes.ts", "compiler/profile.ts", "compiler/units.ts", "compiler/cachedir.ts", "compiler/providers/anthropic.ts", "runtime/ts/access.ts", "runtime/ts/platform/std.crypto.ts", "runtime/elm/Draw.elm", "lib/std/http/apiKey.intent"])
    assert.ok(files.includes(f), `the harness digest reads ${f}`);
  const k = (o: object) => cacheKey("app X {}", "ts", o);
  assert.notEqual(k({ sessions: 24 }), k({ sessions: 4 }), "fewer sessions is another build");
  assert.notEqual(k({ length: 20 }), k({ length: 5 }), "shorter sessions too");
  assert.equal(k({}), k({ sessions: 24, length: 20 }), "the defaults are the defaults");
}

// ---------------------------------------------------------------- H5: several processes at once
const root = mkdtempSync(join(tmpdir(), "cache-"));
try {
  const child = (code: string) => run(process.execPath, ["--input-type=module", "-e", code], { cwd: here, maxBuffer: 1 << 24 });
  // Writers store whole builds under one key while readers copy it out: every copy is one build, whole.
  const cached = join(root, "cache", "k");
  const writer = (id: number) => `
    import { mkdirSync, writeFileSync } from "node:fs";
    import { putDir, withLock } from ${JSON.stringify(here + "compiler/cachedir.ts")};
    for (let round = 0; round < 6; round++) {
      const src = ${JSON.stringify(root)} + "/src-${id}-" + round;
      mkdirSync(src + "/sub", { recursive: true });
      for (let i = 0; i < 40; i++) writeFileSync(src + "/sub/f" + i + ".txt", "${id}-" + round);
      await withLock(${JSON.stringify(cached)}, () => putDir(src, ${JSON.stringify(cached)}, { "intent-build.json": JSON.stringify({ key: "${id}-" + round }) }));
    }`;
  const reader = (id: number) => `
    import { cpSync, existsSync, readdirSync, readFileSync, rmSync } from "node:fs";
    import { withLock } from ${JSON.stringify(here + "compiler/cachedir.ts")};
    const bad = [];
    for (let round = 0; round < 12; round++) {
      const out = ${JSON.stringify(root)} + "/out-${id}";
      const got = await withLock(${JSON.stringify(cached)}, () => {
        if (!existsSync(${JSON.stringify(cached)} + "/intent-build.json")) return false;
        rmSync(out, { recursive: true, force: true });
        cpSync(${JSON.stringify(cached)}, out, { recursive: true });
        return true;
      });
      if (!got) continue;
      const key = JSON.parse(readFileSync(out + "/intent-build.json", "utf8")).key;
      const files = readdirSync(out + "/sub");
      if (files.length !== 40 || files.some((f) => readFileSync(out + "/sub/" + f, "utf8") !== key)) bad.push(key + ": " + files.length);
    }
    console.log(JSON.stringify(bad));`;
  const outs = await Promise.all([...[1, 2, 3].map((i) => child(writer(i))), ...[1, 2, 3].map((i) => child(reader(i)))]);
  for (const o of outs.slice(3)) assert.deepEqual(JSON.parse(o.stdout), [], "a reader never sees a mixed or half-written build");
  assert.ok(readdirSync(join(root, "cache")).every((f) => f === "k"), `no staging or lock left behind: ${readdirSync(join(root, "cache"))}`);

  // The lock: one holder at a time, across processes.
  const log = join(root, "lock.log");
  writeFileSync(log, "");
  const holder = (id: number) => `
    import { appendFileSync } from "node:fs";
    import { withLock } from ${JSON.stringify(here + "compiler/cachedir.ts")};
    for (let i = 0; i < 4; i++) await withLock(${JSON.stringify(join(root, "locked"))}, async () => {
      appendFileSync(${JSON.stringify(log)}, "in ${id}\\n");
      await new Promise((r) => setTimeout(r, 15));
      appendFileSync(${JSON.stringify(log)}, "out ${id}\\n");
    });`;
  await Promise.all([1, 2, 3].map((i) => child(holder(i))));
  const lines = readFileSync(log, "utf8").trim().split("\n");
  assert.equal(lines.length, 24);
  for (let i = 0; i < lines.length; i += 2) assert.equal(lines[i + 1], lines[i].replace("in", "out"), `the lock is held by one process at a time: ${lines.slice(i, i + 2)}`);

  // A lock whose process is gone is taken over.
  mkdirSync(join(root, "stale"), { recursive: true });
  writeFileSync(join(root, "stale.lock"), `999999 ${(await import("node:os")).hostname()}`);
  assert.equal(await withLock(join(root, "stale"), () => "taken", 5000), "taken");
} finally {
  rmSync(root, { recursive: true, force: true });
}

console.log("ok cache: keyed on the harness's import closure, the tools and the verification depth; a lock per key and whole directories across processes");
