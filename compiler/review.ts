// `intent review`: before building, list where the spec is silent, so the author sees what the
// defaults (§9) or a literal reading will decide. Builds are consistent; this makes them intended.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { ROOT } from "./gen.ts";
import { complete } from "./llm.ts";
import { load } from "./load.ts";
import { printApp } from "./print.ts";
import { resolve } from "node:path";

const SYSTEM = `You review specs written in the Intent language for their author, before they are compiled.
The compiler reads every sentence literally and fills every silence with the defaults in §9 of the language reference. It never asks.
Your job: find the places where that literal reading will probably surprise the author. Be concrete and brief.`;

export async function review(file: string): Promise<{ text: string; costUsd: number }> {
  const language = readFileSync(join(ROOT, "docs/LANGUAGE.md"), "utf8");
  const loaded = load(resolve(file));
  // The author's own file, numbered (cite these lines), plus the expanded spec for context.
  const source = readFileSync(file, "utf8");
  const numbered = source.split("\n").map((l, i) => `${String(i + 1).padStart(3)}  ${l}`).join("\n");
  const expanded = loaded.app && (loaded.app.imports?.length ?? 0) > 0 ? printApp(loaded.app) : "";
  const prompt = `# Language reference

${language}

# The spec (with line numbers — cite these)

\`\`\`
${numbered}
\`\`\`
${expanded ? `\n# The same spec with its imports expanded (context only; do not cite its lines)\n\n\`\`\`\n${expanded}\n\`\`\`\n` : ""}
List at most 8 findings, most important first. Only report things a user of the app would notice. For each finding write exactly:

### <line numbers>: <a question the spec does not answer>
- As written: <what the compiler will build, following the literal text and §9>
- Probably meant: <what the purpose suggests the author wants, if different>
- Add: <the exact sentence, \`always\` check or example steps to add to the spec>

If the spec already answers everything that matters, reply "No findings."`;
  const r = await complete(SYSTEM, prompt);
  if (r.error) throw new Error(r.error);
  return { text: r.text.trim(), costUsd: r.costUsd };
}
