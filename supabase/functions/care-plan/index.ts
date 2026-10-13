// CareCall PH — care plans (slice M1), called by signed-in portal users.
// Design: docs/care-plan-design.md
//
//   POST { action: "request_consent", patient_id }
//        Sends the consent request (care.ts consentText, versioned) to the
//        patient's connected chat app and records it. The patient answers YES
//        or NO in the chat (channel-webhook). Chat apps only, never SMS: the
//        answer must come back in the chat.
//   POST { action: "request_consent", patient_id, scope: "vital_signs" }
//        The same for vital signs (M3), naming the measures in the patient's
//        monitoring plan.
//   POST { action: "withdraw", patient_id, scope? }
//        Staff stop reminders for the patient (e.g. asked in person): one
//        scope, or all. Anyone in the clinic may stop; only nurses and doctors ask.
//   POST { action: "sign_plan", patient_id, plan_id, password }
//        A doctor signs a draft monitoring plan (password re-entered). It
//        replaces the running plan; the patient gets it by chat once they
//        agree to vital signs.
//   POST { action: "stop_plan", patient_id, plan_id }
//        Nurses and doctors stop the running plan: no more requests.
//
// Medicines themselves are added and edited by nurses and doctors in the
// portal (RLS, can_manage_care()).
import { audit, corsHeaders, getCaller, json, supabase } from "../_shared/lib.ts";
import { canManageCare } from "../_shared/roles.ts";
import { sendToPatient } from "../_shared/channels.ts";
import { CONSENT_VERSION, consentText } from "../_shared/care.ts";
import { type ConsentScope, consentedPatients, sendSignedPlan } from "../_shared/care_db.ts";
import { type Measure, VITALS_CONSENT_VERSION, vitalsConsentText } from "../_shared/vitals.ts";
import { verifyPassword } from "../_shared/lib.ts";
import { BUTTONS } from "../_shared/buttons.ts";

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

  const scope: ConsentScope = body.scope === "vital_signs" ? "vital_signs" : "medication_reminders";

  if (body.action === "withdraw") {
    let q = supabase.from("care_consents").update({ withdrawn_at: new Date().toISOString() })
      .eq("patient_id", patient.id).eq("clinic_id", patient.clinic_id).is("withdrawn_at", null);
    if (body.scope) q = q.contains("scopes", [scope]);
    await q;
    await audit({ clinicId: patient.clinic_id, actorUserId: caller.userId, action: "care_consent_withdrawn_by_staff",
      targetType: "patient", targetId: patient.id, detail: { scope: body.scope ? scope : "all" } });
    return reply({ ok: true });
  }

  if (body.action === "sign_plan" || body.action === "stop_plan") {
    return await planAction(body, patient.id, patient.clinic_id, caller);
  }

  if (body.action !== "request_consent") return reply({ error: "unknown action" }, 400);
  if (!canManageCare(caller.clinicalRole)) {
    return reply({ error: "Only a nurse or doctor can ask a patient to agree to reminders." }, 403);
  }
  if (!patient.active || patient.do_not_call) {
    return reply({ error: "This patient is inactive or marked do-not-call." }, 409);
  }

  const clinic = patient.clinics?.name ?? "your clinic";
  let text = consentText(clinic);
  let version = CONSENT_VERSION;
  if (scope === "vital_signs") {
    // Name the measures and the doctor from the latest plan (signed or draft).
    const { data: plan } = await supabase.from("monitoring_plans")
      .select("id, providers:signed_provider_id(name), vital_plans(measure)")
      .eq("patient_id", patient.id).in("status", ["signed", "draft"])
      .order("status", { ascending: false }).order("created_at", { ascending: false }).limit(1).maybeSingle();
    const pl = plan as unknown as { providers: { name: string } | null; vital_plans: { measure: Measure }[] } | null;
    const measures = [...new Set((pl?.vital_plans ?? []).map((v) => v.measure))];
    text = vitalsConsentText(clinic, pl?.providers?.name ?? null, measures);
    version = VITALS_CONSENT_VERSION;
  }
  const sent = await sendToPatient({
    // sms_consent false: chat apps only, the answer must come back in the chat.
    patient: { id: patient.id, phone: patient.phone, sms_consent: false, preferred_channel: patient.preferred_channel as never },
    clinicId: patient.clinic_id, clinicName: clinic, text: () => text, buttons: BUTTONS.consent,
  });
  if (!sent.ok) {
    return reply({
      error: sent.channel
        ? "The message couldn't be sent. Try again later."
        : "This patient isn't connected to a chat app yet. Use Invite to chat first.",
    }, 409);
  }

  await supabase.from("care_consents").insert({
    clinic_id: patient.clinic_id, patient_id: patient.id, scopes: [scope],
    wording_version: version, channel: sent.channel, requested_by: caller.userId,
  });
  await audit({ clinicId: patient.clinic_id, actorUserId: caller.userId, action: "care_consent_requested",
    targetType: "patient", targetId: patient.id, detail: { scope, wording_version: version, channel: sent.channel } });
  return reply({ ok: true, channel: sent.channel });
});

