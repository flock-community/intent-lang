// The Kit: exact Tailwind class recipes for every built-in presentation, derived from the
// spec's `design` block (density; radius and colours come in through theme tokens).
// Deterministic: the same spec always gets the same kit, so builds share one design system.
import type { App } from "./ast.ts";

type Density = "compact" | "comfortable" | "spacious";

// Spacing per density: [page padding, surface padding, cell padding, block gap, control padding]
const SPACE: Record<Density, { page: string; surface: string; cellX: string; cellY: string; gap: string; ctl: string; ctlSm: string }> = {
  compact: { page: "px-6 py-5", surface: "p-4", cellX: "px-4", cellY: "py-2", gap: "gap-4", ctl: "px-3 py-1.5", ctlSm: "px-2.5 py-1" },
  comfortable: { page: "px-8 py-7", surface: "p-5", cellX: "px-5", cellY: "py-3", gap: "gap-6", ctl: "px-4 py-2", ctlSm: "px-3 py-1.5" },
  spacious: { page: "px-10 py-9", surface: "p-7", cellX: "px-6", cellY: "py-4", gap: "gap-8", ctl: "px-5 py-2.5", ctlSm: "px-3.5 py-2" },
};

export function kit(app: App): Record<string, string> {
  const d = SPACE[(app.design?.density as Density) ?? "comfortable"];
  const btn = `inline-flex items-center justify-center gap-2 rounded-control ${d.ctl} text-sm font-medium whitespace-nowrap disabled:cursor-not-allowed disabled:opacity-50`;
  const input = `block w-full rounded-control border border-neutral-300 bg-white px-3 py-2 text-sm text-neutral-900 placeholder:text-neutral-400 focus:border-brand-500 focus:outline-none focus:ring-2 focus:ring-brand-500/30`;
  return {
    // page and layout
    page: "min-h-screen bg-neutral-50 font-sans text-neutral-900 antialiased",
    shell: "flex min-h-screen",
    container: `mx-auto flex w-full max-w-6xl flex-col ${d.gap} ${d.page}`,
    stack: "flex flex-col gap-4",
    stackTight: "flex flex-col gap-1",
    sidebar: `flex w-60 shrink-0 flex-col ${d.gap} border-r border-neutral-200 bg-white px-4 py-6`,
    content: `flex min-w-0 flex-1 flex-col ${d.gap} ${d.page}`,
    header: "flex items-center justify-between gap-4",
    toolbar: `flex flex-wrap items-center justify-between gap-3 ${d.surface}`,
    card: "rounded-surface border border-neutral-200 bg-white shadow-sm",
    cardBody: `flex flex-col gap-4 ${d.surface}`,
    grid2: "grid grid-cols-1 gap-4 sm:grid-cols-2",
    grid3: "grid grid-cols-1 gap-4 sm:grid-cols-3",
    grid4: "grid grid-cols-2 gap-4 lg:grid-cols-4",
    row: "flex items-center gap-3",
    form: `flex max-w-xl flex-col gap-5 ${d.surface}`,
    formField: "flex flex-col gap-1.5",
    footer: `flex items-center justify-between gap-4 border-t border-neutral-200 ${d.cellX} py-3`,
    banner: "w-full border-b border-neutral-200 bg-white px-8 py-3",
    backdrop: "fixed inset-0 z-40 flex items-center justify-center bg-neutral-900/40 p-4",
    dialog: "flex w-full max-w-lg flex-col gap-5 rounded-surface bg-white p-6 shadow-xl",
    drawer: "fixed inset-y-0 right-0 z-30 flex w-full max-w-md flex-col gap-5 overflow-y-auto border-l border-neutral-200 bg-white p-6 shadow-xl",
    actions: "flex items-center justify-end gap-3",
    sidebarFooter: "mt-auto flex items-center gap-3 border-t border-neutral-200 pt-4",
    // text
    appTitle: "text-lg font-semibold tracking-tight text-neutral-900",
    title: "text-2xl font-semibold tracking-tight text-neutral-900",
    panelTitle: "text-lg font-semibold text-neutral-900",
    heading: "text-base font-semibold text-neutral-900",
    body: "text-sm text-neutral-700",
    caption: "text-sm text-neutral-500",
    label: "text-sm font-medium text-neutral-700",
    badge: "inline-flex items-center gap-1.5 rounded-full bg-neutral-100 px-2.5 py-0.5 text-xs font-medium text-neutral-700",
    avatar: "inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-brand-100 text-sm font-semibold text-brand-700",
    alert: "rounded-control border border-warning-200 bg-warning-50 px-4 py-3 text-sm font-medium text-warning-800",
    toast: "fixed bottom-6 right-6 z-50 flex items-center gap-3 rounded-control bg-neutral-900 py-3 pl-4 pr-2 text-sm font-medium text-white shadow-lg",
    stat: "text-3xl font-semibold tracking-tight text-neutral-900",
    code: "font-mono text-sm text-neutral-800",
    // buttons
    buttonPrimary: `${btn} bg-brand-600 text-white shadow-sm hover:bg-brand-700`,
    buttonSecondary: `${btn} border border-neutral-300 bg-white text-neutral-700 shadow-sm hover:bg-neutral-50`,
    buttonDanger: `${btn} bg-danger-600 text-white shadow-sm hover:bg-danger-700`,
    buttonGhost: `${btn} text-neutral-600 hover:bg-neutral-100`,
    buttonLink: "text-sm font-medium text-brand-600 hover:text-brand-700 hover:underline disabled:opacity-50",
    buttonIcon: "inline-flex h-8 w-8 items-center justify-center rounded-control text-current opacity-80 hover:opacity-100",
    // fields
    input,
    search: input.replace("block w-full", "block w-80"),
    textarea: `${input} min-h-24`,
    dropdown: "rounded-control border border-neutral-300 bg-white py-2 pl-3 pr-8 text-sm text-neutral-900 focus:border-brand-500 focus:outline-none focus:ring-2 focus:ring-brand-500/30",
    // selects
    navList: "flex flex-col gap-1",
    navItem: "flex w-full items-center rounded-control px-3 py-2 text-left text-sm font-medium text-neutral-700 hover:bg-neutral-100",
    navItemOn: "flex w-full items-center rounded-control px-3 py-2 text-left text-sm font-medium bg-brand-50 text-brand-700",
    tabList: "flex gap-6 border-b border-neutral-200",
    tab: "-mb-px border-b-2 border-transparent py-2 text-sm font-medium text-neutral-500 hover:text-neutral-700",
    tabOn: "-mb-px border-b-2 border-brand-600 py-2 text-sm font-medium text-brand-700",
    chipList: "flex flex-wrap gap-2",
    chip: `rounded-full border border-neutral-300 bg-white ${d.ctlSm} text-sm font-medium text-neutral-700 hover:bg-neutral-50`,
    chipOn: `rounded-full border border-brand-600 bg-brand-600 ${d.ctlSm} text-sm font-medium text-white`,
    segmented: "inline-flex rounded-control border border-neutral-300 bg-neutral-100 p-0.5",
    segment: "rounded-control px-3 py-1.5 text-sm font-medium text-neutral-600 hover:text-neutral-900",
    segmentOn: "rounded-control bg-white px-3 py-1.5 text-sm font-medium text-neutral-900 shadow-sm",
    // checkbox
    toggleRow: "flex items-center justify-between gap-4",
    toggle: "relative inline-flex h-6 w-11 shrink-0 items-center rounded-full bg-neutral-300",
    toggleOn: "relative inline-flex h-6 w-11 shrink-0 items-center rounded-full bg-brand-600",
    knob: "inline-block h-5 w-5 translate-x-0.5 rounded-full bg-white shadow",
    knobOn: "inline-block h-5 w-5 translate-x-5.5 rounded-full bg-white shadow",
    checkbox: "h-4 w-4 rounded border-neutral-300 text-brand-600 focus:ring-brand-500",
    // lists
    table: "w-full text-left text-sm",
    thead: "bg-neutral-50 text-xs font-medium uppercase tracking-wide text-neutral-500",
    th: `${d.cellX} py-2.5 font-medium`,
    tr: "border-t border-neutral-100",
    td: `${d.cellX} ${d.cellY} text-neutral-700`,
    tdCompact: `${d.cellX} py-1.5 text-neutral-700`,
    timeline: "flex flex-col gap-3",
    timelineItem: "flex flex-col gap-1 rounded-control bg-neutral-50 p-3",
    cards: "grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3",
    menu: "flex flex-col divide-y divide-neutral-100",
    menuItem: "flex items-center justify-between gap-3 px-3 py-2 text-sm",
    barRow: "grid grid-cols-[8rem_1fr_3rem] items-center gap-3 text-sm",
    // progress
    track: "h-2 w-full overflow-hidden rounded-full bg-neutral-100",
    fill: "h-2 rounded-full bg-brand-500",
    ringLabel: "text-2xl font-semibold text-neutral-900",
    // empty state
    empty: "flex flex-col items-center gap-2 px-6 py-12 text-center",
    emptyIcon: "h-12 w-12 rounded-full bg-neutral-100",
  };
}

