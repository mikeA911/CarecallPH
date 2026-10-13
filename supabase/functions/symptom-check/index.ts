// CareCall PH — public symptom check API (Discover slice D1a).
// Design: docs/symptom-check-design.md
//
// Backs the /check and /check/<clinic> pages. PUBLIC: no Supabase JWT
// (verify_jwt off in config.toml). One POST endpoint, body.action selects:
//   start  { clinic_slug?, entry }            → { check_id, clinic, available }
//   screen { check_id, emergency }            → { ok }   (emergency questions answered)
//   search { check_id, q }                    → { symptoms: [{ id, name }] }
//   next   { check_id, person, answers }      → { question } | { result }
//   clinics { check_id, lat?, lng? }          → participating clinics (one public page),
//                                               nearest first when a location is given
//   nearby { check_id?, kind, lat+lng | place } → nearby facilities (D1b, Google Places);
//                                               kind "emergency" works without a check
//   locate_clinic { address }  (clinic admins) → a clinic's map point from its address
//   choose_clinic { check_id, clinic_slug }   → { clinic }   (booking.ts)
//   slots  { check_id, on_date? }             → { days } | { times }   (booking.ts, D1c)
//   book   { check_id, provider_id, slot_start, first_name, last_name,
//            phone, date_of_birth }           → { booked, when }        (booking.ts, D1c)
//
// Safety: the emergency questions live in the page itself, so they work even
// when this function or the engine is down. The engine is only called after
// the screen is answered with no emergency. Patients get urgency, the kind of
// doctor and engine warnings; condition names are never returned in D1.
//
// Abuse and cost: per-IP rate limits, a cap on engine calls per check, a
// monthly engine budget (SYMPTOM_MONTHLY_BUDGET), checks expire after 2 hours.
//
// Stored per check (symptom_checks): age band, sex, symptom IDs, urgency,
// top specialty, outcome, whether a location was shared. Never names, free
// text, conditions, the location itself or IP.
//
// Secrets: SYMPTOM_ENGINE (demo | infermedica | apimedic; empty = off), SYMPTOM_MONTHLY_BUDGET
// (default 90), plus the engine's own (see _shared/symptom/apimedic.ts);
// nearby care: GOOGLE_PLACES_API_KEY, PLACES_MONTHLY_BUDGET (_shared/places.ts).
import { getCaller, json, supabase } from "../_shared/lib.ts";
import { nearbyCare, places } from "../_shared/nearby.ts";
import { validPoint } from "../_shared/places.ts";
import {
  type Answer, ageBand, createEngine, EngineError, engineName, type Person, phLayerOn, type SymptomEngine,
} from "../_shared/symptom/engine.ts";
import { PH_RULES_VERSION } from "../_shared/symptom/ph_layer.ts";
import { book, type BookableCheck, chooseClinic, clinics, slots } from "./booking.ts";

const MONTHLY_BUDGET = Number(Deno.env.get("SYMPTOM_MONTHLY_BUDGET") ?? "90") || 90;
const MAX_CALLS_PER_CHECK = 20;
const CHECK_TTL_MS = 2 * 60 * 60 * 1000;
const START_PER_MIN = 10;
const REQUESTS_PER_MIN = 90; // searches are per keystroke (debounced)
const MAX_ANSWERS = 30;
const NEARBY_PER_MIN = 6; // each lookup is a paid Places call

type CheckRow = BookableCheck & {
  created_at: string;
  screened_at: string | null;
  engine_calls: number;
};

function cors(): Record<string, string> {
  return {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
  };
}
const pub = (data: unknown, status = 200) => json(data, status, cors());

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors() });
  if (req.method !== "POST") return pub({ error: "method not allowed" }, 405);
  const body = await req.json().catch(() => ({} as Record<string, unknown>)) as Record<string, unknown>;

  try {
    const ip = clientIp(req);
    const action = String(body.action ?? "");
    const strict = action === "start" || action === "book";
    const limit = strict ? START_PER_MIN : REQUESTS_PER_MIN;
    if (ip) {
      const { data: count } = await supabase.rpc("bump_symptom_rate", { p_ip: `${strict ? "s" : "r"}:${ip}` });
      if (typeof count === "number" && count > limit) return pub({ error: "rate_limited" }, 429);
      if (action === "nearby" || action === "locate_clinic") {
        const { data: n } = await supabase.rpc("bump_symptom_rate", { p_ip: `n:${ip}` });
        if (typeof n === "number" && n > NEARBY_PER_MIN) return pub({ error: "rate_limited" }, 429);
      }
    }

    switch (action) {
      case "start": return await start(body);
      case "screen": return await screen(body);
      case "search": return await search(body);
      case "next": return await next(body);
      case "clinics": {
        const check = await loadCheck(body.check_id);
        return check ? await clinics(check, pub, validPoint(body.lat, body.lng)) : pub({ error: "expired" }, 404);
      }
      case "nearby": return await nearby(body);
      case "locate_clinic": return await locateClinic(req, body);
      case "choose_clinic": {
        const check = await loadCheck(body.check_id);
        return check ? await chooseClinic(check, body, pub) : pub({ error: "expired" }, 404);
      }
      case "slots": {
        const check = await loadCheck(body.check_id);
        return check ? await slots(check, body, pub) : pub({ error: "expired" }, 404);
      }
      case "book": {
        const check = await loadCheck(body.check_id);
        return check ? await book(check, body, createEngine(check.id), pub) : pub({ error: "expired" }, 404);
      }
      default: return pub({ error: "unknown action" }, 400);
    }
  } catch (e) {
    console.error("symptom-check error", e);
    return pub({ error: "unavailable" }, 503);
  }
});

