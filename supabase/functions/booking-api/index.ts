// CareCall — Public self-service booking API (self-booking-link-spec §4).
//
// Backs the /book/<token> portal page. PUBLIC: no Supabase JWT (verify_jwt off
// in config.toml). Abuse controls instead:
//   • per-token verification lockout (2 attempts, mirrors verify_patient)
//   • basic per-IP rate limit on `verify` (bump_booking_rate RPC)
//   • invalid AND expired tokens return the SAME generic message (no oracle)
//
// PHI minimisation: nothing patient-identifying is returned before verification;
// only the first name is returned after a successful DOB match. The booking
// path reuses the EXACT server-side rules of the voice flow — the shared
// get_available_slots RPC, idempotent inserts, the provider exclusion
// constraint (23P01), and the cross-channel one-active-appointment guard
// (23505). Booking flips campaign_patients → 'booked', which alone removes the
// patient from the dialer queue (no extra coordination).

import { supabase, json, speakable, hashBookingToken } from "../_shared/lib.ts";

const DEFAULT_CLINIC_TZ = Deno.env.get("CLINIC_TZ") ?? "Asia/Manila";
const MAX_VERIFY_ATTEMPTS = 2; // initial attempt + one retry (mirrors verify_patient)
const VERIFY_RATE_PER_MIN = 10; // per-IP verify attempts / minute

// CORS: the public booking page is served from the portal origin but may be
// hit cross-origin during local dev; keep it permissive (no credentials, no PHI
// pre-verification).
function cors(): Record<string, string> {
  return {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Headers": "content-type",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
  };
}

function pub(data: unknown, status = 200) {
  return json(data, status, cors());
}

// The single generic response for anything unusable (invalid/expired/unknown).
// Never distinguish "invalid" from "expired" — that would be an oracle.
function genericInvalid() {
  return pub({ state: "expired" });
}

type Clinic = { name?: string; timezone?: string; self_booking_enabled?: boolean } | null;
type Campaign = { id: string; appointment_type?: string; provider_id?: string | null; slot_length_minutes?: number } | null;
type Patient = { id: string; first_name?: string; date_of_birth?: string; provider_id?: string | null } | null;

type LinkRow = {
  id: string;
  campaign_id: string;
  patient_id: string;
  clinic_id: string | null;
  expires_at: string;
  verification_attempts: number;
  verified_at: string | null;
  booked_appointment_id: string | null;
  locked: boolean;
  clinics: Clinic | Clinic[];
  campaigns: Campaign | Campaign[];
  patients: Patient | Patient[];
};

/** PostgREST may return an embedded row as object OR single-element array. */
function one<T>(v: T | T[] | null | undefined): T | null {
  if (Array.isArray(v)) return v[0] ?? null;
  return v ?? null;
}

function clinicTz(link: LinkRow): string {
  return one(link.clinics)?.timezone ?? DEFAULT_CLINIC_TZ;
}

/** Human label for the campaign's appointment type (PHI-safe, public copy). */
function appointmentTypeLabel(campaign: Campaign): string {
  const t = campaign?.appointment_type ?? "";
  const map: Record<string, string> = {
    new_patient: "New patient visit",
    wellness: "Annual wellness visit",
    flu_shot: "Flu shot",
  };
  if (map[t]) return map[t];
  if (!t) return "Appointment";
  return t.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
}

/** Resolve a link by its raw token → hash → row (with clinic/campaign/patient). */
async function resolveLink(token: string): Promise<LinkRow | null> {
  if (!token || typeof token !== "string" || token.length > 100) return null;
  const tokenHash = await hashBookingToken(token);
  const { data } = await supabase.from("booking_links")
    .select(
      "id, campaign_id, patient_id, clinic_id, expires_at, verification_attempts, " +
      "verified_at, booked_appointment_id, locked, " +
      "clinics(name, timezone, self_booking_enabled), " +
      "campaigns(id, appointment_type, provider_id, slot_length_minutes), " +
      "patients(id, first_name, date_of_birth, provider_id)",
    )
    .eq("token_hash", tokenHash)
    .maybeSingle();
  return (data as unknown as LinkRow) ?? null;
}

