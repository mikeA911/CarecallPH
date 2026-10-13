// CC care_report (M4): aggregates only, adherence bands, BP trend, redaction.
// Run: deno test supabase/functions/_shared/cc/care_report_test.ts
import { buildCareReport, type CareRows } from "./care_report.ts";
import { redactItem, toolsFor } from "./tools.ts";

function eq(actual: unknown, expected: unknown, msg = "") {
  const a = JSON.stringify(actual), e = JSON.stringify(expected);
  if (a !== e) throw new Error(`${msg}\n  expected ${e}\n  got      ${a}`);
}
const NOW = new Date("2026-10-20T12:00:00Z");
const ago = (d: number, h = 0) => new Date(NOW.getTime() - (d * 24 + h) * 3600_000).toISOString();

function rows(): CareRows {
  const consents = [
    { patient_id: "p1", scopes: ["medication_reminders"], consented_at: ago(30), withdrawn_at: null },
    { patient_id: "p2", scopes: ["medication_reminders"], consented_at: ago(30), withdrawn_at: null },
    { patient_id: "p3", scopes: ["vital_signs"], consented_at: ago(30), withdrawn_at: null },
    { patient_id: "p4", scopes: ["medication_reminders"], consented_at: ago(30), withdrawn_at: ago(2) },
  ];
  const medications = [{ id: "m1", patient_id: "p1", active: true }, { id: "m2", patient_id: "p2", active: true }];
  const doses: CareRows["doses"] = [];
  // p1: 7 days, all taken. p2: 4 taken then 3 missed (newest).
  for (let d = 1; d <= 7; d++) doses.push({ medication_id: "m1", patient_id: "p1", due_at: ago(d), status: "taken" });
  for (let d = 1; d <= 7; d++) doses.push({ medication_id: "m2", patient_id: "p2", due_at: ago(d), status: d <= 3 ? "missed" : "taken" });
  // previous week: everyone took everything
  for (let d = 8; d <= 14; d++) doses.push({ medication_id: "m1", patient_id: "p1", due_at: ago(d), status: "taken" });
  doses.push({ medication_id: "m1", patient_id: "p1", due_at: ago(0, 1), status: "sent" });
  // p3 BP: previous week ~130, last week ~142 (up)
  const readings: CareRows["readings"] = [];
  for (let d = 8; d <= 11; d++) readings.push({ patient_id: "p3", measure: "bp", value1: 130, taken_at: ago(d), flag: "ok", reviewed_at: null });
  for (let d = 1; d <= 4; d++) readings.push({ patient_id: "p3", measure: "bp", value1: 142, taken_at: ago(d), flag: d === 1 ? "out_of_range" : "ok", reviewed_at: null });
  const requests = [1, 2, 3, 4, 5].map((d) => ({ patient_id: "p3", due_at: ago(d), status: d === 5 ? "missed" : "answered" }));
  return { consents, medications, doses, plans: [{ patient_id: "p3", status: "signed" }, { patient_id: "p5", status: "draft" }],
    requests, readings, openAlerts: [{ kind: "missed_doses" }] };
}

Deno.test("care_report: medicines", () => {
  const r = buildCareReport(NOW, 7, rows());
  eq(r.medicines.patients_with_reminders_on, 2, "withdrawn consent not counted");
  eq(r.medicines.doses, { taken: 11, missed: 3, total: 14 }, "sent (unanswered) doses not counted");
  eq([r.medicines.adherence_pct, r.medicines.adherence_pct_previous_period], [79, 100]);
  eq(r.medicines.patients_by_adherence, { "80-100%": 1, "50-79%": 1, "under 50%": 0, "too few doses to say": 0 });
  eq(r.medicines.patients_with_3_missed_in_a_row, 1);
});

Deno.test("care_report: vital signs and trend", () => {
  const r = buildCareReport(NOW, 7, rows());
  eq(r.vital_signs.patients_with_running_plan, 1);
  eq(r.vital_signs.draft_plans_waiting_for_doctor, 1);
  eq(r.vital_signs.response_rate_pct, 80);
  eq(r.vital_signs.readings.by_check, { out_of_range: 1, ok: 3 });
  eq((r.vital_signs.not_yet_reviewed as Record<string, unknown>).out_of_range, 1);
  eq(r.vital_signs.not_yet_reviewed.oldest_waiting_hours, 24);
  eq(r.vital_signs.blood_pressure_trend_patients, { up: 1, down: 0, steady: 0, too_few_readings: 0 });
  eq(r.open_alerts, { missed_doses: 1 });
});

Deno.test("care_report holds no patient ids or values per patient", () => {
  const s = JSON.stringify(buildCareReport(NOW, 30, rows()));
  eq(/p[1-5]"|m[12]"|142|130/.test(s), false, s);
});

Deno.test("action items reach CC without patient names", () => {
  eq(redactItem({ title: "Wants a new time: Ana Cruz", detail: "Ana Cruz can't make it", patient_id: "p1" }),
    { title: "Wants a new time: (a patient)", detail: null });
  const campaign = { title: "Add availability", detail: "No slots", patient_id: null };
  eq(redactItem(campaign), campaign);
});

Deno.test("care_report only for nurses and doctors; navigate only in chat", () => {
  const names = (t: { name: string }[]) => t.map((x) => x.name);
  eq(names(toolsFor("chat", false)).includes("care_report"), false);
  eq(names(toolsFor("chat", true)).includes("care_report"), true);
  eq(names(toolsFor("nightly")).includes("navigate"), false);
});
