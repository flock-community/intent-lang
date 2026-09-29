// `intent fix`: apply the mechanical fixes a diagnostic names, so an author does not retype them.
// Deliberately narrow — an old `Maybe T` type, an unmarked declared name (`UNMARKED`), a lookup's
// other spelling (`SPELLING`), a missing `import`, and the `language 1` line. Anything that needs
// judgement is reported, never guessed.
//
// Each fix is checked before it is kept: a fix may not add any error (a code on a line that did not
// have it), even one that removes another. Fixes are tried per kind, and one by one when a kind as a
// whole would add an error; the safe ones are kept, the others are reported with the error they would
// add. The `language` line is always written unless it breaks the spec's syntax (a missing line and a
// pre-1 `language vNN` both mean `language 1`, so writing it changes no meaning; should a later edition
// add errors, they are reported as needing the author).
// Running `intent fix` twice changes nothing the second time.
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, relative, resolve } from "node:path";
import type { App, Diagnostic } from "./ast.ts";
import { PROJECT_ROOT } from "./gen.ts";
import { BASE_LANGUAGE, load, LOCK } from "./load.ts";
import { parseSyntax } from "./parse.ts";
import { sentences } from "./refs.ts";

export interface Fix {
  line: number; // in the fixed source
  code: string;
  what: string;
}
/** A fix that was not applied: the errors it would add ("line CODE message"). */
export interface Refusal extends Fix {
  why: string[];
}

/** The index just after the header (`app … { … }`, or `app …` and its indented lines in the older
 *  indentation syntax), where a `language` line goes. Comments before the header stay before it. */
function afterHeader(src: string): number {
  const lines = src.split("\n");
  const upTo = (n: number) => (n >= lines.length ? src.length + 1 : lines.slice(0, n).join("\n").length + 1);
  const first = lines.findIndex((l) => l.trim() && !l.trim().startsWith("#"));
  if (first < 0) return src.length ? src.length + 1 : 0;
  if (!lines[first].includes("{")) {
    let i = first + 1;
    while (i < lines.length && /^\s+\S/.test(lines[i])) i++;
    return upTo(i);
  }
  let depth = 0;
  for (let i = first; i < lines.length; i++) {
    if (lines[i].includes("{")) depth++;
    if (lines[i].includes("}")) depth--;
    if (depth <= 0) return upTo(i + 1);
  }
  return src.length + 1;
}

/** Is the character at `at` outside a plain string part? A template hole `{…}` counts as code. */
function outsideString(line: string, at: number): boolean {
  let inString = false;
  let inHole = false;
  for (let i = 0; i < at; i++) {
    const ch = line[i];
    if (inString && !inHole) {
      if (ch === "\\") i++;
      else if (ch === '"') inString = false;
      else if (ch === "{") inHole = true;
    } else if (inHole) {
      if (ch === "}") inHole = false;
    } else if (ch === '"') inString = true;
    else if (ch === "#") return false;
  }
  return !(inString && !inHole);
}

/** Is `at` inside a string, a template hole included? */
function inString(line: string, at: number): boolean {
  let q = false;
  for (let i = 0; i < at; i++) {
    if (q && line[i] === "\\") i++;
    else if (line[i] === '"') q = !q;
    else if (!q && line[i] === "#") return true;
  }
  return q;
}

/** The bare occurrences of `word` in `line` from `from` to `to`, outside plain strings. */
function bareAt(line: string, word: string, from = 0, to = line.length): number[] {
  const out: number[] = [];
  for (let i = from; i + word.length <= to; i++) {
    if (!line.startsWith(word, i)) continue;
    if (i > 0 && /[\w@.]/.test(line[i - 1])) continue;
    if (/[\w]/.test(line[i + word.length] ?? "")) continue;
    if (outsideString(line, i)) out.push(i);
  }
  return out;
}

/** Mark the first bare occurrence of `word` on the line (`word` → `@word`), outside plain strings. */
export function markWord(line: string, word: string): string | undefined {
  const i = bareAt(line, word)[0];
  return i === undefined ? undefined : line.slice(0, i) + "@" + line.slice(i);
}

