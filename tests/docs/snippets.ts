// The docs an LLM copies must check. A fenced block tagged ```intent is a complete spec: it must
// pass the checker (through load, so imports and contracts resolve) and already be in canonical
// layout (`intent fmt --check`). Excerpts stay untagged.
import { mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { toBraces } from "../../compiler/braces.ts";
import { load } from "../../compiler/load.ts";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "../..");
process.chdir(ROOT);
const sources = ["docs/LANGUAGE.md", "docs/TOOLS.md", "docs/GUIDE.md", "skills/intent-spec/SKILL.md"];
// A block tagged ```intent-excerpt is part of a spec: it is read inside an app (or as a file of its
// own when it starts with a header) and must use the language's one spelling (no `SPELLING`) and
// its syntax (no `SYNTAX`, `INDENT`); names it uses from elsewhere may be missing.
const HEADER = /^(app|bundle|contract|layer|platform|profile)\s/;
const EXCERPT_CODES = new Set(["SYNTAX", "INDENT", "SPELLING"]);
const ELEMENT = /^(heading|text|field|button|checkbox|select|list|section|progress|use)\s/;
const tmp = join(ROOT, ".intent/doc-snippets");
rmSync(tmp, { recursive: true, force: true });
mkdirSync(tmp, { recursive: true });

let failures = 0;
let checked = 0;
let excerpts = 0;
for (const f of sources) {
  const lines = readFileSync(join(ROOT, f), "utf8").split("\n");
  let inFence = false;
  let excerpt = false;
  let indent = 0;
  let start = 0;
  let buf: string[] = [];
  for (let i = 0; i < lines.length; i++) {
    if (!inFence) {
      if (/^\s*```intent-excerpt\s*$/.test(lines[i]) || /^```intent\s*$/.test(lines[i])) {
        inFence = true;
        excerpt = /-excerpt/.test(lines[i]);
        indent = lines[i].length - lines[i].trimStart().length;
        start = i + 2; // 1-based line of the first content line
        buf = [];
      }
      continue;
    }
    if (/^\s*```\s*$/.test(lines[i]) && excerpt) {
      inFence = false;
      checked++;
      excerpts++;
      const body = buf.map((l) => l.slice(Math.min(indent, l.length - l.trimStart().length)));
      const first = body.find((l) => l.trim() && !l.startsWith("#")) ?? "";
      // An excerpt of screen elements goes inside a `screen` block; anything else is top level.
      const elements = ELEMENT.test(first.trimStart());
      const own = HEADER.test(first);
      const api = body.some((l) => /^(endpoint|access|layer)\s/.test(l)) && !body.some((l) => /^profile\s/.test(l));
      const wrap = own ? [] : ["app Excerpt {", '  "an excerpt of the reference"', "}", "", ...(api ? ["profile api", ""] : []), ...(elements ? ["screen {"] : [])];
      const code = [...wrap, ...(elements ? body.map((l) => (l ? "  " + l : l)) : body), ...(elements ? ["}"] : [])].join("\n") + "\n";
      const file = join(tmp, `${f.replace(/[^\w]/g, "-")}-${start}.intent`);
      writeFileSync(file, code);
      // What an excerpt leaves out (the screen, the profile) is not its mistake.
      const bad = load(file, { ignoreLock: true }).diagnostics.filter((d) => EXCERPT_CODES.has(d.code) && (!d.file || d.file.endsWith(`-${start}.intent`)) && d.line > wrap.length && !/the app has no `screen`/.test(d.message));
      for (const d of bad) (failures++, console.log(`${f}:${start + d.line - 1 - wrap.length}: ${d.code} ${d.message} (an excerpt)`));
      continue;
    }
    if (/^```\s*$/.test(lines[i])) {
      inFence = false;
      checked++;
      const code = buf.join("\n") + "\n";
      const file = join(tmp, `${f.replace(/[^\w]/g, "-")}-${start}.intent`);
      writeFileSync(file, code);
      const errors = load(file, { ignoreLock: true }).diagnostics.filter((d) => d.level === "error");
      for (const d of errors) (failures++, console.log(`${f}:${start + d.line - 1}: ${d.code} ${d.message}`));
      if (toBraces(code).replace(/\n*$/, "\n") !== code) (failures++, console.log(`${f}:${start}: snippet is not in canonical layout (run intent fmt)`));
      continue;
    }
    buf.push(lines[i]);
  }
}
rmSync(tmp, { recursive: true, force: true });

// The reference is the compiler's prompt: it says what the language is. No history (versions,
// changelog: docs/CHANGELOG.md) and no paths into this repository (apps/, runs/, tests/, …).
{
  const ref = readFileSync(new URL("../../docs/LANGUAGE.md", import.meta.url), "utf8").split("\n");
  ref.forEach((line, i) => {
    if (i === 0) return; // the header names the version the compiler pins
    const bad = line.match(/\b(apps|runs|tests|compiler|docs|runtime|skills|registry)\/|^## (Changelog|Growing the language)\b|\bv\d{1,3}\b(?!\.)/);
    if (bad && !/`language v\d+`/.test(line)) (failures++, console.log(`docs/LANGUAGE.md:${i + 1}: \`${bad[0]}\` is history or a path into this repository, not the language: ${line.trim().slice(0, 100)}`));
  });
}
console.log(failures ? `${failures} failure(s)` : `doc snippets pass (${checked} tagged, ${excerpts} of them excerpts), and the reference holds only the language`);
process.exit(failures ? 1 : 0);
