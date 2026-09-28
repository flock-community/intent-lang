// The command line (v72): a missing file or a directory is said in one line on stderr, never a stack
// trace, for every command that reads specs; `intent expand x > y` writes only the spec to stdout (its
// report goes to stderr), so y reads back; `intent fix` lists every error it leaves.
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { load } from "../compiler/load.ts";

const ROOT = new URL("..", import.meta.url).pathname;
const intent = (...args: string[]) => spawnSync(process.execPath, [join(ROOT, "compiler/cli.ts"), ...args], { cwd: ROOT, encoding: "utf8" });

for (const cmd of ["check", "fix", "expand", "fmt", "lock", "build", "review", "converge", "client", "publish", "mutate"]) {
  for (const [arg, says] of [["no/such/spec.intent", /^no\/such\/spec\.intent: no such file$/m], ["apps", /^apps: is a directory; name the \.intent files in it \(apps\/\*\.intent\)$/m]] as const) {
    const r = intent(cmd, arg);
    assert.notEqual(r.status, 0, `intent ${cmd} ${arg} exits with an error`);
    assert.match(r.stderr, says, `intent ${cmd} ${arg} says what is wrong`);
    assert.ok(!/\n\s+at |Error:|ENOENT|EISDIR/.test(r.stderr + r.stdout), `intent ${cmd} ${arg} prints no stack trace:\n${r.stderr}`);
  }
}

// `intent expand` writes the spec, and only the spec, to stdout: it checks clean when read back.
const dir = mkdtempSync(join(tmpdir(), "cli-test-"));
const e = intent("expand", "apps/14-supportdesk.intent");
assert.equal(e.status, 0);
assert.match(e.stderr, /apps\/14-supportdesk\.intent: ok/, "the check's report goes to stderr");
assert.ok(!/: ok —|FAIL/.test(e.stdout), "stdout has no report lines");
writeFileSync(join(dir, "expanded.intent"), e.stdout);
assert.deepEqual(load(join(dir, "expanded.intent"), { ignoreLock: true }).diagnostics.filter((d) => d.level === "error").map((d) => d.message), [], "the expanded spec checks clean");

// `intent fix` names every error it leaves, with its line, not just a count.
const spec = join(dir, "left.intent");
writeFileSync(spec, readFileSync(join(ROOT, "tests/fix/noaccess.intent"), "utf8"));
const f = intent("fix", spec);
assert.equal(f.status, 0);
assert.match(f.stdout, /needs you — language v\d+ makes this an error/);
assert.match(f.stdout, /1 error\(s\) left after fixing:\n  .*left\.intent:8: NO_ACCESS: /);

console.log("ok cli: a missing file or a directory is one line on stderr for every command; expand writes only the spec; fix lists what it leaves");
