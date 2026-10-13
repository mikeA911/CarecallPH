import { useCallback, useEffect, useState } from "react";
import { callFunction } from "../../lib/api";
import { supabase } from "../../lib/supabase";
import { useClinic } from "../../lib/clinic";
import { useSession, roleLabel, clinicalRoleLabel } from "../../lib/session";
import type { ClinicalRole } from "../../lib/types";

type PortalUser = {
  id: string; email: string; role: string; clinic_id: string | null;
  clinical_role: ClinicalRole | null; provider: { id: string; name: string } | null;
  deactivated: boolean; last_sign_in_at: string | null; created_at: string;
};
type Clinician = { id: string; name: string; specialty: string | null; prc_number: string | null; user_id: string | null };
type NewRole = "staff" | "clinic_admin" | "admin";

export default function Users() {
  const { role, session } = useSession();
  const { clinics, activeClinicId } = useClinic();
  const isAdmin = role === "admin";
  const me = session?.user?.id;
  const [users, setUsers] = useState<PortalUser[]>([]);
  const [email, setEmail] = useState("");
  const [newRole, setNewRole] = useState<NewRole>("staff");
  const [newClinical, setNewClinical] = useState<"front_desk" | "nurse">("front_desk");
  const [msg, setMsg] = useState("");
  const [tempPw, setTempPw] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  // Making someone a doctor: pick their clinician record and PRC number.
  const [doctorFor, setDoctorFor] = useState<PortalUser | null>(null);

  const load = useCallback(async () => {
    const { data, error } = await callFunction<{ users: PortalUser[] }>("admin-manage", { action: "list_users" });
    if (error) setMsg(error); else setUsers(data?.users ?? []);
  }, []);

  useEffect(() => { load(); }, [load]);

  const clinicName = (id: string | null) => (id ? clinics.find((c) => c.id === id)?.name ?? "—" : "All clinics");

  async function invite() {
    if (!email) return;
    setBusy(true); setTempPw(null);
    const { data, error } = await callFunction<{ temporary_password: string }>("admin-manage", {
      action: "create_user", email, role: isAdmin ? newRole : "staff",
      clinic_id: activeClinicId, clinical_role: newClinical,
    });
    setBusy(false);
    if (error) { setMsg(error); return; }
    setMsg(`Created ${email}. Share the temporary password below; they'll be forced to change it on first login.`);
    setTempPw(data?.temporary_password ?? null);
    setEmail("");
    load();
  }

  async function resetPassword(u: PortalUser) {
    setBusy(true); setTempPw(null);
    const { data, error } = await callFunction<{ temporary_password: string }>("admin-manage", { action: "reset_password", user_id: u.id });
    setBusy(false);
    if (error) { setMsg(error); return; }
    setMsg(`Password reset for ${u.email}. Share the temporary password below.`);
    setTempPw(data?.temporary_password ?? null);
  }

  async function toggleActive(u: PortalUser) {
    setBusy(true);
    const { error } = await callFunction("admin-manage", { action: u.deactivated ? "reactivate_user" : "deactivate_user", user_id: u.id });
    setBusy(false);
    setMsg(error ?? (u.deactivated ? "User reactivated." : "User deactivated."));
    load();
  }

  async function changeRole(u: PortalUser, role: string) {
    if (role === u.role) return;
    let clinicId = u.clinic_id;
    if (role === "admin" && !confirm(`Make ${u.email} a platform admin? They will see and manage every clinic, and can make other platform admins.`)) return;
    if (role !== "admin" && !clinicId) {
      // A platform admin has no clinic; moving them to a clinic role needs one.
      clinicId = activeClinicId;
      if (!clinicId || !confirm(`Move ${u.email} to ${clinicName(clinicId)} as ${roleLabel(role)}?`)) return;
    }
    setBusy(true); setTempPw(null);
    const { data, error } = await callFunction<{ note?: string }>("admin-manage", {
      action: "set_role", user_id: u.id, role, clinic_id: clinicId,
    });
    setBusy(false);
    if (error) { setMsg(error); return; }
    setMsg(`Role for ${u.email} changed to ${roleLabel(role)}. ${data?.note ?? ""}`.trim());
    load();
  }

  async function changeClinical(u: PortalUser, c: ClinicalRole) {
    if (c === u.clinical_role) return;
    if (c === "doctor") { setDoctorFor(u); return; }
    setBusy(true); setTempPw(null);
    const { data, error } = await callFunction<{ note?: string }>("admin-manage", {
      action: "set_clinical_role", user_id: u.id, clinical_role: c,
    });
    setBusy(false);
    if (error) { setMsg(error); return; }
    setMsg(`${u.email} is now ${clinicalRoleLabel(c)}. ${data?.note ?? ""}`.trim());
    load();
  }

  // Clinic admins manage clinical roles in their own clinic, but not platform admins.
  const canSetClinical = (u: PortalUser) => isAdmin || u.role !== "admin";

  return (
    <>
      <h1>Users</h1>
      {msg && <p role="status">{msg}</p>}
      {tempPw && (
        <div className="temp-pw">
          Temporary password: <code>{tempPw}</code>
        </div>
      )}

      <div className="form-card" style={{ maxWidth: 560 }}>
        <label htmlFor="invite-email">Invite user</label>
        <input id="invite-email" type="email" placeholder="name@clinic.com" value={email} onChange={(e) => setEmail(e.target.value)} />
        {isAdmin && (
          <>
            <label htmlFor="invite-role">Access</label>
            <select id="invite-role" value={newRole} onChange={(e) => setNewRole(e.target.value as NewRole)}>
              <option value="staff">Staff</option>
              <option value="clinic_admin">Clinic admin</option>
              <option value="admin">Platform admin (all clinics)</option>
            </select>
            {newRole !== "admin" && <p className="muted small">Clinic: {clinicName(activeClinicId)}</p>}
          </>
        )}
        <label htmlFor="invite-clinical">Clinical role</label>
        <select id="invite-clinical" value={newClinical} onChange={(e) => setNewClinical(e.target.value as "front_desk" | "nurse")}>
          <option value="front_desk">Front desk</option>
          <option value="nurse">Nurse / assistant</option>
        </select>
        <p className="muted small">
          {!isAdmin && "Clinic admins can invite Staff. "}
          To make someone a doctor, invite them first, then choose Doctor in the list and link their clinician record.
        </p>
        <div style={{ marginTop: 10 }}>
          <button onClick={invite} disabled={busy || !email}>Invite</button>
        </div>
      </div>

      {doctorFor && (
        <DoctorLink user={doctorFor} clinicId={doctorFor.clinic_id ?? activeClinicId}
          onCancel={() => setDoctorFor(null)}
          onDone={(text) => { setDoctorFor(null); setMsg(text); load(); }} />
      )}

      <h2>{isAdmin ? "All users" : "Clinic users"}</h2>
      <table>
        <thead>
          <tr>
            <th>Email</th>{isAdmin && <th>Clinic</th>}<th>Access</th><th>Clinical role</th>
            <th>Status</th><th>Last sign-in</th><th>Actions</th>
          </tr>
        </thead>
        <tbody>
          {users.map((u) => (
            <tr key={u.id} className={u.deactivated ? "row-muted" : ""}>
              <td>{u.email}{u.id === me && <span className="muted small"> (you)</span>}</td>
              {isAdmin && <td>{clinicName(u.clinic_id)}</td>}
              <td>
                {isAdmin ? (
                  <select value={u.role} disabled={busy} style={{ width: "auto" }} aria-label={`Access for ${u.email}`}
                          onChange={(e) => changeRole(u, e.target.value)}>
                    <option value="staff">Staff</option>
                    <option value="clinic_admin">Clinic admin</option>
                    <option value="admin">Platform admin</option>
                  </select>
                ) : (
                  roleLabel(u.role)
                )}
              </td>
              <td>
                {canSetClinical(u) ? (
                  <select value={u.clinical_role ?? ""} disabled={busy} style={{ width: "auto" }} aria-label={`Clinical role for ${u.email}`}
                          onChange={(e) => changeClinical(u, e.target.value as ClinicalRole)}>
                    <option value="front_desk">Front desk</option>
                    <option value="nurse">Nurse / assistant</option>
                    <option value="doctor">Doctor</option>
                  </select>
                ) : (
                  clinicalRoleLabel(u.clinical_role)
                )}
                {u.clinical_role === "doctor" && u.provider && <div className="small muted">{u.provider.name}</div>}
              </td>
              <td>{u.deactivated ? <span className="badge declined">deactivated</span> : <span className="badge booked">active</span>}</td>
              <td>{u.last_sign_in_at ? new Date(u.last_sign_in_at).toLocaleString() : "never"}</td>
              <td>
                <div className="row-actions">
                  <button className="secondary" disabled={busy} onClick={() => resetPassword(u)}>Reset password</button>
                  <button className={u.deactivated ? "secondary" : "danger"} disabled={busy} onClick={() => toggleActive(u)}>
                    {u.deactivated ? "Reactivate" : "Deactivate"}
                  </button>
                </div>
              </td>
            </tr>
          ))}
          {!users.length && <tr><td colSpan={isAdmin ? 7 : 6} className="empty">No users found.</td></tr>}
        </tbody>
      </table>

      <p className="muted small" style={{ marginTop: 16, maxWidth: 760 }}>
        <strong>Access</strong> sets what someone can manage: staff, clinic admin (one clinic) or platform admin
        (every clinic; only a platform admin can make another). <strong>Clinical role</strong> sets what they can
        do with patients' health information: front desk sees bookings and urgency only, a nurse or assistant can
        add and stop medicines, a doctor is linked to their clinician record and PRC number. Changes apply the
        next time the user signs in.
      </p>
    </>
  );
}

