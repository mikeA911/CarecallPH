import { useEffect, useState, type ReactNode } from "react";
import { Link, NavLink, Navigate, Route, Routes, useLocation } from "react-router-dom";
import { supabase } from "./lib/supabase";
import { useSession, roleAtLeast, canManageCare } from "./lib/session";
import { useClinic } from "./lib/clinic";
import { MULTI_CLINIC_ENABLED } from "./lib/config";
import type { Role } from "./lib/types";

import Login from "./pages/Login";
import About from "./pages/About";
import Dashboard from "./pages/Dashboard";
import Review from "./pages/Review";
import Campaigns from "./pages/Campaigns";
import CampaignNew from "./pages/CampaignNew";
import CampaignDetail from "./pages/CampaignDetail";
import Patients from "./pages/Patients";
import PatientDetail from "./pages/PatientDetail";
import CallHistory from "./pages/CallHistory";
import Clinicians from "./pages/Clinicians";
import ClinicSettings from "./pages/settings/ClinicSettings";
import Users from "./pages/settings/Users";
import Profile from "./pages/settings/Profile";
import AdminClinics from "./pages/admin/Clinics";
import BugReports from "./pages/admin/BugReports";
import AdminSettings from "./pages/admin/Settings";
import CCActions from "./pages/CCActions";
import Readings from "./pages/Readings";
import CCPanel from "./components/CCPanel";

function Guard({ min, children }: { min: Role; children: ReactNode }) {
  const { role } = useSession();
  if (!roleAtLeast(role, min)) return <Navigate to="/" replace />;
  return <>{children}</>;
}

function useReviewCount() {
  const { activeClinicId } = useClinic();
  const [count, setCount] = useState(0);
  useEffect(() => {
    if (!activeClinicId) return;
    async function load() {
      // Scope via campaigns in the active clinic; RLS enforces the rest.
      const { data: camps } = await supabase.from("campaigns")
        .select("id").eq("clinic_id", activeClinicId);
      const ids = (camps ?? []).map((c: { id: string }) => c.id);
      if (!ids.length) { setCount(0); return; }
      const { count: n } = await supabase.from("campaign_patients")
        .select("patient_id", { count: "exact", head: true })
        .in("campaign_id", ids)
        .in("status", ["needs_human", "verification_failed"]);
      setCount(n ?? 0);
    }
    load();
    const ch = supabase.channel("review-badge")
      .on("postgres_changes", { event: "*", schema: "public", table: "campaign_patients" }, load)
      .subscribe();
    return () => { supabase.removeChannel(ch); };
  }, [activeClinicId]);
  return count;
}

function useOpenActionCount() {
  const { activeClinicId } = useClinic();
  const [count, setCount] = useState(0);
  useEffect(() => {
    if (!activeClinicId) return;
    async function load() {
      const { count: n } = await supabase.from("cc_action_items")
        .select("id", { count: "exact", head: true })
        .eq("clinic_id", activeClinicId).eq("status", "open");
      setCount(n ?? 0);
    }
    load();
    const ch = supabase.channel("cc-actions-badge")
      .on("postgres_changes", { event: "*", schema: "public", table: "cc_action_items" }, load)
      .subscribe();
    return () => { supabase.removeChannel(ch); };
  }, [activeClinicId]);
  return count;
}

/** Unreviewed out-of-range and critical vital-sign readings (nurses and doctors). */
function useReadingsCount(enabled: boolean) {
  const { activeClinicId } = useClinic();
  const [count, setCount] = useState(0);
  useEffect(() => {
    if (!activeClinicId || !enabled) return;
    async function load() {
      const { count: n } = await supabase.from("vital_readings")
        .select("id", { count: "exact", head: true })
        .eq("clinic_id", activeClinicId).neq("flag", "ok").is("reviewed_at", null);
      setCount(n ?? 0);
    }
    load();
    const ch = supabase.channel("readings-badge")
      .on("postgres_changes", { event: "*", schema: "public", table: "vital_readings" }, load)
      .subscribe();
    return () => { supabase.removeChannel(ch); };
  }, [activeClinicId, enabled]);
  return count;
}

