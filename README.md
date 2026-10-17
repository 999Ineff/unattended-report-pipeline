# unattended-report-pipeline

A daily customer report that pulls its data, checks it, builds it and delivers it on a VPS with
nobody watching. Most of the code here is about one rule: **it should fail loudly before it sends
anything plausible but wrong.**

> **About this repo.** My client work is private under contract, so this is a from-scratch rebuild
> of the pattern behind a pipeline I run in production for a telecom client. It has the same
> architecture and safeguards, with a simulated phone switch and synthetic data. None of the
> client's code or data is here. The production version is Python; this sample is TypeScript.
> It's a sample, not a product: the core logic is real and tested, and the two vendor
> connections are marked `TODO(deploy)`.

## The job it replaced

Every morning someone logged into the phone switch, exported yesterday's call history, pasted it
into a spreadsheet and emailed it to the customer. On Mondays they did that for Friday, Saturday
and Sunday. The production version ran unattended from August 2026, leaving drafts for a person
to send while it proved itself, and has sent itself since October. Before cutover it matched
27 days of the hand-built reports at a 99.997% row match. The differences turned
out to be mistakes in the manual files.

## How it stays safe

| | What | Where |
|---|---|---|
| 1 | **Two timers, one entry point.** Pull and build at 05:05 every day; deliver at 08:00 on weekdays. Monday carries Fri + Sat + Sun with no special case, and a holiday just means the next send carries more. Times are in the customer's timezone, not the server's UTC clock. | [`src/schedule.ts`](src/schedule.ts), [`deploy/systemd/`](deploy/systemd/) |
| 2 | **Never plausible-but-wrong.** It never pulls today, because the day isn't closed. Every row is validated, and the row count must match the switch's own count for that day. A missing day blocks the send, because a report missing Saturday looks normal to everyone who opens it. | [`src/checks.ts`](src/checks.ts), `sendableDays()` |
| 3 | **Never twice, never lost.** A day is marked sent only *after* the send succeeds. Before sending, it asks the mailbox what the customer already has. An in-flight marker covers a crash between "sent" and "recorded", and a run lock stops the two timers from racing after a reboot. | [`src/deliver.ts`](src/deliver.ts), [`src/ledger.ts`](src/ledger.ts) |
| 4 | **A watchdog for silence.** A job can report its own failure, but not that it never started. A third timer checks at 08:45 that a run happened, succeeded and actually delivered yesterday. | [`src/watchdog.ts`](src/watchdog.ts) |
| 5 | **Operable by a human.** One JSON line per run. `status` answers "is it working?" and exits non-zero when not. `touch /etc/report-pipeline/autosend-off` turns sends back into drafts for a person to review, with no deploy. | [`src/runlog.ts`](src/runlog.ts), [`src/status.ts`](src/status.ts) |

## Layout

```
src/
  daily.ts            the morning run: pull -> check -> build -> deliver (both timers call this)
  schedule.ts         report day, missing pulls, which days a send may carry
  checks.ts           row validation, count reconciliation, volume warning
  ledger.ts           sent ledger (atomic), run lock, in-flight marker
  deliver.ts          mailbox dedupe, kill switch, send-then-record
  runlog.ts           one structured line per run
  status.ts           health check CLI
  watchdog.ts         "did it actually go out?" CLI
  adapters/types.ts   SwitchClient + Mailer interfaces (where real vendors plug in)
  adapters/fakes.ts   synthetic switch + console mailer for local runs
test/                 the rules above, as tests
deploy/systemd/       pull, send and watchdog units + timers
```

## Run it

Needs Node 23.6+ (runs TypeScript directly, no build step).

```bash
npm install
npm test            # 9 tests: timezone, never-today, Monday batch, gap stop, count mismatch,
                    # failed send keeps the day outstanding, no double send, kill switch
npm run demo        # a Monday morning against the fake switch: pulls the week, sends one batch
npm run demo        # run it again: pulls nothing, sends nothing
npm run status
npm run watchdog
```

## Deploy (VPS)

```bash
sudo useradd --system report
sudo mkdir -p /opt/report-pipeline /var/lib/report-pipeline /etc/report-pipeline
# code in /opt/report-pipeline, secrets in /etc/report-pipeline/report.env (root:root, 600)
sudo cp deploy/systemd/report-* /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl enable --now report-pull.timer report-send.timer report-watchdog.timer
systemctl list-timers 'report-*'
```

## Left for a real deployment

- A `SwitchClient` for the actual switch API (paginated, rate-limited, one closed day per request).
- A `Mailer` over SMTP or a provider API, where `deliveredDays()` reads Sent Mail.
- The customer's real report layout (`toCsv()` is a placeholder for their workbook format).
- An off-box heartbeat. If the whole server is down, the watchdog is down with it.
