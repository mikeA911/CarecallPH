// CareCall PH — staff-created chat invites ("Invite to chat" on a patient's page).
//
// POST { patient_id } with a signed-in portal user's JWT →
//   { url, expires_at }   a /connect/<token> link for that patient
//
// Lets a clinic connect patients to Telegram / Viber / Messenger / WhatsApp
// without SMS: staff send the link from the clinic's own phone or show it as a
// QR code at the front desk. Same token rules as invites minted inside SMS
// notices (createChannelInvite): only the hash is stored, valid 30 days.
//
// Any portal role may invite, but only for patients in their own clinic
// (platform admins: any clinic). Every invite writes an audit_log row.
//
// Deploy with JWT verification ON (default):
//   supabase functions deploy channel-invite

import { supabase, json, getCaller, audit, corsHeaders } from "../_shared/lib.ts";
import { createChannelInvite } from "../_shared/channels.ts";

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders() });
  if (req.method !== "POST") return json({ error: "method not allowed" }, 405, corsHeaders());

  const caller = await getCaller(req);
  if (!caller || !caller.role) return json({ error: "unauthorized" }, 401, corsHeaders());

  const body = await req.json().catch(() => ({}));
  const patientId = String(body.patient_id ?? "");
  if (!/^[0-9a-f-]{36}$/i.test(patientId)) return json({ error: "patient_id required" }, 400, corsHeaders());

  const { data: patient } = await supabase.from("patients")
    .select("id, clinic_id, active, do_not_call").eq("id", patientId).maybeSingle();
  if (!patient) return json({ error: "patient not found" }, 404, corsHeaders());
  if (caller.role !== "admin" && patient.clinic_id !== caller.clinicId) {
    return json({ error: "forbidden: patient is not in your clinic" }, 403, corsHeaders());
  }
  if (!patient.active || patient.do_not_call) {
    return json({ error: "This patient is inactive or marked do-not-call." }, 409, corsHeaders());
  }

  const url = await createChannelInvite(patient.id, patient.clinic_id);
  if (!url) {
    return json({ error: "Invite links need PORTAL_URL set in the Supabase secrets." }, 500, corsHeaders());
  }

  await audit({
    clinicId: patient.clinic_id, actorUserId: caller.userId, action: "chat_invite_created",
    targetType: "patient", targetId: patient.id,
  });
  const expires = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString();
  return json({ url, expires_at: expires }, 200, corsHeaders());
});
