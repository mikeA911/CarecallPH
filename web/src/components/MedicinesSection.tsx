// Patient detail → "Medicines" (care plans, slice M1): consent status, the
// patient's medicines with reminder times and adherence, and adding or
// stopping a medicine. Reminders go out by chat only after the patient agrees
// (YES in the chat). Design: docs/care-plan-design.md
import { useCallback, useEffect, useState } from "react";
import { supabase } from "../lib/supabase";
import { callFunction } from "../lib/api";
import { canManageCare, useSession } from "../lib/session";

type Consent = {
  requested_at: string; consented_at: string | null; declined_at: string | null; withdrawn_at: string | null;
};
type Medication = {
  id: string; name: string; dose: string | null; instructions: string | null; times_of_day: string[];
  start_date: string; end_date: string | null; discreet: boolean; active: boolean;
};
type Dose = { medication_id: string; status: string };

const ANSWER_DAYS = 3;

function consentState(c: Consent | null): { key: string; text: string } {
  if (!c) return { key: "none", text: "Not asked yet" };
  const d = (iso: string) => new Date(iso).toLocaleDateString();
  if (c.withdrawn_at) return { key: "withdrawn", text: `Stopped on ${d(c.withdrawn_at)}` };
  if (c.consented_at) return { key: "active", text: `Agreed in the chat on ${d(c.consented_at)}` };
  if (c.declined_at) return { key: "declined", text: `Declined on ${d(c.declined_at)}` };
  const expired = Date.now() - Date.parse(c.requested_at) > ANSWER_DAYS * 24 * 3600_000;
  return expired
    ? { key: "no_answer", text: `No answer to the request of ${d(c.requested_at)}` }
    : { key: "pending", text: `Waiting for the patient's answer (asked ${d(c.requested_at)})` };
}

const hhmm = (t: string) => t.slice(0, 5);
const label12 = (t: string) => {
  const [h, m] = t.split(":").map(Number);
  return `${((h + 11) % 12) + 1}:${String(m).padStart(2, "0")} ${h < 12 ? "AM" : "PM"}`;
};

