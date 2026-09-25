// Profiles are specs: the element kinds of a kind of software, what each shows, the verbs people
// perform on it, its presentations and their meanings. The checker reads the profile instead of
// hard-coding the vocabulary (docs/design/profiles.md).
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { ROOT } from "./gen.ts";
import { fromBraces } from "./braces.ts";
import type { Diagnostic } from "./ast.ts";

export interface ProfileElement {
  kind: string;
  meaning: string;
  shows: { name: string; type: string }[];
  edits?: string; // the state type it binds (built-in assignment)
  verbs: { name: string; meaning: string }[];
  modifiers: string[];
  presentations: { name: string; meaning: string }[];
  line: number;
}

export interface Profile {
  name: string;
  purpose: string;
  elements: ProfileElement[];
  clockVerbs: { name: string; meaning: string }[];
  line: number;
}

const str = (s: string) => JSON.parse(s) as string;

export function parseProfile(text: string, file = "profile"): Profile {
  const p: Profile = { name: "", purpose: "", elements: [], clockVerbs: [], line: 1 };
  let el: ProfileElement | undefined;
  let inClock = false;
  fromBraces(text).text.split("\n").forEach((raw, i) => {
    const line = raw.replace(/\s+#.*$/, "").trimEnd();
    if (!line.trim() || line.trim().startsWith("#")) return;
    const indented = /^\s/.test(line);
    const t = line.trim();
    let m: RegExpMatchArray | null;
    const fail = () => {
      throw new Error(`${file}:${i + 1}: not a profile line: ${t}`);
    };
    if (!indented) {
      el = undefined;
      inClock = false;
      if ((m = t.match(/^profile\s+([a-z][\w.]*)$/))) (p.name = m[1]), (p.line = i + 1);
      else if ((m = t.match(/^element\s+([a-z]+)\s+("(?:[^"\\]|\\.)*")$/))) {
        el = { kind: m[1], meaning: str(m[2]), shows: [], verbs: [], modifiers: [], presentations: [], line: i + 1 };
        p.elements.push(el);
      } else if (t === "clock") inClock = true;
      else fail();
    } else if (!el && !inClock && /^"/.test(t)) p.purpose = str(t);
    else if (inClock && (m = t.match(/^verb\s+([a-z]+)\s+("(?:[^"\\]|\\.)*")$/))) p.clockVerbs.push({ name: m[1], meaning: str(m[2]) });
    else if (!el) fail();
    else if ((m = t.match(/^shows\s+([a-z]\w*)\s*:\s*(.+)$/))) el.shows.push({ name: m[1], type: m[2] });
    else if ((m = t.match(/^edits\s+(\w+)$/))) el.edits = m[1];
    else if ((m = t.match(/^verb\s+([a-z]+)\s+("(?:[^"\\]|\\.)*")$/))) el.verbs.push({ name: m[1], meaning: str(m[2]) });
    else if ((m = t.match(/^modifier\s+(.+)$/))) el.modifiers.push(m[1]);
    else if ((m = t.match(/^presentation\s+([a-z]+)\s+("(?:[^"\\]|\\.)*")$/))) el.presentations.push({ name: m[1], meaning: str(m[2]) });
    else fail();
  });
  return p;
}

let cached: Profile | undefined;
// Bundled into a service (platform intent.tools) there is no installation to read the profile from:
// the build puts its text in here (esbuild --define). Run from the installation, it is not defined.
declare const INTENT_UI_PROFILE: string | undefined;
const bundled = typeof INTENT_UI_PROFILE === "string" ? INTENT_UI_PROFILE : undefined;

/** The UI profile, from the Intent installation (or the text bundled in). */
export function uiProfile(): Profile {
  return (cached ??= parseProfile(bundled ?? readFileSync(join(ROOT, "lib/profile/ui.intent"), "utf8"), "lib/profile/ui.intent"));
}

/** verb → element kind, for `on <verb> <element>` and example steps. */
export function verbKinds(p: Profile): Record<string, string> {
  return Object.fromEntries(p.elements.flatMap((e) => e.verbs.map((v) => [v.name, e.kind])));
}

/** A profile file is a spec too: `intent check` reports what is wrong with it. */
export function checkProfile(text: string, file: string): Diagnostic[] {
  let p: Profile;
  try {
    p = parseProfile(text, file);
  } catch (e) {
    const m = /^([^:]+):(\d+): (.*)$/.exec((e as Error).message);
    return [{ level: "error", code: "PROFILE", line: m ? Number(m[2]) : 1, col: 1, message: m ? m[3] : (e as Error).message }];
  }
  const diags: Diagnostic[] = [];
  if (!p.name) diags.push({ level: "error", code: "PROFILE", line: p.line, col: 1, message: "a profile starts with `profile <name>`" });
  const kinds = new Set<string>();
  for (const el of p.elements) {
    if (kinds.has(el.kind)) diags.push({ level: "error", code: "DUPLICATE", line: el.line, col: 1, message: `element kind \`${el.kind}\` is declared twice` });
    kinds.add(el.kind);
    const pres = new Set<string>();
    for (const pr of el.presentations) {
      if (pres.has(pr.name)) diags.push({ level: "error", code: "DUPLICATE", line: el.line, col: 1, message: `presentation \`${pr.name}\` is declared twice on \`${el.kind}\`` });
      pres.add(pr.name);
    }
  }
  if (!p.elements.length) diags.push({ level: "error", code: "PROFILE", line: p.line, col: 1, message: "a profile declares at least one `element`" });
  return diags;
}
