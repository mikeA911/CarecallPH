// CareCall PH — shared messaging channel layer (Phase 1).
//
// One entry point, sendToPatient(), picks the best channel a patient can be
// reached on and sends there, logging every attempt to channel_messages:
//
//   1. preferred chat channel, if opted in (and, for Messenger/WhatsApp,
//      inside the 24h customer-service window)
//   2. any other opted-in chat channel, in CHANNEL_PRIORITY order
//   3. SMS, if the patient has SMS consent and a messaging profile is set
//
// Chat apps are opt-in only: a row in patient_channels with opted_in_at set and
// opted_out_at null. Rows are created/consented by the channel-webhook function.
//
// Deploy with the Supabase CLI (it bundles _shared/ imports). Pasting a single
// function into the dashboard editor will NOT include this file.
//
// Env (all optional; a channel with no credentials is simply never selected):
//   TELNYX_API_KEY, TELNYX_FROM_NUMBER, TELNYX_MESSAGING_PROFILE_ID
//   VIBER_AUTH_TOKEN
//   TELEGRAM_BOT_TOKEN
//   META_PAGE_ACCESS_TOKEN, META_GRAPH_VERSION (default v21.0)
//   WHATSAPP_PHONE_NUMBER_ID, WHATSAPP_ACCESS_TOKEN  (Meta WhatsApp Cloud API)
//   PORTAL_URL  — base for /connect/<token> invite links

import { supabase, telnyx, generateBookingToken, hashBookingToken } from "./lib.ts";

export type Channel = "sms" | "viber" | "messenger" | "whatsapp" | "telegram";
export type ChatChannel = Exclude<Channel, "sms">;

export type PatientLite = {
  id: string;
  phone: string;
  sms_consent?: boolean | null;
  preferred_channel?: Channel | null;
};

const VIBER_TOKEN = Deno.env.get("VIBER_AUTH_TOKEN") ?? "";
const TELEGRAM_TOKEN = Deno.env.get("TELEGRAM_BOT_TOKEN") ?? "";
const META_TOKEN = Deno.env.get("META_PAGE_ACCESS_TOKEN") ?? "";
const META_VERSION = Deno.env.get("META_GRAPH_VERSION") ?? "v21.0";
const SMS_FROM = Deno.env.get("TELNYX_FROM_NUMBER") ?? "";
const SMS_PROFILE = Deno.env.get("TELNYX_MESSAGING_PROFILE_ID") ?? "";

const WA_PHONE_ID = Deno.env.get("WHATSAPP_PHONE_NUMBER_ID") ?? "";
const WA_TOKEN = Deno.env.get("WHATSAPP_ACCESS_TOKEN") ?? "";

/**
 * Fallback order when a patient has several opted-in chat apps and none is
 * preferred. Based on Philippine messaging-app reach (MEF): Viber 71%,
 * Messenger 60%, WhatsApp 40%, Telegram 20%. SMS is always last.
 */
export const CHANNEL_PRIORITY: ChatChannel[] = ["viber", "messenger", "whatsapp", "telegram"];

/** Channels that may only send free-form messages within 24h of the patient's last message. */
const WINDOWED: ReadonlySet<ChatChannel> = new Set(["messenger", "whatsapp"]);
const SERVICE_WINDOW_MS = 24 * 60 * 60 * 1000;

/** Which channels have credentials configured in this deployment. */
export function channelConfigured(ch: Channel): boolean {
  switch (ch) {
    case "sms": return Boolean(SMS_FROM && SMS_PROFILE);
    case "viber": return Boolean(VIBER_TOKEN);
    case "telegram": return Boolean(TELEGRAM_TOKEN);
    case "messenger": return Boolean(META_TOKEN);
    case "whatsapp": return Boolean(WA_PHONE_ID && WA_TOKEN);
  }
}

type ChannelRow = {
  id: string;
  channel: ChatChannel;
  external_id: string;
  last_inbound_at: string | null;
};

/**
 * Resolve where a patient can be messaged right now. Returns null when no
 * channel is permitted (no chat opt-in and no SMS consent) — callers must then
 * skip the message, never fall back to an unconsented channel.
 */
