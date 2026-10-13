import { useCallback, useEffect, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { supabase } from "../lib/supabase";
import { useSession, roleAtLeast, canManageCare } from "../lib/session";
import { useClinic } from "../lib/clinic";
import ChatSection from "../components/ChatSection";
import MedicinesSection from "../components/MedicinesSection";
import type { Patient } from "../lib/types";

type CallRow = {
  id: string; started_at: string; result: string | null; verified: boolean;
  duration_seconds: number | null; summary: string | null;
  campaigns?: { name: string };
};

type Intake = {
  urgency?: string; specialty?: string | null; symptoms?: string[]; ph_warnings?: string[]; demo?: boolean;
};
type ApptRow = {
  id: string; starts_at: string; status: string; source: string | null; intake: Intake | null;
  providers?: { name: string } | null;
  appointment_reminders?: { kind: string; status: string; response: string | null }[];
};

const RESPONSE_LABEL: Record<string, string> = {
  confirm: "patient confirmed", reschedule: "patient asked for a new time", cancel: "patient cancelled",
};

/** "Reminded 24h, 2h · patient confirmed" */
function reminderSummary(rs: ApptRow["appointment_reminders"]): string | null {
  if (!rs?.length) return null;
  const sent = rs.filter((r) => r.status === "sent").map((r) => r.kind).sort().reverse();
  const failed = rs.some((r) => r.status !== "sent");
  const answer = rs.find((r) => r.response)?.response;
  return [
    sent.length ? `Reminded ${sent.join(", ")}` : null,
    failed ? "a reminder couldn't be sent" : null,
    answer ? RESPONSE_LABEL[answer] ?? answer : null,
  ].filter(Boolean).join(" · ");
}

const URGENCY_LABEL: Record<string, string> = {
  urgent: "See a doctor today", routine: "Next few days", self_care: "Self care", emergency: "Emergency",
};
const SOURCE_LABEL: Record<string, string> = {
  voice: "AI call", booking_link: "Booking link", symptom_check: "Symptom check",
};

export default function PatientDetail() {
  const { id } = useParams<{ id: string }>();
  const { role, clinicalRole } = useSession();
  const canManage = roleAtLeast(role, "clinic_admin");
  const clinical = canManageCare(clinicalRole);
  const { activeClinic } = useClinic();

  const [patient, setPatient] = useState<Patient | null>(null);
  const [calls, setCalls] = useState<CallRow[]>([]);
  const [appts, setAppts] = useState<ApptRow[]>([]);
  const [msg, setMsg] = useState("");
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    if (!id) return;
    const [{ data: p }, { data: c }, { data: a }] = await Promise.all([
      supabase.from("patients").select("*").eq("id", id).single(),
      supabase.from("call_logs")
        .select("id, started_at, result, verified, duration_seconds, summary, campaigns(name)")
        .eq("patient_id", id).order("started_at", { ascending: false }),
      supabase.from("appointments")
        .select("id, starts_at, status, source, intake, providers(name), appointment_reminders(kind, status, response)")
        .eq("patient_id", id).order("starts_at", { ascending: false }).limit(20),
    ]);
    setPatient(p as Patient);
    setCalls((c as unknown as CallRow[]) ?? []);
    setAppts((a as unknown as ApptRow[]) ?? []);
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

      <MedicinesSection patientId={patient.id} clinicId={patient.clinic_id}
                        canMessage={patient.active && !patient.do_not_call} />

      <h2>Appointments</h2>
      <table>
        <thead><tr><th>When</th><th>Clinician</th><th>Booked by</th><th>Status</th></tr></thead>
        <tbody>
          {appts.map((a) => (
            <tr key={a.id}>
              <td>{new Date(a.starts_at).toLocaleString()}</td>
              <td>{a.providers?.name ?? "—"}</td>
              <td>
                {SOURCE_LABEL[a.source ?? ""] ?? a.source ?? "—"}
                {a.intake && <IntakeSummary intake={a.intake} full={clinical} />}
              </td>
              <td>
                <span className={`badge ${a.status}`}>{a.status}</span>
                {reminderSummary(a.appointment_reminders) && (
                  <div className="small muted" style={{ marginTop: 4 }}>{reminderSummary(a.appointment_reminders)}</div>
                )}
              </td>
            </tr>
          ))}
          {!appts.length && <tr><td colSpan={4} className="empty">No appointments yet.</td></tr>}
        </tbody>
      </table>

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

/**
 * What the patient shared from the symptom check when booking. Front desk
 * sees the urgency and specialty only; nurses and doctors see the symptoms too.
 */
function IntakeSummary({ intake, full }: { intake: Intake; full: boolean }) {
  return (
    <div className="intake small">
      {intake.urgency && <div><strong>{URGENCY_LABEL[intake.urgency] ?? intake.urgency}</strong>
        {intake.specialty ? ` · ${intake.specialty}` : ""}{intake.demo ? " · demo engine" : ""}</div>}
      {full && !!intake.symptoms?.length && <div>Symptoms: {intake.symptoms.join(", ")}</div>}
      {full && !!intake.ph_warnings?.length && <div>Watch for: {intake.ph_warnings.join("; ")}</div>}
    </div>
  );
}