function ClinicSwitcher() {
  const { role } = useSession();
  const { clinics, activeClinicId, setActiveClinicId } = useClinic();
  if (role !== "admin") return null;

  // D2: switcher is a disabled single-item stub until multi-clinic is enabled.
  if (!MULTI_CLINIC_ENABLED) {
    const only = clinics.find((c) => c.id === activeClinicId) ?? clinics[0];
    return (
      <div className="clinic-switcher">
        <label>Clinic context</label>
        <select disabled value={only?.id ?? ""} title="Multi-clinic switching is disabled in this build">
          <option value={only?.id ?? ""}>{only?.name ?? "—"}</option>
        </select>
      </div>
    );
  }
  return (
    <div className="clinic-switcher">
      <label>Clinic context</label>
      <select value={activeClinicId ?? ""} onChange={(e) => setActiveClinicId(e.target.value)}>
        {clinics.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
      </select>
    </div>
  );
}

function Sidebar({ onOpenCC }: { onOpenCC: () => void }) {
  const { role, clinicalRole, signOut, session } = useSession();
  const clinical = canManageCare(clinicalRole);
  const reviewCount = useReviewCount();
  const readingsCount = useReadingsCount(clinical);
  const actionCount = useOpenActionCount();
  const isClinicAdmin = roleAtLeast(role, "clinic_admin");
  const isAdmin = role === "admin";

  return (
    <nav className="sidebar">
      {/* Logo opens CC; the wordmark goes to About. */}
      <div className="brand">
        <button type="button" className="brand-cc" onClick={onOpenCC} title="Ask CC" aria-label="Ask CC, the CareCall assistant">
          <img className="brand-icon" src="/website-192x192.png" alt="" width={32} height={32} />
        </button>
        <Link to="/about" className="brand-about" title="About CareCall">
          <img className="brand-wordmark" src="/carecall.png" alt="CareCall, about this app" width={61} height={28} />
        </Link>
      </div>

      {isAdmin && <ClinicSwitcher />}

      <NavLink to="/" end>Dashboard</NavLink>
      <NavLink to="/review">
        Review queue
        {reviewCount > 0 && <span className="nav-badge">{reviewCount}</span>}
      </NavLink>
      <NavLink to="/campaigns">Campaigns</NavLink>
      <NavLink to="/patients">Patients</NavLink>
      {clinical && (
        <NavLink to="/readings">
          Readings to review
          {readingsCount > 0 && <span className="nav-badge">{readingsCount}</span>}
        </NavLink>
      )}
      <NavLink to="/history">Call history</NavLink>
      <NavLink to="/cc">
        CC action items
        {actionCount > 0 && <span className="nav-badge">{actionCount}</span>}
      </NavLink>

      {isClinicAdmin && (
        <>
          <div className="nav-sep">Manage</div>
          <NavLink to="/clinicians">Clinicians</NavLink>
          <NavLink to="/settings/clinic">Clinic settings</NavLink>
          <NavLink to="/settings/users">Users</NavLink>
        </>
      )}

      {isAdmin && (
        <>
          <div className="nav-sep">Platform</div>
          <NavLink to="/admin/clinics">Clinics</NavLink>
          <NavLink to="/admin/settings">Global settings</NavLink>
          <NavLink to="/admin/bugs">Bug reports</NavLink>
        </>
      )}

      <div className="nav-spacer" />
      <div className="profile-link" data-tooltip={session?.user?.email ?? undefined}>
        <NavLink to="/settings/profile">Profile</NavLink>
      </div>
      <button className="signout" onClick={signOut}>Sign out</button>
    </nav>
  );
}

export default function App() {
  const { session, loading, forcePasswordChange, idleWarning, stayActive } = useSession();
  const location = useLocation();
  const [ccOpen, setCcOpen] = useState(false);

  // Public patient pages (/book, /connect) never reach this component: main.tsx
  // routes them to PublicApp, outside the sign-in gate.
  if (loading) return <div className="auth-screen"><div className="auth-card">Loading…</div></div>;
  if (!session || forcePasswordChange) return <Login />;

  return (
    <div className="layout">
      <Sidebar onOpenCC={() => setCcOpen(true)} />
      <main className="content">
        {idleWarning && (
          <div className="idle-warning" role="alert">
            <span>No activity for a while. You'll be signed out in 2 minutes to protect patient information.</span>
            <button onClick={stayActive}>Stay signed in</button>
          </div>
        )}
        <Routes>
          <Route path="/" element={<Dashboard />} />
          <Route path="/about" element={<About />} />
          <Route path="/review" element={<Review />} />
          <Route path="/campaigns" element={<Campaigns />} />
          <Route path="/campaigns/new" element={<Guard min="clinic_admin"><CampaignNew /></Guard>} />
          <Route path="/campaigns/:id" element={<CampaignDetail />} />
          <Route path="/patients" element={<Patients />} />
          <Route path="/patients/:id" element={<PatientDetail />} />
          <Route path="/history" element={<CallHistory />} />
          <Route path="/cc" element={<CCActions />} />
          <Route path="/readings" element={<Readings />} />
          <Route path="/clinicians" element={<Guard min="clinic_admin"><Clinicians /></Guard>} />
          <Route path="/settings/clinic" element={<Guard min="clinic_admin"><ClinicSettings /></Guard>} />
          <Route path="/settings/users" element={<Guard min="clinic_admin"><Users /></Guard>} />
          <Route path="/settings/profile" element={<Profile />} />
          <Route path="/admin/clinics" element={<Guard min="admin"><AdminClinics /></Guard>} />
          <Route path="/admin/settings" element={<Guard min="admin"><AdminSettings /></Guard>} />
          <Route path="/admin/bugs" element={<Guard min="admin"><BugReports /></Guard>} />
          <Route path="*" element={<Navigate to="/" replace state={{ from: location }} />} />
        </Routes>
      </main>
      <CCPanel open={ccOpen} onClose={() => setCcOpen(false)} />
    </div>
  );
}
