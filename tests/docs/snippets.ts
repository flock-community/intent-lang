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
const sources = ["docs/LANGUAGE.md", "docs/GUIDE.md", "skills/intent-spec/SKILL.md"];
const tmp = join(ROOT, ".intent/doc-snippets");
rmSync(tmp, { recursive: true, force: true });
mkdirSync(tmp, { recursive: true });

let failures = 0;
let checked = 0;
for (const f of sources) {
  const lines = readFileSync(join(ROOT, f), "utf8").split("\n");
  let inFence = false;
  let start = 0;
  let buf: string[] = [];
  for (let i = 0; i < lines.length; i++) {
    if (!inFence) {
      if (/^```intent\s*$/.test(lines[i])) {
        inFence = true;
        start = i + 2; // 1-based line of the first content line
        buf = [];
      }
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
console.log(failures ? `${failures} failure(s)` : `doc snippets pass (${checked} tagged)`);
process.exit(failures ? 1 : 0);
