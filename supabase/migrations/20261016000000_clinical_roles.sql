-- Clinical roles: what a user may do with clinical information, separate
-- from their access level (platform admin / clinic admin / staff).
--
--   doctor      signs prescriptions and monitoring plans (M2/M3). Must be
--               linked to a clinician (providers.user_id) with a PRC number.
--   nurse       nurse or doctor's assistant: adds and stops medicines, asks
--               patients to agree to reminders, reviews readings.
--   front_desk  bookings and messages; no clinical details. Sees medicines
--               but can't change them; sees only the urgency of an intake.
--
-- Stored in auth app_metadata.clinical_role, written only by admin-manage.
-- When unset: staff → front_desk; clinic admins and platform admins → nurse.

-- PRC licence number of a clinician (needed before a doctor login can be linked).
alter table providers add column if not exists prc_number text;

create or replace function jwt_clinical_role() returns text
language sql stable as $$
  select coalesce(
    nullif(nullif(current_setting('request.jwt.claims', true), '')::jsonb
      -> 'app_metadata' ->> 'clinical_role', ''),
    case when jwt_role() = 'staff' then 'front_desk'
         when jwt_role() in ('admin', 'clinic_admin') then 'nurse'
         else '' end
  );
$$;

-- Nurse or doctor: may change medicines and care plans.
create or replace function can_manage_care() returns boolean
language sql stable as $$ select jwt_clinical_role() in ('nurse', 'doctor'); $$;

-- Doctor: the claim plus a linked clinician.
create or replace function is_doctor() returns boolean
language sql stable security definer set search_path = public as $$
  select jwt_clinical_role() = 'doctor'
     and exists (select 1 from providers where user_id = auth.uid() and active);
$$;

-- Medicines: everyone in the clinic reads; only nurses and doctors write.
drop policy if exists medications_insert on medications;
create policy medications_insert on medications for insert to authenticated
  with check ( can_manage_care()
               and (is_admin() or clinic_id = jwt_clinic_id())
               and exists (select 1 from patients p where p.id = patient_id and p.clinic_id = medications.clinic_id) );
drop policy if exists medications_update on medications;
create policy medications_update on medications for update to authenticated
  using ( can_manage_care() and (is_admin() or clinic_id = jwt_clinic_id()) )
  with check ( can_manage_care() and (is_admin() or clinic_id = jwt_clinic_id()) );
