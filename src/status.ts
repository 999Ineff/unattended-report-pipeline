import { join } from "node:path";
import { parseArgs } from "node:util";
import { exists, loadSent, readMarker } from "./ledger.ts";
import { readRuns } from "./runlog.ts";

/** Reads local state only; never touches the switch or the mailbox. Exits 1 when unhealthy. */
async function main(): Promise<number> {
  const { values } = parseArgs({
    options: {
      base: { type: "string", default: "/var/lib/report-pipeline" },
      "kill-switch": { type: "string", default: "/etc/report-pipeline/autosend-off" },
    },
  });
  const state = join(values.base, "state");
  const runs = await readRuns(join(state, "runs.jsonl"));
  const sent = [...(await loadSent(join(state, "sent.json")))].sort();
  const inFlight = await readMarker(join(state, "send.inflight"));
  const autoSendOff = await exists(values["kill-switch"]);

  const last = runs.at(-1);
  const failures = runs.slice(-7).filter((run) => run.outcome === "failed").length;

  const rows: [string, string][] = [
    ["last run", last ? `${last.today} ${last.deliver} -> ${last.outcome}` : "never"],
    ["last delivered", sent.at(-1) ?? "never"],
    ["failures (last 7)", String(failures)],
    ["auto-send", autoSendOff ? "off (drafts only)" : "on"],
  ];
  if (inFlight) rows.push(["in flight", `unrecorded send for ${inFlight.join(", ")}`]);
  for (const warning of last?.warnings ?? []) rows.push(["warning", warning]);

  for (const [label, value] of rows) console.log(`${label.padEnd(18)} ${value}`);
  return last?.outcome === "ok" && !inFlight ? 0 : 1;
}

if (import.meta.main) process.exitCode = await main();
