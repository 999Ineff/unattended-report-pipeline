/** ISO calendar date in the customer's timezone, e.g. "2026-10-16". */
export type Day = string;

export interface CallRecord {
  id: string;
  startedAt: string;
  from: string;
  to: string;
  durationSec: number;
  disposition: "answered" | "missed" | "voicemail";
}

export interface SwitchClient {
  fetchCalls(day: Day): Promise<CallRecord[]>;
  /** The switch's own count for the day, from a separate endpoint, used to reconcile. */
  countCalls(day: Day): Promise<number>;
}

export interface ReportBatch {
  days: Day[];
  subject: string;
  attachments: string[];
}

export interface Mailer {
  /** Days the customer already received, read from Sent Mail. The mailbox is ground truth. */
  deliveredDays(days: Day[]): Promise<Set<Day>>;
  send(batch: ReportBatch): Promise<void>;
  draft(batch: ReportBatch): Promise<void>;
  /** Must never throw. */
  alert(subject: string, body: string): Promise<void>;
}
