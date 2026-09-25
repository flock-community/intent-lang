// Provider: the Anthropic Messages API over HTTPS, with ANTHROPIC_API_KEY. A direct call, no CLI:
// the same contract as every provider (system and prompt in, text and cost out). Choose it with
// `llm anthropic` (INTENT_LLM, --llm); the model is `model` in the options.
import type { LlmResult, Provider } from "../llm.ts";

/** US dollars per million tokens (input, output), for the models we know. Unknown: cost 0. */
const PRICES: Record<string, { in: number; out: number }> = {
  "claude-opus-5-5": { in: 15, out: 75 },
  "claude-sonnet-5-5": { in: 3, out: 15 },
  "claude-haiku-5-5": { in: 0.8, out: 4 },
};

export function anthropic(model: string): Provider {
  return {
    name: "anthropic",
    model,
    async complete(system: string, prompt: string): Promise<LlmResult> {
      const key = process.env.ANTHROPIC_API_KEY;
      const t0 = Date.now();
      if (!key) return { text: "", costUsd: 0, ms: 0, error: "the anthropic provider needs ANTHROPIC_API_KEY" };
      try {
        const res = await fetch("https://api.anthropic.com/v1/messages", {
          method: "POST",
          headers: { "content-type": "application/json", "x-api-key": key, "anthropic-version": "2023-06-01" },
          body: JSON.stringify({ model, max_tokens: 16000, system, messages: [{ role: "user", content: prompt }] }),
        });
        const j = (await res.json()) as { content?: { type: string; text?: string }[]; usage?: { input_tokens?: number; output_tokens?: number }; error?: { message?: string } };
        if (!res.ok || j.error) throw new Error(j.error?.message ?? `HTTP ${res.status}`);
        const text = (j.content ?? []).filter((b) => b.type === "text").map((b) => b.text ?? "").join("");
        const p = PRICES[model];
        const costUsd = p ? ((j.usage?.input_tokens ?? 0) * p.in + (j.usage?.output_tokens ?? 0) * p.out) / 1_000_000 : 0;
        return { text, costUsd, ms: Date.now() - t0 };
      } catch (e) {
        return { text: "", costUsd: 0, ms: Date.now() - t0, error: (e as Error).message };
      }
    },
  };
}
