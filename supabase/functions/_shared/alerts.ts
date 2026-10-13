// Care plans M4: missed-dose and no-reading alerts. Pure rules; the
// database side is runCareAlerts in care_db.ts, called by send-reminders.
// Design: docs/care-plan-design.md §7 (4): several missed doses (default 3 in
// a row) or no readings for 3 days → an item for the clinic, never a message
// that scolds the patient.

export const MISSED_IN_A_ROW = 3;
export const NO_READINGS_MS = 3 * 24 * 3600_000;
/** A no-readings alert needs at least this many requests sent in that time. */
export const MIN_REQUESTS = 2;

export type AlertKind = "missed_doses" | "no_readings";
export type AlertKey = { patient_id: string; kind: AlertKind; subject_id: string };
export const keyOf = (k: AlertKey) => `${k.patient_id}|${k.kind}|${k.subject_id}`;

/** Missed doses at the start of a newest-first list of answered or missed doses. */
export function missedStreak(newestFirst: string[]): number {
  let n = 0;
  for (const s of newestFirst) {
    if (s !== "missed") break;
    n++;
  }
  return n;
}

/**
 * No readings: the plan has been with the patient for the whole window, at
 * least MIN_REQUESTS requests went out in it, and no reading came back.
 */
export function noReadings(now: Date, o: { runningSince: string; lastReadingAt: string | null; requestsInWindow: number }): boolean {
  const since = now.getTime() - NO_READINGS_MS;
  if (Date.parse(o.runningSince) > since) return false;
  if (o.lastReadingAt && Date.parse(o.lastReadingAt) > since) return false;
  return o.requestsInWindow >= MIN_REQUESTS;
}

/**
 * Which alerts to raise (condition true, none open) and which open alerts to
 * clear (condition gone). An alert is filed once per streak.
 */
export function reconcile<T extends AlertKey>(current: T[], open: (AlertKey & { id: string })[]):
  { raise: T[]; clear: string[] } {
  const now = new Set(current.map(keyOf));
  const openKeys = new Set(open.map(keyOf));
  return {
    raise: current.filter((c) => !openKeys.has(keyOf(c))),
    clear: open.filter((o) => !now.has(keyOf(o))).map((o) => o.id),
  };
}

export function missedDosesItem(who: string, medicine: string, streak: number) {
  return {
    title: `Missed ${streak} medicine reminders in a row: ${who}`,
    detail: `${who} hasn't answered the last ${streak} reminders for ${medicine}. They may have stopped the medicine, ` +
      `run out, or have a problem with it. Consider a call to check in. (No message was sent to the patient.)`,
  };
}

export function noReadingsItem(who: string, requests: number) {
  return {
    title: `No readings for 3 days: ${who}`,
    detail: `${who} hasn't sent a reading in 3 days (${requests} requests unanswered) although their monitoring plan ` +
      `is running. Consider a call: their device, phone or plan may need a change. (No message was sent to the patient.)`,
  };
}
