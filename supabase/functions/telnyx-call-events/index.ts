// CareCall — Telnyx Call Control event webhook.
// MERGED 2026-07-06: dev-team multi-clinic version (clinicForCall, per-campaign
// assistant routing, sms_fallback toggle) + restored INSIGHTS handler (was lost
// in the debug fork: transcripts/summaries were not being stored) + 'notified'
// added to markUnreached statuses (pre-call SMS race).
// FIXED 2026-07-23:
//   1. Added 'call.machine.premium.detection.ended' to the switch — Telnyx uses
//      this event name (not 'call.machine.detection.ended') when AMD mode is
//      set to "premium". Without this, AMD results were silently dropped and
//      the AI assistant never started.
//   2. Tightened looksLikeInsights to never swallow call.* events — removed
//      the overly broad p.results check that was misrouting call control events
//      to the insights handler.
//
// Implements the AMD gate from the call-flow spec:
//   1. Dial with answering_machine_detection: "premium".
//   2. On call.machine.premium.detection.ended:
//        - human    → start the AI assistant on the call
//        - machine  → wait for call.machine.greeting.ended, speak a brief
//                     callback message, send an SMS, hang up. Never start the AI.
//   3. On call.hangup → finalize the call log and campaign_patient status.
// Also receives the assistant's post-call Insights webhook on this same URL.
//
// CareCall PH Phase 1 (2026-10-01): the voicemail follow-up message now goes
// through _shared/channels.ts — the patient's opted-in chat app (Viber /
// Messenger / Telegram) first, SMS with consent otherwise. SMS follow-ups carry
// a chat invite when the clinic has chat_optin_enabled and no booking link.

import { supabase, telnyx, json, createBookingLink } from "../_shared/lib.ts";
import { phLocalGroups } from "../_shared/phone.ts";
import {
  type Channel,
  type PatientLite,
  createChannelInvite,
  hasChatChannel,
  sendToPatient,
} from "../_shared/channels.ts";

const ASSISTANT_ID = Deno.env.get("TELNYX_ASSISTANT_ID")!;
const FROM_NUMBER = Deno.env.get("TELNYX_FROM_NUMBER")!;
// Env values remain as fallback defaults (§5). Per-clinic values are read from
// the clinics row via the call's campaign so one deployment serves many clinics.
const DEFAULT_CLINIC_NAME = Deno.env.get("CLINIC_NAME") ?? "your clinic";
const DEFAULT_CALLBACK_NUMBER = Deno.env.get("CLINIC_CALLBACK_NUMBER") ?? FROM_NUMBER;

/** Resolve clinic name + callback number for a call, via call_logs → campaign → clinic. */
async function clinicForCall(ccid: string): Promise<{ id: string | null; name: string; callback: string; smsFallback: boolean; selfBooking: boolean }> {
  const { data } = await supabase.from("call_logs")
    .select("clinic_id, clinics(name, phone_callback, sms_fallback, self_booking_enabled)")
    .eq("call_control_id", ccid).maybeSingle();
  const row = data as { clinic_id?: string | null; clinics?: { name?: string; phone_callback?: string; sms_fallback?: boolean; self_booking_enabled?: boolean } } | null;
  const clinic = row?.clinics;
  return {
    id: row?.clinic_id ?? null,
    name: clinic?.name ?? DEFAULT_CLINIC_NAME,
    callback: clinic?.phone_callback ?? DEFAULT_CALLBACK_NUMBER,
    smsFallback: clinic?.sms_fallback ?? true,
    selfBooking: clinic?.self_booking_enabled ?? false,
  };
}

/** Minimal patient record for channel resolution (consent + preferred channel). */
async function loadPatientLite(patientId: string): Promise<PatientLite | null> {
  const { data } = await supabase.from("patients")
    .select("id, phone, sms_consent, preferred_channel").eq("id", patientId).maybeSingle();
  return (data as PatientLite | null) ?? null;
}

/** Per-clinic chat opt-in invite flag (PH Phase 1). Default off. */
async function clinicChatOptin(clinicId: string | null): Promise<boolean> {
  if (!clinicId) return false;
  const { data } = await supabase.from("clinics")
    .select("chat_optin_enabled").eq("id", clinicId).maybeSingle();
  return (data as { chat_optin_enabled?: boolean } | null)?.chat_optin_enabled === true;
}

