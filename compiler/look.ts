// Stage 2 of a styled build: the LLM writes the presentation (Look) with Tailwind;
// the harness checks it in a real browser against the DOM contract, the examples and the logic.
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { App, Example } from "./ast.ts";
import { fidelityDiff, openStyled } from "./browser.ts";
import { canonical, checkSee, describe, resolve, stepToAction, type Action, type Obs } from "./exec.ts";
import { ROOT, type Target } from "./gen.ts";
import { complete, extractCode } from "./llm.ts";
import { SYSTEM } from "./prompt.ts";
import { designSummary, ELM_LOOK_SKELETON, scaffoldStyled, TS_LOOK_SKELETON } from "./styled.ts";
import { compileStyled } from "./toolchain.ts";
import { KIT_GUIDE } from "./kit.ts";
import { where as whereIn } from "./load.ts";

export const DOM_CONTRACT = `The harness finds and drives every element through data attributes. It checks, in a real browser, that the page shows exactly what the Screen says. Rules:
1. Every element of the spec's screen except headings gets data-el="<its name>" on exactly one DOM element, only while it is visible. When its Screen field is Nothing/null it is not in the DOM at all.
2. text: data-el goes on the innermost element that holds the text itself (for a table cell: the element inside the <td>, never the <td>); its text content is exactly the value (surrounding whitespace is ignored). Decorations (dots, icons) must have no text: empty elements, inline SVG, or aria-hidden without text.
3. field: data-el on the <input> or <textarea> itself; value = the Screen value; every keystroke sends the Typed event with the full text.
4. button: data-el on the <button>. Its text is exactly the label; an \`icon\` button may show a symbol instead, but then aria-label is exactly the label. Use the disabled attribute when it is not enabled.
5. checkbox: data-el on an <input type="checkbox">, or on an element with role="switch" and aria-checked="true"/"false". Toggling (a click) sends the Toggled event.
6. select: either data-el on a native <select> whose option values are the choice values (option text = labels), or data-el on a container holding one element per option with data-option="<Value>" (the value name, not the label) and aria-selected="true" (tabs, chips), aria-pressed="true" (segmented) or aria-current="page" (nav) on the chosen one. Clicking an option sends the Chosen event. Options appear in the order of the choice.
7. progress: data-el on a <progress max="100" value="…"> or on an element with role="progressbar" and aria-valuenow.
8. list: data-el on the list container; each row is one element with data-row (rows are never nested). Row elements go inside their row.
9. section: data-el on the section's container; its elements are inside it. A section with nothing visible in it may be left out. A section title (\`section x "Title"\`) and field labels are shown as written.
10. Nothing else may carry data-el, data-row or data-option.`;

const STYLE_RULES = `Styling rules:
- Style only with Tailwind CSS v4 utility classes in class attributes. No custom CSS, no <style>, no inline style, except style="width: N%" for the fill of progress bars and chart bars.
- Tailwind only sees complete class names written literally in this file: never build a class name from pieces. For conditional styling, choose between complete literal strings.
- Use the colour roles from the theme (brand, neutral, accent, success, warning, danger, info), never raw palette names like indigo or slate.
- No animations, no transitions, no external assets (images, web fonts, icon fonts). Icons are inline SVG or plain characters.
- The root element is the whole page (min-h-screen, the page background). Design for a 1280px wide desktop window; it should not break on small screens.
- Presentations (\`as …\`) have the meanings in §4a. Each declared \`component\` is one reusable function used everywhere it appears.
- Follow the design's look, each component's look and each element's look sentence.
- Show only what the spec names (§9, Look): no extra logos, icons, column headers, labels, helper texts or decorations unless a look sentence asks for them.`;

