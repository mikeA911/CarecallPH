-- Fix: clinic admins can save Clinic settings for their own clinic.
--
-- clinics_write (20260705000000) allowed only platform admins to update
-- clinics, so a clinic admin's Save on Clinic settings changed nothing (the
-- update matched no rows and reported no error). Clinic admins may now update
-- their own clinic. Creating, deleting, switching a clinic on or off and the
-- records retention period stay with platform admins.

drop policy if exists clinics_update_own on clinics;
create policy clinics_update_own on clinics for update to authenticated
  using ( is_clinic_admin() and id = jwt_clinic_id() )
  with check ( is_clinic_admin() and id = jwt_clinic_id() );

-- Replaces the retention-only guard from 20261018000000.
create or replace function fn_clinic_retention_guard() returns trigger
language plpgsql as $$
begin
  -- Portal users only (the service role and SQL editor are not limited).
  if coalesce(nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'role', '') = 'authenticated'
     and not is_admin() then
    if new.record_retention_years is distinct from old.record_retention_years then
      raise exception 'only a platform admin can change the records retention period';
    end if;
    if new.active is distinct from old.active then
      raise exception 'only a platform admin can switch a clinic on or off';
    end if;
  end if;
  return new;
end $$;
