// CareCall PH — clinical notes (care plans M6, demo). Design: docs/care-plan-design.md
//
// Called by signed-in nurses and doctors (clinical role; RLS mirrors this).
//   POST { action: "status" }
//        Which steps are available: speech-to-text (GEMINI_API_KEY) and
//        drafting (ANTHROPIC_API_KEY).
//   POST { action: "transcribe", patient_id, mode, recording_consent, audio_base64, mime }
//        Speech to text. The audio is sent to the speech-to-text service
//        and never stored. Recording a consultation needs the patient's
//        agreement (recording_consent: true).
//   POST { action: "draft", patient_id, mode, recording_consent, transcript, engine?, note_id? }
//        CC drafts a SOAP note from the transcript and saves it as a draft
//        (or updates draft note_id). Returns the note, what to check, and
//        the medicines mentioned.
//   POST { action: "transcribe", patient_id, purpose: "plan", audio_base64, mime }
//        Speech to text for a dictated monitoring plan (M5).
//   POST { action: "plan_draft", patient_id, transcript }
//        CC turns a dictated monitoring plan into draft measures for the plan
//        editor (M5). Nothing is saved: the portal opens the draft for the
//        doctor to check, save and sign. Never invents a limit or time.
//   POST { action: "sign", note_id, password }
//        Doctors only (clinical role doctor, linked to an active clinician),
//        re-entering their password: the electronic signature. A signed note
//        can't be changed; add an addendum instead.
//
// Drafts are edited directly in the portal (RLS). Secrets: ANTHROPIC_API_KEY,
// GEMINI_API_KEY (optional; without it, type or paste the note), optional
// NOTES_MODEL, GEMINI_STT_MODEL.
//
// Deploy: supabase functions deploy clinical-note   (JWT verification on)
import { audit, corsHeaders, getCaller, json, supabase, verifyPassword } from "../_shared/lib.ts";
import { canManageCare } from "../_shared/roles.ts";
import {
  ageOn, audioTypeOk, base64Bytes, consentProblem, DRAFT_SYSTEM, draftUserMessage, MAX_AUDIO_BYTES,
  MAX_TRANSCRIPT_CHARS, NOTE_MODES, NOTE_SCHEMA, type NoteMode, parseDraft, transcribePrompt,
} from "../_shared/notes.ts";
import { MAX_PLAN_TRANSCRIPT_CHARS, parsePlanDraft, PLAN_SCHEMA, PLAN_SYSTEM, planUserMessage } from "../_shared/plan_dictation.ts";

const ANTHROPIC_KEY = Deno.env.get("ANTHROPIC_API_KEY") ?? "";
const NOTES_MODEL = Deno.env.get("NOTES_MODEL") ?? "claude-opus-5-5";
const GEMINI_KEY = Deno.env.get("GEMINI_API_KEY") ?? "";
const GEMINI_MODEL = Deno.env.get("GEMINI_STT_MODEL") ?? "gemini-2.5-flash";

