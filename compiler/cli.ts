// intent CLI: check | build | converge
import { readFileSync } from "node:fs";
import { basename, resolve } from "node:path";
import { formatDiagnostics } from "./parse.ts";
import { load as loadSpec, writeLock } from "./load.ts";
import { printApp } from "./print.ts";
import { buildOnce } from "./build.ts";
import type { Target } from "./gen.ts";
import { converge, reanalyse } from "./converge.ts";
import { review } from "./review.ts";
import { closeBrowser } from "./browser.ts";

const [cmd, ...rest] = process.argv.slice(2);
const flags: Record<string, string> = {};
const args: string[] = [];
for (let i = 0; i < rest.length; i++) {
  if (rest[i].startsWith("--")) flags[rest[i].slice(2)] = rest[i + 1]?.startsWith("--") || rest[i + 1] === undefined ? "true" : rest[++i];
  else args.push(rest[i]);
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
    const file = args[0];
    const { app, src } = load(file);
    if (!app) process.exit(1);
    const targets = (flags.target ?? "elm,ts").split(",") as Target[];
    const out = resolve(flags.out ?? `runs/single/${basename(file, ".intent")}`);
    const results = await Promise.all(
      targets.map((t) => buildOnce(app, basename(file), src, t, `${out}/${t}`, { styled: !!flags.styled, kit: !!flags.kit, log: (m) => console.log(`[${t}] ${m}`) })),
    );
    await closeBrowser();
    for (const r of results) console.log(`${r.target}: ${r.ok ? "OK" : "FAILED"} after ${r.attempts.length} attempt(s), ${r.examples.passed}/${r.examples.total} examples, $${r.costUsd.toFixed(2)}, ${(r.ms / 1000).toFixed(0)}s → ${r.dir}/index.html`);
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
  default:
    console.log(`usage:
  intent check <file.intent>... [--json]   syntax and consistency check
  intent lock <file.intent>...             pin the bundles these specs import (intent.lock)
  intent expand <file.intent>              print the canonical, expanded spec the compiler reads
  intent review <file.intent>              list what the spec leaves to defaults (one LLM call)
  intent build <file.intent> [--target elm,ts] [--out dir]
  intent converge <file.intent>... [--builds N] [--targets elm,ts] [--traces N] [--length N] [--out dir] [--tag name]
  intent reanalyse <file.intent>... --out <earlier run dir>   re-test existing builds`);
    process.exit(2);
}
