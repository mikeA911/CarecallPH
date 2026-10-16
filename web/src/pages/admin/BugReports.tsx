// Bug reports (platform admins): problems pilot users filed through CC.
// Newest first, open ones on top; mark each seen, fixed or won't fix with a
// note the reporter sees when they ask CC. Reports never hold patient data.
import { Fragment, useCallback, useEffect, useState } from "react";
import { supabase } from "../../lib/supabase";
import { useClinic } from "../../lib/clinic";

type Status = "new" | "seen" | "fixed" | "wont_fix";
type Report = {
  id: number; created_at: string; clinic_id: string | null; reporter_email: string | null; route: string | null;
  summary: string; what_happened: string; expected: string | null; steps: string | null;
  severity: "blocker" | "problem" | "annoyance"; status: Status; admin_note: string | null;
};

const STATUS_LABEL: Record<Status, string> = { new: "New", seen: "Seen", fixed: "Fixed", wont_fix: "Won't fix" };
const SEVERITY_BADGE: Record<Report["severity"], string> = { blocker: "verification_failed", problem: "pending", annoyance: "" };
const SEVERITY_RANK = { blocker: 0, problem: 1, annoyance: 2 };

export default function BugReports() {
  const { clinics } = useClinic();
  const [rows, setRows] = useState<Report[]>([]);
  const [filter, setFilter] = useState<"open" | "all">("open");
  const [openId, setOpenId] = useState<number | null>(null);
  const [loaded, setLoaded] = useState(false);

  const load = useCallback(async () => {
    let q = supabase.from("bug_reports").select("*").order("created_at", { ascending: false }).limit(300);
    if (filter === "open") q = q.in("status", ["new", "seen"]);
    const { data } = await q;
    setRows(((data ?? []) as Report[]).sort((a, b) =>
      Number(b.status === "new") - Number(a.status === "new") || SEVERITY_RANK[a.severity] - SEVERITY_RANK[b.severity]));
    setLoaded(true);
  }, [filter]);
  useEffect(() => { load(); }, [load]);

  const clinicName = (id: string | null) => clinics.find((c) => c.id === id)?.name ?? (id ? "Clinic" : "—");
  const counts = rows.reduce((m, r) => ({ ...m, [r.status]: (m[r.status] ?? 0) + 1 }), {} as Record<string, number>);

  return (
    <>
      <h1>Bug reports</h1>
      <p className="muted small">
        Problems users reported through CC, with the screen they were on. Newest first, new ones on top.
        Your note is what the reporter sees when they ask CC about their report.
      </p>
      <div className="row-actions" style={{ marginBottom: 12 }}>
        <select aria-label="Show" value={filter} onChange={(e) => setFilter(e.target.value as "open" | "all")} style={{ width: "auto" }}>
          <option value="open">New and seen</option>
          <option value="all">All</option>
        </select>
        <span className="small muted">{counts.new ?? 0} new · {counts.seen ?? 0} seen</span>
      </div>
      <table>
        <thead><tr><th>#</th><th>Reported</th><th>Problem</th><th>Where</th><th>Status</th></tr></thead>
        <tbody>
          {rows.map((r) => (
            <Fragment key={r.id}>
              <tr>
                <td>{r.id}</td>
                <td className="small">{new Date(r.created_at).toLocaleString([], { dateStyle: "medium", timeStyle: "short" })}
                  <div className="muted">{r.reporter_email ?? "—"}</div></td>
                <td>
                  <button className="link" onClick={() => setOpenId(openId === r.id ? null : r.id)} aria-expanded={openId === r.id}>{r.summary}</button>
                  <div><span className={`badge ${SEVERITY_BADGE[r.severity]}`}>{r.severity}</span></div>
                </td>
                <td className="small">{clinicName(r.clinic_id)}<div className="muted"><code>{r.route ?? "—"}</code></div></td>
                <td>{STATUS_LABEL[r.status]}</td>
              </tr>
              {openId === r.id && (
                <tr><td colSpan={5}><Detail report={r} onSaved={load} /></td></tr>
              )}
            </Fragment>
          ))}
          {loaded && !rows.length && <tr><td colSpan={5} className="empty">No bug reports{filter === "open" ? " waiting" : ""}.</td></tr>}
        </tbody>
      </table>
    </>
  );
}

function Detail({ report, onSaved }: { report: Report; onSaved: () => void }) {
  const [status, setStatus] = useState<Status>(report.status === "new" ? "seen" : report.status);
  const [note, setNote] = useState(report.admin_note ?? "");
  const [msg, setMsg] = useState("");

  async function save() {
    const { error } = await supabase.from("bug_reports")
      .update({ status, admin_note: note.trim() || null }).eq("id", report.id);
    setMsg(error ? `Couldn't save: ${error.message}` : "Saved.");
    if (!error) onSaved();
  }

  return (
    <div className="form-card" style={{ margin: "4px 0 8px" }}>
      <div className="kv"><span>What happened</span><strong style={{ whiteSpace: "pre-wrap" }}>{report.what_happened}</strong></div>
      {report.expected && <div className="kv"><span>Expected</span><strong style={{ whiteSpace: "pre-wrap" }}>{report.expected}</strong></div>}
      {report.steps && <div className="kv"><span>Steps</span><strong style={{ whiteSpace: "pre-wrap" }}>{report.steps}</strong></div>}
      <div className="row-actions" style={{ marginTop: 10, alignItems: "flex-end" }}>
        <span><label htmlFor={`st-${report.id}`}>Status</label>
          <select id={`st-${report.id}`} value={status} onChange={(e) => setStatus(e.target.value as Status)}>
            {(Object.keys(STATUS_LABEL) as Status[]).map((s) => <option key={s} value={s}>{STATUS_LABEL[s]}</option>)}
          </select></span>
        <span style={{ flex: 1 }}><label htmlFor={`nt-${report.id}`}>Note for the reporter</label>
          <input id={`nt-${report.id}`} value={note} maxLength={1000} placeholder="e.g. Fixed in today's update"
                 onChange={(e) => setNote(e.target.value)} /></span>
        <button onClick={save}>Save</button>
      </div>
      {msg && <p className="small" role="status">{msg}</p>}
    </div>
  );
}
