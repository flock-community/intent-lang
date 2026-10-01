// A theme (1.1, docs/design/look.md): how every app looks, apart from every app. A theme spec says the
// look in words (and may bring W3C design tokens); the model writes a skin — one stylesheet for the
// plain renderer's DOM, keyed only on the contract (element classes, data-as, data-tone,
// data-component, data-part, states) — and the harness verifies it in a real browser on a gallery
// of every element kind, presentation, tone and state: everything visible, readable contrast
// (WCAG 2.2 1.4.3 / 1.4.11), presentations and tones that can be told apart, a visible focus
// (2.4.7), a dialog over the page, and colours only from tokens. A host switches themes by
// switching the stylesheet; no app is rebuilt.
import { copyFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { build } from "esbuild";
import { complete, extractCode } from "./llm.ts";
import { uiProfile } from "./profile.ts";
import { getBrowser } from "./browser.ts";
import { ROOT } from "./gen.ts";
import { TONES } from "./parse.ts";
import type { Node } from "../runtime/ts/ui.ts";

export interface ThemeSpec {
  name: string;
  look: string[];
  language?: string;
  tokens?: { file: string; flat: Record<string, string> }; // W3C design tokens (DTCG), flattened to --names
}

/** `theme stad { "…" }`, `language 1.1`, optional `tokens "stad.tokens.json"`. */
export function parseTheme(file: string): { theme?: ThemeSpec; errors: string[] } {
  const text = readFileSync(file, "utf8");
  const errors: string[] = [];
  const head = text.match(/^theme\s+([a-z][\w-]*)\s*\{([\s\S]*?)\n\}/m);
  if (!head) return { errors: ['a theme starts with `theme <name> {`, its look in "strings", and `}`'] };
  const look = [...head[2].matchAll(/"((?:[^"\\]|\\.)*)"/g)].map((m) => JSON.parse(`"${m[1]}"`));
  if (!look.length) errors.push("a theme says its look in words: one or more \"strings\" in its block");
  const language = text.match(/^language\s+(\S+)\s*$/m)?.[1];
  const tok = text.match(/^tokens\s+"([^"]+)"\s*$/m)?.[1];
  let tokens: ThemeSpec["tokens"];
  if (tok) {
    const path = resolve(dirname(file), tok);
    if (!existsSync(path)) errors.push(`no tokens file ${tok}`);
    else tokens = { file: path, flat: flattenTokens(JSON.parse(readFileSync(path, "utf8"))) };
  }
  return { theme: { name: head[1], look, language, tokens }, errors };
}

/** W3C design tokens (DTCG): every `$value`, by its path (`color.surface.raised` → `--color-surface-raised`); `{a.b}` references resolved. */
export function flattenTokens(doc: unknown): Record<string, string> {
  const raw: Record<string, unknown> = {};
  const walk = (v: unknown, path: string[]) => {
    if (!v || typeof v !== "object") return;
    const o = v as Record<string, unknown>;
    if ("$value" in o) raw[path.join(".")] = o.$value;
    for (const [k, x] of Object.entries(o)) if (!k.startsWith("$")) walk(x, [...path, k]);
  };
  walk(doc, []);
  const value = (v: unknown, depth = 0): string => {
    if (typeof v === "string") return v.replace(/\{([^}]+)\}/g, (_, ref: string) => (depth < 8 && ref in raw ? value(raw[ref], depth + 1) : `{${ref}}`));
    if (typeof v === "number") return String(v);
    if (v && typeof v === "object" && "hex" in (v as object)) return String((v as { hex: string }).hex); // DTCG 2025 colour object
    return JSON.stringify(v);
  };
  return Object.fromEntries(Object.entries(raw).map(([k, v]) => [`--${k.replace(/\./g, "-")}`, value(v)]));
}

// ---------------------------------------------------------------- the gallery

