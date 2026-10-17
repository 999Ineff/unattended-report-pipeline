/**
 * One morning's work, start to finish: pull what is missing, check it, build it, deliver what is
 * outstanding. Both systemd timers run this same entry point with a different --deliver.
 *
 *   node src/daily.ts --deliver none   # 05:05, pull and build only
 *   node src/daily.ts --deliver send   # 08:00, also deliver (weekdays only)
 *   node src/daily.ts --deliver send --dry-run --today 2026-10-19   # safe anywhere
 */

import { mkdir, readdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { parseArgs } from "node:util";
import type { CallRecord, Day, Mailer, ReportBatch, SwitchClient } from "./adapters/types.ts";
import { ConsoleMailer, FakeSwitch } from "./adapters/fakes.ts";
import { reconcile, validateRows, volumeWarning } from "./checks.ts";
import { deliver } from "./deliver.ts";
import { loadSent, withRunLock } from "./ledger.ts";
import { appendRun, type RunEvent } from "./runlog.ts";
import { isWeekday, missingPulls, reportToday, sendableDays } from "./schedule.ts";

interface Options {
  base: string;
  today: Day;
  deliver: "none" | "send" | "draft";
  dryRun: boolean;
  lookback: number;
  killSwitch: string;
}

const paths = (base: string) => ({
  out: join(base, "out"),
  state: join(base, "state"),
  lock: join(base, "state", ".run.lock"),
  ledger: join(base, "state", "sent.json"),
  marker: join(base, "state", "send.inflight"),
  runs: join(base, "state", "runs.jsonl"),
});

/** The built report for a day. The file existing is the record that the day is built. */
const reportFile = (out: string, day: Day) => join(out, `calls_${day}.csv`);

async function builtDays(out: string): Promise<Set<Day>> {
  const files = await readdir(out).catch(() => [] as string[]);
  return new Set(files.map((f) => /^calls_(\d{4}-\d{2}-\d{2})\.csv$/.exec(f)?.[1]).filter((d): d is Day => !!d));
}

/** TODO(customer): match the customer's real layout (columns, summary tab, workbook format). */
function toCsv(rows: CallRecord[]): string {
  const header = "id,started_at,from,to,duration_sec,disposition";
  return [header, ...rows.map((r) => [r.id, r.startedAt, r.from, r.to, r.durationSec, r.disposition].join(","))].join("\n");
}

function batchFor(out: string, days: Day[]): ReportBatch {
  const span = days.length === 1 ? days[0]! : `${days[0]} to ${days.at(-1)}`;
  return { days, subject: `Daily call report: ${span}`, attachments: days.map((d) => reportFile(out, d)) };
}

export async function run(opts: Options, sw: SwitchClient, mailer: Mailer): Promise<RunEvent> {
  const p = paths(opts.base);
  const startedAt = new Date().toISOString();
  const event: RunEvent = {
    today: opts.today, startedAt, finishedAt: startedAt, deliver: opts.deliver,
    outcome: "ok", pulled: [], delivered: [], warnings: [],
  };

  try {
    await withRunLock(p.lock, async () => {
      await mkdir(p.out, { recursive: true });

      // Pull and build every missing closed day, oldest first. Each day is checked on its own,
      // so one bad day stops the run before anything is delivered.
      for (const day of missingPulls(opts.today, await builtDays(p.out), opts.lookback)) {
        const rows = await sw.fetchCalls(day);
        validateRows(rows, day);
        reconcile(day, rows.length, await sw.countCalls(day));
        const warning = volumeWarning(rows.length, 700);
        if (warning) event.warnings.push(`${day}: ${warning}`);
        if (!opts.dryRun) await writeFile(reportFile(p.out, day), toCsv(rows));
        event.pulled.push(day);
      }

      if (opts.deliver === "none" || !isWeekday(opts.today) || opts.dryRun) return;

      const days = sendableDays(await builtDays(p.out), await loadSent(p.ledger), opts.today);
      if (days.length === 0) return;
      const result = await deliver(days, opts.deliver, mailer,
        { ledger: p.ledger, marker: p.marker, killSwitch: opts.killSwitch },
        (d) => batchFor(p.out, d));
      if (result.mode === "send") event.delivered = result.days;
    });
  } catch (err) {
    event.outcome = "failed";
    event.error = { type: (err as Error).name, message: (err as Error).message };
    await mailer.alert(`report run FAILED for ${opts.today}`, `${event.error.type}: ${event.error.message}`);
  } finally {
    event.finishedAt = new Date().toISOString();
    if (!opts.dryRun) await appendRun(p.runs, event);
  }
  return event;
}

async function main(): Promise<number> {
  const { values } = parseArgs({
    options: {
      base: { type: "string", default: "/var/lib/report-pipeline" },
      deliver: { type: "string" },
      today: { type: "string" },
      tz: { type: "string", default: "America/New_York" },
      lookback: { type: "string", default: "7" },
      "dry-run": { type: "boolean", default: false },
      "kill-switch": { type: "string", default: "/etc/report-pipeline/autosend-off" },
    },
  });
  if (!["none", "send", "draft"].includes(values.deliver ?? "")) {
    console.error("--deliver is required: none | send | draft");
    return 2;
  }
  const base = values.base!;
  const event = await run(
    {
      base,
      today: values.today ?? reportToday(new Date(), values.tz!),
      deliver: values.deliver as Options["deliver"],
      dryRun: values["dry-run"]!,
      lookback: Number(values.lookback),
      killSwitch: values["kill-switch"]!,
    },
    new FakeSwitch(), // TODO(deploy): real SwitchClient
    new ConsoleMailer(join(base, "fake-sent-mail.json")), // TODO(deploy): real Mailer
  );
  console.log(`${event.outcome}: pulled [${event.pulled.join(", ")}] delivered [${event.delivered.join(", ")}]`);
  return event.outcome === "ok" ? 0 : 1;
}

if (import.meta.main) process.exitCode = await main();
