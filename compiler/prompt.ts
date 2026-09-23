// The prompt that turns the LLM into the code-generation stage of the compiler.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { ELM_APP_SKELETON, ROOT, TS_APP_SKELETON, type Target } from "./gen.ts";

export const SYSTEM = `You are the code-generation stage of the Intent compiler. You translate an Intent spec into exactly one source module.
Behave like a compiler: literal, deterministic, no creativity, no extra features, no commentary.
Reply with the complete module in a single fenced code block and nothing else.
Exception: if the spec contradicts itself (for example an example expects something its own rules forbid), no module can be correct. Then reply with one line, "SPEC CONFLICT: " followed by the spec line numbers and a one-sentence explanation, and no code.`;

const FMT_API = {
  elm: `Fmt.fixed : Int -> Float -> String      -- exactly n decimals, half away from zero: fixed 2 1.005 == "1.01"
Fmt.decimal : Int -> Float -> String    -- at most n decimals, trailing zeros removed: decimal 8 (0.1 + 0.2) == "0.3"
Fmt.money : Float -> String             -- fixed 2
Fmt.int : Int -> String                 -- plain digits
Fmt.clock : Int -> String               -- seconds as "m:ss" (or "h:mm:ss"): clock 1500 == "25:00"
Fmt.parseDecimal : String -> Maybe Float -- "-?digits([.,]digits)?", spaces trimmed
Fmt.parseInt : String -> Maybe Int
Fmt.roundTo : Int -> Float -> Float     -- round to n decimals, half away from zero
Fmt.roundUpTo : Int -> Float -> Float   -- round up (towards +infinity) to n decimals
Fmt.roundDownTo : Int -> Float -> Float -- round down (towards -infinity) to n decimals
Fmt.cents : Float -> Int                -- whole cents, half away from zero: cents 12.345 == 1235`,
  ts: `Fmt.fixed(places: number, x: number): string   // exactly n decimals, half away from zero: fixed(2, 1.005) === "1.01"
Fmt.decimal(places: number, x: number): string // at most n decimals, trailing zeros removed: decimal(8, 0.1 + 0.2) === "0.3"
Fmt.money(x: number): string                    // fixed(2, x)
Fmt.int(n: number): string                      // plain digits
Fmt.clock(totalSeconds: number): string         // "m:ss" (or "h:mm:ss"): clock(1500) === "25:00"
Fmt.parseDecimal(text: string): number | null   // "-?digits([.,]digits)?", spaces trimmed
Fmt.parseInt(text: string): number | null
Fmt.roundTo(places: number, x: number): number      // round to n decimals, half away from zero
Fmt.roundUpTo(places: number, x: number): number    // round up (towards +infinity) to n decimals
Fmt.roundDownTo(places: number, x: number): number  // round down (towards -infinity) to n decimals
Fmt.cents(x: number): number                        // whole cents, half away from zero: cents(12.345) === 1235`,
};

const TARGET_RULES = {
  elm: `Target: Elm 0.19. You write \`src/App.elm\`.
- Available: elm/core (List, String, Dict, Set, Array, Maybe, Char, Tuple, Basics), the generated \`Spec\` module, and \`Fmt\`. Nothing else: no other packages, no ports, no Debug.
- \`import Spec exposing (..)\` and \`import Fmt\`. Import core modules you use (Dict, Set, Array) explicitly.
- The module must expose exactly (Model, init, update, view) with these signatures:`,
  ts: `Target: TypeScript (strict mode). You write \`app.ts\`.
- Available: the standard library, the generated \`./spec.ts\` module, and \`./fmt.ts\`. No other imports, no DOM, no timers, no randomness, no Date.
- Import with explicit extensions: \`import type { … } from "./spec.ts"\`, \`import * as Fmt from "./fmt.ts"\`.
- Model must be treated as immutable: return new objects from update.
- The module must export exactly Model, init, update, view with these signatures:`,
};

const CODING_RULES = `Rules that keep every build identical:
1. Model mirrors the spec's \`state\`: same names, same meaning. Add only what you truly need (for example a counter that hands out row keys).
2. Each \`on\` handler: implement its sentences in order, literally. Where the spec is silent, apply the defaults in §9 of the language reference. Never add behaviour the spec does not ask for.
3. Built-in behaviour from §4 always applies: typing into a field sets that state field to the typed text; choosing sets the select's state; toggling a checkbox flips its Bool. Handlers add to this; they do not replace it.
4. \`view\` computes every Screen field from the Model; derived values are computed, not stored.
5. Template strings "…{…}…" are exact: reproduce every character outside the braces literally.
6. Row keys: a stable id per item, assigned when the item is created.
7. Every example in the spec must pass. Walk through each one step by step before you answer.
8. All rounding goes through Fmt (roundTo / roundUpTo / roundDownTo / cents). Never write your own rounding, epsilon or float tricks.
9. A \`table\` default in the spec is available as \`<stateName>Initial\` in the generated interface; use it in init.
10. Write plain, straightforward code. No comments needed.`;

/**
 * The probe compiler of a twin build: it must honour everything the spec and the language say,
 * but where they still leave a real choice it takes a different reasonable reading. If its app
 * behaves differently and still passes every example, the spec is ambiguous.
 */
export const PROBE_RULES = `You are the PROBE compiler of a twin build. Another compiler builds this same spec the most obvious way. Your job is to find out whether the spec is ambiguous:
- Follow every sentence, template, example, \`always\` check and every default in §9 exactly. Never break any of them.
- Wherever the spec and the defaults together still leave a real choice (what counts as a word, how ties are ordered, what happens in an unmentioned edge case, what an unclear sentence means), deliberately take a DIFFERENT reasonable reading than the most obvious one.
- Stay reasonable: a person reading the spec should agree your reading is allowed by the text.`;

export function buildPrompt(target: Target, specFile: string, specText: string, specModule: string, probe = false): string {
  const language = readFileSync(join(ROOT, "docs/LANGUAGE.md"), "utf8");
  const lang = target === "elm" ? "elm" : "ts";
  return `# Language reference

${language}

# ${TARGET_RULES[target]}

\`\`\`${lang}
${target === "elm" ? ELM_APP_SKELETON : TS_APP_SKELETON}\`\`\`

Standard helpers (use these for all number/time formatting and parsing):
\`\`\`
${FMT_API[target]}
\`\`\`

${CODING_RULES}

# Generated interface (${target === "elm" ? "src/Spec.elm" : "spec.ts"})

\`\`\`${lang}
${specModule}\`\`\`

# The spec (${specFile})

\`\`\`intent
${specText}\`\`\`

${probe ? `# Probe mode\n\n${PROBE_RULES}\n\n` : ""}Write ${target === "elm" ? "src/App.elm" : "app.ts"} now.`;
}

export function repairPrompt(base: string, target: Target, code: string, problems: string): string {
  const lang = target === "elm" ? "elm" : "ts";
  return `${base}

# Your previous attempt

\`\`\`${lang}
${code}\`\`\`

# Problems with it

${problems}

Fix these problems. Reply with the complete corrected module.`;
}