export function kitElm(app: App): string {
  const k = kit(app);
  return `module Kit exposing (..)

{-| Generated from the design block — do not edit. Class recipes for every built-in presentation. -}


${Object.entries(k)
  .map(([name, cls]) => `${name} : String\n${name} =\n    ${JSON.stringify(cls)}\n`)
  .join("\n\n")}`;
}

export function kitTs(app: App): string {
  const k = kit(app);
  return `// Generated from the design block — do not edit. Class recipes for every built-in presentation.
export const kit = {
${Object.entries(k)
  .map(([name, cls]) => `  ${name}: ${JSON.stringify(cls)},`)
  .join("\n")}
} as const;
`;
}

export const KIT_GUIDE = `The Kit (generated from the design block) holds the exact class string for every built-in presentation. Use it:
- Every built-in presentation uses its Kit recipe as its whole class, unchanged: e.g. a \`button … as primary\` has exactly Kit.buttonPrimary, a \`section … as card\` is a Kit.card element whose content sits in a Kit.cardBody element, \`list … as table\` uses table/thead/th/tr/td, \`select … as chips\` uses chipList/chip/chipOn, \`checkbox … as toggle\` uses toggle/toggleOn with a knob/knobOn inside.
- Cards: a \`card\` is a Kit.card element. Its title (if any) and plain elements go in a Kit.cardBody. A \`toolbar\`, a \`list … as table\`, a \`list … as menu\` and a \`footer\` inside a card are its direct children, flush with the card's edges (they carry their own padding: toolbar and footer recipes, th/td). Several plain elements in a row share one Kit.cardBody.
- Page structure: the root is Kit.page. With a sidebar, Kit.shell holds Kit.sidebar and Kit.content. Without a sidebar, everything sits in one Kit.container (centered, at most 6xl wide).
- A section without \`as\` is a vertical stack: Kit.stackTight when it holds only texts and headings, Kit.stack otherwise.
- A toolbar (and a header) puts its first element on the left and all the others together on the right, in spec order, in one Kit.row.
- Tables size their columns automatically: no widths on th or td, unless a look sentence gives them.
- A section \`as empty\` (or a component based on it) is Kit.empty: centered, with its texts stacked. A \`grid\` with N children uses grid2/grid3/grid4. Labels above fields use Kit.label inside Kit.formField. Dialogs are Kit.backdrop > Kit.dialog; their buttons sit in Kit.actions at the bottom.
- Layout follows §9 (Look): spec order; consecutive buttons form one Kit.actions row; a \`footer\` section inside a sidebar is Kit.sidebarFooter (pinned to the bottom).
- A \`search\` field has no visible label: its label is the placeholder (and aria-label), with Kit.search. Every other field has its label above it (Kit.formField > Kit.label + Kit.input).
- Elements without \`as\` use the closest plain recipe: text → body, heading → heading, button → buttonSecondary, field → input, select → dropdown, checkbox → checkbox, list → menu, section → a plain div with the parent's gap.
- A component declared \`as <presentation>\` starts from that presentation's recipe (a card component is Kit.card + Kit.cardBody, a badge component is Kit.badge, a row component is Kit.row) and changes only what its look sentence names (e.g. a colour per value). Its children stack with the recipe's own gap; do not add margins between them.
- For declared components, build from Kit recipes and follow the component's look; add only the layout utilities you need (flex, grid, gap, width, margin, text alignment).
- Do not add classes to a recipe and do not invent other spacing, colours, sizes or shadows for built-in presentations.`;