/** One screen with every element kind, presentation, tone and state a skin must draw. */
export function gallery(): Node {
  const profile = uiProfile();
  const pres = (kind: string) => profile.elements.find((e) => e.kind === kind)?.presentations.map((p) => p.name) ?? [];
  const c: Node[] = [{ k: "heading", v: "Buttons" }];
  for (const p of pres("button")) c.push({ k: "button", n: `button-${p}`, label: p === "icon" ? "+" : `${p[0].toUpperCase()}${p.slice(1)}`, enabled: true, as: p });
  c.push({ k: "button", n: "button-plain", label: "Plain", enabled: true }, { k: "button", n: "button-disabled", label: "Disabled", enabled: false, as: "primary" });
  c.push({ k: "heading", v: "Texts" }, { k: "text", n: "text-plain", v: "A plain text, as most of an app is." });
  for (const p of pres("text")) c.push({ k: "text", n: `text-${p}`, v: p === "avatar" ? "AB" : p === "stat" ? "1,240" : `A ${p}`, as: p });
  c.push({ k: "heading", v: "Tones" });
  for (const t of TONES) c.push({ k: "text", n: `tone-${t}`, v: `Tone ${t}`, tone: t }, { k: "text", n: `badge-${t}`, v: t, as: "badge", tone: t });
  c.push({ k: "heading", v: "Fields" }, { k: "field", n: "field-plain", label: "Name", v: "Ann" });
  for (const p of pres("field")) c.push({ k: "field", n: `field-${p}`, label: p === "search" ? "Search" : `A ${p}`, v: "", as: p });
  c.push({ k: "checkbox", n: "checkbox-on", label: "Checked", checked: true }, { k: "checkbox", n: "checkbox-off", label: "Not checked", checked: false });
  for (const p of pres("checkbox")) c.push({ k: "checkbox", n: `checkbox-${p}`, label: `As ${p}`, checked: true, as: p });
  c.push({ k: "heading", v: "Choices" }, { k: "select", n: "select-plain", label: "Level", options: ["Low", "High"], v: "High" });
  for (const p of pres("select")) c.push({ k: "select", n: `select-${p}`, label: `As ${p}`, options: ["One", "Two", "Three"], v: "Two", as: p });
  c.push({ k: "heading", v: "Progress" }, { k: "progress", n: "progress-plain", label: "Done", v: 40 });
  for (const p of pres("progress")) c.push({ k: "progress", n: `progress-${p}`, label: `As ${p}`, v: 70, as: p });
  c.push({ k: "heading", v: "Lists" });
  const rows = (n: string) => [1, 2].map((i) => ({ key: String(i), c: [{ k: "text", n: "name", v: `Row ${i}` }, { k: "text", n: "state", v: i === 1 ? "open" : "done", as: "badge", tone: i === 1 ? "warning" : "success" }, { k: "button", n: "remove", label: "Remove", enabled: true, as: "ghost" }] as Node[] }));
  c.push({ k: "list", n: "list-plain", rows: rows("plain") });
  for (const p of pres("list")) c.push({ k: "list", n: `list-${p}`, rows: rows(p), as: p });
  c.push({ k: "heading", v: "Sections" });
  for (const p of pres("section").filter((p) => p !== "dialog" && p !== "drawer" && p !== "sidebar" && p !== "main"))
    c.push({ k: "section", n: `section-${p}`, label: `A ${p}`, as: p, c: [{ k: "text", n: "inside", v: `Inside a ${p}` }, { k: "button", n: "act", label: "Act", enabled: true, as: "secondary" }] });
  // A component's parts, and a dialog open over everything.
  c.push({ k: "section", n: "pager", label: "", component: "Pager", c: [{ k: "text", n: "pager.pageInfo", v: "Page 1 of 3", part: "pageInfo" }, { k: "button", n: "pager.next", label: "Next", enabled: true, as: "secondary", part: "next" }] });
  // A component whose dialog is closed: its root is there, with nothing in it. It must draw nothing.
  c.push({ k: "section", n: "closed", label: "", component: "Dialog", c: [] });
  c.push({ k: "section", n: "ask", label: "", as: "dialog", c: [{ k: "text", n: "ask-title", v: "Delete this ticket?", as: "title" }, { k: "text", n: "ask-body", v: "This cannot be undone." }, { k: "button", n: "ask-delete", label: "Delete", enabled: true, as: "danger" }, { k: "button", n: "ask-keep", label: "Keep", enabled: true, as: "secondary" }] });
  return { k: "screen", title: "Gallery", c };
}

