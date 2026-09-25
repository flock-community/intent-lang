// The prompt that turns the LLM into the code-generation stage of the compiler.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { ROOT, type Target } from "./gen.ts";
import { TARGETS, targetModule } from "./targets/index.ts";
import { API_APP_SKELETON, API_TARGET_RULES } from "./api.ts";
import { CLIENT_LAYER_RULES, CLIENT_LAYER_SKELETON, LAYER_RULES, LAYER_SKELETON } from "./layer.ts";

export const SYSTEM = `You are the code-generation stage of the Intent compiler. You translate an Intent spec into exactly one source module.
Behave like a compiler: literal, deterministic, no creativity, no extra features, no commentary.
Reply with the complete module in a single fenced code block and nothing else.
Exception: if the spec contradicts itself (for example an example expects something its own rules forbid), no module can be correct. Then reply with one line, "SPEC CONFLICT: " followed by the spec line numbers and a one-sentence explanation, and no code.`;



const CODING_RULES = `Rules that keep every build identical:
1. Model mirrors the spec's \`state\`: same names, same meaning. Add only what you truly need (for example a counter that hands out row keys).
2. Each \`on\` handler: implement its sentences in order, literally. Where the spec is silent, apply the defaults in §9 of the language reference. Never add behaviour the spec does not ask for.
3. Built-in behaviour from §4 always applies: typing into a field sets that state field to the typed text; choosing sets the select's state; toggling a checkbox flips its Bool. Handlers add to this; they do not replace it.
4. \`view\` computes every Screen field from the Model; derived values are computed, not stored.
5. Template strings "…{…}…" are exact: reproduce every character outside the braces literally.
6. Row keys: a stable id per item, assigned when the item is created.
7. Every example in the spec must pass. Walk through each one step by step before you answer.
8. All rounding goes through Fmt (roundTo / roundUpTo / roundDownTo / cents). Never write your own rounding, epsilon or float tricks.
9. A \`table\` default in the spec is available as \`<stateName>Initial\` in the generated interface; use it in init. For every refined type (\`type Email = Text matching …\`) the interface has a check, \`isEmail\`: "is a valid Email" in the spec means exactly that check. Never write your own.
10. Write plain, straightforward code. No comments needed.`;

/** Apps that call APIs (\`uses <contract> as <alias>\`). */

/**
 * The probe compiler of a twin build: it must honour everything the spec and the language say,
 * but where they still leave a real choice it takes a different reasonable reading. If its app
 * behaves differently and still passes every example, the spec is ambiguous.
 */
export const PROBE_RULES = `You are the PROBE compiler of a twin build. Another compiler builds this same spec the most obvious way. Your job is to find out whether the spec is ambiguous:
- Follow every sentence, template, example, \`always\` check and every default in §9 exactly. Never break any of them.
- Wherever the spec and the defaults together still leave a real choice (what counts as a word, how ties are ordered, what happens in an unmentioned edge case, what an unclear sentence means), deliberately take a DIFFERENT reasonable reading than the most obvious one.
- Stay reasonable: a person reading the spec should agree your reading is allowed by the text.`;

const API_CODING_RULES = `Rules that keep every build identical:
1. Model mirrors the spec's \`state\`: same names, same meaning. Add only what you truly need.
2. Each endpoint: implement its steps in order, literally. "answer 404 \\"…\\" and stop" returns \`fail(404, "…")\` at once, leaving the model unchanged. "answer 201 with X" returns \`answer(201, X)\`.
3. Bodies are exactly the declared \`returns\` type: records with their declared fields, lists in the order the steps say.
4. Where the spec is silent, apply the defaults in §9 of the language reference. Never add behaviour the spec does not ask for.
5. Every example in the spec must pass. Walk through each one step by step before you answer.
6. All rounding goes through Fmt. For every refined type the interface has a check (\`isEmail\`); "is a valid Email" means that check. Write plain, straightforward code. No comments needed.`;


/** Apis that read the clock or run recurring work. */
const API_CLOCK_RULE = `This api reads the clock: every request carries \`now\` (@now, a DateTime) and \`today\` (@today, a Date); never read the time any other way.
Each \`every <interval> { … }\` block is recurring work: export \`jobs\` typed \`Jobs<Model>\` from spec.ts, one function per block (\`every15m\` for \`every 15m\`), taking the model and the clock at its time and returning \`{ model, publish }\`. The module then exports Model, init, handlers and jobs.`;

