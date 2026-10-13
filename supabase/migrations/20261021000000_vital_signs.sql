-- Vital signs by chat (care plans M3). Design: docs/care-plan-design.md §4, §4a, §5.
--
-- The doctor (or an assistant, as a draft) writes a monitoring plan; only a
-- doctor signs it (password re-entered, checked by the care-plan function).
-- Each measure in the plan says what, why, when, how, the target and the
-- critical limits, and what to do if high or low. After the patient agrees in
-- the chat (care_consents scope 'vital_signs'), CareCall asks for readings at
-- the plan's times; replies are checked against the doctor's limits only.
-- Out-of-range readings go to Readings to review; critical ones also tell the
-- patient to call 911 first. Front desk never sees plans or readings.

create table if not exists monitoring_plans (
  id uuid primary key default gen_random_uuid(),
  clinic_id uuid not null references clinics(id) on delete cascade,
  patient_id uuid not null references patients(id) on delete cascade,
  version integer not null default 1,
  status text not null default 'draft' check (status in ('draft', 'signed', 'replaced', 'stopped')),
  notes text check (length(notes) <= 1000),            -- for the clinic; not sent
  drafted_by uuid references auth.users(id),
  signed_by uuid references auth.users(id),
  signed_provider_id uuid references providers(id),
  signed_at timestamptz,
  sent_at timestamptz,                                  -- plan message sent to the patient
  stopped_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (status in ('draft') or (signed_at is not null and signed_by is not null))
);
create index if not exists idx_monitoring_plans_patient on monitoring_plans (patient_id, created_at desc);
-- At most one signed (running) plan per patient.
create unique index if not exists uq_monitoring_plans_signed on monitoring_plans (patient_id) where status = 'signed';

create table if not exists vital_plans (
  id uuid primary key default gen_random_uuid(),
  plan_id uuid not null references monitoring_plans(id) on delete cascade,
  clinic_id uuid not null references clinics(id) on delete cascade,
  patient_id uuid not null references patients(id) on delete cascade,
  measure text not null check (measure in ('bp', 'glucose', 'temperature', 'weight', 'spo2')),
  reason text check (length(reason) <= 500),            -- what and why, the doctor's words
  how_to text check (length(how_to) <= 1000),
  times_of_day time[] not null check (cardinality(times_of_day) between 1 and 4),
  days_of_week smallint[],                              -- 0 = Sunday … 6; null = every day
  start_date date not null default current_date,
  until_date date,
  -- Limits (BP: *_low/high = systolic, *_low2/high2 = diastolic).
  target_low numeric, target_high numeric, target_low2 numeric, target_high2 numeric,
  critical_low numeric, critical_high numeric, critical_low2 numeric, critical_high2 numeric,
  if_high text check (length(if_high) <= 500),          -- the doctor's action plan
  if_low text check (length(if_low) <= 500),
  created_at timestamptz not null default now(),
  check (until_date is null or until_date >= start_date)
);
create index if not exists idx_vital_plans_plan on vital_plans (plan_id);

create table if not exists vital_requests (
  id uuid primary key default gen_random_uuid(),
  vital_plan_id uuid not null references vital_plans(id) on delete cascade,
  clinic_id uuid not null references clinics(id) on delete cascade,
  patient_id uuid not null references patients(id) on delete cascade,
  due_at timestamptz not null,
  status text not null check (status in ('sent', 'answered', 'missed', 'failed', 'no_channel')),
  channel text,
  sent_at timestamptz not null default now(),
  answered_at timestamptz,
  unique (vital_plan_id, due_at)
);
create index if not exists idx_vital_requests_patient on vital_requests (patient_id, due_at desc);

