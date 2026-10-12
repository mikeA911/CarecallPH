// Public symptom check API client for /check and /check/:slug.
// Same pattern as lib/booking.ts: no signed-in user, only the anon key.
import { FUNCTIONS_URL } from "./config";

const ANON_KEY = import.meta.env.VITE_SUPABASE_ANON_KEY as string;

export type Sex = "male" | "female";
export type Urgency = "emergency" | "urgent" | "routine" | "self_care";
export type Symptom = { id: string; name: string };
export type Answer = { symptomId: string; present: boolean; source: "search" | "question" };
export type Question = { id: string; text: string; kind: "multi"; choices: Symptom[] };
export type CheckClinic = { name: string; phone: string | null; local_emergency_numbers: string | null };

export type StartResp = { check_id: string; clinic: CheckClinic | null; available: boolean };
export type NextResp = {
  question?: Question;
  result?: { urgency: Urgency; specialties: string[]; red_flags: string[] };
};

async function post<T>(body: Record<string, unknown>): Promise<{ data: T | null; error: string | null }> {
  try {
    const res = await fetch(`${FUNCTIONS_URL}/symptom-check`, {
      method: "POST",
      headers: { "Content-Type": "application/json", apikey: ANON_KEY, Authorization: `Bearer ${ANON_KEY}` },
      body: JSON.stringify(body),
    });
    const json = await res.json().catch(() => ({}));
    if (!res.ok) return { data: null, error: (json as { error?: string }).error ?? `http_${res.status}` };
    return { data: json as T, error: null };
  } catch (e) {
    return { data: null, error: (e as Error).message || "network" };
  }
}

export const symptomApi = {
  start: (clinicSlug: string | null, entry: string) =>
    post<StartResp>({ action: "start", clinic_slug: clinicSlug, entry }),
  screen: (checkId: string, emergency: boolean) => post<{ ok: boolean }>({ action: "screen", check_id: checkId, emergency }),
  search: (checkId: string, q: string) => post<{ symptoms: Symptom[] }>({ action: "search", check_id: checkId, q }),
  next: (checkId: string, person: { birthYear: number; sex: Sex }, answers: Answer[]) =>
    post<NextResp>({ action: "next", check_id: checkId, person, answers }),
};

// ---------------------------------------------------------------------------
// Emergency screen (design §2 step 2, §4a). Kept in the page, not the server,
// so it works even when the API or the engine is down.
// DRAFT: a doctor must review this list and the wording before patients use it.
// ---------------------------------------------------------------------------
export type EmergencyQuestion = { id: string; en: string; fil: string };

export const EMERGENCY_QUESTIONS: EmergencyQuestion[] = [
  { id: "chest", en: "Chest pain or pressure, especially with sweating, nausea, or pain spreading to the arm, jaw or back",
    fil: "Pananakit o paninikip ng dibdib" },
  { id: "breathing", en: "Severe trouble breathing, or lips or face turning blue",
    fil: "Matinding hirap sa paghinga" },
  { id: "stroke", en: "Sudden face drooping, weakness of an arm or leg, or trouble speaking",
    fil: "Biglang pagngiwi ng mukha, panghihina ng braso o binti, o hirap magsalita" },
  { id: "bleeding", en: "Heavy bleeding that won't stop, or a serious injury",
    fil: "Malakas na pagdurugo na hindi tumitigil, o malubhang pinsala" },
  { id: "conscious", en: "Fainting, a seizure, or very hard to wake up",
    fil: "Nawalan ng malay, kombulsyon, o hirap gisingin" },
  { id: "selfharm", en: "Thoughts of harming yourself or ending your life",
    fil: "Naiisip na saktan ang sarili o tapusin ang buhay" },
  { id: "pregnancy", en: "Pregnant, with bleeding, severe belly pain or a severe headache",
    fil: "Buntis na may pagdurugo, matinding sakit ng tiyan o ulo" },
  { id: "baby", en: "A baby under 3 months with a fever, or a child who is very drowsy or not drinking",
    fil: "Sanggol na wala pang 3 buwan na may lagnat, o batang sobrang antukin o ayaw uminom" },
];

/** Friendlier names for the engine's specialty names. */
export function specialtyLabel(name: string): string {
  const map: Record<string, string> = {
    "General practice": "a general doctor (GP or family medicine)",
    "Internal medicine": "an internist (internal medicine)",
    "Otolaryngology": "an ear, nose and throat doctor (ENT)",
    "Gastroenterology": "a stomach and digestion specialist (gastroenterologist)",
    "Dermatology": "a skin doctor (dermatologist)",
    "Pediatrics": "a children's doctor (pediatrician)",
    "Gynecology": "a women's health doctor (OB-GYN)",
    "Obstetrics": "a pregnancy doctor (OB-GYN)",
    "Ophthalmology": "an eye doctor (ophthalmologist)",
    "Cardiology": "a heart doctor (cardiologist)",
    "Neurology": "a nerve and brain doctor (neurologist)",
    "Orthopedics": "a bone and joint doctor (orthopedist)",
    "Urology": "a urinary tract doctor (urologist)",
    "Psychiatry": "a mental health doctor (psychiatrist)",
    "Pulmonology": "a lung doctor (pulmonologist)",
  };
  return map[name] ?? name;
}
