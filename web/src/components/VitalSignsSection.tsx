// Patient detail → "Vital signs" (care plans M3). Nurses and doctors only
// (the database enforces it too). A nurse or doctor drafts a monitoring plan:
// for each measure what and why, when, how, the target and critical limits,
// and what to do if high or low. Only a doctor signs it (password). After the
// patient agrees in the chat, CareCall asks for readings at the plan's times
// and checks each against the doctor's limits; out-of-range readings go to
// Readings to review. Design: docs/care-plan-design.md §4, §4a, §5.
import { useCallback, useEffect, useState } from "react";
import { mmss, useRecorder } from "../lib/recorder";
import { supabase } from "../lib/supabase";
import { callFunction } from "../lib/api";
import { useSession } from "../lib/session";
import {
  DAYS, FLAG_LABEL, LIMIT_KEYS, MEASURES, MEASURE_INFO, classify, formatValue, label12, limitsText, newVitalPlan,
  type Flag, type Limits, type Measure, type VitalPlan,
} from "../lib/vitals";

type Consent = { requested_at: string; consented_at: string | null; declined_at: string | null; withdrawn_at: string | null };
type Plan = {
  id: string; version: number; status: "draft" | "signed" | "replaced" | "stopped"; notes: string | null;
  signed_at: string | null; sent_at: string | null; stopped_at: string | null; created_at: string;
  providers: { name: string } | null; vital_plans: (VitalPlan & { id: string; created_at: string })[];
};
export type Reading = {
  id: string; patient_id: string; vital_plan_id: string | null; measure: Measure; value1: number; value2: number | null;
  pulse: number | null; taken_at: string; source: "chat" | "staff"; flag: Flag;
  reviewed_at: string | null; review_note: string | null;
};

const ANSWER_DAYS = 3;
const dateOnly = (d: string) => new Date(`${d}T00:00`).toLocaleDateString();

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

const PLAN_SELECT = "id, version, status, notes, signed_at, sent_at, stopped_at, created_at, " +
  "providers:signed_provider_id(name), vital_plans(*)";
const READING_SELECT = "id, patient_id, vital_plan_id, measure, value1, value2, pulse, taken_at, source, flag, reviewed_at, review_note";

