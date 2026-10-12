// Book from the symptom check result (Discover slice D1c).
//
//   slots { check_id, on_date? } → { days } | { times }   (clinic-local)
//   book  { check_id, provider_id, slot_start, first_name, last_name, phone,
//           date_of_birth }        → { booked, when, already? } | { booked: false, reason }
//
// Only for checks started on a clinic's page, after a non-emergency result.
// "urgent" results only offer times today; otherwise up to 10 days ahead.
// Providers whose specialty matches the result's first kind of doctor are
// offered first; if none match, every active provider at the clinic.
//
// The patient is found by (clinic, mobile, date of birth) or created. An
// existing patient's name is never changed from this public page, and the
// response is the same either way. One booking per check. The slot is
// re-checked against get_available_slots before inserting, and the
// no_double_booking constraint (23P01) catches races. The appointment carries
// `intake`: the summary the patient agreed to share with the clinic.
import { speakable, supabase } from "../_shared/lib.ts";
import { normalizePhPhone } from "../_shared/phone.ts";
import { PH_RULE_LABELS } from "../_shared/symptom/ph_layer.ts";
import type { SymptomEngine } from "../_shared/symptom/engine.ts";

// TEMPORARY: testers outside the Philippines. Set false before the PH pilot
// (same switch as ALLOW_INTERNATIONAL_PATIENT_PHONES in the portal).
const ALLOW_INTERNATIONAL_PHONES = true;

export type BookableCheck = {
  id: string;
  clinic_id: string | null;
  urgency: string | null;
  specialty: string | null;
  outcome: string;
  appointment_id: string | null;
  age_band: string | null;
  sex: string | null;
  symptom_ids: string[] | null;
  ph_rules: string[] | null;
  engine: string | null;
};

type Pub = (data: unknown, status?: number) => Response;
type Slot = { slot_start: string; slot_end: string; provider_id: string; provider_name: string };

/** Why this check can't book, or null if it can. */
function notBookable(c: BookableCheck): string | null {
  if (!c.clinic_id) return "no_clinic";
  if (c.urgency === "emergency") return "emergency";
  if (!c.urgency || (c.outcome !== "advised" && c.outcome !== "booked")) return "no_result";
  return null;
}

async function clinicTz(clinicId: string): Promise<string> {
  const { data } = await supabase.from("clinics").select("timezone").eq("id", clinicId).maybeSingle();
  return (data as { timezone?: string } | null)?.timezone || "Asia/Manila";
}

/** Shared word stems, e.g. "Pediatrics" ~ "Pediatrician", "Otolaryngology" ~ "ENT / Otolaryngologist". */
export function specialtyMatches(providerSpecialty: string | null, wanted: string | null): boolean {
  if (!providerSpecialty || !wanted) return false;
  const stems = (s: string) =>
    new Set(s.toLowerCase().split(/[^a-z]+/).filter((w) => w.length >= 4).map((w) => w.slice(0, 6)));
  const a = stems(providerSpecialty), b = stems(wanted);
  return [...a].some((x) => b.has(x));
}

async function candidateProviders(c: BookableCheck): Promise<{ id: string; name: string }[]> {
  const { data } = await supabase.from("providers")
    .select("id, name, specialty").eq("clinic_id", c.clinic_id!).eq("active", true);
  const all = (data ?? []) as { id: string; name: string; specialty: string | null }[];
  const matched = all.filter((p) => specialtyMatches(p.specialty, c.specialty));
  return (matched.length ? matched : all).map(({ id, name }) => ({ id, name }));
}

async function openSlots(c: BookableCheck, tz: string, onDate?: string): Promise<Slot[]> {
  const today = new Date().toLocaleDateString("en-CA", { timeZone: tz });
  const urgent = c.urgency === "urgent";
  const from = urgent ? today : onDate ?? today;
  const days = urgent || onDate ? 1 : 10;
  const out: Slot[] = [];
  for (const p of await candidateProviders(c)) {
    const { data, error } = await supabase.rpc("get_available_slots", {
      p_provider_id: p.id, p_from: from, p_days: days, p_limit: 300, p_tz: tz,
    });
    if (error) throw error;
    for (const s of (data ?? []) as { slot_start: string; slot_end: string }[]) {
      out.push({ ...s, provider_id: p.id, provider_name: p.name });
    }
  }
  return out.sort((a, b) => a.slot_start.localeCompare(b.slot_start));
}

export async function slots(c: BookableCheck, body: Record<string, unknown>, pub: Pub) {
  const why = notBookable(c);
  if (why) return pub({ error: why }, 409);
  const tz = await clinicTz(c.clinic_id!);
  const onDate = typeof body.on_date === "string" && /^\d{4}-\d{2}-\d{2}$/.test(body.on_date) ? body.on_date : undefined;
  const rows = await openSlots(c, tz, c.urgency === "urgent" ? undefined : onDate);
  const localDate = (iso: string) => new Date(iso).toLocaleDateString("en-CA", { timeZone: tz });

  if (onDate || c.urgency === "urgent") {
    const date = onDate ?? new Date().toLocaleDateString("en-CA", { timeZone: tz });
    const seen = new Set<string>();
    const times = rows.filter((s) => localDate(s.slot_start) === date).flatMap((s) => {
      if (seen.has(s.slot_start)) return []; // one entry per time; first doctor free
      seen.add(s.slot_start);
      return [{
        slot_start: s.slot_start, provider_id: s.provider_id, provider_name: s.provider_name,
        label: new Date(s.slot_start).toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit", timeZone: tz }),
      }];
    });
    return pub({ times, date, today_only: c.urgency === "urgent", timezone: tz });
  }

  const byDate = new Map<string, { date: string; label: string; count: number }>();
  for (const s of rows) {
    const date = localDate(s.slot_start);
    const d = byDate.get(date);
    if (d) d.count++;
    else {
      byDate.set(date, {
        date, count: 1,
        label: new Date(s.slot_start).toLocaleDateString("en-US", { weekday: "long", month: "long", day: "numeric", timeZone: tz }),
      });
    }
  }
  return pub({ days: [...byDate.values()].slice(0, 10), timezone: tz });
}