// ---------------------------------------------------------------------------
async function start(body: Record<string, unknown>) {
  const slug = String(body.clinic_slug ?? "").trim().toLowerCase();
  const entry = body.entry === "telegram" ? "telegram" : slug ? "clinic_page" : "web";

  let clinic: { id: string; name: string; phone: string | null; local_emergency_numbers: string | null } | null = null;
  if (slug) {
    const { data } = await supabase.from("clinics")
      .select("id, name, phone_callback, local_emergency_numbers, symptom_check_enabled, active")
      .eq("public_slug", slug).maybeSingle();
    const c = data as {
      id: string; name: string; phone_callback: string | null; local_emergency_numbers: string | null;
      symptom_check_enabled: boolean; active: boolean;
    } | null;
    if (!c || !c.symptom_check_enabled || c.active === false) return pub({ error: "not_found" }, 404);
    clinic = { id: c.id, name: c.name, phone: c.phone_callback, local_emergency_numbers: c.local_emergency_numbers };
  }

  const engine = engineName();
  const { data, error } = await supabase.from("symptom_checks")
    .insert({ clinic_id: clinic?.id ?? null, entry, engine })
    .select("id").single();
  if (error || !data) throw error ?? new Error("insert failed");

  return pub({
    check_id: (data as { id: string }).id,
    demo: engine === "demo",
    clinic: clinic && { name: clinic.name, phone: clinic.phone, local_emergency_numbers: clinic.local_emergency_numbers },
    available: await engineAvailable(engine),
  });
}

async function screen(body: Record<string, unknown>) {
  const check = await loadCheck(body.check_id);
  if (!check) return pub({ error: "expired" }, 404);
  const emergency = body.emergency === true;
  await supabase.from("symptom_checks").update({
    screened_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
    ...(emergency ? { urgency: "emergency", outcome: "emergency_shown" } : {}),
  }).eq("id", check.id);
  return pub({ ok: true });
}

async function search(body: Record<string, unknown>) {
  const check = await loadCheck(body.check_id);
  const blocked = gate(check);
  if (blocked) return blocked;
  const engine = createEngine(check!.id);
  if (!engine) return pub({ error: "unavailable" }, 503);
  const q = String(body.q ?? "").slice(0, 60);
  const symptoms = await withEngine(check!, engine, () => engine.searchSymptoms(q, null));
  return symptoms instanceof Response ? symptoms : pub({ symptoms });
}

async function next(body: Record<string, unknown>) {
  const check = await loadCheck(body.check_id);
  const blocked = gate(check);
  if (blocked) return blocked;

  const person = parsePerson(body.person);
  const answers = parseAnswers(body.answers);
  if (!person) return pub({ error: "bad_person" }, 400);
  if (!answers.some((a) => a.present === true)) return pub({ error: "no_symptoms" }, 400);

  const engine = createEngine(check!.id);
  if (!engine) return pub({ error: "unavailable" }, 503);
  if (check!.engine_calls >= MAX_CALLS_PER_CHECK) return pub({ error: "too_many_steps" }, 429);

  const step = await withEngine(check!, engine, () => engine.next(person, answers));
  if (step instanceof Response) return step;

  const base = {
    age_band: ageBand(person.birthYear),
    sex: person.sex,
    symptom_ids: answers.filter((a) => a.present === true).map((a) => a.symptomId),
    updated_at: new Date().toISOString(),
  };
  if ("question" in step) {
    await supabase.from("symptom_checks").update(base).eq("id", check!.id);
    return pub({ question: step.question });
  }

  const a = step.assessment as typeof step.assessment & { phRules?: string[] };
  await supabase.from("symptom_checks").update({
    ...base,
    urgency: a.urgency,
    specialty: a.specialties[0] ?? null,
    ph_rules: a.phRules ?? null,
    ph_rules_version: phLayerOn() ? PH_RULES_VERSION : null,
    outcome: a.urgency === "emergency" ? "emergency_shown" : "advised",
  }).eq("id", check!.id);

  // Condition names stay server-side in D1 (design §1, §8).
  return pub({ result: { urgency: a.urgency, specialties: a.specialties, red_flags: a.redFlags } });
}