type Caller = NonNullable<Awaited<ReturnType<typeof getCaller>>>;

/** Sign (doctor + password) or stop a monitoring plan (M3). */
async function planAction(body: Record<string, unknown>, patientId: string, clinicId: string, caller: Caller) {
  const planId = String(body.plan_id ?? "");
  if (!/^[0-9a-f-]{36}$/i.test(planId)) return reply({ error: "plan_id required" }, 400);
  const { data } = await supabase.from("monitoring_plans")
    .select("id, status, patient_id, clinic_id, version, vital_plans(id)").eq("id", planId).maybeSingle();
  const plan = data as unknown as { id: string; status: string; patient_id: string; clinic_id: string; version: number;
    vital_plans: { id: string }[] } | null;
  if (!plan || plan.patient_id !== patientId) return reply({ error: "plan not found" }, 404);

  if (body.action === "stop_plan") {
    if (!canManageCare(caller.clinicalRole)) return reply({ error: "Only a nurse or doctor can stop a plan." }, 403);
    if (plan.status !== "signed") return reply({ error: "Only a running plan can be stopped." }, 409);
    await supabase.from("monitoring_plans").update({ status: "stopped", stopped_at: new Date().toISOString() }).eq("id", plan.id);
    await audit({ clinicId, actorUserId: caller.userId, action: "monitoring_plan_stopped", targetType: "patient", targetId: patientId });
    return reply({ ok: true });
  }

  // sign_plan
  if (caller.clinicalRole !== "doctor") return reply({ error: "Only a doctor can sign a monitoring plan." }, 403);
  const { data: prov } = await supabase.from("providers").select("id, name")
    .eq("user_id", caller.userId).eq("active", true).maybeSingle();
  if (!prov) return reply({ error: "Your login isn't linked to a clinician yet (Settings → Users)." }, 403);
  if (plan.status !== "draft") return reply({ error: "This plan is already signed." }, 409);
  if (!plan.vital_plans.length) return reply({ error: "Add at least one measure first." }, 400);
  if (!(await verifyPassword(caller.userId, String(body.password ?? "")))) {
    await audit({ clinicId, actorUserId: caller.userId, action: "monitoring_plan_sign_failed", targetType: "patient", targetId: patientId });
    return reply({ error: "That password isn't right. Enter the password you use to sign in." }, 401);
  }

  // The new plan replaces the running one (which stays in the record).
  const { data: running } = await supabase.from("monitoring_plans").select("id")
    .eq("patient_id", patientId).eq("status", "signed").maybeSingle();
  if (running) await supabase.from("monitoring_plans").update({ status: "replaced" }).eq("id", (running as { id: string }).id);
  // Versions count every plan this patient has had signed (stopped and replaced too).
  const { data: last } = await supabase.from("monitoring_plans").select("version")
    .eq("patient_id", patientId).neq("status", "draft").order("version", { ascending: false }).limit(1).maybeSingle();
  const version = last ? (last as { version: number }).version + 1 : 1;
  const { error } = await supabase.from("monitoring_plans").update({
    status: "signed", version, signed_by: caller.userId, signed_provider_id: (prov as { id: string }).id,
    signed_at: new Date().toISOString(),
  }).eq("id", plan.id).eq("status", "draft");
  if (error) return reply({ error: `Couldn't sign: ${error.message}` }, 409);
  await audit({ clinicId, actorUserId: caller.userId, action: "monitoring_plan_signed", targetType: "patient", targetId: patientId,
    detail: { plan_id: plan.id, version, provider: (prov as { name: string }).name } });

  const consented = (await consentedPatients("vital_signs", [patientId])).length > 0;
  const sent = consented ? await sendSignedPlan(patientId) : false;
  return reply({ ok: true, version, sent, needs_consent: !consented });
}
