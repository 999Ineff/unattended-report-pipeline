import type { Day } from "./adapters/types.ts";

export class MissingDayError extends Error {
  override name = "MissingDayError";
}

export function reportToday(now: Date, timeZone: string): Day {
  return new Intl.DateTimeFormat("en-CA", { timeZone }).format(now);
}

export function addDays(day: Day, n: number): Day {
  const date = new Date(`${day}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() + n);
  return date.toISOString().slice(0, 10);
}

export function isWeekday(day: Day): boolean {
  const weekday = new Date(`${day}T00:00:00Z`).getUTCDay();
  return weekday >= 1 && weekday <= 5;
}

/** Closed days in the lookback window that have not been pulled. Today is never closed. */
export function missingPulls(today: Day, pulled: Set<Day>, lookbackDays: number): Day[] {
  const missing: Day[] = [];
  for (let back = lookbackDays; back >= 1; back--) {
    const day = addDays(today, -back);
    if (!pulled.has(day)) missing.push(day);
  }
  return missing;
}

/**
 * Built-but-unsent days for the next delivery, oldest first.
 *
 * Any gap is fatal: weekend volume is about half a weekday's, so a batch missing Saturday
 * would look normal to everyone who opened it.
 */
export function sendableDays(built: Set<Day>, sent: Set<Day>, today: Day): Day[] {
  const outstanding = [...built].filter((day) => !sent.has(day) && day < today).sort();
  const first = outstanding[0];
  const last = outstanding.at(-1);
  if (first === undefined || last === undefined) return [];

  const lastSent = [...sent].sort().at(-1);
  let expected = lastSent ? addDays(lastSent, 1) : first;
  for (const day of outstanding) {
    if (day !== expected) {
      throw new MissingDayError(`${expected} is missing before ${day}`);
    }
    expected = addDays(day, 1);
  }

  if (last < addDays(today, -1)) {
    throw new MissingDayError(`${addDays(last, 1)} is not built yet`);
  }
  return outstanding;
}
