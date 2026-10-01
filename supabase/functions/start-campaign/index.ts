// start-campaign — MERGED VERSION (CLI deploy required: imports _shared/channels.ts)
//
// Combines:
//   • Status machine: only 'active' campaigns dial; auto-complete when queue empties (§2.5)
//   • Calling-hours gate via clinic_within_calling_hours RPC (§4.4)
//   • DNC / inactive-patient exclusion at query level (§4.2)
//   • clinic_id threading on call_logs; per-campaign telnyx_assistant_id override
//   • CORS handling for the browser portal
// with:
//   • Pre-call SMS two-phase queue: pending → notified (SMS + dial_after) → calling
//   • Sweep mode for Supabase Cron: { "sweep": true } advances ALL active campaigns
//
// Invocation:
//   Portal:  POST { campaign_id, batch_size? }   (user JWT)
//   Cron:    POST { sweep: true, batch_size? }   (anon/service key, every minute)
//
// Pre-call notice is skipped (dial immediately) when SMS_PRECALL_LEAD_SECONDS=0
// or the patient has no permitted channel. Send failure falls back to dialing.
//
// CareCall PH Phase 1: the pre-call notice now goes through the shared channel
// layer (_shared/channels.ts) — Viber / Messenger / Telegram when the patient
// has opted in there, otherwise SMS with consent. When a clinic has
// chat_optin_enabled, SMS notices carry a /connect/<token> chat invite.
// Because of the _shared import this function must be deployed with the CLI:
//   supabase functions deploy start-campaign

import { createClient } from "npm:@supabase/supabase-js@2";
import {
  type Channel,
  canMessage,
  createChannelInvite,
  hasChatChannel,
  sendToPatient,
} from "../_shared/channels.ts";

const supabase = createClient(
  Deno.env.get("SUPABASE_URL")!,
  Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
);

const TELNYX_API = "https://api.telnyx.com/v2";
const CONNECTION_ID = Deno.env.get("TELNYX_CONNECTION_ID")!;
const FROM_NUMBER = Deno.env.get("TELNYX_FROM_NUMBER")!;
const CLINIC_NAME_FALLBACK = Deno.env.get("CLINIC_NAME") ?? "your clinic";
// Env default lead time; per-clinic clinics.sms_precall_lead_seconds overrides it.
const LEAD_SECONDS = Number(Deno.env.get("SMS_PRECALL_LEAD_SECONDS") ?? "120");
// Base URL for self-service booking links (/book/<token>). Unset → no link.
const PORTAL_URL = (Deno.env.get("PORTAL_URL") ?? "").replace(/\/$/, "");

function corsHeaders(): Record<string, string> {
  return {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
  };
}

function json(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json", ...corsHeaders() },
  });
}

async function telnyx(path: string, body: unknown, method = "POST") {
  const res = await fetch(`${TELNYX_API}${path}`, {
    method,
    headers: {
      Authorization: `Bearer ${Deno.env.get("TELNYX_API_KEY")}`,
      "Content-Type": "application/json",
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const j = await res.json().catch(() => ({}));
  if (!res.ok) {
    console.error(`Telnyx ${path} failed`, res.status, JSON.stringify(j));
    throw new Error(`Telnyx API error ${res.status}`);
  }
  return j;
}

type Campaign = {
  id: string;
  status: string;
  clinic_id: string | null;
  greeting_context: string;
  telnyx_assistant_id?: string | null;
};

type QueueRow = {
  patient_id: string;
  attempts: number;
  dial_after?: string | null;
  patients: {
    id: string;
    first_name: string;
    phone: string;
    sms_consent?: boolean;
    preferred_channel?: Channel | null;
  } | null;
};

// Stop retrying a stuck 'notified' row after this long (SMS sent but every dial
// fails). ~30 sweep ticks at one per minute; generous for transient errors (§3.4).
const STALE_NOTIFIED_MS = 30 * 60 * 1000;

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders() });

  const auth = req.headers.get("Authorization") ?? "";
  if (!auth.startsWith("Bearer ")) return json({ error: "unauthorized" }, 401);

  const body = await req.json().catch(() => ({}));
  const batchSize: number = body.batch_size ?? 3;

  let campaigns: Campaign[] = [];
  if (body.sweep) {
    const { data } = await supabase.from("campaigns")
      .select("id, status, clinic_id, greeting_context, telnyx_assistant_id")
      .eq("status", "active");
    campaigns = (data as Campaign[]) ?? [];
  } else if (body.campaign_id) {
    const { data } = await supabase.from("campaigns")
      .select("id, status, clinic_id, greeting_context, telnyx_assistant_id")
      .eq("id", body.campaign_id).single();
    if (!data) return json({ error: "campaign not found" }, 404);
    if (data.status !== "active") {
      return json({ started: 0, notified: 0, message: `campaign is ${data.status}, not active` });
    }
    campaigns = [data as Campaign];
  } else {
    return json({ error: "campaign_id or sweep:true required" }, 400);
  }

  let notified = 0, started = 0, skippedHours = 0;
  for (const c of campaigns) {
    // Calling-hours gate (§4.4): skip this campaign outside its clinic's window
    const { data: withinHours } = await supabase.rpc("clinic_within_calling_hours", {
      p_clinic_id: c.clinic_id,
    });
    if (withinHours === false) { skippedHours++; continue; }

    const r = await processCampaign(c, batchSize);
    notified += r.notified;
    started += r.started;
  }

  return json({ notified, started, campaigns: campaigns.length, skipped_outside_hours: skippedHours });
});

