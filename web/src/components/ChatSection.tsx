// Patient detail → "Chat apps": connection status, "Invite to chat" (link, QR
// code and ready-to-send messages), and the patient's recent chat/SMS messages.
//
// Invites are minted server-side by the channel-invite function (tokens are
// never readable from the browser); status and messages are read under RLS.
import { useCallback, useEffect, useState } from "react";
import { supabase } from "../lib/supabase";
import { callFunction } from "../lib/api";
import { CHANNEL_LABELS, type ChannelMessage, type PatientChannel } from "../lib/types";

type Invite = { url: string; expires_at: string; qr: string };

export default function ChatSection({ patientId, firstName, clinicName, canInvite }: {
  patientId: string; firstName: string; clinicName: string; canInvite: boolean;
}) {
  const [channels, setChannels] = useState<PatientChannel[]>([]);
  const [messages, setMessages] = useState<ChannelMessage[]>([]);
  const [invite, setInvite] = useState<Invite | null>(null);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState("");

  const load = useCallback(async () => {
    const [{ data: ch }, { data: m }] = await Promise.all([
      supabase.from("patient_channels")
        .select("id, channel, display_name, linked_at, opted_in_at, opted_out_at, verified_at, verify_attempts")
        .eq("patient_id", patientId).order("linked_at", { ascending: false }),
      supabase.from("channel_messages")
        .select("id, channel, direction, body, status, error, created_at")
        .eq("patient_id", patientId).order("created_at", { ascending: false }).limit(20),
    ]);
    setChannels((ch as PatientChannel[]) ?? []);
    setMessages((m as ChannelMessage[]) ?? []);
  }, [patientId]);

  useEffect(() => { load(); }, [load]);

  async function createInvite() {
    setBusy(true); setMsg("");
    const { data, error } = await callFunction<{ url: string; expires_at: string }>(
      "channel-invite", { patient_id: patientId });
    setBusy(false);
    if (error || !data) { setMsg(`Couldn't create an invite: ${error ?? "no response"}`); return; }
    // Loaded on demand so the QR library isn't in every page load.
    const { default: QRCode } = await import("qrcode");
    const qr = await QRCode.toDataURL(data.url, { margin: 1, width: 220 });
    setInvite({ ...data, qr });
  }

  async function copy(text: string, what: string) {
    try {
      await navigator.clipboard.writeText(text);
      setMsg(`${what} copied.`);
    } catch {
      setMsg("Copy didn't work in this browser. Select the text and copy it by hand.");
    }
  }

  const english = invite &&
    `Hi ${firstName}! This is ${clinicName}. Get appointment reminders and booking links ` +
    `on your chat app (Telegram, Viber, Messenger or WhatsApp). Open this link to connect: ${invite.url}`;
  const filipino = invite &&
    `Hi ${firstName}! Ito ang ${clinicName}. Para makatanggap ng paalala at link para ` +
    `mag-book ng appointment sa inyong chat app, buksan ang link na ito: ${invite.url}`;

  return (
    <>
      <h2>Chat apps</h2>
      {msg && <p role="status">{msg}</p>}
      <table>
        <thead><tr><th>App</th><th>Connected</th><th>Said YES</th><th>Status</th></tr></thead>
        <tbody>
          {channels.map((c) => (
            <tr key={c.id}>
              <td>{CHANNEL_LABELS[c.channel] ?? c.channel}{c.display_name ? ` (${c.display_name})` : ""}</td>
              <td>{new Date(c.linked_at).toLocaleString()}</td>
              <td>{c.opted_in_at ? new Date(c.opted_in_at).toLocaleString() : "—"}</td>
              <td>{channelStatus(c)}</td>
            </tr>
          ))}
          {!channels.length && (
            <tr><td colSpan={4} className="empty">Not connected to any chat app yet.</td></tr>
          )}
        </tbody>
      </table>

      {canInvite && (
        <div className="row-actions" style={{ marginTop: 10 }}>
          <button className="secondary" disabled={busy} onClick={createInvite}>
            {busy ? "Creating…" : invite ? "Create a new invite" : "Invite to chat"}
          </button>
        </div>
      )}

      {invite && (
        <div className="form-card invite-card" style={{ marginTop: 12 }}>
          <div className="invite-grid">
            <img src={invite.qr} alt="QR code of the chat invite link" width={180} height={180} />
            <div>
              <p className="small muted" style={{ marginTop: 0 }}>
                Send one of these messages from the clinic's phone, or let the patient scan the
                QR code. They pick an app, reply with their date of birth, then YES. The link works for 30 days
                (until {new Date(invite.expires_at).toLocaleDateString()}).
              </p>
              <label htmlFor="inv-link">Invite link</label>
              <input id="inv-link" readOnly value={invite.url} onFocus={(e) => e.target.select()} />
              <div className="row-actions" style={{ marginTop: 6 }}>
                <button className="secondary" onClick={() => copy(invite.url, "Link")}>Copy link</button>
              </div>
            </div>
          </div>
          <label htmlFor="inv-en">Message in English</label>
          <textarea id="inv-en" rows={3} readOnly value={english ?? ""} />
          <div className="row-actions" style={{ marginTop: 6 }}>
            <button className="secondary" onClick={() => copy(english ?? "", "English message")}>Copy English message</button>
          </div>
          <label htmlFor="inv-fil">Message in Filipino</label>
          <textarea id="inv-fil" rows={3} readOnly value={filipino ?? ""} />
          <div className="row-actions" style={{ marginTop: 6 }}>
            <button className="secondary" onClick={() => copy(filipino ?? "", "Filipino message")}>Copy Filipino message</button>
          </div>
        </div>
      )}

      <h2>Messages</h2>
      <table>
        <thead><tr><th>When</th><th>App</th><th>Direction</th><th>Message</th><th>Status</th></tr></thead>
        <tbody>
          {messages.map((m) => (
            <tr key={m.id}>
              <td>{new Date(m.created_at).toLocaleString()}</td>
              <td>{CHANNEL_LABELS[m.channel] ?? m.channel}</td>
              <td>{m.direction === "inbound" ? "Received" : "Sent"}</td>
              <td className="msg-body">{m.body ?? "—"}</td>
              <td>{m.status === "failed" ? <span title={m.error ?? ""}>failed</span> : m.status}</td>
            </tr>
          ))}
          {!messages.length && <tr><td colSpan={5} className="empty">No messages yet.</td></tr>}
        </tbody>
      </table>
    </>
  );
}

function channelStatus(c: PatientChannel): string {
  if (c.opted_out_at) return "Stopped messages";
  if (c.opted_in_at) return "Active";
  if (c.verified_at) return "Waiting for YES";
  if (c.verify_attempts >= 2) return "Birthday didn't match: create a new invite";
  return "Waiting for birthday";
}
