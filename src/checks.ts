/**
 * Area 2: the checks that stand between a pull and a customer's inbox.
 *
 * Every check fails closed. A bad day stops the run and pages the operator; it is never
 * "mostly fine" and sent anyway.
 */

import type { CallRecord, Day } from "./adapters/types.ts";

export class ValidationError extends Error {}
export class CountMismatchError extends Error {}

/** Rows belong to the day they claim, carry what the report needs, and appear once. */
export function validateRows(rows: CallRecord[], day: Day): void {
  const seen = new Set<string>();
  for (const row of rows) {
    if (!row.id || !row.startedAt) {
      throw new ValidationError(`row without id or start time on ${day}`);
    }
    if (!row.startedAt.startsWith(day)) {
      throw new ValidationError(`row ${row.id} starts ${row.startedAt}, outside ${day}`);
    }
    if (seen.has(row.id)) {
      throw new ValidationError(`row ${row.id} appears twice on ${day}`);
    }
    if (!Number.isFinite(row.durationSec) || row.durationSec < 0) {
      throw new ValidationError(`row ${row.id} has an impossible duration`);
    }
    seen.add(row.id);
  }
}

/**
 * The rows we hold must match the switch's own count for the day.
 *
 * This is the check that catches a paginated API quietly stopping at page 40, or a pull that
 * ran before the day closed. Both produce a file that opens fine and is wrong.
 */
export function reconcile(day: Day, rowsHeld: number, switchCount: number): void {
  if (rowsHeld !== switchCount) {
    throw new CountMismatchError(
      `${day}: holding ${rowsHeld} rows but the switch reports ${switchCount}`,
    );
  }
}

/**
 * A soft signal, not a failure: a day far below the recent norm.
 *
 * Volume legitimately dips on weekends and holidays, so this warns instead of blocking.
 * The run log records it, and the watchdog can surface a trend.
 */
export function volumeWarning(rows: number, recentWeekdayAverage: number): string | null {
  if (recentWeekdayAverage > 0 && rows < recentWeekdayAverage * 0.25) {
    return `only ${rows} rows against a recent average of ${Math.round(recentWeekdayAverage)}`;
  }
  return null;
}
