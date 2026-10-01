// Focus and dialogs (1.1), owned by the harness on every target, as WAI-ARIA's modal dialog pattern
// asks (https://www.w3.org/WAI/ARIA/apg/patterns/dialog-modal/): a section shown as dialog or drawer
// is a `role="dialog"` (modal for a dialog) labelled by its title; when one opens, focus moves into
// it; Tab and Shift+Tab stay inside it; when it closes, focus goes back to where it was. Dialogs are
// known by their name (`data-el`), not their DOM node: a renderer may draw the page anew every event.

const FOCUSABLE = 'button:not([disabled]),input:not([disabled]),select:not([disabled]),textarea:not([disabled]),[tabindex]:not([tabindex="-1"])';

const shown = (el: Element) => (el as HTMLElement).getClientRects().length > 0;

/** The element a `data-as` is about: itself, or (an Elm wrapper with `display: contents`) its first child. */
const subject = (el: HTMLElement): HTMLElement => (getComputedStyle(el).display === "contents" ? ((el.firstElementChild as HTMLElement) ?? el) : el);

export function watchFocus(root: HTMLElement) {
  let open: string | undefined; // the name of the dialog that has the focus
  let opener: string | undefined; // what had the focus before it opened (its data-id, else data-el)
  const focusables = (el: HTMLElement) => Array.from(el.querySelectorAll<HTMLElement>(FOCUSABLE)).filter(shown);
  const dialogs = () =>
    Array.from(root.querySelectorAll<HTMLElement>('[data-as="dialog"],[data-as="drawer"]'))
      .map((w) => ({ kind: w.dataset.as!, el: subject(w) }))
      .filter((d) => shown(d.el));
  const sync = () => {
    const ds = dialogs();
    for (const { kind, el } of ds) {
      if (el.getAttribute("role") !== "dialog") el.setAttribute("role", "dialog");
      if (kind === "dialog" && el.getAttribute("aria-modal") !== "true") el.setAttribute("aria-modal", "true");
      const title = el.querySelector<HTMLElement>('[data-as="title"]');
      const t = title ? subject(title) : undefined;
      if (t) {
        t.id ||= `${el.dataset.el ?? "dialog"}-title`;
        if (el.getAttribute("aria-labelledby") !== t.id) el.setAttribute("aria-labelledby", t.id);
      }
      if (!el.hasAttribute("tabindex")) el.tabIndex = -1;
    }
    const top = ds[ds.length - 1]?.el;
    const name = top?.dataset.el;
    if (top && name !== open) {
      const a = document.activeElement as HTMLElement | null;
      if (!open) opener = a?.dataset?.id ? `[data-id="${CSS.escape(a.dataset.id)}"]` : a?.dataset?.el ? `[data-el="${CSS.escape(a.dataset.el)}"]` : undefined;
      open = name;
      if (!top.contains(document.activeElement)) (focusables(top)[0] ?? top).focus();
    } else if (!top && open) {
      open = undefined;
      const back = opener ? root.querySelector<HTMLElement>(opener) : null;
      opener = undefined;
      back?.focus();
    }
  };
  new MutationObserver(sync).observe(root, { childList: true, subtree: true, attributes: true, attributeFilter: ["style", "class", "hidden"] });
  // Tab and Shift+Tab go round inside the open dialog.
  root.addEventListener("keydown", (e) => {
    if (e.key !== "Tab" || !open) return;
    const top = dialogs().at(-1)?.el;
    if (!top) return;
    const f = focusables(top);
    if (!f.length) return e.preventDefault();
    const i = f.indexOf(document.activeElement as HTMLElement);
    if (e.shiftKey && i <= 0) (e.preventDefault(), f[f.length - 1].focus());
    else if (!e.shiftKey && (i === f.length - 1 || i < 0)) (e.preventDefault(), f[0].focus());
  });
  sync();
}
