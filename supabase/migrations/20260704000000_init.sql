-- CareCall: AI outbound appointment scheduling
-- Supabase is the single source of truth. Telnyx only converses and invokes tools.

create extension if not exists "uuid-ossp";
create extension if not exists pgcrypto;
create extension if not exists btree_gist;

-- ============================================================
-- ENUMS
-- ============================================================
create type campaign_patient_status as enum (
  'pending', 'calling', 'booked', 'declined', 'callback_requested',
  'no_answer', 'voicemail', 'wrong_number', 'verification_failed', 'needs_human'
);

create type appointment_status as enum ('booked', 'confirmed', 'cancelled', 'completed', 'no_show');

create type call_result as enum (
  'booked', 'declined', 'callback_requested', 'no_answer', 'voicemail',
  'wrong_number', 'verification_failed', 'transferred', 'error'
);

-- ============================================================
-- CORE TABLES
-- ============================================================
create table providers (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  specialty text,
  active boolean not null default true,
  created_at timestamptz not null default now()
);

create table patients (
  id uuid primary key default gen_random_uuid(),
  first_name text not null,
  last_name text not null,
  phone text not null,                -- E.164, e.g. +15551234567
  email text,
  date_of_birth date not null,        -- used for identity verification (server-side only)
  provider_id uuid references providers(id),
  notes text,
  created_at timestamptz not null default now(),
  unique (phone, date_of_birth)
);

create table campaigns (
  id uuid primary key default gen_random_uuid(),
  name text not null,                 -- e.g. "Annual Wellness Visits"
  appointment_type text not null,     -- e.g. "wellness", "flu_shot"
  greeting_context text not null,     -- injected into AI prompt: why we're calling
  provider_id uuid references providers(id),  -- default provider; null = patient's own
  slot_length_minutes int not null default 30,
  active boolean not null default true,
  created_at timestamptz not null default now()
);

create table campaign_patients (
  campaign_id uuid not null references campaigns(id) on delete cascade,
  patient_id uuid not null references patients(id) on delete cascade,
  status campaign_patient_status not null default 'pending',
  attempts int not null default 0,
  last_attempt_at timestamptz,
  callback_after timestamptz,         -- set when patient asks "call me another day"
  flag_reason text,                   -- e.g. "identity verification failed"
  updated_at timestamptz not null default now(),
  primary key (campaign_id, patient_id)
);

create table provider_availability (
  id uuid primary key default gen_random_uuid(),
  provider_id uuid not null references providers(id) on delete cascade,
  weekday int not null check (weekday between 0 and 6),  -- 0 = Sunday
  start_time time not null,
  end_time time not null,
  slot_length_minutes int not null default 30
);

create table appointments (
  id uuid primary key default gen_random_uuid(),
  patient_id uuid not null references patients(id),
  provider_id uuid not null references providers(id),
  campaign_id uuid references campaigns(id),
  starts_at timestamptz not null,
  ends_at timestamptz not null,
  status appointment_status not null default 'booked',
  idempotency_key text unique,        -- prevents duplicate bookings on tool retries
  created_at timestamptz not null default now(),
  -- one provider can't be double-booked
  constraint no_double_booking exclude using gist (
    provider_id with =,
    tstzrange(starts_at, ends_at) with &&
  ) where (status in ('booked', 'confirmed'))
);

create table call_logs (
  id uuid primary key default gen_random_uuid(),
  call_control_id text unique,        -- Telnyx call control ID
  patient_id uuid references patients(id),
  campaign_id uuid references campaigns(id),
  started_at timestamptz not null default now(),
  ended_at timestamptz,
  duration_seconds int,
  amd_result text,                    -- 'human', 'machine', 'not_sure'
  verification_attempts int not null default 0,
  verified boolean not null default false,
  result call_result,
  transcript jsonb,
  summary text,
  appointment_id uuid references appointments(id),
  recording_url text,
  created_at timestamptz not null default now()
);

create index idx_call_logs_patient on call_logs(patient_id);
create index idx_appointments_provider_time on appointments(provider_id, starts_at);
create index idx_campaign_patients_status on campaign_patients(campaign_id, status);

