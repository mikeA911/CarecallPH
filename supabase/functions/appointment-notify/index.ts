// CareCall PH — tell a patient that staff booked, moved or cancelled their
// appointment ("Send the patient a message" on the patient page).
//
// POST { appointment_id, kind: "booked" | "moved" | "cancelled", previous_starts_at? }
// with a signed-in portal user's JWT → { sent, channel }
//
// Sent on the patient's best permitted channel (sendToPatient), never to a
// restricted record, inactive or do-not-call patient. Staff only for their own
// clinic (platform admins: any). The kind must match the appointment's state,
// so a stale screen can't announce a booking that was since cancelled. Every
// send writes an audit_log row.
//
// Deploy with JWT verification ON (default):
//   supabase functions deploy appointment-notify

import { supabase, json, getCaller, audit, corsHeaders } from "../_shared/lib.ts";
import { sendToPatient } from "../_shared/channels.ts";
import { type AppointmentChange, appointmentChangeText } from "../_shared/reminders.ts";

type Appt = {
  id: string; starts_at: string; status: string;
  patients: { id: string; clinic_id: string; first_name: string | null; phone: string; sms_consent: boolean | null;
    preferred_channel: string | null; active: boolean; do_not_call: boolean } | null;
  providers: { name: string; clinics: { name: string; timezone: string | null; phone_callback: string | null } | null } | null;
};

const KINDS: AppointmentChange[] = ["booked", "moved", "cancelled"];

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders() });
  if (req.method !== "POST") return json({ error: "method not allowed" }, 405, corsHeaders());

  const caller = await getCaller(req);
  if (!caller || !caller.role) return json({ error: "unauthorized" }, 401, corsHeaders());

  const body = await req.json().catch(() => ({}));
  const id = String(body.appointment_id ?? "");
  const kind = body.kind as AppointmentChange;
  if (!/^[0-9a-f-]{36}$/i.test(id) || !KINDS.includes(kind)) {
    return json({ error: "appointment_id and kind required" }, 400, corsHeaders());
  }
  const previous = body.previous_starts_at ? new Date(String(body.previous_starts_at)) : null;

  const { data } = await supabase.from("appointments")
    .select("id, starts_at, status, patients(id, clinic_id, first_name, phone, sms_consent, preferred_channel, active, do_not_call), " +
      "providers(name, clinics(name, timezone, phone_callback))")
    .eq("id", id).maybeSingle();
  const appt = data as unknown as Appt | null;
  const patient = appt?.patients;
  if (!appt || !patient) return json({ error: "appointment not found" }, 404, corsHeaders());
  if (caller.role !== "admin" && patient.clinic_id !== caller.clinicId) {
    return json({ error: "forbidden: patient is not in your clinic" }, 403, corsHeaders());
  }
  const live = appt.status === "booked" || appt.status === "confirmed";
  if (kind === "cancelled" ? appt.status !== "cancelled" : !live) {
    return json({ error: "The appointment has changed since; nothing was sent." }, 409, corsHeaders());
  }
  if (!patient.active || patient.do_not_call) {
    return json({ sent: false, channel: null, reason: "inactive_or_do_not_call" }, 200, corsHeaders());
  }

  const clinic = appt.providers?.clinics;
  const text = appointmentChangeText(kind, {
    clinic: clinic?.name ?? "Your clinic", firstName: patient.first_name, doctor: appt.providers?.name ?? null,
    startsAt: new Date(appt.starts_at), previous: previous && !isNaN(previous.getTime()) ? previous : null,
    now: new Date(), tz: clinic?.timezone || "Asia/Manila", callback: clinic?.phone_callback ?? null,
  });
  const sent = await sendToPatient({
    patient: { id: patient.id, phone: patient.phone, sms_consent: patient.sms_consent, preferred_channel: patient.preferred_channel as never },
    clinicId: patient.clinic_id, clinicName: clinic?.name ?? "Your clinic", text: () => text,
  });

  await audit({
    clinicId: patient.clinic_id, actorUserId: caller.userId, action: "appointment_notified",
    targetType: "appointments", targetId: appt.id, detail: { patient_id: patient.id, kind, sent: sent.ok, channel: sent.channel },
  });
  return json({ sent: sent.ok, channel: sent.channel }, 200, corsHeaders());
});
