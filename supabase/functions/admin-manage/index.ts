// CareCall — user & clinic administration.
// PATCHED 2026-07-06 (three changes, marked [FIX]):
//   1. Clinic Admins can only reset/deactivate STAFF — not peer Clinic Admins
//      (password reset is account takeover; spec matrix: "own clinic Staff").
//   2. Users cannot deactivate themselves (prevents last-admin lockout).
//   3. Simplified the role check in requireTargetInScope — the old
//      startsWith("admin") condition worked by accident and read like a bug.
//
// Actions (POST { action, ...args }):
//   create_user       — role + clinic_id. Clinic Admin may only create Staff in
//                        their own clinic; Admin may create any role/clinic.
//   set_role          — Admin only.
//   reset_password    — set a temporary password + force-change flag.
//   clear_force_password_change — caller clears their OWN force-change flag
//                        after choosing a new password (app_metadata is not
//                        client-writable, so this must happen server-side).
//   deactivate_user   — ban (banned_until far future), blocks token refresh.
//   reactivate_user   — lift the ban.
//   create_clinic     — Admin only.
//
// Role + clinic_id live in auth.users.app_metadata and are ONLY ever written
// here (never client-writable). Every action writes an audit_log row.
//
// Deploy with JWT verification ON (default): callers must be authenticated
// portal users. Authorization is enforced per-action below.

import { supabase, json, getCaller, audit, corsHeaders } from "../_shared/lib.ts";
import { normalizePhPhone } from "../_shared/phone.ts";

const FORCE_CHANGE_KEY = "force_password_change";

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders() });

  const caller = await getCaller(req);
  if (!caller || !caller.role) return json({ error: "unauthorized" }, 401, corsHeaders());

  const body = await req.json().catch(() => ({}));
  const action: string = body.action;

  try {
    switch (action) {
      case "list_users":      return await listUsers(caller);
      case "create_user":     return await createUser(caller, body);
      case "set_role":        return await setRole(caller, body);
      case "reset_password":  return await resetPassword(caller, body);
      case "clear_force_password_change": return await clearForcePasswordChange(caller);
      case "deactivate_user": return await setBanned(caller, body, true);
      case "reactivate_user": return await setBanned(caller, body, false);
      case "create_clinic":   return await createClinic(caller, body);
      default:                return json({ error: `unknown action: ${action}` }, 400, corsHeaders());
    }
  } catch (e) {
    console.error(`admin-manage ${action} error`, e);
    return json({ error: (e as Error).message ?? "internal error" }, 500, corsHeaders());
  }
});

type Caller = NonNullable<Awaited<ReturnType<typeof getCaller>>>;

function tempPassword(): string {
  // Human-typeable temporary password: 3 groups, no ambiguous chars.
  const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnpqrstuvwxyz23456789";
  const pick = (n: number) =>
    Array.from(crypto.getRandomValues(new Uint8Array(n)))
      .map((b) => alphabet[b % alphabet.length]).join("");
  return `${pick(4)}-${pick(4)}-${pick(4)}`;
}

// [FIX 1+3] Scope check for non-admin callers: target must be in the caller's
// clinic AND must be Staff. Clinic Admins manage "own clinic Staff" (§1.3) —
// they may not reset passwords for or deactivate peer Clinic Admins.
async function requireTargetInScope(caller: Caller, userId: string) {
  const { data } = await supabase.auth.admin.getUserById(userId);
  const target = data?.user;
  if (!target) throw new Error("user not found");
  const meta = (target.app_metadata ?? {}) as Record<string, unknown>;
  const targetClinic = meta.clinic_id as string | undefined;
  const targetRole = (meta.role as string) ?? "";
  if (!isAdmin(caller)) {
    if (targetClinic !== caller.clinicId) throw new Error("forbidden: user in another clinic");
    if (targetRole !== "staff") throw new Error("forbidden: clinic admins may only manage Staff accounts");
  }
  return target;
}

function isAdmin(caller: Caller) { return caller.role === "admin"; }
function isClinicAdmin(caller: Caller) { return caller.role === "admin" || caller.role === "clinic_admin"; }

// ------------------------------------------------------------------
// list_users — Clinic Admin sees own-clinic users; Admin sees all.
async function listUsers(caller: Caller) {
  if (!isClinicAdmin(caller)) return json({ error: "forbidden" }, 403, corsHeaders());
  const { data, error } = await supabase.auth.admin.listUsers({ page: 1, perPage: 1000 });
  if (error) return json({ error: error.message }, 400, corsHeaders());
  const users = data.users
    .map((u) => {
      const meta = (u.app_metadata ?? {}) as Record<string, unknown>;
      return {
        id: u.id,
        email: u.email,
        role: (meta.role as string) ?? "",
        clinic_id: (meta.clinic_id as string) ?? null,
        deactivated: !!(u as unknown as { banned_until?: string }).banned_until,
        last_sign_in_at: u.last_sign_in_at ?? null,
        created_at: u.created_at,
      };
    })
    .filter((u) => isAdmin(caller) || u.clinic_id === caller.clinicId);
  return json({ users }, 200, corsHeaders());
}