const reply = (data: unknown, status = 200) => json(data, status, corsHeaders());
const UUID = /^[0-9a-f-]{36}$/i;

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders() });
  if (req.method !== "POST") return reply({ error: "method not allowed" }, 405);

  const caller = await getCaller(req);
  if (!caller || !caller.role) return reply({ error: "unauthorized" }, 401);
  if (!canManageCare(caller.clinicalRole)) {
    return reply({ error: "Clinical notes are for nurses and doctors." }, 403);
  }

  const body = await req.json().catch(() => ({}));
  const action = String(body.action ?? "");
  if (action === "status") return reply({ stt: GEMINI_KEY ? "gemini" : null, drafting: !!ANTHROPIC_KEY });

  if (action === "sign") return await sign(caller, String(body.note_id ?? ""), String(body.password ?? ""));

  // transcribe and draft: the patient must be in the caller's clinic.
  const patientId = String(body.patient_id ?? "");
  if (!UUID.test(patientId)) return reply({ error: "patient_id required" }, 400);
  const { data: patient } = await supabase.from("patients")
    .select("id, clinic_id, date_of_birth, sex").eq("id", patientId).maybeSingle();
  if (!patient) return reply({ error: "patient not found" }, 404);
  if (caller.role !== "admin" && patient.clinic_id !== caller.clinicId) {
    return reply({ error: "forbidden: patient is not in your clinic" }, 403);
  }
  if (action === "plan_draft") {
    if (!ANTHROPIC_KEY) return reply({ error: "CC isn't set up (ANTHROPIC_API_KEY)." }, 503);
    const transcript = String(body.transcript ?? "").trim();
    if (!transcript) return reply({ error: "Dictate or type the plan first." }, 400);
    if (transcript.length > MAX_PLAN_TRANSCRIPT_CHARS) return reply({ error: "That's too long for one plan." }, 413);
    const { data: c } = await supabase.from("clinics").select("timezone").eq("id", patient.clinic_id).maybeSingle();
    const today = new Date().toLocaleDateString("en-CA", { timeZone: (c as { timezone: string | null } | null)?.timezone || "Asia/Manila" });
    try {
      const text = await claudeJson(PLAN_SYSTEM, planUserMessage(transcript, today), PLAN_SCHEMA, 4000);
      const draft = parsePlanDraft(text, today);
      if (!draft) throw new Error(`plan draft didn't match the schema: ${text.slice(0, 200)}`);
      await audit({ clinicId: patient.clinic_id, actorUserId: caller.userId, action: "monitoring_plan_dictated",
        targetType: "patient", targetId: patient.id, detail: { measures: draft.items.map((i) => i.measure), unclear: draft.unclear.length } });
      return reply({ ...draft, start_date: today });
    } catch (e) {
      console.error("clinical-note plan_draft", e);
      return reply({ error: e instanceof RefusalError ? e.message : "CC couldn't draft the plan. Try again, or fill it in by hand." }, 502);
    }
  }

  const mode = String(body.mode ?? "typed") as NoteMode;
  if (!NOTE_MODES.includes(mode)) return reply({ error: "mode must be dictation, recording or typed" }, 400);
  const consent = body.recording_consent === true;
  const noConsent = consentProblem(mode, consent);
  if (noConsent) return reply({ error: noConsent }, 400);

  if (action === "transcribe") {
    if (!GEMINI_KEY) return reply({ error: "Speech-to-text isn't set up yet. Type or paste the note instead." }, 503);
    const audio = String(body.audio_base64 ?? "");
    const mime = String(body.mime ?? "");
    if (!audio || !audioTypeOk(mime)) return reply({ error: "Send the recording as audio (webm, ogg, mp4, mp3 or wav)." }, 400);
    if (base64Bytes(audio) > MAX_AUDIO_BYTES) return reply({ error: "The recording is too long. Keep it under about 10 minutes." }, 413);
    try {
      const purpose = body.purpose === "plan" ? "plan" : "note";
      const transcript = await transcribe(audio, mime.split(";")[0], mode, purpose);
      await audit({ clinicId: patient.clinic_id, actorUserId: caller.userId,
        action: purpose === "plan" ? "monitoring_plan_transcribed" : "clinical_note_transcribed",
        targetType: "patient", targetId: patient.id, detail: { mode, engine: "gemini", chars: transcript.length } });
      return reply({ transcript, engine: "gemini" });
    } catch (e) {
      console.error("clinical-note transcribe", e);
      return reply({ error: "Couldn't transcribe the recording. Try again, or type the note." }, 502);
    }
  }

  if (action === "draft") {
    if (!ANTHROPIC_KEY) return reply({ error: "CC isn't set up (ANTHROPIC_API_KEY)." }, 503);
    const transcript = String(body.transcript ?? "").trim();
    if (!transcript) return reply({ error: "There is nothing to draft from yet." }, 400);
    if (transcript.length > MAX_TRANSCRIPT_CHARS) return reply({ error: "The text is too long for one note." }, 413);
    const today = new Date().toISOString().slice(0, 10);
    let draft;
    try {
      draft = await draftNote(transcript, { mode, patientAge: ageOn(patient.date_of_birth, today), sex: patient.sex });
    } catch (e) {
      console.error("clinical-note draft", e);
      return reply({ error: e instanceof RefusalError ? e.message : "CC couldn't draft the note. Try again." }, 502);
    }
    const fields = {
      subjective: draft.subjective, objective: draft.objective, assessment: draft.assessment, plan: draft.plan,
      transcript, mode, stt_engine: typeof body.engine === "string" ? body.engine.slice(0, 20) : (mode === "typed" ? null : "demo"),
      recording_consent_at: mode === "recording" ? new Date().toISOString() : null,
    };
    const noteId = String(body.note_id ?? "");
    const q = UUID.test(noteId)
      ? supabase.from("clinical_notes").update(fields).eq("id", noteId).eq("patient_id", patient.id).eq("status", "draft")
      : supabase.from("clinical_notes").insert({ ...fields, clinic_id: patient.clinic_id, patient_id: patient.id, author_user_id: caller.userId });
    const { data: note, error } = await q.select("*").single();
    if (error || !note) return reply({ error: `Couldn't save the draft: ${error?.message ?? "not found"}` }, 400);
    return reply({ note, unclear: draft.unclear, medicines_mentioned: draft.medicines_mentioned });
  }

  return reply({ error: `unknown action: ${action}` }, 400);
});

type Caller = NonNullable<Awaited<ReturnType<typeof getCaller>>>;