/** Apps that read the clock: the harness hands it in; the logic never asks for the time itself. */

/** Apps with sentences in `always`: the harness checks them on the app's data, which the app hands over. */

/** Apps with `stored` state: the harness keeps it (localStorage, a file on the server) and puts it back after a restart. */

export function buildPrompt(target: Target, specFile: string, specText: string, specModule: string, probe = false, api = false, calls = false, through = false, clock = false, data = false, stored = false): string {
  const language = readFileSync(join(ROOT, "docs/LANGUAGE.md"), "utf8");
  const t = targetModule(target);
  const lang = t.fence;
  if (api)
    return `# Language reference

${language}

# ${API_TARGET_RULES}

\`\`\`ts
${API_APP_SKELETON}\`\`\`

Standard helpers (use these for all number formatting, parsing and rounding):
\`\`\`
${TARGETS.ts.prompt.fmt}
\`\`\`

${API_CODING_RULES}

# Generated interface (spec.ts)

\`\`\`ts
${specModule}\`\`\`

# The spec (${specFile})

\`\`\`intent
${specText}\`\`\`

${clock ? `# Clock\n\n${API_CLOCK_RULE}\n\n` : ""}${data ? `# Data\n\n${stored ? TARGETS.ts.prompt.stored : TARGETS.ts.prompt.data}\n\n` : ""}${probe ? `# Probe mode\n\n${PROBE_RULES}\n\n` : ""}Write app.ts now.`;
  return `# Language reference

${language}

# ${t.prompt.rules}

\`\`\`${lang}
${t.prompt.skeleton(calls, through)}\`\`\`

Standard helpers (use these for all number/time formatting and parsing):
\`\`\`
${t.prompt.fmt}
\`\`\`

${CODING_RULES}
${calls ? `\n${t.prompt.calls}${through ? `\n${t.prompt.through}` : ""}\n` : ""}${clock && !api ? `\n${t.prompt.clock}\n` : ""}${data && !api ? `\n${stored ? t.prompt.stored : t.prompt.data}\n` : ""}
# Generated interface (${t.specFile})

\`\`\`${lang}
${specModule}\`\`\`

# The spec (${specFile})

\`\`\`intent
${specText}\`\`\`

${probe ? `# Probe mode\n\n${PROBE_RULES}\n\n` : ""}Write ${t.appFile} now.`;
}

export function repairPrompt(base: string, target: Target, code: string, problems: string): string {
  const lang = targetModule(target).fence;
  return `${base}

# Your previous attempt

\`\`\`${lang}
${code}\`\`\`

# Problems with it

${problems}

Fix these problems. Reply with the complete corrected module.`;
}

/** A layer (std.http.cors, …): one module with \`before\` and \`after\`, checked by the layer's own examples. */
export function layerPrompt(specFile: string, specText: string, specModule: string, probe = false, client = false): string {
  const language = readFileSync(join(ROOT, "docs/LANGUAGE.md"), "utf8");
  return `# Language reference

${language}

# ${client ? CLIENT_LAYER_RULES : LAYER_RULES}

\`\`\`ts
${client ? CLIENT_LAYER_SKELETON : LAYER_SKELETON}\`\`\`

${client ? "In the layer's examples, `request …` is a call the screen makes, and what is seen is the call as it leaves: `see header x = …` its headers, `see body.path`, `body.method`, `body.query…`, `body.body…`. The params are those under `examples with` (defaults otherwise), changed by `given`." : "In the layer's examples, the layer runs around a stub app that answers 200 with the body \`{ \"reached\": true, …what before passed on }\`, and the params are those under \`examples with\` (defaults otherwise), changed by \`given\`."} The same module then runs in real apps with their own params: never hard-code an example's values.

# Generated interface (spec.ts)

\`\`\`ts
${specModule}\`\`\`

# The spec (${specFile})

\`\`\`intent
${specText}\`\`\`

${probe ? `# Probe mode\n\n${PROBE_RULES}\n\n` : ""}Write layer.ts now.`;
}