/** Derive the current lifecycle state of a link. */
function linkState(link: LinkRow): "needs_verification" | "ready" | "booked" | "expired" | "locked" {
  if (link.booked_appointment_id) return "booked";
  if (link.locked) return "locked";
  if (new Date(link.expires_at).getTime() <= Date.now()) return "expired";
  if (link.verified_at) return "ready";
  return "needs_verification";
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors() });
  if (req.method !== "POST") return pub({ error: "method not allowed" }, 405);

  const action = new URL(req.url).searchParams.get("action") ?? "";
  const body = await req.json().catch(() => ({} as Record<string, unknown>));

  try {
    switch (action) {
      case "context": return await getContext(body);
      case "verify":  return await verify(req, body);
      case "slots":   return await getSlots(body);
      case "book":    return await book(body);
      case "decline": return await decline(body);
      default:        return pub({ error: `unknown action: ${action}` }, 400);
    }
  } catch (e) {
    console.error(`booking-api ${action} error`, e);
    return pub({ error: "internal error" }, 500);
  }
});

// ------------------------------------------------------------------
// context — PHI-minimal. Returns clinic name, appointment-type label, and the
// lifecycle state only. Never exposes patient name/DOB detail beyond `state`.
// ------------------------------------------------------------------
async function getContext(body: Record<string, unknown>) {
  const link = await resolveLink(String(body.token ?? ""));
  if (!link) return genericInvalid();

  const state = linkState(link);
  return pub({
    clinic_name: one(link.clinics)?.name ?? "your clinic",
    appointment_type_label: appointmentTypeLabel(one(link.campaigns)),
    timezone: clinicTz(link),
    state,
  });
}

// ------------------------------------------------------------------
// verify — server-side DOB compare, mirroring verify_patient: 2 attempts, then
// locked=true AND campaign_patients → needs_human (flag "booking link
// verification failed"). Success returns { verified: true, first_name }.
// ------------------------------------------------------------------
async function verify(req: Request, body: Record<string, unknown>) {
  // Per-IP rate limit (§4). Best-effort: a failing counter never blocks a
  // legitimate patient, it just skips the limit.
  const ip = clientIp(req);
  if (ip) {
    const { data: count } = await supabase.rpc("bump_booking_rate", { p_ip: ip });
    if (typeof count === "number" && count > VERIFY_RATE_PER_MIN) {
      return pub({ verified: false, error: "rate_limited" }, 429);
    }
  }

  const link = await resolveLink(String(body.token ?? ""));
  if (!link) return genericInvalid();

  const state = linkState(link);
  if (state === "expired") return genericInvalid();
  if (state === "locked")  return pub({ verified: false, state: "locked" });
  if (state === "booked")  return pub({ verified: false, state: "booked" });
  if (state === "ready") {
    // Already verified — return the first name so a refresh keeps the session.
    return pub({ verified: true, first_name: one(link.patients)?.first_name ?? "", state: "ready" });
  }

  const patient = one(link.patients);
  const stated = String(body.stated_date_of_birth ?? "").trim();
  const match = !!patient?.date_of_birth && stated === patient.date_of_birth;
  const attempts = link.verification_attempts + 1;

  if (match) {
    await supabase.from("booking_links")
      .update({ verified_at: new Date().toISOString(), verification_attempts: attempts })
      .eq("id", link.id);
    return pub({ verified: true, first_name: patient?.first_name ?? "", state: "ready" });
  }

  // Failure. Lock after MAX_VERIFY_ATTEMPTS and flag for human follow-up.
  const locked = attempts >= MAX_VERIFY_ATTEMPTS;
  await supabase.from("booking_links")
    .update({ verification_attempts: attempts, locked })
    .eq("id", link.id);

  if (locked) {
    await supabase.from("campaign_patients")
      .update({
        status: "needs_human",
        flag_reason: "booking link verification failed",
        updated_at: new Date().toISOString(),
      })
      .eq("campaign_id", link.campaign_id).eq("patient_id", link.patient_id);
    return pub({ verified: false, state: "locked" });
  }

  return pub({ verified: false, state: "needs_verification", remaining_attempts: MAX_VERIFY_ATTEMPTS - attempts });
}

