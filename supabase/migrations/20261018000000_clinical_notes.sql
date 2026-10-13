-- Clinical notes (care plans M6, demo) and records retention.
-- Design: docs/care-plan-design.md (M6), docs/fhir-design.md.
--
-- A doctor dictates (or, with the patient's consent, records the consultation);
-- the clinical-note function transcribes it and CC drafts a SOAP note; the
-- doctor edits and signs. Audio is never stored. A signed note can't be
-- changed, only amended by a signed addendum. Nurses and doctors read notes;
-- front desk never.

create table if not exists clinical_notes (
  id uuid primary key default gen_random_uuid(),
  clinic_id uuid not null references clinics(id) on delete cascade,
  patient_id uuid not null references patients(id) on delete cascade,
  kind text not null default 'note' check (kind in ('note', 'addendum')),
  amends_note_id uuid references clinical_notes(id) on delete cascade,
  encounter_date date not null default current_date,
  -- How the note was captured.
  mode text not null default 'typed' check (mode in ('dictation', 'recording', 'typed')),
  recording_consent_at timestamptz,          -- required for mode = 'recording'
  stt_engine text,                           -- e.g. 'gemini', 'demo'
  transcript text,                           -- kept only while a draft; cleared on signing
  -- SOAP note (addenda use `addendum`).
  subjective text,
  objective text,
  assessment text,
  plan text,
  addendum text,
  status text not null default 'draft' check (status in ('draft', 'signed')),
  author_user_id uuid references auth.users(id),
  signed_by uuid references auth.users(id),
  signed_provider_id uuid references providers(id),
  signed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (mode <> 'recording' or recording_consent_at is not null),
  check ((kind = 'addendum') = (amends_note_id is not null)),
  check (status <> 'signed' or (signed_at is not null and signed_by is not null))
);
create index if not exists idx_clinical_notes_patient on clinical_notes (patient_id, created_at desc);

alter table clinical_notes enable row level security;

-- Nurses and doctors of the clinic read and draft; signing is done by the
-- clinical-note function after checking the doctor (service role).
drop policy if exists clinical_notes_read on clinical_notes;
create policy clinical_notes_read on clinical_notes for select to authenticated
  using ( can_manage_care() and (is_admin() or clinic_id = jwt_clinic_id()) );
drop policy if exists clinical_notes_insert on clinical_notes;
create policy clinical_notes_insert on clinical_notes for insert to authenticated
  with check ( can_manage_care() and (is_admin() or clinic_id = jwt_clinic_id()) and status = 'draft'
               and exists (select 1 from patients p where p.id = patient_id and p.clinic_id = clinical_notes.clinic_id) );
drop policy if exists clinical_notes_update on clinical_notes;
create policy clinical_notes_update on clinical_notes for update to authenticated
  using ( can_manage_care() and (is_admin() or clinic_id = jwt_clinic_id()) and status = 'draft' )
  with check ( can_manage_care() and (is_admin() or clinic_id = jwt_clinic_id()) and status = 'draft' );
drop policy if exists clinical_notes_delete on clinical_notes;
create policy clinical_notes_delete on clinical_notes for delete to authenticated
  using ( can_manage_care() and (is_admin() or clinic_id = jwt_clinic_id()) and status = 'draft' );

-- Signed notes are final, for everyone including the service role: no
-- edits, no deletes (except when the whole patient record is disposed of).
-- Signing clears the transcript and stamps the time.
create or replace function fn_clinical_note_guard() returns trigger
language plpgsql as $$
begin
  if tg_op = 'DELETE' then
    if old.status = 'signed' and current_setting('carecall.disposing', true) is distinct from 'on' then
      raise exception 'signed clinical notes cannot be deleted';
    end if;
    return old;
  end if;
  if tg_op = 'UPDATE' and old.status = 'signed' then
    raise exception 'signed clinical notes cannot be changed; add an addendum';
  end if;
  if new.kind = 'addendum' and not exists (
    select 1 from clinical_notes n where n.id = new.amends_note_id and n.status = 'signed' and n.patient_id = new.patient_id
  ) then
    raise exception 'an addendum must amend a signed note of the same patient';
  end if;
  if new.status = 'signed' then
    new.signed_at := coalesce(new.signed_at, now());
    new.transcript := null;
  end if;
  new.updated_at := now();
  return new;
end $$;

drop trigger if exists trg_clinical_note_guard on clinical_notes;
create trigger trg_clinical_note_guard before insert or update or delete on clinical_notes
  for each row execute function fn_clinical_note_guard();

-- Audit without copying the note's text into the audit log.
create or replace function fn_audit_clinical_note() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  v_actor uuid;
  r clinical_notes;
begin
  begin
    v_actor := nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'sub';
  exception when others then v_actor := null; end;
  r := case when tg_op = 'DELETE' then old else new end;
  insert into audit_log (clinic_id, actor_user_id, action, target_type, target_id, detail)
  values (r.clinic_id, v_actor, lower(tg_op), 'clinical_notes', r.id,
          jsonb_build_object('patient_id', r.patient_id, 'kind', r.kind, 'status', r.status, 'mode', r.mode));
  return r;
end $$;

drop trigger if exists trg_audit_clinical_notes on clinical_notes;
create trigger trg_audit_clinical_notes after insert or update or delete on clinical_notes
  for each row execute function fn_audit_clinical_note();

-- ---------------------------------------------------------------------------
-- Records retention. Platform default (platform admins) and an optional
-- per-clinic value. DOH Department Circular 2021-0226 (records disposition
-- schedule) appears to set outpatient records at 7 years after the last
-- consultation; confirm before relying on it. Records past the period are
-- listed for a clinic admin to review; nothing is deleted automatically.

create table if not exists platform_settings (
  key text primary key,
  value jsonb not null,
  updated_by uuid references auth.users(id),
  updated_at timestamptz not null default now()
);
alter table platform_settings enable row level security;
drop policy if exists platform_settings_read on platform_settings;
create policy platform_settings_read on platform_settings for select to authenticated using (true);
drop policy if exists platform_settings_write on platform_settings;
create policy platform_settings_write on platform_settings for all to authenticated
  using ( is_admin() ) with check ( is_admin() );
drop trigger if exists trg_audit_platform_settings on platform_settings;
create trigger trg_audit_platform_settings after insert or update or delete on platform_settings
  for each row execute function fn_audit();

insert into platform_settings (key, value) values ('record_retention_years', '7')
on conflict (key) do nothing;

-- Per clinic (null = platform default). Set by platform admins.
alter table clinics add column if not exists record_retention_years integer
  check (record_retention_years between 1 and 100);

create or replace function record_retention_years(p_clinic uuid) returns integer
language sql stable security definer set search_path = public as $$
  select coalesce(
    (select record_retention_years from clinics where id = p_clinic),
    (select (value #>> '{}')::integer from platform_settings where key = 'record_retention_years'),
    7);
$$;

-- Patients whose last activity is older than the retention period, for a
-- clinic admin to review. Last activity: the latest of a past appointment,
-- a clinical note, a medicine, a dose reply, or the record's creation.
create or replace function records_due_for_review(p_clinic uuid)
returns table (patient_id uuid, first_name text, last_name text, last_activity timestamptz, retention_years integer)
language plpgsql stable security definer set search_path = public as $$
declare
  v_years integer := record_retention_years(p_clinic);
begin
  if not (is_admin() or (is_clinic_admin() and p_clinic = jwt_clinic_id())) then
    raise exception 'forbidden';
  end if;
  return query
  with activity as (
    select p.id, p.first_name, p.last_name, greatest(
      p.created_at,
      (select max(a.starts_at) from appointments a where a.patient_id = p.id and a.starts_at <= now()),
      (select max(coalesce(n.signed_at, n.created_at)) from clinical_notes n where n.patient_id = p.id),
      (select max(greatest(m.created_at, m.end_date::timestamptz)) from medications m where m.patient_id = p.id),
      (select max(d.answered_at) from medication_doses d where d.patient_id = p.id)
    ) as last_activity
    from patients p where p.clinic_id = p_clinic
  )
  select activity.id, activity.first_name, activity.last_name, activity.last_activity, v_years
    from activity
   where activity.last_activity < now() - make_interval(years => v_years)
   order by activity.last_activity;
end $$;
grant execute on function records_due_for_review(uuid) to authenticated;

-- Only platform admins change a clinic's retention period.
create or replace function fn_clinic_retention_guard() returns trigger
language plpgsql as $$
begin
  if new.record_retention_years is distinct from old.record_retention_years
     and current_setting('request.jwt.claims', true) is not null
     and coalesce(nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'role', '') = 'authenticated'
     and not is_admin() then
    raise exception 'only a platform admin can change the records retention period';
  end if;
  return new;
end $$;
drop trigger if exists trg_clinic_retention_guard on clinics;
create trigger trg_clinic_retention_guard before update on clinics
  for each row execute function fn_clinic_retention_guard();
