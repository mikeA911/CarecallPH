import { useCallback, useEffect, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { supabase } from "../lib/supabase";
import { useSession, roleAtLeast, canManageCare } from "../lib/session";
import { callFunction } from "../lib/api";
import AddressFields, { addressForSave, addressText } from "../components/AddressFields";
import { useClinic } from "../lib/clinic";
import ChatSection from "../components/ChatSection";
import MedicinesSection from "../components/MedicinesSection";
import ClinicalNotesSection from "../components/ClinicalNotesSection";
import VitalSignsSection from "../components/VitalSignsSection";
import PrivacySection from "../components/PrivacySection";
import { cancelAppointment, notifyPatient, NotifyBox, SlotPicker, type Bookable } from "../components/AppointmentBooker";
import type { Address, Patient } from "../lib/types";

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
  provider_id: string | null; providers?: { name: string } | null;
  appointment_reminders?: { kind: string; status: string; response: string | null; rescheduled_to: string | null }[];
};

const RESPONSE_LABEL: Record<string, string> = {
  confirm: "patient confirmed", reschedule: "patient asked for a new time", cancel: "patient cancelled",
  moved: "patient moved it in the chat",
};

/** "Reminded 24h, 2h · patient confirmed" */
function reminderSummary(rs: ApptRow["appointment_reminders"]): string | null {
  if (!rs?.length) return null;
  const sent = [...new Set(rs.filter((r) => r.status === "sent").map((r) => r.kind))].sort().reverse();
  const failed = rs.some((r) => r.status !== "sent");
  // Moved in the chat (button or letter after "change time") beats the plain answer.
  const moved = rs.some((r) => r.rescheduled_to);
  const answer = moved ? "moved" : rs.find((r) => r.response)?.response;
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
  voice: "AI call", booking_link: "Booking link", symptom_check: "Symptom check", staff: "Staff",
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
  const [editing, setEditing] = useState(false);
  // Staff booking: "new" = book, or the appointment being moved.
  const [booking, setBooking] = useState<"new" | Bookable | null>(null);
  const [cancelling, setCancelling] = useState<ApptRow | null>(null);
  const [notifyCancel, setNotifyCancel] = useState(true);

  const load = useCallback(async () => {
    if (!id) return;
    const [{ data: p }, { data: c }, { data: a }] = await Promise.all([
      supabase.from("patients").select("*").eq("id", id).single(),
      supabase.from("call_logs")
        .select("id, started_at, result, verified, duration_seconds, summary, campaigns(name)")
        .eq("patient_id", id).order("started_at", { ascending: false }),
      supabase.from("appointments")
        .select("id, starts_at, status, source, intake, provider_id, providers(name), appointment_reminders(kind, status, response, rescheduled_to)")
        .eq("patient_id", id).order("starts_at", { ascending: false }).limit(20),
    ]);
    setPatient(p as Patient);
    setCalls((c as unknown as CallRow[]) ?? []);
    setAppts((a as unknown as ApptRow[]) ?? []);
  }, [id]);

  useEffect(() => { load(); }, [load]);

  async function downloadFhir() {
    if (!patient) return;
    setBusy(true);
    const { data, error } = await callFunction<object>("fhir", { resource: "Patient", id: patient.id, everything: true });
    setBusy(false);
    if (error || !data) { setMsg(`Couldn't export: ${error ?? "no data"}`); return; }
    const url = URL.createObjectURL(new Blob([JSON.stringify(data, null, 2)], { type: "application/fhir+json" }));
    const a = document.createElement("a");
    a.href = url;
    a.download = `${patient.last_name}-${patient.first_name}-fhir.json`.replace(/[^A-Za-z0-9.-]+/g, "_");
    a.click();
    URL.revokeObjectURL(url);
    setMsg("Record downloaded (FHIR R4). The download is recorded in the audit log.");
  }

  async function patch(fields: Partial<Patient>, message: string) {
    setBusy(true);
    const { error } = await supabase.from("patients").update(fields).eq("id", id);
    setBusy(false);
    setMsg(error ? `Failed: ${error.message}` : message);
    load();
  }

  const tz = activeClinic?.timezone || "Asia/Manila";

  const fmtWhen = (iso: string) => new Date(iso).toLocaleString(undefined, { timeZone: tz, dateStyle: "medium", timeStyle: "short" });

  async function cancel(a: ApptRow) {
    setBusy(true);
    const error = await cancelAppointment(a.id);
    const told = error ? "" : notifyCancel ? await notifyPatient(a.id, "cancelled") : "No message sent; tell the patient yourself.";
    setBusy(false);
    setCancelling(null);
    setMsg(error ?? `Appointment on ${fmtWhen(a.starts_at)} cancelled. ${told}`);
    load();
  }

  if (!patient) return <p className="empty">Loading…</p>;

  // Anyone at the clinic books; not for restricted or inactive records.
  const canBook = patient.active && !patient.restricted_at;
  const upcoming = (a: ApptRow) => (a.status === "booked" || a.status === "confirmed") && Date.parse(a.starts_at) > Date.now();

  return (
    <>
      <div className="page-head">
        <h1 data-phi>{patient.first_name} {patient.last_name}</h1>
        <div>
          {patient.do_not_call && <span className="badge wrong_number">do not call</span>}
          {!patient.active && <span className="badge declined">inactive</span>}
          {patient.restricted_at && <span className="badge verification_failed">restricted</span>}
          {patient.sms_consent && <span className="badge notified">SMS consent</span>}
          {patient.signed_up_at && <span className="badge pending">signed up on the clinic's page</span>}
        </div>
      </div>
      <p className="muted"><Link to="/patients">← All patients</Link></p>
      {msg && <p role="status">{msg}</p>}
      {patient.restricted_at && (
        <div className="idle-warning" role="note" style={{ position: "static", marginBottom: 12 }}>
          <span>
            <strong>Restricted record</strong> ({patient.restriction_kind === "erasure" ? "erasure requested" : "restriction requested"}
            {" "}on {new Date(patient.restricted_at).toLocaleDateString()}): view-only. No messages, calls, reminders or changes.
            {patient.restriction_kind === "erasure" && " Data the clinic needn't keep was deleted; the rest is kept until its retention period ends."}
          </span>
        </div>
      )}

      <div className="form-card">
        {patient.middle_name && <div className="kv"><span>Middle name</span><strong>{patient.middle_name}</strong></div>}
        <div className="kv"><span>Phone</span><strong>{patient.phone}</strong></div>
        <div className="kv"><span>Date of birth</span><strong>{patient.date_of_birth}</strong></div>
        <div className="kv"><span>Sex</span><strong>{SEX_LABEL[patient.sex ?? ""] ?? "—"}</strong></div>
        <div className="kv"><span>Email</span><strong>{patient.email ?? "—"}</strong></div>
        <div className="kv"><span>Address</span><strong>{addressText(patient) || "—"}</strong></div>
        <div className="kv"><span>PhilHealth PIN</span><strong>{patient.philhealth_id ? formatPin(patient.philhealth_id) : "—"}</strong></div>
        <div className="kv"><span>SMS consent</span><strong>{patient.sms_consent ? "Yes" : "No"}</strong></div>
        {patient.privacy_notice_accepted_at && (
          <div className="kv"><span>Privacy notice</span>
            <strong>Accepted {new Date(patient.privacy_notice_accepted_at).toLocaleDateString()} (version {patient.privacy_notice_version})</strong></div>
        )}
        {patient.notes && <div className="kv"><span>Notes</span><strong>{patient.notes}</strong></div>}

        {(canManage || clinical) && (
          <div className="row-actions" style={{ marginTop: 14 }}>
            {canManage && !patient.restricted_at && <button className="secondary" disabled={busy} onClick={() => setEditing(true)}>Edit details</button>}
            {clinical && (
              <button className="secondary" disabled={busy} onClick={downloadFhir}
                      title="The patient's record in the national health data format (FHIR R4, PH Core)">
                Download record (FHIR)
              </button>
            )}
          </div>
        )}
        {editing && (
          <EditDetails patient={patient} onCancel={() => setEditing(false)}
            onSave={async (fields) => { await patch(fields, "Details saved."); setEditing(false); }} />
        )}

        {canManage && !patient.restricted_at && (
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

      {clinical && <VitalSignsSection patientId={patient.id} clinicId={patient.clinic_id}
                                      canMessage={patient.active && !patient.do_not_call} />}

      {clinical && <ClinicalNotesSection patientId={patient.id} clinicId={patient.clinic_id} />}

      <h2>Appointments</h2>
      {canBook && !booking && !cancelling && (
        <div className="row-actions" style={{ marginBottom: 8 }}>
          <button className="secondary" onClick={() => setBooking("new")}>Book appointment</button>
        </div>
      )}
      {booking && (
        <SlotPicker patientId={patient.id} clinicId={patient.clinic_id} tz={tz}
                    existing={booking === "new" ? null : booking}
                    onCancel={() => setBooking(null)}
                    onDone={(t) => { setBooking(null); setMsg(t); load(); }} />
      )}
      {cancelling && (
        <div className="form-card" style={{ marginTop: 12, maxWidth: 760 }}>
          <strong>Cancel the appointment on {fmtWhen(cancelling.starts_at)}?</strong>
          <div className="small muted">The time opens up for other patients.</div>
          <NotifyBox checked={notifyCancel} onChange={setNotifyCancel} />
          <div className="row-actions" style={{ marginTop: 12 }}>
            <button className="danger" disabled={busy} onClick={() => cancel(cancelling)}>{busy ? "Cancelling…" : "Cancel appointment"}</button>
            <button className="link" onClick={() => setCancelling(null)}>Keep it</button>
          </div>
        </div>
      )}
      <table>
        <thead><tr><th>When</th><th>Clinician</th><th>Booked by</th><th>Status</th></tr></thead>
        <tbody>
          {appts.map((a) => (
            <tr key={a.id}>
              <td>{new Date(a.starts_at).toLocaleString(undefined, { timeZone: tz, dateStyle: "medium", timeStyle: "short" })}</td>
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
                {canBook && upcoming(a) && !booking && !cancelling && (
                  <div className="row-actions" style={{ marginTop: 4 }}>
                    <button className="link" onClick={() => setBooking({ id: a.id, starts_at: a.starts_at, provider_id: a.provider_id })}>Reschedule</button>
                    <button className="link" onClick={() => { setNotifyCancel(true); setCancelling(a); }}>Cancel</button>
                  </div>
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

      <PrivacySection patient={patient} onChange={load} />
    </>
  );
}

const SEX_LABEL: Record<string, string> = { male: "Male", female: "Female", other: "Other", unknown: "Unknown" };
const formatPin = (d: string) => (d.length === 12 ? `${d.slice(0, 2)}-${d.slice(2, 11)}-${d.slice(11)}` : d);

/** Edit name, sex, email, address and PhilHealth PIN (clinic admins). */
function EditDetails({ patient, onSave, onCancel }: {
  patient: Patient; onSave: (f: Partial<Patient>) => Promise<void>; onCancel: () => void;
}) {
  const [f, setF] = useState({
    first_name: patient.first_name, middle_name: patient.middle_name ?? "", last_name: patient.last_name,
    sex: patient.sex ?? "", email: patient.email ?? "",
    philhealth_id: patient.philhealth_id ? formatPin(patient.philhealth_id) : "",
  });
  const [addr, setAddr] = useState<Address>(patient);
  const [err, setErr] = useState("");

  async function save() {
    const pin = f.philhealth_id.replace(/\D/g, "");
    if (pin && pin.length !== 12) { setErr("The PhilHealth PIN has 12 digits (nn-nnnnnnnnn-n)."); return; }
    if (!f.first_name.trim() || !f.last_name.trim()) { setErr("First and last name are required."); return; }
    setErr("");
    await onSave({
      first_name: f.first_name.trim(), middle_name: f.middle_name.trim() || null, last_name: f.last_name.trim(),
      sex: (f.sex || null) as Patient["sex"], email: f.email.trim() || null, philhealth_id: pin || null,
      ...addressForSave(addr),
    });
  }

  return (
    <div style={{ marginTop: 14, borderTop: "1px solid var(--border, #e5e7eb)", paddingTop: 10 }}>
      <div className="form-grid">
        <span><label htmlFor="pd-first">First name</label>
          <input id="pd-first" value={f.first_name} onChange={(e) => setF({ ...f, first_name: e.target.value })} /></span>
        <span><label htmlFor="pd-middle">Middle name</label>
          <input id="pd-middle" value={f.middle_name} onChange={(e) => setF({ ...f, middle_name: e.target.value })} /></span>
        <span><label htmlFor="pd-last">Last name</label>
          <input id="pd-last" value={f.last_name} onChange={(e) => setF({ ...f, last_name: e.target.value })} /></span>
        <span><label htmlFor="pd-sex">Sex</label>
          <select id="pd-sex" value={f.sex} onChange={(e) => setF({ ...f, sex: e.target.value })}>
            <option value="">Not recorded</option>
            <option value="female">Female</option>
            <option value="male">Male</option>
            <option value="other">Other</option>
            <option value="unknown">Unknown</option>
          </select></span>
        <span><label htmlFor="pd-email">Email</label>
          <input id="pd-email" type="email" value={f.email} onChange={(e) => setF({ ...f, email: e.target.value })} /></span>
        <span><label htmlFor="pd-pin">PhilHealth PIN</label>
          <input id="pd-pin" inputMode="numeric" placeholder="nn-nnnnnnnnn-n" value={f.philhealth_id}
                 onChange={(e) => setF({ ...f, philhealth_id: e.target.value })} /></span>
      </div>
      <AddressFields idPrefix="pd" value={addr} onChange={setAddr} />
      {err && <p role="alert" className="small">{err}</p>}
      <div className="row-actions" style={{ marginTop: 12 }}>
        <button onClick={save}>Save details</button>
        <button className="link" onClick={onCancel}>Cancel</button>
      </div>
    </div>
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
