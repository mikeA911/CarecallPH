-- CareCall — test users, one per role, for "CareCall Test Site".
-- Run in the Supabase SQL editor AFTER 20261016000000_clinical_roles.sql
-- (supabase db push). Not a migration: db push skips files without a
-- timestamp. Re-runnable: existing emails are skipped.
--
-- BEFORE RUNNING: replace CHANGE-ME below with a password of your own
-- (at least 8 characters). Don't commit the real password.
--
--   Email                         Access        Clinical role
--   test.clinicadmin@carecall.test  Clinic admin  Nurse / assistant
--   test.doctor@carecall.test       Staff         Doctor (linked to Dr. Jones)
--   test.nurse@carecall.test        Staff         Nurse / assistant
--   test.frontdesk@carecall.test    Staff         Front desk
--
-- The .test domain can't receive email, so "forgot password" won't work for
-- these; use Reset password on the Users page instead.
-- Remove them all with the teardown at the bottom.

do $$
declare
  pw     text := 'CHANGE-ME';
  clinic uuid := '00000000-0000-0000-0000-000000000001';  -- CareCall Test Site
  jones  uuid := '11111111-1111-1111-1111-111111111111';  -- Dr. Jones
  u      record;
  uid    uuid;
begin
  if pw = 'CHANGE-ME' or length(pw) < 8 then
    raise exception 'Set your own password (8+ characters) in place of CHANGE-ME first';
  end if;

  for u in
    select * from (values
      ('test.clinicadmin@carecall.test', 'clinic_admin', 'nurse',      'Test Clinic Admin'),
      ('test.doctor@carecall.test',      'staff',        'doctor',     'Test Doctor'),
      ('test.nurse@carecall.test',       'staff',        'nurse',      'Test Nurse'),
      ('test.frontdesk@carecall.test',   'staff',        'front_desk', 'Test Front Desk')
    ) as t(email, role, clinical_role, display_name)
  loop
    if exists (select 1 from auth.users where email = u.email) then
      raise notice 'skipped % (already exists)', u.email;
      continue;
    end if;
    uid := gen_random_uuid();

    insert into auth.users (
      instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
      raw_app_meta_data, raw_user_meta_data, created_at, updated_at,
      confirmation_token, recovery_token, email_change_token_new, email_change
    ) values (
      '00000000-0000-0000-0000-000000000000', uid, 'authenticated', 'authenticated', u.email,
      extensions.crypt(pw, extensions.gen_salt('bf')), now(),
      jsonb_build_object('provider', 'email', 'providers', jsonb_build_array('email'),
                         'role', u.role, 'clinic_id', clinic, 'clinical_role', u.clinical_role),
      jsonb_build_object('display_name', u.display_name),
      now(), now(), '', '', '', ''
    );

    insert into auth.identities (id, user_id, provider_id, provider, identity_data, last_sign_in_at, created_at, updated_at)
    values (gen_random_uuid(), uid, uid::text, 'email',
            jsonb_build_object('sub', uid::text, 'email', u.email, 'email_verified', true),
            now(), now(), now());

    -- The doctor login is Dr. Jones (test PRC number).
    if u.clinical_role = 'doctor' then
      update public.providers set user_id = uid, prc_number = coalesce(prc_number, '1234567')
       where id = jones and user_id is null;
      if not found then
        raise notice 'Dr. Jones is already linked to another login; % is a doctor without a clinician', u.email;
      end if;
    end if;

    raise notice 'created % (% / %)', u.email, u.role, u.clinical_role;
  end loop;
end $$;

-- Check:
select email, raw_app_meta_data->>'role' as access, raw_app_meta_data->>'clinical_role' as clinical_role,
       (select name from public.providers p where p.user_id = auth.users.id) as clinician
  from auth.users where email like 'test.%@carecall.test' order by email;

-- ------------------------------------------------------------------
-- TEARDOWN (run on its own to remove the test users):
--
-- update public.providers set user_id = null
--  where user_id in (select id from auth.users where email like 'test.%@carecall.test');
-- delete from auth.users where email like 'test.%@carecall.test';
