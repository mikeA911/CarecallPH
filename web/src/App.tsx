import { useEffect, useState, type ReactNode } from "react";
import { NavLink, Navigate, Route, Routes, useLocation } from "react-router-dom";
import { supabase } from "./lib/supabase";
import { useSession, roleAtLeast } from "./lib/session";
import { useClinic } from "./lib/clinic";
import { MULTI_CLINIC_ENABLED } from "./lib/config";
import type { Role } from "./lib/types";

import Login from "./pages/Login";
import About from "./pages/About";
import BookPage from "./pages/BookPage";
import ConnectPage from "./pages/ConnectPage";
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
import AdminSettings from "./pages/admin/Settings";
import CCActions from "./pages/CCActions";
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

function Sidebar() {
  const { role, signOut, session } = useSession();
  const reviewCount = useReviewCount();
  const actionCount = useOpenActionCount();
  const isClinicAdmin = roleAtLeast(role, "clinic_admin");
  const isAdmin = role === "admin";

  return (
    <nav className="sidebar">
      <div className="brand">Care<span>Call</span></div>

      {isAdmin && <ClinicSwitcher />}

      <NavLink to="/" end>Dashboard</NavLink>
      <NavLink to="/review">
        Review queue
        {reviewCount > 0 && <span className="nav-badge">{reviewCount}</span>}
      </NavLink>
      <NavLink to="/campaigns">Campaigns</NavLink>
      <NavLink to="/patients">Patients</NavLink>
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
  const { session, loading, forcePasswordChange } = useSession();
  const location = useLocation();

  // Public self-service booking page — outside the auth guard. The patient is
  // not a portal user, so this must render before any session/loading gate
  // (self-booking-link-spec §6).
  if (location.pathname.startsWith("/book/")) {
    return (
      <Routes>
        <Route path="/book/:token" element={<BookPage />} />
      </Routes>
    );
  }

  // Public chat opt-in page (PH Phase 1) — also outside the auth guard.
  if (location.pathname.startsWith("/connect/")) {
    return (
      <Routes>
        <Route path="/connect/:token" element={<ConnectPage />} />
      </Routes>
    );
  }

  if (loading) return <div className="auth-screen"><div className="auth-card">Loading…</div></div>;
  if (!session || forcePasswordChange) return <Login />;

  return (
    <div className="layout">
      <Sidebar />
      <main className="content">
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
          <Route path="/clinicians" element={<Guard min="clinic_admin"><Clinicians /></Guard>} />
          <Route path="/settings/clinic" element={<Guard min="clinic_admin"><ClinicSettings /></Guard>} />
          <Route path="/settings/users" element={<Guard min="clinic_admin"><Users /></Guard>} />
          <Route path="/settings/profile" element={<Profile />} />
          <Route path="/admin/clinics" element={<Guard min="admin"><AdminClinics /></Guard>} />
          <Route path="/admin/settings" element={<Guard min="admin"><AdminSettings /></Guard>} />
          <Route path="*" element={<Navigate to="/" replace state={{ from: location }} />} />
        </Routes>
      </main>
      <CCPanel />
    </div>
  );
}
