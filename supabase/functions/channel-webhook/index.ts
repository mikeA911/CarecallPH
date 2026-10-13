// CareCall PH — inbound webhook for chat channels (Phase 1).
//
// One function, three platforms, selected by query string:
//   .../functions/v1/channel-webhook?ch=viber
//   .../functions/v1/channel-webhook?ch=telegram
//   .../functions/v1/channel-webhook?ch=messenger   (GET = Meta verify handshake)
//   .../functions/v1/channel-webhook?ch=whatsapp    (GET = Meta verify handshake)
//
// Deploy: supabase functions deploy channel-webhook --no-verify-jwt
// (platforms can't send a Supabase JWT; each request is authenticated by the
// platform's own signature / secret instead — see verify* below).
//
// Conversation model (keyword-driven, no LLM in Phase 1):
//   start + invite token → link chat account to patient, ask for the patient's
//                          date of birth (the invite may have reached the wrong
//                          person); 2 wrong dates lock it and expire the invites
//   date of birth match   → ask for consent
//   YES / OO / OPO / SIGE → opt in (DPA consent record), set preferred channel
//   BOOK / ISKEDYUL       → send a self-booking link per open campaign
//   STOP / TIGIL / HINTO  → opt out
//   1 / 2 / 3 (or C / R / X, CONFIRM, PALIT, KANSELA) after an appointment
//                         reminder → confirm, ask to change the time, cancel
//   Care plans (M1): YES / NO to a consent request, 1 / 2 after a medicine
//   reminder (taken / skipped), STOP REMINDERS to stop medicine reminders
//   CHECK / SINTOMAS      → symptom check link (anyone, connected or not; only
//                           when SYMPTOM_ENGINE is set)
//   anything else         → logged for staff; short auto-reply
//
// Env: VIBER_AUTH_TOKEN, TELEGRAM_BOT_TOKEN, TELEGRAM_WEBHOOK_SECRET,
//      META_PAGE_ACCESS_TOKEN, META_APP_SECRET, META_VERIFY_TOKEN, PORTAL_URL,
//      WHATSAPP_PHONE_NUMBER_ID, WHATSAPP_ACCESS_TOKEN
//
// WhatsApp opt-in: there is no deep-link payload, so the /connect page opens
// wa.me/<number>?text=CONNECT%20<token> and we parse that first message.

import { supabase, createBookingLink, audit } from "../_shared/lib.ts";
import { dobCandidates } from "../_shared/dob.ts";
import { parseReminderReply, type ReminderResponse, whenText } from "../_shared/reminders.ts";
import { nearbyCare, nearbyText, places } from "../_shared/nearby.ts";
import { validPoint } from "../_shared/places.ts";
import { isWithdraw, MISSED_AFTER_MS, parseConsentReply, parseDoseReply } from "../_shared/care.ts";
import { BUTTONS, type ChatButton, replyFromCallback } from "../_shared/buttons.ts";
import { OFFER_VALID_MS, offerMessage, parsePick, pickSlots, type Slot, slotLabel } from "../_shared/reschedule.ts";
import {
  type ChatChannel,
  ChannelError,
  findInvite,
  logMessage,
  sendRaw,
  telegramButtonTapped,
} from "../_shared/channels.ts";

const VIBER_TOKEN = Deno.env.get("VIBER_AUTH_TOKEN") ?? "";
const TELEGRAM_SECRET = Deno.env.get("TELEGRAM_WEBHOOK_SECRET") ?? "";
const META_APP_SECRET = Deno.env.get("META_APP_SECRET") ?? "";
const META_VERIFY_TOKEN = Deno.env.get("META_VERIFY_TOKEN") ?? "";

// Keywords (English, Filipino, Cebuano). Matched on the whole normalized reply.
const YES = new Set(["YES", "Y", "OO", "OPO", "SIGE", "OK", "OKAY"]);
const STOP = new Set(["STOP", "UNSUBSCRIBE", "TIGIL", "HINTO", "AYAW NA"]);
const BOOK = new Set(["BOOK", "BOOKING", "SCHEDULE", "ISKEDYUL", "APPOINTMENT"]);
const CHECK = new Set(["CHECK", "SYMPTOM CHECK", "SYMPTOMS", "SINTOMAS"]);
const SYMPTOM_CHECK_ON = Boolean((Deno.env.get("SYMPTOM_ENGINE") ?? "").trim());

const OPEN_STATUSES = ["pending", "notified", "callback_requested", "no_answer", "voicemail", "messaged", "needs_invite"];

// ---------------------------------------------------------------------------
// Normalized inbound events
// ---------------------------------------------------------------------------
type Inbound =
  | { kind: "start"; externalId: string; token: string | null; name?: string }
  | { kind: "text"; externalId: string; text: string; name?: string; tap?: { id: string; messageId: number | null } }
  | { kind: "gone"; externalId: string }
  | { kind: "location"; externalId: string; lat: number; lng: number };

/** A reply with optional buttons (shown on Telegram). */
type Reply = { text: string; buttons?: ChatButton[][] };

type ClinicInfo = { id: string | null; name: string; callback: string | null; selfBooking: boolean };

type LinkRow = {
  id: string;
  patient_id: string;
  clinic_id: string | null;
  linked_at: string;
  opted_in_at: string | null;
  opted_out_at: string | null;
  verified_at: string | null;
  verify_attempts: number;
};

const MAX_DOB_ATTEMPTS = 2;
const DOB_EXAMPLE = "for example March 14, 1985 or 14/03/1985";

