/**
 * Area 4: did this morning's report actually go out? Runs on its own timer, after it should have.
 *
 * The report job can report its own failures. What it cannot report is never having started:
 * a disabled timer, a bad unit file, a box that came up without the network. That silence looks
 * exactly like success unless something else goes looking.
 *
 * Known blind spot: if the whole server is down, this timer is down too. Covering that needs an
 * off-box heartbeat (a dead-man's switch on an external monitor), which is the next step.
 *
 *   node src/watchdog.ts --base /var/lib/report-pipeline
 */

import { parseArgs } from "node:util";
import { join } from "node:path";
import type { Day, Mailer } from "./adapters/types.ts";
import { loadSent } from "./ledger.ts";
import { readRuns, type RunEvent } from "./runlog.ts";
import { addDays, isWeekday, reportToday } from "./schedule.ts";

export interface WatchdogVerdict {
  ok: boolean;
  subject: string;
  body: string;
}

export function check(runs: RunEvent[], delivered: Set<Day>, today: Day): WatchdogVerdict {
  const todays = runs.filter((r) => r.today === today);
  if (todays.length === 0) {
    const last = runs.at(-1);
    return {
      ok: false,
      subject: `NO RUN recorded for ${today}`,
      body:
        `The ${today} run left no entry in the run log, so it never started. Check the timers:\n` +
        `  systemctl list-timers 'report-*'\n  journalctl -u report-pull --since today\n\n` +
        (last ? `Last recorded run: ${last.today} (${last.outcome}).` : "No run has ever been recorded."),
    };
  }

  const latest = todays.at(-1)!;
  if (latest.outcome === "failed") {
    return {
      ok: false,
      subject: `run FAILED for ${today}`,
      body: `${latest.error?.type}: ${latest.error?.message}\nPulled: ${latest.pulled.join(", ") || "none"}`,
    };
  }

  // A run happening is not the same as the customer receiving the report.
  const yesterday = addDays(today, -1);
  if (isWeekday(today) && !delivered.has(yesterday)) {
    return {
      ok: false,
      subject: `${yesterday} NOT DELIVERED`,
      body: `Runs completed today, but ${yesterday} is not in the delivered ledger. Check for a draft waiting on a human, or a kill switch left on.`,
    };
  }

  return { ok: true, subject: `report healthy for ${today}`, body: "" };
}

async function main(): Promise<number> {
  const { values } = parseArgs({
    options: {
      base: { type: "string", default: "/var/lib/report-pipeline" },
      today: { type: "string" },
      tz: { type: "string", default: "America/New_York" },
    },
  });
  const base = values.base!;
  const today = values.today ?? reportToday(new Date(), values.tz!);
  const verdict = check(
    await readRuns(join(base, "state", "runs.jsonl")),
    await loadSent(join(base, "state", "sent.json")),
    today,
  );
  if (!verdict.ok) {
    // TODO(deploy): swap in the real Mailer so this reaches the operator's inbox.
    const mailer: Pick<Mailer, "alert"> = {
      alert: async (s, b) => console.error(`ALERT: ${s}\n${b}`),
    };
    await mailer.alert(verdict.subject, verdict.body);
    return 1;
  }
  console.log(verdict.subject);
  return 0;
}

if (import.meta.main) process.exitCode = await main();
