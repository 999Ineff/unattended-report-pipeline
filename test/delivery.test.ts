import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Day, Mailer, ReportBatch } from "../src/adapters/types.ts";
import { CountMismatchError, reconcile } from "../src/checks.ts";
import { deliver } from "../src/deliver.ts";
import { loadSent } from "../src/ledger.ts";

function fakeMailer(opts: { alreadyDelivered?: Day[]; failSend?: boolean } = {}) {
  const sends: ReportBatch[] = [];
  const drafts: ReportBatch[] = [];
  const mailer: Mailer = {
    deliveredDays: async (days) => new Set(days.filter((d) => opts.alreadyDelivered?.includes(d))),
    send: async (b) => {
      if (opts.failSend) throw new Error("SMTP 421");
      sends.push(b);
    },
    draft: async (b) => void drafts.push(b),
    alert: async () => {},
  };
  return { mailer, sends, drafts };
}

async function setup() {
  const dir = await mkdtemp(join(tmpdir(), "report-"));
  return {
    ledger: join(dir, "sent.json"),
    marker: join(dir, "send.inflight"),
    killSwitch: join(dir, "autosend-off"),
  };
}

const batch = (days: Day[]): ReportBatch => ({ days, subject: days.join(","), attachments: [] });

test("the switch's own count must match the rows held", () => {
  assert.throws(() => reconcile("2026-10-16", 690, 712), CountMismatchError);
  assert.doesNotThrow(() => reconcile("2026-10-16", 712, 712));
});

test("a failed send leaves the ledger untouched, so the days go out next run", async () => {
  const paths = await setup();
  const { mailer } = fakeMailer({ failSend: true });
  await assert.rejects(deliver(["2026-10-16"], "send", mailer, paths, batch));
  assert.equal((await loadSent(paths.ledger)).size, 0);
});

test("days the mailbox shows as delivered are never sent twice", async () => {
  const paths = await setup();
  const { mailer, sends } = fakeMailer({ alreadyDelivered: ["2026-10-16"] });
  const result = await deliver(["2026-10-16", "2026-10-17"], "send", mailer, paths, batch);
  assert.deepEqual(result.days, ["2026-10-17"]);
  assert.deepEqual(sends[0]?.days, ["2026-10-17"]);
});

test("the kill switch turns a send into a draft, and a draft is not a delivery", async () => {
  const paths = await setup();
  await writeFile(paths.killSwitch, "");
  const { mailer, sends, drafts } = fakeMailer();
  const result = await deliver(["2026-10-16"], "send", mailer, paths, batch);
  assert.equal(result.mode, "draft");
  assert.equal(sends.length, 0);
  assert.equal(drafts.length, 1);
  assert.equal((await loadSent(paths.ledger)).size, 0);
});
