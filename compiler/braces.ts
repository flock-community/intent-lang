// Blocks with braces: `screen { … }`. Specs are written with braces (the canonical form); a file
// without them is read by its indentation, as before. The parser works on indentation: a braces
// file is turned into it first, line for line, so every diagnostic keeps its line number.

/** A line's code and its comment (a `#` outside strings). */
export function splitComment(line: string): [string, string] {
  let inStr = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (inStr && c === "\\") i++;
    else if (c === '"') inStr = !inStr;
    else if (c === "#" && !inStr) return [line.slice(0, i), line.slice(i)];
  }
  return [line, ""];
}

const code = (line: string) => splitComment(line)[0].trim();
const opens = (c: string) => c.endsWith("{");

/** Does this spec use braces for its blocks? */
export function usesBraces(src: string): boolean {
  return src.split(/\r?\n/).some((l) => {
    const c = code(l);
    return c === "}" || opens(c);
  });
}

/**
 * Braces → indentation, one line for one line: `x {` becomes `x` with its block indented under it,
 * a line with only `}` (or only `{`) becomes empty. With `keepLines: false` those lines are dropped
 * instead (for the formatter). Files without braces come back unchanged.
 */
export function fromBraces(src: string, keepLines = true): { text: string; errors: { line: number; message: string }[] } {
  if (!usesBraces(src)) return { text: src, errors: [] };
  const out: string[] = [];
  const errors: { line: number; message: string }[] = [];
  const openedAt: number[] = [];
  src.split(/\r?\n/).forEach((raw, i) => {
    const [c0, comment] = splitComment(raw);
    const c = c0.trim();
    const depth = openedAt.length;
    if (c === "}") {
      if (!openedAt.length) errors.push({ line: i + 1, message: "`}` closes a block that was never opened" });
      else openedAt.pop();
      if (keepLines) out.push("");
      return;
    }
    if (c === "{") {
      // `{` on a line of its own opens the block of the line above.
      openedAt.push(i + 1);
      if (keepLines) out.push("");
      return;
    }
    if (!c) {
      out.push(comment ? " ".repeat(depth * 2) + comment : "");
      return;
    }
    const content = opens(c) ? c.slice(0, -1).trimEnd() : c;
    const gap = c0.match(/\s*$/)![0] || "  "; // keep aligned comments aligned
    out.push(" ".repeat(depth * 2) + content + (comment ? gap + comment : ""));
    if (opens(c)) openedAt.push(i + 1);
  });
  for (const at of openedAt) errors.push({ line: at, message: "this `{` is never closed: add `}` at the end of its block" });
  return { text: out.join("\n"), errors };
}

/** Indentation → braces: a line with indented lines under it gets `{`, its block ends with `}`. Comments and blank lines stay where they are. */
export function toBraces(src: string): string {
  if (usesBraces(src)) src = fromBraces(src, false).text;
  const lines = src.split(/\r?\n/);
  const indent = (l: string) => l.length - l.trimStart().length;
  const structural = (l: string) => code(l) !== "";
  const out: string[] = [];
  const open: number[] = []; // indentation of each open block's first line
  let pending: string[] = []; // blank and comment-only lines, placed after the blocks that close before the next line
  const closeTo = (level: number) => {
    while (open.length && open[open.length - 1] >= level) out.push(" ".repeat(open.pop()!) + "}");
  };
  for (let i = 0; i < lines.length; i++) {
    const l = lines[i];
    if (!structural(l)) {
      pending.push(l);
      continue;
    }
    const me = indent(l);
    closeTo(me);
    out.push(...pending);
    pending = [];
    let j = i + 1;
    while (j < lines.length && !structural(lines[j])) j++;
    if (j < lines.length && indent(lines[j]) > me) {
      const [c, comment] = splitComment(l);
      out.push(c.trimEnd() + " {" + (comment ? "  " + comment : ""));
      open.push(me);
    } else out.push(l.trimEnd());
  }
  closeTo(0);
  out.push(...pending);
  return out.join("\n");
}
