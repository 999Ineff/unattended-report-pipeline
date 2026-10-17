/**
 * Area 3 (part 1): state that makes re-running always safe.
 *
 * The filesystem is the record of what was pulled and built: the file existing is the proof.
 * Only "sent" needs a ledger, because sending leaves nothing on disk.
 */

import { mkdir, open, readFile, rename, rm, stat, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import type { Day } from "./adapters/types.ts";

export async function loadSent(path: string): Promise<Set<Day>> {
  try {
    return new Set(JSON.parse(await readFile(path, "utf8")) as Day[]);
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") return new Set();
    throw err; // a corrupt ledger must stop the run, not read as "nothing sent"
  }
}

/**
 * Record days as delivered. Call this only AFTER the send succeeded: writing it first would make
 * a failed send look delivered, and those days would never go out.
 * Written to a temp file and renamed, so a crash mid-write cannot leave half a ledger.
 */
export async function recordSent(path: string, days: Day[]): Promise<void> {
  const sent = await loadSent(path);
  for (const d of days) sent.add(d);
  await mkdir(dirname(path), { recursive: true });
  const tmp = `${path}.tmp`;
  await writeFile(tmp, JSON.stringify([...sent].sort(), null, 2));
  await rename(tmp, path);
}

export class LockTimeoutError extends Error {}

/**
 * One run at a time over the same data directory, whichever timer started it.
 *
 * After a reboot, Persistent=true fires the pull and send timers together; the lock makes them
 * queue instead of race, so the send never looks at a half-built day.
 */
export async function withRunLock<T>(
  lockPath: string,
  fn: () => Promise<T>,
  waitMs = 30 * 60_000,
  pollMs = 2_000,
): Promise<T> {
  await mkdir(dirname(lockPath), { recursive: true });
  const deadline = Date.now() + waitMs;
  for (;;) {
    try {
      const handle = await open(lockPath, "wx"); // fails if the file already exists
      await handle.writeFile(`${process.pid} ${new Date().toISOString()}\n`);
      await handle.close();
      break;
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code !== "EEXIST") throw err;
      if (Date.now() > deadline) {
        throw new LockTimeoutError(`lock held longer than any healthy run: ${lockPath}`);
      }
      await new Promise((r) => setTimeout(r, pollMs));
    }
  }
  try {
    return await fn();
  } finally {
    await rm(lockPath, { force: true });
  }
}

/**
 * The in-flight marker covers the one moment the ledger cannot: after the mail server accepted
 * the send, before the ledger was written. If a run finds a leftover marker, it must not trust the
 * ledger for those days; it asks the mailbox instead (see deliver.ts).
 */
export async function writeMarker(path: string, days: Day[]): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, JSON.stringify({ days, at: new Date().toISOString() }));
}

export async function readMarker(path: string): Promise<Day[] | null> {
  try {
    return (JSON.parse(await readFile(path, "utf8")) as { days: Day[] }).days;
  } catch {
    return null;
  }
}

export async function clearMarker(path: string): Promise<void> {
  await rm(path, { force: true });
}

export async function exists(path: string): Promise<boolean> {
  return stat(path).then(() => true, () => false);
}
