-- CareCall PH — care plans, slice M1: consent and medicine reminders.
-- Design: docs/care-plan-design.md
--
-- care_consents      the patient's answer, in the chat, to a consent request
--                    (scopes, the exact wording version, time, channel).
--                    Latest row per patient+clinic decides. Withdrawing
--                    (STOP REMINDERS) stops new messages; records are kept.
-- medications        what staff entered (later: from a signed prescription, M2)
-- medication_doses   one row per reminder sent: taken / skipped / missed
--
-- Medicine reminders are sent by send-reminders (every 5 minutes) only to
-- patients with active consent and a connected chat app (not SMS: replies
-- are tracked in the chat).

create table if not exists care_consents (
  id uuid primary key default gen_random_uuid(),
  clinic_id uuid not null references clinics(id) on delete cascade,
  patient_id uuid not null references patients(id) on delete cascade,
  scopes text[] not null default array['medication_reminders'],
  wording_version text not null,
  channel text,
  requested_by uuid references auth.users(id),
  requested_at timestamptz not null default now(),
  consented_at timestamptz,
  declined_at timestamptz,
  withdrawn_at timestamptz
);
create index if not exists idx_care_consents_patient on care_consents (patient_id, requested_at desc);

create table if not exists medications (
  id uuid primary key default gen_random_uuid(),
  clinic_id uuid not null references clinics(id) on delete cascade,
  patient_id uuid not null references patients(id) on delete cascade,
  name text not null check (length(name) between 1 and 120),        -- generic (brand) as written
  dose text check (length(dose) <= 80),                              -- e.g. "5 mg, 1 tablet"
  instructions text check (length(instructions) <= 200),            -- e.g. "after breakfast"
  times_of_day time[] not null check (cardinality(times_of_day) between 1 and 6),
  start_date date not null default current_date,
  end_date date,
  discreet boolean not null default false,                           -- no medicine name in chat
  active boolean not null default true,
  created_by uuid references auth.users(id),
  created_at timestamptz not null default now(),
  check (end_date is null or end_date >= start_date)
);
create index if not exists idx_medications_patient on medications (patient_id) where active;

create table if not exists medication_doses (
  id uuid primary key default gen_random_uuid(),
  medication_id uuid not null references medications(id) on delete cascade,
  clinic_id uuid not null references clinics(id) on delete cascade,
  patient_id uuid not null references patients(id) on delete cascade,
  due_at timestamptz not null,
  status text not null check (status in ('sent', 'taken', 'skipped', 'missed', 'failed', 'no_channel')),
  channel text,
  sent_at timestamptz not null default now(),
  answered_at timestamptz,
  unique (medication_id, due_at)
);
create index if not exists idx_medication_doses_patient on medication_doses (patient_id, due_at desc);

alter table care_consents enable row level security;
alter table medications enable row level security;
alter table medication_doses enable row level security;

-- Staff read their clinic's rows. Consents and doses are written only by edge
-- functions (service role). Medicines are managed by clinic staff.
drop policy if exists care_consents_read on care_consents;
create policy care_consents_read on care_consents for select to authenticated
  using ( is_admin() or clinic_id = jwt_clinic_id() );

drop policy if exists medication_doses_read on medication_doses;
create policy medication_doses_read on medication_doses for select to authenticated
  using ( is_admin() or clinic_id = jwt_clinic_id() );

drop policy if exists medications_read on medications;
create policy medications_read on medications for select to authenticated
  using ( is_admin() or clinic_id = jwt_clinic_id() );
drop policy if exists medications_insert on medications;
create policy medications_insert on medications for insert to authenticated
  with check ( (is_admin() or clinic_id = jwt_clinic_id())
               and exists (select 1 from patients p where p.id = patient_id and p.clinic_id = medications.clinic_id) );
drop policy if exists medications_update on medications;
create policy medications_update on medications for update to authenticated
  using ( is_admin() or clinic_id = jwt_clinic_id() )
  with check ( is_admin() or clinic_id = jwt_clinic_id() );

-- Audit every change to medicines and consents.
drop trigger if exists trg_audit_medications on medications;
create trigger trg_audit_medications after insert or update or delete on medications
  for each row execute function fn_audit();
drop trigger if exists trg_audit_care_consents on care_consents;
create trigger trg_audit_care_consents after insert or update or delete on care_consents
  for each row execute function fn_audit();
