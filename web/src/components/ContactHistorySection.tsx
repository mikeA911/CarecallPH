// Clinic settings → Message history: how long chat messages, and call
// transcripts and recording links, are kept before the nightly purge.
// Empty = platform default (Global settings). Not the medical record:
// readings, dose answers, appointments and notes follow Records retention.
import { useEffect, useState } from "react";
import { supabase } from "../lib/supabase";

export const DEFAULT_DAYS = { messages: 365, calls: 90 };

export default function ContactHistorySection({ clinicId, messageDays, callDays }: {
  clinicId: string; messageDays: number | null; callDays: number | null;
}) {
  const [defaults, setDefaults] = useState(DEFAULT_DAYS);
  const [f, setF] = useState({ messages: messageDays == null ? "" : String(messageDays), calls: callDays == null ? "" : String(callDays) });
  const [msg, setMsg] = useState("");
  useEffect(() => {
    supabase.from("platform_settings").select("key, value").in("key", ["message_retention_days", "call_record_retention_days"])
      .then(({ data }) => {
        const v = Object.fromEntries(((data ?? []) as { key: string; value: unknown }[]).map((r) => [r.key, Number(r.value)]));
        setDefaults({ messages: v.message_retention_days || DEFAULT_DAYS.messages, calls: v.call_record_retention_days || DEFAULT_DAYS.calls });
      });
  }, []);

  async function save() {
    const parse = (s: string) => (s.trim() === "" ? null : Number(s));
    const m = parse(f.messages), c = parse(f.calls);
    if (m !== null && (!Number.isInteger(m) || m < 30 || m > 3650)) { setMsg("Messages: whole days, 30 to 3650, or empty."); return; }
    if (c !== null && (!Number.isInteger(c) || c < 7 || c > 3650)) { setMsg("Calls: whole days, 7 to 3650, or empty."); return; }
    const { error } = await supabase.from("clinics").update({ message_retention_days: m, call_record_retention_days: c }).eq("id", clinicId);
    setMsg(error ? `Failed: ${error.message}` : "Saved. The nightly clean-up uses it from tonight.");
  }

  return (
    <div className="form-card" style={{ maxWidth: 640, marginTop: 20 }}>
      <h2 style={{ marginTop: 0 }}>Message history</h2>
      <p className="small muted">
        Every night CareCall deletes old chat and text messages, and blanks old call transcripts, summaries and
        recording links (the call's outcome stays). This is contact history, not the medical record: readings,
        medicine answers, appointments and notes follow Records retention.
      </p>
      <div className="row-actions">
        <span><label htmlFor="ret-msg">Keep messages (days)</label>
          <input id="ret-msg" inputMode="numeric" style={{ width: 120 }} placeholder={`${defaults.messages} (default)`}
                 value={f.messages} onChange={(e) => setF({ ...f, messages: e.target.value })} /></span>
        <span><label htmlFor="ret-call">Keep call transcripts and recordings (days)</label>
          <input id="ret-call" inputMode="numeric" style={{ width: 120 }} placeholder={`${defaults.calls} (default)`}
                 value={f.calls} onChange={(e) => setF({ ...f, calls: e.target.value })} /></span>
      </div>
      <div className="row-actions" style={{ marginTop: 8 }}><button className="secondary" onClick={save}>Save</button></div>
      {msg && <p role="status" className="small">{msg}</p>}
      <p className="small muted">Recordings stored at Telnyx are kept by Telnyx's own retention settings; set them there too.</p>
    </div>
  );
}
