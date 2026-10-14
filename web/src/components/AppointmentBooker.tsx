// Staff booking (user stories FD-03, FD-04): pick a clinician and an open
// slot to book, reschedule or cancel an appointment for a patient. Slots come
// from get_available_slots (opening hours, holidays, closures, existing
// bookings); the database's no-double-booking rule settles any race. A
// reschedule is one update, so the old time is freed as the new one is taken,
// and reminders follow the new time.
import { useCallback, useEffect, useState } from "react";
import { supabase } from "../lib/supabase";

type Provider = { id: string; name: string; specialty: string | null };
type Slot = { slot_start: string; slot_end: string };
export type Bookable = { id: string; starts_at: string; provider_id: string | null };

const DAYS_SHOWN = 7;

function localDate(d: Date, tz: string) {
  return d.toLocaleDateString("en-CA", { timeZone: tz });
}
function addDays(ymd: string, n: number) {
  const d = new Date(`${ymd}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

/** Book a new appointment, or move `existing` to another slot. */
export function SlotPicker({ patientId, clinicId, tz, existing, onDone, onCancel }: {
  patientId: string; clinicId: string; tz: string; existing?: Bookable | null;
  onDone: (msg: string) => void; onCancel: () => void;
}) {
  const [providers, setProviders] = useState<Provider[]>([]);
  const [providerId, setProviderId] = useState(existing?.provider_id ?? "");
  const [from, setFrom] = useState(() => localDate(new Date(), tz));
  const [slots, setSlots] = useState<Slot[] | null>(null);
  const [chosen, setChosen] = useState<Slot | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");

  useEffect(() => {
    supabase.from("providers").select("id, name, specialty").eq("clinic_id", clinicId).eq("active", true).order("name")
      .then(({ data }) => {
        const list = (data ?? []) as Provider[];
        setProviders(list);
        if (!providerId && list.length === 1) setProviderId(list[0].id);
      });
  }, [clinicId]); // eslint-disable-line react-hooks/exhaustive-deps

  const loadSlots = useCallback(async () => {
    if (!providerId) { setSlots(null); return; }
    setSlots(null); setChosen(null);
    const { data, error } = await supabase.rpc("get_available_slots", {
      p_provider_id: providerId, p_from: from, p_days: DAYS_SHOWN, p_limit: 200, p_tz: tz,
    });
    if (error) { setErr(`Couldn't load times: ${error.message}`); setSlots([]); return; }
    setSlots((data ?? []) as Slot[]);
  }, [providerId, from, tz]);
  useEffect(() => { loadSlots(); }, [loadSlots]);

  const fmtDay = (iso: string) => new Date(iso).toLocaleDateString(undefined, { timeZone: tz, weekday: "short", month: "short", day: "numeric" });
  const fmtTime = (iso: string) => new Date(iso).toLocaleTimeString(undefined, { timeZone: tz, hour: "numeric", minute: "2-digit" });
  const byDay = new Map<string, Slot[]>();
  for (const s of slots ?? []) {
    const k = localDate(new Date(s.slot_start), tz);
    byDay.set(k, [...(byDay.get(k) ?? []), s]);
  }

  async function confirm() {
    if (!chosen || !providerId) return;
    setBusy(true); setErr("");
    const fields = { provider_id: providerId, starts_at: chosen.slot_start, ends_at: chosen.slot_end };
    const { error } = existing
      ? await supabase.from("appointments").update(fields).eq("id", existing.id)
      : await supabase.from("appointments").insert({ ...fields, patient_id: patientId, status: "booked", source: "staff" });
    setBusy(false);
    if (error) {
      if (error.code === "23P01") { setErr("Someone just took that time. Here are the times still open."); loadSlots(); return; }
      setErr(`Couldn't save: ${error.message}`); return;
    }
    const prov = providers.find((p) => p.id === providerId)?.name ?? "the clinician";
    onDone(`${existing ? "Moved to" : "Booked:"} ${fmtDay(chosen.slot_start)}, ${fmtTime(chosen.slot_start)} with ${prov}. ` +
      "Chat reminders go out 24 hours and 2 hours before.");
  }

  return (
    <div className="form-card" style={{ marginTop: 12, maxWidth: 760 }}>
      <strong>{existing ? "Reschedule appointment" : "Book an appointment"}</strong>
      {existing && <div className="small muted">Now: {fmtDay(existing.starts_at)}, {fmtTime(existing.starts_at)}</div>}
      <div className="row-actions" style={{ marginTop: 8 }}>
        <span><label htmlFor="bk-prov">Clinician</label>
          <select id="bk-prov" value={providerId} onChange={(e) => setProviderId(e.target.value)}>
            <option value="">Choose…</option>
            {providers.map((p) => <option key={p.id} value={p.id}>{p.name}{p.specialty ? ` (${p.specialty})` : ""}</option>)}
          </select></span>
        <span><label htmlFor="bk-from">From</label>
          <input id="bk-from" type="date" value={from} min={localDate(new Date(), tz)} onChange={(e) => e.target.value && setFrom(e.target.value)} /></span>
        <span style={{ alignSelf: "flex-end" }}>
          <button type="button" className="link" onClick={() => setFrom(addDays(from, DAYS_SHOWN))}>Next {DAYS_SHOWN} days →</button>
        </span>
      </div>
      {!providers.length && <p className="small muted">No active clinicians. A clinic admin adds them under Clinicians.</p>}
      {providerId && slots === null && <p className="small muted">Loading open times…</p>}
      {slots && !slots.length && (
        <p className="small muted">No open times from {fmtDay(`${from}T12:00:00Z`)} for {DAYS_SHOWN} days (hours, holidays and closures apply). Try the next days.</p>
      )}
      {[...byDay.entries()].map(([day, list]) => (
        <div key={day} style={{ marginTop: 8 }}>
          <div className="small"><strong>{fmtDay(list[0].slot_start)}</strong></div>
          <div className="row-actions" style={{ flexWrap: "wrap", gap: 6 }}>
            {list.map((s) => (
              <button key={s.slot_start} type="button" className={chosen?.slot_start === s.slot_start ? "" : "secondary"}
                      aria-pressed={chosen?.slot_start === s.slot_start} onClick={() => setChosen(s)}>
                {fmtTime(s.slot_start)}
              </button>
            ))}
          </div>
        </div>
      ))}
      {err && <p role="alert" className="small">{err}</p>}
      <div className="row-actions" style={{ marginTop: 12 }}>
        <button disabled={!chosen || busy} onClick={confirm}>
          {busy ? "Saving…" : chosen ? `${existing ? "Move to" : "Book"} ${fmtDay(chosen.slot_start)}, ${fmtTime(chosen.slot_start)}` : existing ? "Pick a new time" : "Pick a time"}
        </button>
        <button className="link" onClick={onCancel}>Close</button>
      </div>
    </div>
  );
}

/** Cancel an upcoming appointment; the time opens up again for others. */
export async function cancelAppointment(id: string): Promise<string | null> {
  const { error } = await supabase.from("appointments").update({ status: "cancelled" }).eq("id", id);
  return error ? `Couldn't cancel: ${error.message}` : null;
}