// ---------------------------------------------------------------------------
// Entry point
// ---------------------------------------------------------------------------
Deno.serve(async (req) => {
  const url = new URL(req.url);
  const ch = url.searchParams.get("ch") as ChatChannel | null;

  if ((ch === "messenger" || ch === "whatsapp") && req.method === "GET") {
    // Meta webhook verification handshake.
    if (
      url.searchParams.get("hub.mode") === "subscribe" &&
      META_VERIFY_TOKEN &&
      url.searchParams.get("hub.verify_token") === META_VERIFY_TOKEN
    ) {
      return new Response(url.searchParams.get("hub.challenge") ?? "", { status: 200 });
    }
    return new Response("forbidden", { status: 403 });
  }

  if (req.method !== "POST") return new Response("method not allowed", { status: 405 });
  const raw = await req.text();

  try {
    switch (ch) {
      case "viber": {
        if (!(await verifyViber(req, raw))) return new Response("bad signature", { status: 401 });
        return await handleViber(JSON.parse(raw));
      }
      case "telegram": {
        if (!verifyTelegram(req)) return new Response("bad secret", { status: 401 });
        for (const ev of parseTelegram(JSON.parse(raw))) {
          if (ev.kind === "text" && ev.tap) await telegramButtonTapped(ev.tap.id, ev.externalId, ev.tap.messageId);
          await dispatch("telegram", ev);
        }
        return ok();
      }
      case "messenger": {
        if (!(await verifyMeta(req, raw))) return new Response("bad signature", { status: 401 });
        for (const ev of parseMessenger(JSON.parse(raw))) await dispatch("messenger", ev);
        return ok();
      }
      case "whatsapp": {
        if (!(await verifyMeta(req, raw))) return new Response("bad signature", { status: 401 });
        for (const ev of parseWhatsApp(JSON.parse(raw))) await dispatch("whatsapp", ev);
        return ok();
      }
      default:
        return new Response("unknown channel", { status: 400 });
    }
  } catch (e) {
    // Always 200 after auth so platforms don't retry-storm on our bugs.
    console.error(`channel-webhook ${ch} error`, e);
    return ok();
  }
});

function ok(body: unknown = { ok: true }) {
  return new Response(JSON.stringify(body), { status: 200, headers: { "Content-Type": "application/json" } });
}

// ---------------------------------------------------------------------------
// Signature verification
// ---------------------------------------------------------------------------
async function hmacHex(key: string, data: string): Promise<string> {
  const k = await crypto.subtle.importKey(
    "raw", new TextEncoder().encode(key), { name: "HMAC", hash: "SHA-256" }, false, ["sign"],
  );
  const sig = await crypto.subtle.sign("HMAC", k, new TextEncoder().encode(data));
  return Array.from(new Uint8Array(sig)).map((b) => b.toString(16).padStart(2, "0")).join("");
}

function safeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

async function verifyViber(req: Request, raw: string): Promise<boolean> {
  const sig = req.headers.get("X-Viber-Content-Signature") ?? "";
  return Boolean(VIBER_TOKEN) && safeEqual(sig, await hmacHex(VIBER_TOKEN, raw));
}

function verifyTelegram(req: Request): boolean {
  const s = req.headers.get("X-Telegram-Bot-Api-Secret-Token") ?? "";
  return Boolean(TELEGRAM_SECRET) && safeEqual(s, TELEGRAM_SECRET);
}

async function verifyMeta(req: Request, raw: string): Promise<boolean> {
  const sig = req.headers.get("X-Hub-Signature-256") ?? "";
  return Boolean(META_APP_SECRET) && safeEqual(sig, `sha256=${await hmacHex(META_APP_SECRET, raw)}`);
}

// ---------------------------------------------------------------------------
// Platform parsers
// ---------------------------------------------------------------------------

// Viber is special: on conversation_started the user is NOT yet subscribed, so
// the only way to reply is the welcome message in this HTTP response body.
// deno-lint-ignore no-explicit-any
async function handleViber(evt: any): Promise<Response> {
  switch (evt.event) {
    case "conversation_started": {
      const reply = await onStart("viber", {
        kind: "start", externalId: String(evt.user?.id ?? ""),
        token: evt.context ? String(evt.context) : null, name: evt.user?.name,
      });
      if (!reply) return ok();
      return ok({ sender: { name: reply.sender.slice(0, 28) }, type: "text", text: reply.text });
    }
    case "message": {
      if (evt.message?.type === "text" && evt.sender?.id) {
        await dispatch("viber", {
          kind: "text", externalId: String(evt.sender.id), text: String(evt.message.text ?? ""), name: evt.sender.name,
        });
      }
      return ok();
    }
    case "unsubscribed":
      if (evt.user_id) await dispatch("viber", { kind: "gone", externalId: String(evt.user_id) });
      return ok();
    default:
      return ok(); // webhook, subscribed, delivered, seen, failed
  }
}

