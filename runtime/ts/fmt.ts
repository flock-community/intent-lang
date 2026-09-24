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

// ---------------------------------------------------------------- dates and moments
// A Date is "YYYY-MM-DD", a DateTime "YYYY-MM-DDTHH:MM", both in the app's own local time. As text
// they compare and sort correctly, travel as JSON unchanged, and are the same in every target.

const pad = (n: number, w = 2) => String(n).padStart(w, "0");
const num = (s: string) => Number(s);

/** Days since 1970-01-01 (proleptic Gregorian calendar). */
function daysFromCivil(y: number, m: number, d: number): number {
  const yy = m <= 2 ? y - 1 : y;
  const era = Math.floor(yy / 400);
  const yoe = yy - era * 400;
  const doy = Math.floor((153 * (m > 2 ? m - 3 : m + 9) + 2) / 5) + d - 1;
  const doe = yoe * 365 + Math.floor(yoe / 4) - Math.floor(yoe / 100) + doy;
  return era * 146097 + doe - 719468;
}

function civilFromDays(days: number): [number, number, number] {
  const z = days + 719468;
  const era = Math.floor(z / 146097);
  const doe = z - era * 146097;
  const yoe = Math.floor((doe - Math.floor(doe / 1460) + Math.floor(doe / 36524) - Math.floor(doe / 146096)) / 365);
  const doy = doe - (365 * yoe + Math.floor(yoe / 4) - Math.floor(yoe / 100));
  const mp = Math.floor((5 * doy + 2) / 153);
  const d = doy - Math.floor((153 * mp + 2) / 5) + 1;
  const m = mp < 10 ? mp + 3 : mp - 9;
  return [yoe + era * 400 + (m <= 2 ? 1 : 0), m, d];
}

const dayNumber = (date: string) => daysFromCivil(num(date.slice(0, 4)), num(date.slice(5, 7)), num(date.slice(8, 10)));
const fromDayNumber = (n: number) => {
  const [y, m, d] = civilFromDays(n);
  return `${pad(y, 4)}-${pad(m)}-${pad(d)}`;
};
const minuteNumber = (dt: string) => dayNumber(dt.slice(0, 10)) * 1440 + num(dt.slice(11, 13)) * 60 + num(dt.slice(14, 16));
const fromMinuteNumber = (n: number) => {
  const day = Math.floor(n / 1440);
  const r = n - day * 1440;
  return `${fromDayNumber(day)}T${pad(Math.floor(r / 60))}:${pad(r % 60)}`;
};

/** The date n days later (earlier when n < 0). addDays("2026-02-27", 2) === "2026-03-01" */
export function addDays(date: string, n: number): string {
  return fromDayNumber(dayNumber(date) + n);
}

/** Whole days from one date to another: daysBetween("2026-09-24", "2026-10-01") === 7 */
export function daysBetween(from: string, to: string): number {
  return dayNumber(to) - dayNumber(from);
}

const WEEKDAYS = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"];
/** The day of the week, in English: weekday("2026-09-24") === "Thursday" */
export function weekday(date: string): string {
  return WEEKDAYS[(((dayNumber(date) + 3) % 7) + 7) % 7];
}

/** The date of a moment: dateOf("2026-09-24T09:30") === "2026-09-24" */
export function dateOf(dateTime: string): string {
  return dateTime.slice(0, 10);
}

/** The time of day of a moment: timeOf("2026-09-24T09:30") === "09:30" */
export function timeOf(dateTime: string): string {
  return dateTime.slice(11, 16);
}

/** The moment n minutes later: addMinutes("2026-09-24T23:50", 15) === "2026-09-25T00:05" */
export function addMinutes(dateTime: string, n: number): string {
  return fromMinuteNumber(minuteNumber(dateTime) + n);
}

/** Whole minutes from one moment to another. */
export function minutesBetween(from: string, to: string): number {
  return minuteNumber(to) - minuteNumber(from);
}

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
/** A date for people: formatDate("2026-09-04") === "4 Sep 2026" */
export function formatDate(date: string): string {
  return `${num(date.slice(8, 10))} ${MONTHS[num(date.slice(5, 7)) - 1]} ${date.slice(0, 4)}`;
}

/** A moment for people: formatDateTime("2026-09-04T09:05") === "4 Sep 2026 09:05" */
export function formatDateTime(dateTime: string): string {
  return `${formatDate(dateTime.slice(0, 10))} ${timeOf(dateTime)}`;
}

/** A date typed as "YYYY-MM-DD" (spaces around ignored), only when it exists. parseDate("2026-02-30") === null */
export function parseDate(text: string): string | null {
  const t = text.trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(t)) return null;
  return fromDayNumber(dayNumber(t)) === t ? t : null;
}

/** A moment typed as "YYYY-MM-DD HH:MM" or "YYYY-MM-DDTHH:MM", only when it exists. */
export function parseDateTime(text: string): string | null {
  const m = text.trim().match(/^(\d{4}-\d{2}-\d{2})[T ](\d{2}):(\d{2})$/);
  if (!m || parseDate(m[1]) === null || num(m[2]) > 23 || num(m[3]) > 59) return null;
  return `${m[1]}T${m[2]}:${m[3]}`;
}
