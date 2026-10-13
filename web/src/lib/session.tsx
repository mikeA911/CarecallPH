import { createContext, useContext, useEffect, useState, type ReactNode } from "react";
import type { Session } from "@supabase/supabase-js";
import { supabase } from "./supabase";
import type { ClinicalRole, Role } from "./types";
import { markActive, useIdleSignOut } from "./idle";

type SessionState = {
  session: Session | null;
  loading: boolean;
  role: Role | null;
  clinicId: string | null;
  /** doctor | nurse | front_desk; defaults by role when unset (same as the database). */
  clinicalRole: ClinicalRole | null;
  displayName: string;
  avatarUrl: string | null;
  /** True when the account was created/reset with a temporary password. */
  forcePasswordChange: boolean;
  /** True after following a "forgot password" email link, until a new password is set. */
  passwordRecovery: boolean;
  clearPasswordRecovery: () => void;
  /** "idle" after an automatic sign-out for inactivity, shown on the login screen. */
  signedOutReason: "idle" | null;
  /** True in the last 2 minutes before an automatic sign-out. */
  idleWarning: boolean;
  stayActive: () => void;
  refresh: () => Promise<void>;
  signOut: () => Promise<void>;
};

const Ctx = createContext<SessionState | null>(null);

// Arriving from an email link (password reset) is a new sign-in: start the
// inactivity clock before the session loads, so an old activity time from a
// previous visit doesn't sign the user straight out. The sign-in form does
// the same (Login.tsx). A session restored from another tab or a reload keeps
// the shared activity time.
if (/access_token=|[?&]code=/.test(window.location.hash + window.location.search)) markActive();

function readClaims(session: Session | null) {
  const meta = (session?.user?.app_metadata ?? {}) as Record<string, unknown>;
  const um = (session?.user?.user_metadata ?? {}) as Record<string, unknown>;
  const role = (meta.role as Role) ?? null;
  return {
    role,
    clinicId: (meta.clinic_id as string) ?? null,
    clinicalRole: clinicalRoleOf(role, meta.clinical_role),
    forcePasswordChange: meta.force_password_change === true,
    displayName: (um.display_name as string) ?? session?.user?.email ?? "",
    avatarUrl: (um.avatar_url as string) ?? null,
  };
}

export function SessionProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session | null>(null);
  const [loading, setLoading] = useState(true);
  const [passwordRecovery, setPasswordRecovery] = useState(false);
  const [signedOutReason, setSignedOutReason] = useState<"idle" | null>(null);

  async function refresh() {
    const { data } = await supabase.auth.getSession();
    setSession(data.session);
  }

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => {
      setSession(data.session);
      setLoading(false);
    });
    const { data: sub } = supabase.auth.onAuthStateChange((event, s) => {
      if (event === "PASSWORD_RECOVERY") markActive();
      if (s && event === "SIGNED_IN") setSignedOutReason(null);
      setSession(s);
      // Arriving via a "forgot password" email link: force the set-new-password flow.
      if (event === "PASSWORD_RECOVERY") setPasswordRecovery(true);
    });
    return () => sub.subscription.unsubscribe();
  }, []);

  const idle = useIdleSignOut(!!session, () => {
    setSignedOutReason("idle");
    setPasswordRecovery(false);
    // This device only; the user stays signed in on their other devices.
    supabase.auth.signOut({ scope: "local" });
  });

  const claims = readClaims(session);

  const value: SessionState = {
    session,
    loading,
    ...claims,
    passwordRecovery,
    clearPasswordRecovery: () => setPasswordRecovery(false),
    signedOutReason,
    idleWarning: idle.warning,
    stayActive: idle.stay,
    refresh,
    signOut: async () => { setPasswordRecovery(false); await supabase.auth.signOut(); },
  };

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useSession(): SessionState {
  const v = useContext(Ctx);
  if (!v) throw new Error("useSession must be used within SessionProvider");
  return v;
}

/** Role rank helper for guards: admin > clinic_admin > staff. */
export function roleAtLeast(role: Role | null, min: Role): boolean {
  const rank: Record<Role, number> = { staff: 1, clinic_admin: 2, admin: 3 };
  if (!role) return false;
  return rank[role] >= rank[min];
}

/** Clinical role from the stored claim, or the default for the role when unset. */
export function clinicalRoleOf(role: Role | null, stored: unknown): ClinicalRole | null {
  if (stored === "doctor" || stored === "nurse" || stored === "front_desk") return stored;
  if (role === "staff") return "front_desk";
  if (role === "admin" || role === "clinic_admin") return "nurse";
  return null;
}

/** Nurse or doctor: may add and stop medicines and see intake details. */
export function canManageCare(c: ClinicalRole | null): boolean {
  return c === "nurse" || c === "doctor";
}

export function clinicalRoleLabel(c: string | null): string {
  switch (c) {
    case "doctor": return "Doctor";
    case "nurse": return "Nurse / assistant";
    case "front_desk": return "Front desk";
    default: return "—";
  }
}

/**
 * UI label for a role. Internal keys never change: `admin` is the platform
 * admin (all clinics), `clinic_admin` runs one clinic.
 */
export function roleLabel(role: string): string {
  switch (role) {
    case "clinic_admin": return "Clinic admin";
    case "admin": return "Platform admin";
    case "staff": return "Staff";
    default: return role.replace(/_/g, " ");
  }
}
