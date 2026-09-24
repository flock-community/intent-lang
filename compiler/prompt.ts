// The prompt that turns the LLM into the code-generation stage of the compiler.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { ELM_APP_SKELETON, ELM_APP_SKELETON_CALLS, ELM_APP_SKELETON_THROUGH, ROOT, TS_APP_SKELETON, TS_APP_SKELETON_CALLS, TS_APP_SKELETON_THROUGH, type Target } from "./gen.ts";
import { API_APP_SKELETON, API_TARGET_RULES } from "./api.ts";
import { CLIENT_LAYER_RULES, CLIENT_LAYER_SKELETON, LAYER_RULES, LAYER_SKELETON } from "./layer.ts";

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
Fmt.cents : Float -> Int                -- whole cents, half away from zero: cents 12.345 == 1235
-- Dates ("YYYY-MM-DD") and moments ("YYYY-MM-DDTHH:MM") are Strings; compare and sort them as text.
Fmt.addDays : Date -> Int -> Date               -- addDays "2026-02-27" 2 == "2026-03-01"
Fmt.daysBetween : Date -> Date -> Int            -- daysBetween "2026-09-24" "2026-10-01" == 7
Fmt.weekday : Date -> String                     -- weekday "2026-09-24" == "Thursday"
Fmt.dateOf : DateTime -> Date                    -- dateOf "2026-09-24T09:30" == "2026-09-24"
Fmt.timeOf : DateTime -> String                  -- timeOf "2026-09-24T09:30" == "09:30"
Fmt.addMinutes : DateTime -> Int -> DateTime     -- addMinutes "2026-09-24T23:50" 15 == "2026-09-25T00:05"
Fmt.minutesBetween : DateTime -> DateTime -> Int
Fmt.formatDate : Date -> String                  -- formatDate "2026-09-04" == "4 Sep 2026"
Fmt.formatDateTime : DateTime -> String          -- formatDateTime "2026-09-04T09:05" == "4 Sep 2026 09:05"
Fmt.parseDate : String -> Maybe Date             -- only a date that exists
Fmt.parseDateTime : String -> Maybe DateTime     -- "YYYY-MM-DD HH:MM" or "YYYY-MM-DDTHH:MM"`,
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
Fmt.cents(x: number): number                        // whole cents, half away from zero: cents(12.345) === 1235
// Dates ("YYYY-MM-DD") and moments ("YYYY-MM-DDTHH:MM") are strings; compare and sort them as text.
Fmt.addDays(date, n): Date                    // addDays("2026-02-27", 2) === "2026-03-01"
Fmt.daysBetween(from, to): number             // daysBetween("2026-09-24", "2026-10-01") === 7
Fmt.weekday(date): string                     // weekday("2026-09-24") === "Thursday"
Fmt.dateOf(dateTime): Date                    // dateOf("2026-09-24T09:30") === "2026-09-24"
Fmt.timeOf(dateTime): string                  // timeOf("2026-09-24T09:30") === "09:30"
Fmt.addMinutes(dateTime, n): DateTime         // addMinutes("2026-09-24T23:50", 15) === "2026-09-25T00:05"
Fmt.minutesBetween(from, to): number
Fmt.formatDate(date): string                  // formatDate("2026-09-04") === "4 Sep 2026"
Fmt.formatDateTime(dateTime): string          // formatDateTime("2026-09-04T09:05") === "4 Sep 2026 09:05"
Fmt.parseDate(text): Date | null              // only a date that exists
Fmt.parseDateTime(text): DateTime | null      // "YYYY-MM-DD HH:MM" or "YYYY-MM-DDTHH:MM"`,
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
9. A \`table\` default in the spec is available as \`<stateName>Initial\` in the generated interface; use it in init. For every refined type (\`type Email = Text matching …\`) the interface has a check, \`isEmail\`: "is a valid Email" in the spec means exactly that check. Never write your own.
10. Write plain, straightforward code. No comments needed.`;

/** Apps that call APIs (\`uses <contract> as <alias>\`). */
const CALL_RULES = {
  elm: `Calls (this app uses an API):
- \`init\` and \`update\` also return the calls to make, in the order the steps say: \`( model, [ TicketsCreateTicket { subject = …, customer = …, priority = … } ] )\`. No step says "call": return \`[]\`.
- \`on start\`: the calls \`init\` returns. \`on answer tickets.createTicket\`: the message \`TicketsCreateTicketAnswered answer\`; the answer has one variant per status the contract declares (\`TicketsCreateTicket201 ticket\`, \`TicketsCreateTicket400 problem\`) plus \`TicketsCreateTicketFailed reason\`.
- "if its status is 201" matches that variant; "its body" is the value it carries. "otherwise" covers every other variant, Failed included.
- Every argument of a call is given; an absent optional one is \`Nothing\`.`,
  ts: `Calls (this app uses an API):
- \`init\` and \`update\` return \`{ model, calls }\`: the calls to make, in the order the steps say, as \`{ call: "tickets.createTicket", args: { subject, customer, priority } }\`. No step says "call": \`calls: []\`.
- \`on start\`: the calls \`init\` returns. \`on answer tickets.createTicket\`: the message \`{ tag: "TicketsCreateTicketAnswered", answer }\`; \`answer\` is one of the statuses the contract declares (\`{ status: 201, body: Ticket }\`, \`{ status: 400, body: Problem }\`) or \`{ status: 0, error }\` (no valid answer).
- "if its status is 201" is \`answer.status === 201\`; "its body" is \`answer.body\`. "otherwise" covers every other status, 0 included.
- Every argument of a call is given; an absent optional one is \`null\`.`,
};

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

