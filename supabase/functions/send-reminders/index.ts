// CareCall PH — appointment reminders (Phase 2c).
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
// Deploy: supabase functions deploy send-reminders --no-verify-jwt
import { json, supabase } from "../_shared/lib.ts";
import { type PatientLite, sendToPatient } from "../_shared/channels.ts";
import { dueKind, inMessagingWindow, type ReminderKind, reminderText } from "../_shared/reminders.ts";

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

    const { data: prev } = await supabase.from("appointment_reminders")
      .select("appointment_id, kind").in("appointment_id", rows.map((a) => a.id));
    const sent = new Map<string, ReminderKind[]>();
    for (const r of (prev ?? []) as { appointment_id: string; kind: ReminderKind }[]) {
      sent.set(r.appointment_id, [...(sent.get(r.appointment_id) ?? []), r.kind]);
    }

    for (const a of rows) {
      const p = a.patients;
      if (!p || p.active === false) continue;
      const kind = dueKind(now, new Date(a.starts_at), new Date(a.created_at), sent.get(a.id) ?? []);
      if (!kind) continue;

      // Claim the reminder first; a parallel run hits the unique key and skips.
      const { data: claim, error: claimErr } = await supabase.from("appointment_reminders")
        .insert({ appointment_id: a.id, clinic_id: c.id, patient_id: p.id, kind, status: "sent" })
        .select("id").single();
      if (claimErr || !claim) continue;

      const text = reminderText(kind, {
        clinic: c.name, firstName: p.first_name, doctor: a.providers?.name ?? null,
        startsAt: new Date(a.starts_at), now, tz, confirmed: a.status === "confirmed",
      });
      const res = await sendToPatient({ patient: p, clinicId: c.id, clinicName: c.name, text: () => text });
      const status = res.ok ? "sent" : res.channel ? "failed" : "no_channel";
      await supabase.from("appointment_reminders")
        .update({ status, channel: res.channel }).eq("id", (claim as { id: string }).id);
      totals[status]++;
    }
  }
  return json({ ok: true, ...totals });
});
