import type { CallRecord, Day } from "./adapters/types.ts";

export class ValidationError extends Error {
  override name = "ValidationError";
}

export class CountMismatchError extends Error {
  override name = "CountMismatchError";
}

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
      throw new ValidationError(`row ${row.id} has an invalid duration`);
    }
    seen.add(row.id);
  }
}

/** Catches truncated pagination and early pulls, both of which produce files that look fine. */
export function reconcile(day: Day, rowsHeld: number, switchCount: number): void {
  if (rowsHeld !== switchCount) {
    throw new CountMismatchError(`${day}: holding ${rowsHeld} rows, switch reports ${switchCount}`);
  }
}

/** Warns rather than blocks: weekends and holidays legitimately run low. */
export function volumeWarning(rows: number, baseline: number): string | null {
  if (baseline > 0 && rows < baseline * 0.25) {
    return `only ${rows} rows against a baseline of ${baseline}`;
  }
  return null;
}