const THROUGH_RULE = {
  elm: "- `through : Model -> Through` (exposed too): for each api with a client layer, the params bound to state under `through` in the spec, read from the model. The harness adds the config to every call and to the api's event stream.",
  ts: "- Export `through(model: Model): Through` too: for each api with a client layer, the params bound to state under `through` in the spec, read from the model. The harness adds the config to every call and to the api's event stream.",
};

/** Apis that read the clock or run recurring work. */
const API_CLOCK_RULE = `This api reads the clock: every request carries \`now\` (@now, a DateTime) and \`today\` (@today, a Date); never read the time any other way.
Each \`every <interval> { … }\` block is recurring work: export \`jobs\` typed \`Jobs<Model>\` from spec.ts, one function per block (\`every15m\` for \`every 15m\`), taking the model and the clock at its time and returning \`{ model, publish }\`. The module then exports Model, init, handlers and jobs.`;

/** Apps that read the clock: the harness hands it in; the logic never asks for the time itself. */
const CLOCK_RULE = {
  elm: `Clock (this app reads @now or @today): \`init\`, \`update\` and \`view\` take the clock as their FIRST argument: \`init : Clock -> …\`, \`update : Clock -> Msg -> Model -> …\`, \`view : Clock -> Model -> Screen\`. \`@now\` is \`clock.now\` (a DateTime), \`@today\` is \`clock.today\` (a Date). Compute with the Fmt date helpers; never store the clock in the model unless the spec says to remember a moment.`,
  ts: `Clock (this app reads @now or @today): \`init(clock)\`, \`update(msg, model, clock)\` and \`view(model, clock)\` take the clock (type \`Clock\` from spec.ts) as their LAST argument. \`@now\` is \`clock.now\` (a DateTime), \`@today\` is \`clock.today\` (a Date). Compute with the Fmt date helpers; never store the clock in the model unless the spec says to remember a moment.`,
};

/** Apps with sentences in `always`: the harness checks them on the app's data, which the app hands over. */
const DATA_RULE = {
  elm: "Data (this spec has sentences in `always`): also expose `data : Model -> Data` (the `Data` record in Spec: every state field, with the value the model holds now). The harness checks the `always` sentences on it after every step; keep it exact, never computed differently from the model.",
  ts: "Data (this spec has sentences in `always`): also export `data(model: Model): Data` (the `Data` type in spec.ts: every state field, with the value the model holds now). The harness checks the `always` sentences on it after every step; keep it exact, never computed differently from the model.",
};

/** Apps with `stored` state: the harness keeps it (localStorage, a file on the server) and puts it back after a restart. */
const STORED_RULE = {
  elm: "Stored state (this spec has `stored` fields): also expose `data : Model -> Data` and `restore : Stored -> Model -> Model`. `restore saved model` gets a freshly started model and puts the saved values of the stored fields into it; everything else stays as it starts. Anything the model keeps that depends on stored fields (a next id, a cache) must be brought in line with the restored values. The harness saves `data` after every update and restores it when the app starts again.",
  ts: "Stored state (this spec has `stored` fields): also export `data(model: Model): Data` and `restore(saved: Stored, model: Model): Model`. `restore(saved, model)` gets a freshly started model and puts the saved values of the stored fields into it; everything else stays as it starts. Anything the model keeps that depends on stored fields (a next id, a cache) must be brought in line with the restored values. The harness saves `data` after every update and restores it when the app starts again.",
};

export function buildPrompt(target: Target, specFile: string, specText: string, specModule: string, probe = false, api = false, calls = false, through = false, clock = false, data = false, stored = false): string {
  const language = readFileSync(join(ROOT, "docs/LANGUAGE.md"), "utf8");
  const lang = target === "elm" ? "elm" : "ts";
  if (api)
    return `# Language reference

${language}

# ${API_TARGET_RULES}

\`\`\`ts
${API_APP_SKELETON}\`\`\`

Standard helpers (use these for all number formatting, parsing and rounding):
\`\`\`
${FMT_API.ts}
\`\`\`

${API_CODING_RULES}

# Generated interface (spec.ts)

\`\`\`ts
${specModule}\`\`\`

# The spec (${specFile})

\`\`\`intent
${specText}\`\`\`

${clock ? `# Clock\n\n${API_CLOCK_RULE}\n\n` : ""}${data ? `# Data\n\n${stored ? STORED_RULE.ts : DATA_RULE.ts}\n\n` : ""}${probe ? `# Probe mode\n\n${PROBE_RULES}\n\n` : ""}Write app.ts now.`;
  return `# Language reference

${language}

# ${TARGET_RULES[target]}

\`\`\`${lang}
${target === "elm" ? (calls ? (through ? ELM_APP_SKELETON_CALLS.replace("exposing (Model, init, update, view)", "exposing (Model, init, through, update, view)") + ELM_APP_SKELETON_THROUGH : ELM_APP_SKELETON_CALLS) : ELM_APP_SKELETON) : calls ? TS_APP_SKELETON_CALLS.replace("import type { Call, Msg, Screen", through ? "import type { Call, Msg, Screen, Through" : "import type { Call, Msg, Screen") + (through ? TS_APP_SKELETON_THROUGH : "") : TS_APP_SKELETON}\`\`\`

Standard helpers (use these for all number/time formatting and parsing):
\`\`\`
${FMT_API[target]}
\`\`\`

${CODING_RULES}
${calls ? `\n${CALL_RULES[target]}${through ? `\n${THROUGH_RULE[target]}` : ""}\n` : ""}${clock && !api ? `\n${CLOCK_RULE[target]}\n` : ""}${data && !api ? `\n${stored ? STORED_RULE[target] : DATA_RULE[target]}\n` : ""}
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