const TARGET = {
  elm: `Target: Elm 0.19, elm/html. You write \`src/Look.elm\`, exposing exactly \`render : Screen -> Html Msg\`.
- Available: elm/core, elm/html (Html, Html.Attributes, Html.Events), elm/json, and the generated \`Spec\` module (types, Msg constructors, and \`<choice>Label\`/\`<choice>ToString\`/\`<choice>Values\` helpers). Nothing else; no Debug.
- Data attributes: \`Html.Attributes.attribute "data-el" "name"\`; ARIA the same way. Inline SVG needs the elm/svg package, which is not available: draw icons with characters or styled empty elements.
- Events: \`onClick (ShownOpenClicked row.key)\`, \`onInput DraftTyped\`, \`onClick (StatusFilterChosen v)\`, \`onInput (\\\\v -> …)\` for a native select via \`<choice>FromString\`.`,
  ts: `Target: TypeScript + Preact (TSX). You write \`look.tsx\`, exporting exactly \`render(screen: Screen, send: (msg: Msg) => void): VNode\`.
- Available: preact (import type { VNode } from "preact"), and the generated \`./spec.ts\` (types, and \`<choice>Values\`/\`<choice>Labels\`). Nothing else. Import with explicit extensions: \`import type { … } from "./spec.ts"\`.
- JSX uses class= (not className). Events: onClick={() => send({ tag: "ShownOpenClicked", key: row.key })}, onInput={(e) => send({ tag: "DraftTyped", text: (e.target as HTMLInputElement).value })}.
- The code must type-check in strict mode.`,
};

export function buildLookPrompt(app: App, target: Target, specFile: string, specText: string, specModule: string, kitSource?: string): string {
  const language = readFileSync(join(ROOT, "docs/LANGUAGE.md"), "utf8");
  const lang = target === "elm" ? "elm" : "tsx";
  return `# Language reference

${language}

# Your task: the presentation

The app's logic is already compiled: a separate module turns the state into the \`Screen\` value below and handles every \`Msg\`. You write only how a Screen looks and which Msg each control sends.

${TARGET[target]}

\`\`\`${lang}
${target === "elm" ? ELM_LOOK_SKELETON : TS_LOOK_SKELETON}\`\`\`

## Design tokens (generated from the spec's design block)

${designSummary(app)}

${kitSource ? `## The Kit (${target === "elm" ? "src/Kit.elm, \`import Kit\`" : "kit.ts, \`import { kit } from \"./kit.ts\"\`"})

${KIT_GUIDE}

\`\`\`${target === "elm" ? "elm" : "ts"}
${kitSource}\`\`\`

` : ""}## DOM contract

${DOM_CONTRACT}

## ${STYLE_RULES}

# Generated interface (${target === "elm" ? "src/Spec.elm" : "spec.ts"})

\`\`\`${target === "elm" ? "elm" : "ts"}
${specModule}\`\`\`

# The spec (${specFile})

\`\`\`intent
${specText}\`\`\`

Write ${target === "elm" ? "src/Look.elm" : "look.tsx"} now.`;
}

export interface LookResult {
  ok: boolean;
  attempts: { stage: string; detail: string }[];
  costUsd: number;
  ms: number;
}

/** Run every example through the real page; check the DOM contract and fidelity after every step. */
export async function checkLook(dir: string, app: App, shotsDir?: string): Promise<{ problems: string[]; checked: number }> {
  const problems: string[] = [];
  let checked = 0;
  const examples: (Example | undefined)[] = [undefined, ...app.examples]; // undefined = the initial screen only
  for (const ex of examples) {
    const s = await openStyled(dir, app);
    try {
      let { dom, screen, errors } = await s.observe();
      const verify = (where: string): boolean => {
        checked++;
        const diff = fidelityDiff(dom, screen);
        if (!errors.length && !diff.length) return true;
        problems.push(`${where}:\n${[...errors, ...diff].slice(0, 10).map((l) => `- ${l}`).join("\n")}\n\nWhat the screen should show:\n\`\`\`\n${describe(screen)}\n\`\`\``);
        return false;
      };
      if (!verify(ex ? `example "${ex.name}", initial screen` : "the initial screen")) continue;
      if (shotsDir && !ex) {
        writeFileSync(join(shotsDir, "initial.png"), await s.shot());
        writeFileSync(join(shotsDir, "initial.json"), JSON.stringify(await s.rects()));
      }
      if (!ex) continue;
      for (const step of ex.steps) {
        const src = whereIn(app, step.line);
        const where = `example "${ex.name}", after ${src.file}:${src.line} \`${src.text}\``;
        if (step.do === "snapshot") {
          if (shotsDir) {
            const state = step.name.replace(/[^a-z0-9]+/gi, "-").toLowerCase();
            writeFileSync(join(shotsDir, `${state}.png`), await s.shot());
            writeFileSync(join(shotsDir, `${state}.json`), JSON.stringify(await s.rects()));
          }
          continue;
        }
        if (step.do === "see") {
          const msg = checkSee(dom, step);
          if (msg) {
            problems.push(`${where}: ${msg} (on the page)\n\nWhat the screen should show:\n\`\`\`\n${describe(screen)}\n\`\`\``);
            break;
          }
          continue;
        }
        const action = stepToAction(step)!;
        const r = resolve(dom, action);
        if ("unavailable" in r) {
          problems.push(`${where}: cannot do this step on the page: ${r.unavailable}`);
          break;
        }
        const err = await s.act(action, dom);
        if (err) {
          problems.push(`${where}: cannot do this step on the page: ${err}`);
          break;
        }
        ({ dom, screen, errors } = await s.observe());
        if (!verify(where)) break;
      }
    } catch (e) {
      problems.push(`${ex ? `example "${ex.name}"` : "the initial screen"}: the page failed: ${(e as Error).message.split("\n")[0]}`);
    } finally {
      await s.close();
    }
  }
  return { problems, checked };
}