// ------------------------------------------------------------------
// slots — requires a verified link. Calls the SAME get_available_slots RPC with
// the clinic's p_tz. Web is a screen, not speech, so it can show more than the
// voice flow's 3: up to 10 days, and all times for a chosen day.
// ------------------------------------------------------------------
async function getSlots(body: Record<string, unknown>) {
  const link = await resolveLink(String(body.token ?? ""));
  if (!link) return genericInvalid();

  const state = linkState(link);
  if (state === "expired") return genericInvalid();
  if (state === "locked")  return pub({ state: "locked" });
  if (state === "booked")  return pub({ state: "booked" });
  if (state !== "ready")   return pub({ error: "not verified", state }, 403);

  const campaign = one(link.campaigns);
  const patient = one(link.patients);
  const providerId = campaign?.provider_id ?? patient?.provider_id ?? null;
  if (!providerId) return pub({ days: [] });

  const tz = clinicTz(link);
  const { data: slots, error } = await supabase.rpc("get_available_slots", {
    p_provider_id: providerId,
    p_from: (body.on_date as string) ?? undefined,
    p_days: 10, // web can browse further out than the 3-day voice window
    p_limit: 300,
    p_tz: tz,
  });
  if (error) throw error;

  const rows = (slots ?? []) as { slot_start: string; slot_end: string }[];
  const granularity = String(body.granularity ?? "days");

  if (granularity === "times") {
    // All times for one chosen clinic-local day.
    const onDate = String(body.on_date ?? "");
    const times = rows
      .filter((s) => new Date(s.slot_start).toLocaleDateString("en-CA", { timeZone: tz }) === onDate)
      .map((s) => ({
        slot_start: s.slot_start,
        slot_end: s.slot_end,
        label: new Date(s.slot_start).toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit", timeZone: tz }),
      }));
    return pub({ times, timezone: tz });
  }

  // granularity === "days": distinct available days (up to 10), each with a
  // count so the UI can show "5 times available".
  const byDate = new Map<string, { date: string; label: string; count: number }>();
  for (const s of rows) {
    const date = new Date(s.slot_start).toLocaleDateString("en-CA", { timeZone: tz });
    const existing = byDate.get(date);
    if (existing) {
      existing.count++;
    } else {
      byDate.set(date, {
        date,
        label: new Date(s.slot_start).toLocaleDateString("en-US", {
          weekday: "long", month: "long", day: "numeric", timeZone: tz,
        }),
        count: 1,
      });
    }
  }
  return pub({ days: Array.from(byDate.values()).slice(0, 10), timezone: tz });
}

// ------------------------------------------------------------------
// book — requires a verified link. Idempotent insert (key link:{id}:{slot}).
// Handles BOTH races the spec calls out:
//   • 23P01 (provider exclusion) → this exact slot was just taken → slot_taken.
//   • 23505 (one_active_appointment_per_campaign) → the patient already holds
//     an active appointment for this campaign (e.g. voice booked a different
//     slot) → return THAT appointment as an already-booked success.
// On success: stamps booked_appointment_id, flips campaign_patients → booked,
// and records source='booking_link'. The status flip alone cancels the AI call.
// ------------------------------------------------------------------
async function book(body: Record<string, unknown>) {
  const link = await resolveLink(String(body.token ?? ""));
  if (!link) return genericInvalid();

  const state = linkState(link);
  if (state === "expired") return genericInvalid();
  if (state === "locked")  return pub({ booked: false, state: "locked" });
  if (state === "booked") {
    // Reused link after booking → confirmation view, never a second booking.
    return await bookedConfirmation(link);
  }
  if (state !== "ready") return pub({ booked: false, error: "not verified", state }, 403);

  const slotStart = String(body.slot_start ?? "");
  if (!slotStart) return pub({ booked: false, error: "slot_start required" }, 400);

  const campaign = one(link.campaigns);
  const patient = one(link.patients);
  const providerId = campaign?.provider_id ?? patient?.provider_id ?? null;
  if (!providerId) return pub({ booked: false, error: "no provider" }, 400);

  const tz = clinicTz(link);
  const startsAt = new Date(slotStart);
  const endsAt = new Date(startsAt.getTime() + (campaign?.slot_length_minutes ?? 30) * 60_000);
  const idempotencyKey = `link:${link.id}:${slotStart}`;

  // Idempotency: a retried book (double-tap, network retry) returns the same row.
  const { data: existing } = await supabase.from("appointments")
    .select("id, starts_at").eq("idempotency_key", idempotencyKey).maybeSingle();
  if (existing) {
    await finalizeBooking(link, existing.id);
    return pub({ booked: true, appointment_id: existing.id, spoken: speakable(existing.starts_at, tz), state: "booked" });
  }

  const { data: appt, error } = await supabase.from("appointments").insert({
    patient_id: link.patient_id,
    provider_id: providerId,
    campaign_id: link.campaign_id,
    starts_at: startsAt.toISOString(),
    ends_at: endsAt.toISOString(),
    idempotency_key: idempotencyKey,
    source: "booking_link",
  }).select("id, starts_at").single();

  if (error) {
    // Same-slot race with another channel → tell the UI to re-fetch.
    if (error.code === "23P01") {
      return pub({ booked: false, reason: "slot_taken" });
    }
    // Different-slot race: the patient already has an active appointment for
    // this campaign (e.g. the voice call booked while they were on the page).
    // Return the existing appointment as an already-booked success — that is
    // the correct answer for the patient, not an error.
    if (error.code === "23505") {
      const existingActive = await existingActiveAppointment(link);
      if (existingActive) {
        await supabase.from("booking_links")
          .update({ booked_appointment_id: existingActive.id })
          .eq("id", link.id);
        return pub({
          booked: true,
          already: true,
          appointment_id: existingActive.id,
          spoken: speakable(existingActive.starts_at, tz),
          state: "booked",
        });
      }
    }
    throw error;
  }

  await finalizeBooking(link, appt.id);
  return pub({ booked: true, appointment_id: appt.id, spoken: speakable(appt.starts_at, tz), state: "booked" });
}

