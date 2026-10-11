import { useEffect, useMemo, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { supabase } from "../lib/supabase";
import { useSession, roleAtLeast } from "../lib/session";
import { useClinic } from "../lib/clinic";
import { statusLabel, type AuditEntry, type Provider } from "../lib/types";

type LiveRow = {
  campaign_id: string; patient_id: string; status: string; updated_at: string;
  patients?: { first_name: string; last_name: string };
};

type SlotRow = { starts_at: string; ends_at: string; kind: "available" | "booked" };

type PatientHit = {
  id: string; first_name: string; last_name: string; phone: string; date_of_birth: string;
};

type PatientCall = {
  id: string; started_at: string; result: string | null; summary: string | null;
  amd_result: string | null; verified: boolean;
};

const DOW = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const MON = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const dayKey = (d: Date) => `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`;
const fmtTime = (iso: string) =>
  new Date(iso).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });

export default function Dashboard() {
  const { role } = useSession();
  const { activeClinic, activeClinicId, clinics } = useClinic();
  const navigate = useNavigate();
  const isAdmin = role === "admin";
  const isClinicAdmin = roleAtLeast(role, "clinic_admin");

  const [feed, setFeed] = useState<LiveRow[]>([]);
  const [audit, setAudit] = useState<AuditEntry[]>([]);
  const [cards, setCards] = useState({
    clinics: 0, patientsOnFile: 0, inCampaign: 0, needsReview: 0,
  });

  // Hero: providers panel
  const [showProviders, setShowProviders] = useState(false);
  const [providers, setProviders] = useState<Provider[]>([]);

  // Window 5: appointment slots (available + booked)
  const [slots, setSlots] = useState<SlotRow[]>([]);

  // Window 7: patient search → call history
  const [query, setQuery] = useState("");
  const [searched, setSearched] = useState(false);
  const [hits, setHits] = useState<PatientHit[]>([]);
  const [openPatient, setOpenPatient] = useState<string | null>(null);
  const [patientCalls, setPatientCalls] = useState<Record<string, PatientCall[]>>({});

  async function load() {
    if (!activeClinicId) return;

    const patientsQuery = isAdmin
      ? supabase.from("patients").select("id", { count: "exact", head: true })
      : supabase.from("patients").select("id", { count: "exact", head: true }).eq("clinic_id", activeClinicId);
    const { count: patientsOnFile } = await patientsQuery;

    const { data: camps } = await supabase.from("campaigns").select("id").eq("clinic_id", activeClinicId);
    const campIds = (camps ?? []).map((c: { id: string }) => c.id);

    let inCampaign = 0, needsReview = 0;
    if (campIds.length) {
      const inCampQuery = isAdmin
        ? supabase.from("campaign_patients").select("patient_id", { count: "exact", head: true })
        : supabase.from("campaign_patients").select("patient_id", { count: "exact", head: true }).in("campaign_id", campIds);
      const { count: ic } = await inCampQuery;
      inCampaign = ic ?? 0;

      const reviewQuery = isAdmin
        ? supabase.from("campaign_patients").select("patient_id", { count: "exact", head: true }).in("status", ["needs_human", "verification_failed"])
        : supabase.from("campaign_patients").select("patient_id", { count: "exact", head: true }).in("campaign_id", campIds).in("status", ["needs_human", "verification_failed"]);
      const { count: nr } = await reviewQuery;
      needsReview = nr ?? 0;

      const { data: recent } = await supabase.from("campaign_patients")
        .select("campaign_id, patient_id, status, updated_at, patients(first_name, last_name)")
        .in("campaign_id", campIds)
        .neq("status", "pending")
        .order("updated_at", { ascending: false })
        .limit(12);
      setFeed((recent as unknown as LiveRow[]) ?? []);
    } else {
      setFeed([]);
    }

    setCards({ clinics: clinics.length, patientsOnFile: patientsOnFile ?? 0, inCampaign, needsReview });

    if (isClinicAdmin) {
      const auditQuery = isAdmin
        ? supabase.from("audit_log").select("*").order("created_at", { ascending: false }).limit(10)
        : supabase.from("audit_log").select("*").eq("clinic_id", activeClinicId).order("created_at", { ascending: false }).limit(10);
      const { data: a } = await auditQuery;
      setAudit((a as AuditEntry[]) ?? []);
    }
  }

  // Providers for this clinic (used by the hero "Meet our Providers" panel + slot calendar)
  async function loadProviders() {
    if (!activeClinicId) return;
    const { data } = await supabase.from("providers").select("*").eq("clinic_id", activeClinicId).order("name");
    setProviders((data as Provider[]) ?? []);
  }

  // Appointment slots: booked appointments (DB) + generated available slots per provider.
  async function loadSlots() {
    if (!activeClinicId) return;
    const { data: provs } = await supabase.from("providers").select("id").eq("clinic_id", activeClinicId).eq("active", true);
    const provIds = (provs ?? []).map((p: { id: string }) => p.id);
    if (!provIds.length) { setSlots([]); return; }

    const from = new Date();
    const to = new Date(); to.setDate(to.getDate() + 14);

    const { data: appts } = await supabase.from("appointments")
      .select("starts_at, ends_at, provider_id, status")
      .in("provider_id", provIds)
      .in("status", ["booked", "confirmed"])
      .gte("starts_at", from.toISOString())
      .lte("starts_at", to.toISOString())
      .order("starts_at");
    const booked: SlotRow[] = (appts ?? []).map((a: { starts_at: string; ends_at: string }) => ({
      starts_at: a.starts_at, ends_at: a.ends_at, kind: "booked",
    }));

    // Available slots from the DB function, per provider (capped to keep the window tidy).
    const available: SlotRow[] = [];
    for (const pid of provIds) {
      const { data } = await supabase.rpc("get_available_slots", { p_provider_id: pid, p_days: 14, p_limit: 40 });
      for (const s of (data as { slot_start: string; slot_end: string }[]) ?? []) {
        available.push({ starts_at: s.slot_start, ends_at: s.slot_end, kind: "available" });
      }
    }
    setSlots([...booked, ...available].sort((a, b) => a.starts_at.localeCompare(b.starts_at)));
  }

  useEffect(() => {
    load();
    loadProviders();
    loadSlots();
    const ch = supabase.channel("dash-feed")
      .on("postgres_changes", { event: "*", schema: "public", table: "campaign_patients" }, load)
      .on("postgres_changes", { event: "*", schema: "public", table: "appointments" }, loadSlots)
      .subscribe();
    return () => { supabase.removeChannel(ch); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeClinicId, role]);

  // Group slots by day and flag the "next 2 days" as upcoming.
  const calendar = useMemo(() => {
    const now = new Date();
    const soonCutoff = new Date(); soonCutoff.setDate(now.getDate() + 2); soonCutoff.setHours(23, 59, 59, 999);
    const map = new Map<string, { date: Date; soon: boolean; slots: SlotRow[] }>();
    for (const s of slots) {
      const d = new Date(s.starts_at);
      const k = dayKey(d);
      if (!map.has(k)) {
        map.set(k, { date: d, soon: d <= soonCutoff, slots: [] });
      }
      map.get(k)!.slots.push(s);
    }
    return [...map.values()].sort((a, b) => a.date.getTime() - b.date.getTime());
  }, [slots]);

  function toggleProviders() {
    setShowProviders((v) => !v);
  }

  async function runSearch() {
    if (!activeClinicId) return;
    const term = query.trim();
    setOpenPatient(null);
    let q = supabase.from("patients")
      .select("id, first_name, last_name, phone, date_of_birth")
      .eq("clinic_id", activeClinicId)
      .order("last_name")
      .limit(50);
    // "*" (or empty) lists everyone; otherwise fuzzy match on first/last name.
    if (term && term !== "*") {
      q = q.or(`first_name.ilike.%${term}%,last_name.ilike.%${term}%`);
    }
    const { data } = await q;
    setHits((data as PatientHit[]) ?? []);
    setSearched(true);
  }

  async function togglePatient(id: string) {
    if (openPatient === id) { setOpenPatient(null); return; }
    setOpenPatient(id);
    if (!patientCalls[id]) {
      const { data } = await supabase.from("call_logs")
        .select("id, started_at, result, summary, amd_result, verified")
        .eq("patient_id", id)
        .order("started_at", { ascending: false })
        .limit(10);
      setPatientCalls((prev) => ({ ...prev, [id]: (data as PatientCall[]) ?? [] }));
    }
  }

  // Every role sees the clinic name as the heading on top, matching the admin dashboard.
  const headline = activeClinic?.name ?? "Dashboard";
  const todayLabel = new Date().toLocaleDateString(undefined, {
    weekday: "long", year: "numeric", month: "long", day: "numeric",
  });

  return (
    <>
      {/* ---------- Status banner ---------- */}
      <div className="status-banner" role="status">
        <div className="sb-group">
          <span className="sb-status"><span className="sb-dot" aria-hidden />Network Servers Online</span>
          <span className="sb-sep" aria-hidden>·</span>
          <Link className="sb-clinic" to="/about">{headline}</Link>
        </div>
        <div className="sb-group">
          <span className="sb-date">{todayLabel}</span>
        </div>
      </div>

      {/* ---------- Hero header ---------- */}
      <section className="hero">
        <span className="hero-pill"><span className="dot" aria-hidden />Modernized Clinical Care</span>
        <h1>Empowering your wellness journey with digital precision.</h1>
        <p className="hero-lede">
          Welcome to CareCall's integrated outreach console for {headline}. Track outcomes,
          review the wait queue, manage patients and campaigns, and oversee AI-driven
          appointment scheduling — all grounded in your verified Supabase data.
        </p>
        <div className="hero-actions">
          <button className="hero-btn primary" onClick={toggleProviders}>Meet our Providers</button>
          <button className="hero-btn" onClick={() => navigate("/patients")}>Patient Management</button>
          <button className="hero-btn" onClick={() => navigate("/campaigns")}>Campaigns</button>
          <button className="hero-btn" onClick={() => navigate("/review")}>Check Clinic Wait Queue</button>
        </div>
      </section>

      {/* Meet our Providers — inline panel toggled from the hero */}
      {showProviders && (
        <div className="window" style={{ marginBottom: "var(--sp-3)" }}>
          <div className="window-head">
            <h2>Meet our Providers</h2>
            <button className="link" onClick={() => setShowProviders(false)}>Hide</button>
          </div>
          {providers.length ? (
            <div className="cards">
              {providers.map((p) => (
                <div className="card" key={p.id}>
                  <div style={{ fontFamily: "var(--font-display)", fontWeight: 600, fontSize: 15 }}>{p.name}</div>
                  <div className="lbl">{p.specialty ?? "General practice"}</div>
                  {!p.active && <span className="badge declined" style={{ marginTop: 6 }}>inactive</span>}
                </div>
              ))}
            </div>
          ) : (
            <p className="empty">No providers on file yet.</p>
          )}
        </div>
      )}

      {/* ---------- Scorecards (Stats) ---------- */}
      <div className="cards">
        {isAdmin && (
          <div className="card"><div className="num">{cards.clinics}</div><div className="lbl">Clinics</div></div>
        )}
        <div className="card"><div className="num">{cards.patientsOnFile}</div><div className="lbl">Patients on file</div></div>
        <div className="card"><div className="num">{cards.inCampaign}</div><div className="lbl">In active campaigns</div></div>
        <Link to="/review" className="card card-link">
          <div className="num">{cards.needsReview}</div><div className="lbl">Calls needing review</div>
        </Link>
      </div>

      {/* ---------- New windows: calendar / location / patient search ---------- */}
      <div className="window-grid">
        {/* 5. Appointment-slots calendar */}
        <div className="window">
          <div className="window-head"><h2>Appointment slots</h2></div>
          <div className="window-sub">Next 14 days · upcoming 2 days highlighted</div>
          <div className="cal-legend">
            <span className="key"><span className="swatch available" />Available</span>
            <span className="key"><span className="swatch booked" />Booked</span>
            <span className="key"><span className="swatch soon" />Next 2 days</span>
          </div>
          <div className="cal-days">
            {calendar.map((d) => (
              <div key={dayKey(d.date)} className={`cal-day${d.soon ? " is-soon" : ""}`}>
                <div className="cal-day-head">
                  <strong>{DOW[d.date.getDay()]} {MON[d.date.getMonth()]} {d.date.getDate()}</strong>
                  {d.soon && <span className="cal-soon-tag">Upcoming</span>}
                </div>
                <div className="cal-slots">
                  {d.slots.slice(0, 16).map((s, i) => (
                    <span key={i} className={`cal-slot ${s.kind}`} title={s.kind}>
                      {fmtTime(s.starts_at)}
                    </span>
                  ))}
                  {d.slots.length > 16 && <span className="cal-slot available">+{d.slots.length - 16} more</span>}
                </div>
              </div>
            ))}
            {!calendar.length && <p className="empty">No slots or bookings in the next 14 days. Add clinician availability to generate slots.</p>}
          </div>
        </div>

        {/* 6. Medical center location */}
        <div className="window">
          <div className="window-head"><h2>Medical center</h2></div>
          <div className="loc-map">
            <div className="loc-pin" />
            <span className="map-note">Map view coming soon</span>
          </div>
          <div className="loc-row"><span className="loc-label">Center</span><span>{activeClinic?.name ?? "—"}</span></div>
          <div className="loc-row"><span className="loc-label">Timezone</span><span>{activeClinic?.timezone ?? "—"}</span></div>
          <div className="loc-row"><span className="loc-label">Callback</span><span>{activeClinic?.phone_callback ?? "Not set"}</span></div>
        </div>

        {/* 7. Patient search → call history / debug */}
        <div className="window">
          <div className="window-head"><h2>Patient call history</h2></div>
          <form className="search-row" onSubmit={(e) => { e.preventDefault(); runSearch(); }}>
            <input
              placeholder="Search patient name…"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              aria-label="Search patient by name"
            />
            <button type="submit">Search</button>
          </form>
          <div className="search-hint">Type a name, or use <code>*</code> to list all patients.</div>
          <div className="search-results">
            {hits.map((p) => (
              <button key={p.id} className={`search-patient${openPatient === p.id ? " open" : ""}`} onClick={() => togglePatient(p.id)}>
                <div className="sp-name">{p.first_name} {p.last_name}</div>
                <div className="sp-meta">{p.phone} · DOB {p.date_of_birth}</div>
                {openPatient === p.id && (
                  <div className="sp-calls">
                    {(patientCalls[p.id] ?? []).map((c) => (
                      <div key={c.id} className="sp-call">
                        <span className="sp-when">{new Date(c.started_at).toLocaleString()}</span>
                        {c.result
                          ? <span className={`badge ${c.result}`}>{c.result.replace(/_/g, " ")}</span>
                          : <span className="badge declined">no result</span>}
                        <span className="metadata">{c.verified ? "verified" : "unverified"} · {c.amd_result ?? "—"}</span>
                        {c.summary && <span className="sp-summary">{c.summary}</span>}
                      </div>
                    ))}
                    {patientCalls[p.id] && !patientCalls[p.id].length && (
                      <div className="metadata">No calls recorded for this patient.</div>
                    )}
                    <Link to="/history" className="link" onClick={(e) => e.stopPropagation()}>Open full call history →</Link>
                  </div>
                )}
              </button>
            ))}
            {searched && !hits.length && <p className="empty">No patients matched.</p>}
            {!searched && <p className="empty">Search a patient to view or debug their call history.</p>}
          </div>
        </div>
      </div>

      {/* ---------- Live activity ---------- */}
      <h2><span className="live-dot" aria-hidden />Live activity</h2>
      <table>
        <thead><tr><th>Patient</th><th>Status</th><th>Updated</th></tr></thead>
        <tbody>
          {feed.map((r) => (
            <tr key={`${r.campaign_id}-${r.patient_id}`}>
              <td>{r.patients ? `${r.patients.first_name} ${r.patients.last_name}` : r.patient_id.slice(0, 8)}</td>
              <td><span className={`badge ${r.status}`}>{statusLabel(r.status)}</span></td>
              <td>{new Date(r.updated_at).toLocaleTimeString()}</td>
            </tr>
          ))}
          {!feed.length && <tr><td colSpan={3} className="empty">No call activity yet.</td></tr>}
        </tbody>
      </table>

      {isClinicAdmin && (
        <>
          <h2>Recent management activity</h2>
          <table>
            <thead><tr><th>Action</th><th>Target</th><th>When</th></tr></thead>
            <tbody>
              {audit.map((a) => (
                <tr key={a.id}>
                  <td>{a.action.replace(/_/g, " ")}</td>
                  <td>{a.target_type ?? "—"}</td>
                  <td>{new Date(a.created_at).toLocaleString()}</td>
                </tr>
              ))}
              {!audit.length && <tr><td colSpan={3} className="empty">No recent activity.</td></tr>}
            </tbody>
          </table>
        </>
      )}

      <footer className="copyright">&copy; BettrAI 2026</footer>
    </>
  );
}
