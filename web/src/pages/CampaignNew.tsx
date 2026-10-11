import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { supabase } from "../lib/supabase";
import { useSession } from "../lib/session";
import { useClinic } from "../lib/clinic";
import { CAMPAIGN_TYPES, type Provider, type Patient, type AppointmentTypeAssistant, type OutreachMode } from "../lib/types";

export default function CampaignNew() {
  const { session } = useSession();
  const { activeClinicId } = useClinic();
  const navigate = useNavigate();

  const [providers, setProviders] = useState<Provider[]>([]);
  const [patients, setPatients] = useState<Patient[]>([]);
  const [assistants, setAssistants] = useState<AppointmentTypeAssistant[]>([]);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [patientFilter, setPatientFilter] = useState("");
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState("");
  const [form, setForm] = useState({
    name: "", appointment_type: CAMPAIGN_TYPES[0].value, greeting_context: "",
    provider_id: "", slot_length_minutes: 30, scheduled_start: "",
    outreach_mode: "call" as OutreachMode, chat_reminder_hours: 24,
  });
  const chat = form.outreach_mode === "chat";

  useEffect(() => {
    if (!activeClinicId) return;
    supabase.from("providers").select("*").eq("clinic_id", activeClinicId).eq("active", true)
      .then(({ data }) => setProviders((data as Provider[]) ?? []));
    supabase.from("patients").select("*").eq("clinic_id", activeClinicId)
      .eq("do_not_call", false).eq("active", true).order("last_name", { ascending: true }).limit(500)
      .then(({ data }) => setPatients((data as Patient[]) ?? []));
    supabase.from("appointment_type_assistants").select("*")
      .eq("clinic_id", activeClinicId).eq("active", true)
      .then(({ data }) => setAssistants((data as AppointmentTypeAssistant[]) ?? []));
  }, [activeClinicId]);

  // Resolve the Telnyx assistant configured for a campaign type in Clinic
  // settings (appointment_type_assistants). Null → the default assistant.
  function resolveAssistantId(appointmentType: string): string | null {
    const match = assistants.find((a) => a.appointment_type === appointmentType);
    return match?.telnyx_assistant_id ?? null;
  }

  const filteredPatients = useMemo(() => {
    const q = patientFilter.trim().toLowerCase();
    if (!q) return patients;
    return patients.filter((p) =>
      `${p.first_name} ${p.last_name} ${p.phone}`.toLowerCase().includes(q));
  }, [patients, patientFilter]);

  function togglePatient(id: string) {
    const next = new Set(selected);
    next.has(id) ? next.delete(id) : next.add(id);
    setSelected(next);
  }

  async function create(status: "draft" | "scheduled") {
    if (!form.name || !form.greeting_context) { setErr("Name and reason are required."); return; }
    if (chat && !(form.chat_reminder_hours >= 1 && form.chat_reminder_hours <= 168)) {
      setErr("Reminder time must be between 1 and 168 hours."); return;
    }
    if (status === "scheduled" && !form.scheduled_start) { setErr("Pick a start time to schedule."); return; }
    setSaving(true); setErr("");

    const appointmentType = form.appointment_type;
    const assistantId = resolveAssistantId(appointmentType);

    const { data, error } = await supabase.from("campaigns").insert({
      clinic_id: activeClinicId,
      name: form.name,
      appointment_type: appointmentType,
      greeting_context: form.greeting_context,
      provider_id: form.provider_id || null,
      slot_length_minutes: form.slot_length_minutes,
      telnyx_assistant_id: chat ? null : assistantId,
      outreach_mode: form.outreach_mode,
      chat_reminder_hours: form.chat_reminder_hours,
      status,
      scheduled_start: status === "scheduled" ? new Date(form.scheduled_start).toISOString() : null,
      created_by: session?.user?.id ?? null,
    }).select("id").single();

    if (error) { setSaving(false); setErr(error.message); return; }

    // Queue any selected patients onto the new campaign.
    if (selected.size) {
      const rows = [...selected].map((patient_id) => ({ campaign_id: data.id, patient_id }));
      const { error: assignErr } = await supabase.from("campaign_patients")
        .upsert(rows, { onConflict: "campaign_id,patient_id", ignoreDuplicates: true });
      if (assignErr) {
        setSaving(false);
        setErr(`Campaign created, but adding patients failed: ${assignErr.message}`);
        navigate(`/campaigns/${data.id}`);
        return;
      }
    }

    setSaving(false);
    navigate(`/campaigns/${data.id}`);
  }

  return (
    <>
      <h1>New campaign</h1>
      <div className="form-card">
        <label htmlFor="c-name">Name</label>
        <input id="c-name" value={form.name} placeholder="Annual Wellness Visits"
               onChange={(e) => setForm({ ...form, name: e.target.value })} />

        <label htmlFor="c-mode">How to reach patients</label>
        <select id="c-mode" value={form.outreach_mode}
                onChange={(e) => setForm({ ...form, outreach_mode: e.target.value as OutreachMode })}>
          <option value="call">AI phone calls</option>
          <option value="chat">Chat message with a booking link</option>
        </select>
        <p className="muted small">
          {chat
            ? "Each patient gets a booking link on their chat app (or by SMS if they agreed to texts). No calls. Patients who haven't connected a chat app are listed as Needs chat invite."
            : "The AI calls each patient within calling hours, after an optional heads-up text."}
        </p>

        {chat && (
          <>
            <label htmlFor="c-remind">Send one reminder after (hours)</label>
            <input id="c-remind" type="number" min={1} max={168} value={form.chat_reminder_hours}
                   onChange={(e) => setForm({ ...form, chat_reminder_hours: Number(e.target.value) })} />
            <p className="muted small">
              If the patient hasn't booked by then, they get one reminder. After the same time
              again with no booking, they're marked as no answer.
            </p>
          </>
        )}

        <label htmlFor="c-type">Campaign type</label>
        <select id="c-type" value={form.appointment_type}
                onChange={(e) => setForm({ ...form, appointment_type: e.target.value })}>
          {CAMPAIGN_TYPES.map((t) => <option key={t.value} value={t.value}>{t.label}</option>)}
        </select>
        {!chat && <p className="muted small">
          {resolveAssistantId(form.appointment_type)
            ? "Answered by this type's configured Telnyx AI assistant."
            : "No Telnyx assistant configured for this type in Clinic settings — uses the default assistant."}
        </p>}

        <label htmlFor="c-provider">Clinician (blank = patient's own)</label>
        <select id="c-provider" value={form.provider_id}
                onChange={(e) => setForm({ ...form, provider_id: e.target.value })}>
          <option value="">Patient's own clinician</option>
          {providers.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
        </select>

        <label htmlFor="c-slot">Slot length (minutes)</label>
        <input id="c-slot" type="number" min={10} step={5} value={form.slot_length_minutes}
               onChange={(e) => setForm({ ...form, slot_length_minutes: Number(e.target.value) })} />

        <label htmlFor="c-context">{chat ? "Reason in the message to the patient" : "Reason the AI gives the patient"}</label>
        <textarea id="c-context" rows={3} value={form.greeting_context}
                  placeholder="Dr. Jones would like to schedule your annual wellness visit."
                  onChange={(e) => setForm({ ...form, greeting_context: e.target.value })} />

        <label htmlFor="c-sched">Schedule start (optional)</label>
        <input id="c-sched" type="datetime-local" value={form.scheduled_start}
               onChange={(e) => setForm({ ...form, scheduled_start: e.target.value })} />

        <label style={{ marginTop: 8 }}>Patients ({selected.size} selected)</label>
        <input placeholder="Filter by name or phone…" value={patientFilter}
               onChange={(e) => setPatientFilter(e.target.value)} />
        <div className="scroll-box" style={{ maxHeight: 220, marginTop: 8 }}>
          <table>
            <thead><tr><th></th><th>Name</th><th>Phone</th></tr></thead>
            <tbody>
              {filteredPatients.map((p) => (
                <tr key={p.id}>
                  <td><input type="checkbox" style={{ width: "auto" }} checked={selected.has(p.id)}
                             onChange={() => togglePatient(p.id)}
                             aria-label={`Select ${p.first_name} ${p.last_name}`} /></td>
                  <td>{p.first_name} {p.last_name}</td>
                  <td>{p.phone}</td>
                </tr>
              ))}
              {!filteredPatients.length && (
                <tr><td colSpan={3} className="empty">No matching patients.</td></tr>
              )}
            </tbody>
          </table>
        </div>

        {err && <p className="auth-err" role="alert">{err}</p>}

        <div className="row-actions" style={{ marginTop: 14 }}>
          <button disabled={saving} onClick={() => create("draft")}>
            {saving ? "Saving…" : "Save as draft"}
          </button>
          <button className="secondary" disabled={saving} onClick={() => create("scheduled")}>
            Schedule
          </button>
          <button className="secondary" disabled={saving} onClick={() => navigate("/campaigns")}>
            Cancel
          </button>
        </div>
      </div>
    </>
  );
}