/** The gallery page with a skin: the plain renderer (no default style), the skin as a stylesheet. */
async function galleryPage(dir: string, skin: string, withDialog: boolean) {
  const screen = gallery();
  if (!withDialog) (screen as { c: Node[] }).c = (screen as { c: Node[] }).c.filter((n) => !("n" in n && n.n === "ask"));
  writeFileSync(join(dir, "skin.css"), skin);
  await build({
    stdin: { contents: `import { mount } from ${JSON.stringify(join(ROOT, "runtime/ts/ui.ts"))};\nmount(document.getElementById("app")!, { init: () => 0, step: (_w, m) => m, render: () => (${JSON.stringify(screen)}) as any });`, loader: "ts", resolveDir: ROOT },
    bundle: true, format: "iife", outfile: join(dir, "gallery.js"), logLevel: "error",
  });
  writeFileSync(join(dir, withDialog ? "gallery.html" : "gallery-page.html"), `<!doctype html><html><head><meta charset="utf-8"><link rel="stylesheet" href="skin.css" data-intent-skin></head><body><div id="app"></div><script src="gallery.js"></script></body></html>`);
}

// ---------------------------------------------------------------- the checks

/** What is wrong with a skin's text itself: colours outside tokens, outside resources, scripts. */
export function staticProblems(css: string): string[] {
  const out: string[] = [];
  const src = css.replace(/\/\*[\s\S]*?\*\//g, "");
  if (/@import|url\s*\(/i.test(src)) out.push("no @import or url(…): a skin brings nothing from outside");
  if (/<script|javascript:|expression\s*\(/i.test(src)) out.push("no script in a skin");
  const literal = /#[0-9a-f]{3,8}\b|\b(?:rgba?|hsla?|oklch|oklab|lab|lch|hwb|color)\s*\(/i;
  for (const decl of src.split(/[;{}]/)) {
    const m = decl.match(/^\s*([-\w]+)\s*:(.*)$/s);
    if (!m || m[1].startsWith("--")) continue; // a token's definition may hold a literal colour
    if (literal.test(m[2].replace(/var\([^)]*\)/g, ""))) out.push(`\`${m[1].trim()}: ${m[2].trim().slice(0, 60)}\`: a colour outside a token; define it once as a --token and use var(--token)`);
  }
  return [...new Set(out)].slice(0, 12);
}

/** Checks on the rendered gallery (in the page): returns what is wrong. */
function pageChecks(): string[] {
  const out: string[] = [];
  const rgba = (s: string): [number, number, number, number] => {
    const m = s.match(/rgba?\(([^)]+)\)/);
    if (!m) return [0, 0, 0, 0];
    const p = m[1].split(/[\s,/]+/).filter(Boolean).map(Number);
    return [p[0], p[1], p[2], p.length > 3 ? p[3] : 1];
  };
  const lum = ([r, g, b]: number[]) => {
    const f = (c: number) => ((c /= 255) <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
    return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b);
  };
  const ratio = (a: number[], b: number[]) => {
    const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p);
    return (x + 0.05) / (y + 0.05);
  };
  // The colour behind an element: its own background, else its ancestors', composed over white.
  const behind = (el: Element): number[] => {
    const layers: number[][] = [];
    for (let e: Element | null = el; e; e = e.parentElement) {
      const c = rgba(getComputedStyle(e).backgroundColor);
      if (c[3] > 0) layers.push(c);
      if (c[3] >= 1) break;
    }
    let base = [255, 255, 255];
    for (const c of layers.reverse()) base = base.map((v, i) => v * (1 - c[3]) + c[i] * c[3]);
    return base;
  };
  const visible = (el: Element) => (el as any).checkVisibility({ checkOpacity: true, checkVisibilityCSS: true }) && el.getBoundingClientRect().width > 0 && el.getBoundingClientRect().height > 0;
  const els = Array.from(document.querySelectorAll<HTMLElement>("[data-el]"));
  for (const el of els) if (!visible(el) && el.dataset.el !== "closed") out.push(`\`${el.dataset.el}\` is not visible (every element of the gallery must be drawn)`);
  // Readable text (WCAG 1.4.3): 4.5:1, 3:1 for large text; disabled controls are exempt.
  for (const el of els) {
    if (!visible(el) || (el as HTMLButtonElement).disabled || !el.textContent?.trim()) continue;
    const cs = getComputedStyle(el);
    const size = parseFloat(cs.fontSize);
    const large = size >= 24 || (size >= 18.66 && Number(cs.fontWeight) >= 700);
    const r = ratio(rgba(cs.color), behind(el));
    if (r < (large ? 3 : 4.5)) out.push(`\`${el.dataset.el}\`: text contrast ${r.toFixed(2)}:1, needs ${large ? 3 : 4.5}:1 (WCAG 1.4.3)`);
  }
  // Presentations and tones that can be told apart.
  const look = (sel: string) => {
    const el = document.querySelector<HTMLElement>(sel);
    if (!el) return "";
    const cs = getComputedStyle(el);
    return [cs.color, cs.backgroundColor, cs.borderTopColor, cs.borderTopWidth, cs.textDecorationLine, cs.fontWeight].join("|");
  };
  const distinct = (what: string, sels: string[]) => {
    const looks = sels.map(look);
    for (let i = 0; i < sels.length; i++) for (let j = i + 1; j < sels.length; j++) if (looks[i] && looks[i] === looks[j]) out.push(`${what}: \`${sels[i]}\` and \`${sels[j]}\` look the same; each has its own meaning`);
  };
  distinct("buttons", ['[data-el="button-primary"]', '[data-el="button-secondary"]', '[data-el="button-danger"]', '[data-el="button-ghost"]', '[data-el="button-link"]']);
  distinct("tones", ["neutral", "info", "success", "warning", "danger"].map((t) => `[data-el="badge-${t}"]`));
  distinct("tones", ["info", "success", "warning", "danger"].map((t) => `[data-el="tone-${t}"]`));
  // A component's root is only a group: empty (its dialog closed), it draws nothing.
  const closed = document.querySelector<HTMLElement>('[data-el="closed"]');
  if (closed) {
    const cs = getComputedStyle(closed);
    const r = closed.getBoundingClientRect();
    if (r.height > 2 || rgba(cs.backgroundColor)[3] > 0 || (cs.boxShadow && cs.boxShadow !== "none") || parseFloat(cs.borderTopWidth) > 0 || cs.position === "fixed")
      out.push("a component's root (`[data-component]`) is only a group: with nothing in it (a Dialog whose dialog is closed) it must draw nothing; draw a dialog by `[data-as=\"dialog\"]`, never by the component's name");
  }
  // A dialog is over the page.
  const dialog = document.querySelector<HTMLElement>('[data-el="ask"]');
  if (dialog && !["fixed", "absolute"].includes(getComputedStyle(dialog).position)) out.push("a section shown as dialog must be over the page (position fixed), with a backdrop behind it");
  return out;
}

