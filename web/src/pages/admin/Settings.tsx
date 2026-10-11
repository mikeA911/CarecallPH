import { MULTI_CLINIC_ENABLED } from "../../lib/config";

export default function AdminSettings() {
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
