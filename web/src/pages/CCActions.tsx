// CC action items — follow-ups CC has filed for the clinic (cc_action_items).
// RLS scopes rows to the user's clinic; any clinic user can mark done/dismiss.
import { useCallback, useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { supabase } from "../lib/supabase";
import { useSession } from "../lib/session";
import { useClinic } from "../lib/clinic";

type Item = {
  id: string;
  title: string;
  detail: string | null;
  category: string;
  severity: "info" | "warning" | "urgent";
  route: string | null;
  status: "open" | "done" | "dismissed";
  campaign_id: string | null;
  created_at: string;
  resolved_at: string | null;
  campaigns: { name: string } | null;
  source: "chat" | "nightly";
};

type Review = { run_at: string; status: "ok" | "skipped" | "error"; summary: string | null; items_created: number };

const SEVERITY_ORDER = { urgent: 0, warning: 1, info: 2 } as const;
const TABS = ["open", "done", "dismissed"] as const;

export default function CCActions() {
  const { session } = useSession();
  const { activeClinicId } = useClinic();
  const [tab, setTab] = useState<(typeof TABS)[number]>("open");
  const [items, setItems] = useState<Item[]>([]);
  const [busy, setBusy] = useState<string | null>(null);
  const [msg, setMsg] = useState("");
  const [review, setReview] = useState<Review | null>(null);

  useEffect(() => {
    if (!activeClinicId) return;
    supabase.from("cc_reviews")
      .select("run_at, status, summary, items_created")
      .eq("clinic_id", activeClinicId).neq("status", "error")
      .order("run_at", { ascending: false }).limit(1).maybeSingle()
      .then(({ data }) => setReview((data as Review | null) ?? null));
  }, [activeClinicId]);

  const load = useCallback(async () => {
    if (!activeClinicId) return;
    const { data } = await supabase.from("cc_action_items")
      .select("id, title, detail, category, severity, route, status, campaign_id, created_at, resolved_at, source, campaigns(name)")
      .eq("clinic_id", activeClinicId).eq("status", tab)
      .order("created_at", { ascending: false }).limit(100);
    const rows = (data as unknown as Item[]) ?? [];
    if (tab === "open") rows.sort((a, b) => SEVERITY_ORDER[a.severity] - SEVERITY_ORDER[b.severity]);
    setItems(rows);
  }, [activeClinicId, tab]);

  useEffect(() => {
    load();
    const ch = supabase.channel("cc-actions-page")
      .on("postgres_changes", { event: "*", schema: "public", table: "cc_action_items" }, load)
      .subscribe();
    return () => { supabase.removeChannel(ch); };
  }, [load]);

  async function setStatus(item: Item, status: Item["status"]) {
    setBusy(item.id);
    const resolved = status !== "open";
    const { error } = await supabase.from("cc_action_items").update({
      status,
      resolved_at: resolved ? new Date().toISOString() : null,
      resolved_by: resolved ? session?.user?.id ?? null : null,
    }).eq("id", item.id);
    setBusy(null);
    setMsg(error ? `Failed: ${error.message}` : status === "open" ? "Reopened." : `Marked ${status}.`);
    load();
  }

  return (
    <>
      <h1>CC action items</h1>
      <p className="muted">Follow-ups CC filed while analysing your campaigns, from chat and from its nightly review.</p>
      {msg && <p role="status">{msg}</p>}

      {review && (
        <section className="cc-review" aria-label="Latest nightly review">
          <div className="cc-review-head">
            <span className="cc-mark" aria-hidden="true">CC</span>
            <div>
              <strong>Nightly review</strong>
              <span className="muted small">
                {new Date(review.run_at).toLocaleString(undefined, { weekday: "short", month: "short", day: "numeric", hour: "numeric", minute: "2-digit" })}
                {review.status === "ok" && `, ${review.items_created} item${review.items_created === 1 ? "" : "s"} filed`}
              </span>
            </div>
          </div>
          {review.summary && <p>{review.summary}</p>}
        </section>
      )}

      <div className="tabs" role="tablist">
        {TABS.map((t) => (
          <button key={t} role="tab" aria-selected={tab === t} className={tab === t ? "tab-on" : ""} onClick={() => setTab(t)}>
            {t[0].toUpperCase() + t.slice(1)}
          </button>
        ))}
      </div>

      <div className="cc-items">
        {items.map((it) => (
          <article key={it.id} className={`cc-item cc-sev-${it.severity}`}>
            <div className="cc-item-main">
              <div className="cc-item-top">
                <span className={`cc-sev cc-sev-${it.severity}`}>{it.severity}</span>
                <span className="muted small">{it.category}{it.source === "nightly" ? " (nightly review)" : ""}</span>
                {it.campaign_id && it.campaigns && (
                  <Link className="small" to={`/campaigns/${it.campaign_id}`}>{it.campaigns.name}</Link>
                )}
                <span className="muted small">{new Date(it.created_at).toLocaleDateString()}</span>
              </div>
              <h3>{it.title}</h3>
              {it.detail && <p className="cc-item-detail">{it.detail}</p>}
            </div>
            <div className="row-actions">
              {it.route && <Link className="btn" to={it.route}>Go to screen</Link>}
              {it.status === "open" ? (
                <>
                  <button className="success" disabled={busy === it.id} onClick={() => setStatus(it, "done")}>Done</button>
                  <button className="secondary" disabled={busy === it.id} onClick={() => setStatus(it, "dismissed")}>Dismiss</button>
                </>
              ) : (
                <button className="secondary" disabled={busy === it.id} onClick={() => setStatus(it, "open")}>Reopen</button>
              )}
            </div>
          </article>
        ))}
        {!items.length && (
          <p className="empty">{tab === "open" ? "No open items. Ask CC how your latest campaign did." : `No ${tab} items.`}</p>
        )}
      </div>
    </>
  );
}
