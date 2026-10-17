/**
 * Stand-ins so the pipeline runs end to end with no vendor accounts.
 *
 * FakeSwitch produces deterministic synthetic call records (weekends at about half a weekday's
 * volume, like a real business line). ConsoleMailer prints instead of sending and remembers what
 * it "sent", so re-runs exercise the dedupe path.
 *
 * TODO(deploy): replace with real adapters. A production SwitchClient wraps the switch's
 * call-history API (paginated, rate-limited, one closed day per request); a production Mailer
 * sends over SMTP or a provider API and answers deliveredDays() by reading Sent Mail.
 */

import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import type { CallRecord, Day, Mailer, ReportBatch, SwitchClient } from "./types.ts";
import { isWeekday } from "../schedule.ts";

function seeded(seed: number): () => number {
  let s = seed;
  return () => ((s = (s * 1103515245 + 12345) % 2 ** 31) / 2 ** 31);
}

export class FakeSwitch implements SwitchClient {
  async fetchCalls(day: Day): Promise<CallRecord[]> {
    const rand = seeded(Number(day.replaceAll("-", "")));
    const total = isWeekday(day) ? 700 + Math.floor(rand() * 100) : 330 + Math.floor(rand() * 60);
    const dispositions = ["answered", "answered", "answered", "missed", "voicemail"] as const;
    return Array.from({ length: total }, (_, i) => {
      const second = Math.floor((i / total) * 86_399);
      const hh = String(Math.floor(second / 3600)).padStart(2, "0");
      const mm = String(Math.floor((second % 3600) / 60)).padStart(2, "0");
      const ss = String(second % 60).padStart(2, "0");
      return {
        id: `${day}-${i}`,
        startedAt: `${day}T${hh}:${mm}:${ss}`,
        from: `ext-${100 + Math.floor(rand() * 40)}`,
        to: `+1555${String(Math.floor(rand() * 1e7)).padStart(7, "0")}`,
        durationSec: Math.floor(rand() * 600),
        disposition: dispositions[Math.floor(rand() * dispositions.length)]!,
      };
    });
  }

  async countCalls(day: Day): Promise<number> {
    return (await this.fetchCalls(day)).length;
  }
}

export class ConsoleMailer implements Mailer {
  private readonly sentMailPath: string;

  constructor(sentMailPath: string) {
    this.sentMailPath = sentMailPath;
  }

  private async sentMail(): Promise<Day[]> {
    try {
      return JSON.parse(await readFile(this.sentMailPath, "utf8")) as Day[];
    } catch {
      return [];
    }
  }

  async deliveredDays(days: Day[]): Promise<Set<Day>> {
    const sent = new Set(await this.sentMail());
    return new Set(days.filter((d) => sent.has(d)));
  }

  async send(batch: ReportBatch): Promise<void> {
    console.log(`SEND  "${batch.subject}"  attachments: ${batch.attachments.join(", ")}`);
    await mkdir(dirname(this.sentMailPath), { recursive: true });
    await writeFile(this.sentMailPath, JSON.stringify([...(await this.sentMail()), ...batch.days]));
  }

  async draft(batch: ReportBatch): Promise<void> {
    console.log(`DRAFT "${batch.subject}" left for a human to send`);
  }

  async alert(subject: string, body: string): Promise<void> {
    console.error(`ALERT ${subject}\n${body}`);
  }
}
