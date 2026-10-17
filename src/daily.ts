import { mkdir } from "node:fs/promises";
import { join } from "node:path";
import { parseArgs } from "node:util";
import { ConsoleMailer, FakeSwitch } from "./adapters/fakes.ts";
import type { Day, Mailer, SwitchClient } from "./adapters/types.ts";
import { reconcile, validateRows, volumeWarning } from "./checks.ts";
import { deliver } from "./deliver.ts";
import { loadSent, withRunLock } from "./ledger.ts";
import { buildBatch, builtDays, writeReport } from "./report.ts";
import { appendRun, type RunEvent } from "./runlog.ts";
import { isWeekday, missingPulls, reportToday, sendableDays } from "./schedule.ts";

const DELIVER_MODES = ["none", "send", "draft"] as const;
type DeliverOption = (typeof DELIVER_MODES)[number];

const WEEKDAY_BASELINE = 700;

export interface RunOptions {
  base: string;
  today: Day;
  deliver: DeliverOption;
  dryRun: boolean;
  lookbackDays: number;
  killSwitch: string;
}

function layout(base: string) {
  const state = join(base, "state");
  return {
    out: join(base, "out"),
    lock: join(state, ".run.lock"),
    ledger: join(state, "sent.json"),
    marker: join(state, "send.inflight"),
    runs: join(state, "runs.jsonl"),
  };
}

/** One morning: pull and check every missing closed day, then deliver what is outstanding. */
export async function run(
  opts: RunOptions,
  source: SwitchClient,
  mailer: Mailer,
): Promise<RunEvent> {
  const paths = layout(opts.base);
  const event: RunEvent = {
    today: opts.today,
    startedAt: new Date().toISOString(),
    finishedAt: "",
    deliver: opts.deliver,
    outcome: "ok",
    pulled: [],
    delivered: [],
    warnings: [],
  };

  try {
    await withRunLock(paths.lock, async () => {
      await mkdir(paths.out, { recursive: true });

      for (const day of missingPulls(opts.today, await builtDays(paths.out), opts.lookbackDays)) {
        const rows = await source.fetchCalls(day);
        validateRows(rows, day);
        reconcile(day, rows.length, await source.countCalls(day));

        const warning = volumeWarning(rows.length, WEEKDAY_BASELINE);
        if (warning) event.warnings.push(`${day}: ${warning}`);
        if (!opts.dryRun) await writeReport(paths.out, day, rows);
        event.pulled.push(day);
      }

      if (opts.deliver === "none" || opts.dryRun || !isWeekday(opts.today)) return;

      const days = sendableDays(
        await builtDays(paths.out),
        await loadSent(paths.ledger),
        opts.today,
      );
      if (days.length === 0) return;

      const result = await deliver(
        days,
        opts.deliver,
        mailer,
        { ledger: paths.ledger, marker: paths.marker, killSwitch: opts.killSwitch },
        (batchDays) => buildBatch(paths.out, batchDays),
      );
      if (result.mode === "send") event.delivered = result.days;
    });
  } catch (err) {
    const error = err instanceof Error ? err : new Error(String(err));
    event.outcome = "failed";
    event.error = { type: error.name, message: error.message };
    await mailer.alert(`Report run failed for ${opts.today}`, `${error.name}: ${error.message}`);
  } finally {
    event.finishedAt = new Date().toISOString();
    if (!opts.dryRun) await appendRun(paths.runs, event);
  }
  return event;
}

function isDeliverOption(value: string | undefined): value is DeliverOption {
  return DELIVER_MODES.includes(value as DeliverOption);
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

  if (!isDeliverOption(values.deliver)) {
    console.error(`--deliver is required: ${DELIVER_MODES.join(" | ")}`);
    return 2;
  }

  const event = await run(
    {
      base: values.base,
      today: values.today ?? reportToday(new Date(), values.tz),
      deliver: values.deliver,
      dryRun: values["dry-run"],
      lookbackDays: Number(values.lookback),
      killSwitch: values["kill-switch"],
    },
    new FakeSwitch(), // TODO(deploy): production SwitchClient
    new ConsoleMailer(join(values.base, "fake-sent-mail.json")), // TODO(deploy): production Mailer
  );

  console.log(
    `${event.outcome}: pulled ${event.pulled.length} day(s), delivered ${event.delivered.length}`,
  );
  return event.outcome === "ok" ? 0 : 1;
}

if (import.meta.main) process.exitCode = await main();