/** Text fixes that need no diagnostics: the old `Maybe T`, and the `language 1` line. */
export function fixSource(src: string, language: string): { out: string; fixes: Fix[] } {
  const fixes: Fix[] = [];
  const lines = src.split("\n");
  for (let i = 0; i < lines.length; i++) {
    const fixed = fixMaybe(lines[i]);
    if (fixed.line !== lines[i]) (lines[i] = fixed.line), fixes.push(...fixed.whats.map((what) => ({ line: i + 1, code: "LANGUAGE", what })));
  }
  const out = lines.join("\n");
  if (!language) return { out, fixes };
  const lang = languageEdit(out, language);
  if (!lang) return { out, fixes };
  return { out: lang.out, fixes: [...fixes, { line: lang.line, code: "LANGUAGE", what: lang.what }] };
}

function fixMaybe(line: string): { line: string; whats: string[] } {
  let result = "";
  let last = 0;
  const whats: string[] = [];
  for (const m of line.matchAll(/\bMaybe\s+([A-Za-z]\w*)/g)) {
    const at = m.index!;
    if (!outsideString(line, at)) continue;
    result += line.slice(last, at) + `${m[1]} or nothing`;
    last = at + m[0].length;
    whats.push(`Maybe ${m[1]} → ${m[1]} or nothing`);
  }
  return { line: result + line.slice(last), whats };
}

/** The `language` line: a pre-1 `language vNN` is rewritten, a missing line is added after the
 *  header. A `language 1.x` line stays: it is the lowest version the spec needs. */
function languageEdit(src: string, language: string): { out: string; line: number; what: string; inserted: boolean } | undefined {
  const declared = src.match(/^language\s+(\S+)\s*$/m);
  if (declared) {
    if (!/^v\d+$/.test(declared[1]) || declared[1] === language) return undefined;
    return { out: src.replace(/^language\s+v\d+\s*$/m, `language ${language}`), line: src.slice(0, declared.index).split("\n").length, what: `language ${declared[1]} → ${language}`, inserted: false };
  }
  const at = afterHeader(src);
  const before = at > src.length ? src + "\n" : src.slice(0, at); // a header on the last line, without a newline
  return { out: before + `language ${language}\n` + src.slice(at), line: before.split("\n").length, what: `added \`language ${language}\``, inserted: true };
}

// ---------------------------------------------------------------- the source being fixed

/** The source as its original lines, with lines inserted after some of them (`language`, `import`):
 *  every diagnostic of a candidate is mapped back to the original line it is about. */
interface Text {
  lines: string[]; // the original lines, as edited so far
  inserts: Map<number, string[]>; // after original line n (0: before the first), the inserted lines
}
const clone = (t: Text): Text => ({ lines: [...t.lines], inserts: new Map([...t.inserts].map(([k, v]) => [k, [...v]])) });
function render(t: Text): { src: string; orig: (line: number) => number | undefined; now: (orig: number) => number } {
  const out: string[] = [];
  const back: (number | undefined)[] = []; // new line (1-based) → original line
  const fwd: number[] = [];
  const put = (n: number) => {
    for (const s of t.inserts.get(n) ?? []) (out.push(s), back.push(undefined));
  };
  put(0);
  t.lines.forEach((l, i) => {
    out.push(l);
    back.push(i + 1);
    fwd[i + 1] = out.length;
    put(i + 1);
  });
  return { src: out.join("\n"), orig: (line) => back[line - 1], now: (orig) => fwd[orig] ?? orig };
}

