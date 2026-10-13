// Patient detail → "Privacy requests" (Data Privacy Act). Anyone in the
// clinic logs a request the patient made; a clinic admin (usually the Data
// Protection Officer) acts on it. Restriction, erasure and closing happen in
// database functions (one transaction each); see
// supabase/migrations/20261023000000_data_requests.sql.
import { useCallback, useEffect, useState } from "react";
import { supabase } from "../lib/supabase";
import { roleAtLeast, useSession } from "../lib/session";
import type { Patient } from "../lib/types";

type Kind = "access" | "correction" | "restriction" | "erasure";
type Request = {
  id: string; kind: Kind; received_via: string; received_at: string; respond_by: string; identity_checked: boolean;
  details: string | null; status: "received" | "completed" | "refused"; outcome: string | null;
  actions: Record<string, unknown> | null; completed_at: string | null; created_at: string;
};
type Preview = {
  delete: Record<string, number>; keep: Record<string, number>; future_appointments: number;
  keep_until: string; retention_years: number; disposable_now: boolean;
};

export const KIND_LABEL: Record<Kind, string> = {
  access: "See a copy of their record",
  correction: "Correct their details",
  restriction: "Stop using their data (restrict)",
  erasure: "Delete their data (erase)",
};
const VIA_LABEL: Record<string, string> = {
  in_person: "In person", chat: "Chat", phone: "Phone", email: "Email", letter: "Letter", other: "Other",
};
const COUNT_LABEL: Record<string, string> = {
  chat_links: "chat app links", chat_invites: "chat invites", messages: "messages", booking_links: "booking links",
  campaign_entries: "campaign entries", calls: "calls (with transcripts)", appointment_reminders: "appointment reminders",
  reading_requests: "reading requests", symptom_checks: "symptom checks", action_items: "CC action items",
  appointments: "appointments", clinical_notes: "clinical notes", medicines: "medicines", medicine_doses: "medicine doses",
  monitoring_plans: "monitoring plans", readings: "readings", consents: "consents",
};
const HOW_TO: Record<Kind, string> = {
  access: "Click Download record (FHIR) above (nurse or doctor) and give the file to the patient, or print what they ask for. Then mark completed.",
  correction: "Use Edit details, or a signed addendum for a clinical note. Then mark completed with what changed.",
  restriction: "Restrict now stops all messages, calls and reminders and makes the record view-only. It can be lifted later.",
  erasure: "Review shows what is deleted now and what the clinic must keep until its retention period ends.",
};

const today = () => new Date().toLocaleDateString("en-CA");
const plusDays = (d: string, n: number) => { const x = new Date(`${d}T00:00`); x.setDate(x.getDate() + n); return x.toLocaleDateString("en-CA"); };
const fmt = (d: string) => new Date(d.length === 10 ? `${d}T00:00` : d).toLocaleDateString();
const counts = (o: Record<string, number>) =>
  Object.entries(o).filter(([, n]) => n > 0).map(([k, n]) => `${n} ${COUNT_LABEL[k] ?? k.replace(/_/g, " ")}`).join(", ") || "nothing";

export default function PrivacySection({ patient, onChange }: { patient: Patient; onChange: () => void }) {
  const { role, session } = useSession();
  const isAdmin = roleAtLeast(role, "clinic_admin");
  const [requests, setRequests] = useState<Request[]>([]);
  const [logging, setLogging] = useState(false);
  const [msg, setMsg] = useState("");

  const load = useCallback(async () => {
    const { data } = await supabase.from("data_requests")
      .select("id, kind, received_via, received_at, respond_by, identity_checked, details, status, outcome, actions, completed_at, created_at")
      .eq("patient_id", patient.id).order("created_at", { ascending: false });
    setRequests((data ?? []) as Request[]);
  }, [patient.id]);
  useEffect(() => { load(); }, [load]);

  const done = (t: string) => { setMsg(t); load(); onChange(); };

  async function lift() {
    const reason = prompt("Why is the restriction being lifted? (e.g. the patient asked to resume care)");
    if (!reason?.trim()) return;
    const { error } = await supabase.rpc("data_request_lift", { p_patient: patient.id, p_reason: reason });
    done(error ? error.message : "Restriction lifted. Do-not-call stays on until the patient agrees to be contacted again.");
  }

  return (
    <>
      <h2>Privacy requests</h2>
      {msg && <p role="status">{msg}</p>}
      {patient.restricted_at && isAdmin && patient.restriction_kind === "restriction" && (
        <div className="row-actions"><button className="secondary" onClick={lift}>Lift restriction</button></div>
      )}
      <table>
        <thead><tr><th>Request</th><th>Received</th><th>Answer by</th><th>Status</th></tr></thead>
        <tbody>
          {requests.map((r) => (
            <RequestRow key={r.id} r={r} patient={patient} isAdmin={isAdmin} onDone={done} />
          ))}
          {!requests.length && <tr><td colSpan={4} className="empty">No privacy requests.</td></tr>}
        </tbody>
      </table>
      {!logging ? (
        <div className="row-actions" style={{ marginTop: 10 }}>
          <button className="secondary" onClick={() => setLogging(true)}>Log a request</button>
        </div>
      ) : (
        <LogForm patient={patient} userId={session?.user?.id ?? null}
                 onClose={(t) => { setLogging(false); if (t) done(t); }} />
      )}
    </>
  );
}

