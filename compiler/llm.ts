// The LLM behind every compiler stage, as a provider module: one pure call, system prompt and
// prompt in, text and cost out. A provider changes how code is produced, never what counts as
// correct (the examples, `always` rules and twin builds decide that). Which provider and model:
// `llm` and `model` in the compiler's options (config.ts).
import { claudeCli } from "./providers/claude-cli.ts";
import { anthropic } from "./providers/anthropic.ts";
import { openai } from "./providers/openai.ts";
import { config } from "./config.ts";

export interface LlmResult {
  text: string;
  costUsd: number;
  ms: number;
  error?: string;
  unpriced?: boolean; // the provider does not know this model's price: its cost counts as 0
}

export interface Provider {
  name: string;
  model: string;
  complete(system: string, prompt: string): Promise<LlmResult>;
}

/** The providers there are, by name. A new one is a module in providers/ and a line here. */
const PROVIDERS: Record<string, (model: string) => Provider> = {
  "claude-cli": claudeCli,
  anthropic,
  openai,
};

/** The model this run compiles with (pinned in intent.lock). */
export const model = (): string => config().model;

let chosen: Provider | undefined;
/** The provider for a call (chosen on first use, so commands without an LLM never need one). */
export function provider(name = config().llm, modelName = model()): Provider {
  if (!PROVIDERS[name]) throw new Error(`llm \`${name}\` is not a provider; there are: ${Object.keys(PROVIDERS).join(", ")}`);
  if (name === config().llm && modelName === model()) return (chosen ??= PROVIDERS[name](modelName));
  return PROVIDERS[name](modelName);
}

/** What this run has spent on the LLM so far (the `budget` option is checked against it). */
export let spentUsd = 0;

export async function complete(system: string, prompt: string, probe = false): Promise<LlmResult> {
  // A run's budget (options `budget`, default 0 = no limit): once it is spent, no further call goes
  // out, so an unattended run (converge, a script) cannot spend more than was allowed.
  const budget = config().budget ?? 0;
  if (budget > 0 && spentUsd >= budget) return { text: "", costUsd: 0, ms: 0, error: `over budget ($${spentUsd.toFixed(2)} of $${budget.toFixed(2)}): raise \`budget\` or INTENT_BUDGET` };
  let p: Provider;
  try {
    const c = config();
    // A probe from another vendor, when one is set: a second, independent reading.
    p = probe && c.probeLlm ? provider(c.probeLlm, c.probeModel || c.model) : provider();
  } catch (e) {
    return { text: "", costUsd: 0, ms: 0, error: (e as Error).message };
  }
  const r = await p.complete(system, prompt);
  spentUsd += r.costUsd;
  // A budget cannot hold over a model whose price is unknown: say so instead of counting it as free.
  if (budget > 0 && r.unpriced && !r.error) return { ...r, text: "", error: `the price of ${p.name} model \`${p.model}\` is unknown, so the budget cannot be kept: add it to the provider's price table, or set budget 0` };
  return r;
}

/** The code inside the last fenced block (or the whole text when there is none). */
export function extractCode(text: string): string {
  const blocks = [...text.matchAll(/```[a-zA-Z]*\n([\s\S]*?)```/g)];
  const code = blocks.length ? blocks[blocks.length - 1][1] : text;
  return code.trimEnd() + "\n";
}