/** Check a candidate source as if it were `file` (a temp copy: bundle imports resolve by project). */
function check(src: string): { diags: Diagnostic[]; main: string; app?: App } {
  const dir = mkdtempSync(join(tmpdir(), "fix-"));
  try {
    const p = join(dir, "spec.intent");
    writeFileSync(p, src);
    const r = load(p, { ignoreLock: true });
    // The checked copy's own diagnostics carry no file (they are the file being fixed); other files' keep theirs.
    const main = r.sources[0].file;
    return { diags: r.diagnostics.map((d) => (d.file === main ? { ...d, file: undefined } : d)), main: "", app: r.read };
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

/** The errors of a candidate, keyed by (file, original line, code), as a multiset. */
function errorKeys(t: Text): { keys: Map<string, Diagnostic[]>; diags: Diagnostic[]; main: string; app?: App; now: (orig: number) => number; orig: (line: number) => number | undefined } {
  const r = render(t);
  const { diags, main, app } = check(r.src);
  const keys = new Map<string, Diagnostic[]>();
  let fresh = 0;
  for (const d of diags.filter((x) => x.level === "error")) {
    const inMain = !d.file || d.file === main;
    const o = inMain ? r.orig(d.line) : d.line;
    const k = `${inMain ? "" : d.file}:${o ?? `+${fresh++}`}:${d.code}`;
    keys.set(k, [...(keys.get(k) ?? []), d]);
  }
  return { keys, diags, main, app, now: r.now, orig: r.orig };
}
/** The errors of `after` that `before` does not have, as (file, line, code): one error removed and
 *  another added is still a new error (the lines are the same file's, before and after). */
export function newErrors(before: Diagnostic[], after: Diagnostic[]): Diagnostic[] {
  const keyed = (ds: Diagnostic[]) => {
    const m = new Map<string, Diagnostic[]>();
    for (const d of ds.filter((x) => x.level === "error")) m.set(`${d.file ?? ""}:${d.line}:${d.code}`, [...(m.get(`${d.file ?? ""}:${d.line}:${d.code}`) ?? []), d]);
    return m;
  };
  return added(keyed(before), keyed(after));
}

/** The errors in `after` that `before` does not have (counting each (file, line, code) as often as it occurs). */
function added(before: Map<string, Diagnostic[]>, after: Map<string, Diagnostic[]>): Diagnostic[] {
  const out: Diagnostic[] = [];
  for (const [k, ds] of after) out.push(...ds.slice(before.get(k)?.length ?? 0));
  return out;
}

interface Candidate {
  code: string;
  line: number; // original line
  what: string;
  apply: (t: Text) => boolean; // false: the fix no longer applies to this text
}

export interface FixResult {
  out: string;
  fixes: Fix[];
  refused: Refusal[];
  judgements: Fix[]; // what needs the author: an ambiguity, or an error the newer language adds
  left: Diagnostic[]; // every diagnostic of the fixed source (its own file's lines)
  main: string; // how the checked copy's own file is named in `left` (diagnostics of other files name theirs)
  bundle: boolean; // the file is a bundle (or is locked as one): specs that import it need `intent lock`
}

/** Apply every mechanical fix to the source of `file`, and report what is left. */
export function fixFile(file: string): FixResult {
  const src = readFileSync(file, "utf8");
  const r = fixText(src);
  const rel = relative(PROJECT_ROOT, resolve(file));
  const locked = existsSync(LOCK) && readFileSync(LOCK, "utf8").split("\n").some((l) => l.trim().endsWith(`  ${rel}`) && !l.startsWith("@"));
  return { ...r, bundle: r.bundle || locked };
}

/** `only`: keep just the candidates it accepts (a migration that applies one kind of fix). */
export function fixText(src: string, language = BASE_LANGUAGE, only?: (c: { code: string; what: string; line: string }) => boolean): FixResult {
  // A profile (`profile ui { element … }`) is the vocabulary, not a spec: nothing to fix, no `language` line.
  if (/^profile\s+[a-z]\w*\s*\{?\s*$/.test(src.split("\n").find((l) => l.trim() && !l.trim().startsWith("#")) ?? "")) return { out: src, fixes: [], refused: [], judgements: [], left: [], main: "", bundle: false };
  let text: Text = { lines: src.split("\n"), inserts: new Map() };
  let state = errorKeys(text);
  const fixes: { orig: number | "inserted"; at: number; code: string; what: string }[] = [];
  const refused: { orig: number; code: string; what: string; why: Diagnostic[] }[] = [];
  const judgements: { orig: number; code: string; what: string }[] = [];

  // 1. The language line. What the newer language adds is the author's to settle; a line in the wrong place is refused.
  const lang = only && !only({ code: "LANGUAGE", what: "language", line: "" }) ? undefined : languageEdit(src, language);
  if (lang) {
    const t = clone(text);
    if (lang.inserted) {
      const after = lang.line - 1; // original lines before it
      t.inserts.set(after, [...(t.inserts.get(after) ?? []), `language ${language}`]);
    } else t.lines[lang.line - 1] = `language ${language}`;
    const next = errorKeys(t);
    const more = added(state.keys, next.keys);
    const broken = more.filter((d) => d.code === "SYNTAX" || d.code === "LANGUAGE");
    if (broken.length) refused.push({ orig: lang.line, code: "LANGUAGE", what: lang.what, why: broken });
    else {
      text = t;
      state = next;
      fixes.push({ orig: lang.inserted ? "inserted" : lang.line, at: lang.line, code: "LANGUAGE", what: lang.what });
      for (const d of more) judgements.push({ orig: !d.file || d.file === next.main ? (next.orig(d.line) ?? 0) : 0, code: d.code, what: `language ${language} makes this an error${d.file && d.file !== next.main ? ` (${d.file}:${d.line})` : ""}: ${d.message}` });
    }
  }

  /** Keep the candidates that add no error: all at once when they can, else one by one. */
  const settle = (all0: Candidate[]): number => {
    const cands = only ? all0.filter((c) => only({ code: c.code, what: c.what, line: text.lines[c.line - 1] ?? "" })) : all0;
    if (!cands.length) return 0;
    const all = clone(text);
    const applied = cands.filter((c) => c.apply(all));
    if (applied.length === cands.length) {
      const next = errorKeys(all);
      if (!added(state.keys, next.keys).length) {
        text = all;
        state = next;
        for (const c of cands) fixes.push({ orig: c.line, at: c.line, code: c.code, what: c.what });
        return cands.length;
      }
    }
    // One by one, again while any is kept: a fix can need another first (`@current is not Solved`
    // is typed once `@Solved` is marked), and the result must not depend on the order.
    let kept = 0;
    let pending = cands;
    for (;;) {
      const still: { c: Candidate; why: Diagnostic[] }[] = [];
      let progress = false;
      for (const c of pending) {
        const t = clone(text);
        if (!c.apply(t)) {
          still.push({ c, why: [] });
          continue;
        }
        const next = errorKeys(t);
        const more = added(state.keys, next.keys);
        if (more.length) {
          still.push({ c, why: more });
          continue;
        }
        text = t;
        state = next;
        fixes.push({ orig: c.line, at: c.line, code: c.code, what: c.what });
        kept++;
        progress = true;
      }
      if (!progress || !still.length) {
        for (const { c, why } of still)
          if (why.length) refused.push({ orig: c.line, code: c.code, what: c.what, why });
          else judgements.push({ orig: c.line, code: c.code, what: `${c.what}: the line changed under another fix; do it by hand` });
        return kept;
      }
      pending = still.map((x) => x.c);
    }
  };
  // 2. `Maybe T` → `T or nothing`.
  settle(
    text.lines.flatMap((l, i) => {
      const m = fixMaybe(l);
      return m.whats.length ? [{ code: "LANGUAGE", line: i + 1, what: m.whats.join(", "), apply: applyLine(i + 1, (x) => fixMaybe(x).line) }] : [];
    }),
  );

  // 3. What the diagnostics name, until a round keeps nothing new (a fix can reveal the next: an
  //    import declares names a sentence then marks). Each round's candidates come from the current text.
  const early = { refused: refused.length, judgements: judgements.length }; // the language line's
  for (let round = 0; round < 10; round++) {
    // What is reported is the last round's: a fix refused in one round may be kept in the next.
    refused.splice(early.refused);
    judgements.splice(early.judgements);
    const mine = state.diags.filter((d) => !d.file);
    const r = render(text);
    const origOf = (line: number) => r.orig(line);
    let kept = 0;
    for (const group of [() => spellingCandidates(mine, origOf), () => rewriteCandidates(mine, origOf), () => unmarkedCandidates(mine, origOf, r.src, judgements, state.app), () => importCandidates(mine)]) kept += settle(group());
    if (!kept) break;
  }

  const final = render(text);
  const at = (orig: number) => final.now(orig);
  const dedupe = <T extends { orig: number; what: string }>(xs: T[]) => xs.filter((x, i) => xs.findIndex((y) => y.orig === x.orig && y.what === x.what) === i);
  const isBundle = /^\s*(bundle|platform|layer|contract)\s/m.test(src.split("\n").find((l) => l.trim() && !l.trim().startsWith("#")) ?? "");
  return {
    out: final.src,
    fixes: fixes.map((f) => ({ line: f.orig === "inserted" ? f.at : f.code === "IMPORT" ? final.src.split("\n").indexOf(f.what.replace(/^added `(.*)`$/, "$1")) + 1 : at(f.orig), code: f.code, what: f.what })),
    refused: dedupe(refused).map((x) => ({ line: at(x.orig), code: x.code, what: x.what, why: x.why.map((d) => `${d.file && d.file !== state.main ? `${d.file}:` : "line "}${d.line} ${d.code}: ${d.message}`) })),
    judgements: dedupe(judgements).map((j) => ({ line: at(j.orig), code: j.code, what: j.what })),
    left: state.diags,
    main: state.main,
    bundle: isBundle,
  };
}

// ---------------------------------------------------------------- the fixes the diagnostics name

/** `SPELLING`: the language's own spelling of a lookup, a change rule, a reference's row, a draw. */
function spellingCandidates(diags: Diagnostic[], origOf: (line: number) => number | undefined): Candidate[] {
  const out: Candidate[] = [];
  for (const d of diags.filter((x) => x.code === "SPELLING")) {
    const line = origOf(d.line);
    if (line === undefined) continue;
    const replace = (from: string, to: string) => (l: string) => {
      const at = l.indexOf(from);
      return at >= 0 && outsideString(l, at) ? l.slice(0, at) + to + l.slice(at + from.length) : undefined;
    };
    // A lookup of a reference's own row: the message names the lookup and its navigation.
    const nav = /^`([^`]+)` looks up the row a reference points at: follow the reference instead, `([^`]+)`/.exec(d.message);
    if (nav) {
      out.push({ code: "SPELLING", line, what: `\`${nav[1]}\` → \`${nav[2]}\``, apply: applyLine(line, replace(nav[1], nav[2])) });
      continue;
    }
    // A change rule's other spelling: `only goes up` → `never goes down`, `the previous @x` → `@x before`.
    const change = /^`([^`]+)` is written `([^`]+)` in a change rule/.exec(d.message);
    if (change) {
      out.push({ code: "SPELLING", line, what: `\`${change[1]}\` → \`${change[2]}\``, apply: applyLine(line, replace(change[1], change[2])) });
      continue;
    }
    // `@newToken`, used once in its endpoint, is a draw: `a random @Token` (std.text's Token). Used
    // twice it is one value in two places: that needs the author (draw once, refer to it after).
    if (/^`@newToken` is written `a random @Token`/.test(d.message)) {
      if (!/`intent fix` rewrites it/.test(d.message)) continue;
      const draw = replace("@newToken", "a random @Token");
      out.push({
        code: "SPELLING",
        line,
        what: "`@newToken` → `a random @Token`",
        apply: (t) => {
          if (!applyLine(line, draw)(t)) return false;
          // A draw of a Token needs the type: std.text has it (unless the spec declares its own).
          const all = render(t).src;
          if (!/^import\s+std\.text\b/m.test(all) && !/^type\s+Token\b/m.test(all)) addImport(t, "std.text");
          return true;
        },
      });
      continue;
    }
    if (/^a lookup is written/.test(d.message)) {
      out.push({ code: "SPELLING", line, what: "a lookup's `where` → `whose`", apply: applyLine(line, (l) => l.replace(/\bthe(\s+@?[a-z]\w*\s+)where\b/g, (all, mid, at) => (outsideString(l, at) ? `the${mid}whose` : all))) });
    }
  }
  return out;
}

/** A diagnostic of any code that names its own rewrite: "`A` is written `B` … (`intent fix` rewrites
 *  it)". The first `A` on the line outside a plain string becomes `B`; a line with two gets two. */
const REWRITE = /^`((?:[^`]|``)+)` is written `((?:[^`]|``)+)`[^]*\(`intent fix` rewrites it\)/;
function rewriteCandidates(diags: Diagnostic[], origOf: (line: number) => number | undefined): Candidate[] {
  const out: Candidate[] = [];
  for (const d of diags) {
    if (d.code === "SPELLING" && (/looks up the row a reference points at/.test(d.message) || / in a change rule /.test(d.message) || /^`@newToken`/.test(d.message))) continue; // spellingCandidates'
    const drop = /^`((?:[^`]|``)+)` is not needed[^]*\(`intent fix` removes it\)/.exec(d.message);
    const m = REWRITE.exec(d.message) ?? (drop ? [drop[0], drop[1], ""] : null);
    if (!m) continue;
    const line = origOf(d.line);
    if (line === undefined) continue;
    const [from, to] = [m[1], m[2]];
    // `returns T` → `answers 201 T`, and a line for each other status it answers (`answers 400 Problem`).
    const more = /^returns\s/.test(from) ? [...d.message.matchAll(/`(answers [1-5]\d\d[^`]*)`/g)].map((x) => x[1]).filter((x) => x !== to) : [];
    if (more.length) {
      out.push({
        code: d.code,
        line,
        what: `\`${from}\` → \`${[to, ...more].join("`, `")}\``,
        apply: (t) => {
          const l = t.lines[line - 1] ?? "";
          const at = l.indexOf(from);
          if (at < 0 || !outsideString(l, at)) return false;
          const indent = l.slice(0, l.length - l.trimStart().length);
          t.lines[line - 1] = l.slice(0, at) + to + l.slice(at + from.length);
          t.inserts.set(line, [...(t.inserts.get(line) ?? []), ...more.map((x) => indent + x)]);
          return true;
        },
      });
      continue;
    }
    out.push({
      code: d.code,
      line,
      what: to ? `\`${from}\` → \`${to}\`` : `\`${from}\` removed`,
      apply: applyLine(line, (l) => {
        for (let at = l.indexOf(from); at >= 0; at = l.indexOf(from, at + 1)) if (outsideString(l, at)) return l.slice(0, at) + to + l.slice(at + from.length);
        return undefined;
      }),
    });
  }
  return out;
}

