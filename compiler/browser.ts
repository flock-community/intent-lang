// Real-browser driver for styled builds (Chromium via Playwright).
// Observes the DOM through the `data-el` contract, acts with real DOM events, checks that the
// DOM shows exactly what the logic's Screen says (render fidelity), and takes screenshots.
import { chromium, type Browser, type Page } from "playwright";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import type { App, Element as SpecElement } from "./ast.ts";
import { canonical, type Action, type Obs } from "./exec.ts";

export const VIEWPORT = { width: 1280, height: 800 };

let browser: Promise<Browser> | undefined;
export function getBrowser(): Promise<Browser> {
  return (browser ??= chromium.launch());
}
export async function closeBrowser() {
  if (browser) await (await browser).close();
  browser = undefined;
}

/** The spec's screen tree, reduced to what the in-page extractor needs. */
export interface Shape {
  kind: string;
  name: string;
  label: string;
  children: Shape[];
  options?: string[]; // static select options (choice values)
}

export function shapeOf(app: App): Shape[] {
  const choiceOf = (name: string) => {
    const t = app.state.find((f) => f.name === name)?.type;
    return t?.k === "Named" ? app.choices.find((c) => c.name === t.name)?.values : undefined;
  };
  const conv = (els: SpecElement[]): Shape[] =>
    els.map((el) => ({ kind: el.kind, name: el.name, label: el.label ?? "", children: conv(el.children), options: el.kind === "select" && !el.from ? choiceOf(el.name) : undefined }));
  return conv(app.screen);
}

// Runs inside the page. Must be self-contained.
function pageExtract(arg: { shapes: Shape[]; title: string }) {
  const norm = (s: string | null | undefined) => (s ?? "").replace(/\s+/g, " ").trim();
  const visible = (el: Element) => (el as any).checkVisibility({ checkOpacity: true, checkVisibilityCSS: true });
  const rowOf = (el: Element) => el.closest("[data-row]");
  const find = (scope: Element | Document, row: Element | null, name: string): HTMLElement | null => {
    for (const el of Array.from(scope.querySelectorAll<HTMLElement>(`[data-el="${name}"]`))) if (rowOf(el) === row && visible(el)) return el;
    return null;
  };
  const control = <T extends Element>(el: HTMLElement, sel: string): T | null => (el.matches(sel) ? (el as unknown as T) : el.querySelector<T>(sel));
  const chosen = (o: Element) =>
    ["aria-selected", "aria-pressed", "aria-checked"].some((a) => o.getAttribute(a) === "true") || (o.hasAttribute("aria-current") && o.getAttribute("aria-current") !== "false");
  const errors: string[] = [];
  const walk = (shapes: Shape[], scope: Element | Document, row: Element | null): any[] => {
    const out: any[] = [];
    for (const s of shapes) {
      if (s.kind === "heading") {
        out.push({ k: "heading", v: s.label });
        continue;
      }
      const el = find(scope, row, s.name);
      if (!el) continue;
      switch (s.kind) {
        case "text":
          out.push({ k: "text", n: s.name, v: norm(el.textContent) });
          break;
        case "field": {
          const input = control<HTMLInputElement>(el, "input,textarea");
          if (!input) errors.push(`field \`${s.name}\`: no <input> or <textarea> at or inside [data-el]`);
          out.push({ k: "field", n: s.name, label: s.label, v: input?.value ?? "" });
          break;
        }
        case "button": {
          const b = control<HTMLButtonElement>(el, "button") ?? (el as any);
          out.push({ k: "button", n: s.name, label: norm(b.getAttribute("aria-label")) || norm(b.textContent), enabled: !b.disabled && b.getAttribute("aria-disabled") !== "true" });
          break;
        }
        case "checkbox": {
          const input = control<HTMLInputElement>(el, 'input[type="checkbox"]');
          const sw = input ? null : control<HTMLElement>(el, "[aria-checked]");
          if (!input && !sw) errors.push(`checkbox \`${s.name}\`: needs an <input type="checkbox"> or an element with aria-checked`);
          out.push({ k: "checkbox", n: s.name, label: s.label, checked: input ? input.checked : sw?.getAttribute("aria-checked") === "true" });
          break;
        }
        case "select": {
          const native = control<HTMLSelectElement>(el, "select");
          let options: string[];
          let v = "";
          if (native) {
            options = Array.from(native.options).map((o) => o.value);
            v = native.value;
          } else {
            const opts = Array.from(el.querySelectorAll("[data-option]"));
            options = opts.map((o) => o.getAttribute("data-option") ?? "");
            v = opts.find(chosen)?.getAttribute("data-option") ?? "";
            if (!opts.length) errors.push(`select \`${s.name}\`: no native <select> and no [data-option] elements`);
          }
          out.push({ k: "select", n: s.name, label: s.label, options, v });
          break;
        }
        case "progress": {
          const p = control<HTMLElement>(el, "progress,[aria-valuenow]");
          const raw = p ? (p.tagName === "PROGRESS" ? (p as HTMLProgressElement).value : p.getAttribute("aria-valuenow")) : null;
          if (raw === null) errors.push(`progress \`${s.name}\`: needs <progress> or aria-valuenow`);
          out.push({ k: "progress", n: s.name, label: s.label, v: Number(raw ?? NaN) });
          break;
        }
        case "list": {
          const rows = Array.from(el.querySelectorAll("[data-row]")).filter((r) => rowOf(r.parentElement!) === row);
          out.push({ k: "list", n: s.name, rows: rows.map((r) => ({ key: "", c: walk(s.children, r, r) })) });
          break;
        }
        case "section":
          out.push({ k: "section", n: s.name, label: s.label, c: walk(s.children, el, row) });
          break;
      }
    }
    return out;
  };
  return { node: { k: "screen", title: arg.title, c: walk(arg.shapes, document, null) }, errors };
}

