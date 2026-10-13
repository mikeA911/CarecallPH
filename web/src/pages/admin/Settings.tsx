import { useEffect, useState } from "react";
import { MULTI_CLINIC_ENABLED } from "../../lib/config";
import { supabase } from "../../lib/supabase";
import { LEGAL_MIN_YEARS } from "../../components/RetentionSection";
import { DEFAULT_DAYS } from "../../components/ContactHistorySection";

type Holiday = { date: string; name: string; kind: "regular" | "special" };

export default function AdminSettings() {
  const [years, setYears] = useState("");
  const [msg, setMsg] = useState("");
  useEffect(() => {
    supabase.from("platform_settings").select("value").eq("key", "record_retention_years").maybeSingle()
      .then(({ data }) => setYears(String(data ? (data as { value: unknown }).value : LEGAL_MIN_YEARS)));
  }, []);

  async function saveYears() {
    const n = Number(years);
    if (!Number.isInteger(n) || n < 1 || n > 100) { setMsg("Enter whole years, 1 to 100."); return; }
    const { error } = await supabase.from("platform_settings")
      .upsert({ key: "record_retention_years", value: n, updated_at: new Date().toISOString() });
    setMsg(error ? `Failed: ${error.message}` : "Saved.");
  }

  return (
    <>
      <h1>Global settings</h1>
      <p className="muted">Platform-wide defaults and feature flags applied to new clinics.</p>

      <div className="form-card" style={{ maxWidth: 640 }}>
        <h2 style={{ marginTop: 0 }}>Feature flags</h2>
        <div className="kv">
          <span>Multi-clinic switcher</span>
          <strong>{MULTI_CLINIC_ENABLED ? "enabled" : "stubbed (single clinic)"}</strong>
        </div>
        <p className="muted small">
          D2: the schema is multi-clinic from day one. Set <code>VITE_MULTI_CLINIC=true</code> and
          seed additional clinics to enable the switcher. No schema change is required.
        </p>

        <h2>Records retention</h2>
        <label htmlFor="ret-years">Keep patient records for (years after the last consultation)</label>
        <div className="row-actions">
          <input id="ret-years" inputMode="numeric" style={{ width: 100 }} value={years} onChange={(e) => setYears(e.target.value)} />
          <button className="secondary" onClick={saveYears}>Save</button>
        </div>
        {years && Number(years) < LEGAL_MIN_YEARS && (
          <p className="small" role="alert">The DOH schedule appears to require 7 years for outpatient records.</p>
        )}
        {msg && <p role="status" className="small">{msg}</p>}
        <p className="muted small">
          Applies to every clinic unless set per clinic (Clinic settings). Records past the period are listed for the
          clinic admin to review; nothing is deleted automatically.
        </p>

        <h2>Message history</h2>
        <HistoryDefaults />

        <h2>Holidays</h2>
        <HolidayList />

        <h2>New-clinic defaults</h2>
        <div className="kv"><span>Default timezone</span><strong>Asia/Manila</strong></div>
        <div className="kv"><span>Default calling hours</span><strong>08:00–18:00 Mon–Fri, 08:00–12:00 Sat</strong></div>
        <div className="kv"><span>SMS fallback</span><strong>on</strong></div>
        <p className="muted small">
          Defaults are applied by the <code>create_clinic</code> action and can be adjusted per clinic
          under Clinic settings.
        </p>
      </div>
    </>
  );
}