function applyLine(line: number, edit: (l: string) => string | undefined): (t: Text) => boolean {
  return (t) => {
    const to = edit(t.lines[line - 1] ?? "");
    if (to === undefined || to === t.lines[line - 1]) return false;
    t.lines[line - 1] = to;
    return true;
  };
}

/** `UNMARKED`: a declared name in a sentence gets its `@`, where the sentence is, never in a
 *  declaration (`text total = total as money` → `text total = @total as money`). A word that is also
 *  the endpoint's request param, or that the sentence has more than once, is the author's to say. */
function unmarkedCandidates(diags: Diagnostic[], origOf: (line: number) => number | undefined, src: string, judgements: { orig: number; code: string; what: string }[], read?: App): Candidate[] {
  const out: Candidate[] = [];
  const parsed = parseSyntax(src).app;
  const said = sentences(parsed);
  const srcLines = src.split("\n");
  for (const d of diags.filter((x) => x.code === "UNMARKED")) {
    const line = origOf(d.line);
    if (line === undefined) continue;
    const words = [...d.message.split(/ (?:is|are) a declared name/)[0].matchAll(/"(\w+)"/g)].map((m) => m[1]);
    const text = srcLines[d.line - 1] ?? "";
    const onLine = said.filter((s) => s.line === d.line);
    for (const w of words) {
      const judge = (what: string) => judgements.push({ orig: line, code: "UNMARKED", what });
      // `whose id is id` in an endpoint with a param `id`: the request's value or the row's field?
      // The endpoint's params as checked: an app that implements a contract takes them from it.
      const epName = onLine.find((s) => s.where.startsWith("endpoint "))?.where.slice("endpoint ".length);
      const param = [read, parsed].flatMap((a) => a?.endpoints?.find((e) => e.name === epName)?.params ?? []).find((p) => p.name === w);
      if (param) {
        judge(`ambiguous: \`${w}\` — the request's \`@${param.in}.${w}\`, or the declared \`@${w}\`? Write the one you mean`);
        continue;
      }
      // Where the sentence is: on its line after the declaration (never in it), or on a line of the
      // element's block (`visible when …`, `enabled when …` are reported on the element's line).
      const spans = onLine.flatMap((s) => {
        const said = s.text.trim();
        for (let n = d.line; n <= Math.min(srcLines.length, d.line + 8); n++) {
          const at = srcLines[n - 1].lastIndexOf(said);
          // Not inside a string (`text empty = "Your cart is empty"` is not the sentence `cart is empty`).
          if (said && at >= 0 && (said.startsWith('"') || outsideString(srcLines[n - 1], at)) && (n === d.line || srcLines[n - 1].trim().endsWith(said))) return [{ n, at, len: said.length }];
        }
        return [];
      });
      // The occurrences the checker sees: outside strings, template holes included (a hole is shown text).
      const perSentence = spans.map((sp) => bareAt(srcLines[sp.n - 1], w, sp.at, sp.at + sp.len).filter((at) => !inString(srcLines[sp.n - 1], at)).map((at) => ({ n: sp.n, at })));
      const hits = perSentence.filter((h) => h.length === 1).map((h) => h[0]).filter((h, i, all) => all.findIndex((x) => x.n === h.n && x.at === h.at) === i);
      const many = perSentence.find((h) => h.length > 1);
      if (many) judge(`\`${w}\` is in this sentence ${many.length} times: mark the ones that mean the declared name (\`@${w}\`)`);
      else if (!hits.length) judge(`\`${w}\`: not found in a sentence on this line; mark it \`@${w}\` where you mean the name`);
      if (many) continue;
      for (const hit of hits) {
        // `that amount`, `something left`: English more often than the name (a row is `that <record>`).
        const before = srcLines[hit.n - 1].slice(0, hit.at).match(/\b(that|this|those|these|something|anything|nothing)\s+$/);
        if (before) {
          judge(`\`${before[1]} ${w}\`: English, or the declared \`@${w}\`? Write \`@${w}\` if you mean the name`);
          continue;
        }
        const target = origOf(hit.n);
        if (target === undefined) continue;
        const nth = bareAt(srcLines[hit.n - 1], w).indexOf(hit.at); // the same occurrence in the text a fix sees
        out.push({
          code: "UNMARKED",
          line: target,
          what: `marked @${w}`,
          apply: applyLine(target, (l) => {
            const at = bareAt(l, w)[nth];
            return at === undefined ? undefined : l.slice(0, at) + "@" + l.slice(at);
          }),
        });
      }
    }
  }
  return out;
}

/** `IMPORT`: the bundle a name comes from, imported. */
function importCandidates(diags: Diagnostic[]): Candidate[] {
  const bundles = [...new Set(diags.filter((x) => x.code === "IMPORT").map((d) => /add `import ([^`]+)`/.exec(d.message)?.[1]).filter((x): x is string => !!x))];
  return bundles.map((b) => ({ code: "IMPORT", line: 0, what: `added \`import ${b}\``, apply: (t) => (render(t).src.match(new RegExp(`^import\\s+${b.replace(/\./g, "\\.")}\\s*$`, "m")) ? false : (addImport(t, b), true)) }));
}

/** An `import` line after the last one (or after the header, and after a `language` line added there). */
function addImport(t: Text, bundle: string) {
  let last = -1;
  t.lines.forEach((l, i) => /^import\s/.test(l) && (last = i));
  const own = t.lines.join("\n");
  const after = last >= 0 ? last + 1 : own.slice(0, afterHeader(own)).split("\n").length - 1;
  t.inserts.set(after, [...(t.inserts.get(after) ?? []), `import ${bundle}`]);
}
