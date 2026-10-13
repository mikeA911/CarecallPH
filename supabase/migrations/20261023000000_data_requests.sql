-- Patient data requests (Data Privacy Act; roadmap Phase 3, L F5).
--
-- A patient asks to see, correct, restrict or erase their data. Any clinic
-- user logs the request; a clinic admin (usually the Data Protection Officer)
-- acts on it through the functions below, which run as one transaction each:
--
--   access       → Download record (FHIR), then mark completed
--   correction   → Edit details / addendum, then mark completed
--   restriction  → stop all messages, calls and changes now; can be lifted
--   erasure      → restriction (permanent) + delete what the clinic needn't
--                  keep (chat links and messages, booking links, campaign and
--                  call history, reminders, symptom checks); the medical
--                  record stays view-only until its retention period ends
--   disposal     → after the retention period: delete the record, keep a
--                  disposal record without personal data, and blank the
--                  patient's data in the audit log
--
-- A restricted record is view-only: triggers refuse changes to the patient and
-- their clinical rows except from these functions.

-- ---------------------------------------------------------------------------
-- Patients: restriction state
-- ---------------------------------------------------------------------------
alter table patients add column if not exists restricted_at timestamptz;
alter table patients add column if not exists restriction_kind text check (restriction_kind in ('restriction', 'erasure'));
alter table patients add column if not exists erased_at timestamptz;   -- non-required data deleted

-- ---------------------------------------------------------------------------
-- Requests
-- ---------------------------------------------------------------------------
create table if not exists data_requests (
  id uuid primary key default gen_random_uuid(),
  clinic_id uuid not null references clinics(id) on delete cascade,
  patient_id uuid references patients(id) on delete set null,   -- null once the record is disposed
  kind text not null check (kind in ('access', 'correction', 'restriction', 'erasure')),
  received_via text not null check (received_via in ('in_person', 'chat', 'phone', 'email', 'letter', 'other')),
  received_at date not null default current_date,
  respond_by date not null default (current_date + 15),
  identity_checked boolean not null default false,
  details text check (length(details) <= 2000),
  status text not null default 'received' check (status in ('received', 'completed', 'refused')),
  outcome text check (length(outcome) <= 2000),
  actions jsonb,                           -- what was done (counts), set by the functions
  action_item_id uuid references cc_action_items(id) on delete set null,
  created_by uuid references auth.users(id),
  created_at timestamptz not null default now(),
  completed_by uuid references auth.users(id),
  completed_at timestamptz,
  check (respond_by >= received_at)
);
create index if not exists idx_data_requests_clinic on data_requests (clinic_id, status, respond_by);
create index if not exists idx_data_requests_patient on data_requests (patient_id);

alter table data_requests enable row level security;
-- Anyone in the clinic logs and sees requests (front desk often receives them).
drop policy if exists data_requests_read on data_requests;
create policy data_requests_read on data_requests for select to authenticated
  using ( is_admin() or clinic_id = jwt_clinic_id() );
drop policy if exists data_requests_insert on data_requests;
create policy data_requests_insert on data_requests for insert to authenticated
  with check ( (is_admin() or clinic_id = jwt_clinic_id()) and status = 'received'
               and outcome is null and actions is null and completed_at is null
               and exists (select 1 from patients p where p.id = patient_id and p.clinic_id = data_requests.clinic_id) );
-- No update or delete policy: status changes only through the functions below.

-- ---------------------------------------------------------------------------
-- Disposal records (no personal data)
-- ---------------------------------------------------------------------------
create table if not exists record_disposals (
  id uuid primary key default gen_random_uuid(),
  clinic_id uuid not null references clinics(id) on delete cascade,
  disposed_at timestamptz not null default now(),
  disposed_by uuid references auth.users(id),
  request_id uuid references data_requests(id) on delete set null,
  patient_created_at timestamptz,
  last_activity timestamptz,
  retention_years integer,
  counts jsonb not null,
  note text check (length(note) <= 500)
);
alter table record_disposals enable row level security;
drop policy if exists record_disposals_read on record_disposals;
create policy record_disposals_read on record_disposals for select to authenticated
  using ( is_admin() or (is_clinic_admin() and clinic_id = jwt_clinic_id()) );

-- ---------------------------------------------------------------------------
-- Helpers
-- ---------------------------------------------------------------------------
create or replace function privacy_op() returns boolean
language sql stable as $$ select coalesce(current_setting('carecall.privacy_op', true), '') = 'on' $$;