export default function VitalSignsSection({ patientId, clinicId, canMessage }: {
  patientId: string; clinicId: string; canMessage: boolean;
}) {
  const { clinicalRole, session } = useSession();
  const isDoctor = clinicalRole === "doctor";
  const [consent, setConsent] = useState<Consent | null>(null);
  const [plans, setPlans] = useState<Plan[]>([]);
  const [readings, setReadings] = useState<Reading[]>([]);
  const [editing, setEditing] = useState(false);
  const [dictating, setDictating] = useState(false);
  const [dictated, setDictated] = useState<Dictated | null>(null);
  const [addingReading, setAddingReading] = useState(false);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState("");

  const load = useCallback(async () => {
    const since = new Date(Date.now() - 90 * 24 * 3600_000).toISOString();
    const [{ data: c }, { data: p }, { data: r }] = await Promise.all([
      supabase.from("care_consents").select("requested_at, consented_at, declined_at, withdrawn_at")
        .eq("patient_id", patientId).contains("scopes", ["vital_signs"])
        .order("requested_at", { ascending: false }).limit(1),
      supabase.from("monitoring_plans").select(PLAN_SELECT)
        .eq("patient_id", patientId).order("created_at", { ascending: false }).limit(20),
      supabase.from("vital_readings").select(READING_SELECT)
        .eq("patient_id", patientId).gte("taken_at", since).order("taken_at", { ascending: false }).limit(300),
    ]);
    setConsent(((c ?? []) as Consent[])[0] ?? null);
    const list = ((p ?? []) as unknown as Plan[]).map((x) => ({
      ...x, vital_plans: [...(x.vital_plans ?? [])].sort((a, b) => a.created_at.localeCompare(b.created_at)),
    }));
    setPlans(list);
    setReadings((r ?? []) as Reading[]);
  }, [patientId]);

  useEffect(() => { load(); }, [load]);

  const running = plans.find((p) => p.status === "signed") ?? null;
  const draft = plans.find((p) => p.status === "draft") ?? null;
  const state = consentState(consent);

  async function askConsent() {
    setBusy(true); setMsg("");
    const { error } = await callFunction("care-plan", { action: "request_consent", patient_id: patientId, scope: "vital_signs" });
    setBusy(false);
    setMsg(error ? error : "Sent. The patient answers YES or NO in their chat app; the plan is sent after YES.");
    load();
  }

  async function stopConsent() {
    if (!confirm("Stop asking this patient for readings? The plan and readings stay in the record.")) return;
    setBusy(true);
    const { error } = await callFunction("care-plan", { action: "withdraw", patient_id: patientId, scope: "vital_signs" });
    setBusy(false);
    setMsg(error ? error : "Vital signs by chat stopped.");
    load();
  }

  async function stopPlan(p: Plan) {
    if (!confirm("Stop this monitoring plan? CareCall stops asking for readings. It stays in the record.")) return;
    setBusy(true);
    const { error } = await callFunction("care-plan", { action: "stop_plan", patient_id: patientId, plan_id: p.id });
    setBusy(false);
    setMsg(error ? error : "Plan stopped.");
    load();
  }

  async function deleteDraft(p: Plan) {
    if (!confirm("Delete this draft plan?")) return;
    const { error } = await supabase.from("monitoring_plans").delete().eq("id", p.id);
    setMsg(error ? `Couldn't delete: ${error.message}` : "Draft deleted.");
    load();
  }

  return (
    <>
      <h2>Vital signs</h2>
      {msg && <p role="status">{msg}</p>}

      <div className="form-card" style={{ maxWidth: 760 }}>
        <div className="row-actions" style={{ justifyContent: "space-between" }}>
          <div>
            <strong>Vital signs by chat</strong>
            <div className={`small ${state.key === "active" ? "" : "muted"}`}>{state.text}</div>
          </div>
          <div className="row-actions">
            {state.key === "active" ? (
              <button className="secondary" disabled={busy} onClick={stopConsent}>Stop</button>
            ) : canMessage && (running || draft) ? (
              <button className="secondary" disabled={busy} onClick={askConsent}>
                {state.key === "pending" ? "Ask again" : "Ask patient to agree"}
              </button>
            ) : null}
          </div>
        </div>
        {state.key !== "active" && (
          <p className="small muted" style={{ marginBottom: 0 }}>
            CareCall asks for readings only after the patient replies YES in their chat app. The request names the doctor
            and the measures, and says they can stop any time with STOP REMINDERS (which also stops medicine reminders).
            {!canMessage && " Connect the patient to a chat app first (Invite to chat)."}
            {canMessage && !running && !draft && " Start a plan first."}
          </p>
        )}
      </div>

      {running && !editing && (
        <PlanCard plan={running} title={`Monitoring plan, version ${running.version}`}>
          <div className="small muted">
            Signed by {running.providers?.name ?? "the doctor"} on {new Date(running.signed_at!).toLocaleDateString()}
            {" · "}{running.sent_at ? `sent to the patient ${new Date(running.sent_at).toLocaleDateString()}`
              : "not sent yet (sent when the patient agrees)"}
          </div>
          <div className="row-actions" style={{ marginTop: 8 }}>
            {!draft && <button className="secondary" onClick={() => setEditing(true)}>Change plan</button>}
            <button className="link" disabled={busy} onClick={() => stopPlan(running)}>Stop plan</button>
          </div>
        </PlanCard>
      )}

      {draft && !editing && (
        <PlanCard plan={draft} title={running ? "Draft: new version" : "Draft plan"}>
          <div className="small muted">Not running until a doctor signs it.</div>
          <div className="row-actions" style={{ marginTop: 8 }}>
            <button className="secondary" onClick={() => setEditing(true)}>Edit draft</button>
            {isDoctor ? (
              <SignPlanButton patientId={patientId} planId={draft.id} disabled={!draft.vital_plans.length}
                              onDone={(t) => { setMsg(t); load(); }} />
            ) : <span className="small muted">A doctor signs the plan.</span>}
            <button className="link" onClick={() => deleteDraft(draft)}>Delete draft</button>
          </div>
        </PlanCard>
      )}

      {!editing && !dictating && (
        <div className="row-actions" style={{ marginTop: 10 }}>
          {!running && !draft && <button className="secondary" onClick={() => setEditing(true)}>Start a monitoring plan</button>}
          <button className="secondary" onClick={() => setDictating(true)}
                  title="Say the plan; CC fills in a draft for you to check and sign">
            {draft ? "Dictate the draft again" : running ? "Dictate a new version" : "Dictate a plan"}
          </button>
        </div>
      )}

      {dictating && (
        <DictatePlan patientId={patientId} replacesDraft={!!draft}
                     onCancel={() => setDictating(false)}
                     onDraft={(d) => { setDictating(false); setDictated(d); setEditing(true); }} />
      )}

      {editing && (
        <PlanEditor patientId={patientId} clinicId={clinicId} userId={session?.user?.id ?? null}
                    draft={draft} copyFrom={draft ? null : running} dictated={dictated}
                    onClose={(t) => { setEditing(false); setDictated(null); if (t) setMsg(t); load(); }} />
      )}

      <h3 style={{ marginTop: 18 }}>Readings</h3>
      <ReadingCharts readings={readings} plan={running} />
      <ReadingsTable readings={readings.slice(0, 30)} onChange={load} />
      {!addingReading ? (
        <div className="row-actions" style={{ marginTop: 10 }}>
          <button className="secondary" onClick={() => setAddingReading(true)}>Add a reading taken at the clinic</button>
        </div>
      ) : (
        <StaffReadingForm patientId={patientId} clinicId={clinicId} plan={running}
                          onClose={(t) => { setAddingReading(false); if (t) setMsg(t); load(); }} />
      )}
    </>
  );
}