// ---------------------------------------------------------------------------
// Nearby care (D1b). The point goes to Google for the lookup, never stored.
async function nearby(body: Record<string, unknown>) {
  const check = body.check_id ? await loadCheck(body.check_id) : null;
  if (body.check_id && !check) return pub({ error: "expired" }, 404);
  // Emergency (nearest ERs) works without a check: the emergency screen must
  // not depend on the rest of the flow. Everything else needs a check result.
  const kind = body.kind === "emergency" || check?.urgency === "emergency" ? "emergency" : "care";
  if (kind === "care" && (!check || !check.urgency)) return pub({ error: "no_result" }, 409);

  let origin = validPoint(body.lat, body.lng);
  let label: string | null = null;
  if (!origin && typeof body.place === "string") {
    const found = await places().locate(body.place);
    if (!found) return pub({ error: "place_not_found" }, 404);
    origin = found.point; label = found.label;
  }
  if (!origin) return pub({ error: "no_location" }, 400);

  const { careCall, places: list } = await nearbyCare(origin, kind);
  if (check) {
    await supabase.from("symptom_checks").update({ location_shared: true, updated_at: new Date().toISOString() })
      .eq("id", check.id);
  }
  return pub({
    kind,
    origin_label: label,
    // Booking happens through the clinic picker; these are only "near you" hints.
    carecall: careCall.map(({ lat: _a, lng: _b, ...c }) => c),
    places: list?.map(({ lat: _a, lng: _b, ...p }) => p) ?? null,
    unavailable: list === null,
  });
}

/** Clinic settings → Find on map: the clinic admin's address → a point. */
async function locateClinic(req: Request, body: Record<string, unknown>) {
  const caller = await getCaller(req);
  if (!caller || (caller.role !== "admin" && caller.role !== "clinic_admin")) return pub({ error: "forbidden" }, 403);
  const address = String(body.address ?? "").trim();
  if (address.length < 3) return pub({ error: "address_required" }, 400);
  const found = await places().locate(address);
  if (!found) return pub({ error: "place_not_found" }, 404);
  return pub({ lat: found.point.lat, lng: found.point.lng, label: found.label });
}

// ---------------------------------------------------------------------------
async function loadCheck(id: unknown): Promise<CheckRow | null> {
  const s = String(id ?? "");
  if (!/^[0-9a-f-]{36}$/i.test(s)) return null;
  const { data } = await supabase.from("symptom_checks")
    .select("id, clinic_id, created_at, screened_at, urgency, specialty, engine_calls, outcome, appointment_id, " +
      "age_band, sex, symptom_ids, ph_rules, engine")
    .eq("id", s).maybeSingle();
  const row = data as CheckRow | null;
  if (!row || Date.now() - new Date(row.created_at).getTime() > CHECK_TTL_MS) return null;
  return row;
}

/** The engine is used only after a non-emergency screen. */
function gate(check: CheckRow | null): Response | null {
  if (!check) return pub({ error: "expired" }, 404);
  if (!check.screened_at) return pub({ error: "not_screened" }, 409);
  if (check.urgency === "emergency") return pub({ error: "emergency" }, 409);
  return null;
}

async function engineAvailable(engine: string | null): Promise<boolean> {
  if (!engine || !createEngine()) return false;
  if (engine === "demo") return true; // no API calls, no budget
  const { data } = await supabase.rpc("symptom_engine_calls_this_month", { p_engine: engine });
  return typeof data !== "number" || data < MONTHLY_BUDGET;
}

/** Run an engine step within the monthly budget, then record the calls made. */
async function withEngine<T>(check: CheckRow, engine: SymptomEngine, fn: () => Promise<T>): Promise<T | Response> {
  if (!(await engineAvailable(engine.name))) return pub({ error: "unavailable" }, 503);
  try {
    return await fn();
  } catch (e) {
    if (e instanceof EngineError) {
      console.error("engine error", e.message);
      await supabase.from("symptom_checks").update({ outcome: "error", updated_at: new Date().toISOString() })
        .eq("id", check.id);
      return pub({ error: "unavailable" }, 503);
    }
    throw e;
  } finally {
    if (engine.calls) {
      await supabase.from("symptom_checks")
        .update({ engine_calls: check.engine_calls + engine.calls }).eq("id", check.id);
    }
  }
}

function parsePerson(p: unknown): Person | null {
  const o = (p ?? {}) as Record<string, unknown>;
  const year = Number(o.birthYear);
  const thisYear = new Date().getUTCFullYear();
  if (!Number.isInteger(year) || year < thisYear - 120 || year > thisYear) return null;
  if (o.sex !== "male" && o.sex !== "female") return null;
  return { birthYear: year, sex: o.sex };
}

function parseAnswers(a: unknown): Answer[] {
  if (!Array.isArray(a)) return [];
  return a.slice(0, MAX_ANSWERS).flatMap((x) => {
    const o = (x ?? {}) as Record<string, unknown>;
    const id = String(o.symptomId ?? "");
    if (!/^[A-Za-z0-9_-]{1,40}$/.test(id)) return [];
    const present = o.present === "unknown" ? "unknown" : o.present === true;
    return [{ symptomId: id, present, source: o.source === "question" ? "question" : "search" } as Answer];
  });
}

function clientIp(req: Request): string | null {
  const xf = req.headers.get("x-forwarded-for");
  if (xf) return xf.split(",")[0].trim();
  return req.headers.get("x-real-ip");
}
