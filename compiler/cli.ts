#!/usr/bin/env node
// intent CLI: check | build | converge
import { readFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { basename, resolve } from "node:path";
import { formatDiagnostics } from "./parse.ts";
import { compilerPins, load as loadSpec, readCompilerLock, sha, writeLock } from "./load.ts";
import { install, publish, readProject } from "./registry.ts";
import { stepText } from "./print.ts";
import { existsSync, writeFileSync } from "node:fs";
import { printApp } from "./print.ts";
import { toBraces } from "./braces.ts";
import { fixFile } from "./fix.ts";
import { compileApp } from "./twin.ts";
import type { Target } from "./gen.ts";
import { converge, reanalyse } from "./converge.ts";
import { review } from "./review.ts";
import { closeBrowser } from "./browser.ts";
import { config, configWithSources, OPTIONS, setFlags } from "./config.ts";
import { TARGETS } from "./targets/index.ts";
import { bin } from "./tools.ts";

const [cmd, ...rest] = process.argv.slice(2);
const flags: Record<string, string> = {};
const args: string[] = [];
for (let i = 0; i < rest.length; i++) {
  if (rest[i].startsWith("--")) flags[rest[i].slice(2)] = rest[i + 1]?.startsWith("--") || rest[i + 1] === undefined ? "true" : rest[++i];
  else args.push(rest[i]);
}
// The compiler's options: flags win over the environment, which wins over intent.project.
setFlags(flags);
try {
  configWithSources();
} catch (e) {
  console.error((e as Error).message);
  process.exit(1);
}

function load(file: string) {
  const { app, diagnostics, sources } = loadSpec(resolve(file));
  const errors = diagnostics.filter((d) => d.level === "error").length;
  if (diagnostics.length) console.log(formatDiagnostics(file, sources[0].text, diagnostics, sources));
  console.log(`${file}: ${errors ? "FAIL" : "ok"} — ${errors} error(s), ${diagnostics.length - errors} warning(s)`);
  // The compiler reads the canonical, expanded form of the spec.
  return { app, src: app ? printApp(app) : "" };
}

switch (cmd) {
  case "check": {
    if (flags.json) {
      // Machine-readable diagnostics, for editors and CI.
      const out = args.map((file) => ({ file, diagnostics: loadSpec(resolve(file)).diagnostics }));
      console.log(JSON.stringify(out, null, 2));
      process.exit(out.some((f) => f.diagnostics.some((d) => d.level === "error")) ? 1 : 0);
    }
    let ok = true;
    for (const f of args) if (!load(f).app) ok = false;
    process.exit(ok ? 0 : 1);
  }
  case "install": {
    const project = readProject();
    if (!project) {
      console.log("no intent.project here: nothing to install");
      process.exit(0);
    }
    const { installed, problems } = await install(project);
    for (const d of installed) console.log(`${d.name} ${d.version}  → ${d.file}`);
    for (const p of problems) console.log(`problem: ${p}`);
    // Pin the versions first, so the specs can be loaded against them for the override fingerprints.
    writeLock([], installed);
    writeLock(args.map((f) => resolve(f)), installed);
    process.exit(problems.length ? 1 : 0);
  }
  case "publish": {
    // The version is computed from the bundle's names and its demo's examples, never chosen.
    const file = resolve(args[0]);
    // A bundle is proven by its demo app; a published app or contract is its own proof.
    const isApp = /^(app|contract)\s/m.test(readFileSync(file, "utf8").split("\n").find((l) => l.trim() && !l.trim().startsWith("#")) ?? "");
    const demo = isApp ? file : file.replace(/\.intent$/, ".demo.intent");
    if (!existsSync(demo)) {
      console.log(`publishing needs a demo app that proves the bundle: ${demo.replace(process.cwd() + "/", "")}`);
      process.exit(1);
    }
    const d = loadSpec(demo);
    if (!d.app) {
      console.log(formatDiagnostics(demo, d.sources[0].text, d.diagnostics, d.sources));
      console.log("the demo app does not pass the checker");
      process.exit(1);
    }
    const fingerprints = d.app.examples.map((ex) => sha(ex.name + "\n" + ex.steps.map(stepText).join("\n")));
    const registry = resolve(flags.registry ?? readProject()?.registry ?? "registry");
    const r = await publish(file, registry, sha, fingerprints);
    console.log(`published ${r.name} ${r.version} to ${registry}\n  ${r.why.join("\n  ")}`);
    process.exit(0);
  }
  case "client": {
    // A typed client for a contract, for consumers (another service, a web app, a test).
    const { app } = load(args[0]);
    if (!app || app.kind !== "contract") (console.log("`intent client` takes a contract"), process.exit(1));
    const { genClient } = await import("./api.ts");
    const out = resolve(flags.out ?? `${basename(args[0], ".intent")}.client.ts`);
    writeFileSync(out, genClient(app));
    console.log(`typed client for ${app.name} → ${out}`);
    process.exit(0);
  }
  case "fmt": {
    // Rewrite specs in the canonical layout: blocks with braces. `--check` only reports.
    let changed = 0;
    for (const f of args) {
      const text = readFileSync(f, "utf8");
      const out = toBraces(text).replace(/\n*$/, "\n");
      if (out === text) continue;
      changed++;
      if (flags.check) console.log(`${f}: not formatted`);
      else (writeFileSync(f, out), console.log(`formatted ${f}`));
    }
    process.exit(flags.check && changed ? 1 : 0);
  }
  case "fix": {
    // Apply the mechanical fixes the checker names: `Maybe T` → `T or nothing`, `UNMARKED`
    // (`@name`), a missing `import`, and the `language vN` line. `--check` only reports.
    let changed = 0;
    for (const f of args) {
      const { out, fixes, left } = fixFile(resolve(f));
      if (!fixes.length) {
        console.log(`${f}: nothing to fix`);
        continue;
      }
      changed++;
      for (const x of fixes) console.log(`${f}:${x.line}: ${x.what}`);
      if (flags.check) continue;
      writeFileSync(f, out);
      const errors = left.filter((d) => d.level === "error").length;
      if (errors) console.log(`${f}: ${errors} error(s) still need your attention`);
    }
    process.exit(flags.check && changed ? 1 : 0);
  }
  case "doctor": {
    // Is this machine and project ready to build? Nothing is guessed: each line says what was found.
    const ok: boolean[] = [];
    const line = (name: string, good: boolean, detail: string) => {
      ok.push(good);
      console.log(`${good ? "ok  " : "MISS"} ${name.padEnd(9)} ${detail}`);
    };
    const major = Number(process.versions.node.split(".")[0]);
    line("node", major >= 22, `v${process.versions.node}${major >= 22 ? "" : " (22+ can run the .ts sources directly)"}`);
    const project = readProject();
    const locked = existsSync(resolve("intent.lock"));
    line("project", !!project || locked, project ? "intent.project / intent.lock found" : locked ? "intent.lock found" : "none here (run `intent lock` to start one)");
    const pins = compilerPins();
    const lock = readCompilerLock();
    line("language", !lock.language || pins.language === lock.language, lock.language && pins.language !== lock.language ? `${pins.languageVersion} (intent.lock is older: run \`intent lock\`)` : `${pins.languageVersion}`);
    line("model", !lock.model || pins.model === lock.model, lock.model && pins.model !== lock.model ? `${pins.model} (intent.lock pins ${lock.model})` : pins.model);
    for (const t of ["elm", "esbuild"]) line(t, existsSync(bin(t)), existsSync(bin(t)) ? bin(t) : "not installed (npm install)");
    const c = config();
    const found = c.llm === "claude-cli" ? spawnSync("which", ["claude"], { encoding: "utf8" }).status === 0 : true;
    line("llm", found, `${c.llm}${c.llm === "claude-cli" ? (found ? " (claude in PATH)" : " (claude not in PATH: run `claude login`, or set ANTHROPIC_API_KEY)") : ""}`);
    console.log(ok.every(Boolean) ? "\nintent looks ready." : "\nsomething above needs attention.");
    process.exit(ok.every(Boolean) ? 0 : 1);
  }
  case "lock": {
    const rows = writeLock(args.map((f) => resolve(f)));
    for (const r of rows) console.log(`locked ${r.name} sha256:${r.sha}  ${r.file}`);
    process.exit(0);
  }
  case "expand": {
    const { app, src } = load(args[0]);
    if (!app) process.exit(1);
    console.log(src);
    process.exit(0);
  }
  case "review": {
    for (const f of args) {
      if (!load(f).app) process.exit(1);
      const r = await review(f);
      console.log(`\n${r.text}\n\n(review cost $${r.costUsd.toFixed(2)})`);
    }
    process.exit(0);
  }
  case "build": {
    // Dependencies first: a project's required bundles are downloaded and pinned.
    const project = readProject();
    if (project?.requires.length) {
      const { installed, problems } = await install(project);
      if (problems.length) (console.log(problems.join("\n")), process.exit(1));
      writeLock([], installed);
      writeLock([resolve(args[0])], installed);
    }
    // Twin compilation: a verified build of this exact spec is reused; anything new is compiled
    // twice, and the build stops when the two compilers disagree (the spec is ambiguous).
    const file = args[0];
    const { app, src } = load(file);
    if (!app) process.exit(1);
    const c = config();
    // A service (an api, a layer) is built by the configured targets that can build services.
    const service = app.profile === "api" || app.kind === "layer";
    const wanted = (c.targets ?? (service ? ["ts"] : ["elm", "ts"])) as Target[];
    const targets = service ? (wanted.filter((t) => TARGETS[t].service).length ? wanted.filter((t) => TARGETS[t].service) : (["ts"] as Target[])) : wanted;
    const out = resolve(flags.out ?? `runs/single/${basename(file, ".intent")}`);
    const results = await Promise.all(
      targets.map((t) => compileApp(app, basename(file), src, t, `${out}/${t}`, { styled: !!flags.styled, kit: !!flags.kit, twin: c.twin, sessions: c.sessions, length: c.length, repairs: c.repairs, log: (m) => console.log(`[${t}] ${m}`) })),
    );
    await closeBrowser();
    for (const r of results) {
      const how = r.cached ? "from cache" : r.verified === "twin" ? "twin-verified" : r.verified === "single" ? "single build" : "";
      if (r.ambiguous) console.log(`${r.target}: STOPPED — the two compilers built different apps (${r.ambiguous.sessions} of ${r.ambiguous.of} sessions differ). The spec is ambiguous; see ${out}/ambiguity-${r.target}.md\n\n${r.ambiguous.report.split("## What the spec leaves open")[1]?.trim() ?? ""}`);
      else console.log(`${r.target}: ${r.ok ? `OK (${how})` : "FAILED"}, $${r.costUsd.toFixed(2)} → ${app.profile === "api" ? `${r.dir}/server.mjs (run: node server.mjs)` : `${r.dir}/index.html`}`);
    }
    process.exit(results.every((r) => r.ok) ? 0 : 1);
  }
  case "converge":
  case "reanalyse": {
    for (const f of args) if (!load(f).app) process.exit(1);
    const tag = flags.tag ?? "run";
    const out = resolve(flags.out ?? `runs/${new Date().toISOString().slice(0, 16).replace(/[:T]/g, "-")}-${tag}`);
    const reports = await (cmd === "converge" ? converge : reanalyse)(args, {
      builds: Number(flags.builds ?? 3),
      targets: (flags.targets ?? "elm,ts").split(",") as Target[],
      out,
      traces: Number(flags.traces ?? 40),
      length: Number(flags.length ?? 25),
      concurrency: Number(flags.concurrency ?? 8),
      tag,
      styled: !!flags.styled,
      kit: !!flags.kit,
    });
    const report = `${out}/${cmd === "converge" ? "report" : `report-${tag}`}.md`;
    console.log(readFileSync(report, "utf8").split("\n## ")[0]);
    console.log(`full report: ${report}`);
    process.exit(reports.every((r) => r.builds.every((b) => b.ok)) ? 0 : 1);
  }
  case "config": {
    // The compiler's options for this project, and where each came from.
    const { config: c, from } = configWithSources();
    for (const key of Object.keys(OPTIONS) as (keyof typeof OPTIONS)[]) {
      const v = c[key];
      const shown = Array.isArray(v) ? v.join(", ") : v === undefined ? "(per spec: elm, ts for screens; ts for services)" : String(v);
      console.log(`${key.padEnd(9)} ${shown.padEnd(24)} ${from[key]}${OPTIONS[key].env ? `  (${OPTIONS[key].env})` : ""}`);
    }
    process.exit(0);
  }
  default:
    console.log(`usage:
  intent check <file.intent>... [--json]   syntax and consistency check
  intent lock <file.intent>...             pin the bundles these specs import (intent.lock)
  intent install [<file.intent>...]        download intent.project's requirements (minimal version selection)
  intent publish <lib/x/y.intent> [--registry dir]   publish with a computed version (needs its demo app)
  intent client <contract.intent> [--out file.ts]    a typed client for a contract
  intent fmt <file.intent>... [--check]    rewrite specs in the canonical layout (braces)
  intent fix <file.intent>... [--check]    apply the mechanical fixes the checker names
  intent expand <file.intent>              print the canonical, expanded spec the compiler reads
  intent review <file.intent>              list what the spec leaves to defaults (one LLM call)
  intent build <file.intent> [--target elm,ts] [--out dir] [--styled --kit] [--twin auto|always|off]
                                           auto: reuse a verified build, else compile twice and
                                           stop when the two compilers disagree
  intent converge <file.intent>... [--builds N] [--targets elm,ts] [--traces N] [--length N] [--out dir] [--tag name]
  intent reanalyse <file.intent>... --out <earlier run dir>   re-test existing builds
  intent doctor                            is this machine ready to build?
  intent config                            the compiler's options and where each comes from

Options (a flag wins over the environment, which wins over \`compiler { … }\` in intent.project):
  --llm <provider>   --model <name>   --target elm,ts   --twin auto|always|off
  --sessions <n>     --length <n>     --repairs <n> (0: fail at the first problem)   --budget <usd>
Keys stay in the environment (the provider reads them), never in a file.`);
    process.exit(2);
}