function RequestRow({ r, patient, isAdmin, onDone }: {
  r: Request; patient: Patient; isAdmin: boolean; onDone: (t: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const overdue = r.status === "received" && r.respond_by < today();
  return (
    <>
      <tr>
        <td>
          <strong>{KIND_LABEL[r.kind]}</strong>
          {r.details && <div className="small muted">{r.details}</div>}
          {!r.identity_checked && r.status === "received" && <div className="small">Identity not checked yet</div>}
        </td>
        <td className="small">{fmt(r.received_at)}<div className="muted">{VIA_LABEL[r.received_via]}</div></td>
        <td className="small">{r.status === "received" ? <span className={overdue ? "badge reading-critical" : ""}>{fmt(r.respond_by)}{overdue ? " (overdue)" : ""}</span> : "—"}</td>
        <td className="small">
          {r.status === "received" ? (isAdmin
            ? <button className="link" onClick={() => setOpen(!open)}>{open ? "Close" : "Handle"}</button>
            : "Waiting for a clinic admin")
            : <>{r.status === "completed" ? "Completed" : "Refused"} {r.completed_at && fmt(r.completed_at)}
                {r.outcome && <div className="muted">{r.outcome}</div>}</>}
        </td>
      </tr>
      {open && r.status === "received" && (
        <tr><td colSpan={4}><HandleRequest r={r} patient={patient} onDone={(t) => { setOpen(false); onDone(t); }} /></td></tr>
      )}
    </>
  );
}

function HandleRequest({ r, patient, onDone }: { r: Request; patient: Patient; onDone: (t: string) => void }) {
  const [outcome, setOutcome] = useState("");
  const [preview, setPreview] = useState<Preview | null>(null);
  const [confirm, setConfirm] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");

  async function rpc(fn: string, args: Record<string, unknown>, ok: string) {
    setBusy(true); setErr("");
    const { error } = await supabase.rpc(fn, args);
    setBusy(false);
    if (error) { setErr(error.message); return; }
    onDone(ok);
  }
  async function review() {
    setBusy(true); setErr("");
    const { data, error } = await supabase.rpc("data_request_preview", { p_patient: patient.id });
    setBusy(false);
    if (error) { setErr(error.message); return; }
    setPreview(data as Preview);
  }

  return (
    <div className="form-card" style={{ margin: "4px 0" }}>
      <p className="small" style={{ marginTop: 0 }}>{HOW_TO[r.kind]}</p>
      {!r.identity_checked && <p className="small" role="alert">Check the patient's identity before acting (ID, or questions only they can answer).</p>}

      {(r.kind === "access" || r.kind === "correction") && (
        <>
          <label htmlFor={`out-${r.id}`}>What was done</label>
          <input id={`out-${r.id}`} value={outcome} placeholder={r.kind === "access" ? "Gave the FHIR file by email" : "Corrected the address"}
                 onChange={(e) => setOutcome(e.target.value)} />
          <div className="row-actions" style={{ marginTop: 8 }}>
            <button disabled={busy} onClick={() => rpc("data_request_complete", { p_request: r.id, p_outcome: outcome }, "Request completed.")}>Mark completed</button>
          </div>
        </>
      )}

      {r.kind === "restriction" && (
        <div className="row-actions">
          <button className="danger" disabled={busy}
                  onClick={() => confirm_(`Restrict ${patient.first_name} ${patient.last_name}'s record now?`) &&
                    rpc("data_request_restrict", { p_request: r.id }, "Record restricted: no messages, calls or changes.")}>
            Restrict now
          </button>
        </div>
      )}

      {r.kind === "erasure" && !preview && (
        <div className="row-actions"><button className="secondary" disabled={busy} onClick={review}>Review erasure</button></div>
      )}
      {r.kind === "erasure" && preview && (
        <div>
          <p className="small"><strong>Deleted now:</strong> {counts(preview.delete)}.
            {preview.future_appointments > 0 && ` ${preview.future_appointments} upcoming appointment(s) cancelled.`}
            {" "}All messages, calls and reminders stop; consents are withdrawn.</p>
          <p className="small"><strong>Kept, view-only:</strong> {counts(preview.keep)}, until {fmt(preview.keep_until)}{" "}
            ({preview.retention_years} years after the last consultation, the clinic's records retention).
            {preview.disposable_now ? " This record is already past that date: after erasing, dispose of it in Clinic settings → Records retention." : " Then it can be disposed of."}</p>
          <p className="small muted">Tell the patient what is kept and why. Erasure can't be undone.</p>
          <label htmlFor={`conf-${r.id}`}>Type the patient's last name to confirm</label>
          <input id={`conf-${r.id}`} style={{ width: 220 }} value={confirm} onChange={(e) => setConfirm(e.target.value)} />
          <div className="row-actions" style={{ marginTop: 8 }}>
            <button className="danger" disabled={busy || !confirm.trim()}
                    onClick={() => rpc("data_request_erase", { p_request: r.id, p_confirm_last_name: confirm }, "Erased. The medical record is view-only until it can be disposed of.")}>
              Erase
            </button>
          </div>
        </div>
      )}

      <details style={{ marginTop: 10 }}>
        <summary className="small">Refuse this request</summary>
        <label htmlFor={`ref-${r.id}`}>Reason (told to the patient)</label>
        <input id={`ref-${r.id}`} value={outcome} onChange={(e) => setOutcome(e.target.value)} placeholder="Identity could not be confirmed" />
        <div className="row-actions" style={{ marginTop: 8 }}>
          <button className="secondary" disabled={busy || !outcome.trim()}
                  onClick={() => rpc("data_request_complete", { p_request: r.id, p_outcome: outcome, p_refuse: true }, "Request refused.")}>Refuse</button>
        </div>
      </details>
      {err && <p role="alert" className="small">{err}</p>}
    </div>
  );
}

const confirm_ = (q: string) => window.confirm(q);

function LogForm({ patient, userId, onClose }: { patient: Patient; userId: string | null; onClose: (t?: string) => void }) {
  const [f, setF] = useState({ kind: "access" as Kind, via: "in_person", received: today(), respondBy: plusDays(today(), 15),
    identity: false, details: "" });
  const [err, setErr] = useState("");
  async function save() {
    if (f.respondBy < f.received) { setErr("The answer-by date is before the date received."); return; }
    const { error } = await supabase.from("data_requests").insert({
      clinic_id: patient.clinic_id, patient_id: patient.id, kind: f.kind, received_via: f.via, received_at: f.received,
      respond_by: f.respondBy, identity_checked: f.identity, details: f.details.trim() || null, created_by: userId,
    });
    if (error) { setErr(error.message); return; }
    onClose("Request logged. A clinic admin has a CC action item to handle it.");
  }
  return (
    <div className="form-card" style={{ marginTop: 12, maxWidth: 640 }}>
      <label htmlFor="dr-kind">The patient asks to</label>
      <select id="dr-kind" value={f.kind} onChange={(e) => setF({ ...f, kind: e.target.value as Kind })}>
        {(Object.keys(KIND_LABEL) as Kind[]).map((k) => <option key={k} value={k}>{KIND_LABEL[k]}</option>)}
      </select>
      <div className="row-actions" style={{ marginTop: 4 }}>
        <span><label htmlFor="dr-via">Received by</label>
          <select id="dr-via" value={f.via} onChange={(e) => setF({ ...f, via: e.target.value })}>
            {Object.entries(VIA_LABEL).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
          </select></span>
        <span><label htmlFor="dr-rec">Received on</label>
          <input id="dr-rec" type="date" value={f.received}
                 onChange={(e) => setF({ ...f, received: e.target.value, respondBy: plusDays(e.target.value, 15) })} /></span>
        <span><label htmlFor="dr-by">Answer by</label>
          <input id="dr-by" type="date" value={f.respondBy} onChange={(e) => setF({ ...f, respondBy: e.target.value })} /></span>
      </div>
      <p className="small muted">Answer-by defaults to 15 days; confirm the period with your Data Protection Officer.</p>
      <label style={{ display: "flex", gap: 8, alignItems: "center" }}>
        <input type="checkbox" style={{ width: "auto" }} checked={f.identity} onChange={(e) => setF({ ...f, identity: e.target.checked })} />
        Identity checked (ID seen, or questions only the patient can answer)
      </label>
      <label htmlFor="dr-details">Details (optional)</label>
      <input id="dr-details" value={f.details} placeholder="What exactly they asked for" onChange={(e) => setF({ ...f, details: e.target.value })} />
      {err && <p role="alert" className="small">{err}</p>}
      <div className="row-actions" style={{ marginTop: 12 }}>
        <button onClick={save}>Log request</button>
        <button className="link" onClick={() => onClose()}>Cancel</button>
      </div>
    </div>
  );
}
