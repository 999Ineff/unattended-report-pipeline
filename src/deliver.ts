/**
 * Area 3 (part 2): deliver exactly the days the customer does not already have.
 *
 * Order of operations is the whole design:
 *   1. ask the mailbox what was already delivered (ground truth), merge with the ledger
 *   2. drop those days; if nothing is left, stop
 *   3. kill switch present? leave a draft for a human instead of sending
 *   4. write the in-flight marker, send, record in the ledger, clear the marker
 */

import type { Day, Mailer, ReportBatch } from "./adapters/types.ts";
import { clearMarker, exists, loadSent, readMarker, recordSent, writeMarker } from "./ledger.ts";

export type DeliverMode = "send" | "draft";

export interface DeliverPaths {
  ledger: string;
  marker: string;
  /** `touch` this file on the server to turn automatic sends back into drafts. No deploy needed. */
  killSwitch: string;
}

export interface DeliverResult {
  mode: DeliverMode | "nothing-to-do";
  days: Day[];
}

export async function deliver(
  days: Day[],
  requested: DeliverMode,
  mailer: Mailer,
  paths: DeliverPaths,
  buildBatch: (days: Day[]) => ReportBatch,
): Promise<DeliverResult> {
  // A leftover marker means a previous send may have gone out without being recorded.
  // The mailbox decides, never the ledger.
  const leftover = await readMarker(paths.marker);
  const fromMailbox = await mailer.deliveredDays([...new Set([...days, ...(leftover ?? [])])]);
  if (leftover) {
    const confirmed = leftover.filter((d) => fromMailbox.has(d));
    if (confirmed.length) await recordSent(paths.ledger, confirmed);
    await clearMarker(paths.marker);
  }

  const ledger = await loadSent(paths.ledger);
  const todo = days.filter((d) => !ledger.has(d) && !fromMailbox.has(d));
  if (todo.length === 0) return { mode: "nothing-to-do", days: [] };

  const batch = buildBatch(todo);

  const mode: DeliverMode = (await exists(paths.killSwitch)) ? "draft" : requested;
  if (mode === "draft") {
    // A draft is not a delivery: the days stay outstanding until a human sends it.
    await mailer.draft(batch);
    return { mode, days: todo };
  }

  await writeMarker(paths.marker, todo);
  await mailer.send(batch); // throws on failure: the ledger is untouched, the days retry next run
  await recordSent(paths.ledger, todo);
  await clearMarker(paths.marker);
  return { mode, days: todo };
}
