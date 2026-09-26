// `intent fix`: apply the mechanical fixes a diagnostic names, so an author does not retype them.
// Deliberately narrow — an old `Maybe T` type, an unmarked declared name (`UNMARKED`), a missing
// `import`, and the `language vN` line. Anything that needs judgement is left for the author; the
// command never trades one error for another (it checks the result before writing).
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Diagnostic } from "./ast.ts";
import { compilerPins, load } from "./load.ts";

export interface Fix {
  line: number;
  code: string;
  what: string;
}

/** The index just after the first top-level block (the `app … { … }` header), where a `language`
 *  line goes. Indentation syntax (no braces): just after the first blank line. */
function afterHeader(src: string): number {
  const lines = src.split("\n");
  let depth = 0;
  let seen = false;
  for (let i = 0; i < lines.length; i++) {
    if (lines[i].includes("{")) (depth++, (seen = true));
    if (lines[i].includes("}")) depth--;
    if (seen && depth <= 0) return lines.slice(0, i + 1).join("\n").length + 1;
    if (!seen && lines[i].trim() && i > 0) return lines.slice(0, i).join("\n").length + 1;
  }
  return src.length ? src.length + 1 : 0;
}

/** The index just after the last `import …` line (or the header when there is none). */
function afterImports(src: string): number {
  const lines = src.split("\n");
  let last = -1;
  for (let i = 0; i < lines.length; i++) if (/^import\s/.test(lines[i])) last = i;
  return last >= 0 ? lines.slice(0, last + 1).join("\n").length + 1 : afterHeader(src);
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

/** Mark the first bare occurrence of `word` on the line (`word` → `@word`), outside plain strings. */
export function markWord(line: string, word: string): string | undefined {
  for (let i = 0; i + word.length <= line.length; i++) {
    if (!line.startsWith(word, i)) continue;
    if (i > 0 && /[\w@.]/.test(line[i - 1])) continue;
    if (/[\w]/.test(line[i + word.length] ?? "")) continue;
    if (outsideString(line, i)) return line.slice(0, i) + "@" + line.slice(i);
  }
  return undefined;
}

/** Text fixes that need no diagnostics: the old `Maybe T`, and the `language vN` line. */
export function fixSource(src: string, language: string): { out: string; fixes: Fix[] } {
  const fixes: Fix[] = [];
  const out = src
    .split("\n")
    .map((line, i) => {
      let result = "";
      let last = 0;
      for (const m of line.matchAll(/\bMaybe\s+([A-Za-z]\w*)/g)) {
        const at = m.index!;
        if (!outsideString(line, at)) continue;
        result += line.slice(last, at) + `${m[1]} or nothing`;
        last = at + m[0].length;
        fixes.push({ line: i + 1, code: "LANGUAGE", what: `Maybe ${m[1]} → ${m[1]} or nothing` });
      }
      return result + line.slice(last);
    })
    .join("\n");
  if (!language) return { out, fixes };
  const declared = out.match(/^language\s+(v\d+)\s*$/m);
  if (declared) {
    if (declared[1] === language) return { out, fixes };
    fixes.push({ line: out.slice(0, declared.index).split("\n").length, code: "LANGUAGE", what: `language ${declared[1]} → ${language}` });
    return { out: out.replace(/^language\s+v\d+\s*$/m, `language ${language}`), fixes };
  }
  const at = afterHeader(out);
  return { out: out.slice(0, at) + `language ${language}\n` + out.slice(at), fixes: [...fixes, { line: out.slice(0, at).split("\n").length, code: "LANGUAGE", what: `added \`language ${language}\`` }] };
}

/** Check a candidate source as if it were `file` (a temp copy: bundle imports resolve by project). */
function check(src: string): Diagnostic[] {
  const dir = mkdtempSync(join(tmpdir(), "fix-"));
  try {
    const p = join(dir, "spec.intent");
    writeFileSync(p, src);
    return load(p, { ignoreLock: true }).diagnostics;
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

/** Apply every mechanical fix to the source of `file`, and report what is left. */
export function fixFile(file: string): { out: string; fixes: Fix[]; left: Diagnostic[] } {
  const before = check(readFileSync(file, "utf8"));
  const { out: step1, fixes } = fixSource(readFileSync(file, "utf8"), compilerPins().languageVersion);
  // Diagnostics of the fixed source: `UNMARKED` and `IMPORT` name their own fix.
  const diags = check(step1);
  const lines = step1.split("\n");
  for (const d of diags.filter((x) => x.code === "UNMARKED")) {
    const words = [...d.message.split(/ (?:is|are) a declared name/)[0].matchAll(/"(\w+)"/g)].map((m) => m[1]);
    for (const w of words) {
      const marked = markWord(lines[d.line - 1] ?? "", w);
      if (marked && marked !== lines[d.line - 1]) {
        lines[d.line - 1] = marked;
        fixes.push({ line: d.line, code: "UNMARKED", what: `marked @${w}` });
      }
    }
  }
  let out = lines.join("\n");
  const imports = [...new Set(diags.filter((x) => x.code === "IMPORT").map((d) => /add `import ([^`]+)`/.exec(d.message)?.[1]).filter((x): x is string => !!x))];
  for (const b of imports) {
    const at = afterImports(out);
    out = out.slice(0, at) + `import ${b}\n` + out.slice(at);
    fixes.push({ line: out.slice(0, at).split("\n").length, code: "IMPORT", what: `added \`import ${b}\`` });
  }
  const errorsBefore = before.filter((d) => d.level === "error").length;
  const after = check(out);
  const errorsAfter = after.filter((d) => d.level === "error").length;
  if (errorsAfter > errorsBefore) return { out: readFileSync(file, "utf8"), fixes: [], left: before };
  return { out, fixes, left: after };
}