/** The patient's current active (booked/confirmed) appointment for this campaign. */
async function existingActiveAppointment(link: LinkRow): Promise<{ id: string; starts_at: string } | null> {
  const { data } = await supabase.from("appointments")
    .select("id, starts_at")
    .eq("patient_id", link.patient_id)
    .eq("campaign_id", link.campaign_id)
    .in("status", ["booked", "confirmed"])
    .order("starts_at", { ascending: true })
    .limit(1)
    .maybeSingle();
  return (data as { id: string; starts_at: string } | null) ?? null;
}

/** Stamp the link, flip the patient to booked (cancels the AI call), tag source. */
async function finalizeBooking(link: LinkRow, appointmentId: string) {
  await Promise.all([
    supabase.from("booking_links")
      .update({ booked_appointment_id: appointmentId })
      .eq("id", link.id),
    supabase.from("campaign_patients")
      .update({ status: "booked", updated_at: new Date().toISOString() })
      .eq("campaign_id", link.campaign_id).eq("patient_id", link.patient_id),
  ]);
}

/** Read-only confirmation for an already-booked link. */
async function bookedConfirmation(link: LinkRow) {
  const tz = clinicTz(link);
  let startsAt: string | null = null;
  if (link.booked_appointment_id) {
    const { data } = await supabase.from("appointments")
      .select("starts_at").eq("id", link.booked_appointment_id).maybeSingle();
    startsAt = (data as { starts_at?: string } | null)?.starts_at ?? null;
  }
  return pub({
    booked: true,
    state: "booked",
    appointment_id: link.booked_appointment_id,
    spoken: startsAt ? speakable(startsAt, tz) : null,
  });
}

// ------------------------------------------------------------------
// decline (v1.1) — "None of these work — call me instead". Sets the patient to
// callback_requested so the dialer re-enters them into the queue.
// ------------------------------------------------------------------
async function decline(body: Record<string, unknown>) {
  const link = await resolveLink(String(body.token ?? ""));
  if (!link) return genericInvalid();

  const state = linkState(link);
  if (state === "expired") return genericInvalid();
  if (state === "booked")  return pub({ state: "booked" });
  if (state === "locked")  return pub({ state: "locked" });

  await supabase.from("campaign_patients")
    .update({
      status: "callback_requested",
      callback_after: new Date().toISOString(),
      flag_reason: body.callback ? "requested callback via booking link" : "declined slots via booking link",
      updated_at: new Date().toISOString(),
    })
    .eq("campaign_id", link.campaign_id).eq("patient_id", link.patient_id);

  return pub({ declined: true });
}

/** Best-effort client IP from the usual proxy headers. */
function clientIp(req: Request): string | null {
  const xf = req.headers.get("x-forwarded-for");
  if (xf) return xf.split(",")[0].trim();
  return req.headers.get("x-real-ip");
}