export async function book(c: BookableCheck, body: Record<string, unknown>, engine: SymptomEngine | null, pub: Pub) {
  const why = notBookable(c);
  if (why) return pub({ booked: false, reason: why }, 409);
  const tz = await clinicTz(c.clinic_id!);

  // One booking per check: a retry or second tap gets the same confirmation.
  if (c.appointment_id) {
    const { data } = await supabase.from("appointments").select("starts_at").eq("id", c.appointment_id).maybeSingle();
    const at = (data as { starts_at?: string } | null)?.starts_at;
    return pub({ booked: true, already: true, when: at ? speakable(at, tz) : null });
  }

  // --- validate the patient's details ---------------------------------
  const first = clean(body.first_name), last = clean(body.last_name);
  if (!first || !last) return pub({ booked: false, reason: "name_required" }, 400);
  const phone = normalizePhPhone(String(body.phone ?? ""), { allowInternational: ALLOW_INTERNATIONAL_PHONES });
  if (!phone.ok) return pub({ booked: false, reason: "bad_phone", message: phone.error }, 400);
  const dob = String(body.date_of_birth ?? "");
  if (!validDob(dob)) return pub({ booked: false, reason: "bad_dob" }, 400);

  // --- re-check the slot ------------------------------------------------
  const providerId = String(body.provider_id ?? "");
  const slotStart = String(body.slot_start ?? "");
  const day = new Date(slotStart);
  if (!providerId || isNaN(day.getTime())) return pub({ booked: false, reason: "slot_taken" }, 409);
  const onDate = day.toLocaleDateString("en-CA", { timeZone: tz });
  const open = (await openSlots(c, tz, c.urgency === "urgent" ? undefined : onDate))
    .find((s) => s.provider_id === providerId && new Date(s.slot_start).getTime() === day.getTime());
  if (!open) return pub({ booked: false, reason: "slot_taken" }, 409);

  // --- find or create the patient (never edits an existing record) ------
  let patientId: string;
  const { data: found } = await supabase.from("patients").select("id")
    .eq("clinic_id", c.clinic_id!).eq("phone", phone.e164).eq("date_of_birth", dob).maybeSingle();
  if (found) {
    patientId = (found as { id: string }).id;
  } else {
    const { data: created, error } = await supabase.from("patients").insert({
      clinic_id: c.clinic_id, first_name: first, last_name: last, phone: phone.e164, date_of_birth: dob,
      notes: "Added from the online symptom check.",
    }).select("id").single();
    if (error) {
      if (error.code !== "23505") throw error;
      // Created by a parallel request a moment ago.
      const { data: again } = await supabase.from("patients").select("id")
        .eq("clinic_id", c.clinic_id!).eq("phone", phone.e164).eq("date_of_birth", dob).single();
      patientId = (again as { id: string }).id;
    } else {
      patientId = (created as { id: string }).id;
    }
  }

  // --- book ------------------------------------------------------------
  const { data: appt, error } = await supabase.from("appointments").insert({
    patient_id: patientId,
    provider_id: open.provider_id,
    campaign_id: null,
    starts_at: open.slot_start,
    ends_at: open.slot_end,
    idempotency_key: `check:${c.id}`,
    source: "symptom_check",
    intake: await intake(c, engine),
  }).select("id, starts_at").single();

  if (error) {
    if (error.code === "23P01") return pub({ booked: false, reason: "slot_taken" }, 409);
    if (error.code === "23505") { // same check booked by a parallel request
      const { data: prev } = await supabase.from("appointments").select("id, starts_at")
        .eq("idempotency_key", `check:${c.id}`).single();
      const p = prev as { id: string; starts_at: string };
      await markBooked(c.id, p.id);
      return pub({ booked: true, already: true, when: speakable(p.starts_at, tz) });
    }
    throw error;
  }

  const a = appt as { id: string; starts_at: string };
  await markBooked(c.id, a.id);
  return pub({ booked: true, when: speakable(a.starts_at, tz), provider_name: open.provider_name });
}

async function markBooked(checkId: string, appointmentId: string) {
  await supabase.from("symptom_checks")
    .update({ outcome: "booked", appointment_id: appointmentId, updated_at: new Date().toISOString() })
    .eq("id", checkId);
}

/** The summary the patient agreed to share with the clinic. */
async function intake(c: BookableCheck, engine: SymptomEngine | null) {
  const symptoms: string[] = [];
  for (const id of c.symptom_ids ?? []) {
    const name = engine ? await engine.nameOf(id).catch(() => null) : null;
    if (name) symptoms.push(name);
  }
  return {
    source: "symptom_check",
    check_id: c.id,
    urgency: c.urgency,
    specialty: c.specialty,
    age_band: c.age_band,
    sex: c.sex,
    symptoms,
    ph_warnings: (c.ph_rules ?? []).map((r) => PH_RULE_LABELS[r] ?? r),
    engine: c.engine,
    demo: c.engine === "demo",
  };
}

function clean(v: unknown): string {
  return String(v ?? "").replace(/\s+/g, " ").trim().slice(0, 60);
}

export function validDob(s: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return false;
  const d = new Date(`${s}T00:00:00Z`);
  return !isNaN(d.getTime()) && d.toISOString().slice(0, 10) === s && d <= new Date() &&
    d.getUTCFullYear() > new Date().getUTCFullYear() - 120;
}