-- ============================================================
-- SLOT GENERATION
-- Availability template minus existing bookings. The AI never
-- computes availability itself — it calls get_available_slots.
-- ============================================================
create or replace function get_available_slots(
  p_provider_id uuid,
  p_from date default current_date + 1,
  p_days int default 14,
  p_limit int default 30
)
returns table (slot_start timestamptz, slot_end timestamptz)
language sql stable as $$
  with days as (
    select generate_series(p_from, p_from + (p_days - 1), interval '1 day')::date as d
  ),
  raw_slots as (
    select
      (d.d + pa.start_time)::timestamptz
        + (n * make_interval(mins => pa.slot_length_minutes)) as slot_start,
      (d.d + pa.start_time)::timestamptz
        + ((n + 1) * make_interval(mins => pa.slot_length_minutes)) as slot_end
    from days d
    join provider_availability pa
      on pa.provider_id = p_provider_id
     and pa.weekday = extract(dow from d.d)::int
    cross join lateral generate_series(
      0,
      (extract(epoch from (pa.end_time - pa.start_time)) / 60 / pa.slot_length_minutes)::int - 1
    ) as n
  )
  select rs.slot_start, rs.slot_end
  from raw_slots rs
  where rs.slot_start > now()
    and not exists (
      select 1 from appointments a
      where a.provider_id = p_provider_id
        and a.status in ('booked', 'confirmed')
        and tstzrange(a.starts_at, a.ends_at) && tstzrange(rs.slot_start, rs.slot_end)
    )
  order by rs.slot_start
  limit p_limit;
$$;

-- ============================================================
-- DASHBOARD VIEW
-- ============================================================
create or replace view campaign_stats as
select
  c.id as campaign_id,
  c.name,
  count(cp.patient_id) as total_patients,
  count(*) filter (where cp.status = 'pending') as pending,
  count(*) filter (where cp.status = 'booked') as booked,
  count(*) filter (where cp.status = 'declined') as declined,
  count(*) filter (where cp.status in ('no_answer', 'voicemail')) as unreached,
  count(*) filter (where cp.status in ('verification_failed', 'needs_human')) as needs_human,
  round(
    100.0 * count(*) filter (where cp.status = 'booked')
    / nullif(count(*) filter (where cp.status not in ('pending', 'calling')), 0), 1
  ) as booking_rate_pct
from campaigns c
left join campaign_patients cp on cp.campaign_id = c.id
group by c.id, c.name;

-- ============================================================
-- ROW LEVEL SECURITY
-- Edge functions use the service role key (bypasses RLS).
-- Staff portal users must be authenticated.
-- ============================================================
alter table patients enable row level security;
alter table campaigns enable row level security;
alter table campaign_patients enable row level security;
alter table providers enable row level security;
alter table provider_availability enable row level security;
alter table appointments enable row level security;
alter table call_logs enable row level security;

create policy "staff read/write" on patients for all to authenticated using (true) with check (true);
create policy "staff read/write" on campaigns for all to authenticated using (true) with check (true);
create policy "staff read/write" on campaign_patients for all to authenticated using (true) with check (true);
create policy "staff read/write" on providers for all to authenticated using (true) with check (true);
create policy "staff read/write" on provider_availability for all to authenticated using (true) with check (true);
create policy "staff read/write" on appointments for all to authenticated using (true) with check (true);
create policy "staff read" on call_logs for select to authenticated using (true);

-- ============================================================
-- SEED (dev only — remove before production)
-- ============================================================
insert into providers (id, name, specialty) values
  ('11111111-1111-1111-1111-111111111111', 'Dr. Jones', 'Family Medicine');

insert into provider_availability (provider_id, weekday, start_time, end_time, slot_length_minutes) values
  ('11111111-1111-1111-1111-111111111111', 2, '09:00', '12:00', 30),  -- Tue AM
  ('11111111-1111-1111-1111-111111111111', 3, '13:00', '17:00', 30);  -- Wed PM