function PlanCard({ plan, title, children }: { plan: Plan; title: string; children: React.ReactNode }) {
  return (
    <div className="form-card" style={{ maxWidth: 760, marginTop: 12 }}>
      <strong>{title}</strong>
      {children}
      <table style={{ marginTop: 10 }}>
        <thead><tr><th>Measure</th><th>When</th><th>Limits and what to do</th></tr></thead>
        <tbody>
          {plan.vital_plans.map((v) => (
            <tr key={v.id}>
              <td>
                <strong>{MEASURE_INFO[v.measure].label}</strong>
                {v.reason && <div className="small muted">{v.reason}</div>}
              </td>
              <td className="small">
                {v.times_of_day.map(label12).join(", ")}
                <div className="muted">
                  {v.days_of_week?.length ? v.days_of_week.map((d) => DAYS[d]).join(", ") : "Every day"}
                  {v.until_date ? ` until ${dateOnly(v.until_date)}` : ""}
                </div>
              </td>
              <td className="small">
                {limitsText(v.measure, v)}
                {v.if_high && <div><span className="muted">If high:</span> {v.if_high}</div>}
                {v.if_low && <div><span className="muted">If low:</span> {v.if_low}</div>}
              </td>
            </tr>
          ))}
          {!plan.vital_plans.length && <tr><td colSpan={3} className="empty">No measures yet.</td></tr>}
        </tbody>
      </table>
    </div>
  );
}

/** Electronic signature for a plan: the doctor re-enters their password. */
function SignPlanButton({ patientId, planId, disabled, onDone }: {
  patientId: string; planId: string; disabled: boolean; onDone: (msg: string) => void;
}) {
  const [asking, setAsking] = useState(false);
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  async function sign() {
    setBusy(true); setErr("");
    const { data, error } = await callFunction<{ version: number; sent: boolean; needs_consent: boolean }>(
      "care-plan", { action: "sign_plan", patient_id: patientId, plan_id: planId, password });
    setBusy(false); setPassword("");
    if (error || !data) { setErr(error ?? "Couldn't sign."); return; }
    onDone(`Plan version ${data.version} signed. ` + (data.sent ? "The patient was sent their instructions."
      : data.needs_consent ? "Ask the patient to agree; the instructions are sent after their YES." : ""));
  }
  if (!asking) return <button disabled={disabled} onClick={() => setAsking(true)}>Sign plan</button>;
  return (
    <form className="sign-box" onSubmit={(e) => { e.preventDefault(); if (password) sign(); }}>
      <label htmlFor={`plan-pw-${planId}`}>Enter your password to sign</label>
      <span className="small muted">Signing is final: a change later makes a new version. The running plan, if any, is replaced.</span>
      <div className="row-actions" style={{ marginTop: 6 }}>
        <input id={`plan-pw-${planId}`} type="password" autoComplete="current-password" autoFocus style={{ width: 220 }}
               value={password} onChange={(e) => setPassword(e.target.value)} />
        <button type="submit" disabled={busy || !password}>{busy ? "Signing…" : "Sign"}</button>
        <button type="button" className="link" onClick={() => { setAsking(false); setPassword(""); setErr(""); }}>Cancel</button>
      </div>
      {err && <p role="alert" className="small">{err}</p>}
    </form>
  );
}

type Item = VitalPlan & { key: string };
let keySeq = 0;
const withKey = (v: VitalPlan): Item => ({ ...v, key: `k${++keySeq}` });
const strip = (v: VitalPlan & { created_at?: string; plan_id?: string; clinic_id?: string; patient_id?: string }): VitalPlan => {
  const { id, measure, reason, how_to, times_of_day, days_of_week, start_date, until_date, if_high, if_low } = v;
  const limits = Object.fromEntries(LIMIT_KEYS.map((k) => [k, v[k] ?? null])) as Limits;
  return { id, measure, reason, how_to, times_of_day: times_of_day.map((t) => t.slice(0, 5)), days_of_week,
    start_date, until_date, if_high, if_low, ...limits };
};

