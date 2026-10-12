// CareCall PH — public symptom check API (Discover slice D1a).
// Design: docs/symptom-check-design.md
//
// Backs the /check and /check/<clinic> pages. PUBLIC: no Supabase JWT
// (verify_jwt off in config.toml). One POST endpoint, body.action selects:
//   start  { clinic_slug?, entry }            → { check_id, clinic, available }
//   screen { check_id, emergency }            → { ok }   (emergency questions answered)
//   search { check_id, q }                    → { symptoms: [{ id, name }] }
//   next   { check_id, person, answers }      → { question } | { result }
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
// top specialty, outcome. Never names, free text, conditions, location or IP.
//
// Secrets: SYMPTOM_ENGINE (apimedic; empty = off), SYMPTOM_MONTHLY_BUDGET
// (default 90), plus the engine's own (see _shared/symptom/apimedic.ts).
import { json, supabase } from "../_shared/lib.ts";
import {
  type Answer, ageBand, createEngine, EngineError, engineName, type Person, type SymptomEngine,
} from "../_shared/symptom/engine.ts";

const MONTHLY_BUDGET = Number(Deno.env.get("SYMPTOM_MONTHLY_BUDGET") ?? "90") || 90;
const MAX_CALLS_PER_CHECK = 15;
const CHECK_TTL_MS = 2 * 60 * 60 * 1000;
const START_PER_MIN = 10;
const REQUESTS_PER_MIN = 90; // searches are per keystroke (debounced)
const MAX_ANSWERS = 30;

type CheckRow = {
  id: string;
  clinic_id: string | null;
  created_at: string;
  screened_at: string | null;
  urgency: string | null;
  engine_calls: number;
  outcome: string;
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
    const limit = action === "start" ? START_PER_MIN : REQUESTS_PER_MIN;
    if (ip) {
      const { data: count } = await supabase.rpc("bump_symptom_rate", { p_ip: `${action === "start" ? "s" : "r"}:${ip}` });
      if (typeof count === "number" && count > limit) return pub({ error: "rate_limited" }, 429);
    }

    switch (action) {
      case "start": return await start(body);
      case "screen": return await screen(body);
      case "search": return await search(body);
      case "next": return await next(body);
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
  const engine = createEngine();
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
  if (!answers.some((a) => a.present)) return pub({ error: "no_symptoms" }, 400);

  const engine = createEngine();
  if (!engine) return pub({ error: "unavailable" }, 503);
  if (check!.engine_calls >= MAX_CALLS_PER_CHECK) return pub({ error: "too_many_steps" }, 429);

  const step = await withEngine(check!, engine, () => engine.next(person, answers));
  if (step instanceof Response) return step;

  const base = {
    age_band: ageBand(person.birthYear),
    sex: person.sex,
    symptom_ids: answers.filter((a) => a.present).map((a) => a.symptomId),
    updated_at: new Date().toISOString(),
  };
  if ("question" in step) {
    await supabase.from("symptom_checks").update(base).eq("id", check!.id);
    return pub({ question: step.question });
  }

  const a = step.assessment;
  await supabase.from("symptom_checks").update({
    ...base,
    urgency: a.urgency,
    specialty: a.specialties[0] ?? null,
    outcome: a.urgency === "emergency" ? "emergency_shown" : "advised",
  }).eq("id", check!.id);

  // Condition names stay server-side in D1 (design §1, §8).
  return pub({ result: { urgency: a.urgency, specialties: a.specialties, red_flags: a.redFlags } });
}

// ---------------------------------------------------------------------------
async function loadCheck(id: unknown): Promise<CheckRow | null> {
  const s = String(id ?? "");
  if (!/^[0-9a-f-]{36}$/i.test(s)) return null;
  const { data } = await supabase.from("symptom_checks")
    .select("id, clinic_id, created_at, screened_at, urgency, engine_calls, outcome").eq("id", s).maybeSingle();
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
    return [{ symptomId: id, present: o.present === true, source: o.source === "question" ? "question" : "search" } as Answer];
  });
}

function clientIp(req: Request): string | null {
  const xf = req.headers.get("x-forwarded-for");
  if (xf) return xf.split(",")[0].trim();
  return req.headers.get("x-real-ip");
}
