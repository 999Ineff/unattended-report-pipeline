import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import { isWeekday } from "../schedule.ts";
import type { CallRecord, Day, Mailer, ReportBatch, SwitchClient } from "./types.ts";

const DISPOSITIONS = ["answered", "answered", "answered", "missed", "voicemail"] as const;

function seededRandom(seed: number): () => number {
  let state = seed;
  return () => (state = (state * 1103515245 + 12345) % 2 ** 31) / 2 ** 31;
}

function timeOfDay(second: number): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${pad(Math.floor(second / 3600))}:${pad(Math.floor((second % 3600) / 60))}:${pad(second % 60)}`;
}

/** Deterministic synthetic traffic; weekends run at about half of weekday volume. */
export class FakeSwitch implements SwitchClient {
  async fetchCalls(day: Day): Promise<CallRecord[]> {
    const random = seededRandom(Number(day.replaceAll("-", "")));
    const total = isWeekday(day)
      ? 700 + Math.floor(random() * 100)
      : 330 + Math.floor(random() * 60);

    return Array.from({ length: total }, (_, i) => ({
      id: `${day}-${i}`,
      startedAt: `${day}T${timeOfDay(Math.floor((i / total) * 86_399))}`,
      from: `ext-${100 + Math.floor(random() * 40)}`,
      to: `+1555${String(Math.floor(random() * 1e7)).padStart(7, "0")}`,
      durationSec: Math.floor(random() * 600),
      disposition: DISPOSITIONS[Math.floor(random() * DISPOSITIONS.length)]!,
    }));
  }

  async countCalls(day: Day): Promise<number> {
    return (await this.fetchCalls(day)).length;
  }
}

/** Prints instead of sending and persists "sent mail" so re-runs exercise deduplication. */
export class ConsoleMailer implements Mailer {
  readonly #sentMailPath: string;

  constructor(sentMailPath: string) {
    this.#sentMailPath = sentMailPath;
  }

  async #sentMail(): Promise<Day[]> {
    try {
      return JSON.parse(await readFile(this.#sentMailPath, "utf8")) as Day[];
    } catch {
      return [];
    }
  }

  async deliveredDays(days: Day[]): Promise<Set<Day>> {
    const sent = new Set(await this.#sentMail());
    return new Set(days.filter((day) => sent.has(day)));
  }

  async send(batch: ReportBatch): Promise<void> {
    console.log(`sent: ${batch.subject} (${batch.attachments.length} attachments)`);
    await mkdir(dirname(this.#sentMailPath), { recursive: true });
    await writeFile(
      this.#sentMailPath,
      JSON.stringify([...(await this.#sentMail()), ...batch.days]),
    );
  }

  async draft(batch: ReportBatch): Promise<void> {
    console.log(`draft: ${batch.subject}`);
  }

  async alert(subject: string, body: string): Promise<void> {
    console.error(`alert: ${subject}\n${body}`);
  }
}
