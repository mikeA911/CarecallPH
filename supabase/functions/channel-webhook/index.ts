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
//   start + invite token → link chat account to patient, ask for consent
//   YES / OO / OPO / SIGE → opt in (DPA consent record), set preferred channel
//   BOOK / ISKEDYUL       → send a self-booking link per open campaign
//   STOP / TIGIL / HINTO  → opt out
//   anything else         → logged for staff; short auto-reply
//
// Env: VIBER_AUTH_TOKEN, TELEGRAM_BOT_TOKEN, TELEGRAM_WEBHOOK_SECRET,
//      META_PAGE_ACCESS_TOKEN, META_APP_SECRET, META_VERIFY_TOKEN, PORTAL_URL,
//      WHATSAPP_PHONE_NUMBER_ID, WHATSAPP_ACCESS_TOKEN
//
// WhatsApp opt-in: there is no deep-link payload, so the /connect page opens
// wa.me/<number>?text=CONNECT%20<token> and we parse that first message.

import { supabase, createBookingLink } from "../_shared/lib.ts";
import {
  type ChatChannel,
  ChannelError,
  findInvite,
  logMessage,
  sendRaw,
} from "../_shared/channels.ts";

const VIBER_TOKEN = Deno.env.get("VIBER_AUTH_TOKEN") ?? "";
const TELEGRAM_SECRET = Deno.env.get("TELEGRAM_WEBHOOK_SECRET") ?? "";
const META_APP_SECRET = Deno.env.get("META_APP_SECRET") ?? "";
const META_VERIFY_TOKEN = Deno.env.get("META_VERIFY_TOKEN") ?? "";

// Keywords (English, Filipino, Cebuano). Matched on the whole normalized reply.
const YES = new Set(["YES", "Y", "OO", "OPO", "SIGE", "OK", "OKAY"]);
const STOP = new Set(["STOP", "UNSUBSCRIBE", "TIGIL", "HINTO", "AYAW NA"]);
const BOOK = new Set(["BOOK", "BOOKING", "SCHEDULE", "ISKEDYUL", "APPOINTMENT"]);

const OPEN_STATUSES = ["pending", "notified", "callback_requested", "no_answer", "voicemail"];

// ---------------------------------------------------------------------------
// Normalized inbound events
// ---------------------------------------------------------------------------
type Inbound =
  | { kind: "start"; externalId: string; token: string | null; name?: string }
  | { kind: "text"; externalId: string; text: string; name?: string }
  | { kind: "gone"; externalId: string };

type ClinicInfo = { id: string | null; name: string; callback: string | null; selfBooking: boolean };

type LinkRow = {
  id: string;
  patient_id: string;
  clinic_id: string | null;
  opted_in_at: string | null;
  opted_out_at: string | null;
};

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
        for (const ev of parseTelegram(JSON.parse(raw))) await dispatch("telegram", ev);
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
  const m = u.message;
  if (!m?.chat?.id || typeof m.text !== "string") return [];
  const externalId = String(m.chat.id);
  const name = m.from?.first_name;
  const start = m.text.match(/^\/start(?:\s+(\S+))?/);
  if (start) return [{ kind: "start", externalId, token: start[1] ?? null, name }];
  if (/^\/stop\b/.test(m.text)) return [{ kind: "text", externalId, text: "STOP", name }];
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
    if (reply) await reply_(channel, ev.externalId, reply.text, reply.sender, reply.clinicId, reply.patientId);
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
  clinicId: string | null, patientId: string | null,
) {
  try {
    const pid = await sendRaw(channel, externalId, text, sender);
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
): Promise<{ text: string; sender: string; clinicId: string | null; patientId: string | null } | null> {
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
      text: existing
        ? `Hi! This is ${clinic.name}. Reply BOOK to schedule an appointment, or STOP to stop messages.`
        : "Hi! This chat sends appointment reminders from your clinic. Please open the invite link your clinic sent you to connect.",
    };
  }

  const clinic = await clinicInfo(invite.clinic_id);
  const { data: existing } = await supabase.from("patient_channels")
    .select("id, external_id, opted_in_at, opted_out_at")
    .eq("patient_id", invite.patient_id).eq("channel", channel).maybeSingle();
  const row = existing as { id: string; external_id: string; opted_in_at: string | null; opted_out_at: string | null } | null;

  if (row && row.external_id === ev.externalId && row.opted_in_at && !row.opted_out_at) {
    return {
      sender: clinic.name, clinicId: clinic.id, patientId: invite.patient_id,
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
    last_inbound_at: new Date().toISOString(),
  }, { onConflict: "patient_id,channel" });

  return {
    sender: clinic.name, clinicId: clinic.id, patientId: invite.patient_id,
    text:
      `Hi! This is ${clinic.name}. Reply YES (or OO) to receive appointment reminders ` +
      `and booking links in this chat. Reply STOP anytime to stop.`,
  };
}

