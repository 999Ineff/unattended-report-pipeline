import { readdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { CallRecord, Day, ReportBatch } from "./adapters/types.ts";

const FILE_PATTERN = /^calls_(\d{4}-\d{2}-\d{2})\.csv$/;
const COLUMNS = ["id", "started_at", "from", "to", "duration_sec", "disposition"] as const;

export const reportPath = (outDir: string, day: Day) => join(outDir, `calls_${day}.csv`);

/** The report file existing is the record that a day is built. */
export async function builtDays(outDir: string): Promise<Set<Day>> {
  const files = await readdir(outDir).catch(() => [] as string[]);
  return new Set(files.flatMap((file) => FILE_PATTERN.exec(file)?.[1] ?? []));
}

// TODO(customer): replace with the customer's workbook layout.
export async function writeReport(outDir: string, day: Day, rows: CallRecord[]): Promise<void> {
  const lines = rows.map((r) =>
    [r.id, r.startedAt, r.from, r.to, r.durationSec, r.disposition].join(","),
  );
  await writeFile(reportPath(outDir, day), [COLUMNS.join(","), ...lines].join("\n"));
}

export function buildBatch(outDir: string, days: Day[]): ReportBatch {
  const span = days.length === 1 ? days[0] : `${days[0]} to ${days.at(-1)}`;
  return {
    days,
    subject: `Daily call report: ${span}`,
    attachments: days.map((day) => reportPath(outDir, day)),
  };
}
