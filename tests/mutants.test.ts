// The checker on broken specs (v72): mutants of every spec in apps/ and lib/ (lines deleted, copied,
// moved, words swapped or dropped, numbers changed, braces lost), from a fixed seed. Whatever the
// input, the checker answers with diagnostics: it never throws, never says one thing twice (the
// duplicate check of tests/checker/run.ts, on inputs nobody wrote), never shows `undefined` in a
// message, and points at a line that exists. Bounded: a few mutants per spec, a time limit per load.
import assert from "node:assert/strict";
import { mkdtempSync, readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { load } from "../compiler/load.ts";

const PER_SPEC = Number(process.env.MUTANTS ?? 4);
let seed = Number(process.env.SEED ?? 72) >>> 0 || 1;
const rnd = () => ((seed = (seed * 1664525 + 1013904223) >>> 0), seed / 2 ** 32);
const ri = (n: number) => Math.floor(rnd() * n);
const pick = <T>(a: T[]): T => a[ri(a.length)];
const KW = ["app", "record", "choice", "state", "derive", "screen", "on", "click", "example", "always", "endpoint", "returns", "answer", "stop", "if", "else", "set", "add", "remove", "see", "type", "into", "list", "text", "button", "field", "select", "import", "use", "uses", "extends", "override", "drop", "language", "profile", "api", "contract", "bundle", "layer", "event", "stored", "key", "ref", "or", "nothing", "List", "Text", "Int", "Decimal", "Bool", "Date", "true", "random", "steer", "access", "call", "every", "{", "}", "=", ":", "|", "@", '""', "0", "-1", "row", "visible", "when", "component", "as", "of", "whose", "that", "its"];
const tokens = (s: string) => s.split(/(\s+|[{}()":@,|=])/).filter((t) => t !== undefined && t !== "");

function mutate(src: string, words: string[]): string {
  let lines = src.split("\n");
  for (let k = 0, n = 1 + (rnd() < 0.3 ? ri(3) : 0); k < n; k++) {
    const i = ri(lines.length), j = ri(lines.length);
    switch (ri(11)) {
      case 0: lines.splice(i, 1); break;
      case 1: lines.splice(i, 0, lines[i]); break;
      case 2: [lines[i], lines[j]] = [lines[j], lines[i]]; break;
      case 3: lines.splice(i, 0, lines[j]); break;
      case 4: { const blk = lines.splice(i, 1 + ri(6)); lines.splice(ri(lines.length + 1), 0, ...blk); break; }
      case 5: case 6: {
        const ts = tokens(lines[i]);
        const w = ts.map((t, n) => (/\S/.test(t) ? n : -1)).filter((n) => n >= 0);
        if (w.length) (ts[pick(w)] = rnd() < 0.5 ? pick(words) : pick(KW)), (lines[i] = ts.join(""));
        break;
      }
      case 7: { const ts = tokens(lines[i]); ts.splice(ri(ts.length), 1); lines[i] = ts.join(""); break; }
      case 8: lines[i] = lines[i].replace(/\d+(\.\d+)?/, () => pick(["0", "-1", "99999999999999999999", "0.0000001", "2147483648"])); break;
      case 9: lines[i] = rnd() < 0.5 ? lines[i].replace(/[{}](?!.*[{}])/, "") : lines[i] + pick([" {", " }"]); break;
      case 10: lines = src.slice(0, ri(src.length)).split("\n"); break;
    }
  }
  return lines.join("\n");
}

const specs: string[] = [];
const walk = (d: string) => { for (const f of readdirSync(d).sort()) { const p = join(d, f); if (statSync(p).isDirectory()) walk(p); else if (p.endsWith(".intent") && !p.includes("/profile/")) specs.push(p); } };
walk(new URL("../apps", import.meta.url).pathname);
walk(new URL("../lib", import.meta.url).pathname);
const dir = mkdtempSync(join(tmpdir(), "mutants-"));
const problems: string[] = [];
let loads = 0, slowest = 0, slowestAt = "";
const t0 = performance.now();

function inspect(file: string, text: string, what: string) {
  const t = performance.now();
  let r: ReturnType<typeof load>;
  try {
    r = load(file, { ignoreLock: true });
  } catch (e) {
    problems.push(`${what}: the checker threw: ${(e as Error).message} (${file})`);
    return;
  }
  const ms = performance.now() - t;
  if (ms > slowest) (slowest = ms), (slowestAt = `${what} (${file})`);
  loads++;
  const seen = new Set<string>();
  for (const d of r.diagnostics) {
    const k = `${d.file ?? ""}:${d.line}:${d.code}:${d.message}`;
    if (seen.has(k)) problems.push(`${what}: said twice: ${d.file ?? ""}:${d.line} ${d.code}: ${d.message} (${file})`);
    seen.add(k);
    const words = d.message.match(/\bundefined\b|\[object Object\]|\bNaN\b/g) ?? [];
    for (const w of words) if (!text.includes(w)) problems.push(`${what}: \`${w}\` in a message: ${d.code}: ${d.message} (${file})`);
    const src = r.sources.find((s) => s.file === d.file) ?? r.sources[0];
    const n = src.text.split("\n").length;
    if (!Number.isInteger(d.line) || d.line < 1 || d.line > n) problems.push(`${what}: line ${d.line} is not in ${src.file} (${n} lines): ${d.code}: ${d.message}`);
  }
}

for (const spec of specs) {
  const src = readFileSync(spec, "utf8");
  const words = [...new Set(src.match(/@?[A-Za-z]\w*/g) ?? [])];
  const name = spec.replace(/.*\/(apps|lib)\//, "$1/");
  inspect(spec, src, name);
  for (let i = 0; i < PER_SPEC; i++) {
    const text = mutate(src, words);
    const file = join(dir, `${name.replace(/\//g, "__").replace(/\.intent$/, "")}.m${i}.intent`);
    writeFileSync(file, text);
    inspect(file, text, `${name} mutant ${i}`);
  }
}
const total = (performance.now() - t0) / 1000;
assert.deepEqual(problems.slice(0, 20), [], `${problems.length} problems in ${loads} loads`);
assert.ok(slowest < 5000, `the slowest load took ${Math.round(slowest)} ms: ${slowestAt}`);
console.log(`ok mutants: ${loads} loads (${specs.length} specs, ${PER_SPEC} mutants each, seed ${process.env.SEED ?? 72}) in ${total.toFixed(1)} s, slowest ${Math.round(slowest)} ms: no throw, nothing said twice, no undefined, every line exists`);
