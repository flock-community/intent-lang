// Platform intent.tools (lib/intent/tools.intent): the Intent checker and the digests `intent publish`
// computes, for services about specs. Reviewed code from the installation, bundled into builds.
import { parse } from "../../../compiler/parse.ts";

import { stepText } from "../../../compiler/print.ts";
import { apiOf } from "../../../compiler/registry.ts";
import { sha } from "../../../compiler/load.ts";

export type Checked = { ok: boolean; problems: string[]; kind: string; name: string; api: string[]; examples: string[]; sha: string };

/** Check a spec (without imports) and compute what publishing it would record. */
export function check(source: string): Checked {
  const { app, diagnostics } = parse(source);
  const kind = source.match(/^\s*(app|bundle|contract|layer|platform)\s/m)?.[1] ?? "";
  const name = source.match(/^\s*(?:app|bundle|contract|layer|platform)\s+(\S+)/m)?.[1] ?? "";
  const problems = diagnostics.filter((d) => d.level === "error").map((d) => `${d.line}: ${d.message}`);
  const ok = !!app && problems.length === 0;
  return {
    ok,
    problems,
    kind,
    name,
    api: ok ? apiOf(app!) : [],
    examples: ok ? app!.examples.map((ex) => sha(ex.name + "\n" + ex.steps.map(stepText).join("\n"))) : [],
    sha: sha(source),
  };
}