/** The latest activity on a patient's record (as in records_due_for_review). */
create or replace function patient_last_activity(p_patient uuid) returns timestamptz
language sql stable security definer set search_path = public as $$
  select greatest(
    p.created_at,
    (select max(a.starts_at) from appointments a where a.patient_id = p.id and a.starts_at <= now()),
    (select max(coalesce(n.signed_at, n.created_at)) from clinical_notes n where n.patient_id = p.id),
    (select max(greatest(m.created_at, m.end_date::timestamptz)) from medications m where m.patient_id = p.id),
    (select max(d.answered_at) from medication_doses d where d.patient_id = p.id),
    (select max(r.taken_at) from vital_readings r where r.patient_id = p.id)
  ) from patients p where p.id = p_patient;
$$;

-- The review list uses the same rule as disposal (readings now count as activity).
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
  select p.id, p.first_name, p.last_name, a.last_activity, v_years
    from patients p cross join lateral (select patient_last_activity(p.id) as last_activity) a
   where p.clinic_id = p_clinic and a.last_activity < now() - make_interval(years => v_years)
   order by a.last_activity;
end $$;

create or replace function privacy_check(p_clinic uuid) returns void
language plpgsql stable as $$
begin
  if not (is_admin() or (is_clinic_admin() and p_clinic = jwt_clinic_id())) then
    raise exception 'Only a clinic admin can act on privacy requests.' using errcode = '42501';
  end if;
end $$;

-- ---------------------------------------------------------------------------
-- View-only restricted records
-- ---------------------------------------------------------------------------
create or replace function fn_patient_restriction_guard() returns trigger
language plpgsql as $$
declare
  v_patient uuid;
begin
  if privacy_op() then return coalesce(new, old); end if;
  if tg_table_name = 'patients' then
    if (new.restricted_at, new.restriction_kind, new.erased_at)
       is distinct from (old.restricted_at, old.restriction_kind, old.erased_at) then
      raise exception 'Restriction is set through a privacy request.' using errcode = '42501';
    end if;
    if old.restricted_at is not null then
      raise exception 'This record is restricted (privacy request): view-only.' using errcode = '42501';
    end if;
    return new;
  end if;
  v_patient := (to_jsonb(coalesce(new, old)) ->> 'patient_id')::uuid;
  if exists (select 1 from patients where id = v_patient and restricted_at is not null) then
    raise exception 'This record is restricted (privacy request): view-only.' using errcode = '42501';
  end if;
  return coalesce(new, old);
end $$;

do $$
declare t text;
begin
  -- The patient and the tables staff change by hand. Doses and requests are
  -- left out: the reminder job marks old ones missed.
  foreach t in array array['patients', 'appointments', 'medications', 'clinical_notes', 'monitoring_plans',
                           'vital_plans', 'vital_readings', 'care_consents', 'campaign_patients', 'booking_links',
                           'channel_invites']
  loop
    execute format('drop trigger if exists trg_restriction_guard on %I', t);
    execute format('create trigger trg_restriction_guard before %s on %I for each row execute function fn_patient_restriction_guard()',
                   case when t = 'patients' then 'update' else 'insert or update' end, t);
  end loop;
end $$;

-- ---------------------------------------------------------------------------
-- Actions
-- ---------------------------------------------------------------------------
create or replace function data_request_load(p_request uuid) returns data_requests
language plpgsql security definer set search_path = public as $$
declare r data_requests;
begin
  select * into r from data_requests where id = p_request for update;
  if r.id is null then raise exception 'Request not found.'; end if;
  perform privacy_check(r.clinic_id);
  if r.status <> 'received' then raise exception 'This request is already closed.'; end if;
  return r;
end $$;

create or replace function data_request_close(p_request uuid, p_status text, p_outcome text, p_actions jsonb)
returns void language plpgsql security definer set search_path = public as $$
declare r data_requests;
begin
  update data_requests set status = p_status, outcome = nullif(trim(p_outcome), ''), actions = p_actions,
         completed_by = (nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'sub')::uuid,
         completed_at = now()
   where id = p_request returning * into r;
  if r.action_item_id is not null then
    update cc_action_items set status = 'done', resolved_at = now() where id = r.action_item_id and status = 'open';
  end if;
  insert into audit_log (clinic_id, actor_user_id, action, target_type, target_id, detail)
  values (r.clinic_id, r.completed_by, 'data_request_' || p_status, 'data_requests', r.id,
          jsonb_build_object('kind', r.kind, 'patient_id', r.patient_id, 'actions', p_actions));
end $$;

