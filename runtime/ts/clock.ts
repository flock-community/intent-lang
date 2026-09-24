// The clock outside tests: the local time, as a Date ("2026-09-24") and a DateTime ("2026-09-24T09:30").
// In tests the harness sets the clock instead (it starts at `examples start at …` and moves with `wait`).

export type Clock = { now: string; today: string };

export function localClock(d = new Date()): Clock {
  const p = (n: number) => String(n).padStart(2, "0");
  const today = `${String(d.getFullYear()).padStart(4, "0")}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
  return { today, now: `${today}T${p(d.getHours())}:${p(d.getMinutes())}` };
}

/** The clock at a moment given as "YYYY-MM-DDTHH:MM". */
export const clockAt = (now: string): Clock => ({ now, today: now.slice(0, 10) });