async function processCampaign(campaign: Campaign, batchSize: number) {
  let notified = 0, started = 0;

  // Per-clinic pre-call lead time (§3.2): null → env default; 0 → off for this
  // clinic (dial straight away, no text).
  const leadSeconds = await clinicLeadSeconds(campaign.clinic_id);
  // Whether to notify before dialing at all; per-patient channel permission is
  // checked in the Phase A loop (chat opt-in or SMS consent).
  const precallNotice = leadSeconds > 0;

  const now = Date.now();
  const staleCutoff = new Date(now - STALE_NOTIFIED_MS).toISOString();

  // ---- Phase B first: dial anyone whose SMS lead time has elapsed ----
  // (DNC/active filters repeated here: a patient can be flagged between phases)
  const { data: due } = await supabase.from("campaign_patients")
    .select("patient_id, attempts, dial_after, patients!inner(*)")
    .eq("campaign_id", campaign.id)
    .eq("patients.do_not_call", false)
    .eq("patients.active", true)
    .eq("status", "notified")
    .lte("dial_after", new Date(now).toISOString())
    .limit(batchSize);

  for (const row of (due ?? []) as unknown as QueueRow[]) {
    // Stale-notified recovery guard (§3.4): SMS went out but dials keep failing.
    // After 30 minutes, stop the retry loop and surface it in the review queue.
    if (row.dial_after && row.dial_after < staleCutoff) {
      await supabase.from("campaign_patients").update({
        status: "needs_human",
        flag_reason: "dial failed after pre-call SMS",
        updated_at: new Date().toISOString(),
      }).eq("campaign_id", campaign.id).eq("patient_id", row.patient_id);
      continue;
    }
    if (await dialPatient(campaign, row)) started++;
  }

  // ---- Phase A: notify next pending / due-callback batch ----
  const { data: queue } = await supabase.from("campaign_patients")
    .select("patient_id, attempts, patients!inner(*)")
    .eq("campaign_id", campaign.id)
    .eq("patients.do_not_call", false)
    .eq("patients.active", true)
    .or(`status.eq.pending,and(status.eq.callback_requested,callback_after.lte.${new Date().toISOString()})`)
    .limit(batchSize);

  if (!queue?.length && !due?.length) {
    // Auto-complete (§2.5). 'notified' MUST count as in-flight, or campaigns
    // complete while patients are mid-countdown awaiting their call.
    const { count } = await supabase.from("campaign_patients")
      .select("patient_id", { count: "exact", head: true })
      .eq("campaign_id", campaign.id)
      .in("status", ["pending", "notified", "calling", "callback_requested"]);
    if (!count) {
      await supabase.from("campaigns").update({ status: "completed" }).eq("id", campaign.id);
    }
    return { notified, started };
  }

  for (const row of (queue ?? []) as unknown as QueueRow[]) {
    const patient = row.patients;
    if (!patient) continue;

    // Pre-call notice is skipped (dial directly) when the feature is off for
    // this clinic OR the patient has no permitted channel (no chat opt-in and
    // no SMS consent, §3.3). Lack of consent never blocks the call itself.
    if (!precallNotice || !(await canMessage(patient))) {
      if (await dialPatient(campaign, row)) started++;
      continue;
    }

    const clinicName = await clinicDisplayName(campaign.clinic_id);
    const mins = Math.max(1, Math.round(leadSeconds / 60));
    // Self-booking link injection (§5), gated per-clinic. When enabled and a
    // link can be minted, offer the self-serve path so booking can pre-empt the
    // call (campaigns using this should prefer a longer lead, 5–10 min).
    let bookingLink: string | null = null;
    if (await clinicSelfBooking(campaign.clinic_id)) {
      bookingLink = await createBookingLink(campaign.id, patient.id, campaign.clinic_id);
    }
    // Chat invite (PH Phase 1): only for SMS notices, only when the patient has
    // no chat channel yet, and only when there's no booking link already in the
    // text (keeps the SMS to one link / short enough to read).
    let inviteLink: string | null = null;
    if (!bookingLink && await clinicChatOptin(campaign.clinic_id) && !(await hasChatChannel(patient.id))) {
      inviteLink = await createChannelInvite(patient.id, campaign.clinic_id);
    }

    const text = (ch: Channel) => {
      const where = ch === "sms" ? "from this number" : "on your registered mobile number";
      const base =
        `Hi ${patient.first_name}, this is ${clinicName}. We'll call you ` +
        `in about ${mins} minute${mins === 1 ? "" : "s"} ${where} to help ` +
        `schedule an appointment`;
      if (bookingLink) return `${base} — or book yourself now: ${bookingLink}. Reply STOP to opt out.`;
      if (ch === "sms" && inviteLink) {
        return `${base}. Get reminders on Viber, Messenger or Telegram: ${inviteLink}. Reply STOP to opt out.`;
      }
      return `${base}. Reply STOP to opt out.`;
    };

    const sent = await sendToPatient({
      patient,
      clinicId: campaign.clinic_id,
      clinicName,
      campaignId: campaign.id,
      text,
    });

    if (sent.ok) {
      await supabase.from("campaign_patients").update({
        status: "notified",
        dial_after: new Date(Date.now() + leadSeconds * 1000).toISOString(),
        updated_at: new Date().toISOString(),
      }).eq("campaign_id", campaign.id).eq("patient_id", patient.id);
      notified++;
    } else {
      console.error(`pre-call notice failed for ${patient.id} (${sent.channel ?? "no channel"}); dialing directly`);
      if (await dialPatient(campaign, row)) started++;
    }
  }

  return { notified, started };
}