/** Access or correction done (or any request refused, with the reason). */
create or replace function data_request_complete(p_request uuid, p_outcome text, p_refuse boolean default false)
returns void language plpgsql security definer set search_path = public as $$
declare r data_requests := data_request_load(p_request);
begin
  if p_refuse then
    if coalesce(trim(p_outcome), '') = '' then raise exception 'Give the reason for refusing.'; end if;
    perform data_request_close(r.id, 'refused', p_outcome, null);
    return;
  end if;
  if r.kind not in ('access', 'correction') then
    raise exception 'Use Restrict or Erase for this request.';
  end if;
  perform data_request_close(r.id, 'completed', p_outcome, null);
end $$;

/** Stop messages, calls and reminders; record view-only. Shared by restriction and erasure. */
create or replace function privacy_restrict(p_patient uuid, p_kind text) returns jsonb
language plpgsql security definer set search_path = public as $$
declare v_consents int; v_campaigns int;
begin
  perform set_config('carecall.privacy_op', 'on', true);
  update patients set restricted_at = coalesce(restricted_at, now()),
         restriction_kind = case when restriction_kind = 'erasure' then 'erasure' else p_kind end,
         do_not_call = true
   where id = p_patient;
  update care_consents set withdrawn_at = now() where patient_id = p_patient and withdrawn_at is null;
  get diagnostics v_consents = row_count;
  update campaign_patients set status = 'declined'
   where patient_id = p_patient and status in ('pending', 'notified', 'messaged', 'needs_invite', 'callback_requested');
  get diagnostics v_campaigns = row_count;
  return jsonb_build_object('consents_withdrawn', v_consents, 'campaign_entries_stopped', v_campaigns);
end $$;

create or replace function data_request_restrict(p_request uuid, p_outcome text default null)
returns jsonb language plpgsql security definer set search_path = public as $$
declare r data_requests := data_request_load(p_request); v jsonb;
begin
  if r.kind <> 'restriction' then raise exception 'This is not a restriction request.'; end if;
  v := privacy_restrict(r.patient_id, 'restriction');
  perform data_request_close(r.id, 'completed', coalesce(p_outcome, 'Restricted: no messages, calls or changes.'), v);
  return v;
end $$;

/** Lift a restriction (not an erasure). */
create or replace function data_request_lift(p_patient uuid, p_reason text)
returns void language plpgsql security definer set search_path = public as $$
declare v_clinic uuid; v_kind text;
begin
  select clinic_id, restriction_kind into v_clinic, v_kind from patients where id = p_patient;
  perform privacy_check(v_clinic);
  if v_kind is null then raise exception 'This record is not restricted.'; end if;
  if v_kind = 'erasure' then raise exception 'An erased record stays restricted until it is disposed of.'; end if;
  if coalesce(trim(p_reason), '') = '' then raise exception 'Give the reason for lifting the restriction.'; end if;
  perform set_config('carecall.privacy_op', 'on', true);
  -- Do-not-call stays on: staff turn it off only if the patient agrees to contact again.
  update patients set restricted_at = null, restriction_kind = null where id = p_patient;
  insert into audit_log (clinic_id, actor_user_id, action, target_type, target_id, detail)
  values (v_clinic, (nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'sub')::uuid,
          'restriction_lifted', 'patients', p_patient, jsonb_build_object('reason', p_reason));
end $$;

/** What erasure would delete and keep, and when the kept record can be disposed of. */
create or replace function data_request_preview(p_patient uuid) returns jsonb
language plpgsql security definer set search_path = public as $$
declare v_clinic uuid; v_last timestamptz; v_years int;
begin
  select clinic_id into v_clinic from patients where id = p_patient;
  if v_clinic is null then raise exception 'Patient not found.'; end if;
  perform privacy_check(v_clinic);
  v_last := patient_last_activity(p_patient);
  v_years := record_retention_years(v_clinic);
  return jsonb_build_object(
    'delete', jsonb_build_object(
      'chat_links', (select count(*) from patient_channels where patient_id = p_patient),
      'chat_invites', (select count(*) from channel_invites where patient_id = p_patient),
      'messages', (select count(*) from channel_messages where patient_id = p_patient),
      'booking_links', (select count(*) from booking_links where patient_id = p_patient),
      'campaign_entries', (select count(*) from campaign_patients where patient_id = p_patient),
      'calls', (select count(*) from call_logs where patient_id = p_patient),
      'appointment_reminders', (select count(*) from appointment_reminders where patient_id = p_patient),
      'reading_requests', (select count(*) from vital_requests where patient_id = p_patient),
      'symptom_checks', (select count(*) from symptom_checks s join appointments a on a.id = s.appointment_id where a.patient_id = p_patient),
      'action_items', (select count(*) from cc_action_items where patient_id = p_patient)),
    'keep', jsonb_build_object(
      'appointments', (select count(*) from appointments where patient_id = p_patient),
      'clinical_notes', (select count(*) from clinical_notes where patient_id = p_patient),
      'medicines', (select count(*) from medications where patient_id = p_patient),
      'medicine_doses', (select count(*) from medication_doses where patient_id = p_patient),
      'monitoring_plans', (select count(*) from monitoring_plans where patient_id = p_patient),
      'readings', (select count(*) from vital_readings where patient_id = p_patient),
      'consents', (select count(*) from care_consents where patient_id = p_patient)),
    'future_appointments', (select count(*) from appointments where patient_id = p_patient
                              and starts_at > now() and status in ('booked', 'confirmed')),
    'last_activity', v_last,
    'retention_years', v_years,
    'keep_until', (v_last + make_interval(years => v_years))::date,
    'disposable_now', v_last < now() - make_interval(years => v_years));