// deno-lint-ignore no-explicit-any
function parseTelegram(u: any): Inbound[] {
  if (u.my_chat_member?.new_chat_member?.status === "kicked") {
    return [{ kind: "gone", externalId: String(u.my_chat_member.chat.id) }];
  }
  // A tapped reply button: handled like the reply it stands for.
  const cb = u.callback_query;
  if (cb?.message?.chat?.id) {
    const reply = replyFromCallback(cb.data);
    if (!reply) return [];
    return [{ kind: "text", externalId: String(cb.message.chat.id), text: reply, name: cb.from?.first_name,
      tap: { id: String(cb.id), messageId: typeof cb.message.message_id === "number" ? cb.message.message_id : null } }];
  }
  const m = u.message;
  // A shared location (📎 → Location): nearby care. Never stored.
  if (m?.chat?.id && typeof m.location?.latitude === "number" && typeof m.location?.longitude === "number") {
    return [{ kind: "location", externalId: String(m.chat.id), lat: m.location.latitude, lng: m.location.longitude }];
  }
  if (!m?.chat?.id || typeof m.text !== "string") return [];
  const externalId = String(m.chat.id);
  const name = m.from?.first_name;
  const start = m.text.match(/^\/start(?:\s+(\S+))?/);
  if (start) return [{ kind: "start", externalId, token: start[1] ?? null, name }];
  if (/^\/stop\b/.test(m.text)) return [{ kind: "text", externalId, text: "STOP", name }];
  if (/^\/check\b/.test(m.text)) return [{ kind: "text", externalId, text: "CHECK", name }];
  return [{ kind: "text", externalId, text: m.text, name }];
}

// deno-lint-ignore no-explicit-any
function parseMessenger(body: any): Inbound[] {
  if (body.object !== "page") return [];
  const out: Inbound[] = [];
  for (const entry of body.entry ?? []) {
    for (const m of entry.messaging ?? []) {
      const externalId = m.sender?.id ? String(m.sender.id) : "";
      if (!externalId) continue;
      if (m.message?.is_echo) continue;
      // m.me/<page>?ref=<token>: existing threads → referral; new threads →
      // postback (Get Started) carrying the referral.
      const ref = m.referral?.ref ?? m.postback?.referral?.ref;
      if (ref) { out.push({ kind: "start", externalId, token: String(ref) }); continue; }
      if (m.postback?.payload === "GET_STARTED") { out.push({ kind: "start", externalId, token: null }); continue; }
      const text = m.message?.quick_reply?.payload ?? m.message?.text ?? m.postback?.payload;
      if (typeof text === "string") out.push({ kind: "text", externalId, text });
    }
  }
  return out;
}

// deno-lint-ignore no-explicit-any
function parseWhatsApp(body: any): Inbound[] {
  if (body.object !== "whatsapp_business_account") return [];
  const out: Inbound[] = [];
  for (const entry of body.entry ?? []) {
    for (const change of entry.changes ?? []) {
      const v = change.value ?? {};
      const names = new Map<string, string>();
      for (const c of v.contacts ?? []) if (c.wa_id) names.set(String(c.wa_id), c.profile?.name);
      for (const m of v.messages ?? []) {
        const externalId = m.from ? String(m.from) : "";
        if (!externalId) continue;
        const text: string | undefined =
          m.text?.body ?? m.button?.text ?? m.interactive?.button_reply?.title;
        if (typeof text !== "string") continue;
        const name = names.get(externalId);
        const connect = text.trim().match(/^CONNECT\s+([A-Za-z0-9_-]{16,64})$/i);
        out.push(connect
          ? { kind: "start", externalId, token: connect[1], name }
          : { kind: "text", externalId, text, name });
      }
    }
  }
  return out;
}

// ---------------------------------------------------------------------------
// Shared conversation logic
// ---------------------------------------------------------------------------
async function dispatch(channel: ChatChannel, ev: Inbound) {
  if (ev.kind === "start") {
    const reply = await onStart(channel, ev);
    if (reply) await reply_(channel, ev.externalId, reply.text, reply.sender, reply.clinicId, reply.patientId, reply.buttons);
    return;
  }
  if (ev.kind === "location") {
    await onLocation(channel, ev);
    return;
  }
  if (ev.kind === "gone") {
    await supabase.from("patient_channels")
      .update({ opted_out_at: new Date().toISOString() })
      .eq("channel", channel).eq("external_id", ev.externalId).is("opted_out_at", null);
    return;
  }
  await onText(channel, ev);
}

async function reply_(
  channel: ChatChannel, externalId: string, text: string, sender: string,
  clinicId: string | null, patientId: string | null, buttons?: ChatButton[][],
) {
  try {
    const pid = await sendRaw(channel, externalId, text, sender, buttons);
    await logMessage({ clinicId, patientId, channel, direction: "outbound", externalId, body: text, providerMessageId: pid });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    await logMessage({ clinicId, patientId, channel, direction: "outbound", externalId, body: text, status: "failed", error: msg });
    if (!(e instanceof ChannelError)) throw e;
  }
}

async function clinicInfo(clinicId: string | null): Promise<ClinicInfo> {
  if (!clinicId) return { id: null, name: "CareCall", callback: null, selfBooking: false };
  const { data } = await supabase.from("clinics")
    .select("name, phone_callback, self_booking_enabled").eq("id", clinicId).maybeSingle();
  const c = data as { name?: string; phone_callback?: string | null; self_booking_enabled?: boolean } | null;
  return { id: clinicId, name: c?.name ?? "your clinic", callback: c?.phone_callback ?? null, selfBooking: c?.self_booking_enabled === true };
}