/** Edit the draft (or start one, copied from the running plan for a new version). */
function PlanEditor({ patientId, clinicId, userId, draft, copyFrom, dictated, onClose }: {
  patientId: string; clinicId: string; userId: string | null; draft: Plan | null; copyFrom: Plan | null;
  /** A plan dictated to CC: its measures replace the draft's (the draft rows are removed on save). */
  dictated?: Dictated | null;
  onClose: (msg?: string) => void;
}) {
  const [items, setItems] = useState<Item[]>(() =>
    dictated ? dictated.items.map((d) => withKey(fromDictation(d, dictated.start_date))) :
    (draft ?? copyFrom)?.vital_plans.map((v) => {
      const s = strip(v);
      if (!draft) delete s.id;            // a copy: new rows on the new draft
      return withKey(s);
    }) ?? []);
  const [notes, setNotes] = useState(draft?.notes ?? "");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const unused = MEASURES.filter((m) => !items.some((i) => i.measure === m));

  const set = (key: string, patch: Partial<VitalPlan>) => setItems(items.map((i) => (i.key === key ? { ...i, ...patch } : i)));

  function check(): string | null {
    if (!items.length) return "Add at least one measure.";
    for (const i of items) {
      const label = MEASURE_INFO[i.measure].label;
      const times = i.times_of_day.filter(Boolean);
      if (!times.length) return `${label}: add at least one time.`;
      if (times.some((t) => t < "05:00" || t > "22:00")) return `${label}: times must be between 5:00 AM and 10:00 PM.`;
      if (i.until_date && i.until_date < i.start_date) return `${label}: the end date is before the start date.`;
      if (i.days_of_week && !i.days_of_week.length) return `${label}: pick at least one day, or every day.`;
      const pairs: [keyof Limits, keyof Limits][] = [["target_low", "target_high"], ["target_low2", "target_high2"],
        ["critical_low", "critical_high"], ["critical_low2", "critical_high2"]];
      for (const [lo, hi] of pairs) {
        if (i[lo] != null && i[hi] != null && Number(i[lo]) >= Number(i[hi])) return `${label}: a low limit is above its high limit.`;
      }
      if (i.critical_high != null && i.target_high != null && Number(i.critical_high) <= Number(i.target_high))
        return `${label}: the critical high must be above the target.`;
      if (i.critical_low != null && i.target_low != null && Number(i.critical_low) >= Number(i.target_low))
        return `${label}: the critical low must be below the target.`;
    }
    return null;
  }

  async function save() {
    const problem = check();
    if (problem) { setErr(problem); return; }
    setBusy(true); setErr("");
    let planId = draft?.id ?? null;
    if (planId) {
      const { error } = await supabase.from("monitoring_plans").update({ notes: notes.trim() || null }).eq("id", planId);
      if (error) { setBusy(false); setErr(`Couldn't save: ${error.message}`); return; }
    } else {
      const { data, error } = await supabase.from("monitoring_plans")
        .insert({ clinic_id: clinicId, patient_id: patientId, notes: notes.trim() || null, drafted_by: userId })
        .select("id").single();
      if (error || !data) { setBusy(false); setErr(`Couldn't save: ${error?.message}`); return; }
      planId = (data as { id: string }).id;
    }
    // Rows removed from the draft, then each row updated or added.
    const keep = items.filter((i) => i.id).map((i) => i.id!);
    const removed = (draft?.vital_plans ?? []).filter((v) => !keep.includes(v.id)).map((v) => v.id);
    if (removed.length) await supabase.from("vital_plans").delete().in("id", removed);
    for (const i of items) {
      const { key: _k, id, ...row } = i;
      const clean = {
        ...row, reason: row.reason?.trim() || null, how_to: row.how_to?.trim() || null,
        if_high: row.if_high?.trim() || null, if_low: row.if_low?.trim() || null,
        times_of_day: [...new Set(row.times_of_day.filter(Boolean))].sort(),
        until_date: row.until_date || null,
        days_of_week: row.days_of_week && row.days_of_week.length < 7 ? [...row.days_of_week].sort() : null,
      };
      const { error } = id
        ? await supabase.from("vital_plans").update(clean).eq("id", id)
        : await supabase.from("vital_plans").insert({ ...clean, plan_id: planId, clinic_id: clinicId, patient_id: patientId });
      if (error) { setBusy(false); setErr(`Couldn't save ${MEASURE_INFO[i.measure].label}: ${error.message}`); return; }
    }
    setBusy(false);
    onClose("Draft saved. A doctor signs it to start.");
  }

  const num = (v: string) => (v === "" ? null : Number(v));

  return (
    <div className="form-card" style={{ marginTop: 12, maxWidth: 760 }}>
      <strong>{draft ? "Edit draft plan" : copyFrom ? "New version of the plan" : "New monitoring plan"}</strong>
      {dictated ? (
        <div className="form-card" style={{ marginTop: 8 }}>
          <strong className="small">Drafted by CC from the dictation. Check every field before saving.</strong>
          {dictated.unclear.length > 0 && (
            <ul className="small" aria-label="Check before saving" style={{ margin: "6px 0 0 18px", padding: 0 }}>
              {dictated.unclear.map((u, n) => <li key={n}>{u}</li>)}
            </ul>
          )}
          <details className="small" style={{ marginTop: 6 }}><summary>What was said</summary>
            <p style={{ whiteSpace: "pre-wrap" }}>{dictated.transcript}</p></details>
        </div>
      ) : (
        <p className="small muted">
          Default limits are suggestions for the doctor to confirm or change for this patient. CareCall only compares
          readings with these numbers and quotes the doctor's instructions; it never explains a reading.
        </p>
      )}

      {items.map((i) => {
        const info = MEASURE_INFO[i.measure];
        const bp = i.measure === "bp";
        const limit = (k: keyof Limits, label: string) => (
          <span key={k}>
            <label htmlFor={`${i.key}-${k}`} className="small">{label}</label>
            <input id={`${i.key}-${k}`} type="number" step={info.step} style={{ width: 90 }} value={i[k] ?? ""}
                   onChange={(e) => set(i.key, { [k]: num(e.target.value) })} />
          </span>
        );
        return (
          <fieldset key={i.key} className="form-card" style={{ marginTop: 10 }}>
            <legend><strong>{info.label}</strong> <span className="small muted">({info.unit})</span></legend>
            <label htmlFor={`${i.key}-reason`}>What and why (the doctor's words, sent to the patient)</label>
            <input id={`${i.key}-reason`} placeholder="To check your new blood pressure medicine is working"
                   value={i.reason ?? ""} onChange={(e) => set(i.key, { reason: e.target.value })} />
            <label>Times</label>
            <div className="row-actions">
              {i.times_of_day.map((t, n) => (
                <span key={n} className="row-actions">
                  <input type="time" style={{ width: "auto" }} value={t} aria-label={`${info.label} time ${n + 1}`}
                         onChange={(e) => set(i.key, { times_of_day: i.times_of_day.map((x, j) => (j === n ? e.target.value : x)) })} />
                  {i.times_of_day.length > 1 && (
                    <button type="button" className="link" aria-label={`Remove time ${n + 1}`}
                            onClick={() => set(i.key, { times_of_day: i.times_of_day.filter((_, j) => j !== n) })}>×</button>
                  )}
                </span>
              ))}
              {i.times_of_day.length < 4 && (
                <button type="button" className="link" onClick={() => set(i.key, { times_of_day: [...i.times_of_day, "12:00"] })}>+ Add time</button>
              )}
            </div>
            <label>Days</label>
            <div className="row-actions">
              <label className="small" style={{ display: "flex", gap: 4, alignItems: "center" }}>
                <input type="checkbox" style={{ width: "auto" }} checked={!i.days_of_week}
                       onChange={(e) => set(i.key, { days_of_week: e.target.checked ? null : [1, 3, 5] })} />Every day
              </label>
              {i.days_of_week && DAYS.map((d, n) => (
                <label key={d} className="small" style={{ display: "flex", gap: 4, alignItems: "center" }}>
                  <input type="checkbox" style={{ width: "auto" }} checked={i.days_of_week!.includes(n)}
                         onChange={(e) => set(i.key, { days_of_week: e.target.checked
                           ? [...i.days_of_week!, n] : i.days_of_week!.filter((x) => x !== n) })} />{d}
                </label>
              ))}
            </div>
            <div className="row-actions" style={{ marginTop: 4 }}>
              <span><label htmlFor={`${i.key}-start`}>Start</label>
                <input id={`${i.key}-start`} type="date" value={i.start_date} onChange={(e) => set(i.key, { start_date: e.target.value })} /></span>
              <span><label htmlFor={`${i.key}-until`}>Until (optional)</label>
                <input id={`${i.key}-until`} type="date" value={i.until_date ?? ""} onChange={(e) => set(i.key, { until_date: e.target.value || null })} /></span>
            </div>
            <label htmlFor={`${i.key}-how`}>How to measure (sent to the patient)</label>
            <textarea id={`${i.key}-how`} rows={3} value={i.how_to ?? ""} onChange={(e) => set(i.key, { how_to: e.target.value })} />

            <label>Target{bp ? " (systolic / diastolic)" : ""}: readings beyond it go to Readings to review</label>
            <div className="row-actions">
              {limit("target_low", bp ? "Low, systolic" : "Low")}
              {bp && limit("target_low2", "Low, diastolic")}
              {limit("target_high", bp ? "High, systolic" : "High")}
              {bp && limit("target_high2", "High, diastolic")}
            </div>
            <label>Critical: at or beyond, the patient is told to call 911 first</label>
            <div className="row-actions">
              {limit("critical_low", bp ? "Low, systolic" : "Low")}
              {bp && limit("critical_low2", "Low, diastolic")}
              {limit("critical_high", bp ? "High, systolic" : "High")}
              {bp && limit("critical_high2", "High, diastolic")}
            </div>
            <label htmlFor={`${i.key}-ifhigh`}>If high, the doctor says (quoted to the patient)</label>
            <input id={`${i.key}-ifhigh`} placeholder="Rest 15 minutes and measure again. If still high, call the clinic."
                   value={i.if_high ?? ""} onChange={(e) => set(i.key, { if_high: e.target.value })} />
            <label htmlFor={`${i.key}-iflow`}>If low, the doctor says</label>
            <input id={`${i.key}-iflow`} placeholder="Sit or lie down, drink water, and call the clinic."
                   value={i.if_low ?? ""} onChange={(e) => set(i.key, { if_low: e.target.value })} />
            <p className="small muted" style={{ marginBottom: 0 }}>{limitsText(i.measure, i)}</p>
            <div className="row-actions">
              {LIMIT_KEYS.some((k) => i[k] == null && info.defaults[k] != null) && (
                <button type="button" className="link"
                        onClick={() => set(i.key, Object.fromEntries(LIMIT_KEYS.filter((k) => i[k] == null && info.defaults[k] != null)
                          .map((k) => [k, info.defaults[k]])) as Partial<VitalPlan>)}>
                  Fill empty limits with the suggested ones
                </button>
              )}
              <button type="button" className="link" onClick={() => setItems(items.filter((x) => x.key !== i.key))}>
                Remove {info.label.toLowerCase()}
              </button>
            </div>
          </fieldset>
        );
      })}

      {unused.length > 0 && (
        <div className="row-actions" style={{ marginTop: 10 }}>
          <label htmlFor="add-measure" className="small">Add a measure</label>
          <select id="add-measure" style={{ width: "auto" }} value=""
                  onChange={(e) => e.target.value && setItems([...items, withKey(newVitalPlan(e.target.value as Measure))])}>
            <option value="">Choose…</option>
            {unused.map((m) => <option key={m} value={m}>{MEASURE_INFO[m].label}</option>)}
          </select>
        </div>
      )}

      <label htmlFor="plan-notes">Notes for the clinic (not sent)</label>
      <input id="plan-notes" value={notes} onChange={(e) => setNotes(e.target.value)} />
      {err && <p role="alert" className="small">{err}</p>}
      <div className="row-actions" style={{ marginTop: 12 }}>
        <button disabled={busy} onClick={save}>{busy ? "Saving…" : "Save draft"}</button>
        <button className="link" onClick={() => onClose()}>Cancel</button>
      </div>
    </div>
  );
}

export function FlagBadge({ flag }: { flag: Flag }) {
  return <span className={`badge reading-${flag}`}>{FLAG_LABEL[flag]}</span>;
}

/** Mark a reading reviewed, with an optional note. Values never change. */
export function ReviewButton({ reading, onDone }: { reading: Reading; onDone: () => void }) {
  const [open, setOpen] = useState(false);
  const [note, setNote] = useState("");
  const [err, setErr] = useState("");
  const { session } = useSession();
  async function save() {
    const { error } = await supabase.from("vital_readings").update({
      reviewed_at: new Date().toISOString(), reviewed_by: session?.user?.id ?? null, review_note: note.trim() || null,
    }).eq("id", reading.id);
    if (error) { setErr(error.message); return; }
    setOpen(false); onDone();
  }
  if (!open) return <button className="link" onClick={() => setOpen(true)}>Mark reviewed</button>;
  return (
    <span className="row-actions">
      <input aria-label="Review note" placeholder="Note (optional): called patient, advised…" style={{ width: 240 }}
             value={note} onChange={(e) => setNote(e.target.value)} />
      <button className="secondary" onClick={save}>Save</button>
      <button className="link" onClick={() => setOpen(false)}>Cancel</button>
      {err && <span role="alert" className="small">{err}</span>}
    </span>
  );
}

function ReadingsTable({ readings, onChange }: { readings: Reading[]; onChange: () => void }) {
  return (
    <table style={{ marginTop: 8 }}>
      <thead><tr><th>Taken</th><th>Measure</th><th>Reading</th><th>Check</th><th>Review</th></tr></thead>
      <tbody>
        {readings.map((r) => (
          <tr key={r.id}>
            <td className="small">{new Date(r.taken_at).toLocaleString([], { dateStyle: "medium", timeStyle: "short" })}
              <div className="muted">{r.source === "chat" ? "by chat" : "at the clinic"}</div></td>
            <td>{MEASURE_INFO[r.measure].label}</td>
            <td>{formatValue(r.measure, r.value1, r.value2, r.pulse)}</td>
            <td><FlagBadge flag={r.flag} /></td>
            <td className="small">
              {r.flag === "ok" ? "" : r.reviewed_at
                ? <>Reviewed {new Date(r.reviewed_at).toLocaleDateString()}{r.review_note && <div className="muted">{r.review_note}</div>}</>
                : <ReviewButton reading={r} onDone={onChange} />}
            </td>
          </tr>
        ))}
        {!readings.length && <tr><td colSpan={5} className="empty">No readings in the last 90 days.</td></tr>}
      </tbody>
    </table>
  );
}

function StaffReadingForm({ patientId, clinicId, plan, onClose }: {
  patientId: string; clinicId: string; plan: Plan | null; onClose: (msg?: string) => void;
}) {
  const [measure, setMeasure] = useState<Measure>(plan?.vital_plans[0]?.measure ?? "bp");
  const [v1, setV1] = useState("");
  const [v2, setV2] = useState("");
  const [pulse, setPulse] = useState("");
  const [taken, setTaken] = useState(() => {
    const d = new Date(); d.setMinutes(d.getMinutes() - d.getTimezoneOffset());
    return d.toISOString().slice(0, 16);
  });
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);
  const item = plan?.vital_plans.find((v) => v.measure === measure) ?? null;
  const bp = measure === "bp";

  async function save() {
    const a = Number(v1), b = bp ? Number(v2) : null;
    if (!v1 || !Number.isFinite(a) || (bp && (!v2 || !Number.isFinite(b!)))) { setErr("Enter the reading."); return; }
    if (bp && b! >= a) { setErr("The second number (diastolic) should be lower than the first."); return; }
    setBusy(true); setErr("");
    const { error } = await supabase.from("vital_readings").insert({
      clinic_id: clinicId, patient_id: patientId, vital_plan_id: item?.id ?? null, measure, value1: a, value2: b,
      pulse: pulse ? Number(pulse) : null, taken_at: new Date(taken).toISOString(), source: "staff",
    });
    setBusy(false);
    if (error) { setErr(`Couldn't save: ${error.message}`); return; }
    const flag = item ? classify(measure, a, b, item) : "ok";
    onClose(flag === "ok" ? "Reading saved." : `Reading saved: ${FLAG_LABEL[flag].toLowerCase()} for this patient's plan.`);
  }

  return (
    <div className="form-card" style={{ marginTop: 12, maxWidth: 640 }}>
      <div className="row-actions">
        <span><label htmlFor="sr-measure">Measure</label>
          <select id="sr-measure" value={measure} onChange={(e) => setMeasure(e.target.value as Measure)}>
            {MEASURES.map((m) => <option key={m} value={m}>{MEASURE_INFO[m].label}</option>)}
          </select></span>
        <span><label htmlFor="sr-v1">{bp ? "Systolic" : `Value (${MEASURE_INFO[measure].unit})`}</label>
          <input id="sr-v1" type="number" step={MEASURE_INFO[measure].step} style={{ width: 100 }} value={v1} onChange={(e) => setV1(e.target.value)} /></span>
        {bp && <span><label htmlFor="sr-v2">Diastolic</label>
          <input id="sr-v2" type="number" style={{ width: 100 }} value={v2} onChange={(e) => setV2(e.target.value)} /></span>}
        {bp && <span><label htmlFor="sr-pulse">Pulse (optional)</label>
          <input id="sr-pulse" type="number" style={{ width: 100 }} value={pulse} onChange={(e) => setPulse(e.target.value)} /></span>}
        <span><label htmlFor="sr-taken">Taken</label>
          <input id="sr-taken" type="datetime-local" value={taken} onChange={(e) => setTaken(e.target.value)} /></span>
      </div>
      <p className="small muted">{item ? `Checked against the plan: ${limitsText(measure, item)}.` : "Not in the running plan: recorded only."}</p>
      {err && <p role="alert" className="small">{err}</p>}
      <div className="row-actions">
        <button disabled={busy} onClick={save}>Save reading</button>
        <button className="link" onClick={() => onClose()}>Cancel</button>
      </div>
    </div>
  );
}