// Runs inside the page: perform one action; returns an error text when it could not be done.
function pageAct(a: { on: string; target: string; list?: string; row?: number; text?: string; value?: string }): string | null {
  const visible = (el: Element) => (el as any).checkVisibility({ checkOpacity: true, checkVisibilityCSS: true });
  const rowOf = (el: Element) => el.closest("[data-row]");
  const find = (scope: Element | Document, row: Element | null, name: string): HTMLElement | null => {
    for (const el of Array.from(scope.querySelectorAll<HTMLElement>(`[data-el="${name}"]`))) if (rowOf(el) === row && visible(el)) return el;
    return null;
  };
  let scope: Element | Document = document;
  let row: Element | null = null;
  if (a.list) {
    const list = find(document, null, a.list);
    if (!list) return `list ${a.list} not on screen`;
    const rows = Array.from(list.querySelectorAll("[data-row]")).filter((r) => rowOf(r.parentElement!) === null);
    row = rows[(a.row ?? 1) - 1] ?? null;
    if (!row) return `no row ${a.row}`;
    scope = row;
  }
  const el = find(scope, row, a.target);
  if (!el) return `${a.target} not on screen`;
  const setValue = (input: HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement, value: string) => {
    const proto = input instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : input instanceof HTMLSelectElement ? HTMLSelectElement.prototype : HTMLInputElement.prototype;
    Object.getOwnPropertyDescriptor(proto, "value")!.set!.call(input, value);
    input.dispatchEvent(new Event("input", { bubbles: true }));
    input.dispatchEvent(new Event("change", { bubbles: true }));
  };
  switch (a.on) {
    case "click":
      (el.matches("button") ? el : el.querySelector("button") ?? el).click();
      return null;
    case "input": {
      const input = el.matches("input,textarea") ? (el as HTMLInputElement) : el.querySelector<HTMLInputElement>("input,textarea");
      if (!input) return "no input";
      input.focus();
      setValue(input, a.text ?? "");
      return null;
    }
    case "toggle": {
      const c = el.matches('input[type="checkbox"],[aria-checked]') ? el : el.querySelector<HTMLElement>('input[type="checkbox"],[aria-checked]') ?? el;
      c.click();
      return null;
    }
    case "choose": {
      const native = el.matches("select") ? (el as unknown as HTMLSelectElement) : el.querySelector("select");
      if (native) {
        setValue(native, a.value ?? "");
        return null;
      }
      const opt = el.querySelector<HTMLElement>(`[data-option="${a.value}"]`);
      if (!opt) return `no option ${a.value}`;
      (opt.matches("button,a,input") ? opt : opt.querySelector<HTMLElement>("button,a,input") ?? opt).click();
      return null;
    }
  }
  return `cannot ${a.on}`;
}

const NO_MOTION = "*,*::before,*::after{transition:none!important;animation:none!important;caret-color:transparent!important}";

export type Rects = Record<string, [number, number, number, number]>; // data-el path → x, y, w, h

export interface StyledSession {
  page: Page;
  rects(): Promise<Rects>;
  observe(): Promise<{ dom: Obs; screen: Obs; errors: string[] }>;
  act(a: Action, dom: Obs): Promise<string | null>;
  shot(): Promise<Buffer>;
  close(): Promise<void>;
}

