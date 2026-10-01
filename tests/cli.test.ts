// The command line (v72): a missing file or a directory is said in one line on stderr, never a stack
// trace, for every command that reads specs; `intent expand x > y` writes only the spec to stdout (its
// report goes to stderr), so y reads back; `intent fix` lists every error it leaves.
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
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

// `intent check --json` writes its whole report before it exits, also into a pipe (it was cut at 512 bytes).
const j = spawnSync("sh", ["-c", `"${process.execPath}" compiler/cli.ts check --json apps/*.intent | cat`], { cwd: ROOT, encoding: "utf8" });
assert.equal(j.status, 0, j.stderr);
assert.ok(j.stdout.length > 4096, "a report long enough to have been cut");
assert.equal(JSON.parse(j.stdout).length, readdirSync(join(ROOT, "apps")).filter((f) => f.endsWith(".intent")).length, "one entry per spec, and valid JSON");

// `intent build --json`: stdout is one JSON report, the log goes to stderr. A spec with errors reports
// its diagnostics; a build whose calls all miss (llm replay over no recordings) reports its attempts.
{
  const d = mkdtempSync(join(tmpdir(), "cli-build-"));
  writeFileSync(join(d, "bad.intent"), 'app Bad {\n  "x"\n}\nlanguage 1\n\nscreen {\n  text t = @nope\n}\n');
  const b = spawnSync(process.execPath, [join(ROOT, "compiler/cli.ts"), "build", join(d, "bad.intent"), "--json", "--out", join(d, "out")], { cwd: ROOT, encoding: "utf8" });
  assert.equal(b.status, 1);
  const r = JSON.parse(b.stdout);
  assert.equal(r.ok, false);
  assert.ok(r.diagnostics.some((x: { level: string; code: string; line: number }) => x.level === "error" && x.line === 7 && x.code), `the diagnostics, with code and line: ${b.stdout}`);
  const miss = spawnSync(process.execPath, [join(ROOT, "compiler/cli.ts"), "build", "apps/22-hash.intent", "--json", "--out", join(d, "miss")], { cwd: ROOT, encoding: "utf8", env: { ...process.env, INTENT_LLM: "replay", INTENT_REPLAY: join(d, "none"), INTENT_TARGETS: "ts", INTENT_TWIN: "always", INTENT_REPAIRS: "0" } });
  assert.equal(miss.status, 1, miss.stderr);
  const m = JSON.parse(miss.stdout);
  assert.equal(m.ok, false);
  assert.deepEqual(m.targets.map((t: { target: string; ok: boolean }) => [t.target, t.ok]), [["ts", false]]);
  assert.match(m.targets[0].attempts[0].detail, /no recording for this prompt/, "the replay's miss is the attempt's detail");
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
assert.match(f.stdout, /left\.intent:4: language v69 → 1$/m, "a pre-1 language line is rewritten to `language 1`");
assert.match(f.stdout, /1 error\(s\) left after fixing:\n  .*left\.intent:8: NO_ACCESS: /);

// A changed model pin (STABILITY.md §5): \`intent check\` warns (LOCK), \`intent build\` and
// \`intent converge\` refuse before any model is called, until \`intent lock\` pins the new model.
{
  const proj = mkdtempSync(join(tmpdir(), "cli-pin-"));
  const at = (...args: string[]) => spawnSync(process.execPath, [join(ROOT, "compiler/cli.ts"), ...args], { cwd: proj, encoding: "utf8" });
  writeFileSync(join(proj, "counter.intent"), 'app Counter {\n  "A counter."\n}\nlanguage 1\n\nstate {\n  count: Int = 0\n}\n\nscreen {\n  text count\n  button up "Up"\n}\n\non click up {\n  - increase @count by 1\n}\n\nexample "counting" {\n  click up\n  see count = 1\n}\n');
  assert.equal(at("lock", "counter.intent").status, 0);
  writeFileSync(join(proj, "intent.lock"), readFileSync(join(proj, "intent.lock"), "utf8").replace(/^@model\s+\S+/m, "@model    some-older-model"));
  const c = at("check", "counter.intent");
  assert.equal(c.status, 0, "a changed model is a warning for check");
  assert.match(c.stdout, /warning LOCK: the compiler model is .*, but intent\.lock pins some-older-model/);
  for (const cmd of ["build", "converge"]) {
    const b = at(cmd, "counter.intent");
    assert.equal(b.status, 1, `intent ${cmd} refuses a changed model pin`);
    assert.match(b.stdout, /intent\.lock pins some-older-model: review the change, then run `intent lock`/);
  }
  assert.match(readFileSync(join(proj, "intent.lock"), "utf8"), /^@model\s+some-older-model$/m, "the refused build leaves the pin as it was");
  assert.equal(at("lock", "counter.intent").status, 0);
  assert.ok(!/LOCK/.test(at("check", "counter.intent").stdout), "after `intent lock` the pin is the model's again");
}

console.log("ok cli: a missing file or a directory is one line on stderr for every command; expand writes only the spec; fix lists what it leaves");