/** Link a chat account to the invited patient and ask for consent. */
async function onStart(
  channel: ChatChannel,
  ev: Extract<Inbound, { kind: "start" }>,
): Promise<{ text: string; sender: string; clinicId: string | null; patientId: string | null; buttons?: ChatButton[][] } | null> {
  if (!ev.externalId) return null;

  const invite = ev.token ? await findInvite(ev.token) : null;
  if (!invite) {
    // No/expired token. If this account is already linked, treat as a hello.
    const { data } = await supabase.from("patient_channels")
      .select("clinic_id").eq("channel", channel).eq("external_id", ev.externalId).limit(1);
    const existing = (data ?? [])[0] as { clinic_id: string | null } | undefined;
    const clinic = await clinicInfo(existing?.clinic_id ?? null);
    return {
      sender: clinic.name, clinicId: clinic.id, patientId: null,
      buttons: existing ? BUTTONS.book : undefined,
      text: existing
        ? `Hi! This is ${clinic.name}. Reply BOOK to schedule an appointment, or STOP to stop messages.`
        : "Hi! This chat sends appointment reminders from your clinic. Please open the invite link your clinic sent you to connect." +
        (SYMPTOM_CHECK_ON ? " Feeling unwell? Send /check for a symptom check." : ""),
    };
  }

  const clinic = await clinicInfo(invite.clinic_id);
  const { data: existing } = await supabase.from("patient_channels")
    .select("id, external_id, opted_in_at, opted_out_at")
    .eq("patient_id", invite.patient_id).eq("channel", channel).maybeSingle();
  const row = existing as { id: string; external_id: string; opted_in_at: string | null; opted_out_at: string | null } | null;

  if (row && row.external_id === ev.externalId && row.opted_in_at && !row.opted_out_at) {
    return {
      sender: clinic.name, clinicId: clinic.id, patientId: invite.patient_id, buttons: BUTTONS.book,
      text: `You're already connected to ${clinic.name}. Reply BOOK to schedule, or STOP to stop messages.`,
    };
  }

  // (Re)link; consent is reset whenever the chat account changes.
  await supabase.from("patient_channels").upsert({
    patient_id: invite.patient_id,
    clinic_id: invite.clinic_id,
    channel,
    external_id: ev.externalId,
    display_name: ev.name ?? null,
    linked_at: new Date().toISOString(),
    opted_in_at: null,
    opted_out_at: null,
    verified_at: null,
    verify_attempts: 0,
    last_inbound_at: new Date().toISOString(),
  }, { onConflict: "patient_id,channel" });

  return {
    sender: clinic.name, clinicId: clinic.id, patientId: invite.patient_id,
    text:
      `Hi! This is ${clinic.name}. To confirm this invite is for you, please reply with ` +
      `the patient's date of birth, ${DOB_EXAMPLE}. Reply STOP anytime to stop.`,
  };
}

async function onText(channel: ChatChannel, ev: Extract<Inbound, { kind: "text" }>) {
  const now = new Date().toISOString();
  const { data } = await supabase.from("patient_channels")
    .select("id, patient_id, clinic_id, linked_at, opted_in_at, opted_out_at, verified_at, verify_attempts")
    .eq("channel", channel).eq("external_id", ev.externalId);
  const rows = (data ?? []) as LinkRow[];

  // Symptom check works for anyone, connected to a clinic or not.
  const kw0 = ev.text.trim().toUpperCase().replace(/[^A-Z ]/g, "").replace(/\s+/g, " ");
  if (SYMPTOM_CHECK_ON && CHECK.has(kw0)) {
    const clinicId = rows.find((r) => !r.opted_out_at)?.clinic_id ?? null;
    const patientId = rows.find((r) => !r.opted_out_at)?.patient_id ?? null;
    await logMessage({ clinicId, patientId, channel, direction: "inbound", externalId: ev.externalId, body: ev.text });
    await reply_(channel, ev.externalId, await symptomCheckReply(channel, clinicId), "CareCall", clinicId, patientId);
    return;
  }

  if (!rows.length) {
    await logMessage({ clinicId: null, patientId: null, channel, direction: "inbound", externalId: ev.externalId, body: ev.text });
    await reply_(channel, ev.externalId,
      "Hi! This chat sends appointment reminders from your clinic. Please open the invite link your clinic sent you to connect." +
        (SYMPTOM_CHECK_ON ? " Feeling unwell? Send /check for a symptom check." : ""),
      "CareCall", null, null);
    return;
  }

  await supabase.from("patient_channels").update({ last_inbound_at: now })
    .eq("channel", channel).eq("external_id", ev.externalId);

  const kw = ev.text.trim().toUpperCase().replace(/[^A-Z ]/g, "").replace(/\s+/g, " ");
  // Links still waiting for a birthday, newest first (a parent may be
  // connecting several family members one after another).
  const checking = rows
    .filter((r) => !r.verified_at && !r.opted_out_at && r.verify_attempts < MAX_DOB_ATTEMPTS)
    .sort((x, y) => y.linked_at.localeCompare(x.linked_at));
  const isDobReply = checking.length > 0 && !STOP.has(kw);

  // Birthday replies are never stored as typed.
  for (const r of rows) {
    await logMessage({
      clinicId: r.clinic_id, patientId: r.patient_id, channel, direction: "inbound",
      externalId: ev.externalId, body: isDobReply ? "[date of birth reply]" : ev.text,
    });
  }

  const target = isDobReply ? checking[0] : rows[0];
  const clinic = await clinicInfo(target.clinic_id);
  const say = (text: string, buttons?: ChatButton[][]) =>
    reply_(channel, ev.externalId, text, clinic.name, clinic.id, target.patient_id, buttons);

  if (STOP.has(kw)) {
    await supabase.from("patient_channels").update({ opted_out_at: now })
      .eq("channel", channel).eq("external_id", ev.externalId);
    await say(`You won't get messages from ${clinic.name} here anymore. Reply YES to turn them back on.`);
    return;
  }

  if (isDobReply) {
    const r = await checkBirthday(target, ev.text, clinic);
    await say(r.text, r.buttons);
    return;
  }

  const verified = rows.filter((r) => r.verified_at);
  if (!verified.length) {
    const callback = clinic.callback ? ` or call ${clinic.callback}` : "";
    await say(`This chat isn't connected yet. Please ask ${clinic.name} for a new invite link${callback}.`);
    return;
  }

  // Care plans: consent answers, STOP REMINDERS, medicine replies.
  const careAnswer = await careReply(
    ev.text, verified.map((r) => r.patient_id),
    verified.filter((r) => r.opted_in_at && !r.opted_out_at).map((r) => r.patient_id), clinic.name,
  );
  if (careAnswer) { await say(careAnswer); return; }

  const live = verified.filter((r) => r.opted_in_at && !r.opted_out_at).map((r) => r.patient_id);

  // A pick from the new times offered after "change time".
  if (live.length) {
    const picked = await answerOffer(ev.text, live);
    if (picked) { await say(picked.text, picked.buttons); return; }
  }

  // A reply to an appointment reminder (only when one is waiting for an answer).
  const reminderReply = parseReminderReply(ev.text);
  if (reminderReply) {
    const answer = live.length ? await answerReminder(reminderReply, live) : null;
    if (answer) { await say(answer.text, answer.buttons); return; }
  }

  if (YES.has(kw)) {
    const ids = verified.map((r) => r.id);
    const patientIds = verified.map((r) => r.patient_id);
    await supabase.from("patient_channels").update({ opted_in_at: now, opted_out_at: null }).in("id", ids);
    await supabase.from("patients").update({ preferred_channel: channel }).in("id", patientIds);
    await requeueInvited(patientIds);
    await say(`Thanks! You'll get appointment messages from ${clinic.name} here. Reply BOOK to schedule, or STOP to stop.`, BUTTONS.book);
    return;
  }

  const active = verified.filter((r) => r.opted_in_at && !r.opted_out_at);
  if (!active.length) {
    await say(`To receive messages from ${clinic.name} here, please reply YES. Reply STOP to stop.`, BUTTONS.optIn);
    return;
  }

  if (BOOK.has(kw)) {
    await say(await bookingReply(active, clinic));
    return;
  }

  const callback = clinic.callback ? ` or call ${clinic.callback}` : "";
  await say(
    `Thanks for your message. This chat handles appointment reminders and booking. ` +
    `Reply BOOK to schedule${callback}. For emergencies, call 911.`,
    SYMPTOM_CHECK_ON ? BUTTONS.bookOrCheck : BUTTONS.book,
  );
}

