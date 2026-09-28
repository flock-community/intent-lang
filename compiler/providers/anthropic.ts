// Provider: the Anthropic Messages API over HTTPS, with ANTHROPIC_API_KEY. A direct call, no CLI:
// the same contract as every provider (system and prompt in, text and cost out). Choose it with
// `llm anthropic` (INTENT_LLM, --llm); the model is `model` in the options.
import type { LlmResult, Provider } from "../llm.ts";

/** US dollars per million tokens (input, output), first-party API rates. Unknown: `unpriced`. */
const PRICES: Record<string, { in: number; out: number }> = {
  "claude-fable-5-1": { in: 10, out: 50 },
  "claude-opus-5-5": { in: 4, out: 20 },
  "claude-opus-5": { in: 5, out: 25 },
  "claude-sonnet-5": { in: 2, out: 10 },
  "claude-haiku-4-5": { in: 1, out: 5 },
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
        const j = (await res.json()) as { content?: { type: string; text?: string }[]; stop_reason?: string; usage?: { input_tokens?: number; output_tokens?: number }; error?: { message?: string } };
        if (!res.ok || j.error) throw new Error(j.error?.message ?? `HTTP ${res.status}`);
        const text = (j.content ?? []).filter((b) => b.type === "text").map((b) => b.text ?? "").join("");
        const p = PRICES[model];
        const costUsd = p ? ((j.usage?.input_tokens ?? 0) * p.in + (j.usage?.output_tokens ?? 0) * p.out) / 1_000_000 : 0;
        // A cut-off or refused answer is not code: report it rather than compile half a file.
        const error = j.stop_reason === "max_tokens" ? "the answer was cut off at max_tokens" : j.stop_reason === "refusal" ? "the model declined the request" : undefined;
        return { text: error ? "" : text, costUsd, ms: Date.now() - t0, ...(error ? { error } : {}), ...(p ? {} : { unpriced: true }) };
      } catch (e) {
        return { text: "", costUsd: 0, ms: Date.now() - t0, error: (e as Error).message };
      }
    },
  };
}
