// Public symptom check API client for /check and /check/:slug.
// Same pattern as lib/booking.ts: no signed-in user, only the anon key.
import { FUNCTIONS_URL } from "./config";

const ANON_KEY = import.meta.env.VITE_SUPABASE_ANON_KEY as string;

export type Sex = "male" | "female";
export type Urgency = "emergency" | "urgent" | "routine" | "self_care";
export type Symptom = { id: string; name: string };
export type Answer = { symptomId: string; present: boolean | "unknown"; source: "search" | "question" };
export type Question = { id: string; text: string; kind: "multi" | "single" | "one_of"; choices: Symptom[] };
export type CheckClinic = { name: string; phone: string | null; local_emergency_numbers: string | null };

export type StartResp = { check_id: string; clinic: CheckClinic | null; available: boolean; demo?: boolean };
export type NextResp = {
  question?: Question;
  result?: { urgency: Urgency; specialties: string[]; red_flags: string[] };
};

export type SlotsResp = {
  days?: { date: string; label: string; count: number }[];
  times?: { slot_start: string; provider_id: string; provider_name: string; label: string }[];
  today_only?: boolean;
};
export type BookResp = { booked: boolean; when?: string | null; already?: boolean; reason?: string; message?: string };

async function post<T>(body: Record<string, unknown>): Promise<{ data: T | null; error: string | null }> {
  try {
    const res = await fetch(`${FUNCTIONS_URL}/symptom-check`, {
      method: "POST",
      headers: { "Content-Type": "application/json", apikey: ANON_KEY, Authorization: `Bearer ${ANON_KEY}` },
      body: JSON.stringify(body),
    });
    const json = await res.json().catch(() => ({}));
    if (!res.ok) {
      const j = json as { error?: string; reason?: string };
      // Booking errors carry a reason (slot_taken, bad_phone…) the page shows.
      return { data: j.reason ? json as T : null, error: j.error ?? j.reason ?? `http_${res.status}` };
    }
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
  clinics: (checkId: string, near?: Point | null) => post<{
    clinics: {
      slug: string; name: string; phone: string | null; specialty_match: boolean; next_label: string | null;
      distance_km: number | null;
    }[];
  }>({ action: "clinics", check_id: checkId, ...(near ? { lat: near.lat, lng: near.lng } : {}) }),
  /** Nearby care (D1b). The location is used for the lookup only, never stored. */
  nearby: (o: { checkId: string | null; kind: "emergency" | "care"; at?: Point; place?: string }) =>
    post<NearbyResp>({
      action: "nearby", check_id: o.checkId ?? undefined, kind: o.kind,
      ...(o.at ? { lat: o.at.lat, lng: o.at.lng } : { place: o.place }),
    }),
  chooseClinic: (checkId: string, clinicSlug: string) =>
    post<{ clinic: CheckClinic }>({ action: "choose_clinic", check_id: checkId, clinic_slug: clinicSlug }),
  slots: (checkId: string, onDate?: string) =>
    post<SlotsResp>({ action: "slots", check_id: checkId, on_date: onDate }),
  book: (checkId: string, details: {
    provider_id: string; slot_start: string; first_name: string; last_name: string; phone: string; date_of_birth: string;
  }) => post<BookResp>({ action: "book", check_id: checkId, ...details }),
};

// ---------------------------------------------------------------------------
// Nearby care (design §3a)
// ---------------------------------------------------------------------------
export type Point = { lat: number; lng: number };
export type NearbyPlace = {
  name: string; address: string | null; distance_km: number; open_now: boolean | null; phone: string | null; maps_url: string;
};
export type NearCareCall = { slug: string; name: string; phone: string | null; distance_km: number };
export type NearbyResp = {
  kind: "emergency" | "care"; origin_label: string | null;
  carecall: NearCareCall[]; places: NearbyPlace[] | null; unavailable: boolean;
};

/** "350 m", "1.2 km", "14 km" (straight line). */
export function distanceLabel(km: number): string {
  if (km < 1) return `${Math.max(50, Math.round((km * 1000) / 50) * 50)} m`;
  if (km < 10) return `${km.toFixed(1)} km`;
  return `${Math.round(km)} km`;
}

/** The browser's location (asks permission). Rejects with a message to show. */
export function browserLocation(timeoutMs = 10_000): Promise<Point> {
  return new Promise((resolve, reject) => {
    if (!("geolocation" in navigator)) { reject(new Error("This browser can't share a location. Type your town instead.")); return; }
    navigator.geolocation.getCurrentPosition(
      (pos) => resolve({ lat: pos.coords.latitude, lng: pos.coords.longitude }),
      (e) => reject(new Error(e.code === e.PERMISSION_DENIED
        ? "Location is blocked for this page. Type your town or barangay instead."
        : "Couldn't get your location. Type your town or barangay instead.")),
      { enableHighAccuracy: false, timeout: timeoutMs, maximumAge: 5 * 60_000 },
    );
  });
}

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
    "Animal Bite Treatment Center": "an Animal Bite Treatment Center (or your health center) for rabies shots",
    // Infermedica's names
    "General practitioner": "a general doctor (GP or family medicine)",
    "Family doctor": "a general doctor (GP or family medicine)",
    "Internist": "an internist (internal medicine)",
    "Otolaryngologist": "an ear, nose and throat doctor (ENT)",
    "Gastroenterologist": "a stomach and digestion specialist (gastroenterologist)",
    "Dermatologist": "a skin doctor (dermatologist)",
    "Pediatrician": "a children's doctor (pediatrician)",
    "Gynecologist": "a women's health doctor (OB-GYN)",
    "Ophthalmologist": "an eye doctor (ophthalmologist)",
    "Cardiologist": "a heart doctor (cardiologist)",
    "Neurologist": "a nerve and brain doctor (neurologist)",
    "Orthopedist": "a bone and joint doctor (orthopedist)",
    "Urologist": "a urinary tract doctor (urologist)",
    "Psychiatrist": "a mental health doctor (psychiatrist)",
    "Pulmonologist": "a lung doctor (pulmonologist)",
  };
  return map[name] ?? name;
}
