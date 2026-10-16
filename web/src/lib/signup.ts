// Public patient sign-up page API client (/join/:slug). Same pattern as
// lib/symptomCheck.ts: no signed-in user, only the anon key.
import { FUNCTIONS_URL } from "./config";

const ANON_KEY = import.meta.env.VITE_SUPABASE_ANON_KEY as string;

/**
 * Must match PRIVACY_NOTICE_VERSION in supabase/functions/_shared/signup.ts;
 * the server refuses an older wording. Bump both when the text changes.
 * DRAFT: the clinic's Data Protection Officer must approve the text before the pilot.
 */
export const PRIVACY_NOTICE_VERSION = "signup-2026-10-draft";

export function privacyNotice(clinic: string): string[] {
  return [
    `${clinic} collects your name, mobile number and date of birth to register you as a patient and manage ` +
      "your appointments. If you choose, it also uses them to send you reminders and messages.",
    "CareCall, the clinic's software provider, stores and processes this information for the clinic and does " +
      "not use it for anything else. Medical records are kept for as long as the law requires.",
    "You can ask the clinic to show you your information, correct it, stop using it, or delete it where the law " +
      "allows. Ask at the front desk or contact the clinic's Data Protection Officer. You can also contact the " +
      "National Privacy Commission.",
  ];
}

export type JoinStart = { clinic: { name: string; phone: string | null } };
export type JoinResult = {
  registered: boolean; existing?: boolean; connect_token?: string; reason?: string; message?: string;
};

async function post<T>(body: Record<string, unknown>): Promise<{ data: T | null; error: string | null }> {
  try {
    const res = await fetch(`${FUNCTIONS_URL}/patient-signup`, {
      method: "POST",
      headers: { "Content-Type": "application/json", apikey: ANON_KEY, Authorization: `Bearer ${ANON_KEY}` },
      body: JSON.stringify(body),
    });
    const json = await res.json().catch(() => ({}));
    if (!res.ok) {
      const j = json as { error?: string; reason?: string };
      return { data: j.reason ? json as T : null, error: j.error ?? j.reason ?? `http_${res.status}` };
    }
    return { data: json as T, error: null };
  } catch (e) {
    return { data: null, error: (e as Error).message || "network" };
  }
}

export const signupApi = {
  start: (slug: string) => post<JoinStart>({ action: "start", clinic_slug: slug }),
  signup: (slug: string, f: {
    first_name: string; last_name: string; phone: string; date_of_birth: string; chat: boolean; sms: boolean;
  }) => post<JoinResult>({
    action: "signup", clinic_slug: slug, ...f, privacy_accepted: true, privacy_notice_version: PRIVACY_NOTICE_VERSION,
  }),
};