create table if not exists vital_readings (
  id uuid primary key default gen_random_uuid(),
  clinic_id uuid not null references clinics(id) on delete cascade,
  patient_id uuid not null references patients(id) on delete cascade,
  vital_plan_id uuid references vital_plans(id) on delete set null,
  request_id uuid references vital_requests(id) on delete set null,
  measure text not null check (measure in ('bp', 'glucose', 'temperature', 'weight', 'spo2')),
  value1 numeric not null,                              -- BP systolic, or the single value
  value2 numeric,                                       -- BP diastolic
  pulse numeric,
  taken_at timestamptz not null default now(),
  source text not null default 'chat' check (source in ('chat', 'staff')),
  flag text not null default 'ok' check (flag in ('ok', 'out_of_range', 'critical')),
  entered_by uuid references auth.users(id),
  reviewed_by uuid references auth.users(id),
  reviewed_at timestamptz,
  review_note text check (length(review_note) <= 500),
  created_at timestamptz not null default now(),
  check (measure <> 'bp' or value2 is not null)
);
create index if not exists idx_vital_readings_patient on vital_readings (patient_id, taken_at desc);
create index if not exists idx_vital_readings_review on vital_readings (clinic_id, taken_at desc)
  where flag <> 'ok' and reviewed_at is null;

alter table monitoring_plans enable row level security;
alter table vital_plans enable row level security;
alter table vital_requests enable row level security;
alter table vital_readings enable row level security;

-- Nurses and doctors of the clinic only (front desk never sees readings).
drop policy if exists monitoring_plans_read on monitoring_plans;
create policy monitoring_plans_read on monitoring_plans for select to authenticated
  using ( can_manage_care() and (is_admin() or clinic_id = jwt_clinic_id()) );
drop policy if exists monitoring_plans_draft on monitoring_plans;
create policy monitoring_plans_draft on monitoring_plans for insert to authenticated
  with check ( can_manage_care() and (is_admin() or clinic_id = jwt_clinic_id()) and status = 'draft'
               and exists (select 1 from patients p where p.id = patient_id and p.clinic_id = monitoring_plans.clinic_id) );
drop policy if exists monitoring_plans_edit on monitoring_plans;
create policy monitoring_plans_edit on monitoring_plans for update to authenticated
  using ( can_manage_care() and (is_admin() or clinic_id = jwt_clinic_id()) and status = 'draft' )
  with check ( can_manage_care() and (is_admin() or clinic_id = jwt_clinic_id()) and status = 'draft' );
drop policy if exists monitoring_plans_delete on monitoring_plans;
create policy monitoring_plans_delete on monitoring_plans for delete to authenticated
  using ( can_manage_care() and (is_admin() or clinic_id = jwt_clinic_id()) and status = 'draft' );

-- Measures follow their plan: editable only while the plan is a draft.
drop policy if exists vital_plans_read on vital_plans;
create policy vital_plans_read on vital_plans for select to authenticated
  using ( can_manage_care() and (is_admin() or clinic_id = jwt_clinic_id()) );
drop policy if exists vital_plans_write on vital_plans;
create policy vital_plans_write on vital_plans for all to authenticated
  using ( can_manage_care() and (is_admin() or clinic_id = jwt_clinic_id())
          and exists (select 1 from monitoring_plans m where m.id = plan_id and m.status = 'draft') )
  with check ( can_manage_care() and (is_admin() or clinic_id = jwt_clinic_id())
               and exists (select 1 from monitoring_plans m where m.id = plan_id and m.status = 'draft'
                           and m.patient_id = vital_plans.patient_id and m.clinic_id = vital_plans.clinic_id) );

drop policy if exists vital_requests_read on vital_requests;
create policy vital_requests_read on vital_requests for select to authenticated
  using ( can_manage_care() and (is_admin() or clinic_id = jwt_clinic_id()) );

drop policy if exists vital_readings_read on vital_readings;
create policy vital_readings_read on vital_readings for select to authenticated
  using ( can_manage_care() and (is_admin() or clinic_id = jwt_clinic_id()) );
-- Staff enter a reading taken at the clinic; the flag is set by the trigger below.
drop policy if exists vital_readings_staff on vital_readings;
create policy vital_readings_staff on vital_readings for insert to authenticated
  with check ( can_manage_care() and (is_admin() or clinic_id = jwt_clinic_id()) and source = 'staff'
               and exists (select 1 from patients p where p.id = patient_id and p.clinic_id = vital_readings.clinic_id) );
