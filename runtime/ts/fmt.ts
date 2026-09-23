// Standard formatting and parsing helpers. Must behave exactly like runtime/elm/Fmt.elm.

/** `x` with exactly `places` decimals, rounding half away from zero. fixed(2, 1.005) === "1.01" */
export function fixed(places: number, x: number): string {
  const f = Math.pow(10, places);
  const r = Math.floor(Math.abs(x) * f + 0.5 + 1e-9);
  const sign = x < 0 && r !== 0 ? "-" : "";
  const digits = String(r).padStart(places + 1, "0");
  return places === 0 ? sign + digits : sign + digits.slice(0, digits.length - places) + "." + digits.slice(digits.length - places);
}

/** At most `places` decimals, trailing zeros (and a trailing ".") removed. decimal(8, 0.1 + 0.2) === "0.3" */
export function decimal(places: number, x: number): string {
  const s = fixed(places, x);
  return s.includes(".") ? s.replace(/0+$/, "").replace(/\.$/, "") : s;
}

/** Money: two decimals. money(3.5) === "3.50" */
export function money(x: number): string {
  return fixed(2, x);
}

/** Plain digits. int(-3) === "-3" */
export function int(n: number): string {
  return n === 0 ? "0" : String(Math.trunc(n));
}

/** Seconds as a clock: "m:ss", or "h:mm:ss" from one hour up. clock(1500) === "25:00" */
export function clock(totalSeconds: number): string {
  const s = Math.max(0, Math.floor(totalSeconds));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const ss = s % 60;
  const two = (n: number) => String(n).padStart(2, "0");
  return h > 0 ? `${h}:${two(m)}:${two(ss)}` : `${m}:${two(ss)}`;
}

/** A decimal typed by a user: `-?digits([.,]digits)?`, surrounding spaces ignored. null otherwise. */
export function parseDecimal(text: string): number | null {
  const s = text.trim();
  return /^-?\d+([.,]\d+)?$/.test(s) ? Number(s.replace(",", ".")) : null;
}

/** A whole number typed by a user. null if not a whole number. */
export function parseInt(text: string): number | null {
  const s = text.trim();
  return /^-?\d+$/.test(s) ? Number(s) : null;
}

// Rounding. Every build must round through these (never a home-made epsilon), so builds agree to the last cent.
const EPS = 1e-9;

/** Round to `places` decimals, half away from zero. roundTo(2, 1.875) === 1.88 */
export function roundTo(places: number, x: number): number {
  const f = Math.pow(10, places);
  const r = Math.floor(Math.abs(x) * f + 0.5 + EPS);
  return (x < 0 ? -r : r) / f;
}

/** Round up (towards +infinity) to `places` decimals. roundUpTo(2, 36.6666) === 36.67 */
export function roundUpTo(places: number, x: number): number {
  const f = Math.pow(10, places);
  return Math.ceil(x * f - EPS) / f;
}

/** Round down (towards -infinity) to `places` decimals. roundDownTo(2, 36.6666) === 36.66 */
export function roundDownTo(places: number, x: number): number {
  const f = Math.pow(10, places);
  return Math.floor(x * f + EPS) / f;
}

/** A money amount as whole cents, half away from zero. cents(12.345) === 1235 */
export function cents(x: number): number {
  const r = Math.floor(Math.abs(x) * 100 + 0.5 + EPS);
  return x < 0 ? -r : r;
}
