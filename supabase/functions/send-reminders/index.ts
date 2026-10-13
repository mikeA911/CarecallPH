// CareCall PH — appointment reminders (Phase 2c) and medicine reminders (M1).
//
// Called every 5 minutes by pg_cron (tick_reminders) with the service-role
// key. For each clinic with reminders on, finds booked or confirmed
// appointments in the next 24 hours and sends the reminder that is due
// (24 hours or 2 hours before; rules in _shared/reminders.ts) on the patient's
// permitted channel (chat app, or SMS with consent). Only between 07:00 and
// 21:00 clinic time. Each reminder is recorded once (unique appointment+kind)
// before sending, so overlapping runs never double-send. Replies are handled
// by channel-webhook.
//
// Medicine reminders (care plans M1, _shared/care.ts): for patients with
// active consent, each medicine time is sent once in the 30 minutes after it,
// grouped per patient and time, chat apps only. Doses unanswered after 2
// hours become "missed".
//
// Deploy: supabase functions deploy send-reminders --no-verify-jwt
import { json, supabase } from "../_shared/lib.ts";
import { type PatientLite, sendToPatient } from "../_shared/channels.ts";
import { dueKind, inMessagingWindow, type ReminderKind, reminderText } from "../_shared/reminders.ts";
import { doseText, dueDoses, type Med, MISSED_AFTER_MS } from "../_shared/care.ts";
import { BUTTONS } from "../_shared/buttons.ts";
import { consentedPatients } from "../_shared/care_db.ts";
import { dueVitalRequests, REQUEST_OPEN_MS, requestText, type VitalItem } from "../_shared/vitals.ts";

const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";

type Appt = {
  id: string;
  starts_at: string;
  created_at: string;
  status: string;
  providers: { name: string } | null;
  patients: (PatientLite & { first_name: string; clinic_id: string; active: boolean }) | null;
};

Deno.serve(async (req) => {
  if (req.method !== "POST") return json({ error: "method not allowed" }, 405);
  if (!SERVICE_KEY || req.headers.get("Authorization") !== `Bearer ${SERVICE_KEY}`) {
    return json({ error: "unauthorized" }, 401);
  }

  const now = new Date();
  const { data: clinics } = await supabase.from("clinics")
    .select("id, name, timezone").eq("reminders_enabled", true).eq("active", true);
  const totals = { sent: 0, failed: 0, no_channel: 0 };

  for (const c of (clinics ?? []) as { id: string; name: string; timezone: string | null }[]) {
    const tz = c.timezone || "Asia/Manila";
    if (!inMessagingWindow(now, tz)) continue;

    const { data: appts, error } = await supabase.from("appointments")
      .select("id, starts_at, created_at, status, providers(name), " +
        "patients!inner(id, phone, sms_consent, preferred_channel, first_name, clinic_id, active)")
      .eq("patients.clinic_id", c.id)
      .in("status", ["booked", "confirmed"])
      .gt("starts_at", now.toISOString())
      .lte("starts_at", new Date(now.getTime() + 24 * 3600_000).toISOString());
    if (error) { console.error("send-reminders: appointments", error); continue; }
    const rows = (appts ?? []) as unknown as Appt[];
    if (!rows.length) continue;

    // Reminders already sent for each appointment's CURRENT time (an
    // appointment moved by chat gets reminders for its new time).
    const { data: prev } = await supabase.from("appointment_reminders")
      .select("appointment_id, kind, for_starts_at").in("appointment_id", rows.map((a) => a.id));
    const startsAt = new Map(rows.map((a) => [a.id, Date.parse(a.starts_at)]));
    const sent = new Map<string, ReminderKind[]>();
    for (const r of (prev ?? []) as { appointment_id: string; kind: ReminderKind; for_starts_at: string | null }[]) {
      if (r.for_starts_at && Date.parse(r.for_starts_at) !== startsAt.get(r.appointment_id)) continue;
      sent.set(r.appointment_id, [...(sent.get(r.appointment_id) ?? []), r.kind]);
    }

    for (const a of rows) {
      const p = a.patients;
      if (!p || p.active === false) continue;
      const kind = dueKind(now, new Date(a.starts_at), new Date(a.created_at), sent.get(a.id) ?? []);
      if (!kind) continue;

      // Claim the reminder first; a parallel run hits the unique key and skips.
      const { data: claim, error: claimErr } = await supabase.from("appointment_reminders")
        .insert({ appointment_id: a.id, clinic_id: c.id, patient_id: p.id, kind, status: "sent", for_starts_at: a.starts_at })
        .select("id").single();
      if (claimErr || !claim) continue;

      const text = reminderText(kind, {
        clinic: c.name, firstName: p.first_name, doctor: a.providers?.name ?? null,
        startsAt: new Date(a.starts_at), now, tz, confirmed: a.status === "confirmed",
      });
      const buttons = kind === "24h" && a.status !== "confirmed" ? BUTTONS.reminder24 : BUTTONS.reminder2;
      const res = await sendToPatient({ patient: p, clinicId: c.id, clinicName: c.name, text: () => text, buttons });
      const status = res.ok ? "sent" : res.channel ? "failed" : "no_channel";
      await supabase.from("appointment_reminders")
        .update({ status, channel: res.channel }).eq("id", (claim as { id: string }).id);
      totals[status]++;
    }
  }
  const medicines = await sendMedicineReminders(now);
  const vitals = await sendVitalRequests(now);
  return json({ ok: true, ...totals, medicines, vitals });
});

