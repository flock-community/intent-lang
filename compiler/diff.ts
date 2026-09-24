// Comparing JSON values: a stable text for equality, and where two values first differ.

/** JSON with sorted keys: the same call reads the same from every build. */
export const stable = (v: unknown): string =>
  Array.isArray(v) ? `[${v.map(stable).join(",")}]` : v && typeof v === "object" ? `{${Object.keys(v).sort().map((k) => `${JSON.stringify(k)}:${stable((v as Record<string, unknown>)[k])}`).join(",")}}` : JSON.stringify(v ?? null);

/** Where two values first differ, briefly: `row 9: saved {…}, after the restart missing`. */
export function difference(saved: unknown, back: unknown, at = ""): string {
  const show = (v: unknown) => (v === undefined ? "missing" : JSON.stringify(v).slice(0, 300));
  if (Array.isArray(saved) && Array.isArray(back)) {
    for (let i = 0; i < Math.max(saved.length, back.length); i++)
      if (stable(saved[i]) !== stable(back[i])) return difference(saved[i], back[i], `${at}row ${i + 1}`);
  } else if (saved && back && typeof saved === "object" && typeof back === "object") {
    for (const k of new Set([...Object.keys(saved), ...Object.keys(back)]))
      if (stable((saved as any)[k]) !== stable((back as any)[k])) return difference((saved as any)[k], (back as any)[k], `${at ? `${at}, ` : ""}${k}`);
  }
  return `${at ? `${at}: ` : ""}saved ${show(saved)}, after the restart ${show(back)}`;
}