export default function MedicinesSection({ patientId, clinicId, canMessage }: {
  patientId: string; clinicId: string; canMessage: boolean;
}) {
  // Front desk sees medicines but can't change them (the database enforces it too).
  const canEdit = canManageCare(useSession().clinicalRole);
  const [consent, setConsent] = useState<Consent | null>(null);
  const [meds, setMeds] = useState<Medication[]>([]);
  const [doses, setDoses] = useState<Dose[]>([]);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState("");
  const [adding, setAdding] = useState(false);
  const [form, setForm] = useState({ name: "", dose: "", instructions: "", times: ["08:00"], start: "", end: "", discreet: false });

  const load = useCallback(async () => {
    const since = new Date(Date.now() - 30 * 24 * 3600_000).toISOString();
    const [{ data: c }, { data: m }, { data: d }] = await Promise.all([
      supabase.from("care_consents").select("requested_at, consented_at, declined_at, withdrawn_at")
        .eq("patient_id", patientId).order("requested_at", { ascending: false }).limit(1),
      supabase.from("medications")
        .select("id, name, dose, instructions, times_of_day, start_date, end_date, discreet, active")
        .eq("patient_id", patientId).order("active", { ascending: false }).order("created_at", { ascending: false }),
      supabase.from("medication_doses").select("medication_id, status")
        .eq("patient_id", patientId).gte("due_at", since),
    ]);
    setConsent(((c ?? []) as Consent[])[0] ?? null);
    setMeds((m as Medication[]) ?? []);
    setDoses((d as Dose[]) ?? []);
  }, [patientId]);

  useEffect(() => { load(); }, [load]);

  const state = consentState(consent);

  async function askConsent() {
    setBusy(true); setMsg("");
    const { error } = await callFunction("care-plan", { action: "request_consent", patient_id: patientId });
    setBusy(false);
    setMsg(error ? error : "Sent. The patient answers YES or NO in their chat app.");
    load();
  }

  async function stopReminders() {
    if (!confirm("Stop medicine reminders for this patient? Their medicine list stays.")) return;
    setBusy(true);
    const { error } = await callFunction("care-plan", { action: "withdraw", patient_id: patientId });
    setBusy(false);
    setMsg(error ? error : "Medicine reminders stopped.");
    load();
  }

  async function addMedicine() {
    const times = [...new Set(form.times.filter(Boolean))].sort();
    if (!form.name.trim()) { setMsg("Enter the medicine name."); return; }
    if (!times.length) { setMsg("Add at least one time."); return; }
    if (times.some((t) => t < "05:00" || t > "23:00")) { setMsg("Reminder times must be between 5:00 AM and 11:00 PM."); return; }
    if (form.end && form.start && form.end < form.start) { setMsg("The end date is before the start date."); return; }
    setBusy(true); setMsg("");
    const { error } = await supabase.from("medications").insert({
      clinic_id: clinicId, patient_id: patientId,
      name: form.name.trim(), dose: form.dose.trim() || null, instructions: form.instructions.trim() || null,
      times_of_day: times, start_date: form.start || undefined, end_date: form.end || null, discreet: form.discreet,
    });
    setBusy(false);
    if (error) { setMsg(`Couldn't save: ${error.message}`); return; }
    setForm({ name: "", dose: "", instructions: "", times: ["08:00"], start: "", end: "", discreet: false });
    setAdding(false);
    setMsg("Medicine added.");
    load();
  }

  async function stopMedicine(m: Medication) {
    if (!confirm(`Stop reminders for ${m.name}?`)) return;
    await supabase.from("medications").update({ active: false }).eq("id", m.id);
    load();
  }

  function adherence(id: string): string {
    const answered = doses.filter((d) => d.medication_id === id && ["taken", "skipped", "missed"].includes(d.status));
    if (!answered.length) return "—";
    const taken = answered.filter((d) => d.status === "taken").length;
    return `${taken} of ${answered.length} taken`;
  }

  return (
    <>
      <h2>Medicines</h2>
      {msg && <p role="status">{msg}</p>}
      <div className="form-card" style={{ maxWidth: 760 }}>
        <div className="row-actions" style={{ justifyContent: "space-between" }}>
          <div>
            <strong>Medicine reminders by chat</strong>
            <div className={`small ${state.key === "active" ? "" : "muted"}`}>{state.text}</div>
          </div>
          <div className="row-actions">
            {state.key === "active" ? (
              <button className="secondary" disabled={busy} onClick={stopReminders}>Stop reminders</button>
            ) : canMessage && canEdit ? (
              <button className="secondary" disabled={busy} onClick={askConsent}>
                {state.key === "pending" ? "Ask again" : "Ask patient to agree"}
              </button>
            ) : null}
          </div>
        </div>
        {state.key !== "active" && (
          <p className="small muted" style={{ marginBottom: 0 }}>
            Reminders start only after the patient replies YES in their chat app. The request explains what is sent and
            saved, and that they can stop any time with STOP REMINDERS.
            {!canMessage && " Connect the patient to a chat app first (Invite to chat)."}
          </p>
        )}
      </div>

      <table style={{ marginTop: 12 }}>
        <thead><tr><th>Medicine</th><th>Times</th><th>Dates</th><th>Last 30 days</th><th></th></tr></thead>
        <tbody>
          {meds.map((m) => (
            <tr key={m.id} className={m.active ? undefined : "row-muted"}>
              <td>
                <strong>{m.name}</strong>{m.dose ? `, ${m.dose}` : ""}
                {m.instructions && <div className="small muted">{m.instructions}</div>}
                {m.discreet && <div className="small muted">Discreet: name not shown in chat</div>}
              </td>
              <td>{m.times_of_day.map((t) => label12(hhmm(t))).join(", ")}</td>
              <td className="small">
                From {new Date(`${m.start_date}T00:00`).toLocaleDateString()}
                {m.end_date ? ` to ${new Date(`${m.end_date}T00:00`).toLocaleDateString()}` : ", ongoing"}
              </td>
              <td>{adherence(m.id)}</td>
              <td>{!m.active ? "Stopped" : canEdit ? <button className="link" onClick={() => stopMedicine(m)}>Stop</button> : ""}</td>
            </tr>
          ))}
          {!meds.length && <tr><td colSpan={5} className="empty">No medicines yet.</td></tr>}
        </tbody>
      </table>

      {!canEdit ? (
        <p className="small muted" style={{ marginTop: 10 }}>A nurse or doctor adds and stops medicines.</p>
      ) : !adding ? (
        <div className="row-actions" style={{ marginTop: 10 }}>
          <button className="secondary" onClick={() => setAdding(true)}>Add medicine</button>
        </div>
      ) : (
        <div className="form-card" style={{ marginTop: 12, maxWidth: 640 }}>
          <p className="small muted" style={{ marginTop: 0 }}>Enter exactly what the doctor prescribed.</p>
          <label htmlFor="med-name">Medicine (generic name, brand optional)</label>
          <input id="med-name" placeholder="Amlodipine (Norvasc)" value={form.name}
                 onChange={(e) => setForm({ ...form, name: e.target.value })} />
          <label htmlFor="med-dose">Dose</label>
          <input id="med-dose" placeholder="5 mg, 1 tablet" value={form.dose}
                 onChange={(e) => setForm({ ...form, dose: e.target.value })} />
          <label htmlFor="med-instr">Instructions (optional)</label>
          <input id="med-instr" placeholder="after breakfast" value={form.instructions}
                 onChange={(e) => setForm({ ...form, instructions: e.target.value })} />
          <label>Reminder times</label>
          <div className="row-actions">
            {form.times.map((t, i) => (
              <span key={i} className="row-actions">
                <input type="time" style={{ width: "auto" }} value={t} aria-label={`Time ${i + 1}`}
                       onChange={(e) => setForm({ ...form, times: form.times.map((x, j) => (j === i ? e.target.value : x)) })} />
                {form.times.length > 1 && (
                  <button type="button" className="link" aria-label={`Remove time ${i + 1}`}
                          onClick={() => setForm({ ...form, times: form.times.filter((_, j) => j !== i) })}>×</button>
                )}
              </span>
            ))}
            {form.times.length < 6 && (
              <button type="button" className="link" onClick={() => setForm({ ...form, times: [...form.times, "20:00"] })}>
                + Add time
              </button>
            )}
          </div>
          <div className="row-actions" style={{ marginTop: 4 }}>
            <span><label htmlFor="med-start">Start</label>
              <input id="med-start" type="date" value={form.start} onChange={(e) => setForm({ ...form, start: e.target.value })} /></span>
            <span><label htmlFor="med-end">End (optional)</label>
              <input id="med-end" type="date" value={form.end} onChange={(e) => setForm({ ...form, end: e.target.value })} /></span>
          </div>
          <label style={{ display: "flex", gap: 8, alignItems: "center", marginTop: 12 }}>
            <input type="checkbox" style={{ width: "auto" }} checked={form.discreet}
                   onChange={(e) => setForm({ ...form, discreet: e.target.checked })} />
            Discreet: don't show the medicine name in chat (shared phones)
          </label>
          <div className="row-actions" style={{ marginTop: 12 }}>
            <button disabled={busy} onClick={addMedicine}>Save medicine</button>
            <button className="link" onClick={() => setAdding(false)}>Cancel</button>
          </div>
        </div>
      )}
    </>
  );
}