end $$;

/** Erasure: restrict for good, cancel future visits, delete what needn't be kept. */
create or replace function data_request_erase(p_request uuid, p_confirm_last_name text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  r data_requests := data_request_load(p_request);
  v_last_name text; v jsonb; v_del jsonb; n int;
  counts jsonb := '{}';
begin
  if r.kind <> 'erasure' then raise exception 'This is not an erasure request.'; end if;
  select last_name into v_last_name from patients where id = r.patient_id;
  if lower(trim(coalesce(p_confirm_last_name, ''))) <> lower(trim(v_last_name)) then
    raise exception 'Type the patient''s last name to confirm.';
  end if;
  v := privacy_restrict(r.patient_id, 'erasure');

  update appointments set status = 'cancelled'
   where patient_id = r.patient_id and starts_at > now() and status in ('booked', 'confirmed');
  get diagnostics n = row_count; counts := counts || jsonb_build_object('future_appointments_cancelled', n);

  delete from symptom_checks s using appointments a where a.id = s.appointment_id and a.patient_id = r.patient_id;
  get diagnostics n = row_count; counts := counts || jsonb_build_object('symptom_checks', n);
  delete from channel_messages where patient_id = r.patient_id;
  get diagnostics n = row_count; counts := counts || jsonb_build_object('messages', n);
  delete from patient_channels where patient_id = r.patient_id;
  get diagnostics n = row_count; counts := counts || jsonb_build_object('chat_links', n);
  delete from channel_invites where patient_id = r.patient_id;
  get diagnostics n = row_count; counts := counts || jsonb_build_object('chat_invites', n);
  delete from booking_links where patient_id = r.patient_id;
  get diagnostics n = row_count; counts := counts || jsonb_build_object('booking_links', n);
  delete from call_logs where patient_id = r.patient_id;
  get diagnostics n = row_count; counts := counts || jsonb_build_object('calls', n);
  delete from campaign_patients where patient_id = r.patient_id;
  get diagnostics n = row_count; counts := counts || jsonb_build_object('campaign_entries', n);
  delete from appointment_reminders where patient_id = r.patient_id;
  get diagnostics n = row_count; counts := counts || jsonb_build_object('appointment_reminders', n);
  delete from vital_requests where patient_id = r.patient_id;
  get diagnostics n = row_count; counts := counts || jsonb_build_object('reading_requests', n);
  delete from care_alerts where patient_id = r.patient_id;
  delete from cc_action_items where patient_id = r.patient_id and id is distinct from r.action_item_id;
  get diagnostics n = row_count; counts := counts || jsonb_build_object('action_items', n);

  update patients set erased_at = now() where id = r.patient_id;
  v_del := v || jsonb_build_object('deleted', counts,
    'keep_until', (patient_last_activity(r.patient_id) + make_interval(years => record_retention_years(r.clinic_id)))::date);
  perform data_request_close(r.id, 'completed',
    'Erased what the clinic needn''t keep; the medical record is view-only until it can be disposed of.', v_del);
  return v_del;
end $$;

/**
 * Dispose of a record past its retention period: delete it, keep a disposal
 * record without personal data, and blank the patient's data in the audit log.
 */
create or replace function dispose_patient_record(p_patient uuid, p_confirm_last_name text, p_note text default null)
returns uuid language plpgsql security definer set search_path = public as $$
declare
  p patients; v_last timestamptz; v_years int; v_disposal uuid; v_counts jsonb; v_request uuid;
  v_actor uuid := (nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'sub')::uuid;
begin
  select * into p from patients where id = p_patient for update;
  if p.id is null then raise exception 'Patient not found.'; end if;
  perform privacy_check(p.clinic_id);
  if lower(trim(coalesce(p_confirm_last_name, ''))) <> lower(trim(p.last_name)) then
    raise exception 'Type the patient''s last name to confirm.';
  end if;
  v_last := patient_last_activity(p_patient);
  v_years := record_retention_years(p.clinic_id);
  if v_last >= now() - make_interval(years => v_years) then
    raise exception 'This record is within its retention period (until %).', (v_last + make_interval(years => v_years))::date;
  end if;
  perform set_config('carecall.privacy_op', 'on', true);

  v_counts := jsonb_build_object(
    'appointments', (select count(*) from appointments where patient_id = p_patient),
    'clinical_notes', (select count(*) from clinical_notes where patient_id = p_patient),
    'medicines', (select count(*) from medications where patient_id = p_patient),
    'readings', (select count(*) from vital_readings where patient_id = p_patient),
    'messages', (select count(*) from channel_messages where patient_id = p_patient),
    'calls', (select count(*) from call_logs where patient_id = p_patient));
  select id into v_request from data_requests where patient_id = p_patient and kind = 'erasure'
   order by created_at desc limit 1;
  insert into record_disposals (clinic_id, disposed_by, request_id, patient_created_at, last_activity, retention_years, counts, note)
  values (p.clinic_id, v_actor, v_request, p.created_at, v_last, v_years, v_counts, nullif(trim(p_note), ''))
  returning id into v_disposal;

  -- Rows that don't cascade, then the patient (everything else cascades).
  delete from symptom_checks s using appointments a where a.id = s.appointment_id and a.patient_id = p_patient;
  delete from channel_messages where patient_id = p_patient;
  delete from call_logs where patient_id = p_patient;
  delete from appointments where patient_id = p_patient;
  -- Requests about this patient lose their free text (it may name them).
  update data_requests set details = null where patient_id = p_patient;
  delete from patients where id = p_patient;

  -- Audit rows keep who did what and when, not the patient's data.
  update audit_log set detail = jsonb_build_object('redacted', 'record disposed', 'disposal_id', v_disposal)
   where (target_type = 'patients' and target_id = p_patient) or detail ->> 'patient_id' = p_patient::text;
  insert into audit_log (clinic_id, actor_user_id, action, target_type, target_id, detail)
  values (p.clinic_id, v_actor, 'record_disposed', 'record_disposals', v_disposal,
          jsonb_build_object('counts', v_counts, 'retention_years', v_years));
  return v_disposal;
end $$;

grant execute on function data_request_complete(uuid, text, boolean) to authenticated;
grant execute on function data_request_restrict(uuid, text) to authenticated;
grant execute on function data_request_lift(uuid, text) to authenticated;
grant execute on function data_request_preview(uuid) to authenticated;
grant execute on function data_request_erase(uuid, text) to authenticated;
grant execute on function dispose_patient_record(uuid, text, text) to authenticated;
-- Internal steps: not callable directly.
revoke execute on function data_request_load(uuid) from public, anon, authenticated;
revoke execute on function data_request_close(uuid, text, text, jsonb) from public, anon, authenticated;
revoke execute on function privacy_restrict(uuid, text) from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- A new request becomes a CC action item for the clinic admin
-- ---------------------------------------------------------------------------
create or replace function fn_data_request_item() returns trigger
language plpgsql security definer set search_path = public as $$
declare v_name text; v_item uuid;
begin
  select first_name || ' ' || last_name into v_name from patients where id = new.patient_id;
  insert into cc_action_items (clinic_id, created_by, title, detail, category, severity, route, source, patient_id)
  values (new.clinic_id, new.created_by,
          format('Privacy request (%s), answer by %s: %s', new.kind, to_char(new.respond_by, 'Mon DD'), coalesce(v_name, 'a patient')),
          format('Logged %s, received by %s. A clinic admin handles it on the patient page under Privacy requests.',
                 to_char(new.received_at, 'Mon DD'), replace(new.received_via, '_', ' ')),
          'patients', case when new.kind in ('restriction', 'erasure') then 'warning' else 'info' end,
          '/patients/' || new.patient_id, 'reminder', new.patient_id)
  returning id into v_item;
  new.action_item_id := v_item;
  return new;
end $$;
drop trigger if exists trg_data_request_item on data_requests;
create trigger trg_data_request_item before insert on data_requests
  for each row execute function fn_data_request_item();

drop trigger if exists trg_audit_data_requests on data_requests;
create trigger trg_audit_data_requests after insert on data_requests
  for each row execute function fn_audit();
