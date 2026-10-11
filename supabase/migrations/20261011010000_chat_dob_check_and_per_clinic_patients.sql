-- CareCall PH — two multi-clinic / identity fixes.
--
-- 1. Birthday check before a chat account is linked for good.
--    An invite link can reach the wrong person (a mistyped number, a forwarded
--    message). After opening it, the person must reply with the patient's date
--    of birth; only then are they asked for YES. Two wrong dates lock the link:
--    the patient's open invites expire and staff create a new one.
--    verified_at          — birthday matched (null = not checked yet)
--    verify_attempts      — wrong dates so far; 2 = locked
--    Rows already opted in before this change count as verified.
--
-- 2. Patients are unique per clinic, not across the whole platform.
--    The original unique (phone, date_of_birth) meant a person already
--    registered at one clinic could not be added at another; CSV import
--    skipped them silently. One Supabase project serves every clinic, so the
--    key is now (clinic_id, phone, date_of_birth).

alter table patient_channels
  add column if not exists verified_at timestamptz,
  add column if not exists verify_attempts int not null default 0;

update patient_channels
set verified_at = coalesce(opted_in_at, linked_at)
where verified_at is null and opted_in_at is not null;

do $$
declare c text;
begin
  -- Drop whichever unique constraint covers exactly (phone, date_of_birth).
  for c in
    select con.conname
    from pg_constraint con
    join pg_class rel on rel.oid = con.conrelid
    where rel.relname = 'patients' and con.contype = 'u'
      and (select array_agg(att.attname::text order by att.attname)
           from unnest(con.conkey) k join pg_attribute att
             on att.attrelid = con.conrelid and att.attnum = k)
          = array['date_of_birth', 'phone']
  loop
    execute format('alter table patients drop constraint %I', c);
  end loop;
end $$;

do $$ begin
  alter table patients
    add constraint patients_clinic_phone_dob_key unique (clinic_id, phone, date_of_birth);
exception when duplicate_object or duplicate_table then null; end $$;