/** One small line chart per measure (last 90 days), with the target band. */
function ReadingCharts({ readings, plan }: { readings: Reading[]; plan: Plan | null }) {
  const measures = MEASURES.filter((m) => readings.some((r) => r.measure === m));
  if (!measures.length) return null;
  return (
    <div className="row-actions" style={{ alignItems: "flex-start", flexWrap: "wrap", gap: 12 }}>
      {measures.map((m) => (
        <MeasureChart key={m} measure={m} readings={readings.filter((r) => r.measure === m).reverse()}
                      limits={plan?.vital_plans.find((v) => v.measure === m) ?? null} />
      ))}
    </div>
  );
}

const FLAG_COLOR: Record<Flag, string> = { ok: "#0D9488", out_of_range: "#D97706", critical: "#B42318" };

function MeasureChart({ measure, readings, limits }: { measure: Measure; readings: Reading[]; limits: Partial<Limits> | null }) {
  const W = 340, H = 140, P = { l: 34, r: 8, t: 10, b: 18 };
  const bp = measure === "bp";
  const vals = readings.flatMap((r) => (bp ? [r.value1, r.value2 ?? r.value1] : [r.value1])).map(Number);
  const marks = [limits?.target_high, limits?.target_low, ...(bp ? [limits?.target_high2, limits?.target_low2] : [])]
    .filter((x): x is number => x != null).map(Number);
  let lo = Math.min(...vals, ...marks), hi = Math.max(...vals, ...marks);
  if (hi - lo < 1) { lo -= 1; hi += 1; }
  const pad = (hi - lo) * 0.1; lo -= pad; hi += pad;
  const t0 = Date.parse(readings[0].taken_at), t1 = Date.parse(readings[readings.length - 1].taken_at);
  const x = (iso: string) => P.l + (t1 === t0 ? (W - P.l - P.r) / 2 : ((Date.parse(iso) - t0) / (t1 - t0)) * (W - P.l - P.r));
  const y = (v: number) => P.t + (1 - (v - lo) / (hi - lo)) * (H - P.t - P.b);
  const line = (pick: (r: Reading) => number) => readings.map((r, i) => `${i ? "L" : "M"}${x(r.taken_at).toFixed(1)},${y(pick(r)).toFixed(1)}`).join(" ");
  const fmt = (v: number) => (Math.abs(hi - lo) < 10 ? v.toFixed(1) : Math.round(v).toString());
  return (
    <figure style={{ margin: 0 }}>
      <figcaption className="small"><strong>{MEASURE_INFO[measure].label}</strong> <span className="muted">({MEASURE_INFO[measure].unit})</span></figcaption>
      <svg width={W} height={H} role="img" aria-label={`${MEASURE_INFO[measure].label} chart, ${readings.length} readings`}
           style={{ background: "var(--card)", border: "1px solid var(--line)", borderRadius: 8 }}>
        {[hi - pad, lo + pad].map((v, i) => (
          <text key={i} x={P.l - 4} y={y(v) + 4} fontSize="10" textAnchor="end" fill="#6B7280">{fmt(v)}</text>
        ))}
        {marks.map((v, i) => (
          <line key={i} x1={P.l} x2={W - P.r} y1={y(v)} y2={y(v)} stroke="#D97706" strokeDasharray="4 3" strokeWidth={1} />
        ))}
        <path d={line((r) => Number(r.value1))} fill="none" stroke="#1A56DB" strokeWidth={1.5} />
        {bp && <path d={line((r) => Number(r.value2))} fill="none" stroke="#4F46E5" strokeWidth={1.5} strokeDasharray="2 2" />}
        {readings.map((r) => (
          <g key={r.id}>
            <circle cx={x(r.taken_at)} cy={y(Number(r.value1))} r={3} fill={FLAG_COLOR[r.flag]}>
              <title>{`${new Date(r.taken_at).toLocaleString()}: ${formatValue(r.measure, r.value1, r.value2, r.pulse)}`}</title>
            </circle>
            {bp && r.value2 != null && <circle cx={x(r.taken_at)} cy={y(Number(r.value2))} r={3} fill={FLAG_COLOR[r.flag]} />}
          </g>
        ))}
        <text x={P.l} y={H - 4} fontSize="10" fill="#6B7280">{new Date(t0).toLocaleDateString()}</text>
        <text x={W - P.r} y={H - 4} fontSize="10" textAnchor="end" fill="#6B7280">{new Date(t1).toLocaleDateString()}</text>
      </svg>
    </figure>
  );
}

