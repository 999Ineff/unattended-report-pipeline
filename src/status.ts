/**
 * Area 5 (part 2): "is it working?" in one command. Safe to run any time; it touches neither the
 * switch nor the mailbox, only local state. Exits non-zero when something needs a human.
 *
 *   node src/status.ts --base /var/lib/report-pipeline
 */

import { parseArgs } from "node:util";
import { join } from "node:path";
import { exists, loadSent, readMarker } from "./ledger.ts";
import { readRuns } from "./runlog.ts";

async function main(): Promise<number> {
  const { values } = parseArgs({
    options: {
      base: { type: "string", default: "/var/lib/report-pipeline" },
      "kill-switch": { type: "string", default: "/etc/report-pipeline/autosend-off" },
    },
  });
  const state = join(values.base!, "state");
  const runs = await readRuns(join(state, "runs.jsonl"));
  const sent = [...(await loadSent(join(state, "sent.json")))].sort();
  const marker = await readMarker(join(state, "send.inflight"));
  const killSwitch = await exists(values["kill-switch"]!);

  const last = runs.at(-1);
  const recentFailures = runs.slice(-7).filter((r) => r.outcome === "failed").length;

  console.log(`last run        ${last ? `${last.today} ${last.deliver} -> ${last.outcome}` : "never"}`);
  console.log(`last delivered  ${sent.at(-1) ?? "never"}`);
  console.log(`failures (7)    ${recentFailures}`);
  console.log(`auto-send       ${killSwitch ? "OFF (kill switch present, drafts only)" : "on"}`);
  if (marker) console.log(`IN-FLIGHT       a send for ${marker.join(", ")} never recorded itself`);
  for (const w of last?.warnings ?? []) console.log(`warning         ${w}`);

  const healthy = last?.outcome === "ok" && !marker;
  return healthy ? 0 : 1;
}

if (import.meta.main) process.exitCode = await main();
