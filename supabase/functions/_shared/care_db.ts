// Care plans: database helpers shared by care-plan, channel-webhook and
// send-reminders (consents by scope, sending a signed monitoring plan).
import { supabase } from "./lib.ts";
import { sendToPatient } from "./channels.ts";
import { planMessage, type VitalItem } from "./vitals.ts";

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
