import { useCallback, useEffect, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { supabase } from "../lib/supabase";
import { useSession, roleAtLeast } from "../lib/session";
import { useClinic } from "../lib/clinic";
import ChatSection from "../components/ChatSection";
import type { Patient } from "../lib/types";

type CallRow = {
  id: string; started_at: string; result: string | null; verified: boolean;
  duration_seconds: number | null; summary: string | null;
  campaigns?: { name: string };
};

export default function PatientDetail() {
  const { id } = useParams<{ id: string }>();
  const { role } = useSession();
  const canManage = roleAtLeast(role, "clinic_admin");
  const { activeClinic } = useClinic();

  const [patient, setPatient] = useState<Patient | null>(null);
  const [calls, setCalls] = useState<CallRow[]>([]);
  const [msg, setMsg] = useState("");
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    if (!id) return;
    const [{ data: p }, { data: c }] = await Promise.all([
      supabase.from("patients").select("*").eq("id", id).single(),
      supabase.from("call_logs")
        .select("id, started_at, result, verified, duration_seconds, summary, campaigns(name)")
        .eq("patient_id", id).order("started_at", { ascending: false }),
    ]);
    setPatient(p as Patient);
    setCalls((c as unknown as CallRow[]) ?? []);
  }, [id]);

  useEffect(() => { load(); }, [load]);

  async function patch(fields: Partial<Patient>, message: string) {
    setBusy(true);
    const { error } = await supabase.from("patients").update(fields).eq("id", id);
    setBusy(false);
    setMsg(error ? `Failed: ${error.message}` : message);
    load();
  }

  if (!patient) return <p className="empty">Loading…</p>;

  return (
    <>
      <div className="page-head">
        <h1>{patient.first_name} {patient.last_name}</h1>
        <div>
          {patient.do_not_call && <span className="badge wrong_number">do not call</span>}
          {!patient.active && <span className="badge declined">inactive</span>}
          {patient.sms_consent && <span className="badge notified">SMS consent</span>}
        </div>
      </div>
      <p className="muted"><Link to="/patients">← All patients</Link></p>
      {msg && <p role="status">{msg}</p>}

      <div className="form-card">
        <div className="kv"><span>Phone</span><strong>{patient.phone}</strong></div>
        <div className="kv"><span>Date of birth</span><strong>{patient.date_of_birth}</strong></div>
        <div className="kv"><span>Email</span><strong>{patient.email ?? "—"}</strong></div>
        <div className="kv"><span>SMS consent</span><strong>{patient.sms_consent ? "Yes" : "No"}</strong></div>
        {patient.notes && <div className="kv"><span>Notes</span><strong>{patient.notes}</strong></div>}

        {canManage && (
          <div className="row-actions" style={{ marginTop: 14 }}>
            <button className={patient.do_not_call ? "secondary" : "danger"} disabled={busy}
                    onClick={() => patch({ do_not_call: !patient.do_not_call }, patient.do_not_call ? "Do-not-call cleared." : "Marked do-not-call.")}>
              {patient.do_not_call ? "Clear do-not-call" : "Set do-not-call"}
            </button>
            <button className="secondary" disabled={busy}
                    onClick={() => patch({ sms_consent: !patient.sms_consent }, patient.sms_consent ? "SMS consent removed." : "SMS consent recorded.")}>
              {patient.sms_consent ? "Remove SMS consent" : "Record SMS consent"}
            </button>
            <button className="secondary" disabled={busy}
                    onClick={() => patch({ active: !patient.active }, patient.active ? "Patient deactivated." : "Patient reactivated.")}>
              {patient.active ? "Deactivate" : "Reactivate"}
            </button>
          </div>
        )}
      </div>

      <ChatSection patientId={patient.id} firstName={patient.first_name}
                   clinicName={activeClinic?.name ?? "your clinic"}
                   canInvite={patient.active && !patient.do_not_call} />

      <h2>Call history</h2>
      <table>
        <thead><tr><th>When</th><th>Campaign</th><th>Verified</th><th>Result</th><th>Length</th></tr></thead>
        <tbody>
          {calls.map((l) => (
            <tr key={l.id}>
              <td>{new Date(l.started_at).toLocaleString()}</td>
              <td>{l.campaigns?.name ?? "—"}</td>
              <td>{l.verified ? "yes" : "no"}</td>
              <td>{l.result ? <span className={`badge ${l.result}`}>{l.result.replace(/_/g, " ")}</span> : "—"}</td>
              <td>{l.duration_seconds != null ? `${l.duration_seconds}s` : "—"}</td>
            </tr>
          ))}
          {!calls.length && <tr><td colSpan={5} className="empty">No calls yet for this patient.</td></tr>}
        </tbody>
      </table>
    </>
  );
}
