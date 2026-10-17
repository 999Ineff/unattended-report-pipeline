import { test } from "node:test";
import assert from "node:assert/strict";
import { MissingDayError, missingPulls, reportToday, sendableDays } from "../src/schedule.ts";

test("the report's today follows the customer's timezone, not the server's UTC clock", () => {
  // 02:30 UTC on the 17th is still the evening of the 16th in New York.
  assert.equal(reportToday(new Date("2026-10-17T02:30:00Z"), "America/New_York"), "2026-10-16");
});

test("never pulls today: the day's call history is not closed yet", () => {
  const missing = missingPulls("2026-10-16", new Set(), 3);
  assert.deepEqual(missing, ["2026-10-13", "2026-10-14", "2026-10-15"]);
  assert.ok(!missing.includes("2026-10-16"));
});

test("Monday's send carries Friday, Saturday and Sunday", () => {
  const built = new Set(["2026-10-16", "2026-10-17", "2026-10-18"]);
  const sent = new Set(["2026-10-15"]);
  assert.deepEqual(sendableDays(built, sent, "2026-10-19"), ["2026-10-16", "2026-10-17", "2026-10-18"]);
});

test("a missing day is a hard stop, even when the batch would look normal", () => {
  const built = new Set(["2026-10-16", "2026-10-18"]); // Saturday never pulled
  assert.throws(() => sendableDays(built, new Set(["2026-10-15"]), "2026-10-19"), MissingDayError);
});

test("refuses to send if yesterday is not built yet", () => {
  const built = new Set(["2026-10-16", "2026-10-17"]);
  assert.throws(() => sendableDays(built, new Set(["2026-10-15"]), "2026-10-19"), MissingDayError);
});
