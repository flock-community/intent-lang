// The LLM behind every compiler stage, as a provider module: one pure call, system prompt and
// prompt in, text and cost out. A provider changes how code is produced, never what counts as
// correct (the examples, `always` rules and twin builds decide that). Which provider and model:
// `llm` and `model` in the compiler's options (config.ts).
import { claudeCli } from "./providers/claude-cli.ts";
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

export async function complete(system: string, prompt: string): Promise<LlmResult> {
  let p: Provider;
  try {
    p = provider();
  } catch (e) {
    return { text: "", costUsd: 0, ms: 0, error: (e as Error).message };
  }
  return p.complete(system, prompt);
}

/** The code inside the last fenced block (or the whole text when there is none). */
export function extractCode(text: string): string {
  const blocks = [...text.matchAll(/```[a-zA-Z]*\n([\s\S]*?)```/g)];
  const code = blocks.length ? blocks[blocks.length - 1][1] : text;
  return code.trimEnd() + "\n";
}
