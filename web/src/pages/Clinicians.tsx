import { useCallback, useEffect, useState } from "react";
import { supabase } from "../lib/supabase";
import { useClinic } from "../lib/clinic";
import type { Provider, Availability } from "../lib/types";

const DAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

export default function Clinicians() {
  const { activeClinicId, activeClinic } = useClinic();
  const [providers, setProviders] = useState<Provider[]>([]);
  const [selected, setSelected] = useState<string | null>(null);
  const [availability, setAvailability] = useState<Availability[]>([]);
  const [newName, setNewName] = useState("");
  const [newSpecialty, setNewSpecialty] = useState("");
  const [msg, setMsg] = useState("");

  const loadProviders = useCallback(async () => {
    if (!activeClinicId) return;
    const { data } = await supabase.from("providers").select("*").eq("clinic_id", activeClinicId).order("name");
    setProviders((data as Provider[]) ?? []);
  }, [activeClinicId]);

  const loadAvailability = useCallback(async (providerId: string) => {
    const { data } = await supabase.from("provider_availability").select("*").eq("provider_id", providerId).order("weekday");
    setAvailability((data as Availability[]) ?? []);
  }, []);

  useEffect(() => { loadProviders(); }, [loadProviders]);
  useEffect(() => { if (selected) loadAvailability(selected); }, [selected, loadAvailability]);

  async function addProvider() {
    if (!newName.trim()) return;
    const { error } = await supabase.from("providers")
      .insert({ clinic_id: activeClinicId, name: newName.trim(), specialty: newSpecialty.trim() || null });
    setMsg(error ? `Failed: ${error.message}` : "Clinician added.");
    setNewName(""); setNewSpecialty(""); loadProviders();
  }

  async function toggleActive(p: Provider) {
    await supabase.from("providers").update({ active: !p.active }).eq("id", p.id);
    loadProviders();
  }

  async function addSlot(weekday: number) {
    if (!selected) return;
    const { error } = await supabase.from("provider_availability").insert({
      provider_id: selected, weekday, start_time: "09:00", end_time: "17:00", slot_length_minutes: 30,
    });
    if (error) setMsg(`Failed: ${error.message}`);
    loadAvailability(selected);
  }

  async function updateSlot(a: Availability, fields: Partial<Availability>) {
    await supabase.from("provider_availability").update(fields).eq("id", a.id);
    if (selected) loadAvailability(selected);
  }

  async function deleteSlot(a: Availability) {
    await supabase.from("provider_availability").delete().eq("id", a.id);
    if (selected) loadAvailability(selected);
  }

  return (
    <>
      <h1>Clinicians & availability</h1>
      <p className="muted">Times are clinic-local ({activeClinic?.timezone ?? "clinic timezone"}). The slot engine handles conversion.</p>
      {msg && <p role="status">{msg}</p>}

      <div className="two-col">
        <div>
          <h2>Clinicians</h2>
          <table>
            <thead><tr><th>Name</th><th>Specialty</th><th>PRC no.</th><th>Status</th><th></th></tr></thead>
            <tbody>
              {providers.map((p) => (
                <tr key={p.id} className={selected === p.id ? "row-selected" : ""}>
                  <td><button className="link" onClick={() => setSelected(p.id)}>{p.name}</button></td>
                  <td>{p.specialty ?? "—"}</td>
                  <td>
                    {p.prc_number ?? "—"}
                    {p.user_id && <div className="small muted">doctor login linked</div>}
                  </td>
                  <td>{p.active ? "active" : "inactive"}</td>
                  <td><button className="secondary" onClick={() => toggleActive(p)}>{p.active ? "Deactivate" : "Activate"}</button></td>
                </tr>
              ))}
              {!providers.length && <tr><td colSpan={5} className="empty">No clinicians yet.</td></tr>}
            </tbody>
          </table>

          <div className="form-card" style={{ marginTop: 12 }}>
            <label>Add clinician</label>
            <input placeholder="Name (e.g. Dr. Jones)" value={newName} onChange={(e) => setNewName(e.target.value)} />
            <input placeholder="Specialty (optional)" value={newSpecialty} onChange={(e) => setNewSpecialty(e.target.value)} style={{ marginTop: 8 }} />
            <div style={{ marginTop: 10 }}><button onClick={addProvider} disabled={!newName.trim()}>Add clinician</button></div>
            <p className="small muted" style={{ marginBottom: 0 }}>
              To let a doctor sign in as themselves, invite them on Settings → Users, then choose Doctor and link this
              record with their PRC number.
            </p>
          </div>
        </div>

        <div>
          <h2>Weekly availability</h2>
          {!selected ? (
            <p className="empty">Select a clinician to edit their weekly hours.</p>
          ) : (
            <div className="avail-grid">
              {DAYS.map((label, weekday) => {
                const slots = availability.filter((a) => a.weekday === weekday);
                return (
                  <div key={weekday} className="avail-day">
                    <div className="avail-day-head">
                      <strong>{label}</strong>
                      <button className="link" onClick={() => addSlot(weekday)}>+ add</button>
                    </div>
                    {slots.length === 0 && <div className="muted small">closed</div>}
                    {slots.map((a) => (
                      <div key={a.id} className="avail-slot">
                        <input type="time" value={a.start_time.slice(0, 5)} onChange={(e) => updateSlot(a, { start_time: e.target.value })} />
                        <span>–</span>
                        <input type="time" value={a.end_time.slice(0, 5)} onChange={(e) => updateSlot(a, { end_time: e.target.value })} />
                        <input type="number" min={10} step={5} title="slot minutes" value={a.slot_length_minutes}
                               onChange={(e) => updateSlot(a, { slot_length_minutes: Number(e.target.value) })} style={{ width: 60 }} />
                        <button className="link danger" onClick={() => deleteSlot(a)} aria-label="delete slot">×</button>
                      </div>
                    ))}
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>
    </>
  );
}