Deno.serve(async (req) => {
  const event = await req.json().catch(() => null);
  if (!event?.data) return json({ ok: true });

  // Insights arrive on this same URL but aren't call-control events
  if (looksLikeInsights(event)) {
    try { await handleInsights(event); } catch (e) { console.error("insights handling failed", e); }
    return json({ ok: true });
  }

  const type: string = event.data.event_type;
  const payload = event.data.payload ?? {};
  const ccid: string = payload.call_control_id;
  // client_state carries {campaign_id, patient_id} base64-encoded from dial time
  const state = decodeState(payload.client_state);

  try {
    switch (type) {
      case "call.initiated": {
        // Call created — no action needed, just acknowledge
        break;
      }

      case "call.answered": {
        // Don't start the AI yet — wait for AMD result. Just log.
        await supabase.from("call_logs").update({ started_at: new Date().toISOString() })
          .eq("call_control_id", ccid);
        break;
      }

      // FIX: Telnyx fires 'call.machine.premium.detection.ended' (not
      // 'call.machine.detection.ended') when AMD mode is "premium".
      // Both cases handled identically.
      case "call.machine.detection.ended":
      case "call.machine.premium.detection.ended": {
        const result: string = payload.result; // 'human' | 'machine' | 'not_sure'
        await supabase.from("call_logs").update({ amd_result: result }).eq("call_control_id", ccid);

        if (result === "human" || result === "human_residence" || result === "human_business" || result === "not_sure" || result === "silence") {
          // All human-positive AMD results start the assistant.
          // "human_residence" / "human_business" are premium AMD classifications.
          // "silence" occurs on SIP softphones with no background noise.
          // "not_sure" treated as human — worst case the AI greets a voicemail
          // and the silence-timeout ends the call.
          const clinic = await clinicForCall(ccid);
          const assistantId = state?.assistant_id || ASSISTANT_ID;

          // Retry up to 3 times with increasing delay: 1s, 2s, 3s.
          // Telnyx occasionally returns 503 if the call leg hasn't fully
          // stabilised by the time the AMD event fires. A single retry almost
          // always succeeds.
          let lastErr: unknown;
          for (let attempt = 0; attempt < 3; attempt++) {
            try {
              // First attempt: 200ms (barely perceptible). Retries: 2s, 4s.
              await new Promise(r => setTimeout(r, attempt === 0 ? 200 : 2000 * attempt));
              await telnyx(`/calls/${ccid}/actions/ai_assistant_start`, {
                assistant: { id: assistantId },
                // Per-call variables injected at runtime (never the DOB on file).
                dynamic_variables: {
                  patient_first_name: state?.patient_first_name ?? "",
                  campaign_context: state?.campaign_context ?? "",
                  clinic_name: clinic.name,
                },
              });
              lastErr = null;
              console.log(`ai_assistant_start succeeded on attempt ${attempt + 1}`);
              break;
            } catch (e) {
              lastErr = e;
              console.warn(`ai_assistant_start attempt ${attempt + 1} failed:`, e);
            }
          }
          if (lastErr) throw lastErr;
        }
        // machine → do nothing here; wait for greeting to end before speaking
        break;
      }

      case "call.machine.greeting.ended": {
        // Leave a brief, PHI-free callback message after the beep-ish moment
        const clinic = await clinicForCall(ccid);
        await telnyx(`/calls/${ccid}/actions/speak`, {
          voice: "female",
          language: "en-US",
          payload:
            `Hello, this is ${clinic.name} calling with a scheduling reminder. ` +
            `Please call us back at ${spellNumber(clinic.callback)} at your convenience. Thank you.`,
        });
        break;
      }

      case "call.speak.ended": {
        // Voicemail message finished → send SMS fallback, mark, hang up
        if (state?.patient_id && state?.campaign_id) {
          await markUnreached(state.campaign_id, state.patient_id, ccid, "voicemail");
          const clinic = await clinicForCall(ccid);
          // Voicemail follow-up goes to the patient's opted-in chat channel, or
          // SMS with consent (§3.3). No permitted channel → skip (call was made).
          const patient = await loadPatientLite(state.patient_id);
          if (patient && clinic.smsFallback) {
            let bookingLink: string | null = null;
            if (clinic.selfBooking) {
              bookingLink = await createBookingLink(state.campaign_id, state.patient_id, clinic.id);
            }
            let inviteLink: string | null = null;
            if (!bookingLink && await clinicChatOptin(clinic.id) && !(await hasChatChannel(patient.id))) {
              inviteLink = await createChannelInvite(patient.id, clinic.id);
            }
            const text = (ch: Channel) => {
              if (bookingLink) {
                return `Hi, this is ${clinic.name}. We tried to reach you about scheduling an ` +
                  `appointment. Pick a time that works for you: ${bookingLink}. Reply STOP to opt out.`;
              }
              const base = `Hi, this is ${clinic.name}. We called to help you schedule an appointment. ` +
                `Please call us at ${clinic.callback} and we'll find a time that works.`;
              if (ch === "sms" && inviteLink) {
                return `${base} Get reminders on Viber, Messenger or Telegram: ${inviteLink}. Reply STOP to opt out.`;
              }
              return `${base} Reply STOP to opt out.`;
            };
            await sendToPatient({
              patient,
              clinicId: clinic.id,
              clinicName: clinic.name,
              campaignId: state.campaign_id,
              text,
            }).catch((e) => console.error("voicemail follow-up failed", e));
          }
        }
        await telnyx(`/calls/${ccid}/actions/hangup`, {});
        break;
      }

      case "call.conversation.created": {
        // Assistant started successfully — log for debugging
        console.log("conversation started on call:", ccid?.slice(0, 20));
        break;
      }

      case "call.conversation.ended": {
        // Conversation finished — hangup follows shortly
        break;
      }

      case "call.conversation_insights.generated": {
        // Insights/transcript available — handle via handleInsights
        try { await handleInsights(event); } catch (e) { console.error("insights failed", e); }
        break;
      }

      case "call.recording.saved": {
        // Recording URL available — store it
        const recordingUrl = payload.recording_urls?.mp3 ?? payload.public_recording_urls?.mp3 ?? null;
        if (recordingUrl && ccid) {
          await supabase.from("call_logs")
            .update({ recording_url: recordingUrl })
            .eq("call_control_id", ccid);
        }
        break;
      }

      case "call.hangup": {
        const { data: log } = await supabase.from("call_logs")
          .select("id, result, started_at, campaign_id, patient_id")
          .eq("call_control_id", ccid).single();
        if (log) {
          const duration = log.started_at
            ? Math.round((Date.now() - new Date(log.started_at).getTime()) / 1000) : null;
          await supabase.from("call_logs")
            .update({ ended_at: new Date().toISOString(), duration_seconds: duration })
            .eq("id", log.id);
          // If the call ended with no recorded result, it was a no-answer/drop
          if (!log.result && log.campaign_id && log.patient_id) {
            await markUnreached(log.campaign_id, log.patient_id, ccid, "no_answer");
          }
        }
        break;
      }
    }
  } catch (e) {
    console.error(`event ${type} handling failed`, e);
  }

  return json({ ok: true }); // always 200 so Telnyx doesn't retry forever
});