// ------------------------------------------------------------------
async function createUser(caller: Caller, body: Record<string, unknown>) {
  const email = String(body.email ?? "").trim().toLowerCase();
  const role = String(body.role ?? "staff") as "admin" | "clinic_admin" | "staff";
  let clinicId: string | null = (body.clinic_id as string | undefined) ?? caller.clinicId;

  if (!email) return json({ error: "email required" }, 400, corsHeaders());
  if (!["admin", "clinic_admin", "staff"].includes(role))
    return json({ error: "invalid role" }, 400, corsHeaders());

  // Permission matrix:
  //  - Only Admin may create Admin or Clinic Admin, or create in another clinic.
  //  - Clinic Admin may create Staff only, in their own clinic.
  if (!isClinicAdmin(caller)) return json({ error: "forbidden" }, 403, corsHeaders());
  if (!isAdmin(caller)) {
    if (role !== "staff") return json({ error: "clinic admins may only create Staff" }, 403, corsHeaders());
    clinicId = caller.clinicId; // force own clinic
  }
  if (role !== "admin" && !clinicId)
    return json({ error: "clinic_id required for non-admin users" }, 400, corsHeaders());

  const password = tempPassword();
  const { data, error } = await supabase.auth.admin.createUser({
    email,
    password,
    email_confirm: true, // pre-confirmed; no SMTP dependency (D4)
    app_metadata: { role, clinic_id: role === "admin" ? null : clinicId, [FORCE_CHANGE_KEY]: true },
  });
  if (error) return json({ error: error.message }, 400, corsHeaders());

  await audit({
    clinicId: clinicId ?? null, actorUserId: caller.userId,
    action: "user_created", targetType: "user", targetId: data.user?.id,
    detail: { email, role, clinic_id: clinicId },
  });

  return json({ ok: true, user_id: data.user?.id, temporary_password: password }, 200, corsHeaders());
}

// ------------------------------------------------------------------
async function setRole(caller: Caller, body: Record<string, unknown>) {
  if (!isAdmin(caller)) return json({ error: "forbidden: admin only" }, 403, corsHeaders());
  const userId = String(body.user_id ?? "");
  const role = String(body.role ?? "") as "admin" | "clinic_admin" | "staff";
  const clinicId = (body.clinic_id as string) ?? null;
  if (!userId || !["admin", "clinic_admin", "staff"].includes(role))
    return json({ error: "user_id and valid role required" }, 400, corsHeaders());

  // [FIX 2] An admin demoting themselves is allowed only if they are not the
  // last admin (same lockout class as self-deactivation).
  if (userId === caller.userId && role !== "admin") {
    const remaining = await countOtherAdmins(caller.userId);
    if (remaining === 0) return json({ error: "cannot demote the last admin" }, 400, corsHeaders());
  }

  const { data: existing } = await supabase.auth.admin.getUserById(userId);
  const prevMeta = (existing?.user?.app_metadata ?? {}) as Record<string, unknown>;

  const { error } = await supabase.auth.admin.updateUserById(userId, {
    app_metadata: { ...prevMeta, role, clinic_id: role === "admin" ? null : clinicId },
  });
  if (error) return json({ error: error.message }, 400, corsHeaders());

  await audit({
    clinicId, actorUserId: caller.userId, action: "user_role_changed",
    targetType: "user", targetId: userId, detail: { role, clinic_id: clinicId },
  });
  // Caller-facing note: JWT only refreshes on next login.
  return json({ ok: true, note: "User must sign out and back in for the new role to apply." }, 200, corsHeaders());
}

// ------------------------------------------------------------------
async function resetPassword(caller: Caller, body: Record<string, unknown>) {
  if (!isClinicAdmin(caller)) return json({ error: "forbidden" }, 403, corsHeaders());
  const userId = String(body.user_id ?? "");
  if (!userId) return json({ error: "user_id required" }, 400, corsHeaders());
  const target = await requireTargetInScope(caller, userId);

  const password = tempPassword();
  const prevMeta = (target.app_metadata ?? {}) as Record<string, unknown>;
  const { error } = await supabase.auth.admin.updateUserById(userId, {
    password,
    app_metadata: { ...prevMeta, [FORCE_CHANGE_KEY]: true },
  });
  if (error) return json({ error: error.message }, 400, corsHeaders());

  await audit({
    clinicId: (prevMeta.clinic_id as string) ?? caller.clinicId,
    actorUserId: caller.userId, action: "password_reset",
    targetType: "user", targetId: userId,
  });
  return json({ ok: true, temporary_password: password }, 200, corsHeaders());
}