/**
 * Compare a typed birthday with the patient's record (server-side only; the
 * reply never reveals the stored date). A reply that isn't a date doesn't use
 * up a try. The second wrong date locks the link and expires the patient's
 * open invites, so staff must create a new one.
 */
async function checkBirthday(row: LinkRow, text: string, clinic: ClinicInfo): Promise<Reply> {
  const candidates = dobCandidates(text);
  if (!candidates.length) {
    return { text: `Please reply with the patient's date of birth, ${DOB_EXAMPLE}.` };
  }

  const { data } = await supabase.from("patients").select("date_of_birth").eq("id", row.patient_id).maybeSingle();
  const dob = (data as { date_of_birth?: string } | null)?.date_of_birth ?? "";
  const now = new Date().toISOString();

  if (dob && candidates.includes(dob.slice(0, 10))) {
    await supabase.from("patient_channels").update({ verified_at: now }).eq("id", row.id);
    return {
      text: `Thank you. Reply YES (or OO) to receive appointment reminders and booking links ` +
        `from ${clinic.name} in this chat. Reply STOP anytime to stop.`,
      buttons: BUTTONS.optIn,
    };
  }

  const attempts = row.verify_attempts + 1;
  await supabase.from("patient_channels").update({ verify_attempts: attempts }).eq("id", row.id);
  if (attempts < MAX_DOB_ATTEMPTS) {
    return { text: `That doesn't match our records. Please check and try again (1 try left), ${DOB_EXAMPLE}.` };
  }

  await supabase.from("channel_invites").update({ expires_at: now })
    .eq("patient_id", row.patient_id).gt("expires_at", now);
  await audit({
    clinicId: row.clinic_id, actorUserId: null, action: "chat_birthday_check_locked",
    targetType: "patient", targetId: row.patient_id,
  });
  const callback = clinic.callback ? ` at ${clinic.callback}` : "";
  return {
    text: `That doesn't match our records, so this invite has been locked. ` +
      `Please contact ${clinic.name}${callback} for a new invite.`,
  };
}

/**
 * A patient who connects a chat app while parked as needs_invite in an active
 * chat campaign goes back to pending, so the next sweep sends their link.
 */
async function requeueInvited(patientIds: string[]) {
  const { data } = await supabase.from("campaign_patients")
    .select("campaign_id, patient_id, campaigns!inner(status)")
    .in("patient_id", patientIds)
    .eq("status", "needs_invite")
    .eq("campaigns.status", "active");
  for (const r of (data ?? []) as { campaign_id: string; patient_id: string }[]) {
    await supabase.from("campaign_patients")
      .update({ status: "pending", flag_reason: null, updated_at: new Date().toISOString() })
      .eq("campaign_id", r.campaign_id).eq("patient_id", r.patient_id).eq("status", "needs_invite");
  }
}

/**
 * One self-booking link per patient with an open campaign. Chat campaigns
 * always offer links; call campaigns only when the clinic has self-booking on.
 */
