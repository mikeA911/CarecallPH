-- Nearby care (Discover D1b): clinic locations and the Places API budget.
-- Design: docs/symptom-check-design.md §3a.
--
-- The patient's location is never stored: it goes to Google for the lookup
-- only; symptom_checks.location_shared records that one was used.

-- Where the clinic is (set from its address in Clinic settings → Find on map).
alter table clinics add column if not exists lat double precision check (lat between -90 and 90);
alter table clinics add column if not exists lng double precision check (lng between -180 and 180);

-- Places API calls per month, against PLACES_MONTHLY_BUDGET.
create table if not exists places_usage (
  month text primary key,               -- 'YYYY-MM' (UTC)
  calls integer not null default 0
);
alter table places_usage enable row level security;   -- service role only

create or replace function bump_places_usage(p_calls integer default 1)
returns integer
language sql as $$
  insert into places_usage (month, calls) values (to_char(now() at time zone 'utc', 'YYYY-MM'), p_calls)
  on conflict (month) do update set calls = places_usage.calls + p_calls
  returning calls;
$$;

create or replace function places_calls_this_month()
returns integer
language sql stable as $$
  select coalesce((select calls from places_usage where month = to_char(now() at time zone 'utc', 'YYYY-MM')), 0);
$$;