/** Focus can be seen (WCAG 2.4.7): a button's outline or shadow changes when it has the keyboard's focus. */
async function focusProblems(page: import("playwright").Page): Promise<string[]> {
  const sel = '[data-el="button-secondary"]';
  const before = await page.$eval(sel, (el) => { const s = getComputedStyle(el); return [s.outlineStyle, s.outlineWidth, s.outlineColor, s.boxShadow].join("|"); });
  await page.focus(sel);
  await page.keyboard.press("Shift"); // a keyboard focus (focus-visible)
  const after = await page.$eval(sel, (el) => { const s = getComputedStyle(el); return [s.outlineStyle, s.outlineWidth, s.outlineColor, s.boxShadow].join("|"); });
  return before === after || /^none\|/.test(after) ? ["a focused button looks like an unfocused one: give :focus-visible a clear outline or ring (WCAG 2.4.7)"] : [];
}

export async function verifySkin(dir: string, skin: string): Promise<string[]> {
  const problems = staticProblems(skin);
  const browser = await getBrowser();
  for (const withDialog of [false, true]) {
    await galleryPage(dir, skin, withDialog);
    const page = await browser.newPage({ viewport: { width: 1100, height: 900 } });
    await page.goto(`file://${join(dir, withDialog ? "gallery.html" : "gallery-page.html")}`);
    if (withDialog) {
      const d = await page.evaluate(() => {
        const el = document.querySelector<HTMLElement>('[data-el="ask"]');
        return el ? getComputedStyle(el).position : "";
      });
      if (!["fixed", "absolute"].includes(d)) problems.push("a section shown as dialog must be over the page (position fixed), with a backdrop behind it");
      await page.screenshot({ path: join(dir, "gallery-dialog.png"), fullPage: false });
    } else {
      problems.push(...(await page.evaluate(pageChecks)).filter((p) => !/position fixed/.test(p)));
      problems.push(...(await focusProblems(page)));
      await page.screenshot({ path: join(dir, "gallery.png"), fullPage: true });
    }
    await page.close();
  }
  return [...new Set(problems)];
}

// ---------------------------------------------------------------- the prompt and the build

const SYSTEM = `You are the theme stage of the Intent compiler. You write a skin: one CSS stylesheet that gives every app built with Intent's plain renderer its look. You never see an app: you style what every app is made of. Reply with one \`\`\`css block and nothing else.`;