async function sign(caller: Caller, noteId: string, password: string) {
  if (!UUID.test(noteId)) return reply({ error: "note_id required" }, 400);
  if (caller.clinicalRole !== "doctor") return reply({ error: "Only a doctor can sign a clinical note." }, 403);
  const { data: provider } = await supabase.from("providers")
    .select("id, name").eq("user_id", caller.userId).eq("active", true).maybeSingle();
  if (!provider) return reply({ error: "Your login isn't linked to a clinician yet (Settings → Users)." }, 403);

  const { data: note } = await supabase.from("clinical_notes")
    .select("id, clinic_id, patient_id, status, kind, subjective, objective, assessment, plan, addendum").eq("id", noteId).maybeSingle();
  if (!note) return reply({ error: "note not found" }, 404);
  if (caller.role !== "admin" && note.clinic_id !== caller.clinicId) return reply({ error: "forbidden" }, 403);
  if (note.status === "signed") return reply({ error: "This note is already signed." }, 409);
  const empty = note.kind === "addendum"
    ? !note.addendum?.trim()
    : ![note.subjective, note.objective, note.assessment, note.plan].some((s) => s?.trim());
  if (empty) return reply({ error: "The note is empty." }, 400);
  if (!(await verifyPassword(caller.userId, password))) {
    await audit({ clinicId: note.clinic_id, actorUserId: caller.userId, action: "clinical_note_sign_failed",
      targetType: "clinical_note", targetId: note.id, detail: { reason: "password" } });
    return reply({ error: "That password isn't right. Enter the password you use to sign in." }, 401);
  }

  const { data: signed, error } = await supabase.from("clinical_notes")
    .update({ status: "signed", signed_by: caller.userId, signed_provider_id: provider.id })
    .eq("id", note.id).eq("status", "draft").select("*").single();
  if (error || !signed) return reply({ error: `Couldn't sign: ${error?.message ?? "changed meanwhile"}` }, 409);
  await audit({ clinicId: note.clinic_id, actorUserId: caller.userId, action: "clinical_note_signed",
    targetType: "clinical_note", targetId: note.id, detail: { patient_id: note.patient_id, kind: note.kind, provider: provider.name, method: "password" } });
  return reply({ note: signed });
}

// --- speech to text (Gemini) -----------------------------------------------

async function transcribe(audioBase64: string, mime: string, mode: NoteMode, purpose: "note" | "plan"): Promise<string> {
  const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent`, {
    method: "POST",
    headers: { "content-type": "application/json", "x-goog-api-key": GEMINI_KEY },
    body: JSON.stringify({
      contents: [{ role: "user", parts: [{ inline_data: { mime_type: mime, data: audioBase64 } }, { text: transcribePrompt(mode, purpose) }] }],
      generationConfig: { temperature: 0 },
    }),
  });
  const j = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(`Gemini ${res.status}: ${JSON.stringify(j).slice(0, 300)}`);
  const parts = (j.candidates?.[0]?.content?.parts ?? []) as { text?: string }[];
  return parts.map((p) => p.text ?? "").join("").trim();
}

// --- SOAP draft (Claude, structured output) ---------------------------------

class RefusalError extends Error {}

async function draftNote(transcript: string, o: { mode: NoteMode; patientAge: number | null; sex: string | null }) {
  const text = await claudeJson(DRAFT_SYSTEM, draftUserMessage(transcript, o), NOTE_SCHEMA, 8000);
  const draft = parseDraft(text);
  if (!draft) throw new Error(`draft didn't match the schema: ${text.slice(0, 200)}`);
  return draft;
}

/** One structured-output request to Claude; returns the JSON text. */
async function claudeJson(system: string, user: string, schema: unknown, maxTokens: number): Promise<string> {
  const res = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "x-api-key": ANTHROPIC_KEY,
      "anthropic-version": "2023-06-01",
      // If the model declines, the API retries on a fallback model.
      "anthropic-beta": "server-side-fallback-2026-07-01",
      "content-type": "application/json",
    },
    body: JSON.stringify({
      model: NOTES_MODEL,
      max_tokens: maxTokens,
      fallbacks: "default",
      output_config: { effort: "medium", format: { type: "json_schema", schema } },
      system,
      messages: [{ role: "user", content: user }],
    }),
  });
  const j = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(`Anthropic ${res.status}: ${JSON.stringify(j).slice(0, 300)}`);
  if (j.stop_reason === "refusal") throw new RefusalError("CC couldn't draft this. Write it by hand.");
  if (j.stop_reason === "max_tokens") throw new Error("draft cut off (max_tokens)");
  return ((j.content ?? []) as { type: string; text?: string }[])
    .filter((b) => b.type === "text").map((b) => b.text ?? "").join("");
}
