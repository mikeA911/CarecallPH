// Pilot dashboard (top of the Dashboard): the numbers the pilot is judged on.
// Counts come from pilot_dashboard() in the database (clinic-scoped, counts
// only); the care section is filled for nurses, doctors and admins only.
// Front desk marks past appointments Came or No-show here, which is what the
// no-show rate is computed from.
import { useCallback, useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { supabase } from "../lib/supabase";
import { roleAtLeast, useSession } from "../lib/session";
import { useClinic } from "../lib/clinic";

type Pilot = {
  days: number; clinical: boolean; baseline_no_show_pct: number | null;
  today: {
    appointments: number; confirmed: number; not_confirmed: number; to_mark: number; action_items: number;
    readings_to_review: number | null; critical_to_review: number | null;
  };
  period: {
    signups: number; new_patients: number; chat_connected: number; chat_total: number; patients_total: number;
    booked: number; booked_by_source: Record<string, number>; reminders_sent: number;
    replies: { confirm: number; reschedule: number; cancel: number };
    came: number; no_show: number; no_show_pct: number | null; no_show_pct_prev: number | null;
  };
  care: {
    doses_taken: number; doses_skipped: number; doses_missed: number; readings_requested: number; readings_answered: number;
    readings_out_of_range: number; readings_critical: number; plans_running: number; notes_signed: number; doctors_signing: number;
  } | null;
};

type ToMark = { id: string; starts_at: string; providers: { name: string } | null; patients: { first_name: string; last_name: string } | null };

const SOURCE: Record<string, string> = {
  staff: "staff", symptom_check: "symptom check", booking_link: "booking link", voice: "AI call", chat: "chat", other: "other",
};
const pct = (n: number, d: number) => (d > 0 ? `${Math.round((100 * n) / d)}%` : "—");

function Tile({ num, label, sub, to, alert }: { num: string | number; label: string; sub?: string; to?: string; alert?: boolean }) {
  const body = (
    <>
      <div className="num" style={alert ? { color: "var(--indigo, #4338CA)" } : undefined}>{num}</div>
      <div className="lbl">{label}</div>
      {sub && <div className="small muted" style={{ marginTop: 4 }}>{sub}</div>}
    </>
  );
  return to ? <Link to={to} className="card card-link">{body}</Link> : <div className="card">{body}</div>;
}

export default function PilotDashboard() {
  const { role } = useSession();
  const { activeClinicId, activeClinic } = useClinic();
  const isClinicAdmin = roleAtLeast(role, "clinic_admin");
  const [days, setDays] = useState<7 | 30>(7);
  const [d, setD] = useState<Pilot | null>(null);
  const [err, setErr] = useState("");
  const [toMark, setToMark] = useState<ToMark[]>([]);
  const [showMark, setShowMark] = useState(false);
  const [editBaseline, setEditBaseline] = useState(false);
  const [baseline, setBaseline] = useState("");

  const load = useCallback(async () => {
    if (!activeClinicId) return;
    const { data, error } = await supabase.rpc("pilot_dashboard", { p_clinic: activeClinicId, p_days: days });
    if (error) { setErr(`Couldn't load the pilot numbers: ${error.message}`); return; }
    setErr(""); setD(data as Pilot);
  }, [activeClinicId, days]);
  useEffect(() => { load(); }, [load]);

  const loadToMark = useCallback(async () => {
    if (!activeClinicId) return;
    const since = new Date(Date.now() - 14 * 864e5).toISOString();
    const { data } = await supabase.from("appointments")
      .select("id, starts_at, providers!inner(name, clinic_id), patients(first_name, last_name)")
      .eq("providers.clinic_id", activeClinicId).in("status", ["booked", "confirmed"])
      .lt("starts_at", new Date().toISOString()).gte("starts_at", since).order("starts_at").limit(50);
    setToMark((data ?? []) as unknown as ToMark[]);
  }, [activeClinicId]);
  useEffect(() => { if (showMark) loadToMark(); }, [showMark, loadToMark]);

  async function mark(id: string, status: "completed" | "no_show") {
    const { error } = await supabase.from("appointments").update({ status }).eq("id", id);
    if (error) { setErr(`Couldn't save: ${error.message}`); return; }
    setToMark((rows) => rows.filter((r) => r.id !== id));
    load();
  }

  async function saveBaseline() {
    const n = baseline.trim() === "" ? null : Number(baseline);
    if (n !== null && (!Number.isFinite(n) || n < 0 || n > 100)) { setErr("Baseline: a percentage from 0 to 100."); return; }
    const { error } = await supabase.from("clinics").update({ baseline_no_show_pct: n }).eq("id", activeClinicId!);
    if (error) { setErr(`Couldn't save the baseline: ${error.message}`); return; }
    setEditBaseline(false); load();
  }

  if (!activeClinicId) return null;
  if (err && !d) return <p className="small" role="alert">{err}</p>;
  if (!d) return <p className="small muted">Loading pilot numbers…</p>;

  const t = d.today, p = d.period, c = d.care;
  const tz = activeClinic?.timezone || "Asia/Manila";
  const fmt = (iso: string) => new Date(iso).toLocaleString([], { timeZone: tz, weekday: "short", month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
  const vs = (now: number | null, then: number | null, label: string) =>
    now === null || then === null ? null : `${now <= then ? "▼" : "▲"} ${Math.abs(Math.round((now - then) * 10) / 10)} pts vs ${label}`;
  const noShowSub = [
    `${p.no_show} no-shows of ${p.came + p.no_show} visits marked`,
    vs(p.no_show_pct, d.baseline_no_show_pct, `baseline ${d.baseline_no_show_pct}%`),
    vs(p.no_show_pct, p.no_show_pct_prev, "previous period"),
  ].filter(Boolean).join(" · ");
  const sources = Object.entries(p.booked_by_source).sort((a, b) => b[1] - a[1])
    .map(([k, n]) => `${n} ${SOURCE[k] ?? k}`).join(", ");
  const doses = c ? c.doses_taken + c.doses_skipped + c.doses_missed : 0;
  const perDoctorWeek = c && c.doctors_signing > 0 ? (c.notes_signed / c.doctors_signing / (d.days / 7)).toFixed(1) : "—";

  return (
    <section className="pilot-dash">
      <div className="row-actions" style={{ justifyContent: "space-between", alignItems: "baseline", marginBottom: 8 }}>
        <h2 style={{ margin: 0 }}>Today</h2>
      </div>
      <div className="cards">
        <Tile num={t.appointments} label="Appointments today" sub={`${t.confirmed} confirmed by the patient`} />
        <Tile num={t.not_confirmed} label="Still to come, not confirmed" sub="Booked, no reply to the reminder yet" />
        <button type="button" className="card card-link" style={{ textAlign: "left", font: "inherit", cursor: "pointer" }}
          onClick={() => setShowMark((v) => !v)} aria-expanded={showMark}>
          <div className="num" style={t.to_mark ? { color: "var(--indigo, #4338CA)" } : undefined}>{t.to_mark}</div>
          <div className="lbl">Past visits to mark</div>
          <div className="small muted" style={{ marginTop: 4 }}>Came or no-show, last 14 days</div>
        </button>
        <Tile num={t.action_items} label="CC action items" sub="Open" to="/cc" />
        {d.clinical && (
          <Tile num={t.readings_to_review ?? 0} label="Readings to review" to="/readings" alert={!!t.critical_to_review}
            sub={t.critical_to_review ? `${t.critical_to_review} critical` : "None critical"} />
        )}
      </div>

      {showMark && (
        <div className="form-card" style={{ marginTop: 12 }}>
          <strong>Past visits to mark</strong>
          <p className="small muted" style={{ margin: "4px 0 8px" }}>
            Mark each past appointment so the no-show rate is right. Every change is logged.
          </p>
          <table>
            <tbody>
              {toMark.map((r) => (
                <tr key={r.id}>
                  <td className="small">{fmt(r.starts_at)}</td>
                  <td>{r.patients ? `${r.patients.first_name} ${r.patients.last_name}` : "Patient"}</td>
                  <td className="small muted">{r.providers?.name ?? ""}</td>
                  <td className="row-actions">
                    <button className="secondary" onClick={() => mark(r.id, "completed")}>Came</button>
                    <button className="secondary" onClick={() => mark(r.id, "no_show")}>No-show</button>
                  </td>
                </tr>
              ))}
              {!toMark.length && <tr><td className="empty">Nothing to mark.</td></tr>}
            </tbody>
          </table>
        </div>
      )}

      <div className="row-actions" style={{ justifyContent: "space-between", alignItems: "baseline", margin: "20px 0 8px" }}>
        <h2 style={{ margin: 0 }}>Pilot results</h2>
        <select aria-label="Period" value={days} onChange={(e) => setDays(Number(e.target.value) as 7 | 30)} style={{ width: "auto" }}>
          <option value={7}>Last 7 days</option>
          <option value={30}>Last 30 days</option>
        </select>
      </div>
      <div className="cards">
        <Tile num={p.no_show_pct === null ? "—" : `${p.no_show_pct}%`} label="No-show rate" sub={noShowSub} />
        <Tile num={p.signups} label="Self sign-ups" sub={`${p.new_patients} new patients in all`} to="/patients" />
        <Tile num={p.chat_connected} label="Connected to chat" sub={`${p.chat_total} of ${p.patients_total} patients on chat (${pct(p.chat_total, p.patients_total)})`} />
        <Tile num={p.booked} label="Appointments booked" sub={sources || "None yet"} />
        <Tile num={p.reminders_sent} label="Reminders sent"
          sub={`Replies: ${p.replies.confirm} confirmed, ${p.replies.reschedule} moved, ${p.replies.cancel} cancelled`} />
      </div>

      {c && (
        <>
          <h3 style={{ margin: "16px 0 8px" }}>Care plans and notes</h3>
          <div className="cards">
            <Tile num={pct(c.doses_taken, doses)} label="Medicine adherence" sub={`${c.doses_taken} of ${doses} doses taken`} />
            <Tile num={pct(c.readings_answered, c.readings_requested)} label="Readings sent back" sub={`${c.readings_answered} of ${c.readings_requested} requests`} />
            <Tile num={c.readings_out_of_range + c.readings_critical} label="Readings outside target" sub={`${c.readings_critical} critical`} alert={c.readings_critical > 0} />
            <Tile num={c.plans_running} label="Monitoring plans running" />
            <Tile num={c.notes_signed} label="Notes signed" sub={`${perDoctorWeek} per doctor per week`} />
          </div>
        </>
      )}

      <p className="small muted" style={{ marginTop: 10 }}>
        Baseline no-show rate before the pilot: <strong>{d.baseline_no_show_pct === null ? "not set" : `${d.baseline_no_show_pct}%`}</strong>
        {isClinicAdmin && !editBaseline && (
          <> · <button className="link" onClick={() => { setBaseline(d.baseline_no_show_pct?.toString() ?? ""); setEditBaseline(true); }}>Change</button></>
        )}
        {editBaseline && (
          <span className="row-actions" style={{ display: "inline-flex", marginLeft: 8 }}>
            <input aria-label="Baseline no-show rate in percent" value={baseline} onChange={(e) => setBaseline(e.target.value)}
              style={{ width: 80 }} inputMode="decimal" placeholder="e.g. 25" />
            <button onClick={saveBaseline}>Save</button>
            <button className="link" onClick={() => setEditBaseline(false)}>Cancel</button>
          </span>
        )}
      </p>
      {err && <p className="small" role="alert">{err}</p>}
    </section>
  );
}