function contract(): string {
  const p = uiProfile();
  const kinds = p.elements.map((e) => `- ${e.kind}: ${e.meaning}${e.presentations.length ? `\n${e.presentations.map((x) => `  - \`[data-as="${x.name}"]\`: ${x.meaning}`).join("\n")}` : ""}`).join("\n");
  return `The DOM you style (Intent's plain renderer; the same for every app):
- \`body\` > \`#app\` > \`main.screen\` (the app), which starts with an \`h1\` (the app's title).
- heading: \`h2.heading\`. text: \`p.text\`. field: \`label.field\` > (\`span\` label) + \`input\`. button: \`button.button\` (\`:disabled\` when not enabled).
- checkbox: \`label.checkbox\` > \`input[type=checkbox]\` + \`span\`. select: \`div.select\` > (\`span\` label) + \`button.option\` per option, the chosen one with class \`chosen\` and \`aria-pressed="true"\`.
- progress: \`progress.progress\` (max 100). list: \`ul.list\` > \`li.row\` per row (\`data-row\` its key), the row's elements inside. section: \`section.section\` > (\`h2\` its label, if any) + its elements.
- Every element carries \`data-el\` (its name in its app: never style by it), and may carry:
  - \`data-as\`: its presentation (below), what kind of thing it is for the user;
  - \`data-tone\`: what its state means: ${TONES.map((t) => `\`${t}\``).join(", ")};
  - \`data-component\` on a component's root (\`Pager\`, \`Dialog\`, \`Table\`) and \`data-part\` on each element of it (\`next\`, \`title\`).
  An element with presentation, tone or part may be wrapped: in Elm builds the attributes are on a \`div\` with \`display:contents\` around the element, in TypeScript builds on the element itself. Write selectors that work for both: \`[data-as="primary"].button, [data-as="primary"] > .button\`.
Element kinds and their presentations (each has one meaning; give each its own look):
${kinds}`;
}

function rules(t: ThemeSpec): string {
  return `Rules:
1. Colours only through tokens: define every colour once as a custom property on \`:root\` (\`--color-…\`) and use \`var(--…)\` everywhere else. No literal colour outside a token definition.${t.tokens ? " Use the theme's tokens below (they are defined for you); add your own only for what they lack." : ""}
2. Everything readable: text at least 4.5:1 against what is behind it (3:1 for large text), in every presentation and tone (WCAG 2.2 1.4.3); control borders and focus rings 3:1 (1.4.11).
3. Every presentation and every tone looks like its meaning and unlike the others: primary, secondary, danger, ghost and link buttons are told apart at a glance; danger, warning, success and info differ in colour (a badge's tone is its fill or its ring).
4. A visible keyboard focus on every control (\`:focus-visible\`: an outline or ring, WCAG 2.4.7). Disabled controls look disabled.
5. A section \`[data-as="dialog"]\` is over the page: \`position: fixed\`, centered, above a dimmed backdrop (a box-shadow spread or ::before); \`[data-as="drawer"]\` is fixed to the right edge.
6. No @import, no url(), no fonts from outside, no animations unless \`@media (prefers-reduced-motion: no-preference)\`. Use system font stacks or the token's fonts.
7. A component's root (\`[data-component]\`) is only a group around its parts: give it no box of its own (a Dialog's root is there even while its dialog is closed). Style parts by \`[data-component="X"] [data-part="y"]\` if you like, but draw dialogs, cards and the like by \`data-as\`.
8. Style only by the contract: element classes, \`data-as\`, \`data-tone\`, \`data-component\`/\`data-part\`, states (\`:disabled\`, \`.chosen\`, \`:checked\`, \`:focus-visible\`, \`:hover\`). Never by \`data-el\` (an app's own names).`;
}

export function themePrompt(t: ThemeSpec): string {
  const tokens = t.tokens ? `\nThe theme's tokens (W3C design tokens, flattened; they are defined on :root before your skin):\n${Object.entries(t.tokens.flat).map(([k, v]) => `${k}: ${v}`).join("\n")}\n` : "";
  return `The theme \`${t.name}\`:\n${t.look.map((l) => `- ${l}`).join("\n")}\n${tokens}\n${contract()}\n\n${rules(t)}\n\nWrite the skin.`;
}

export interface ThemeResult {
  ok: boolean;
  dir: string;
  attempts: { stage: string; detail: string }[];
  costUsd: number;
}