export async function openStyled(dir: string, app: App): Promise<StyledSession> {
  const b = await getBrowser();
  const ctx = await b.newContext({ viewport: VIEWPORT, deviceScaleFactor: 1 });
  const page = await ctx.newPage();
  const pageErrors: string[] = [];
  page.on("pageerror", (e) => pageErrors.push(e.message));
  await page.goto(pathToFileURL(join(dir, "index.html")).href);
  await page.addStyleTag({ content: NO_MOTION });
  await page.waitForFunction(() => (window as any).__n > 0, undefined, { timeout: 10_000 });
  const shapes = shapeOf(app);
  const settle = async () => {
    // Elm renders on the next animation frame and reports the screen through a port; wait until both are quiet.
    await page.evaluate(
      () =>
        new Promise<void>((res) => {
          let last = (window as any).__n;
          const tick = (left: number) =>
            requestAnimationFrame(() => {
              const n = (window as any).__n;
              if (n === last && left <= 0) res();
              else {
                last = n;
                tick(left - 1);
              }
            });
          tick(1);
        }),
    );
  };
  return {
    page,
    async observe() {
      await settle();
      const { node, errors } = await page.evaluate(pageExtract, { shapes, title: app.name });
      const screen = await page.evaluate(() => (window as any).__screen);
      return { dom: node, screen, errors: [...errors, ...pageErrors.splice(0).map((m) => `page error: ${m}`)] };
    },
    async act(a, dom) {
      if (a.on === "tick") return "ticks are not supported in the styled profile";
      let row = a.row;
      if (a.list && a.rowWith !== undefined) {
        const l = findList(dom, a.list);
        const i = l ? l.rows.findIndex((r: any) => JSON.stringify(r).includes(JSON.stringify(a.rowWith))) : -1;
        if (i < 0) return `no row showing ${JSON.stringify(a.rowWith)}`;
        row = i + 1;
      }
      return page.evaluate(pageAct, { on: a.on, target: a.target, list: a.list, row, text: a.text, value: a.value });
    },
    async rects() {
      await settle();
      return page.evaluate(() => {
        const out: Record<string, [number, number, number, number]> = {};
        const rows = new Map<Element, number>();
        for (const el of Array.from(document.querySelectorAll<HTMLElement>("[data-el]"))) {
          if (!(el as any).checkVisibility({ checkOpacity: true, checkVisibilityCSS: true })) continue;
          const row = el.closest("[data-row]");
          let key = el.getAttribute("data-el")!;
          if (row) {
            const list = row.parentElement!.closest("[data-el]");
            const all = list ? Array.from(list.querySelectorAll("[data-row]")) : [];
            if (!rows.has(row)) rows.set(row, all.indexOf(row) + 1);
            key = `${list?.getAttribute("data-el")}[${rows.get(row)}].${key}`;
          }
          const r = el.getBoundingClientRect();
          out[key] = [Math.round(r.x + window.scrollX), Math.round(r.y + window.scrollY), Math.round(r.width), Math.round(r.height)];
        }
        return out;
      });
    },
    async shot() {
      await settle();
      return page.screenshot({ fullPage: true });
    },
    async close() {
      await ctx.close();
    },
  };
}

function findList(obs: Obs, name: string): any {
  const walk = (nodes: any[]): any => {
    for (const n of nodes) {
      if (n.k === "list" && n.n === name) return n;
      if (n.k === "section") {
        const r = walk(n.c);
        if (r) return r;
      }
    }
  };
  return walk(obs.c);
}

/** Differences between what the DOM shows and what the logic says, as readable lines. */
export function fidelityDiff(dom: Obs, screen: Obs): string[] {
  const a = JSON.parse(canonical(dom));
  const b = JSON.parse(canonical(screen));
  const out: string[] = [];
  const cmp = (x: any, y: any, path: string) => {
    if (out.length > 12) return;
    if (JSON.stringify(x) === JSON.stringify(y)) return;
    if (Array.isArray(x) && Array.isArray(y)) {
      if (x.length !== y.length && path.endsWith(".rows")) out.push(`${path}: the page shows ${x.length} rows, the screen has ${y.length}`);
      const byName = (arr: any[]) => arr.map((n) => n?.n ?? n?.k);
      if (!path.endsWith(".rows") && JSON.stringify(byName(x)) !== JSON.stringify(byName(y))) {
        const missing = byName(y).filter((n: string) => !byName(x).includes(n));
        const extra = byName(x).filter((n: string) => !byName(y).includes(n));
        if (missing.length) out.push(`${path}: not found on the page (visible, with data-el): ${missing.join(", ")}`);
        if (extra.length) out.push(`${path}: visible on the page but hidden on the screen: ${extra.join(", ")}`);
        return;
      }
      for (let i = 0; i < Math.min(x.length, y.length); i++) cmp(x[i], y[i], `${path}[${i + 1}]`);
      return;
    }
    if (x && y && typeof x === "object" && typeof y === "object") {
      for (const k of new Set([...Object.keys(x), ...Object.keys(y)])) cmp(x[k], y[k], `${path}${x.n ? `.${x.n}` : ""}.${k}`);
      return;
    }
    out.push(`${path}: the page shows ${JSON.stringify(x)}, the screen says ${JSON.stringify(y)}`);
  };
  cmp(a.c, b.c, "screen");
  return out;
}
