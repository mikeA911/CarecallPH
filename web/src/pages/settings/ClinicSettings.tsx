import { useEffect, useState } from "react";
import { supabase } from "../../lib/supabase";
import { useClinic } from "../../lib/clinic";
import { normalizePhPhone } from "../../lib/phone";
import { CAMPAIGN_TYPES, type Clinic, type AppointmentTypeAssistant } from "../../lib/types";

const DAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
type Hours = Record<string, { start: string; end: string } | null>;

export default function ClinicSettings() {
  const { activeClinicId } = useClinic();
  const [clinic, setClinic] = useState<Clinic | null>(null);
  const [hours, setHours] = useState<Hours>({});
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState("");

  // Campaign type -> Telnyx assistant ID (keyed by appointment_type).
  const [assistantIds, setAssistantIds] = useState<Record<string, string>>({});
  const [savingAssistants, setSavingAssistants] = useState(false);
  const [assistantMsg, setAssistantMsg] = useState("");

  useEffect(() => {
    if (!activeClinicId) return;
    supabase.from("clinics").select("*").eq("id", activeClinicId).single().then(({ data }) => {
      const c = data as Clinic;
      setClinic(c);
      setHours((c?.calling_hours as Hours) ?? {});
    });
    supabase.from("appointment_type_assistants").select("*").eq("clinic_id", activeClinicId)
      .then(({ data }) => {
        const map: Record<string, string> = {};
        for (const row of (data as AppointmentTypeAssistant[]) ?? []) {
          map[row.appointment_type] = row.telnyx_assistant_id;
        }
        setAssistantIds(map);
      });
  }, [activeClinicId]);

  async function saveAssistants() {
    if (!activeClinicId) return;
    setSavingAssistants(true); setAssistantMsg("");
    // Upsert one row per configured campaign type that has an assistant ID.
    const rows = CAMPAIGN_TYPES
      .filter((t) => (assistantIds[t.value] ?? "").trim())
      .map((t) => ({
        clinic_id: activeClinicId,
        appointment_type: t.value,
        label: t.label,
        telnyx_assistant_id: assistantIds[t.value].trim(),
        active: true,
      }));
    if (!rows.length) {
      setSavingAssistants(false);
      setAssistantMsg("Enter at least one Telnyx assistant ID to save.");
      return;
    }
    const { error } = await supabase.from("appointment_type_assistants")
      .upsert(rows, { onConflict: "clinic_id,appointment_type" });
    setSavingAssistants(false);
    setAssistantMsg(error ? `Failed: ${error.message}` : "Campaign type assistants saved.");
  }

  function setDay(weekday: number, open: boolean) {
    setHours((h) => ({ ...h, [weekday]: open ? (h[weekday] ?? { start: "08:00", end: "18:00" }) : null }));
  }
  function setTime(weekday: number, which: "start" | "end", value: string) {
    setHours((h) => ({ ...h, [weekday]: { ...(h[weekday] ?? { start: "08:00", end: "18:00" }), [which]: value } }));
  }

  async function save() {
    if (!clinic) return;
    // Callback number is optional; when given it may be a mobile or a landline.
    let phoneCallback: string | null = null;
    if (clinic.phone_callback?.trim()) {
      const parsed = normalizePhPhone(clinic.phone_callback, { allowLandline: true });
      if (!parsed.ok) { setMsg(`Callback phone number: ${parsed.error}`); return; }
      phoneCallback = parsed.e164;
    }
    setSaving(true);
    const { error } = await supabase.from("clinics").update({
      name: clinic.name,
      phone_callback: phoneCallback,
      timezone: clinic.timezone,
      calling_hours: hours,
      sms_fallback: clinic.sms_fallback,
      sms_precall_lead_seconds: clinic.sms_precall_lead_seconds,
      greeting_default: clinic.greeting_default,
    }).eq("id", clinic.id);
    setSaving(false);
    if (!error) setClinic({ ...clinic, phone_callback: phoneCallback });
    setMsg(error ? `Failed: ${error.message}` : "Clinic settings saved.");
  }

  if (!clinic) return <p className="empty">Loading…</p>;

  return (
    <>
      <h1>Clinic settings</h1>
      {msg && <p role="status">{msg}</p>}

      <div className="form-card" style={{ maxWidth: 640 }}>
        <label>Display name</label>
        <input value={clinic.name} onChange={(e) => setClinic({ ...clinic, name: e.target.value })} />

        <label>Callback phone number</label>
        <input value={clinic.phone_callback ?? ""} placeholder="0917 123 4567 or 02 8123 4567"
               onChange={(e) => setClinic({ ...clinic, phone_callback: e.target.value })} />

        <label>Timezone (IANA)</label>
        <input value={clinic.timezone} placeholder="Asia/Manila"
               onChange={(e) => setClinic({ ...clinic, timezone: e.target.value })} />

        <label>Default greeting context</label>
        <textarea rows={2} value={clinic.greeting_default ?? ""}
                  onChange={(e) => setClinic({ ...clinic, greeting_default: e.target.value })} />

        <label style={{ display: "flex", gap: 8, alignItems: "center", marginTop: 12 }}>
          <input type="checkbox" style={{ width: "auto" }} checked={clinic.sms_fallback}
                 onChange={(e) => setClinic({ ...clinic, sms_fallback: e.target.checked })} />
          Send SMS fallback when a call reaches voicemail
        </label>

        <h2>Pre-call text message</h2>
        <p className="muted small">
          Text patients a heads-up a couple of minutes before the AI calls, so a
          text from this number arrives first and improves answer rates. Requires
          patient SMS consent. Turn off to call without a pre-call text.
        </p>
        <label style={{ display: "flex", gap: 8, alignItems: "center" }}>
          <input type="checkbox" style={{ width: "auto" }}
                 checked={(clinic.sms_precall_lead_seconds ?? 0) > 0}
                 onChange={(e) => setClinic({
                   ...clinic,
                   // Enabling defaults to 120s; disabling stores 0 (off for this clinic).
                   sms_precall_lead_seconds: e.target.checked ? (clinic.sms_precall_lead_seconds || 120) : 0,
                 })} />
          Send a pre-call text message
        </label>
        {(clinic.sms_precall_lead_seconds ?? 0) > 0 && (
          <>
            <label htmlFor="lead-secs">Lead time before the call (seconds, 60–600)</label>
            <input id="lead-secs" type="number" min={60} max={600} step={30}
                   value={clinic.sms_precall_lead_seconds ?? 120}
                   onChange={(e) => setClinic({
                     ...clinic,
                     sms_precall_lead_seconds: Math.min(600, Math.max(60, Number(e.target.value) || 120)),
                   })} />
          </>
        )}

        <h2>Calling hours (clinic-local)</h2>
        <p className="muted small">Outbound calls only fire inside these windows. Days left closed are never dialed.</p>
        {DAYS.map((label, weekday) => {
          const day = hours[weekday];
          return (
            <div key={weekday} className="hours-row">
              <label style={{ display: "flex", gap: 8, alignItems: "center", width: 120, margin: 0 }}>
                <input type="checkbox" style={{ width: "auto" }} checked={!!day} onChange={(e) => setDay(weekday, e.target.checked)} />
                {label}
              </label>
              {day ? (
                <>
                  <input type="time" value={day.start} onChange={(e) => setTime(weekday, "start", e.target.value)} />
                  <span>–</span>
                  <input type="time" value={day.end} onChange={(e) => setTime(weekday, "end", e.target.value)} />
                </>
              ) : <span className="muted">closed</span>}
            </div>
          );
        })}

        <div style={{ marginTop: 16 }}>
          <button onClick={save} disabled={saving}>{saving ? "Saving…" : "Save settings"}</button>
        </div>
      </div>

      <div className="form-card" style={{ maxWidth: 640, marginTop: 20 }}>
        <h2>Campaign types &amp; Telnyx assistants</h2>
        <p className="muted small">
          Each campaign type is answered by its own Telnyx AI assistant. Enter the
          assistant ID for each type; calls for that campaign type will start that
          assistant. Types left blank fall back to the default assistant. More
          types will appear here as they are added.
        </p>
        {assistantMsg && <p role="status">{assistantMsg}</p>}

        {CAMPAIGN_TYPES.map((t) => (
          <div key={t.value} style={{ marginBottom: 10 }}>
            <label htmlFor={`asst-${t.value}`}>{t.label}</label>
            <input id={`asst-${t.value}`} value={assistantIds[t.value] ?? ""}
                   placeholder="Telnyx assistant ID (e.g. assistant-…)"
                   onChange={(e) => setAssistantIds({ ...assistantIds, [t.value]: e.target.value })} />
          </div>
        ))}

        <div style={{ marginTop: 12 }}>
          <button onClick={saveAssistants} disabled={savingAssistants}>
            {savingAssistants ? "Saving…" : "Save assistant IDs"}
          </button>
        </div>
      </div>
    </>
  );
}
