import { useCallback, useEffect, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { supabase } from "../lib/supabase";
import { callFunction } from "../lib/api";
import { useSession, roleAtLeast } from "../lib/session";
import { statusLabel, type Campaign, type CampaignStat, type CampaignStatus } from "../lib/types";

type PatientRow = {
  patient_id: string; status: string; attempts: number; last_attempt_at: string | null;
  flag_reason: string | null; updated_at: string; dial_after: string | null;
  patients?: { first_name: string; last_name: string; phone: string };
};
type DebugLog = {
  id: string; started_at: string; amd_result: string | null; verified: boolean;
  verification_attempts: number; result: string | null; duration_seconds: number | null;
  patients?: { first_name: string; last_name: string };
};

export default function CampaignDetail() {
  const { id } = useParams<{ id: string }>();
  const { role } = useSession();
  const canManage = roleAtLeast(role, "clinic_admin");

  const [campaign, setCampaign] = useState<Campaign | null>(null);
  const [stat, setStat] = useState<CampaignStat | null>(null);
  const [patients, setPatients] = useState<PatientRow[]>([]);
  const [logs, setLogs] = useState<DebugLog[]>([]);
  const [tab, setTab] = useState<"patients" | "debug">("patients");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState("");
  const [edit, setEdit] = useState<{ name: string; greeting_context: string; scheduled_start: string | null } | null>(null);

  const load = useCallback(async () => {
    if (!id) return;
    const [{ data: c }, { data: s }, { data: p }, { data: l }] = await Promise.all([
      supabase.from("campaigns").select("*").eq("id", id).single(),
      supabase.from("campaign_stats").select("*").eq("campaign_id", id).maybeSingle(),
      supabase.from("campaign_patients")
        .select("patient_id, status, attempts, last_attempt_at, flag_reason, updated_at, dial_after, patients(first_name, last_name, phone)")
        .eq("campaign_id", id).order("updated_at", { ascending: false }),
      supabase.from("call_logs")
        .select("id, started_at, amd_result, verified, verification_attempts, result, duration_seconds, patients(first_name, last_name)")
        .eq("campaign_id", id).order("started_at", { ascending: false }).limit(50),
    ]);
    setCampaign(c as Campaign);
    setStat(s as CampaignStat);
    setPatients((p as unknown as PatientRow[]) ?? []);
    setLogs((l as unknown as DebugLog[]) ?? []);
  }, [id]);

  useEffect(() => {
    load();
    const ch = supabase.channel(`campaign-${id}`)
      .on("postgres_changes", { event: "*", schema: "public", table: "campaign_patients", filter: `campaign_id=eq.${id}` }, load)
      .subscribe();
    return () => { supabase.removeChannel(ch); };
  }, [id, load]);

  async function setStatus(status: CampaignStatus) {
    setBusy(true);
    await supabase.from("campaigns").update({ status }).eq("id", id);
    setBusy(false); setMsg(`Campaign ${status}.`); load();
  }

  async function startCalling() {
    setBusy(true);
    if (campaign?.status !== "active") await supabase.from("campaigns").update({ status: "active" }).eq("id", id);
    const { error } = await callFunction("start-campaign", { campaign_id: id, batch_size: 3 });
    const chatMode = campaign?.outreach_mode === "chat";
    setBusy(false);
    setMsg(error ? `${chatMode ? "Sending" : "Dialer"}: ${error}` : chatMode ? "Sending started." : "Dialing started.");
    load();
  }

  async function saveEdit() {
    if (!edit) return;
    setBusy(true);
    const update: Record<string, unknown> = {
      name: edit.name,
      greeting_context: edit.greeting_context,
      scheduled_start: edit.scheduled_start ? new Date(edit.scheduled_start).toISOString() : null,
    };
    await supabase.from("campaigns").update(update).eq("id", id);
    setBusy(false); setEdit(null); setMsg("Saved."); load();
  }

  if (!campaign) return <p className="empty">Loading…</p>;

  const chat = campaign.outreach_mode === "chat";
  const editable = canManage && (campaign.status === "draft" || campaign.status === "scheduled" || campaign.status === "paused");
  const total = stat?.total_patients ?? 0;
  const seg = (n?: number) => (total ? `${Math.round(100 * (n ?? 0) / total)}%` : "0%");

  return (
    <>
      <div className="page-head">
        <h1>{campaign.name}</h1>
        <span className={`badge status-${campaign.status}`}>{campaign.status}</span>
      </div>
      <p className="muted"><Link to="/campaigns">← All campaigns</Link></p>
      <p className="muted small">
        {chat
          ? `Chat message with a booking link · one reminder after ${campaign.chat_reminder_hours} hours · no calls`
          : "AI phone calls"}
      </p>
      {msg && <p role="status">{msg}</p>}

      <div className="row-actions">
        {(campaign.status === "draft" || campaign.status === "scheduled" || campaign.status === "paused") && (
          <button disabled={busy} onClick={startCalling}>{chat ? "Start sending" : "Start calling"}</button>
        )}
        {campaign.status === "active" && (
          <button className="secondary" disabled={busy} onClick={() => setStatus("paused")}>Pause</button>
        )}
        {canManage && (campaign.status === "active" || campaign.status === "paused") && (
          <button className="secondary" disabled={busy} onClick={() => setStatus("completed")}>Mark completed</button>
        )}
        {editable && !edit && (
          <button className="secondary" onClick={() => setEdit({ name: campaign.name, greeting_context: campaign.greeting_context, scheduled_start: campaign.scheduled_start })}>Edit</button>
        )}
      </div>

      {edit && (
        <div className="form-card" style={{ marginTop: 12 }}>
          <label>Name</label>
          <input value={edit.name} onChange={(e) => setEdit({ ...edit, name: e.target.value })} />
          <label>{chat ? "Reason in the message to the patient" : "Reason the AI gives"}</label>
          <textarea rows={3} value={edit.greeting_context} onChange={(e) => setEdit({ ...edit, greeting_context: e.target.value })} />
          <label>Schedule start</label>
          <input type="datetime-local" value={edit.scheduled_start ?? ""} onChange={(e) => setEdit({ ...edit, scheduled_start: e.target.value })} />
          <div className="row-actions" style={{ marginTop: 10 }}>
            <button disabled={busy} onClick={saveEdit}>Save</button>
            <button className="secondary" onClick={() => setEdit(null)}>Cancel</button>
          </div>
        </div>
      )}

      <h2>Progress</h2>
      <div className="progress-bar" title={`${total} patients`}>
        <span className="seg booked" style={{ width: seg(stat?.booked) }} />
        <span className="seg pending" style={{ width: seg(stat?.pending) }} />
        <span className="seg unreached" style={{ width: seg(stat?.unreached) }} />
        <span className="seg needs" style={{ width: seg(stat?.needs_human) }} />
      </div>
      <div className="cards">
        <div className="card"><div className="num">{stat?.booked ?? 0}</div><div className="lbl">Booked</div></div>
        <div className="card"><div className="num">{stat?.pending ?? 0}</div><div className="lbl">Pending</div></div>
        {chat && <div className="card"><div className="num">{stat?.messaged ?? 0}</div><div className="lbl">Link sent</div></div>}
        {chat && <div className="card"><div className="num">{stat?.needs_invite ?? 0}</div><div className="lbl">Needs chat invite</div></div>}
        <div className="card"><div className="num">{stat?.unreached ?? 0}</div><div className="lbl">Unreached</div></div>
        <div className="card"><div className="num">{stat?.needs_human ?? 0}</div><div className="lbl">Needs review</div></div>
        <div className="card"><div className="num">{stat?.booking_rate_pct != null ? `${stat.booking_rate_pct}%` : "—"}</div><div className="lbl">Booking rate</div></div>
      </div>

      <div className="tabs">
        <button className={tab === "patients" ? "tab-on" : ""} onClick={() => setTab("patients")}>Patients</button>
        <button className={tab === "debug" ? "tab-on" : ""} onClick={() => setTab("debug")}>Debug</button>
      </div>

      {tab === "patients" ? (
        <table>
          <thead><tr><th>Patient</th><th>Status</th><th>Attempts</th><th>Last attempt</th></tr></thead>
          <tbody>
            {patients.map((r) => (
              <tr key={r.patient_id}>
                <td><Link to={`/patients/${r.patient_id}`}>{r.patients ? `${r.patients.first_name} ${r.patients.last_name}` : r.patient_id.slice(0, 8)}</Link></td>
                <td>
                  <span className={`badge ${r.status}`}>{statusLabel(r.status)}</span>
                  {r.status === "notified" && r.dial_after && (
                    <div className="muted small">{dialCountdown(r.dial_after)}</div>
                  )}
                  {r.flag_reason && <div className="muted small">{r.flag_reason}</div>}
                  {r.status === "needs_invite" && (
                    <div className="muted small">Open the patient to send a chat invite.</div>
                  )}
                </td>
                <td>{r.attempts}</td>
                <td>{r.last_attempt_at ? new Date(r.last_attempt_at).toLocaleString() : "—"}</td>
              </tr>
            ))}
            {!patients.length && <tr><td colSpan={4} className="empty">No patients assigned yet.</td></tr>}
          </tbody>
        </table>
      ) : (
        <table>
          <thead><tr><th>When</th><th>Patient</th><th>AMD</th><th>Verify</th><th>Result</th><th>Length</th></tr></thead>
          <tbody>
            {logs.map((l) => (
              <tr key={l.id}>
                <td>{new Date(l.started_at).toLocaleString()}</td>
                <td>{l.patients ? `${l.patients.first_name} ${l.patients.last_name}` : "—"}</td>
                <td>{l.amd_result ?? "—"}</td>
                <td>{l.verified ? "yes" : `no (${l.verification_attempts})`}</td>
                <td>{l.result ? <span className={`badge ${l.result}`}>{l.result.replace(/_/g, " ")}</span> : "—"}</td>
                <td>{l.duration_seconds != null ? `${l.duration_seconds}s` : "—"}</td>
              </tr>
            ))}
            {!logs.length && <tr><td colSpan={6} className="empty">No call logs yet.</td></tr>}
          </tbody>
        </table>
      )}
    </>
  );
}

/** Friendly countdown for a notified patient's scheduled dial time. */
function dialCountdown(dialAfter: string): string {
  const ms = new Date(dialAfter).getTime() - Date.now();
  if (ms <= 0) return "calling shortly";
  const mins = Math.round(ms / 60000);
  return mins <= 1 ? "calling in ~1 min" : `calling in ~${mins} min`;
}
