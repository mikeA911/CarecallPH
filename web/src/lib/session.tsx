import { createContext, useContext, useEffect, useState, type ReactNode } from "react";
import type { Session } from "@supabase/supabase-js";
import { supabase } from "./supabase";
import type { ClinicalRole, Role } from "./types";

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
  refresh: () => Promise<void>;
  signOut: () => Promise<void>;
};

const Ctx = createContext<SessionState | null>(null);

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
      setSession(s);
      // Arriving via a "forgot password" email link: force the set-new-password flow.
      if (event === "PASSWORD_RECOVERY") setPasswordRecovery(true);
    });
    return () => sub.subscription.unsubscribe();
  }, []);

  const claims = readClaims(session);

  const value: SessionState = {
    session,
    loading,
    ...claims,
    passwordRecovery,
    clearPasswordRecovery: () => setPasswordRecovery(false),
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