async function sendMedicineReminders(now: Date) {
  const totals = { sent: 0, failed: 0, no_channel: 0, missed: 0 };

  // Unanswered for 2 hours: missed.
  const { data: missed } = await supabase.from("medication_doses")
    .update({ status: "missed" }).eq("status", "sent")
    .lt("due_at", new Date(now.getTime() - MISSED_AFTER_MS).toISOString()).select("id");
  totals.missed = (missed ?? []).length;

  // Patients who agreed to medicine reminders (vital signs are a separate consent).
  const patientIds = await consentedPatients("medication_reminders");
  if (!patientIds.length) return totals;

  const { data: medRows } = await supabase.from("medications")
    .select("id, clinic_id, patient_id, name, dose, instructions, times_of_day, start_date, end_date, discreet, " +
      "patients!inner(id, phone, preferred_channel, active), clinics!inner(name, timezone, active)")
    .eq("active", true).in("patient_id", patientIds);
  type Row = Med & { clinic_id: string;
    patients: { id: string; phone: string; preferred_channel: string | null; active: boolean };
    clinics: { name: string; timezone: string | null; active: boolean } };
  const meds = ((medRows ?? []) as unknown as Row[]).filter((m) => m.patients.active && m.clinics.active);
  if (!meds.length) return totals;

  const { data: recent } = await supabase.from("medication_doses")
    .select("medication_id, due_at").in("medication_id", meds.map((m) => m.id))
    .gte("due_at", new Date(now.getTime() - 60 * 60_000).toISOString());
  const sentKeys = new Set(((recent ?? []) as { medication_id: string; due_at: string }[])
    .map((d) => `${d.medication_id}|${new Date(d.due_at).toISOString()}`));

  // Group due doses by patient and time: one message for all of them.
  const groups = new Map<string, { row: Row; meds: Row[]; dueAt: Date; tz: string }>();
  for (const m of meds) {
    const tz = m.clinics.timezone || "Asia/Manila";
    for (const d of dueDoses(now, [m], tz, sentKeys)) {
      const key = `${m.patient_id}|${d.dueAt.toISOString()}`;
      const g = groups.get(key) ?? { row: m, meds: [], dueAt: d.dueAt, tz };
      g.meds.push(m);
      groups.set(key, g);
    }
  }

  for (const g of groups.values()) {
    // Claim first; a parallel run hits the unique (medication, due_at) key.
    const { data: claimed } = await supabase.from("medication_doses")
      .upsert(g.meds.map((m) => ({
        medication_id: m.id, clinic_id: m.clinic_id, patient_id: m.patient_id,
        due_at: g.dueAt.toISOString(), status: "sent",
      })), { onConflict: "medication_id,due_at", ignoreDuplicates: true })
      .select("id, medication_id");
    const ids = ((claimed ?? []) as { id: string; medication_id: string }[]);
    if (!ids.length) continue;
    const mine = g.meds.filter((m) => ids.some((c) => c.medication_id === m.id));

    const p = g.row.patients;
    const res = await sendToPatient({
      patient: { id: p.id, phone: p.phone, sms_consent: false, preferred_channel: p.preferred_channel as never },
      clinicId: g.row.clinic_id, clinicName: g.row.clinics.name,
      text: () => doseText(mine, g.dueAt, g.tz),
      buttons: BUTTONS.dose,
    });
    const status = res.ok ? "sent" : res.channel ? "failed" : "no_channel";
    await supabase.from("medication_doses").update({ status, channel: res.channel })
      .in("id", ids.map((c) => c.id));
    totals[status] += ids.length;
  }
  return totals;
}

