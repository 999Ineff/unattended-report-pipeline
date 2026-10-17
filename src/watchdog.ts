import { join } from "node:path";
import { parseArgs } from "node:util";
import type { Day } from "./adapters/types.ts";
import { loadSent } from "./ledger.ts";
import { readRuns, type RunEvent } from "./runlog.ts";
import { addDays, isWeekday, reportToday } from "./schedule.ts";

export interface Verdict {
  ok: boolean;
  subject: string;
  body: string;
}

/**
 * Runs on its own timer after the report should have gone out. A job can report its own
 * failure but not that it never started; this catches the silence.
 */
export function check(runs: RunEvent[], delivered: Set<Day>, today: Day): Verdict {
  const todays = runs.filter((run) => run.today === today);
  const latest = todays.at(-1);

  if (!latest) {
    const previous = runs.at(-1);
    return {
      ok: false,
      subject: `No run recorded for ${today}`,
      body: [
        `The ${today} run never started. Check the timers:`,
        "  systemctl list-timers 'report-*'",
        "  journalctl -u report-pull --since today",
        previous
          ? `Last run: ${previous.today} (${previous.outcome}).`
          : "No run has been recorded.",
      ].join("\n"),
    };
  }

  if (latest.outcome === "failed") {
    return {
      ok: false,
      subject: `Run failed for ${today}`,
      body: `${latest.error?.type}: ${latest.error?.message}`,
    };
  }

  const yesterday = addDays(today, -1);
  if (isWeekday(today) && !delivered.has(yesterday)) {
    return {
      ok: false,
      subject: `${yesterday} not delivered`,
      body: "Runs succeeded but nothing was delivered. Check for a pending draft or the kill switch.",
    };
  }

  return { ok: true, subject: `Report healthy for ${today}`, body: "" };
}

async function main(): Promise<number> {
  const { values } = parseArgs({
    options: {
      base: { type: "string", default: "/var/lib/report-pipeline" },
      today: { type: "string" },
      tz: { type: "string", default: "America/New_York" },
    },
  });
  const state = join(values.base, "state");
  const today = values.today ?? reportToday(new Date(), values.tz);
  const verdict = check(
    await readRuns(join(state, "runs.jsonl")),
    await loadSent(join(state, "sent.json")),
    today,
  );

  if (verdict.ok) {
    console.log(verdict.subject);
    return 0;
  }
  // TODO(deploy): route through the production Mailer.alert().
  console.error(`${verdict.subject}\n${verdict.body}`);
  return 1;
}

if (import.meta.main) process.exitCode = await main();