// --- Dictate a plan to CC (M5) ----------------------------------------------

type DictatedItem = Omit<VitalPlan, "id" | "how_to" | "start_date">;
type Dictated = { items: DictatedItem[]; unclear: string[]; start_date: string; transcript: string };

/** A dictated measure as a plan row: how-to from the standard text, nothing else added. */
function fromDictation(d: DictatedItem, start: string): VitalPlan {
  const limits = Object.fromEntries(LIMIT_KEYS.map((k) => [k, d[k] ?? null])) as Limits;
  return {
    measure: d.measure, reason: d.reason ?? "", how_to: MEASURE_INFO[d.measure].howTo,
    times_of_day: d.times_of_day?.length ? d.times_of_day : [""], days_of_week: d.days_of_week ?? null,
    start_date: start, until_date: d.until_date ?? null, if_high: d.if_high ?? "", if_low: d.if_low ?? "", ...limits,
  };
}

const PLAN_SAMPLE = "Blood pressure po every morning at 7 and evening at 7 for two weeks, para makita kung tama na ang " +
  "amlodipine. Target below 140 over 90. If it's 180 over 120 or higher, or below 90 over 60, emergency na: call 911. " +
  "If above 160 over 100 twice in a row, rest fifteen minutes, measure again, then message the clinic.";

