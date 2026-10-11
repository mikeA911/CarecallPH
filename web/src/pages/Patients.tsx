import { useCallback, useEffect, useState } from "react";
import Papa from "papaparse";
import { Link } from "react-router-dom";
import { supabase } from "../lib/supabase";
import { useSession, roleAtLeast } from "../lib/session";
import { useClinic } from "../lib/clinic";
import { normalizePhPhone } from "../lib/phone";
import type { Patient, Campaign } from "../lib/types";

type ParsedRow = {
  first_name: string; last_name: string; phone: string; date_of_birth: string;
  email: string | null; notes: string | null; sms_consent: boolean; error?: string;
};

/** Parse a CSV truthy cell: true / 1 / yes (case-insensitive) → true. */
function parseBool(raw?: string): boolean {
  return ["true", "1", "yes", "y"].includes((raw ?? "").trim().toLowerCase());
}

export default function Patients() {
  const { role } = useSession();
  const { activeClinicId } = useClinic();
  const canManage = roleAtLeast(role, "clinic_admin");

  const [patients, setPatients] = useState<Patient[]>([]);
  const [campaigns, setCampaigns] = useState<Campaign[]>([]);
  const [targetCampaign, setTargetCampaign] = useState("");
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [msg, setMsg] = useState("");
  const [form, setForm] = useState({ first_name: "", last_name: "", phone: "", date_of_birth: "", sms_consent: false });
  const [preview, setPreview] = useState<ParsedRow[] | null>(null);

  const load = useCallback(async () => {
    if (!activeClinicId) return;
    const [{ data: p }, { data: c }] = await Promise.all([
      supabase.from("patients").select("*").eq("clinic_id", activeClinicId).order("created_at", { ascending: false }).limit(300),
      supabase.from("campaigns").select("*").eq("clinic_id", activeClinicId).in("status", ["draft", "scheduled", "active", "paused"]),
    ]);
    setPatients((p as Patient[]) ?? []);
    setCampaigns((c as Campaign[]) ?? []);
  }, [activeClinicId]);

  useEffect(() => { load(); }, [load]);

  // CSV dry-run preview (§2.6): parse, show row errors, then confirm.
  function onCsv(file: File) {
    Papa.parse(file, {
      header: true, skipEmptyLines: true,
      complete: (res) => {
        const rows: ParsedRow[] = (res.data as Record<string, string>[]).map((r) => {
          const first_name = (r.first_name ?? "").trim();
          const parsed = normalizePhPhone(r.phone ?? "");
          const phone = parsed.ok ? parsed.e164 : (r.phone ?? "").trim();
          const dob = (r.date_of_birth ?? "").trim();
          let error: string | undefined;
          if (!first_name) error = "missing first_name";
          else if (!parsed.ok) error = parsed.error;
          else if (!/^\d{4}-\d{2}-\d{2}$/.test(dob)) error = "DOB must be YYYY-MM-DD";
          return {
            first_name, last_name: (r.last_name ?? "").trim(), phone, date_of_birth: dob,
            email: r.email?.trim() || null, notes: r.notes?.trim() || null,
            sms_consent: parseBool(r.sms_consent), error,
          };
        });
        setPreview(rows);
        setMsg("");
      },
    });
  }

  async function confirmImport() {
    if (!preview) return;
    const valid = preview.filter((r) => !r.error).map((r) => ({
      clinic_id: activeClinicId,
      first_name: r.first_name, last_name: r.last_name, phone: r.phone,
      date_of_birth: r.date_of_birth, email: r.email, notes: r.notes,
      sms_consent: r.sms_consent,
    }));
    if (!valid.length) { setMsg("No valid rows to import."); return; }
    const { error } = await supabase.from("patients")
      .upsert(valid, { onConflict: "phone,date_of_birth", ignoreDuplicates: true });
    setMsg(error ? `Import failed: ${error.message}` : `Imported ${valid.length} patients.`);
    setPreview(null);
    load();
  }

  async function addOne() {
    const parsed = normalizePhPhone(form.phone);
    if (!parsed.ok) { setMsg(parsed.error); return; }
    const { error } = await supabase.from("patients")
      .insert({ ...form, clinic_id: activeClinicId, phone: parsed.e164 });
    setMsg(error ? `Failed: ${error.message}` : "Patient added.");
    setForm({ first_name: "", last_name: "", phone: "", date_of_birth: "", sms_consent: false });
    load();
  }

  async function assign() {
    if (!targetCampaign || !selected.size) return;
    const rows = [...selected].map((patient_id) => ({ campaign_id: targetCampaign, patient_id }));
    const { error } = await supabase.from("campaign_patients")
      .upsert(rows, { onConflict: "campaign_id,patient_id", ignoreDuplicates: true });
    setMsg(error ? `Failed: ${error.message}` : `Added ${rows.length} patients to the campaign queue.`);
    setSelected(new Set());
    load();
  }

  function toggle(id: string) {
    const next = new Set(selected);
    next.has(id) ? next.delete(id) : next.add(id);
    setSelected(next);
  }

  const validCount = preview?.filter((r) => !r.error).length ?? 0;
  const errorCount = (preview?.length ?? 0) - validCount;

  return (
    <>
      <h1>Patients</h1>
      {msg && <p role="status">{msg}</p>}

      {canManage && (
        <div className="form-card">
          <label htmlFor="csv">Import CSV (first_name, last_name, phone, date_of_birth[, email, notes, sms_consent])</label>
          <input id="csv" type="file" accept=".csv"
                 onChange={(e) => e.target.files?.[0] && onCsv(e.target.files[0])} />

          {preview && (
            <div style={{ marginTop: 12 }}>
              <p><strong>Dry run:</strong> {validCount} valid, {errorCount} with errors.</p>
              <div className="scroll-box">
                <table>
                  <thead><tr><th>Row</th><th>Name</th><th>Phone</th><th>DOB</th><th>SMS consent</th><th>Issue</th></tr></thead>
                  <tbody>
                    {preview.map((r, i) => (
                      <tr key={i} className={r.error ? "row-error" : ""}>
                        <td>{i + 1}</td>
                        <td>{r.first_name} {r.last_name}</td>
                        <td>{r.phone}</td>
                        <td>{r.date_of_birth}</td>
                        <td>{r.sms_consent ? "yes" : "no"}</td>
                        <td>{r.error ?? "ok"}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <div className="row-actions" style={{ marginTop: 10 }}>
                <button disabled={!validCount} onClick={confirmImport}>Import {validCount} valid rows</button>
                <button className="secondary" onClick={() => setPreview(null)}>Cancel</button>
              </div>
            </div>
          )}

          <label style={{ marginTop: 16 }}>Or add one patient</label>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
            <input placeholder="First name" value={form.first_name} onChange={(e) => setForm({ ...form, first_name: e.target.value })} />
            <input placeholder="Last name" value={form.last_name} onChange={(e) => setForm({ ...form, last_name: e.target.value })} />
            <input placeholder="Mobile (09… or +63…)" value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} />
            <input placeholder="DOB YYYY-MM-DD" value={form.date_of_birth} onChange={(e) => setForm({ ...form, date_of_birth: e.target.value })} />
          </div>
          <label style={{ display: "flex", gap: 8, alignItems: "center", marginTop: 10 }}>
            <input type="checkbox" style={{ width: "auto" }} checked={form.sms_consent}
                   onChange={(e) => setForm({ ...form, sms_consent: e.target.checked })} />
            Patient consents to SMS (pre-call text & reminders)
          </label>
          <div style={{ marginTop: 10 }}>
            <button className="secondary" onClick={addOne}
                    disabled={!form.first_name || !form.phone || !form.date_of_birth}>Add patient</button>
          </div>
        </div>
      )}

      <h2>Assign to campaign</h2>
      <div style={{ display: "flex", gap: 10, alignItems: "center", marginBottom: 10, maxWidth: 520 }}>
        <select value={targetCampaign} onChange={(e) => setTargetCampaign(e.target.value)}>
          <option value="">Choose campaign…</option>
          {campaigns.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
        </select>
        <button onClick={assign} disabled={!targetCampaign || !selected.size}>
          Add {selected.size || ""} to queue
        </button>
      </div>

      <table>
        <thead><tr><th></th><th>Name</th><th>Phone</th><th>Date of birth</th><th>Flags</th></tr></thead>
        <tbody>
          {patients.map((p) => (
            <tr key={p.id} className={p.do_not_call || !p.active ? "row-muted" : ""}>
              <td><input type="checkbox" style={{ width: "auto" }} checked={selected.has(p.id)} onChange={() => toggle(p.id)} aria-label={`Select ${p.first_name} ${p.last_name}`} /></td>
              <td><Link to={`/patients/${p.id}`}>{p.first_name} {p.last_name}</Link></td>
              <td>{p.phone}</td>
              <td>{p.date_of_birth}</td>
              <td>
                {p.do_not_call && <span className="badge wrong_number">do not call</span>}
                {!p.active && <span className="badge declined">inactive</span>}
                {p.sms_consent && <span className="badge notified">SMS ok</span>}
              </td>
            </tr>
          ))}
          {!patients.length && <tr><td colSpan={5} className="empty">Import a CSV or add a patient to get started.</td></tr>}
        </tbody>
      </table>
    </>
  );
}