async function onText(channel: ChatChannel, ev: Extract<Inbound, { kind: "text" }>) {
  const now = new Date().toISOString();
  const { data } = await supabase.from("patient_channels")
    .select("id, patient_id, clinic_id, opted_in_at, opted_out_at")
    .eq("channel", channel).eq("external_id", ev.externalId);
  const rows = (data ?? []) as LinkRow[];

  if (!rows.length) {
    await logMessage({ clinicId: null, patientId: null, channel, direction: "inbound", externalId: ev.externalId, body: ev.text });
    await reply_(channel, ev.externalId,
      "Hi! This chat sends appointment reminders from your clinic. Please open the invite link your clinic sent you to connect.",
      "CareCall", null, null);
    return;
  }

  await supabase.from("patient_channels").update({ last_inbound_at: now })
    .eq("channel", channel).eq("external_id", ev.externalId);
  for (const r of rows) {
    await logMessage({ clinicId: r.clinic_id, patientId: r.patient_id, channel, direction: "inbound", externalId: ev.externalId, body: ev.text });
  }

  const clinic = await clinicInfo(rows[0].clinic_id);
  const say = (text: string) => reply_(channel, ev.externalId, text, clinic.name, clinic.id, rows[0].patient_id);
  const kw = ev.text.trim().toUpperCase().replace(/[^A-Z ]/g, "").replace(/\s+/g, " ");

  if (STOP.has(kw)) {
    await supabase.from("patient_channels").update({ opted_out_at: now })
      .eq("channel", channel).eq("external_id", ev.externalId);
    await say(`You won't get messages from ${clinic.name} here anymore. Reply YES to turn them back on.`);
    return;
  }

  if (YES.has(kw)) {
    const ids = rows.map((r) => r.id);
    await supabase.from("patient_channels").update({ opted_in_at: now, opted_out_at: null }).in("id", ids);
    await supabase.from("patients").update({ preferred_channel: channel }).in("id", rows.map((r) => r.patient_id));
    await say(`Thanks! You'll get appointment messages from ${clinic.name} here. Reply BOOK to schedule, or STOP to stop.`);
    return;
  }

  const active = rows.filter((r) => r.opted_in_at && !r.opted_out_at);
  if (!active.length) {
    await say(`To receive messages from ${clinic.name} here, please reply YES. Reply STOP to stop.`);
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
  );
}

/** One self-booking link per patient with an open campaign. */
async function bookingReply(rows: LinkRow[], clinic: ClinicInfo): Promise<string> {
  const callback = clinic.callback ? ` Please call ${clinic.callback}.` : "";
  if (!clinic.selfBooking) {
    return `Online booking isn't available for ${clinic.name} yet.${callback}`;
  }

  const patientIds = rows.map((r) => r.patient_id);
  const { data } = await supabase.from("campaign_patients")
    .select("patient_id, campaign_id, campaigns!inner(status, clinic_id), patients!inner(first_name)")
    .in("patient_id", patientIds)
    .in("status", OPEN_STATUSES)
    .eq("campaigns.status", "active");

  type Row = { patient_id: string; campaign_id: string; campaigns: { clinic_id: string | null }; patients: { first_name: string } };
  const seen = new Set<string>();
  const lines: string[] = [];
  for (const r of (data ?? []) as unknown as Row[]) {
    if (seen.has(r.patient_id)) continue; // one link per patient
    seen.add(r.patient_id);
    const link = await createBookingLink(r.campaign_id, r.patient_id, r.campaigns.clinic_id);
    if (link) lines.push(rows.length > 1 ? `${r.patients.first_name}: ${link}` : link);
  }

  if (!lines.length) return `There's no appointment waiting to be booked right now.${callback}`;
  return `Pick a time that works for you:\n${lines.join("\n")}\nThe link is valid for 7 days.`;
}
