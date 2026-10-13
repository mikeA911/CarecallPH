---
id: users-roles
title: Users and roles
summary: Adding portal users, access levels and clinical roles (front desk, nurse, doctor), platform admins, linking a doctor to a clinician, temporary passwords.
roles: clinic_admin
routes:
  - /settings/users | clinic_admin | Users
updated: 2026-10-13
---

On **Users** a clinic admin can invite staff for their clinic, set each
user's clinical role, reset passwords and deactivate users. A platform admin
can also invite clinic admins and platform admins, and change anyone's access
level.

New users get a temporary password, shown once on screen. They must change it
at first login. Share it privately.

## Two settings per user

- **Access**: Staff, Clinic admin, or Platform admin (every clinic). Only a
  platform admin can make someone a platform admin, and the last platform
  admin can't remove their own access.
- **Clinical role**: Front desk, Nurse / assistant, or Doctor.
  - Front desk sees bookings and the urgency of an intake, and can see
    medicines but not change them. They can still stop reminders if a patient
    asks.
  - A nurse or assistant can also see intake symptoms, add and stop
    medicines, and ask a patient to agree to reminders.
  - A doctor can do what a nurse can. Prescriptions and monitoring plans
    (coming next) are signed by a doctor.

New staff start as Front desk; clinic admins and platform admins start as
Nurse / assistant. The database enforces these rules, not just the screen.

## Making someone a doctor

1. Add the doctor on **Clinicians** if they aren't there yet.
2. Invite them on **Users** (or find their existing login).
3. Choose **Doctor** in their Clinical role, pick their clinician record and
   enter their PRC licence number. One login per clinician.

Changing a doctor to another clinical role unlinks the clinician record.

Changes to access or clinical role apply the next time the user signs in.
