/**
 * The two things this pipeline talks to. Everything else is plain logic over files.
 *
 * Keeping them behind interfaces is what makes the safety logic testable without a phone
 * switch or a mailbox, and it is where a real deployment plugs in its own vendors.
 */

/** ISO calendar date in the customer's timezone, e.g. "2026-10-16". */
export type Day = string;

export interface CallRecord {
  id: string;
  /** ISO timestamp of when the call started. */
  startedAt: string;
  from: string;
  to: string;
  durationSec: number;
  disposition: "answered" | "missed" | "voicemail";
}

export interface SwitchClient {
  /** Every call record for one closed day. */
  fetchCalls(day: Day): Promise<CallRecord[]>;
  /** The switch's own count for that day, from a separate endpoint. Used to reconcile. */
  countCalls(day: Day): Promise<number>;
}

export interface ReportBatch {
  days: Day[];
  subject: string;
  attachments: string[];
}

export interface Mailer {
  /**
   * Which of these days the customer has already received, read from Sent Mail.
   * The mailbox is the ground truth for "delivered"; the local ledger can lag behind it.
   */
  deliveredDays(days: Day[]): Promise<Set<Day>>;
  send(batch: ReportBatch): Promise<void>;
  /** Leave the same email as a draft for a human to review and send. */
  draft(batch: ReportBatch): Promise<void>;
  /** Tell the operator something is wrong. Must never throw. */
  alert(subject: string, body: string): Promise<void>;
}
