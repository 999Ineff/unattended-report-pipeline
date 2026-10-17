import { appendFile, mkdir, readFile } from "node:fs/promises";
import { dirname } from "node:path";
import type { Day } from "./adapters/types.ts";

export interface RunEvent {
  today: Day;
  startedAt: string;
  finishedAt: string;
  deliver: "none" | "send" | "draft";
  outcome: "ok" | "failed";
  pulled: Day[];
  delivered: Day[];
  warnings: string[];
  error?: { type: string; message: string };
}

export async function appendRun(path: string, event: RunEvent): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  await appendFile(path, `${JSON.stringify(event)}\n`);
}

export async function readRuns(path: string): Promise<RunEvent[]> {
  try {
    const text = await readFile(path, "utf8");
    return text
      .split("\n")
      .filter(Boolean)
      .map((line) => JSON.parse(line) as RunEvent);
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") return [];
    throw err;
  }
}
