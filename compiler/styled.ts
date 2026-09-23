// Styled profile: the LLM also writes the presentation (Look), styled with Tailwind.
// The harness generates the theme (from `design`) and the entry points; nothing else about the look.
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { App } from "./ast.ts";
import type { Target } from "./gen.ts";
import { kitElm, kitTs } from "./kit.ts";

const SHADES = [50, 100, 200, 300, 400, 500, 600, 700, 800, 900, 950];
const RADIUS: Record<string, [string, string]> = {
  none: ["0", "0"],
  small: ["0.25rem", "0.375rem"],
  medium: ["0.375rem", "0.5rem"],
  large: ["0.5rem", "0.75rem"],
  xl: ["0.75rem", "1rem"],
  full: ["9999px", "1rem"],
};
const FONTS: Record<string, string> = {
  sans: 'ui-sans-serif, system-ui, -apple-system, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif',
  serif: 'ui-serif, Georgia, Cambria, "Times New Roman", serif',
  mono: 'ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace',
};

export function colorRoles(app: App): Record<string, string> {
  return { brand: "indigo", neutral: "gray", accent: "violet", success: "emerald", warning: "amber", danger: "red", info: "sky", ...(app.design?.colors ?? {}) };
}

/** Tailwind v4 input: colour roles as aliases of palettes, radius and font tokens. */
export function themeCss(app: App, ...sources: string[]): string {
  const roles = colorRoles(app);
  const [control, surface] = RADIUS[app.design?.radius ?? "large"];
  return `@import "tailwindcss" source(none);
${sources.map((src) => `@source "${src}";`).join("\n")}

/* Generated from the design block — colour roles are aliases of Tailwind palettes. */
@theme inline {
${Object.entries(roles)
  .map(([role, pal]) => SHADES.map((n) => `  --color-${role}-${n}: var(--color-${pal}-${n});`).join("\n"))
  .join("\n")}
}

@theme {
  --font-sans: ${FONTS[app.design?.font ?? "sans"]};
  --radius-control: ${control};
  --radius-surface: ${surface};
}
`;
}

export function designSummary(app: App): string {
  const roles = colorRoles(app);
  const d = app.design;
  return [
    `Colour roles (use these names, never raw palettes): ${Object.entries(roles).map(([r, p]) => `${r} (= ${p})`).join(", ")}. Example: bg-brand-600, text-neutral-500, border-neutral-200, bg-danger-50.`,
    `Radius tokens: rounded-control for controls (buttons, inputs, badges use rounded-full only if the look says pill), rounded-surface for cards, dialogs and panels.`,
    `Font: font-sans (${d?.font ?? "sans"}).`,
    `Density: ${d?.density ?? "comfortable"}.`,
    d?.look ? `Overall look: ${d.look}` : "",
  ]
    .filter(Boolean)
    .join("\n");
}

const ELM_STYLED_MAIN = (app: App) => `port module Main exposing (main)

import App
import Browser
import Html
import Json.Encode as J
import Look
import Process
import Spec
import Task
import Ui


port observe : J.Value -> Cmd msg


type Msg
    = Ev Spec.Event
    | Ready


main : Program () App.Model Msg
main =
    Browser.element
        { init = \\_ -> ( App.init, Task.perform (\\_ -> Ready) (Process.sleep 0) )
        , update =
            \\msg m ->
                let
                    next =
                        case msg of
                            Ev e ->
                                App.update e m

                            Ready ->
                                m
                in
                ( next, observe (Ui.encode (Spec.toNode (App.view next))) )
        , view = \\m -> Html.map Ev (Look.render (App.view m))
        , subscriptions = \\_ -> Sub.none
        }
`;

const TS_STYLED_MAIN = `import { render } from "preact";
import * as App from "./app.ts";
import { render as look } from "./look.tsx";
import { toNode, type Event } from "./spec.ts";

const w = window as any;
let model = App.init();
const root = document.getElementById("app")!;
w.__n = 0;
function draw() {
  render(look(App.view(model), send), root);
  w.__screen = JSON.parse(JSON.stringify(toNode(App.view(model))));
  w.__n++;
}
function send(e: Event) {
  model = App.update(e, model);
  draw();
}
draw();
`;

export const ELM_LOOK_SKELETON = `module Look exposing (render)

import Html exposing (..)
import Html.Attributes exposing (..)
import Html.Events exposing (..)
import Spec exposing (..)


render : Screen -> Html Event
render screen =
    ...
`;

export const TS_LOOK_SKELETON = `import type { VNode } from "preact";
import type { Event, Screen /* , … */ } from "./spec.ts";

export function render(screen: Screen, send: (e: Event) => void): VNode {
  return <div class="min-h-screen …">…</div>;
}
`;

/** Add the styled entry points to a build directory that already holds the logic build. */
export function scaffoldStyled(app: App, target: Target, dir: string, useKit = false): { lookFile: string } {
  if (app.clockMs) throw new Error("`clock` in styled apps is not in the harness yet");
  if (target === "elm") {
    writeFileSync(join(dir, "src/Main.elm"), ELM_STYLED_MAIN(app));
    if (useKit) writeFileSync(join(dir, "src/Kit.elm"), kitElm(app));
    writeFileSync(join(dir, "theme.css"), useKit ? themeCss(app, "./src/Look.elm", "./src/Kit.elm") : themeCss(app, "./src/Look.elm"));
    writeFileSync(
      join(dir, "index.html"),
      `<!doctype html>\n<html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${app.name}</title><link rel="stylesheet" href="style.css"></head>\n<body><div id="app"></div><script src="main.js"></script><script>window.__n = 0; var app = Elm.Main.init({ node: document.getElementById("app") }); app.ports.observe.subscribe(function (v) { window.__screen = v; window.__n++; });</script></body></html>\n`,
    );
    return { lookFile: join(dir, "src/Look.elm") };
  }
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, "main.tsx"), TS_STYLED_MAIN);
  if (useKit) writeFileSync(join(dir, "kit.ts"), kitTs(app));
  writeFileSync(join(dir, "theme.css"), useKit ? themeCss(app, "./look.tsx", "./kit.ts") : themeCss(app, "./look.tsx"));
  writeFileSync(
    join(dir, "tsconfig.json"),
    JSON.stringify(
      {
        compilerOptions: { strict: true, noEmit: true, target: "es2022", module: "esnext", moduleResolution: "bundler", allowImportingTsExtensions: true, jsx: "react-jsx", jsxImportSource: "preact", lib: ["es2022", "dom", "dom.iterable"], skipLibCheck: true, types: [] },
        include: ["*.ts", "*.tsx"],
      },
      null,
      2,
    ),
  );
  writeFileSync(
    join(dir, "index.html"),
    `<!doctype html>\n<html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${app.name}</title><link rel="stylesheet" href="style.css"></head>\n<body><div id="app"></div><script src="main.js"></script></body></html>\n`,
  );
  return { lookFile: join(dir, "look.tsx") };
}
