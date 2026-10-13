// Clinic settings → Records retention: the period in effect, a per-clinic
// value (platform admins), open privacy requests, and patients whose records
// are past the period, for a clinic admin to review and, if appropriate,
// dispose of. Nothing is deleted automatically.
import { useCallback, useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { supabase } from "../lib/supabase";
import { useSession } from "../lib/session";
import { KIND_LABEL } from "./PrivacySection";

type Due = { patient_id: string; first_name: string; last_name: string; last_activity: string; retention_years: number };
type OpenRequest = { id: string; kind: keyof typeof KIND_LABEL; respond_by: string; patient_id: string;
  patients: { first_name: string; last_name: string } | null };
type Disposal = { id: string; disposed_at: string; last_activity: string | null; counts: Record<string, number> };

export const LEGAL_MIN_YEARS = 7;

export default function RetentionSection({ clinicId, clinicYears }: { clinicId: string; clinicYears: number | null }) {
  const { role } = useSession();
  const isAdmin = role === "admin";
  const [platformYears, setPlatformYears] = useState<number | null>(null);
  const [own, setOwn] = useState(clinicYears == null ? "" : String(clinicYears));
  const [due, setDue] = useState<Due[] | null>(null);
  const [open, setOpen] = useState<OpenRequest[]>([]);
  const [disposals, setDisposals] = useState<Disposal[]>([]);
  const [msg, setMsg] = useState("");

  const load = useCallback(async () => {
    const [{ data: s }, { data: d, error }, { data: o }, { data: x }] = await Promise.all([
      supabase.from("platform_settings").select("value").eq("key", "record_retention_years").maybeSingle(),
      supabase.rpc("records_due_for_review", { p_clinic: clinicId }),
      supabase.from("data_requests").select("id, kind, respond_by, patient_id, patients(first_name, last_name)")
        .eq("clinic_id", clinicId).eq("status", "received").order("respond_by"),
      supabase.from("record_disposals").select("id, disposed_at, last_activity, counts")
        .eq("clinic_id", clinicId).order("disposed_at", { ascending: false }).limit(10),
    ]);
    setOpen((o ?? []) as unknown as OpenRequest[]);
    setDisposals((x ?? []) as Disposal[]);
    setPlatformYears(s ? Number((s as { value: unknown }).value) : LEGAL_MIN_YEARS);
    setDue(error ? [] : (d as Due[]) ?? []);
  }, [clinicId]);
  useEffect(() => { load(); }, [load]);

  const inEffect = clinicYears ?? platformYears;

  async function saveOwn() {
    const n = own.trim() ? Number(own) : null;
    if (n !== null && (!Number.isInteger(n) || n < 1 || n > 100)) { setMsg("Enter whole years, 1 to 100, or leave empty."); return; }
    const { error } = await supabase.from("clinics").update({ record_retention_years: n }).eq("id", clinicId);
    setMsg(error ? `Failed: ${error.message}` : "Retention saved.");
    load();
  }

  return (
    <div className="form-card" style={{ maxWidth: 640, marginTop: 20 }}>
      <h2 style={{ marginTop: 0 }}>Records retention</h2>
      <p className="small">
        Patient records are kept <strong>{inEffect ?? "…"} years</strong> after the last consultation
        {clinicYears == null ? " (platform default)" : " (set for this clinic)"}.
      </p>
      <p className="small muted">
        The DOH records schedule (Department Circular 2021-0226) appears to set 7 years for outpatient records after the
        last consultation. Records past the period are listed here for review; nothing is deleted automatically.
      </p>
      {isAdmin && (
        <>
          <label htmlFor="ret-own">Years for this clinic (empty = platform default)</label>
          <div className="row-actions">
            <input id="ret-own" inputMode="numeric" style={{ width: 100 }} value={own} onChange={(e) => setOwn(e.target.value)} />
            <button className="secondary" onClick={saveOwn}>Save</button>
          </div>
          {own.trim() && Number(own) < LEGAL_MIN_YEARS && (
            <p className="small" role="alert">Shorter than 7 years: only if this clinic keeps its official records elsewhere.</p>
          )}
        </>
      )}
      {msg && <p role="status" className="small">{msg}</p>}

      <h3>Privacy requests to answer</h3>
      {!open.length ? <p className="small muted">None open. Requests are logged on the patient's page.</p> : (
        <table>
          <thead><tr><th>Patient</th><th>Request</th><th>Answer by</th></tr></thead>
          <tbody>
            {open.map((r) => (
              <tr key={r.id}>
                <td><Link to={`/patients/${r.patient_id}`}>{r.patients ? `${r.patients.first_name} ${r.patients.last_name}` : "Patient"}</Link></td>
                <td>{KIND_LABEL[r.kind]}</td>
                <td className={r.respond_by < new Date().toLocaleDateString("en-CA") ? "" : "muted"}>
                  {new Date(`${r.respond_by}T00:00`).toLocaleDateString()}
                  {r.respond_by < new Date().toLocaleDateString("en-CA") && <strong> (overdue)</strong>}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      <h3>Due for review</h3>
      {due === null ? <p className="small muted">Loading…</p> : !due.length ? (
        <p className="small muted">No records are past the retention period.</p>
      ) : (
        <table>
          <thead><tr><th>Patient</th><th>Last activity</th><th></th></tr></thead>
          <tbody>
            {due.map((d) => (
              <tr key={d.patient_id}>
                <td><Link to={`/patients/${d.patient_id}`}>{d.first_name} {d.last_name}</Link></td>
                <td>{new Date(d.last_activity).toLocaleDateString()}</td>
                <td><DisposeButton due={d} onDone={(t) => { setMsg(t); load(); }} /></td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      {disposals.length > 0 && (
        <>
          <h3>Disposed records</h3>
          <p className="small muted">Kept without personal data, as the record of disposal.</p>
          <table>
            <thead><tr><th>Disposed</th><th>Last activity</th><th>What was deleted</th></tr></thead>
            <tbody>
              {disposals.map((x) => (
                <tr key={x.id}>
                  <td>{new Date(x.disposed_at).toLocaleDateString()}</td>
                  <td>{x.last_activity ? new Date(x.last_activity).toLocaleDateString() : "—"}</td>
                  <td className="small">{Object.entries(x.counts).filter(([, n]) => n > 0).map(([k, n]) => `${n} ${k.replace(/_/g, " ")}`).join(", ") || "patient details only"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </>
      )}
    </div>
  );
}

/** Dispose of a record past its retention period: typed confirmation, one database transaction. */
function DisposeButton({ due, onDone }: { due: Due; onDone: (msg: string) => void }) {
  const [asking, setAsking] = useState(false);
  const [name, setName] = useState("");
  const [note, setNote] = useState("");
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);
  async function dispose() {
    setBusy(true); setErr("");
    const { error } = await supabase.rpc("dispose_patient_record", { p_patient: due.patient_id, p_confirm_last_name: name, p_note: note });
    setBusy(false);
    if (error) { setErr(error.message); return; }
    onDone(`${due.first_name} ${due.last_name}'s record was disposed of. A disposal record without personal data is kept.`);
  }
  if (!asking) return <button className="link" onClick={() => setAsking(true)}>Dispose…</button>;
  return (
    <div className="small" style={{ minWidth: 260 }}>
      <p style={{ marginTop: 0 }}>Deletes the whole record (details, visits, notes, medicines, readings, messages) and
        blanks the patient's data in the audit log. Can't be undone. Check no law, claim or ongoing care needs it.</p>
      <label htmlFor={`disp-${due.patient_id}`}>Type the patient's last name</label>
      <input id={`disp-${due.patient_id}`} value={name} onChange={(e) => setName(e.target.value)} />
      <label htmlFor={`disp-note-${due.patient_id}`}>Note (optional, no names)</label>
      <input id={`disp-note-${due.patient_id}`} value={note} placeholder="Reviewed by the DPO" onChange={(e) => setNote(e.target.value)} />
      <div className="row-actions" style={{ marginTop: 6 }}>
        <button className="danger" disabled={busy || !name.trim()} onClick={dispose}>Dispose of record</button>
        <button className="link" onClick={() => setAsking(false)}>Cancel</button>
      </div>
      {err && <p role="alert">{err}</p>}
    </div>
  );
}
