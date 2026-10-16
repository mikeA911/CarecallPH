// CareCall PH — patient sign-up page API (/join/<clinic>).
//
// A new patient at the front desk scans the clinic's QR poster, types her
// name, mobile and date of birth, accepts the privacy notice and chooses chat
// messages and texts. PUBLIC: no Supabase JWT (verify_jwt off in config.toml).
//
// POST, body.action selects:
//   start  { clinic_slug }  → { clinic: { name, phone } }  | 404 not_found
//   signup { clinic_slug, first_name, last_name, phone, date_of_birth,
//            privacy_accepted, privacy_notice_version, chat, sms }
//          → { registered: true, connect_token? }          a new record
//          → { registered: true, existing: true }          already on file
//
// A new record gets a chat invite token marked verified (valid 1 day): she
// just typed her birthday, so the chat asks only for YES. An existing patient
// (same clinic, mobile and birthday) is never changed and gets no token: the
// page asks her to see the front desk, who send Invite to chat. Otherwise
// anyone who knows a patient's mobile and birthday could link a chat to her
// record from outside the clinic.
//
// Consent: the privacy notice version and time are stored on the new record;
// texts only when ticked (sms_consent); chat consent is still her YES in the
// chat. Every sign-up writes an audit_log row. Per-IP rate limits.
import { audit, json, supabase } from "../_shared/lib.ts";
import { createSignupInvite } from "../_shared/channels.ts";
import { parseSignup, PRIVACY_NOTICE_VERSION } from "../_shared/signup.ts";

// TEMPORARY: testers outside the Philippines (same switch as booking.ts).
const ALLOW_INTERNATIONAL_PHONES = true;
const START_PER_MIN = 30;
const SIGNUP_PER_MIN = 10; // one clinic's wifi can carry several patients at once

function cors(): Record<string, string> {
  return {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
  };
}
const pub = (data: unknown, status = 200) => json(data, status, cors());

type Clinic = { id: string; name: string; phone_callback: string | null };

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors() });
  if (req.method !== "POST") return pub({ error: "method not allowed" }, 405);
  const body = await req.json().catch(() => ({} as Record<string, unknown>)) as Record<string, unknown>;
  const action = String(body.action ?? "");

  try {
    const ip = clientIp(req);
    if (ip) {
      const signup = action === "signup";
      const { data: count } = await supabase.rpc("bump_symptom_rate", { p_ip: `${signup ? "j" : "js"}:${ip}` });
      if (typeof count === "number" && count > (signup ? SIGNUP_PER_MIN : START_PER_MIN)) {
        return pub({ error: "rate_limited" }, 429);
      }
    }

    const clinic = await findClinic(body.clinic_slug);
    if (!clinic) return pub({ error: "not_found" }, 404);
    if (action === "start") {
      return pub({ clinic: { name: clinic.name, phone: clinic.phone_callback }, privacy_notice_version: PRIVACY_NOTICE_VERSION });
    }
    if (action !== "signup") return pub({ error: "unknown action" }, 400);

    const form = parseSignup(body, { allowInternational: ALLOW_INTERNATIONAL_PHONES });
    if (!form.ok) return pub({ registered: false, reason: form.error, message: form.message }, 400);
    const f = form.value;

    const { data: found } = await supabase.from("patients").select("id")
      .eq("clinic_id", clinic.id).eq("phone", f.phone).eq("date_of_birth", f.date_of_birth).maybeSingle();
    if (found) {
      await audit({
        clinicId: clinic.id, actorUserId: null, action: "patient_self_signup", targetType: "patient",
        targetId: (found as { id: string }).id, detail: { existing: true },
      });
      return pub({ registered: true, existing: true });
    }

    const now = new Date().toISOString();
    const { data: created, error } = await supabase.from("patients").insert({
      clinic_id: clinic.id, first_name: f.first_name, last_name: f.last_name, phone: f.phone,
      date_of_birth: f.date_of_birth, sms_consent: f.sms, signed_up_at: now,
      privacy_notice_version: PRIVACY_NOTICE_VERSION, privacy_notice_accepted_at: now,
    }).select("id").single();
    if (error) {
      // Same person submitting twice at once: treat the second as already on file.
      if (error.code === "23505") return pub({ registered: true, existing: true });
      throw error;
    }
    const patientId = (created as { id: string }).id;
    const token = f.chat ? await createSignupInvite(patientId, clinic.id) : null;

    await audit({
      clinicId: clinic.id, actorUserId: null, action: "patient_self_signup", targetType: "patient", targetId: patientId,
      detail: { existing: false, chat: f.chat, sms: f.sms, privacy_notice_version: PRIVACY_NOTICE_VERSION },
    });
    return pub(token ? { registered: true, connect_token: token } : { registered: true });
  } catch (e) {
    console.error("patient-signup error", e);
    return pub({ error: "unavailable" }, 503);
  }
});

async function findClinic(slugIn: unknown): Promise<Clinic | null> {
  const slug = String(slugIn ?? "").trim().toLowerCase();
  if (!/^[a-z0-9][a-z0-9-]{1,40}$/.test(slug)) return null;
  const { data } = await supabase.from("clinics")
    .select("id, name, phone_callback, signup_enabled, active").eq("public_slug", slug).maybeSingle();
  const c = data as (Clinic & { signup_enabled: boolean; active: boolean }) | null;
  if (!c || !c.signup_enabled || c.active === false) return null;
  return { id: c.id, name: c.name, phone_callback: c.phone_callback };
}

function clientIp(req: Request): string | null {
  const xf = req.headers.get("x-forwarded-for");
  if (xf) return xf.split(",")[0].trim();
  return req.headers.get("x-real-ip");
}
