import { mkdir, open, readFile, rename, rm, stat, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import type { Day } from "./adapters/types.ts";

export class LockTimeoutError extends Error {
  override name = "LockTimeoutError";
}

const isMissing = (err: unknown) => (err as NodeJS.ErrnoException).code === "ENOENT";

export async function exists(path: string): Promise<boolean> {
  return stat(path).then(
    () => true,
    () => false,
  );
}

export async function loadSent(path: string): Promise<Set<Day>> {
  try {
    return new Set(JSON.parse(await readFile(path, "utf8")) as Day[]);
  } catch (err) {
    if (isMissing(err)) return new Set();
    throw err;
  }
}

/** Call only after a successful send; recording first would make a failed send look delivered. */
export async function recordSent(path: string, days: Day[]): Promise<void> {
  const sent = await loadSent(path);
  for (const day of days) sent.add(day);
  await mkdir(dirname(path), { recursive: true });
  const tmp = `${path}.tmp`;
  await writeFile(tmp, JSON.stringify([...sent].sort(), null, 2));
  await rename(tmp, path);
}

/** Serializes runs over one data directory, e.g. both timers firing together after a reboot. */
export async function withRunLock<T>(
  lockPath: string,
  fn: () => Promise<T>,
  { waitMs = 30 * 60_000, pollMs = 2_000 } = {},
): Promise<T> {
  await mkdir(dirname(lockPath), { recursive: true });
  const deadline = Date.now() + waitMs;

  for (;;) {
    try {
      const handle = await open(lockPath, "wx");
      await handle.writeFile(`${process.pid} ${new Date().toISOString()}\n`);
      await handle.close();
      break;
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code !== "EEXIST") throw err;
      if (Date.now() > deadline) throw new LockTimeoutError(`lock still held: ${lockPath}`);
      await new Promise((resolve) => setTimeout(resolve, pollMs));
    }
  }

  try {
    return await fn();
  } finally {
    await rm(lockPath, { force: true });
  }
}

/**
 * Covers the window between the mail server accepting a send and the ledger being written.
 * A leftover marker means those days must be confirmed against the mailbox.
 */
export async function writeMarker(path: string, days: Day[]): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, JSON.stringify({ days, at: new Date().toISOString() }));
}

export async function readMarker(path: string): Promise<Day[] | null> {
  try {
    return (JSON.parse(await readFile(path, "utf8")) as { days: Day[] }).days;
  } catch (err) {
    if (isMissing(err)) return null;
    throw err;
  }
}

export async function clearMarker(path: string): Promise<void> {
  await rm(path, { force: true });
}