// Per-clinic pre-call lead time. Reads clinics.sms_precall_lead_seconds:
//   null  → env SMS_PRECALL_LEAD_SECONDS (default 120)
//   0     → feature off for this clinic
// Env default falls back to 120 when unset. Cached per invocation.
const clinicLeadCache = new Map<string, number>();
async function clinicLeadSeconds(clinicId: string | null): Promise<number> {
  if (!clinicId) return LEAD_SECONDS;
  const cached = clinicLeadCache.get(clinicId);
  if (cached !== undefined) return cached;
  let lead = LEAD_SECONDS;
  try {
    const { data } = await supabase.from("clinics")
      .select("sms_precall_lead_seconds").eq("id", clinicId).single();
    if (data && data.sms_precall_lead_seconds !== null && data.sms_precall_lead_seconds !== undefined) {
      lead = Number(data.sms_precall_lead_seconds);
    }
  } catch { /* fall back to env default */ }
  clinicLeadCache.set(clinicId, lead);
  return lead;
}

// Clinic display name from the clinics table (multi-clinic), env fallback.
const clinicNameCache = new Map<string, string>();
async function clinicDisplayName(clinicId: string | null): Promise<string> {
  if (!clinicId) return CLINIC_NAME_FALLBACK;
  const cached = clinicNameCache.get(clinicId);
  if (cached) return cached;
  try {
    const { data } = await supabase.from("clinics").select("name").eq("id", clinicId).single();
    const name = data?.name ?? CLINIC_NAME_FALLBACK;
    clinicNameCache.set(clinicId, name);
    return name;
  } catch {
    return CLINIC_NAME_FALLBACK;
  }
}

// ---------------------------------------------------------------------------
// Self-service booking link (self-booking-link-spec §3/§5). Inlined here so
// this function stays self-contained (no _shared import). The raw token lives
// only in the URL; the DB stores only its SHA-256 hash, so a leaked database
// never leaks usable links.
// ---------------------------------------------------------------------------

