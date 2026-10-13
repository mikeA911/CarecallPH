// CC tool care_report (care plans M4): medicine adherence and vital-sign
// readings for one clinic, as counts only. No names, no patient ids, no
// single patient's values reach the model. Pure: the tool loads the rows.

import { MISSED_IN_A_ROW, missedStreak } from "../alerts.ts";

export type CareRows = {
  consents: { patient_id: string; scopes: string[]; consented_at: string | null; withdrawn_at: string | null }[];
  medications: { id: string; patient_id: string; active: boolean }[];
  /** Doses from the start of the previous period, any status. */
  doses: { medication_id: string; patient_id: string; due_at: string; status: string }[];
  plans: { patient_id: string; status: string }[];
  requests: { patient_id: string; due_at: string; status: string }[];
  /** Readings from the start of the previous period. */
  readings: { patient_id: string; measure: string; value1: number | string; taken_at: string; flag: string;
    reviewed_at: string | null }[];
  openAlerts: { kind: string }[];
};

/** Below this many answered doses or readings, a patient isn't banded or trended. */
export const MIN_DOSES = 5;
export const MIN_READINGS = 3;
/** Average systolic change (mmHg) between the two weeks that counts as up or down. */
export const BP_TREND_MMHG = 5;

const pct = (a: number, b: number) => (b ? Math.round((a / b) * 100) : null);
function tally<T>(rows: T[], key: (r: T) => string): Record<string, number> {
  const out: Record<string, number> = {};
  for (const r of rows) out[key(r)] = (out[key(r)] ?? 0) + 1;
  return out;
}

export function buildCareReport(now: Date, days: number, r: CareRows) {
  const start = now.getTime() - days * 24 * 3600_000;
  const prevStart = start - days * 24 * 3600_000;
  const inPeriod = (iso: string) => Date.parse(iso) >= start && Date.parse(iso) <= now.getTime();
  const inPrev = (iso: string) => Date.parse(iso) >= prevStart && Date.parse(iso) < start;
  const active = (scope: string) =>
    new Set(r.consents.filter((c) => c.scopes.includes(scope) && c.consented_at && !c.withdrawn_at).map((c) => c.patient_id));
  const medConsent = active("medication_reminders");
  const vitalConsent = active("vital_signs");

  // --- medicines
  const answered = (s: string) => s === "taken" || s === "skipped" || s === "missed";
  const doses = r.doses.filter((d) => answered(d.status));
  const now_ = doses.filter((d) => inPeriod(d.due_at));
  const prev = doses.filter((d) => inPrev(d.due_at));
  const taken = (ds: typeof doses) => ds.filter((d) => d.status === "taken").length;
  const perPatient = new Map<string, typeof doses>();
  for (const d of now_) perPatient.set(d.patient_id, [...(perPatient.get(d.patient_id) ?? []), d]);
  const bands = { "80-100%": 0, "50-79%": 0, "under 50%": 0, "too few doses to say": 0 };
  for (const ds of perPatient.values()) {
    if (ds.length < MIN_DOSES) { bands["too few doses to say"]++; continue; }
    const p = pct(taken(ds), ds.length)!;
    bands[p >= 80 ? "80-100%" : p >= 50 ? "50-79%" : "under 50%"]++;
  }
  const byMed = new Map<string, { patient: string; statuses: { at: string; s: string }[] }>();
  for (const d of doses) {
    const m = byMed.get(d.medication_id) ?? { patient: d.patient_id, statuses: [] };
    m.statuses.push({ at: d.due_at, s: d.status });
    byMed.set(d.medication_id, m);
  }
  const activeMeds = new Set(r.medications.filter((m) => m.active).map((m) => m.id));
  const streakPatients = new Set<string>();
  for (const [id, m] of byMed) {
    if (!activeMeds.has(id) || !medConsent.has(m.patient)) continue;
    const newest = m.statuses.sort((a, b) => b.at.localeCompare(a.at)).map((x) => x.s);
    if (missedStreak(newest) >= MISSED_IN_A_ROW) streakPatients.add(m.patient);
  }

  // --- vital signs
  const reqNow = r.requests.filter((q) => inPeriod(q.due_at) && ["sent", "answered", "missed"].includes(q.status));
  const readNow = r.readings.filter((x) => inPeriod(x.taken_at));
  const unreviewed = r.readings.filter((x) => x.flag !== "ok" && !x.reviewed_at);
  const oldest = unreviewed.reduce<number | null>((m, x) => (m === null || Date.parse(x.taken_at) < m ? Date.parse(x.taken_at) : m), null);

  // Blood pressure trend: average systolic, last 7 days vs the 7 before.
  const week = 7 * 24 * 3600_000;
  const bp = r.readings.filter((x) => x.measure === "bp");
  const avg = (xs: number[]) => xs.reduce((a, b) => a + b, 0) / xs.length;
  const trend = { up: 0, down: 0, steady: 0, too_few_readings: 0 };
  const bpPatients = new Set(bp.filter((x) => Date.parse(x.taken_at) >= now.getTime() - week).map((x) => x.patient_id));
  for (const p of bpPatients) {
    const mine = bp.filter((x) => x.patient_id === p);
    const last = mine.filter((x) => Date.parse(x.taken_at) >= now.getTime() - week).map((x) => Number(x.value1));
    const before = mine.filter((x) => Date.parse(x.taken_at) < now.getTime() - week &&
      Date.parse(x.taken_at) >= now.getTime() - 2 * week).map((x) => Number(x.value1));
    if (last.length < MIN_READINGS || before.length < MIN_READINGS) { trend.too_few_readings++; continue; }
    const d = avg(last) - avg(before);
    trend[d >= BP_TREND_MMHG ? "up" : d <= -BP_TREND_MMHG ? "down" : "steady"]++;
  }

  return {
    period_days: days,
    note: "Counts of patients and events only. Adherence and response rates rest on the numbers shown; small numbers are not conclusions.",
    medicines: {
      patients_with_reminders_on: medConsent.size,
      active_medicines: activeMeds.size,
      doses: { ...tally(now_, (d) => d.status), total: now_.length },
      adherence_pct: pct(taken(now_), now_.length),
      adherence_pct_previous_period: pct(taken(prev), prev.length),
      patients_by_adherence: bands,
      patients_with_3_missed_in_a_row: streakPatients.size,
    },
    vital_signs: {
      patients_with_running_plan: new Set(r.plans.filter((p) => p.status === "signed").map((p) => p.patient_id)).size,
      patients_agreed: vitalConsent.size,
      draft_plans_waiting_for_doctor: r.plans.filter((p) => p.status === "draft").length,
      requests: { ...tally(reqNow, (q) => q.status), total: reqNow.length },
      response_rate_pct: pct(reqNow.filter((q) => q.status === "answered").length, reqNow.length),
      readings: { total: readNow.length, by_measure: tally(readNow, (x) => x.measure), by_check: tally(readNow, (x) => x.flag) },
      not_yet_reviewed: { ...tally(unreviewed, (x) => x.flag), oldest_waiting_hours: oldest === null ? null : Math.round((now.getTime() - oldest) / 36e5) },
      blood_pressure_trend_patients: trend,
    },
    open_alerts: tally(r.openAlerts, (a) => a.kind),
  };
}