/** Platform defaults for the nightly purge of messages and call records. */
function HistoryDefaults() {
  const [f, setF] = useState({ messages: String(DEFAULT_DAYS.messages), calls: String(DEFAULT_DAYS.calls) });
  const [msg, setMsg] = useState("");
  useEffect(() => {
    supabase.from("platform_settings").select("key, value").in("key", ["message_retention_days", "call_record_retention_days"])
      .then(({ data }) => {
        const v = Object.fromEntries(((data ?? []) as { key: string; value: unknown }[]).map((r) => [r.key, String(r.value)]));
        setF({ messages: v.message_retention_days ?? String(DEFAULT_DAYS.messages), calls: v.call_record_retention_days ?? String(DEFAULT_DAYS.calls) });
      });
  }, []);
  async function save() {
    const m = Number(f.messages), c = Number(f.calls);
    if (!Number.isInteger(m) || m < 30 || m > 3650 || !Number.isInteger(c) || c < 7 || c > 3650) {
      setMsg("Messages: 30 to 3650 days; calls: 7 to 3650 days."); return;
    }
    const now = new Date().toISOString();
    const { error } = await supabase.from("platform_settings").upsert([
      { key: "message_retention_days", value: m, updated_at: now },
      { key: "call_record_retention_days", value: c, updated_at: now },
    ]);
    setMsg(error ? `Failed: ${error.message}` : "Saved.");
  }
  return (
    <>
      <div className="row-actions">
        <span><label htmlFor="def-msg">Keep messages (days)</label>
          <input id="def-msg" inputMode="numeric" style={{ width: 100 }} value={f.messages} onChange={(e) => setF({ ...f, messages: e.target.value })} /></span>
        <span><label htmlFor="def-call">Keep call transcripts and recordings (days)</label>
          <input id="def-call" inputMode="numeric" style={{ width: 100 }} value={f.calls} onChange={(e) => setF({ ...f, calls: e.target.value })} /></span>
      </div>
      <div className="row-actions" style={{ marginTop: 6 }}><button className="secondary" onClick={save}>Save</button></div>
      {msg && <p role="status" className="small">{msg}</p>}
      <p className="muted small">Deleted every night at 3:45 AM Manila. Clinics can set their own periods in Clinic settings.</p>
    </>
  );
}

/** The national holiday list every clinic's booking follows (per its own setting). */
function HolidayList() {
  const [list, setList] = useState<Holiday[]>([]);
  const [f, setF] = useState<Holiday>({ date: "", name: "", kind: "regular" });
  const [msg, setMsg] = useState("");
  const load = () => supabase.from("holidays").select("date, name, kind")
    .gte("date", new Date().toLocaleDateString("en-CA")).order("date").then(({ data }) => setList((data ?? []) as Holiday[]));
  useEffect(() => { load(); }, []);
  async function add() {
    if (!f.date || !f.name.trim()) { setMsg("Enter the date and name."); return; }
    const { error } = await supabase.from("holidays").upsert({ ...f, name: f.name.trim(), updated_at: new Date().toISOString() });
    setMsg(error ? `Failed: ${error.message}` : "Saved.");
    if (!error) setF({ date: "", name: "", kind: "regular" });
    load();
  }
  async function remove(h: Holiday) {
    if (!confirm(`Remove ${h.name}?`)) return;
    await supabase.from("holidays").delete().eq("date", h.date);
    load();
  }
  return (
    <>
      <p className="muted small">Check this list against each year's Malacañang proclamation, and add Eid'l Fitr, Eid'l Adha and any
        declared holidays when they are announced. Clinics choose which kinds close them.</p>
      <table>
        <thead><tr><th>Date</th><th>Holiday</th><th>Kind</th><th></th></tr></thead>
        <tbody>
          {list.map((h) => (
            <tr key={h.date}>
              <td className="small">{new Date(`${h.date}T00:00`).toLocaleDateString()}</td><td>{h.name}</td>
              <td className="small">{h.kind === "regular" ? "Regular" : "Special non-working"}</td>
              <td><button className="link" onClick={() => remove(h)}>Remove</button></td>
            </tr>
          ))}
          {!list.length && <tr><td colSpan={4} className="empty">No coming holidays listed.</td></tr>}
        </tbody>
      </table>
      <div className="row-actions" style={{ marginTop: 6 }}>
        <span><label htmlFor="h-date">Date</label>
          <input id="h-date" type="date" value={f.date} onChange={(e) => setF({ ...f, date: e.target.value })} /></span>
        <span style={{ flex: 1 }}><label htmlFor="h-name">Name</label>
          <input id="h-name" value={f.name} placeholder="Eid'l Fitr" onChange={(e) => setF({ ...f, name: e.target.value })} /></span>
        <span><label htmlFor="h-kind">Kind</label>
          <select id="h-kind" value={f.kind} onChange={(e) => setF({ ...f, kind: e.target.value as Holiday["kind"] })}>
            <option value="regular">Regular holiday</option><option value="special">Special non-working day</option>
          </select></span>
      </div>
      <div className="row-actions" style={{ marginTop: 6 }}><button className="secondary" onClick={add}>Add or update holiday</button></div>
      {msg && <p role="status" className="small">{msg}</p>}
    </>
  );
}
