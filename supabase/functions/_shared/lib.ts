// Shared helpers for CareCall edge functions (Deno / Supabase Edge Runtime)
import { createClient } from "npm:@supabase/supabase-js@2";
import { type ClinicalRole, clinicalRoleOf } from "./roles.ts";

export const supabase = createClient(
  Deno.env.get("SUPABASE_URL")!,
  Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, // service role: bypasses RLS, server-side only
);

export const TELNYX_API = "https://api.telnyx.com/v2";

export async function telnyx(path: string, body: unknown, method = "POST") {
  const res = await fetch(`${TELNYX_API}${path}`, {
    method,
    headers: {
      Authorization: `Bearer ${Deno.env.get("TELNYX_API_KEY")}`,
      "Content-Type": "application/json",
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) {
    console.error(`Telnyx ${path} failed`, res.status, JSON.stringify(json));
    throw new Error(`Telnyx API error ${res.status}`);
  }
  return json;
}

export function json(data: unknown, status = 200, extraHeaders: Record<string, string> = {}) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json", ...extraHeaders },
  });
}

/** Verify requests from Telnyx tool webhooks using a shared secret header. */
export function checkToolSecret(req: Request): boolean {
  return req.headers.get("x-carecall-secret") === Deno.env.get("TOOL_WEBHOOK_SECRET");
}

// ---------------------------------------------------------------------------
// Auth helpers for portal-facing edge functions.
// ---------------------------------------------------------------------------

export type Caller = {
  userId: string;
  role: "admin" | "clinic_admin" | "staff" | "";
  clinicId: string | null;
  /** doctor | nurse | front_desk; defaults by access level when unset (roles.ts). */
  clinicalRole: ClinicalRole | null;
};

/**
 * Resolve the calling portal user from the Authorization bearer token.
 * Uses the service-role client to validate the JWT and read app_metadata,
 * which carries role, clinic_id and clinical_role (set only by admin-manage, never client-writable).
 */
export async function getCaller(req: Request): Promise<Caller | null> {
  const auth = req.headers.get("Authorization") ?? "";
  if (!auth.startsWith("Bearer ")) return null;
  const token = auth.slice("Bearer ".length);
  const { data, error } = await supabase.auth.getUser(token);
  if (error || !data.user) return null;
  const meta = (data.user.app_metadata ?? {}) as Record<string, unknown>;
  return {
    userId: data.user.id,
    role: (meta.role as Caller["role"]) ?? "",
    clinicId: (meta.clinic_id as string) ?? null,
    clinicalRole: clinicalRoleOf((meta.role as Caller["role"]) ?? "", meta.clinical_role),
  };
}

/** Write an audit_log row (best-effort; failures are logged, not thrown). */
export async function audit(entry: {
  clinicId: string | null;
  actorUserId: string | null;
  action: string;
  targetType?: string;
  targetId?: string | null;
  detail?: unknown;
}) {
  const { error } = await supabase.from("audit_log").insert({
    clinic_id: entry.clinicId,
    actor_user_id: entry.actorUserId,
    action: entry.action,
    target_type: entry.targetType ?? null,
    target_id: entry.targetId ?? null,
    detail: entry.detail ?? null,
  });
  if (error) console.error("audit write failed", error);
}

export function corsHeaders() {
  return {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
  };
}

/** Format a timestamptz into speech-friendly text, e.g. "Tuesday, July 7th at 10:00 AM". */
export function speakable(iso: string, tz: string): string {
  const d = new Date(iso);
  const day = d.toLocaleDateString("en-US", { weekday: "long", month: "long", day: "numeric", timeZone: tz });
  const time = d.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit", timeZone: tz });
  return `${day} at ${time}`;
}

// ---------------------------------------------------------------------------
// Booking-link token helpers (self-booking-link-spec §3).
// The raw token lives only in the SMS/URL; the DB stores only its SHA-256 hash,
// so a leaked database never leaks usable links.
// ---------------------------------------------------------------------------

/** Generate a 128-bit random base64url token (~22 chars, fits one URL segment). */
export function generateBookingToken(): string {
  const bytes = new Uint8Array(16); // 128 bits
  crypto.getRandomValues(bytes);
  let bin = "";
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

/** SHA-256 hex of a raw token — the value stored in booking_links.token_hash. */
export async function hashBookingToken(token: string): Promise<string> {
  const data = new TextEncoder().encode(token);
  const digest = await crypto.subtle.digest("SHA-256", data);
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

/**
 * Create (or refresh) the ONE active booking link for a (campaign, patient) and
 * return its public URL, or null if self-booking is unavailable. Enforces the
 * "one active link per (campaign, patient)" rule by expiring priors. The raw
 * token is returned only in the URL; the DB stores its hash.
 *
 * Requires PORTAL_URL (e.g. https://portal.example.com). Returns null when
 * PORTAL_URL is unset so callers can gracefully fall back to a link-free SMS.
 */
export async function createBookingLink(
  campaignId: string,
  patientId: string,
  clinicId: string | null,
): Promise<string | null> {
  const portal = (Deno.env.get("PORTAL_URL") ?? "").replace(/\/$/, "");
  if (!portal) return null;

  const token = generateBookingToken();
  const tokenHash = await hashBookingToken(token);

  // Expire any prior active links for this pair (one active link per pair).
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
  return `${portal}/book/${token}`;
}
