import { useCallback, useEffect, useState } from "react";
import { supabase } from "../../lib/supabase";
import { callFunction } from "../../lib/api";
import type { Clinic } from "../../lib/types";

export default function AdminClinics() {
  const [clinics, setClinics] = useState<Clinic[]>([]);
  const [name, setName] = useState("");
  const [timezone, setTimezone] = useState("Asia/Manila");
  const [msg, setMsg] = useState("");
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    const { data } = await supabase.from("clinics").select("*").order("name");
    setClinics((data as Clinic[]) ?? []);
  }, []);

  useEffect(() => { load(); }, [load]);

  async function create() {
    if (!name.trim()) return;
    setBusy(true);
    const { error } = await callFunction("admin-manage", { action: "create_clinic", name: name.trim(), timezone });
    setBusy(false);
    setMsg(error ?? "Clinic created.");
    setName("");
    load();
  }

  async function toggleActive(c: Clinic) {
    await supabase.from("clinics").update({ active: !c.active }).eq("id", c.id);
    load();
  }

  return (
    <>
      <h1>Clinics</h1>
      {msg && <p role="status">{msg}</p>}

      <div className="form-card" style={{ maxWidth: 520 }}>
        <label>New clinic name</label>
        <input value={name} onChange={(e) => setName(e.target.value)} placeholder="River Valley Family Clinic" />
        <label>Timezone (IANA)</label>
        <input value={timezone} onChange={(e) => setTimezone(e.target.value)} />
        <div style={{ marginTop: 10 }}><button onClick={create} disabled={busy || !name.trim()}>Create clinic</button></div>
      </div>

      <h2>All clinics</h2>
      <table>
        <thead><tr><th>Name</th><th>Timezone</th><th>Status</th><th></th></tr></thead>
        <tbody>
          {clinics.map((c) => (
            <tr key={c.id}>
              <td>{c.name}</td>
              <td>{c.timezone}</td>
              <td>{c.active ? <span className="badge booked">active</span> : <span className="badge declined">inactive</span>}</td>
              <td><button className="secondary" onClick={() => toggleActive(c)}>{c.active ? "Deactivate" : "Activate"}</button></td>
            </tr>
          ))}
          {!clinics.length && <tr><td colSpan={4} className="empty">No clinics yet.</td></tr>}
        </tbody>
      </table>
    </>
  );
}