/**
 * Vital-sign requests (M3): for patients with a signed monitoring plan and
 * consent to vital signs, each measure's time is sent once in the 30 minutes
 * after it, grouped per patient and time. Unanswered after 4 hours: missed.
 */
async function sendVitalRequests(now: Date) {
  const totals = { sent: 0, failed: 0, no_channel: 0, missed: 0 };
  const { data: missed } = await supabase.from("vital_requests")
    .update({ status: "missed" }).eq("status", "sent")
    .lt("due_at", new Date(now.getTime() - REQUEST_OPEN_MS).toISOString()).select("id");
  totals.missed = (missed ?? []).length;

  const patientIds = await consentedPatients("vital_signs");
  if (!patientIds.length) return totals;

  const { data: rows } = await supabase.from("vital_plans")
    .select("*, monitoring_plans!inner(status, providers:signed_provider_id(name)), " +
      "patients!inner(id, phone, preferred_channel, active), clinics!inner(name, timezone, active)")
    .eq("monitoring_plans.status", "signed").in("patient_id", patientIds);
  type Row = VitalItem & { clinic_id: string;
    monitoring_plans: { providers: { name: string } | null };
    patients: { id: string; phone: string; preferred_channel: string | null; active: boolean };
    clinics: { name: string; timezone: string | null; active: boolean } };
  const items = ((rows ?? []) as unknown as Row[]).filter((r) => r.patients.active && r.clinics.active);
  if (!items.length) return totals;

  const { data: recent } = await supabase.from("vital_requests")
    .select("vital_plan_id, due_at").in("vital_plan_id", items.map((i) => i.id))
    .gte("due_at", new Date(now.getTime() - 60 * 60_000).toISOString());
  const sentKeys = new Set(((recent ?? []) as { vital_plan_id: string; due_at: string }[])
    .map((r) => `${r.vital_plan_id}|${new Date(r.due_at).toISOString()}`));

  const groups = new Map<string, { row: Row; items: Row[]; dueAt: Date }>();
  for (const it of items) {
    for (const d of dueVitalRequests(now, [it], it.clinics.timezone || "Asia/Manila", sentKeys)) {
      const key = `${it.patient_id}|${d.dueAt.toISOString()}`;
      const g = groups.get(key) ?? { row: it, items: [], dueAt: d.dueAt };
      g.items.push(it);
      groups.set(key, g);
    }
  }

  for (const g of groups.values()) {
    // Claim first; a parallel run hits the unique (vital_plan_id, due_at) key.
    const { data: claimed } = await supabase.from("vital_requests")
      .upsert(g.items.map((it) => ({
        vital_plan_id: it.id, clinic_id: it.clinic_id, patient_id: it.patient_id, due_at: g.dueAt.toISOString(), status: "sent",
      })), { onConflict: "vital_plan_id,due_at", ignoreDuplicates: true })
      .select("id, vital_plan_id");
    const ids = (claimed ?? []) as { id: string; vital_plan_id: string }[];
    if (!ids.length) continue;
    const mine = g.items.filter((it) => ids.some((c) => c.vital_plan_id === it.id));
    const p = g.row.patients;
    const res = await sendToPatient({
      patient: { id: p.id, phone: p.phone, sms_consent: false, preferred_channel: p.preferred_channel as never },
      clinicId: g.row.clinic_id, clinicName: g.row.clinics.name,
      text: () => requestText(mine, g.row.monitoring_plans.providers?.name ?? null),
    });
    const status = res.ok ? "sent" : res.channel ? "failed" : "no_channel";
    await supabase.from("vital_requests").update({ status, channel: res.channel }).in("id", ids.map((c) => c.id));
    totals[status] += ids.length;
  }
  return totals;
}
