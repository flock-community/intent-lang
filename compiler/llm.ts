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
/** The provider for this run (chosen on first use, so commands without an LLM never need one). */
export function provider(): Provider {
  const name = config().llm;
  if (!PROVIDERS[name]) throw new Error(`llm \`${name}\` is not a provider; there are: ${Object.keys(PROVIDERS).join(", ")}`);
  return (chosen ??= PROVIDERS[name](model()));
}

/** What this run has spent on the LLM so far (the `budget` option is checked against it). */
export let spentUsd = 0;

export async function complete(system: string, prompt: string): Promise<LlmResult> {
  // A run's budget (options `budget`, default 0 = no limit): once it is spent, no further call goes
  // out, so an unattended run (converge, a script) cannot spend more than was allowed.
  const budget = config().budget ?? 0;
  if (budget > 0 && spentUsd >= budget) return { text: "", costUsd: 0, ms: 0, error: `over budget ($${spentUsd.toFixed(2)} of $${budget.toFixed(2)}): raise \`budget\` or INTENT_BUDGET` };
  let p: Provider;
  try {
    p = provider();
  } catch (e) {
    return { text: "", costUsd: 0, ms: 0, error: (e as Error).message };
  }
  const r = await p.complete(system, prompt);
  spentUsd += r.costUsd;
  return r;
}

/** The code inside the last fenced block (or the whole text when there is none). */
export function extractCode(text: string): string {
  const blocks = [...text.matchAll(/```[a-zA-Z]*\n([\s\S]*?)```/g)];
  const code = blocks.length ? blocks[blocks.length - 1][1] : text;
  return code.trimEnd() + "\n";
}
