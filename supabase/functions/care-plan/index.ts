// CareCall PH — care plans (slice M1), called by signed-in portal users.
// Design: docs/care-plan-design.md
//
//   POST { action: "request_consent", patient_id }
//        Sends the consent request (care.ts consentText, versioned) to the
//        patient's connected chat app and records it. The patient answers YES
//        or NO in the chat (channel-webhook). Chat apps only, never SMS: the
//        answer must come back in the chat.
//   POST { action: "withdraw", patient_id }
//        Staff stop medicine reminders for the patient (e.g. asked in person).
//
// Medicines themselves are added and edited by staff in the portal (RLS).
import { audit, corsHeaders, getCaller, json, supabase } from "../_shared/lib.ts";
import { sendToPatient } from "../_shared/channels.ts";
import { CONSENT_VERSION, consentText } from "../_shared/care.ts";

const reply = (data: unknown, status = 200) => json(data, status, corsHeaders());

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders() });
  if (req.method !== "POST") return reply({ error: "method not allowed" }, 405);

  const caller = await getCaller(req);
  if (!caller || !caller.role) return reply({ error: "unauthorized" }, 401);

  const body = await req.json().catch(() => ({}));
  const patientId = String(body.patient_id ?? "");
  if (!/^[0-9a-f-]{36}$/i.test(patientId)) return reply({ error: "patient_id required" }, 400);

  const { data: p } = await supabase.from("patients")
    .select("id, clinic_id, phone, preferred_channel, active, do_not_call, clinics(name)")
    .eq("id", patientId).maybeSingle();
  const patient = p as unknown as {
    id: string; clinic_id: string; phone: string; preferred_channel: string | null; active: boolean;
    do_not_call: boolean; clinics: { name: string } | null;
  } | null;
  if (!patient) return reply({ error: "patient not found" }, 404);
  if (caller.role !== "admin" && patient.clinic_id !== caller.clinicId) {
    return reply({ error: "forbidden: patient is not in your clinic" }, 403);
  }

  if (body.action === "withdraw") {
    await supabase.from("care_consents").update({ withdrawn_at: new Date().toISOString() })
      .eq("patient_id", patient.id).eq("clinic_id", patient.clinic_id).is("withdrawn_at", null);
    await audit({ clinicId: patient.clinic_id, actorUserId: caller.userId, action: "care_consent_withdrawn_by_staff",
      targetType: "patient", targetId: patient.id });
    return reply({ ok: true });
  }

  if (body.action !== "request_consent") return reply({ error: "unknown action" }, 400);
  if (!patient.active || patient.do_not_call) {
    return reply({ error: "This patient is inactive or marked do-not-call." }, 409);
  }

  const clinic = patient.clinics?.name ?? "your clinic";
  const text = consentText(clinic);
  const sent = await sendToPatient({
    // sms_consent false: chat apps only, the answer must come back in the chat.
    patient: { id: patient.id, phone: patient.phone, sms_consent: false, preferred_channel: patient.preferred_channel as never },
    clinicId: patient.clinic_id, clinicName: clinic, text: () => text,
  });
  if (!sent.ok) {
    return reply({
      error: sent.channel
        ? "The message couldn't be sent. Try again later."
        : "This patient isn't connected to a chat app yet. Use Invite to chat first.",
    }, 409);
  }

  await supabase.from("care_consents").insert({
    clinic_id: patient.clinic_id, patient_id: patient.id, scopes: ["medication_reminders"],
    wording_version: CONSENT_VERSION, channel: sent.channel, requested_by: caller.userId,
  });
  await audit({ clinicId: patient.clinic_id, actorUserId: caller.userId, action: "care_consent_requested",
    targetType: "patient", targetId: patient.id, detail: { wording_version: CONSENT_VERSION, channel: sent.channel } });
  return reply({ ok: true, channel: sent.channel });
});