-- Review: mark reviewed with a note (values never change).
drop policy if exists vital_readings_review on vital_readings;
create policy vital_readings_review on vital_readings for update to authenticated
  using ( can_manage_care() and (is_admin() or clinic_id = jwt_clinic_id()) )
  with check ( can_manage_care() and (is_admin() or clinic_id = jwt_clinic_id()) );

-- Signed plans are final (a change is a new version); readings' values and
-- flag never change after they're saved.
create or replace function fn_vitals_guard() returns trigger
language plpgsql as $$
begin
  if tg_table_name = 'monitoring_plans' then
    if tg_op = 'UPDATE' and old.status <> 'draft' then
      -- Only the status may move on (signed → replaced / stopped), plus sent_at.
      if (new.clinic_id, new.patient_id, new.version, new.notes, new.signed_by, new.signed_at, new.signed_provider_id)
         is distinct from (old.clinic_id, old.patient_id, old.version, old.notes, old.signed_by, old.signed_at, old.signed_provider_id)
         or (old.status in ('replaced', 'stopped') and new.status <> old.status) then
        raise exception 'a signed monitoring plan cannot be changed; make a new version';
      end if;
    end if;
    new.updated_at := now();
    return new;
  end if;
  -- vital_readings
  if tg_op = 'UPDATE' and (new.measure, new.value1, new.value2, new.pulse, new.taken_at, new.flag, new.patient_id, new.source)
       is distinct from (old.measure, old.value1, old.value2, old.pulse, old.taken_at, old.flag, old.patient_id, old.source) then
    raise exception 'a saved reading cannot be changed; only reviewed';
  end if;
  return new;
end $$;

drop trigger if exists trg_monitoring_plans_guard on monitoring_plans;
create trigger trg_monitoring_plans_guard before update on monitoring_plans
  for each row execute function fn_vitals_guard();
drop trigger if exists trg_vital_readings_guard on vital_readings;
create trigger trg_vital_readings_guard before update on vital_readings
  for each row execute function fn_vitals_guard();

-- Staff-entered readings get the same flag as chat readings, from the plan's limits.
create or replace function vital_flag(p_plan uuid, p_measure text, p_v1 numeric, p_v2 numeric)
returns text
language sql stable as $$
  select case
    when vp.id is null then 'ok'
    when (vp.critical_high is not null and p_v1 >= vp.critical_high)
      or (vp.critical_low is not null and p_v1 <= vp.critical_low)
      or (p_measure = 'bp' and ((vp.critical_high2 is not null and p_v2 >= vp.critical_high2)
                                or (vp.critical_low2 is not null and p_v2 <= vp.critical_low2))) then 'critical'
    when (vp.target_high is not null and p_v1 > vp.target_high)
      or (vp.target_low is not null and p_v1 < vp.target_low)
      or (p_measure = 'bp' and ((vp.target_high2 is not null and p_v2 > vp.target_high2)
                                or (vp.target_low2 is not null and p_v2 < vp.target_low2))) then 'out_of_range'
    else 'ok' end
  from (select 1) one left join vital_plans vp on vp.id = p_plan;
$$;

create or replace function fn_vital_reading_flag() returns trigger
language plpgsql as $$
begin
  if new.source = 'staff' then
    new.flag := vital_flag(new.vital_plan_id, new.measure, new.value1, new.value2);
    new.entered_by := coalesce(new.entered_by,
      (nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'sub')::uuid);
  end if;
  return new;
end $$;
drop trigger if exists trg_vital_reading_flag on vital_readings;
create trigger trg_vital_reading_flag before insert on vital_readings
  for each row execute function fn_vital_reading_flag();

drop trigger if exists trg_audit_monitoring_plans on monitoring_plans;
create trigger trg_audit_monitoring_plans after insert or update or delete on monitoring_plans
  for each row execute function fn_audit();
drop trigger if exists trg_audit_vital_plans on vital_plans;
create trigger trg_audit_vital_plans after insert or update or delete on vital_plans
  for each row execute function fn_audit();
drop trigger if exists trg_audit_vital_readings on vital_readings;
create trigger trg_audit_vital_readings after insert or update or delete on vital_readings
  for each row execute function fn_audit();
