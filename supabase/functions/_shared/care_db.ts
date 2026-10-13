// Care plans: database helpers shared by care-plan, channel-webhook and
// send-reminders (consents by scope, sending a signed monitoring plan,
// missed-dose and no-reading alerts).
import { supabase } from "./lib.ts";
import { sendToPatient } from "./channels.ts";
import { planMessage, type VitalItem } from "./vitals.ts";
import {
  type AlertKey, MISSED_IN_A_ROW, missedDosesItem, missedStreak, NO_READINGS_MS, noReadings, noReadingsItem, reconcile,
} from "./alerts.ts";

export type ConsentScope = "medication_reminders" | "vital_signs";

/** Patient ids (of those given) with an active consent for `scope`. */
export async function consentedPatients(scope: ConsentScope, patientIds?: string[]): Promise<string[]> {
  let q = supabase.from("care_consents").select("patient_id")
    .contains("scopes", [scope]).not("consented_at", "is", null).is("withdrawn_at", null);
  if (patientIds) q = q.in("patient_id", patientIds);
  const { data } = await q;
  return [...new Set(((data ?? []) as { patient_id: string }[]).map((c) => c.patient_id))];
}

/**
 * Send the patient's signed monitoring plan (their instruction sheet) if it
 * hasn't been sent and they agreed to vital signs. Returns whether it was sent.
 */
export async function sendSignedPlan(patientId: string): Promise<boolean> {
  const { data: plan } = await supabase.from("monitoring_plans")
    .select("id, clinic_id, sent_at, providers:signed_provider_id(name), " +
      "patients!inner(id, phone, preferred_channel, active), clinics!inner(name, timezone)")
    .eq("patient_id", patientId).eq("status", "signed").maybeSingle();
  const p = plan as unknown as {
    id: string; clinic_id: string; sent_at: string | null; providers: { name: string } | null;
    patients: { id: string; phone: string; preferred_channel: string | null; active: boolean };
    clinics: { name: string; timezone: string | null };
  } | null;
  if (!p || p.sent_at || !p.patients.active) return false;
  if (!(await consentedPatients("vital_signs", [patientId])).length) return false;

  const { data: items } = await supabase.from("vital_plans").select("*").eq("plan_id", p.id).order("created_at");
  if (!items?.length) return false;
  const text = planMessage(items as VitalItem[], {
    doctor: p.providers?.name ?? "your doctor", clinic: p.clinics.name, tz: p.clinics.timezone || "Asia/Manila",
  });
  const sent = await sendToPatient({
    patient: { id: p.patients.id, phone: p.patients.phone, sms_consent: false, preferred_channel: p.patients.preferred_channel as never },
    clinicId: p.clinic_id, clinicName: p.clinics.name, text: () => text,
  });
  if (sent.ok) await supabase.from("monitoring_plans").update({ sent_at: new Date().toISOString() }).eq("id", p.id);
  return sent.ok;
}

// --- M4 alerts ----------------------------------------------------------------

type Current = AlertKey & { clinic_id: string; title: string; detail: string };

/**
 * Raise missed-dose and no-reading alerts as CC action items (clinical, nurses
 * and doctors only), once per streak; clear alerts whose problem has gone.
 * Only patients who still have that consent. Returns counts.
 */
