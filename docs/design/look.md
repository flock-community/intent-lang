# What and look: apps, components, themes, hosts

Decided 2026-10-01. An Intent spec says what an app is; it never says how it looks. How things look
belongs to a theme, which a host (OurOS, a desktop such as nuri-apps' `stad`) chooses and can change
at run time without rebuilding any app. This is the separation the OurOS design playground already
has for its widgets (primitives with semantic attributes, `--ouros-*` tokens, `::part`), and the one
headless component libraries are built on (Radix, Ark UI / Zag.js, React Aria; Material and Ant
through component tokens).

## Four layers

| Layer | Says | Owned by | Changes with the theme |
|---|---|---|---|
| 1. App (an Intent spec) | its data, behaviour and elements; for each element its presentation (`as primary`, `as dialog`) and what its state means (`tone danger when …`) | the app | no |
| 2. Component spec (`std.ui` in intent-speclib) | what a component is: its anatomy (parts), states, variants, keyboard behaviour (WAI-ARIA APG) as examples | the library | no |
| 3. Theme | how it looks: tokens (W3C Design Tokens, 2025.10) and a skin per component (each part, per variant and state), possibly its own rendering of a component | the theme | it is the theme |
| 4. Host / desktop | which theme is active, chrome, world, placement, size | OurOS | chooses it |

## The contract between the what (1, 2) and the look (3, 4)

What an Intent build promises a host (STABILITY.md §5; the screen tree of `screen.mjs` and the plain
renderers' DOM):

| In the tree | In the plain DOM | Meaning |
|---|---|---|
| `k` (screen, heading, text, field, button, checkbox, progress, select, list, section) | the element | the kind of element |
| `n` | `data-el` | its spec name (qualified in an instance: `pager.next`) |
| `as` | `data-as` | its presentation, from the closed set of LANGUAGE.md §4c (a component's base) |
| `tone` | `data-tone` | what its state means: neutral, muted, info, success, warning, danger |
| `component` | `data-component` | on an instance's section: the component it is (`Pager`, later `Dialog`) |
| `part` | `data-part` | on an element of an instance: its own name in the component (`next`, `title`) |
| rows' `key` | `data-row` | the row's key |
| `enabled`, `checked`, `v`, `options`, row count | the control's state | the element's state |

A theme styles only by these: `[data-component=Dialog] [data-part=title]`, `[data-as=primary]`,
`[data-tone=danger]`, plus its own tokens. It never reads an app's names. The same app under two
themes differs only in look; its tree is the same (twin builds compare it).

A theme can change the look at three depths, as the `stad` desktop shows:

1. tokens only: colours, type, shape, spacing, motion;
2. a skin per component: the same parts drawn differently (a button as a road sign);
3. its own rendering of a component or of the whole screen (a canvas desktop), from the tree, which
   is data: nothing is copied by hand.

## What moves where

- `look "…"` words, `design` blocks and styled builds (an LLM writing a presentation per app) stay
  for compatibility. They are one host's way to draw an app, not part of what an app is. New apps
  and the library use presentations and tones.
- Themes and tokens live with the host (OurOS `themes/*.tokens.json`), not in Intent.
- Sizes: Intent `sizes` and OurOS's `compact | standard | wide | full` mean the same; the library
  uses OurOS's names.

## Next

1. `std.ui` in intent-speclib: button, text field, checkbox, select, dialog. Each a component with
   its anatomy (parts are its element names), states and variants, and its keyboard behaviour as
   examples (needs: slots, typed params, component examples, `press` and focus steps).
2. A theme as a spec: the skin of every `std.ui` component, generated from a design language
   ("default", "Material 3", "stad") and verified against the component specs (every part drawn,
   contrast per state, a visible focus, only its own tokens).
3. OurOS renders the tree with its primitives by `as`, `tone`, `component` and `part`
   (`<ouros-intent-screen>`'s table), so switching its theme restyles every Intent app.
