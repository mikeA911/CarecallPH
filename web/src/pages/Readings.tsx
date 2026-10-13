// Readings to review (care plans M3): vital-sign readings outside the
// doctor's target or at a critical limit, not yet reviewed, across the
// clinic. Nurses and doctors only (the database enforces it too). Critical
// first, then newest. Design: docs/care-plan-design.md §4a.
import { useCallback, useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { supabase } from "../lib/supabase";
import { canManageCare, useSession } from "../lib/session";
import { useClinic } from "../lib/clinic";
import { MEASURE_INFO, formatValue } from "../lib/vitals";
import { FlagBadge, ReviewButton, type Reading } from "../components/VitalSignsSection";

type Row = Reading & { patients: { first_name: string; last_name: string } | null };

export default function Readings() {
  const { clinicalRole } = useSession();
  const { activeClinicId } = useClinic();
  const [rows, setRows] = useState<Row[]>([]);
  const [loaded, setLoaded] = useState(false);

  const load = useCallback(async () => {
    if (!activeClinicId) return;
    const { data } = await supabase.from("vital_readings")
      .select("id, patient_id, vital_plan_id, measure, value1, value2, pulse, taken_at, source, flag, reviewed_at, review_note, " +
        "patients(first_name, last_name)")
      .eq("clinic_id", activeClinicId).neq("flag", "ok").is("reviewed_at", null)
      .order("taken_at", { ascending: false }).limit(200);
    const list = ((data ?? []) as unknown as Row[])
      .sort((a, b) => Number(b.flag === "critical") - Number(a.flag === "critical"));
    setRows(list);
    setLoaded(true);
  }, [activeClinicId]);

  useEffect(() => { load(); }, [load]);

  if (!canManageCare(clinicalRole)) {
    return <><h1>Readings to review</h1><p className="muted">Nurses and doctors review patients' readings.</p></>;
  }

  return (
    <>
      <h1>Readings to review</h1>
      <p className="small muted">
        Vital signs patients sent by chat (or staff entered) that are outside the target or at a critical limit in their
        doctor's plan. Patients with a critical reading were told to call 911 if they have danger signs, otherwise to
        contact the clinic today. Mark each reading reviewed once someone has followed up.
      </p>
      <table>
        <thead><tr><th>Patient</th><th>Taken</th><th>Reading</th><th>Check</th><th></th></tr></thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.id}>
              <td><Link to={`/patients/${r.patient_id}`}>
                {r.patients ? `${r.patients.first_name} ${r.patients.last_name}` : "Patient"}</Link></td>
              <td className="small">{new Date(r.taken_at).toLocaleString([], { dateStyle: "medium", timeStyle: "short" })}
                <div className="muted">{r.source === "chat" ? "by chat" : "at the clinic"}</div></td>
              <td>{MEASURE_INFO[r.measure].label}: {formatValue(r.measure, r.value1, r.value2, r.pulse)}</td>
              <td><FlagBadge flag={r.flag} /></td>
              <td className="small"><ReviewButton reading={r} onDone={load} /></td>
            </tr>
          ))}
          {loaded && !rows.length && <tr><td colSpan={5} className="empty">Nothing to review.</td></tr>}
        </tbody>
      </table>
    </>
  );
}
