// Clinic settings → Records retention: the period in effect, a per-clinic
// value (platform admins), and patients whose records are past the period,
// for a clinic admin to review. Nothing is deleted automatically.
import { useCallback, useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { supabase } from "../lib/supabase";
import { useSession } from "../lib/session";

type Due = { patient_id: string; first_name: string; last_name: string; last_activity: string; retention_years: number };

export const LEGAL_MIN_YEARS = 7;

export default function RetentionSection({ clinicId, clinicYears }: { clinicId: string; clinicYears: number | null }) {
  const { role } = useSession();
  const isAdmin = role === "admin";
  const [platformYears, setPlatformYears] = useState<number | null>(null);
  const [own, setOwn] = useState(clinicYears == null ? "" : String(clinicYears));
  const [due, setDue] = useState<Due[] | null>(null);
  const [msg, setMsg] = useState("");

  const load = useCallback(async () => {
    const [{ data: s }, { data: d, error }] = await Promise.all([
      supabase.from("platform_settings").select("value").eq("key", "record_retention_years").maybeSingle(),
      supabase.rpc("records_due_for_review", { p_clinic: clinicId }),
    ]);
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

      <h3>Due for review</h3>
      {due === null ? <p className="small muted">Loading…</p> : !due.length ? (
        <p className="small muted">No records are past the retention period.</p>
      ) : (
        <table>
          <thead><tr><th>Patient</th><th>Last activity</th></tr></thead>
          <tbody>
            {due.map((d) => (
              <tr key={d.patient_id}>
                <td><Link to={`/patients/${d.patient_id}`}>{d.first_name} {d.last_name}</Link></td>
                <td>{new Date(d.last_activity).toLocaleDateString()}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}
