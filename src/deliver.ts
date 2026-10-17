import type { Day, Mailer, ReportBatch } from "./adapters/types.ts";
import { clearMarker, exists, loadSent, readMarker, recordSent, writeMarker } from "./ledger.ts";

export type DeliverMode = "send" | "draft";

export interface DeliverPaths {
  ledger: string;
  marker: string;
  /** When this file exists, sends become drafts for human review. */
  killSwitch: string;
}

export interface DeliverResult {
  mode: DeliverMode | "nothing-to-do";
  days: Day[];
}

/**
 * Delivers exactly the days the customer does not already have.
 * Order matters: settle any interrupted send, dedupe against the mailbox, then
 * mark in-flight, send, record, clear.
 */
export async function deliver(
  days: Day[],
  requested: DeliverMode,
  mailer: Mailer,
  paths: DeliverPaths,
  buildBatch: (days: Day[]) => ReportBatch,
): Promise<DeliverResult> {
  const interrupted = await readMarker(paths.marker);
  const delivered = await mailer.deliveredDays([...new Set([...days, ...(interrupted ?? [])])]);

  if (interrupted) {
    const confirmed = interrupted.filter((day) => delivered.has(day));
    if (confirmed.length > 0) await recordSent(paths.ledger, confirmed);
    await clearMarker(paths.marker);
  }

  const ledger = await loadSent(paths.ledger);
  const pending = days.filter((day) => !ledger.has(day) && !delivered.has(day));
  if (pending.length === 0) return { mode: "nothing-to-do", days: [] };

  const batch = buildBatch(pending);
  const mode: DeliverMode = (await exists(paths.killSwitch)) ? "draft" : requested;

  if (mode === "draft") {
    // A draft is not a delivery; the days stay pending until a person sends it.
    await mailer.draft(batch);
    return { mode, days: pending };
  }

  await writeMarker(paths.marker, pending);
  await mailer.send(batch);
  await recordSent(paths.ledger, pending);
  await clearMarker(paths.marker);
  return { mode, days: pending };
}