export async function resolveChannel(
  patient: PatientLite,
): Promise<{ channel: Channel; externalId: string; rowId?: string } | null> {
  const { data } = await supabase.from("patient_channels")
    .select("id, channel, external_id, last_inbound_at")
    .eq("patient_id", patient.id)
    .not("opted_in_at", "is", null)
    .is("opted_out_at", null);

  const rows = ((data ?? []) as ChannelRow[]).filter((r) => {
    if (!channelConfigured(r.channel)) return false;
    if (WINDOWED.has(r.channel)) {
      // Outside 24h we'd need an approved utility template (Phase 1b).
      const last = r.last_inbound_at ? Date.parse(r.last_inbound_at) : 0;
      return Date.now() - last < SERVICE_WINDOW_MS;
    }
    return true;
  });

  rows.sort((a, b) => CHANNEL_PRIORITY.indexOf(a.channel) - CHANNEL_PRIORITY.indexOf(b.channel));
  const preferred = rows.find((r) => r.channel === patient.preferred_channel);
  const pick = preferred ?? rows[0];
  if (pick) return { channel: pick.channel, externalId: pick.external_id, rowId: pick.id };

  if (patient.sms_consent === true && channelConfigured("sms")) {
    return { channel: "sms", externalId: patient.phone };
  }
  return null;
}

/** Whether resolveChannel would find anything — cheap gate for callers. */
export async function canMessage(patient: PatientLite): Promise<boolean> {
  return (await resolveChannel(patient)) !== null;
}

/** True when the patient has at least one opted-in chat channel. */
export async function hasChatChannel(patientId: string): Promise<boolean> {
  const { count } = await supabase.from("patient_channels")
    .select("id", { count: "exact", head: true })
    .eq("patient_id", patientId)
    .not("opted_in_at", "is", null)
    .is("opted_out_at", null);
  return (count ?? 0) > 0;
}

export class ChannelError extends Error {
  constructor(message: string, readonly unreachable = false) {
    super(message);
  }
}

/**
 * Low-level send to one chat id / phone. Throws ChannelError; `unreachable`
 * means the user blocked/unsubscribed and the channel row should be opted out.
 * Returns the provider's message id when available.
 */
export async function sendRaw(
  channel: Channel,
  externalId: string,
  text: string,
  senderName = "CareCall",
): Promise<string | null> {
  switch (channel) {
    case "sms": {
      const res = await telnyx("/messages", {
        from: SMS_FROM,
        to: externalId,
        messaging_profile_id: SMS_PROFILE,
        text,
      });
      return res?.data?.id ?? null;
    }

    case "viber": {
      const res = await fetch("https://chatapi.viber.com/pa/send_message", {
        method: "POST",
        headers: { "X-Viber-Auth-Token": VIBER_TOKEN, "Content-Type": "application/json" },
        body: JSON.stringify({
          receiver: externalId,
          min_api_version: 1,
          sender: { name: senderName.slice(0, 28) }, // Viber max 28 chars
          type: "text",
          text,
        }),
      });
      const j = await res.json().catch(() => ({}));
      // status 0 = ok; 5 = receiver not registered, 6 = receiver not subscribed
      if (j.status !== 0) {
        throw new ChannelError(`viber ${j.status} ${j.status_message ?? ""}`, j.status === 5 || j.status === 6);
      }
      return j.message_token ? String(j.message_token) : null;
    }

    case "telegram": {
      const res = await fetch(`https://api.telegram.org/bot${TELEGRAM_TOKEN}/sendMessage`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ chat_id: externalId, text }),
      });
      const j = await res.json().catch(() => ({}));
      if (!j.ok) throw new ChannelError(`telegram ${j.error_code} ${j.description ?? ""}`, j.error_code === 403);
      return j.result?.message_id ? String(j.result.message_id) : null;
    }

    case "messenger": {
      const res = await fetch(
        `https://graph.facebook.com/${META_VERSION}/me/messages?access_token=${encodeURIComponent(META_TOKEN)}`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            recipient: { id: externalId },
            messaging_type: "RESPONSE", // valid only inside the 24h window
            message: { text },
          }),
        },
      );
      const j = await res.json().catch(() => ({}));
      if (!res.ok || j.error) {
        // 551 = person unavailable / blocked the page
        const code = j.error?.code;
        throw new ChannelError(`messenger ${code} ${j.error?.message ?? res.status}`, code === 551);
      }
      return j.message_id ?? null;
    }

    case "whatsapp": {
      const res = await fetch(`https://graph.facebook.com/${META_VERSION}/${WA_PHONE_ID}/messages`, {
        method: "POST",
        headers: { Authorization: `Bearer ${WA_TOKEN}`, "Content-Type": "application/json" },
        body: JSON.stringify({
          messaging_product: "whatsapp",
          to: externalId, // wa_id (international digits, no +)
          type: "text",
          text: { body: text, preview_url: true },
        }),
      });
      const j = await res.json().catch(() => ({}));
      if (!res.ok || j.error) {
        throw new ChannelError(`whatsapp ${j.error?.code ?? res.status} ${j.error?.message ?? ""}`);
      }
      return j.messages?.[0]?.id ?? null;
    }
  }
}