async function bookingReply(rows: LinkRow[], clinic: ClinicInfo): Promise<string> {
  const callback = clinic.callback ? ` Please call ${clinic.callback}.` : "";

  const patientIds = rows.map((r) => r.patient_id);
  const { data } = await supabase.from("campaign_patients")
    .select("patient_id, campaign_id, campaigns!inner(status, clinic_id, outreach_mode), patients!inner(first_name)")
    .in("patient_id", patientIds)
    .in("status", OPEN_STATUSES)
    .eq("campaigns.status", "active");

  type Row = {
    patient_id: string; campaign_id: string;
    campaigns: { clinic_id: string | null; outreach_mode: string };
    patients: { first_name: string };
  };
  const open = ((data ?? []) as unknown as Row[])
    .filter((r) => clinic.selfBooking || r.campaigns.outreach_mode === "chat");
  if (!open.length && !clinic.selfBooking) {
    return `Online booking isn't available for ${clinic.name} yet.${callback}`;
  }

  const seen = new Set<string>();
  const lines: string[] = [];
  for (const r of open) {
    if (seen.has(r.patient_id)) continue; // one link per patient
    seen.add(r.patient_id);
    const link = await createBookingLink(r.campaign_id, r.patient_id, r.campaigns.clinic_id);
    if (link) lines.push(rows.length > 1 ? `${r.patients.first_name}: ${link}` : link);
  }

  if (!lines.length) return `There's no appointment waiting to be booked right now.${callback}`;
  return `Pick a time that works for you:\n${lines.join("\n")}\nThe link is valid for 7 days.`;
}

/** Link to the symptom check: the patient's clinic page when it has one. */
async function symptomCheckReply(channel: ChatChannel, clinicId: string | null): Promise<string> {
  const portal = (Deno.env.get("PORTAL_URL") ?? "").replace(/\/$/, "");
  let path = "/check";
  if (clinicId) {
    const { data } = await supabase.from("clinics")
      .select("public_slug, symptom_check_enabled").eq("id", clinicId).maybeSingle();
    const c = data as { public_slug: string | null; symptom_check_enabled: boolean } | null;
    if (c?.public_slug && c.symptom_check_enabled) path = `/check/${c.public_slug}`;
  }
  return (
    `Symptom check: answer a few questions and we'll tell you how soon to see a doctor and what kind. ` +
    `It's not a diagnosis.\n\n${portal}${path}?src=${channel}\n\n` +
    (channel === "telegram" && places().configured
      ? `To see emergency rooms and clinics near you, send your location here (📎 → Location).\n\n`
      : "") +
    `If someone has chest pain, trouble breathing, signs of a stroke or heavy bleeding, call 911 now.`
  );
}

/**
 * Apply a 1 / 2 / 3 reply to the patient's latest unanswered reminder (sent in
 * the last 30 hours, appointment still upcoming). Returns the reply text, or
 * null when no reminder is waiting (the message is then handled as usual).
 */
async function answerReminder(reply: ReminderResponse, patientIds: string[]): Promise<Reply | null> {
  const now = new Date();
  const { data } = await supabase.from("appointment_reminders")
    .select("id, clinic_id, patient_id, appointments!inner(id, starts_at, status, provider_id, providers(name), " +
      "patients(first_name, last_name))")
    .in("patient_id", patientIds)
    .eq("status", "sent").is("response", null)
    .gte("created_at", new Date(now.getTime() - 30 * 3600_000).toISOString())
    .in("appointments.status", ["booked", "confirmed"])
    .gt("appointments.starts_at", now.toISOString())
    .order("created_at", { ascending: false }).limit(1);
  const r = (data ?? [])[0] as unknown as {
    id: string; clinic_id: string; patient_id: string;
    appointments: { id: string; starts_at: string; status: string; provider_id: string | null; providers: { name: string } | null;
      patients: { first_name: string; last_name: string } | null };
  } | undefined;
  if (!r) return null;

  const { data: c } = await supabase.from("clinics")
    .select("name, phone_callback, timezone").eq("id", r.clinic_id).maybeSingle();
  const clinic = c as { name: string; phone_callback: string | null; timezone: string | null } | null;
  const tz = clinic?.timezone || "Asia/Manila";
  const w = whenText(new Date(r.appointments.starts_at), now, tz);
  const when = `${w.day} at ${w.time}`;
  const who = `${r.appointments.patients?.first_name ?? ""} ${r.appointments.patients?.last_name ?? ""}`.trim() || "A patient";
  const doctor = r.appointments.providers?.name ? ` with ${r.appointments.providers.name}` : "";
  const call = clinic?.phone_callback ? ` or call ${clinic.phone_callback}` : "";

  await supabase.from("appointment_reminders")
    .update({ response: reply, responded_at: now.toISOString() }).eq("id", r.id);

  if (reply === "confirm") {
    await supabase.from("appointments").update({ status: "confirmed" }).eq("id", r.appointments.id);
    return { text: `Thank you, you're confirmed for ${when}${doctor}. See you!` };
  }

  if (reply === "cancel") {
    await supabase.from("appointments").update({ status: "cancelled" }).eq("id", r.appointments.id);
    await supabase.from("cc_action_items").insert({
      clinic_id: r.clinic_id, source: "reminder", category: "patients", severity: "info",
      title: `Cancelled by patient: ${who}`,
      detail: `${who} cancelled their appointment ${when}${doctor} by replying to the reminder. The time is open again.`,
      route: `/patients/${r.patient_id}`,
    });
    return { text: `Your appointment ${when} is cancelled. To book again, message ${clinic?.name ?? "the clinic"}${call}.`,
      buttons: BUTTONS.book };
  }

  // Change time: offer open times in the chat when there are any.
  if (r.appointments.provider_id) {
    const { data: open } = await supabase.rpc("get_available_slots", {
      p_provider_id: r.appointments.provider_id, p_days: 10, p_limit: 120, p_tz: tz,
    });
    const slots = pickSlots(((open ?? []) as { slot_start: string; slot_end: string }[])
      .map((x) => ({ start: x.slot_start, end: x.slot_end })), tz);
    if (slots.length) {
      await supabase.from("appointment_reminders")
        .update({ offered_slots: slots, offered_at: now.toISOString(), offer_closed_at: null }).eq("id", r.id);
      return offerMessage(slots, tz, clinic?.name ?? "the clinic", when);
    }
  }

  await supabase.from("cc_action_items").insert({
    clinic_id: r.clinic_id, source: "reminder", category: "patients", severity: "warning",
    title: `Wants a new time: ${who}`,
    detail: `${who} can't make their appointment ${when}${doctor} and asked to change the time ` +
      `(reply to the reminder). Contact them to pick a new time, then cancel or move the old one.`,
    route: `/patients/${r.patient_id}`,
  });
  return { text: `OK, ${clinic?.name ?? "the clinic"} will contact you to pick a new time. ` +
    `Your appointment ${when} stays booked until then.` };
}