// ------------------------------------------------------------------
// Caller clears their OWN force-change flag. Called by the client right after
// the user picks a new password. app_metadata is never client-writable, so the
// flag can only be cleared here (previously it was never cleared, which left
// users stuck on the "set new password" screen forever).
async function clearForcePasswordChange(caller: Caller) {
  const { data: existing } = await supabase.auth.admin.getUserById(caller.userId);
  const prevMeta = (existing?.user?.app_metadata ?? {}) as Record<string, unknown>;
  if (prevMeta[FORCE_CHANGE_KEY] !== true) {
    // Nothing to do — flag already absent/false. Idempotent success.
    return json({ ok: true }, 200, corsHeaders());
  }
  // updateUserById shallow-MERGES app_metadata, so deleting the key from the
  // object we send would simply be omitted from the merge and leave the stored
  // value untouched. We must explicitly send the key as null to clear it.
  const { error } = await supabase.auth.admin.updateUserById(caller.userId, {
    app_metadata: { ...prevMeta, [FORCE_CHANGE_KEY]: null },
  });
  if (error) return json({ error: error.message }, 400, corsHeaders());

  await audit({
    clinicId: (prevMeta.clinic_id as string) ?? caller.clinicId,
    actorUserId: caller.userId, action: "password_change_completed",
    targetType: "user", targetId: caller.userId,
  });
  return json({ ok: true }, 200, corsHeaders());
}

// ------------------------------------------------------------------
async function setBanned(caller: Caller, body: Record<string, unknown>, banned: boolean) {
  if (!isClinicAdmin(caller)) return json({ error: "forbidden" }, 403, corsHeaders());
  const userId = String(body.user_id ?? "");
  if (!userId) return json({ error: "user_id required" }, 400, corsHeaders());

  // [FIX 2] No self-deactivation: prevents the last Admin locking out the
  // whole platform (recovery would require dashboard SQL access).
  if (banned && userId === caller.userId) {
    return json({ error: "you cannot deactivate your own account" }, 400, corsHeaders());
  }

  const target = await requireTargetInScope(caller, userId);

  // Supabase ban via banned_until (100y = deactivated; "none" reactivates).
  const { error } = await supabase.auth.admin.updateUserById(userId, {
    ban_duration: banned ? "876000h" : "none",
  } as unknown as { ban_duration: string });
  if (error) return json({ error: error.message }, 400, corsHeaders());

  await audit({
    clinicId: ((target.app_metadata as Record<string, unknown>)?.clinic_id as string) ?? caller.clinicId,
    actorUserId: caller.userId, action: banned ? "user_deactivated" : "user_reactivated",
    targetType: "user", targetId: userId,
  });
  return json({ ok: true }, 200, corsHeaders());
}

async function countOtherAdmins(exceptUserId: string): Promise<number> {
  const { data } = await supabase.auth.admin.listUsers({ page: 1, perPage: 1000 });
  return (data?.users ?? []).filter((u) => {
    const meta = (u.app_metadata ?? {}) as Record<string, unknown>;
    const bannedUntil = (u as unknown as { banned_until?: string }).banned_until;
    return u.id !== exceptUserId && meta.role === "admin" && !bannedUntil;
  }).length;
}

// ------------------------------------------------------------------
async function createClinic(caller: Caller, body: Record<string, unknown>) {
  if (!isAdmin(caller)) return json({ error: "forbidden: admin only" }, 403, corsHeaders());
  const name = String(body.name ?? "").trim();
  if (!name) return json({ error: "name required" }, 400, corsHeaders());

  // Optional callback number: PH mobile or landline, stored as E.164.
  let phoneCallback: string | null = null;
  const rawCallback = String(body.phone_callback ?? "").trim();
  if (rawCallback) {
    const parsed = normalizePhPhone(rawCallback, { allowLandline: true });
    if (!parsed.ok) return json({ error: `phone_callback: ${parsed.error}` }, 400, corsHeaders());
    phoneCallback = parsed.e164;
  }

  const { data, error } = await supabase.from("clinics").insert({
    name,
    timezone: (body.timezone as string) ?? "Asia/Manila",
    phone_callback: phoneCallback,
    greeting_default: (body.greeting_default as string) ?? null,
  }).select("id").single();
  if (error) return json({ error: error.message }, 400, corsHeaders());

  await audit({
    clinicId: data.id, actorUserId: caller.userId, action: "clinic_created",
    targetType: "clinic", targetId: data.id, detail: { name },
  });
  return json({ ok: true, clinic_id: data.id }, 200, corsHeaders());
}