/** 128-bit random base64url token (~22 chars, fits one URL segment). */
function generateBookingToken(): string {
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  let bin = "";
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

/** SHA-256 hex of a raw token — the value stored in booking_links.token_hash. */
async function hashBookingToken(token: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(token));
  return Array.from(new Uint8Array(digest)).map((b) => b.toString(16).padStart(2, "0")).join("");
}

/**
 * Create (or refresh) the ONE active booking link for a (campaign, patient) and
 * return its public URL, or null if self-booking is unavailable (no PORTAL_URL
 * or insert failed). Enforces "one active link per pair" by expiring priors.
 */
async function createBookingLink(
  campaignId: string,
  patientId: string,
  clinicId: string | null,
): Promise<string | null> {
  if (!PORTAL_URL) return null;

  const token = generateBookingToken();
  const tokenHash = await hashBookingToken(token);

  // Expire any prior active (unbooked, unexpired) links for this pair.
  await supabase.from("booking_links")
    .update({ expires_at: new Date().toISOString() })
    .eq("campaign_id", campaignId)
    .eq("patient_id", patientId)
    .is("booked_appointment_id", null)
    .gt("expires_at", new Date().toISOString());

  const { error } = await supabase.from("booking_links").insert({
    token_hash: tokenHash,
    campaign_id: campaignId,
    patient_id: patientId,
    clinic_id: clinicId,
    // expires_at defaults to now() + 7 days in the schema.
  });
  if (error) {
    console.error("createBookingLink insert failed", error);
    return null;
  }
  return `${PORTAL_URL}/book/${token}`;
}

// Per-clinic chat opt-in invites (PH Phase 1). Default false. Cached per invocation.
const clinicChatOptinCache = new Map<string, boolean>();
async function clinicChatOptin(clinicId: string | null): Promise<boolean> {
  if (!clinicId) return false;
  const cached = clinicChatOptinCache.get(clinicId);
  if (cached !== undefined) return cached;
  let enabled = false;
  try {
    const { data } = await supabase.from("clinics")
      .select("chat_optin_enabled").eq("id", clinicId).single();
    enabled = data?.chat_optin_enabled === true;
  } catch { /* default off */ }
  clinicChatOptinCache.set(clinicId, enabled);
  return enabled;
}

// Per-clinic self-booking flag (§5). Default false (feature off). Cached per
// invocation. Null clinic → off (we can't scope a link without a clinic).
const clinicSelfBookingCache = new Map<string, boolean>();
async function clinicSelfBooking(clinicId: string | null): Promise<boolean> {
  if (!clinicId) return false;
  const cached = clinicSelfBookingCache.get(clinicId);
  if (cached !== undefined) return cached;
  let enabled = false;
  try {
    const { data } = await supabase.from("clinics")
      .select("self_booking_enabled").eq("id", clinicId).single();
    enabled = data?.self_booking_enabled === true;
  } catch { /* default off */ }
  clinicSelfBookingCache.set(clinicId, enabled);
  return enabled;
}

async function dialPatient(campaign: Campaign, row: QueueRow): Promise<boolean> {
  const patient = row.patients;
  if (!patient) return false;

  const clientState = btoa(JSON.stringify({
    campaign_id: campaign.id,
    patient_id: patient.id,
    patient_phone: patient.phone,
    patient_first_name: patient.first_name,
    campaign_context: campaign.greeting_context,
    // The appointment/campaign type is NOT sent to the AI — it only selects
    // which Telnyx assistant answers. That assistant already embeds the
    // type-specific behaviour in its own prompt.
    assistant_id: campaign.telnyx_assistant_id ?? null,
  }));

  try {
    const call = await telnyx("/calls", {
      connection_id: CONNECTION_ID,
      to: patient.phone,
      from: FROM_NUMBER,
      answering_machine_detection: "premium",
      client_state: clientState,
      timeout_secs: 30,
    });

    const ccid = call?.data?.call_control_id;
    await Promise.all([
      supabase.from("call_logs").insert({
        call_control_id: ccid,
        patient_id: patient.id,
        campaign_id: campaign.id,
        clinic_id: campaign.clinic_id,
      }),
      supabase.from("campaign_patients").update({
        status: "calling",
        attempts: (row.attempts ?? 0) + 1,
        last_attempt_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      }).eq("campaign_id", campaign.id).eq("patient_id", patient.id),
    ]);
    return true;
  } catch (e) {
    console.error(`dial failed for patient ${patient.id}`, e);
    return false;
  }
}