export async function buildLook(app: App, specFile: string, specText: string, target: Target, dir: string, specModule: string, log: (m: string) => void, useKit = false, maxAttempts = 4): Promise<LookResult> {
  const t0 = Date.now();
  const { lookFile } = scaffoldStyled(app, target, dir, useKit);
  writeFileSync(join(dir, ".spec.intent"), specText);
  mkdirSync(join(dir, "shots"), { recursive: true });
  const kitSource = useKit ? readFileSync(join(dir, target === "elm" ? "src/Kit.elm" : "kit.ts"), "utf8") : undefined;
  const base = buildLookPrompt(app, target, specFile, specText, specModule, kitSource);
  const res: LookResult = { ok: false, attempts: [], costUsd: 0, ms: 0 };
  let code = "";
  let problems = "";
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    const prompt = problems
      ? `${base}\n\n# Your previous attempt\n\n\`\`\`${target === "elm" ? "elm" : "tsx"}\n${code}\`\`\`\n\n# Problems with it\n\n${problems}\n\nFix these problems. Keep everything else as it is. Reply with the complete corrected module.`
      : base;
    writeFileSync(join(dir, `log/look-prompt-${attempt}.md`), prompt);
    const r = await complete(SYSTEM, prompt);
    res.costUsd += r.costUsd;
    if (r.error) {
      res.attempts.push({ stage: "llm", detail: r.error });
      continue;
    }
    writeFileSync(join(dir, `log/look-response-${attempt}.md`), r.text);
    code = extractCode(r.text);
    writeFileSync(lookFile, code);
    const errors = await compileStyled(target, dir);
    if (errors) {
      problems = `The module does not compile:\n\n\`\`\`\n${errors}\n\`\`\``;
      res.attempts.push({ stage: "compile", detail: errors.slice(0, 1500) });
      log(`look attempt ${attempt}: compile errors`);
      continue;
    }
    const { problems: found, checked } = await checkLook(dir, app, join(dir, "shots"));
    if (!found.length) {
      res.ok = true;
      res.attempts.push({ stage: "ok", detail: `${checked} screens match` });
      log(`look attempt ${attempt}: ok (${checked} screens match)`);
      break;
    }
    problems = `It compiles, but the page does not match in ${found.length} place(s):\n\n${found.slice(0, 6).join("\n\n")}`;
    res.attempts.push({ stage: "browser", detail: found.map((f) => f.split("\n")[0]).join("; ").slice(0, 1500) });
    log(`look attempt ${attempt}: ${found.length} browser problem(s)`);
  }
  res.ms = Date.now() - t0;
  writeFileSync(join(dir, "look.json"), JSON.stringify(res, null, 2));
  return res;
}

/** Replay sessions through the real page of a styled build. Screens are what the DOM shows. */
export async function runStyledTraces(dir: string, app: App, traces: Action[][]): Promise<{ steps: string[] | null; mismatch?: string }[]> {
  const out: { steps: string[] | null; mismatch?: string }[] = [];
  for (const trace of traces) {
    const s = await openStyled(dir, app);
    try {
      let { dom, screen } = await s.observe();
      const steps = [canonical(dom)];
      let mismatch = fidelityDiff(dom, screen)[0];
      for (const a of trace) {
        if ("unavailable" in resolve(dom, a) || (await s.act(a, dom))) {
          steps.push("-");
          continue;
        }
        ({ dom, screen } = await s.observe());
        steps.push(canonical(dom));
        mismatch ??= fidelityDiff(dom, screen)[0];
      }
      out.push({ steps, mismatch });
    } catch (e) {
      out.push({ steps: null, mismatch: (e as Error).message.split("\n")[0] });
    } finally {
      await s.close();
    }
  }
  return out;
}
