// Clinical roles (doctor / nurse / front desk), separate from the access
// level (admin = platform admin, clinic_admin, staff). Pure functions; the
// same defaults as jwt_clinical_role() in 20261016000000_clinical_roles.sql.

export type AccessRole = "admin" | "clinic_admin" | "staff" | "";
export type ClinicalRole = "doctor" | "nurse" | "front_desk";

export const CLINICAL_ROLES: ClinicalRole[] = ["doctor", "nurse", "front_desk"];

export function isClinicalRole(v: unknown): v is ClinicalRole {
  return typeof v === "string" && (CLINICAL_ROLES as string[]).includes(v);
}

/** The stored clinical role, or the default for the access level when unset. */
export function clinicalRoleOf(role: AccessRole, stored: unknown): ClinicalRole | null {
  if (isClinicalRole(stored)) return stored;
  if (role === "staff") return "front_desk";
  if (role === "admin" || role === "clinic_admin") return "nurse";
  return null;
}

/** Nurse or doctor: may add and stop medicines and ask for reminder consent. */
export function canManageCare(c: ClinicalRole | null): boolean {
  return c === "nurse" || c === "doctor";
}
