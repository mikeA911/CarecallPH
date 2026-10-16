import { useEffect, useState } from "react";
import AddressFields, { addressForSave, addressText } from "../../components/AddressFields";
import { callFunction } from "../../lib/api";
import RetentionSection from "../../components/RetentionSection";
import HolidaysSection from "../../components/HolidaysSection";
import ContactHistorySection from "../../components/ContactHistorySection";
import { supabase } from "../../lib/supabase";
import { useClinic } from "../../lib/clinic";
import { normalizePhPhone } from "../../lib/phone";
import { CAMPAIGN_TYPES, type Clinic, type AppointmentTypeAssistant } from "../../lib/types";

const DAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
type Hours = Record<string, { start: string; end: string } | null>;

/** Link name as typed → web-safe: "CareCall Test Site" → "carecall-test-site". */
function toSlug(typed: string, finished = false): string {
  const s = typed.normalize("NFD").replace(/[\u0300-\u036f]/g, "") // drop accents: "Ñiño" → "Nino"
    .toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+/, "").slice(0, 41);
  return finished ? s.replace(/-+$/, "") : s; // keep a trailing dash while typing
}

/** A new public link name: clinic name + 4 random digits, e.g. "carecall-test-site-4821". */
function newSlug(clinicName: string): string {
  const base = toSlug(clinicName, true).slice(0, 35).replace(/-+$/, "") || "clinic";
  return `${base}-${1000 + Math.floor(Math.random() * 9000)}`;
}

const SLUG_OK = /^[a-z0-9][a-z0-9-]{1,40}$/;