/** Build a theme: the skin, verified on the gallery; repaired with what is wrong until it passes. */
export async function buildTheme(file: string, out: string, log: (m: string) => void, maxAttempts = 4): Promise<ThemeResult> {
  const { theme, errors } = parseTheme(file);
  const res: ThemeResult = { ok: false, dir: out, attempts: [], costUsd: 0 };
  if (!theme || errors.length) {
    res.attempts.push({ stage: "spec", detail: errors.join("\n") });
    return res;
  }
  mkdirSync(join(out, "log"), { recursive: true });
  const tokenCss = theme.tokens ? `:root{${Object.entries(theme.tokens.flat).map(([k, v]) => `${k}:${v}`).join(";")}}\n` : "";
  const base = themePrompt(theme);
  let prompt = base;
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    writeFileSync(join(out, `log/prompt-${attempt}.md`), prompt);
    const r = await complete(SYSTEM, prompt);
    res.costUsd += r.costUsd;
    if (r.error) {
      res.attempts.push({ stage: "llm", detail: r.error });
      log(`attempt ${attempt}: llm error ${r.error}`);
      continue;
    }
    writeFileSync(join(out, `log/response-${attempt}.md`), r.text);
    const skin = tokenCss + extractCode(r.text);
    const problems = await verifySkin(out, skin);
    if (!problems.length) {
      res.attempts.push({ stage: "ok", detail: "the gallery passes" });
      res.ok = true;
      writeFileSync(join(out, "theme.json"), JSON.stringify({ theme: theme.name, ok: true, attempts: res.attempts, costUsd: res.costUsd }, null, 2));
      log(`attempt ${attempt}: ok`);
      return res;
    }
    res.attempts.push({ stage: "gallery", detail: problems.join("\n") });
    log(`attempt ${attempt}: ${problems.length} problem(s)`);
    prompt = `${base}\n\nYour last skin:\n\`\`\`css\n${extractCode(r.text)}\n\`\`\`\n\nIt does not pass the gallery checks:\n${problems.map((p) => `- ${p}`).join("\n")}\n\nWrite the whole skin again, fixed.`;
  }
  writeFileSync(join(out, "theme.json"), JSON.stringify({ theme: theme.name, ok: false, attempts: res.attempts, costUsd: res.costUsd }, null, 2));
  return res;
}

/** Give a built app a theme: its skin replaces the plain renderer's default style. */
export function applySkin(buildDir: string, skinFile: string) {
  applySkins(buildDir, [skinFile]);
}

/**
 * Give a built app several themes to switch between at run time (`--skin a.css,b.css`): each skin is
 * a stylesheet named after its theme (the folder it was built in, else its file), all but the chosen
 * one disabled. The theme is `?theme=<name>`, else the host's `globalThis.__intentTheme`, else the
 * first; a host that changes `__intentTheme` dispatches `intenttheme` on window. No app code knows.
 */
export function applySkins(buildDir: string, skinFiles: string[]) {
  const index = join(buildDir, "index.html");
  const names = skinFiles.map((f) => (/^skin\.css$/.test(f.split("/").pop()!) ? f.split("/").slice(-2)[0] : f.split("/").pop()!.replace(/\.css$/, "")));
  skinFiles.forEach((f, i) => copyFileSync(f, join(buildDir, skinFiles.length === 1 ? "skin.css" : `skin-${names[i]}.css`)));
  if (!existsSync(index)) return;
  const html = readFileSync(index, "utf8").replace(/<link rel="stylesheet" href="skin[^"]*" data-intent-skin[^>]*>/g, "").replace(/<script data-intent-themes>[\s\S]*?<\/script>/, "");
  const links = skinFiles.map((_, i) => `<link rel="stylesheet" href="${skinFiles.length === 1 ? "skin.css" : `skin-${names[i]}.css`}" data-intent-skin data-theme="${names[i]}"${i ? " disabled" : ""}>`).join("");
  const pick = skinFiles.length > 1 ? `<script data-intent-themes>(()=>{const pick=()=>{const q=new URLSearchParams(location.search).get("theme");const want=globalThis.__intentTheme??q;const links=[...document.querySelectorAll("link[data-intent-skin]")];const on=links.find((l)=>l.dataset.theme===want)??links[0];for(const l of links)l.disabled=l!==on;document.documentElement.dataset.theme=on.dataset.theme;};pick();addEventListener("intenttheme",pick);})();</script>` : "";
  // The skin instead of the default look (an Elm page has it inline; a TypeScript page adds it only without a skin).
  writeFileSync(index, html.replace(/<style>[\s\S]*?<\/style>/, "").replace("</head>", `${links}${pick}</head>`));
}