function decodeState(cs?: string): Record<string, string> | null {
  if (!cs) return null;
  try { return JSON.parse(atob(cs)); } catch { return null; }
}

async function markUnreached(campaignId: string, patientId: string, ccid: string, kind: "voicemail" | "no_answer") {
  await Promise.all([
    supabase.from("campaign_patients")
      .update({ status: kind, updated_at: new Date().toISOString() })
      .eq("campaign_id", campaignId).eq("patient_id", patientId)
      // 'notified' included: a call event can land before start-campaign's
      // status flip to 'calling' commits (pre-call SMS two-phase queue).
      .in("status", ["pending", "notified", "calling"]),
    supabase.from("call_logs").update({ result: kind }).eq("call_control_id", ccid),
  ]);
}

/** "+639171234567" → "0 9 1 7, 1 2 3, 4 5 6 7" (read the local way) so TTS reads it clearly. */
function spellNumber(e164: string): string {
  const groups = phLocalGroups(e164) ?? [e164.replace(/\D/g, "")];
  return groups.map((g) => g.split("").join(" ")).join(", ");
}

// ------------------------------------------------------------------
// INSIGHTS: post-call results from the assistant's Insights webhook.
// Telnyx's payload shape varies by configuration, so this parser is
// deliberately tolerant: it hunts for the call_control_id and the
// insight results wherever they appear, and logs anything it can't
// recognize so the shape can be confirmed from real traffic.
// ------------------------------------------------------------------
function looksLikeInsights(evt: Record<string, unknown>): boolean {
  const t = String(
    (evt?.data as Record<string, unknown>)?.event_type ??
    evt?.event_type ?? ""
  );
  // FIX: call control events must never be routed to insights handler.
  // 'call.*' events are unambiguously call control — return false immediately.
  if (t.startsWith("call.")) return false;
  // Explicit insight event type
  if (t.includes("insight")) return true;
  // For unknown event types, only match insight-specific payload fields.
  // Removed p.results — too broad, was matching call control payloads.
  const p = ((evt?.data as Record<string, unknown>)?.payload ?? evt) as Record<string, unknown>;
  return Boolean(p && (p.insight_results || p.insights));
}

