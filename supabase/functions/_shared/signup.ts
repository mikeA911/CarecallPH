// Patient sign-up page (/join/<clinic>): checks what the patient typed.
// Pure functions, used by patient-signup; tests in signup_test.ts.
import { normalizePhPhone } from "./phone.ts";

/**
 * Wording version of the privacy notice shown on the page
 * (web/src/lib/signup.ts keeps the text). Bump both together.
 * DRAFT: needs the clinic's Data Protection Officer to approve before the pilot.
 */
export const PRIVACY_NOTICE_VERSION = "signup-2026-10-draft";

export type SignupInput = {
  first_name: string; last_name: string; phone: string; date_of_birth: string;
  chat: boolean; sms: boolean;
};

export type SignupError = "name_required" | "bad_phone" | "bad_dob" | "privacy_required" | "old_notice";

export function validDob(s: string, now = new Date()): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return false;
  const d = new Date(`${s}T00:00:00Z`);
  return !isNaN(d.getTime()) && d.toISOString().slice(0, 10) === s && d <= now &&
    d.getUTCFullYear() > now.getUTCFullYear() - 120;
}

const clean = (v: unknown) => String(v ?? "").replace(/\s+/g, " ").trim().slice(0, 60);

/** Check the form. The privacy notice must be accepted, in its current wording. */
export function parseSignup(
  body: Record<string, unknown>, opts: { allowInternational: boolean; now?: Date },
): { ok: true; value: SignupInput } | { ok: false; error: SignupError; message?: string } {
  const first = clean(body.first_name), last = clean(body.last_name);
  if (!first || !last) return { ok: false, error: "name_required" };
  const phone = normalizePhPhone(String(body.phone ?? ""), { allowInternational: opts.allowInternational });
  if (!phone.ok) return { ok: false, error: "bad_phone", message: phone.error };
  const dob = String(body.date_of_birth ?? "");
  if (!validDob(dob, opts.now)) return { ok: false, error: "bad_dob" };
  if (body.privacy_accepted !== true) return { ok: false, error: "privacy_required" };
  if (body.privacy_notice_version !== PRIVACY_NOTICE_VERSION) return { ok: false, error: "old_notice" };
  return {
    ok: true,
    value: { first_name: first, last_name: last, phone: phone.e164, date_of_birth: dob, chat: body.chat === true, sms: body.sms === true },
  };
}
