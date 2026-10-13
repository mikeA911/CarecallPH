// Clinic settings → Holidays and closures: which national holidays close the
// clinic, and its own closed days. Closed days get no booking slots (booking
// links, chat, symptom check, dashboard). The holiday list is kept by platform
// admins (Global settings).
import { useCallback, useEffect, useState } from "react";
import { supabase } from "../lib/supabase";
import { useSession } from "../lib/session";

type Holiday = { date: string; name: string; kind: "regular" | "special" };
type Closure = { id: string; date: string; reason: string | null };
type Mode = "all" | "regular" | "none";

const MODE_LABEL: Record<Mode, string> = {
  all: "Closed on regular holidays and special non-working days",
  regular: "Closed on regular holidays only (open on special non-working days)",
  none: "Open on holidays (use closed days below)",
};
const today = () => new Date().toLocaleDateString("en-CA");
const fmt = (d: string) => new Date(`${d}T00:00`).toLocaleDateString(undefined, { weekday: "short", month: "short", day: "numeric", year: "numeric" });

export function closesOn(mode: Mode, h: Holiday): boolean {
  return mode === "all" || (mode === "regular" && h.kind === "regular");
}

export default function HolidaysSection({ clinicId, mode: initial, onSaved }: {
  clinicId: string; mode: Mode; onSaved: (mode: Mode) => void;
}) {
  const { session } = useSession();
  const [mode, setMode] = useState<Mode>(initial);
  const [holidays, setHolidays] = useState<Holiday[]>([]);
  const [closures, setClosures] = useState<Closure[]>([]);
  const [form, setForm] = useState({ date: "", reason: "" });
  const [msg, setMsg] = useState("");

  const load = useCallback(async () => {
    const until = new Date(); until.setFullYear(until.getFullYear() + 1);
    const [{ data: h }, { data: c }] = await Promise.all([
      supabase.from("holidays").select("date, name, kind").gte("date", today()).lte("date", until.toLocaleDateString("en-CA")).order("date"),
      supabase.from("clinic_closures").select("id, date, reason").eq("clinic_id", clinicId).gte("date", today()).order("date"),
    ]);
    setHolidays((h ?? []) as Holiday[]);
    setClosures((c ?? []) as Closure[]);
  }, [clinicId]);
  useEffect(() => { load(); }, [load]);

  async function saveMode(m: Mode) {
    setMode(m);
    const { error } = await supabase.from("clinics").update({ holiday_closures: m }).eq("id", clinicId);
    setMsg(error ? `Failed: ${error.message}` : "Saved. Booking slots follow this from now on.");
    if (!error) onSaved(m);
  }
  async function addClosure() {
    if (!form.date || form.date < today()) { setMsg("Pick a date from today on."); return; }
    const { error } = await supabase.from("clinic_closures").insert({
      clinic_id: clinicId, date: form.date, reason: form.reason.trim() || null, created_by: session?.user?.id ?? null,
    });
    setMsg(error ? (error.code === "23505" ? "That day is already closed." : `Failed: ${error.message}`)
      : "Closed day added. Patients can't book it; existing appointments stay, so move or cancel them.");
    if (!error) setForm({ date: "", reason: "" });
    load();
  }
  async function removeClosure(c: Closure) {
    await supabase.from("clinic_closures").delete().eq("id", c.id);
    load();
  }

  return (
    <div className="form-card" style={{ maxWidth: 640, marginTop: 20 }}>
      <h2 style={{ marginTop: 0 }}>Holidays and closures</h2>
      <p className="small muted">Closed days have no booking slots: booking links, chat, the symptom check and the dashboard.
        Appointments already booked on those days stay; move or cancel them.</p>
      <label htmlFor="hol-mode">National holidays</label>
      <select id="hol-mode" value={mode} onChange={(e) => saveMode(e.target.value as Mode)}>
        {(Object.keys(MODE_LABEL) as Mode[]).map((m) => <option key={m} value={m}>{MODE_LABEL[m]}</option>)}
      </select>
      {msg && <p role="status" className="small">{msg}</p>}

      <h3>Coming holidays</h3>
      {!holidays.length ? <p className="small muted">No holidays listed for the next 12 months. A platform admin keeps the list.</p> : (
        <table>
          <thead><tr><th>Date</th><th>Holiday</th><th>This clinic</th></tr></thead>
          <tbody>
            {holidays.map((h) => (
              <tr key={h.date}>
                <td className="small">{fmt(h.date)}</td>
                <td>{h.name}<div className="small muted">{h.kind === "regular" ? "Regular holiday" : "Special non-working day"}</div></td>
                <td>{closesOn(mode, h) ? <strong>Closed</strong> : "Open"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      <h3>Other closed days</h3>
      {closures.length > 0 && (
        <table>
          <tbody>
            {closures.map((c) => (
              <tr key={c.id}>
                <td className="small">{fmt(c.date)}</td><td>{c.reason ?? ""}</td>
                <td><button className="link" onClick={() => removeClosure(c)}>Remove</button></td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      <div className="row-actions" style={{ marginTop: 6 }}>
        <span><label htmlFor="cl-date">Date</label>
          <input id="cl-date" type="date" min={today()} value={form.date} onChange={(e) => setForm({ ...form, date: e.target.value })} /></span>
        <span style={{ flex: 1 }}><label htmlFor="cl-reason">Reason (optional)</label>
          <input id="cl-reason" placeholder="Town fiesta, staff training…" value={form.reason} onChange={(e) => setForm({ ...form, reason: e.target.value })} /></span>
      </div>
      <div className="row-actions" style={{ marginTop: 8 }}>
        <button className="secondary" onClick={addClosure}>Add closed day</button>
      </div>
    </div>
  );
}
