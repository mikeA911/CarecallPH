-- CareCall PH — symptom check, Discover slice D1a (docs/symptom-check-design.md).
--
-- clinics:
--   symptom_check_enabled    — show the check on the clinic's page (/check/<public_slug>)
--   public_slug              — short web address, e.g. 'santos-family-clinic'
--   local_emergency_numbers  — city rescue / nearest hospital numbers shown on
--                              the emergency screen next to 911 (free text, one per line)
--
-- symptom_checks: one row per check, deliberately minimal. No names, no free
-- text, no condition list, no location, no IP address. Rows are written only by
-- the symptom-check edge function (service role) and deleted after 90 days.

alter table clinics
  add column if not exists symptom_check_enabled boolean not null default false,
  add column if not exists public_slug text,
  add column if not exists local_emergency_numbers text;

do $$ begin
  alter table clinics add constraint clinics_public_slug_key unique (public_slug);
exception when duplicate_object or duplicate_table then null; end $$;

do $$ begin
  alter table clinics add constraint clinics_public_slug_format
    check (public_slug is null or public_slug ~ '^[a-z0-9][a-z0-9-]{1,40}$');
exception when duplicate_object then null; end $$;

comment on column clinics.public_slug is 'Short public web address for the clinic, e.g. /check/<public_slug>.';
comment on column clinics.local_emergency_numbers is 'Shown on the symptom check emergency screen next to 911, one per line.';

create table if not exists symptom_checks (
  id uuid primary key default gen_random_uuid(),
  clinic_id uuid references clinics(id) on delete cascade,  -- null when not started from a clinic page
  entry text not null default 'web' check (entry in ('web', 'clinic_page', 'telegram')),
  engine text,                                               -- apimedic | infermedica
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  screened_at timestamptz,                                   -- emergency questions answered
  age_band text check (age_band in ('0-17', '18-39', '40-64', '65+')),
  sex text check (sex in ('male', 'female')),
  symptom_ids text[],                                        -- engine IDs only, never free text
  urgency text check (urgency in ('emergency', 'urgent', 'routine', 'self_care')),
  specialty text,
  engine_calls int not null default 0,
  location_shared boolean not null default false,            -- the coordinates themselves are never stored
  outcome text not null default 'started'
    check (outcome in ('started', 'emergency_shown', 'advised', 'booked', 'error')),
  appointment_id uuid references appointments(id) on delete set null
);

create index if not exists idx_symptom_checks_clinic on symptom_checks (clinic_id, created_at desc);
create index if not exists idx_symptom_checks_created on symptom_checks (created_at);

alter table symptom_checks enable row level security;

-- Staff read their own clinic's checks; nobody writes from the browser.
drop policy if exists symptom_checks_read on symptom_checks;
create policy symptom_checks_read on symptom_checks for select to authenticated
  using ( is_admin() or clinic_id = jwt_clinic_id() );

-- Engine calls this calendar month (Manila time), for the monthly budget.
create or replace function symptom_engine_calls_this_month(p_engine text)
returns int
language sql stable as $$
  select coalesce(sum(engine_calls), 0)::int
  from symptom_checks
  where engine = p_engine
    and created_at >= (date_trunc('month', now() at time zone 'Asia/Manila') at time zone 'Asia/Manila');
$$;

-- Per-IP, per-minute counter, same pattern as bump_booking_rate.
create table if not exists symptom_rate_limits (
  ip text not null,
  window_start timestamptz not null,
  count int not null default 0,
  primary key (ip, window_start)
);
alter table symptom_rate_limits enable row level security;  -- service role only

create or replace function bump_symptom_rate(p_ip text)
returns int
language plpgsql as $$
declare
  v_window timestamptz := date_trunc('minute', now());
  v_count int;
begin
  insert into symptom_rate_limits (ip, window_start, count)
  values (p_ip, v_window, 1)
  on conflict (ip, window_start)
    do update set count = symptom_rate_limits.count + 1
  returning count into v_count;

  delete from symptom_rate_limits where window_start < now() - interval '10 minutes';
  return v_count;
end $$;

-- Retention: delete checks older than 90 days, daily at 03:30 Manila (19:30 UTC).
do $$ begin
  perform cron.unschedule('carecall_symptom_check_retention');
exception when others then null; end $$;

select cron.schedule(
  'carecall_symptom_check_retention', '30 19 * * *',
  $$delete from symptom_checks where created_at < now() - interval '90 days';$$
);
