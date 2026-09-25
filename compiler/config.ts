// How the compiler runs: the LLM, the targets, twin builds and their sessions, repairs.
// Each option comes from, in order: a command-line flag, the environment, the `compiler { … }`
// block in intent.project, the default. Keys (ANTHROPIC_API_KEY, …) never go in a file: they
// stay in the environment, read by the provider itself. `intent config` shows the result.
import { readProject } from "./registry.ts";

export type Twin = "auto" | "always" | "off";

export interface CompilerConfig {
  llm: string; // the provider (compiler/providers/)
  model: string;
  targets?: string[]; // the targets `build` makes; unset: elm,ts for screens, ts for services
  twin: Twin; // auto: twin unless a verified build is cached; always; off
  sessions: number; // random sessions that compare a twin build
  length: number; // steps per session
  repairs: number; // how often a build that fails its checks goes back to the compiler with the problems
}

export const DEFAULTS: CompilerConfig = { llm: "claude-cli", model: "claude-opus-5-5", twin: "auto", sessions: 24, length: 20, repairs: 3 };

/** The option names, what each takes, and its environment variable. */
export const OPTIONS: Record<keyof CompilerConfig, { takes: string; env?: string }> = {
  llm: { takes: "a provider name", env: "INTENT_LLM" },
  model: { takes: "a model name", env: "INTENT_MODEL" },
  targets: { takes: "targets separated by commas (elm, ts)", env: "INTENT_TARGETS" },
  twin: { takes: "auto, always or off", env: "INTENT_TWIN" },
  sessions: { takes: "a whole number, at least 1", env: "INTENT_SESSIONS" },
  length: { takes: "a whole number, at least 1", env: "INTENT_LENGTH" },
  repairs: { takes: "a whole number, 0 or more", env: "INTENT_REPAIRS" },
};

export type Source = "flag" | "environment" | "intent.project" | "default";

let flags: Record<string, string> = {};
let resolved: { config: CompilerConfig; from: Record<keyof CompilerConfig, Source> } | undefined;

/** The command line's flags (`--model`, `--twin`, …): they win over everything else. */
export function setFlags(f: Record<string, string>) {
  flags = f;
  resolved = undefined;
}

function parse(key: keyof CompilerConfig, raw: string, where: string): CompilerConfig[keyof CompilerConfig] {
  const bad = () => new Error(`${where}: \`${key}\` takes ${OPTIONS[key].takes}, not \`${raw}\``);
  switch (key) {
    case "twin":
      if (!["auto", "always", "off"].includes(raw)) throw bad();
      return raw as Twin;
    case "sessions":
    case "length": {
      const n = Number(raw);
      if (!Number.isInteger(n) || n < 1) throw bad();
      return n;
    }
    case "repairs": {
      const n = Number(raw);
      if (!Number.isInteger(n) || n < 0) throw bad();
      return n;
    }
    case "targets": {
      const ts = raw.split(/\s*,\s*/).filter(Boolean);
      if (!ts.length || ts.some((t) => !["elm", "ts"].includes(t))) throw bad();
      return ts;
    }
    default:
      if (!raw.trim()) throw bad();
      return raw.trim();
  }
}

/** The options for this run, and where each came from. */
export function configWithSources(): { config: CompilerConfig; from: Record<keyof CompilerConfig, Source> } {
  if (resolved) return resolved;
  const file = readProject()?.compiler ?? {};
  const config = { ...DEFAULTS } as CompilerConfig;
  const from = {} as Record<keyof CompilerConfig, Source>;
  for (const key of Object.keys(OPTIONS) as (keyof CompilerConfig)[]) {
    const flag = flags[key === "targets" ? "target" : key] ?? flags[key];
    const env = OPTIONS[key].env ? process.env[OPTIONS[key].env!] : undefined;
    const [raw, source, where] = flag !== undefined ? [flag, "flag", `--${key}`] : env !== undefined ? [env, "environment", OPTIONS[key].env!] : file[key] !== undefined ? [file[key], "intent.project", "intent.project"] : [undefined, "default", ""];
    if (raw !== undefined) (config as any)[key] = parse(key, raw, where);
    from[key] = source as Source;
  }
  return (resolved = { config, from });
}

export const config = (): CompilerConfig => configWithSources().config;