export async function runCareAlerts(now: Date): Promise<{ raised: number; cleared: number }> {
  const current: Current[] = [];
  const names = new Map<string, string>();
  const nameOf = async (ids: string[]) => {
    const missing = ids.filter((id) => !names.has(id));
    if (!missing.length) return;
    const { data } = await supabase.from("patients").select("id, first_name, last_name").in("id", missing);
    for (const p of (data ?? []) as { id: string; first_name: string; last_name: string }[]) {
      names.set(p.id, `${p.first_name} ${p.last_name}`.trim());
    }
  };

  // Missed doses: the latest MISSED_IN_A_ROW answered-or-missed doses of an active medicine.
  const medPatients = await consentedPatients("medication_reminders");
  if (medPatients.length) {
    const { data: meds } = await supabase.from("medications").select("id, clinic_id, patient_id, name")
      .in("patient_id", medPatients).eq("active", true);
    const medRows = (meds ?? []) as { id: string; clinic_id: string; patient_id: string; name: string }[];
    if (medRows.length) {
      const { data: doses } = await supabase.from("medication_doses").select("medication_id, status, due_at")
        .in("medication_id", medRows.map((m) => m.id)).in("status", ["taken", "skipped", "missed"])
        .gte("due_at", new Date(now.getTime() - 14 * 24 * 3600_000).toISOString()).order("due_at", { ascending: false });
      const byMed = new Map<string, string[]>();
      for (const d of (doses ?? []) as { medication_id: string; status: string }[]) {
        byMed.set(d.medication_id, [...(byMed.get(d.medication_id) ?? []), d.status]);
      }
      const hits = medRows.filter((m) => missedStreak(byMed.get(m.id) ?? []) >= MISSED_IN_A_ROW);
      await nameOf(hits.map((m) => m.patient_id));
      for (const m of hits) {
        const item = missedDosesItem(names.get(m.patient_id) ?? "A patient", m.name, missedStreak(byMed.get(m.id)!));
        current.push({ patient_id: m.patient_id, kind: "missed_doses", subject_id: m.id, clinic_id: m.clinic_id, ...item });
      }
    }
  }

  // No readings: a running plan, sent to the patient, asked and unanswered for 3 days.
  const vitalPatients = await consentedPatients("vital_signs");
  if (vitalPatients.length) {
    const since = new Date(now.getTime() - NO_READINGS_MS).toISOString();
    const [{ data: plans }, { data: readings }, { data: requests }] = await Promise.all([
      supabase.from("monitoring_plans").select("id, clinic_id, patient_id, sent_at")
        .in("patient_id", vitalPatients).eq("status", "signed").not("sent_at", "is", null),
      supabase.from("vital_readings").select("patient_id, taken_at").in("patient_id", vitalPatients).gte("taken_at", since),
      supabase.from("vital_requests").select("patient_id").in("patient_id", vitalPatients)
        .gte("due_at", since).in("status", ["sent", "answered", "missed"]),
    ]);
    const recent = new Map<string, string>();
    for (const r of (readings ?? []) as { patient_id: string; taken_at: string }[]) recent.set(r.patient_id, r.taken_at);
    const asked = new Map<string, number>();
    for (const r of (requests ?? []) as { patient_id: string }[]) asked.set(r.patient_id, (asked.get(r.patient_id) ?? 0) + 1);
    const hits = ((plans ?? []) as { id: string; clinic_id: string; patient_id: string; sent_at: string }[])
      .filter((p) => noReadings(now, { runningSince: p.sent_at, lastReadingAt: recent.get(p.patient_id) ?? null,
        requestsInWindow: asked.get(p.patient_id) ?? 0 }));
    await nameOf(hits.map((p) => p.patient_id));
    for (const p of hits) {
      const item = noReadingsItem(names.get(p.patient_id) ?? "A patient", asked.get(p.patient_id) ?? 0);
      current.push({ patient_id: p.patient_id, kind: "no_readings", subject_id: p.id, clinic_id: p.clinic_id, ...item });
    }
  }

  const { data: open } = await supabase.from("care_alerts").select("id, patient_id, kind, subject_id").is("cleared_at", null);
  const { raise, clear } = reconcile(current, (open ?? []) as (AlertKey & { id: string })[]);

  if (clear.length) await supabase.from("care_alerts").update({ cleared_at: now.toISOString() }).in("id", clear);
  let raised = 0;
  for (const a of raise) {
    // Claim first: the open-alert unique index stops a parallel run filing twice.
    const { data: alert, error } = await supabase.from("care_alerts")
      .insert({ clinic_id: a.clinic_id, patient_id: a.patient_id, kind: a.kind, subject_id: a.subject_id })
      .select("id").single();
    if (error || !alert) continue;
    const { data: item } = await supabase.from("cc_action_items").insert({
      clinic_id: a.clinic_id, source: "reminder", category: "patients", severity: "warning",
      title: a.title, detail: a.detail, route: `/patients/${a.patient_id}`, patient_id: a.patient_id, clinical: true,
    }).select("id").single();
    if (item) await supabase.from("care_alerts").update({ action_item_id: (item as { id: string }).id }).eq("id", (alert as { id: string }).id);
    raised++;
  }
  return { raised, cleared: clear.length };
}