function deepFind(obj: unknown, keys: string[], depth = 0): unknown {
  if (!obj || typeof obj !== "object" || depth > 6) return undefined;
  for (const [k, v] of Object.entries(obj as Record<string, unknown>)) {
    if (keys.includes(k) && v != null) return v;
    const found = deepFind(v, keys, depth + 1);
    if (found !== undefined) return found;
  }
  return undefined;
}

async function handleInsights(evt: Record<string, unknown>) {
  const ccid = deepFind(evt, ["call_control_id", "telnyx_call_control_id"]) as string | undefined;
  if (!ccid) {
    console.warn("insights: no call_control_id found; raw payload:", JSON.stringify(evt).slice(0, 2000));
    return;
  }

  const rawResults = deepFind(evt, ["insight_results", "insights", "results"]);
  const list: { name?: string; insight_name?: string; result?: unknown; value?: unknown }[] =
    Array.isArray(rawResults) ? rawResults
    : rawResults && typeof rawResults === "object" ? Object.entries(rawResults).map(([k, v]) => ({ name: k, result: v }))
    : [];

  let summary: string | null = null;
  let outcomeObj: Record<string, unknown> | null = null;
  for (const item of list) {
    const name = (item.name ?? item.insight_name ?? "").toString();
    const val = item.result ?? item.value;
    if (name === "call_summary" && typeof val === "string") summary = val;
    if (name === "call_outcome") {
      if (typeof val === "object" && val) outcomeObj = val as Record<string, unknown>;
      else if (typeof val === "string") {
        try { outcomeObj = JSON.parse(val.replace(/```json|```/g, "").trim()); } catch { /* keep raw in transcript */ }
      }
    }
  }

  // Transcript: use conversation messages if the payload carries them,
  // otherwise store the raw insight results for the Call History pane.
  const messages = deepFind(evt, ["messages", "transcript"]);
  const transcript = messages ?? { insights: rawResults ?? evt };

  const update: Record<string, unknown> = { transcript };
  if (summary) update.summary = summary;

  await supabase.from("call_logs").update(update).eq("call_control_id", ccid);

  // Outcome from insights is a FALLBACK only — never overwrite a result
  // already recorded by the tools (booked, declined, etc.).
  const validResults = ["booked", "declined", "callback_requested", "no_answer", "voicemail", "wrong_number", "verification_failed", "transferred", "error"];
  const insightOutcome = String(outcomeObj?.outcome ?? "");
  const mapped = insightOutcome === "needs_human" ? "transferred" : insightOutcome;
  if (validResults.includes(mapped)) {
    const { data: log } = await supabase.from("call_logs")
      .select("id, result").eq("call_control_id", ccid).single();
    if (log && !log.result) {
      await supabase.from("call_logs").update({ result: mapped }).eq("id", log.id);
    }
  }

  if (outcomeObj?.staff_note && summary) {
    await supabase.from("call_logs")
      .update({ summary: `${summary}\n\nStaff note: ${outcomeObj.staff_note}` })
      .eq("call_control_id", ccid);
  }
}
