// Provider: any OpenAI-compatible chat completions API (OpenAI, Azure, a local server). Base URL
// from OPENAI_BASE_URL (default https://api.openai.com/v1), key from OPENAI_API_KEY. Choose it with
// `llm openai` (INTENT_LLM, --llm); the model is `model` in the options.
import type { LlmResult, Provider } from "../llm.ts";

/** US dollars per million tokens (input, output), for the models we know. Unknown: cost 0. */
const PRICES: Record<string, { in: number; out: number }> = {
  "gpt-4o": { in: 2.5, out: 10 },
  "gpt-4o-mini": { in: 0.15, out: 0.6 },
};

export function openai(model: string): Provider {
  const base = (): string => (process.env.OPENAI_BASE_URL ?? "https://api.openai.com/v1").replace(/\/$/, "");
  return {
    name: "openai",
    model,
    async complete(system: string, prompt: string): Promise<LlmResult> {
      const key = process.env.OPENAI_API_KEY;
      const t0 = Date.now();
      if (!key) return { text: "", costUsd: 0, ms: 0, error: "the openai provider needs OPENAI_API_KEY" };
      try {
        const res = await fetch(`${base()}/chat/completions`, {
          method: "POST",
          headers: { "content-type": "application/json", authorization: `Bearer ${key}` },
          body: JSON.stringify({ model, messages: [{ role: "system", content: system }, { role: "user", content: prompt }] }),
        });
        const j = (await res.json()) as { choices?: { message?: { content?: string } }[]; usage?: { prompt_tokens?: number; completion_tokens?: number }; error?: { message?: string } };
        if (!res.ok || j.error) throw new Error(j.error?.message ?? `HTTP ${res.status}`);
        const text = j.choices?.[0]?.message?.content ?? "";
        const p = PRICES[model];
        const costUsd = p ? ((j.usage?.prompt_tokens ?? 0) * p.in + (j.usage?.completion_tokens ?? 0) * p.out) / 1_000_000 : 0;
        return { text, costUsd, ms: Date.now() - t0 };
      } catch (e) {
        return { text: "", costUsd: 0, ms: Date.now() - t0, error: (e as Error).message };
      }
    },
  };
}