/** Link a login to a clinician record (with PRC number) and make it a doctor. */
function DoctorLink({ user, clinicId, onCancel, onDone }: {
  user: PortalUser; clinicId: string | null; onCancel: () => void; onDone: (msg: string) => void;
}) {
  const [clinicians, setClinicians] = useState<Clinician[]>([]);
  const [providerId, setProviderId] = useState("");
  const [prc, setPrc] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");

  useEffect(() => {
    if (!clinicId) return;
    supabase.from("providers").select("id, name, specialty, prc_number, user_id")
      .eq("clinic_id", clinicId).eq("active", true).order("name")
      .then(({ data }) => {
        const list = ((data as Clinician[]) ?? []).filter((p) => !p.user_id || p.user_id === user.id);
        setClinicians(list);
        const mine = list.find((p) => p.user_id === user.id) ?? list[0];
        if (mine) { setProviderId(mine.id); setPrc(mine.prc_number ?? ""); }
      });
  }, [clinicId, user.id]);

  function pick(id: string) {
    setProviderId(id);
    setPrc(clinicians.find((p) => p.id === id)?.prc_number ?? "");
  }

  async function save() {
    setBusy(true); setErr("");
    const { data, error } = await callFunction<{ note?: string }>("admin-manage", {
      action: "set_clinical_role", user_id: user.id, clinical_role: "doctor", provider_id: providerId, prc_number: prc.trim(),
    });
    setBusy(false);
    if (error) { setErr(error); return; }
    const name = clinicians.find((p) => p.id === providerId)?.name ?? "the clinician";
    onDone(`${user.email} is now a doctor, linked to ${name}. ${data?.note ?? ""}`.trim());
  }

  return (
    <div className="form-card" style={{ maxWidth: 560, marginTop: 16 }}>
      <strong>Make {user.email} a doctor</strong>
      <p className="small muted" style={{ marginTop: 4 }}>
        A doctor login is linked to one clinician on the Clinicians page. Prescriptions and monitoring plans they
        sign will carry this name and PRC number.
      </p>
      {!clinicians.length ? (
        <p className="small">No unlinked clinicians in this clinic. Add the doctor on the Clinicians page first.</p>
      ) : (
        <>
          <label htmlFor="doc-provider">Clinician</label>
          <select id="doc-provider" value={providerId} onChange={(e) => pick(e.target.value)}>
            {clinicians.map((p) => (
              <option key={p.id} value={p.id}>{p.name}{p.specialty ? ` (${p.specialty})` : ""}</option>
            ))}
          </select>
          <label htmlFor="doc-prc">PRC licence number</label>
          <input id="doc-prc" inputMode="numeric" placeholder="0123456" value={prc}
                 onChange={(e) => setPrc(e.target.value.replace(/\D/g, "").slice(0, 8))} />
        </>
      )}
      {err && <p role="alert" className="small">{err}</p>}
      <div className="row-actions" style={{ marginTop: 12 }}>
        <button disabled={busy || !providerId || !prc} onClick={save}>Make doctor</button>
        <button className="link" onClick={onCancel}>Cancel</button>
      </div>
    </div>
  );
}