/** Append a row to channel_messages (best-effort). */
export async function logMessage(entry: {
  clinicId: string | null;
  patientId: string | null;
  campaignId?: string | null;
  channel: Channel;
  direction: "outbound" | "inbound";
  externalId: string | null;
  body: string | null;
  providerMessageId?: string | null;
  status?: "sent" | "failed" | "received";
  error?: string | null;
}) {
  const { error } = await supabase.from("channel_messages").insert({
    clinic_id: entry.clinicId,
    patient_id: entry.patientId,
    campaign_id: entry.campaignId ?? null,
    channel: entry.channel,
    direction: entry.direction,
    external_id: entry.externalId,
    body: entry.body,
    provider_message_id: entry.providerMessageId ?? null,
    status: entry.status ?? (entry.direction === "inbound" ? "received" : "sent"),
    error: entry.error ?? null,
  });
  if (error) console.error("channel_messages insert failed", error);
}

async function markOptedOut(rowId: string) {
  await supabase.from("patient_channels")
    .update({ opted_out_at: new Date().toISOString() })
    .eq("id", rowId);
}

/**
 * Send one message to a patient on the best permitted channel.
 * `text` is a function of the channel so callers can vary copy (e.g. "from
 * this number" only makes sense on SMS). If a chat send fails because the user
 * blocked the bot, the row is opted out and we retry once on the next channel.
 */
export async function sendToPatient(opts: {
  patient: PatientLite;
  clinicId: string | null;
  clinicName: string;
  campaignId?: string | null;
  text: (channel: Channel) => string;
}): Promise<{ ok: boolean; channel: Channel | null }> {
  for (let attempt = 0; attempt < 2; attempt++) {
    const target = await resolveChannel(opts.patient);
    if (!target) return { ok: false, channel: null };

    const body = opts.text(target.channel);
    try {
      const pid = await sendRaw(target.channel, target.externalId, body, opts.clinicName);
      await logMessage({
        clinicId: opts.clinicId, patientId: opts.patient.id, campaignId: opts.campaignId,
        channel: target.channel, direction: "outbound", externalId: target.externalId,
        body, providerMessageId: pid,
      });
      return { ok: true, channel: target.channel };
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      await logMessage({
        clinicId: opts.clinicId, patientId: opts.patient.id, campaignId: opts.campaignId,
        channel: target.channel, direction: "outbound", externalId: target.externalId,
        body, status: "failed", error: msg,
      });
      if (e instanceof ChannelError && e.unreachable && target.rowId) {
        await markOptedOut(target.rowId);
        continue; // try the next permitted channel once
      }
      return { ok: false, channel: target.channel };
    }
  }
  return { ok: false, channel: null };
}

// ---------------------------------------------------------------------------
// Opt-in invites — /connect/<token>
// ---------------------------------------------------------------------------

/**
 * Mint a chat opt-in invite for a patient and return its public URL, or null
 * when PORTAL_URL is unset. Tokens reuse the booking-link generator: 22-char
 * base64url, which fits Telegram's 64-char start param and Messenger's ref.
 */
export async function createChannelInvite(
  patientId: string,
  clinicId: string | null,
): Promise<string | null> {
  const portal = (Deno.env.get("PORTAL_URL") ?? "").replace(/\/$/, "");
  if (!portal) return null;
  const token = generateBookingToken();
  const { error } = await supabase.from("channel_invites").insert({
    token_hash: await hashBookingToken(token),
    patient_id: patientId,
    clinic_id: clinicId,
  });
  if (error) {
    console.error("createChannelInvite insert failed", error);
    return null;
  }
  return `${portal}/connect/${token}`;
}

/** Look up a live invite by raw token. */
export async function findInvite(token: string): Promise<{ patient_id: string; clinic_id: string | null } | null> {
  if (!/^[A-Za-z0-9_-]{16,64}$/.test(token)) return null;
  const { data } = await supabase.from("channel_invites")
    .select("patient_id, clinic_id")
    .eq("token_hash", await hashBookingToken(token))
    .gt("expires_at", new Date().toISOString())
    .maybeSingle();
  return (data as { patient_id: string; clinic_id: string | null } | null) ?? null;
}