/** Say (or type) the plan; CC turns it into a draft. The audio is never stored. */
function DictatePlan({ patientId, replacesDraft, onCancel, onDraft }: {
  patientId: string; replacesDraft: boolean; onCancel: () => void; onDraft: (d: Dictated) => void;
}) {
  const [stt, setStt] = useState<string | null | undefined>(undefined);
  const [transcript, setTranscript] = useState("");
  const [busy, setBusy] = useState("");
  const [err, setErr] = useState("");
  useEffect(() => {
    callFunction<{ stt: string | null }>("clinical-note", { action: "status" }).then(({ data }) => setStt(data?.stt ?? null));
  }, []);

  async function transcribed(audio_base64: string, mime: string) {
    setBusy("Transcribing…"); setErr("");
    const { data, error } = await callFunction<{ transcript: string }>("clinical-note", {
      action: "transcribe", purpose: "plan", mode: "dictation", patient_id: patientId, audio_base64, mime,
    });
    setBusy("");
    if (error) { setErr(error); return; }
    setTranscript((t) => (t ? `${t}\n${data?.transcript ?? ""}` : data?.transcript ?? ""));
  }
  const { recording, seconds, error: micError, start, stop } = useRecorder(transcribed, 3 * 60);

  async function draft() {
    setBusy("CC is drafting the plan…"); setErr("");
    const { data, error } = await callFunction<Omit<Dictated, "transcript">>("clinical-note", {
      action: "plan_draft", patient_id: patientId, transcript,
    });
    setBusy("");
    if (error || !data) { setErr(error ?? "No draft."); return; }
    onDraft({ ...data, transcript });
  }

  return (
    <div className="form-card" style={{ marginTop: 12, maxWidth: 760 }}>
      <strong>Dictate the monitoring plan</strong>
      <p className="small muted" style={{ marginBottom: 6 }}>
        Say what to measure, when, for how long, the target, when it's an emergency, and what to do if high or low.
        CC fills in a draft for you to check and sign; it never adds a limit or time you didn't say. The recording
        is used once for speech-to-text and never stored.
        {replacesDraft && " The dictated measures replace the current draft's."}
      </p>
      {stt === null && (
        <p className="small muted">Speech-to-text isn't set up yet, so type the plan below.{" "}
          <button className="link" onClick={() => setTranscript(PLAN_SAMPLE)}>Use a sample</button></p>
      )}
      {stt && (
        <div className="row-actions">
          {!recording
            ? <button onClick={start} disabled={!!busy}>{transcript ? "Dictate more" : "Start dictating"}</button>
            : <button className="danger" onClick={stop}>Stop ({mmss(seconds)})</button>}
          {recording && <span className="rec-dot" aria-live="polite">Recording</span>}
        </div>
      )}
      <label htmlFor="plan-dictation">What was said (edit if needed)</label>
      <textarea id="plan-dictation" rows={5} value={transcript} disabled={recording}
                placeholder="Blood pressure every morning at 7 for two weeks, target below 140 over 90…"
                onChange={(e) => setTranscript(e.target.value)} />
      {(err || micError) && <p role="alert" className="small">{err || micError}</p>}
      {busy && <p role="status" className="small">{busy}</p>}
      <div className="row-actions" style={{ marginTop: 10 }}>
        <button disabled={!transcript.trim() || !!busy || recording} onClick={draft}>Make the draft</button>
        <button className="link" disabled={recording} onClick={onCancel}>Cancel</button>
      </div>
    </div>
  );
}
