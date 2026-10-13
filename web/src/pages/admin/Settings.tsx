import { useEffect, useState } from "react";
import { MULTI_CLINIC_ENABLED } from "../../lib/config";
import { supabase } from "../../lib/supabase";
import { LEGAL_MIN_YEARS } from "../../components/RetentionSection";

export default function AdminSettings() {
  const [years, setYears] = useState("");
  const [msg, setMsg] = useState("");
  useEffect(() => {
    supabase.from("platform_settings").select("value").eq("key", "record_retention_years").maybeSingle()
      .then(({ data }) => setYears(String(data ? (data as { value: unknown }).value : LEGAL_MIN_YEARS)));
  }, []);

  async function saveYears() {
    const n = Number(years);
    if (!Number.isInteger(n) || n < 1 || n > 100) { setMsg("Enter whole years, 1 to 100."); return; }
    const { error } = await supabase.from("platform_settings")
      .upsert({ key: "record_retention_years", value: n, updated_at: new Date().toISOString() });
    setMsg(error ? `Failed: ${error.message}` : "Saved.");
  }

  return (
    <>
      <h1>Global settings</h1>
      <p className="muted">Platform-wide defaults and feature flags applied to new clinics.</p>

      <div className="form-card" style={{ maxWidth: 640 }}>
        <h2 style={{ marginTop: 0 }}>Feature flags</h2>
        <div className="kv">
          <span>Multi-clinic switcher</span>
          <strong>{MULTI_CLINIC_ENABLED ? "enabled" : "stubbed (single clinic)"}</strong>
        </div>
        <p className="muted small">
          D2: the schema is multi-clinic from day one. Set <code>VITE_MULTI_CLINIC=true</code> and
          seed additional clinics to enable the switcher. No schema change is required.
        </p>

        <h2>Records retention</h2>
        <label htmlFor="ret-years">Keep patient records for (years after the last consultation)</label>
        <div className="row-actions">
          <input id="ret-years" inputMode="numeric" style={{ width: 100 }} value={years} onChange={(e) => setYears(e.target.value)} />
          <button className="secondary" onClick={saveYears}>Save</button>
        </div>
        {years && Number(years) < LEGAL_MIN_YEARS && (
          <p className="small" role="alert">The DOH schedule appears to require 7 years for outpatient records.</p>
        )}
        {msg && <p role="status" className="small">{msg}</p>}
        <p className="muted small">
          Applies to every clinic unless set per clinic (Clinic settings). Records past the period are listed for the
          clinic admin to review; nothing is deleted automatically.
        </p>

        <h2>New-clinic defaults</h2>
        <div className="kv"><span>Default timezone</span><strong>Asia/Manila</strong></div>
        <div className="kv"><span>Default calling hours</span><strong>08:00–18:00 Mon–Fri, 08:00–12:00 Sat</strong></div>
        <div className="kv"><span>SMS fallback</span><strong>on</strong></div>
        <p className="muted small">
          Defaults are applied by the <code>create_clinic</code> action and can be adjusted per clinic
          under Clinic settings.
        </p>
      </div>
    </>
  );
}
