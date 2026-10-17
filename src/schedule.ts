/**
 * Area 1: when to pull, when to send, and which days a send may carry.
 *
 * Two jobs, not one:
 *   PULL  every day      -> yesterday (plus anything missed), one day per file
 *   SEND  weekdays only  -> every built-but-unsent day, as one email
 *
 * That shape produces the cadence the customer expects with no special cases: Monday's send
 * carries Friday, Saturday and Sunday, and a holiday simply means the next send carries more.
 */

import type { Day } from "./adapters/types.ts";

export class MissingDayError extends Error {}

/** The report's "today" in the customer's timezone. The server clock is UTC. */
export function reportToday(now: Date, timeZone: string): Day {
  // en-CA formats as YYYY-MM-DD.
  return new Intl.DateTimeFormat("en-CA", { timeZone }).format(now);
}

export function addDays(day: Day, n: number): Day {
  const d = new Date(`${day}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

export function isWeekday(day: Day): boolean {
  const dow = new Date(`${day}T00:00:00Z`).getUTCDay();
  return dow >= 1 && dow <= 5;
}

/**
 * Days that should have been pulled but were not, oldest first.
 *
 * Never includes today: a day's call history is not closed until midnight, so pulling it would
 * produce a short file that looks complete.
 */
export function missingPulls(today: Day, pulled: Set<Day>, lookbackDays: number): Day[] {
  const missing: Day[] = [];
  for (let back = lookbackDays; back >= 1; back--) {
    const day = addDays(today, -back);
    if (!pulled.has(day)) missing.push(day);
  }
  return missing;
}

/**
 * The days the next send should carry: built, not yet sent, oldest first.
 *
 * A gap is a hard stop. Weekend volume runs at roughly half a weekday's, so an email carrying
 * Friday and Sunday but not Saturday would look normal to everyone who opened it. Refusing to
 * send beats sending something plausible and wrong.
 */
export function sendableDays(built: Set<Day>, sent: Set<Day>, today: Day): Day[] {
  const outstanding = [...built].filter((d) => !sent.has(d) && d < today).sort();
  if (outstanding.length === 0) return [];

  const lastSent = [...sent].sort().at(-1);
  const expectedFirst = lastSent ? addDays(lastSent, 1) : outstanding[0]!;

  let expected = expectedFirst;
  for (const day of outstanding) {
    if (day !== expected) {
      throw new MissingDayError(`expected ${expected} before ${day}; pull it before sending`);
    }
    expected = addDays(day, 1);
  }
  // Everything up to yesterday must be built, or the batch is short at the end.
  const yesterday = addDays(today, -1);
  if (outstanding.at(-1)! < yesterday) {
    throw new MissingDayError(`${addDays(outstanding.at(-1)!, 1)} is not built yet`);
  }
  return outstanding;
}
