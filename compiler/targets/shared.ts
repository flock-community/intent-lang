// What every target shares: the installation and project folders, naming, the events a screen
// has, the app's data, the client layers' composition, and the page around a build.
import { copyFileSync, existsSync, mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import type { App, Element, Literal } from "../ast.ts";
import { STYLE } from "../../runtime/ts/ui.ts";
import { literalJson, typeDesc } from "../api.ts";
import { throughs } from "../calls.ts";

export type Target = "elm" | "ts";

export const ROOT = join(dirname(fileURLToPath(import.meta.url)), "../.."); // the Intent installation

/**
 * The user's project: the nearest folder (from where the command runs) with an intent.project or
 * intent.lock; without one, the folder the command runs in (a new project: `intent lock` starts
 * its lock there). Never the installation by accident: its lock and cache are its own. The
 * project's lib/, intent.lock, intent.project and .intent/ belong to the project; the language
 * reference, runtimes and standard library come from the Intent installation (ROOT).
 */
export const PROJECT_ROOT = (() => {
  for (let d = process.cwd(); ; d = dirname(d)) {
    if (existsSync(join(d, "intent.project")) || existsSync(join(d, "intent.lock"))) return d;
    if (dirname(d) === d) return process.cwd();
  }
})();

export const cap = (s: string) => s[0].toUpperCase() + s.slice(1);

// Names of component instances are qualified (`pager.next`): a record field uses the last part,
// a type or event tag joins all parts (`PagerNext`).
export const ident = (name: string) => name.slice(name.lastIndexOf(".") + 1);

export const typeName = (name: string) => name.split(".").map(cap).join("");

export const lowerFirst = (s: string) => s[0].toLowerCase() + s.slice(1);

export const q = (s: string) => JSON.stringify(s);

export interface EventDef {
  tag: string;
  on: "click" | "toggle" | "input" | "choose" | "tick";
  target: string; // wire target, "list.name" inside rows
  payload?: "key" | "text" | "value" | "pick";
  choice?: string;
}

export function events(app: App): EventDef[] {
  const out: EventDef[] = [];
  const stateType = (n: string) => app.state.find((f) => f.name === n)?.type;
  const walk = (els: Element[], list?: Element) => {
    for (const el of els) {
      if (el.kind === "heading") continue;
      const prefix = list ? typeName(list.name) + typeName(el.name) : typeName(el.name);
      const target = list ? `${list.name}.${el.name}` : el.name;
      if (el.kind === "button") out.push({ tag: prefix + "Clicked", on: "click", target, payload: list ? "key" : undefined });
      if (el.kind === "checkbox") out.push({ tag: prefix + "Toggled", on: "toggle", target, payload: list ? "key" : undefined });
      if (el.kind === "field") out.push({ tag: prefix + "Typed", on: "input", target, payload: "text" });
      if (el.kind === "select" && el.from) out.push({ tag: prefix + "Chosen", on: "choose", target, payload: "pick" });
      else if (el.kind === "select") {
        const t = stateType(el.name);
        out.push({ tag: prefix + "Chosen", on: "choose", target, payload: "value", choice: t?.k === "Named" ? t.name : "" });
      }
      if (el.kind === "list") walk(el.children, el);
      if (el.kind === "section") walk(el.children, list);
    }
  };
  walk(app.screen);
  if (app.clockMs) out.push({ tag: "Tick", on: "tick", target: "" });
  // Two screens may reuse an element name (`back` on both): the handler belongs to the name, so one
  // event covers both.
  const seen = new Set<string>();
  return out.filter((e) => !seen.has(e.tag) && (seen.add(e.tag), true));
}

export function selectChoice(app: App, el: Element): string {
  const t = app.state.find((f) => f.name === el.name)!.type;
  return (t as { name: string }).name;
}

export type TableLit = Extract<Literal, { k: "table" }>;

export const cellFor = (t: TableLit, row: Literal[], col: string): Literal | undefined => row[t.columns.indexOf(col)];

/** Apps with sentences in `always`: the harness checks them on the app's data after every step. */
export const hasInvariants = (app: App) => !!app.invariants?.length;
/** Several screens, with addresses (`screen <name> "<path>"`). */
export const hasScreens = (app: App) => !!app.screens?.length;

/** State that survives a restart (`stored name: T = …`). */
export const hasStored = (app: App) => app.state.some((f) => f.stored);

/** The app hands over its data: for the checks in `always`, and to save its stored state. */
export const hasData = (app: App) => hasInvariants(app) || hasStored(app) || (app.layers ?? []).some((l) => l.bindings.some((b) => b.state));

/** A state field's name in the data: `pager.page` → `pagerPage`. */
export const dataField = (name: string) => name.replace(/\.([a-z])/g, (_, c: string) => c.toUpperCase());

export const storedTypes = (app: App) => app.state.filter((f) => f.stored).map((f) => `${dataField(f.name)}: ${typeDesc(app, f.type)}`).join(", ");

/** The spec's defaults for the stored fields, as JSON: what a field that cannot be migrated keeps. */
export const storedDefaults = (app: App) => app.state.filter((f) => f.stored).map((f) => `${dataField(f.name)}: ${JSON.stringify(f.default?.k === "table" ? [] : literalJson(f.default ?? { k: "nothing" }))}`).join(", ");

/** The client layers of an app's apis (\`through\` under \`uses\`), with their fixed params: used in the browser and in tests. */
export function genThrough(app: App): string {
  const th = throughs(app);
  return `// Generated — do not edit. Each api's client layer, as verified once for its layer spec.
import type { Outgoing } from "./calls.ts";
${th.map((t) => `import * as ${t.alias} from "./layers/${t.alias}/layer.ts";`).join("\n")}

const layers: Record<string, { before: (req: any, config: any) => any; fixed: Record<string, unknown> }> = {
${th.map((t) => `  ${t.alias}: { before: ${t.alias}.before, fixed: ${JSON.stringify(t.fixed)} },`).join("\n")}
};

const lower = (h: Record<string, string>) => Object.fromEntries(Object.entries(h ?? {}).map(([k, v]) => [k.toLowerCase(), String(v)]));

/** A call as it leaves through its api's client layer; config is what the app's state gives the layer. */
export function apply(alias: string, req: Outgoing, config: Record<string, unknown> | undefined): Outgoing {
  const l = layers[alias];
  if (!l) return req;
  const out = l.before(JSON.parse(JSON.stringify(req)), { ...l.fixed, ...(config ?? {}) });
  return { ...out, headers: lower(out.headers) };
}
`;
}

/** Apps that call apis: the client layers' verified modules (built once per layer spec) and their composition. */
export function writeThrough(app: App, dir: string, layerDirs: Record<string, string>) {
  for (const t of throughs(app)) {
    mkdirSync(join(dir, "layers", t.alias), { recursive: true });
    for (const f of ["layer.ts", "spec.ts", "http.ts", "fmt.ts"]) copyFileSync(join(layerDirs[t.alias], f), join(dir, "layers", t.alias, f));
  }
  writeFileSync(join(dir, "through.ts"), genThrough(app));
}

export function html(title: string, scripts: string, elm: boolean): string {
  const style = elm ? `<style>${STYLE}</style>` : "";
  return `<!doctype html>\n<html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${title}</title>${style}</head>\n<body><div id="app"></div>${scripts}</body></html>\n`;
}
