import { useCallback, useEffect, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { supabase } from "../lib/supabase";
import { callFunction } from "../lib/api";
import { useSession, roleAtLeast } from "../lib/session";
import { useClinic } from "../lib/clinic";
import type { Campaign, CampaignStatus } from "../lib/types";

const STATUSES: (CampaignStatus | "all")[] = ["all", "draft", "scheduled", "active", "paused", "completed"];

export default function Campaigns() {
  const { role } = useSession();
  const { activeClinicId } = useClinic();
  const navigate = useNavigate();
  const canManage = roleAtLeast(role, "clinic_admin");

  const [campaigns, setCampaigns] = useState<Campaign[]>([]);
  const [filter, setFilter] = useState<CampaignStatus | "all">("all");
  const [busy, setBusy] = useState<string | null>(null);
  const [msg, setMsg] = useState("");
  const [deleteConfirmId, setDeleteConfirmId] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!activeClinicId) return;
    const { data } = await supabase.from("campaigns")
      .select("*").eq("clinic_id", activeClinicId).order("created_at", { ascending: false });
    setCampaigns((data as Campaign[]) ?? []);
  }, [activeClinicId]);

  useEffect(() => { load(); }, [load]);

  async function setStatus(c: Campaign, status: CampaignStatus) {
    setBusy(c.id);
    const { error } = await supabase.from("campaigns").update({ status }).eq("id", c.id);
    setBusy(null);
    setMsg(error ? `Failed: ${error.message}` : `Campaign ${status}.`);
    load();
  }

  async function startCalling(c: Campaign) {
    setBusy(c.id);
    if (c.status !== "active") await supabase.from("campaigns").update({ status: "active" }).eq("id", c.id);
    const { error } = await callFunction("start-campaign", { campaign_id: c.id, batch_size: 3 });
    setBusy(null);
    const chat = c.outreach_mode === "chat";
    setMsg(error ? `${chat ? "Sending" : "Dialer"}: ${error}` : chat ? "Sending started." : "Dialing started.");
    load();
  }

  async function doDelete(c: Campaign) {
    setBusy(c.id);
    const { error } = await supabase.from("campaigns").delete().eq("id", c.id);
    setBusy(null);
    setDeleteConfirmId(null);
    setMsg(error ? `Failed: ${error.message}` : "Campaign deleted.");
    load();
  }

  const shown = campaigns.filter((c) => filter === "all" || c.status === filter);

  return (
    <>
      <div className="page-head">
        <h1>Campaigns</h1>
        {canManage && <button onClick={() => navigate("/campaigns/new")}>New campaign</button>}
      </div>
      {msg && <p role="status">{msg}</p>}

      <div className="filter-row">
        {STATUSES.map((s) => (
          <button key={s} className={`chip ${filter === s ? "chip-on" : ""}`} onClick={() => setFilter(s)}>{s}</button>
        ))}
      </div>

      <table>
        <thead><tr><th>Name</th><th>Type</th><th>Status</th><th>Actions</th></tr></thead>
        <tbody>
          {shown.map((c) => (
            <tr key={c.id}>
              <td><Link to={`/campaigns/${c.id}`}>{c.name}</Link></td>
              <td>{c.appointment_type}</td>
              <td><span className={`badge status-${c.status}`}>{c.status}</span></td>
              <td>
                <div className="row-actions">
                  {(c.status === "draft" || c.status === "scheduled" || c.status === "paused") && (
                    <button disabled={busy === c.id} onClick={() => startCalling(c)}>
                      {busy === c.id ? "Starting…" : c.outreach_mode === "chat" ? "Start sending" : "Start calling"}
                    </button>
                  )}
                  {c.status === "active" && (
                    <button className="secondary" disabled={busy === c.id} onClick={() => setStatus(c, "paused")}>Pause</button>
                  )}
                  <Link className="btn secondary" to={`/campaigns/${c.id}`}>Open</Link>
                  {canManage && deleteConfirmId === c.id ? (
                    <>
                      <span style={{ marginRight: 8 }}>Delete this campaign?</span>
                      <button className="danger" disabled={busy === c.id} onClick={() => doDelete(c)}>Yes, delete</button>
                      <button className="secondary" disabled={busy === c.id} onClick={() => setDeleteConfirmId(null)}>Cancel</button>
                    </>
                  ) : canManage && (
                    <button className="danger" disabled={busy === c.id} onClick={() => setDeleteConfirmId(c.id)}>Delete</button>
                  )}
                </div>
              </td>
            </tr>
          ))}
          {!shown.length && <tr><td colSpan={4} className="empty">No campaigns in this view.</td></tr>}
        </tbody>
      </table>
    </>
  );
}