/**
 * A reply to the new times offered after "change time" (answerReminder):
 *   A–F    → move the appointment to that time (if still open)
 *   OTHER  → the clinic is asked to arrange a time (CC action item)
 *   KEEP   → nothing changes
 * null when no offer is waiting or the text isn't a pick.
 */
async function answerOffer(text: string, patientIds: string[]): Promise<Reply | null> {
  const now = new Date();
  const { data } = await supabase.from("appointment_reminders")
    .select("id, clinic_id, patient_id, offered_slots, appointments!inner(id, starts_at, ends_at, status, provider_id, " +
      "providers(name), patients(first_name, last_name))")
    .in("patient_id", patientIds).eq("response", "reschedule")
    .not("offered_slots", "is", null).is("offer_closed_at", null)
    .gte("offered_at", new Date(now.getTime() - OFFER_VALID_MS).toISOString())
    .in("appointments.status", ["booked", "confirmed"])
    .order("offered_at", { ascending: false }).limit(1);
  const r = (data ?? [])[0] as unknown as {
    id: string; clinic_id: string; patient_id: string; offered_slots: Slot[];
    appointments: { id: string; starts_at: string; ends_at: string; status: string; provider_id: string | null;
      providers: { name: string } | null; patients: { first_name: string; last_name: string } | null };
  } | undefined;
  if (!r) return null;
  const pick = parsePick(text, r.offered_slots.length);
  if (!pick) return null;

  const { data: c } = await supabase.from("clinics")
    .select("name, phone_callback, timezone").eq("id", r.clinic_id).maybeSingle();
  const clinic = c as { name: string; phone_callback: string | null; timezone: string | null } | null;
  const tz = clinic?.timezone || "Asia/Manila";
  const clinicName = clinic?.name ?? "the clinic";
  const w = whenText(new Date(r.appointments.starts_at), now, tz);
  const current = `${w.day} at ${w.time}`;
  const who = `${r.appointments.patients?.first_name ?? ""} ${r.appointments.patients?.last_name ?? ""}`.trim() || "A patient";
  const doctor = r.appointments.providers?.name ? ` with ${r.appointments.providers.name}` : "";
  const close = () => supabase.from("appointment_reminders").update({ offer_closed_at: now.toISOString() }).eq("id", r.id);

  if (pick.kind === "keep") {
    await close();
    return { text: `OK, your appointment ${current}${doctor} stays as it is. See you!` };
  }
  if (pick.kind === "other") {
    await close();
    await supabase.from("cc_action_items").insert({
      clinic_id: r.clinic_id, source: "reminder", category: "patients", severity: "warning",
      title: `Wants a new time: ${who}`,
      detail: `${who} can't make their appointment ${current}${doctor}, and none of the times offered in the chat suit them. ` +
        `Contact them to pick a new time, then move or cancel the old one.`,
      route: `/patients/${r.patient_id}`,
    });
    return { text: `OK, ${clinicName} will contact you to pick another time. Your appointment ${current} stays booked until then.` };
  }

  const slot = r.offered_slots[pick.index];
  // Move the appointment; the database refuses a time someone else just took.
  const passed = Date.parse(slot.start) <= now.getTime();
  const { error } = passed ? { error: null } : await supabase.from("appointments")
    .update({ starts_at: slot.start, ends_at: slot.end, status: "booked", rescheduled_at: now.toISOString() })
    .eq("id", r.appointments.id).in("status", ["booked", "confirmed"]);
  if (passed || error?.code === "23P01") {
    // Offer the remaining times (or hand over to the clinic when none are left).
    const left = r.offered_slots.filter((s, i) => i !== pick.index && Date.parse(s.start) > now.getTime());
    await supabase.from("appointment_reminders").update({ offered_slots: left }).eq("id", r.id);
    const why = passed ? "That time has passed." : "Sorry, that time was just taken.";
    if (!left.length) {
      await close();
      await supabase.from("cc_action_items").insert({
        clinic_id: r.clinic_id, source: "reminder", category: "patients", severity: "warning",
        title: `Wants a new time: ${who}`,
        detail: `${who} wants to change their appointment ${current}${doctor}; the times offered in the chat were taken. ` +
          `Contact them to pick a new time.`,
        route: `/patients/${r.patient_id}`,
      });
      return { text: `${why} ${clinicName} will contact you to pick a new time; your appointment ${current} stays booked.` };
    }
    const offer = offerMessage(left, tz, clinicName, current);
    return { text: `${why}\n${offer.text}`, buttons: offer.buttons };
  }
  if (error) throw error;
  await supabase.from("appointment_reminders")
    .update({ offer_closed_at: now.toISOString(), rescheduled_to: slot.start }).eq("id", r.id);
  const newLabel = slotLabel(slot, tz);
  await supabase.from("cc_action_items").insert({
    clinic_id: r.clinic_id, source: "reminder", category: "patients", severity: "info",
    title: `Moved by patient: ${who}`,
    detail: `${who} moved their appointment${doctor} from ${current} to ${newLabel} in the chat.`,
    route: `/patients/${r.patient_id}`,
  });
  return { text: `Done! Your appointment is now ${newLabel}${doctor}. You'll get a reminder before it.` };
}