export default function ClinicSettings() {
  const { activeClinicId } = useClinic();
  const [clinic, setClinic] = useState<Clinic | null>(null);
  const [hours, setHours] = useState<Hours>({});
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState("");
  const [editLink, setEditLink] = useState(false);

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
    let slug = toSlug(clinic.public_slug ?? "", true);
    if (slug && !SLUG_OK.test(slug)) {
      setMsg("Link name: use at least 2 letters or numbers, e.g. santos-family-clinic.");
      return;
    }
    // Turning the symptom check or the sign-up page on for the first time creates the link.
    const autoSlug = (!!clinic.symptom_check_enabled || !!clinic.signup_enabled) && !slug;
    setSaving(true);
    let error: { code?: string; message: string } | null = null;
    for (let attempt = 0; attempt < 4; attempt++) {
      if (autoSlug) slug = newSlug(clinic.name);
      ({ error } = await saveClinic(slug, phoneCallback));
      if (!(autoSlug && error?.code === "23505")) break; // random number taken: try another
    }
    setSaving(false);
    if (!error) {
      setClinic({ ...clinic, phone_callback: phoneCallback, public_slug: slug || null });
      setEditLink(false);
    }
    const taken = error?.code === "23505" ? "That link name is already used by another clinic. Try another." : null;
    setMsg(error ? taken ?? `Failed: ${error.message}` : "Clinic settings saved.");
  }

  async function saveClinic(slug: string, phoneCallback: string | null): Promise<{ error: { code?: string; message: string } | null }> {
    const c = clinic!;
    const { data, error } = await supabase.from("clinics").update({
      name: c.name,
      phone_callback: phoneCallback,
      timezone: c.timezone,
      calling_hours: hours,
      sms_fallback: c.sms_fallback,
      sms_precall_lead_seconds: c.sms_precall_lead_seconds,
      greeting_default: c.greeting_default,
      self_booking_enabled: c.self_booking_enabled,
      chat_optin_enabled: c.chat_optin_enabled,
      symptom_check_enabled: c.symptom_check_enabled,
      signup_enabled: !!c.signup_enabled,
      reminders_enabled: c.reminders_enabled,
      public_slug: slug || null,
      local_emergency_numbers: c.local_emergency_numbers?.trim() || null,
      nhfr_code: c.nhfr_code?.trim() || null,
      lat: c.lat ?? null,
      lng: c.lng ?? null,
      ...addressForSave(c),
    }).eq("id", c.id).select("id");
    if (error) return { error };
    // No row updated means no permission (RLS reports no error): say so.
    if (!data?.length) return { error: { message: "you don't have permission to change this clinic's settings" } };
    return { error: null };
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

        <label htmlFor="nhfr">DOH facility code (optional)</label>
        <input id="nhfr" value={clinic.nhfr_code ?? ""} placeholder="From the National Health Facility Registry"
               onChange={(e) => setClinic({ ...clinic, nhfr_code: e.target.value })} />
        <p className="small muted" style={{ marginTop: 4 }}>
          Included when patient records are exported in the national format (FHIR).
        </p>

        <AddressFields idPrefix="clinic" value={clinic} onChange={(a) => setClinic({ ...clinic, ...a })} />
        <ClinicLocation clinic={clinic} onChange={(lat, lng) => setClinic({ ...clinic, lat, lng })} />

        <label>Default greeting context</label>
        <textarea rows={2} value={clinic.greeting_default ?? ""}
                  onChange={(e) => setClinic({ ...clinic, greeting_default: e.target.value })} />

        <label style={{ display: "flex", gap: 8, alignItems: "center", marginTop: 12 }}>
          <input type="checkbox" style={{ width: "auto" }} checked={clinic.sms_fallback}
                 onChange={(e) => setClinic({ ...clinic, sms_fallback: e.target.checked })} />
          Send SMS fallback when a call reaches voicemail
        </label>

        <h2>Booking links and chat apps</h2>
        <label style={{ display: "flex", gap: 8, alignItems: "center" }}>
          <input type="checkbox" style={{ width: "auto" }} checked={!!clinic.self_booking_enabled}
                 onChange={(e) => setClinic({ ...clinic, self_booking_enabled: e.target.checked })} />
          Self-booking links in call campaigns
        </label>
        <p className="muted small">
          Adds a link to pre-call texts and lets patients reply BOOK in a chat app, so they can pick
          a time themselves. Chat campaigns always send booking links.
        </p>
        <label style={{ display: "flex", gap: 8, alignItems: "center" }}>
          <input type="checkbox" style={{ width: "auto" }} checked={!!clinic.chat_optin_enabled}
                 onChange={(e) => setClinic({ ...clinic, chat_optin_enabled: e.target.checked })} />
          Chat app invites in text messages
        </label>
        <p className="muted small">
          Adds a link to connect Viber, Messenger, WhatsApp or Telegram to SMS sent by CareCall.
          Staff can always invite a patient from their page with Invite to chat.
        </p>

        <h2>Appointment reminders</h2>
        <label style={{ display: "flex", gap: 8, alignItems: "center" }}>
          <input type="checkbox" style={{ width: "auto" }} checked={!!clinic.reminders_enabled}
                 onChange={(e) => setClinic({ ...clinic, reminders_enabled: e.target.checked })} />
          Remind patients by chat 24 hours and 2 hours before their appointment
        </label>
        <p className="muted small">
          Sent between 7 AM and 9 PM on the patient's chat app (or SMS if they agreed to texts). Patients reply
          1 to confirm, 2 to change the time, 3 to cancel. Change and cancel requests appear in CC action items.
        </p>

        <h2>Patient sign-up page</h2>
        <p className="muted small">
          New patients scan a QR poster at the front desk and register themselves: name, mobile, date of birth,
          the privacy notice, and whether they want chat messages or texts. Those who choose chat connect their
          chat app straight away. Check their details against an ID; their page shows "Signed up on the clinic's page".
        </p>
        <label style={{ display: "flex", gap: 8, alignItems: "center" }}>
          <input type="checkbox" style={{ width: "auto" }} checked={!!clinic.signup_enabled}
                 onChange={(e) => setClinic({ ...clinic, signup_enabled: e.target.checked })} />
          Let new patients sign up from a QR poster
        </label>
        {clinic.signup_enabled && !clinic.public_slug && (
          <p className="muted small">Save to create your clinic's link.</p>
        )}
        {clinic.signup_enabled && clinic.public_slug && (
          <PublicLink path="join" label="Your sign-up page" slug={toSlug(clinic.public_slug, true)} enabled />
        )}

        <h2>Symptom check and online booking</h2>
        <p className="muted small">
          Patients open one link for your clinic, answer a few questions, learn how soon to see a doctor
          and what kind, and can book a visit with your clinicians. Emergencies are sent to 911. It's not
          a diagnosis. Share the link on a QR poster, Facebook or Google Maps; Telegram users can send /check.
        </p>
        <label style={{ display: "flex", gap: 8, alignItems: "center" }}>
          <input type="checkbox" style={{ width: "auto" }} checked={!!clinic.symptom_check_enabled}
                 onChange={(e) => setClinic({ ...clinic, symptom_check_enabled: e.target.checked })} />
          Let patients check symptoms and book online
        </label>
        {clinic.symptom_check_enabled && !clinic.public_slug && (
          <p className="muted small">Save to create your clinic's link.</p>
        )}
        {clinic.public_slug && !editLink && (
          <PublicLink path="check" label="Your clinic's link" slug={toSlug(clinic.public_slug, true)}
                      enabled={!!clinic.symptom_check_enabled} onChange={() => setEditLink(true)} />
        )}
        {editLink && (
          <>
            <label htmlFor="slug">Link name</label>
            <input id="slug" value={clinic.public_slug ?? ""} placeholder="santos-family-clinic"
                   onChange={(e) => setClinic({ ...clinic, public_slug: toSlug(e.target.value) })}
                   onBlur={() => setClinic({ ...clinic, public_slug: toSlug(clinic.public_slug ?? "", true) })} />
            <p className="muted small">
              {window.location.origin}/check/{toSlug(clinic.public_slug ?? "", true)}<br />
              Spaces become dashes as you type. Save to apply. The old link and QR code stop working
              (the sign-up page's too).
            </p>
          </>
        )}
        <label htmlFor="local-em">Local emergency numbers (one per line)</label>
        <textarea id="local-em" rows={3} value={clinic.local_emergency_numbers ?? ""}
                  placeholder={"City rescue: 0917 123 4567\nNearest ER (Provincial Hospital): 032 123 4567"}
                  onChange={(e) => setClinic({ ...clinic, local_emergency_numbers: e.target.value })} />
        <p className="muted small">Shown next to 911 on the emergency screen, for areas where 911 is slow.</p>

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
        <p className="muted small">Calls and campaign messages only go out inside these windows. Days left closed get no calls or messages.</p>
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

      <HolidaysSection clinicId={clinic.id} mode={clinic.holiday_closures ?? "all"}
                       onSaved={(m) => setClinic({ ...clinic, holiday_closures: m })} />

      <RetentionSection clinicId={clinic.id} clinicYears={clinic.record_retention_years ?? null} />

      <ContactHistorySection clinicId={clinic.id} messageDays={clinic.message_retention_days ?? null}
                             callDays={clinic.call_record_retention_days ?? null} />

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

/** A clinic's public page (symptom check or sign-up), with copy and a printable QR code. */
function PublicLink({ path, label, slug, enabled, onChange }: {
  path: "check" | "join"; label: string; slug: string; enabled: boolean; onChange?: () => void;
}) {
  const url = `${window.location.origin}/${path}/${slug}`;
  const [qr, setQr] = useState<string | null>(null);
  const [note, setNote] = useState("");

  async function copy() {
    try { await navigator.clipboard.writeText(url); setNote("Link copied."); }
    catch { setNote("Copy didn't work in this browser. Select the link and copy it by hand."); }
  }
  async function showQr() {
    if (qr) { setQr(null); return; }
    // Loaded on demand so the QR library isn't in every page load.
    const { default: QRCode } = await import("qrcode");
    setQr(await QRCode.toDataURL(url, { margin: 2, width: 600 }));
  }

  return (
    <div className="public-link">
      <div className="muted small">{label}{enabled ? "" : " (turned off: patients see \"not available\")"}</div>
      <a href={url} target="_blank" rel="noreferrer" className="public-link-url">{url}</a>
      <div className="row-actions" style={{ marginTop: 8 }}>
        <button type="button" className="secondary" onClick={copy}>Copy link</button>
        <button type="button" className="secondary" onClick={showQr}>{qr ? "Hide QR code" : "Show QR code"}</button>
        {onChange && <button type="button" className="link" onClick={onChange}>Change link</button>}
      </div>
      {note && <p className="small" role="status">{note}</p>}
      {qr && (
        <div style={{ marginTop: 10 }}>
          <img src={qr} alt={`QR code for ${url}`} width={200} height={200} className="public-link-qr" />
          <div><a href={qr} download={`${slug}-${path}-qr.png`}>Download QR code (PNG) to print</a></div>
        </div>
      )}
    </div>
  );
}

/**
 * Where the clinic is, so the symptom check can list it "near you" (D1b).
 * Found from the address with Google Places; saved with the other settings.
 */
function ClinicLocation({ clinic, onChange }: { clinic: Clinic; onChange: (lat: number | null, lng: number | null) => void }) {
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState("");
  const address = addressText(clinic);
  async function find() {
    setBusy(true); setNote("");
    const { data, error } = await callFunction<{ lat: number; lng: number; label: string }>("symptom-check", {
      action: "locate_clinic", address: [clinic.name, address].filter(Boolean).join(", "),
    });
    setBusy(false);
    if (error || !data) {
      setNote(error === "place_not_found" ? "Couldn't find that address. Check the city and province." : `Couldn't look it up: ${error}`);
      return;
    }
    onChange(data.lat, data.lng);
    setNote(`Found: ${data.label}. Check the pin, then Save.`);
  }
  const has = clinic.lat != null && clinic.lng != null;
  return (
    <div style={{ marginTop: 10 }}>
      <label>Map location</label>
      <div className="row-actions">
        <button type="button" className="secondary" disabled={busy || !address} onClick={find}>
          {busy ? "Looking…" : has ? "Find again from the address" : "Find on map"}
        </button>
        {has && (
          <>
            <a href={`https://www.google.com/maps?q=${clinic.lat},${clinic.lng}`} target="_blank" rel="noreferrer">View pin</a>
            <button type="button" className="link" onClick={() => { onChange(null, null); setNote("Location removed. Save to apply."); }}>
              Remove
            </button>
          </>
        )}
      </div>
      <p className="small muted" style={{ marginTop: 4 }}>
        {note || (has ? "Set. Patients who share their location see this clinic when it's near them."
          : address ? "Not set. Lets patients who share their location find this clinic."
          : "Enter the address above first.")}
      </p>
    </div>
  );
}