/**
 * Care plan replies (M1), or null when the message isn't one:
 *   STOP REMINDERS                       → withdraw medicine-reminder consent
 *   YES / NO to a consent request         → record the answer (3-day window)
 *   1 / 2 after a medicine reminder       → taken / skipped (until it's missed);
 *     if an appointment reminder was sent after it, that one gets the reply.
 */
async function careReply(text: string, patientIds: string[], livePatientIds: string[], clinicName: string): Promise<string | null> {
  const now = new Date();
  if (!patientIds.length) return null;

  if (isWithdraw(text)) {
    const { data } = await supabase.from("care_consents").update({ withdrawn_at: now.toISOString() })
      .in("patient_id", patientIds).is("withdrawn_at", null).not("consented_at", "is", null).select("id");
    return (data ?? []).length
      ? `Medicine reminders are stopped. Your doctor's instructions don't change: keep taking your medicines ` +
        `as prescribed unless your doctor says otherwise. To start again, ask ${clinicName}.`
      : `You don't have medicine reminders on.`;
  }

  const consent = parseConsentReply(text);
  if (consent) {
    const { data } = await supabase.from("care_consents").select("id")
      .in("patient_id", patientIds)
      .is("consented_at", null).is("declined_at", null).is("withdrawn_at", null)
      .gte("requested_at", new Date(now.getTime() - 3 * 24 * 3600_000).toISOString())
      .order("requested_at", { ascending: false }).limit(1);
    const pending = (data ?? [])[0] as { id: string } | undefined;
    if (pending) {
      await supabase.from("care_consents")
        .update(consent === "yes" ? { consented_at: now.toISOString() } : { declined_at: now.toISOString() })
        .eq("id", pending.id);
      return consent === "yes"
        ? `Thank you! Your medicine reminders start at the next time your doctor set. ` +
          `Reply STOP REMINDERS any time to stop.`
        : `OK, no medicine reminders. If you change your mind, just tell ${clinicName}.`;
    }
  }

  const dose = parseDoseReply(text);
  if (dose && livePatientIds.length) {
    const { data } = await supabase.from("medication_doses").select("patient_id, due_at, sent_at")
      .in("patient_id", livePatientIds).eq("status", "sent")
      .gt("due_at", new Date(now.getTime() - MISSED_AFTER_MS).toISOString())
      .order("sent_at", { ascending: false }).limit(1);
    const latest = (data ?? [])[0] as { patient_id: string; due_at: string; sent_at: string } | undefined;
    if (!latest) return null;

    const { data: appt } = await supabase.from("appointment_reminders").select("created_at")
      .in("patient_id", livePatientIds).eq("status", "sent").is("response", null)
      .gte("created_at", latest.sent_at).limit(1);
    if ((appt ?? []).length) return null; // a newer appointment reminder takes the reply

    await supabase.from("medication_doses").update({ status: dose, answered_at: now.toISOString() })
      .eq("patient_id", latest.patient_id).eq("due_at", latest.due_at).eq("status", "sent");
    return dose === "taken"
      ? "Thanks! Marked as taken ✅"
      : `OK, noted as skipped. If you're having trouble with this medicine, tell ${clinicName}.`;
  }
  return null;
}

/**
 * A location shared in the chat: nearest emergency rooms, CareCall clinics
 * with their booking pages, then other nearby options. The location is used
 * for the lookup only; the message log says "[location shared]".
 */
async function onLocation(channel: ChatChannel, ev: Extract<Inbound, { kind: "location" }>) {
  const { data: rows } = await supabase.from("patient_channels")
    .select("clinic_id, patient_id").eq("channel", channel).eq("external_id", ev.externalId).is("opted_out_at", null).limit(1);
  const row = (rows ?? [])[0] as { clinic_id: string | null; patient_id: string } | undefined;
  await logMessage({ clinicId: row?.clinic_id ?? null, patientId: row?.patient_id ?? null, channel, direction: "inbound",
    externalId: ev.externalId, body: "[location shared]" });
  const say = (text: string) => reply_(channel, ev.externalId, text, "CareCall", row?.clinic_id ?? null, row?.patient_id ?? null);

  const origin = validPoint(ev.lat, ev.lng);
  if (!origin || !SYMPTOM_CHECK_ON) {
    await say("Thanks. In an emergency, call 911. For a symptom check, send /check.");
    return;
  }
  // Each lookup is a paid Places call: a few a minute per chat at most.
  const { data: n } = await supabase.rpc("bump_symptom_rate", { p_ip: `t:${ev.externalId}` });
  if (typeof n === "number" && n > 3) {
    await say("Please wait a minute before sending your location again. In an emergency, call 911.");
    return;
  }
  const portal = (Deno.env.get("PORTAL_URL") ?? "").replace(/\/$/, "");
  const [er, care] = await Promise.all([nearbyCare(origin, "emergency"), nearbyCare(origin, "care")]);
  await say(nearbyText({ er: er.places, careCall: care.careCall, care: care.places, portal }));
}
