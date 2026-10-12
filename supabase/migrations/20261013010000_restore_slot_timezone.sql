-- CareCall PH — restore timezone-correct slot generation.
--
-- booking-api, assistant-tools and the symptom check call
-- get_available_slots(p_provider_id, p_from, p_days, p_limit, p_tz). That
-- version lived in 20260705000000_slot_tz.sql, which was lost when the repo was
-- flattened (it shared its timestamp with portal_roles). Without it, a new
-- project only has the init.sql version, which has no p_tz, so every slot
-- lookup fails with "function does not exist".
--
-- provider_availability times (e.g. 09:00–12:00) are clinic-local wall-clock
-- times; p_tz pins them to the clinic's timezone (Asia/Manila by default).

drop function if exists get_available_slots(uuid, date, int, int);

create or replace function get_available_slots(
  p_provider_id uuid,
  p_from date default null,          -- clinic-local date; null = tomorrow, clinic time
  p_days int default 14,
  p_limit int default 30,
  p_tz text default 'Asia/Manila'
)
returns table (slot_start timestamptz, slot_end timestamptz)
language sql stable as $$
  with bounds as (
    select coalesce(p_from, (now() at time zone p_tz)::date + 1) as from_date
  ),
  days as (
    select generate_series(b.from_date, b.from_date + (p_days - 1), interval '1 day')::date as d
    from bounds b
  ),
  raw_slots as (
    select
      -- (date + local time) is a naive timestamp; AT TIME ZONE p_tz pins it to
      -- clinic wall-clock time and yields a correct timestamptz.
      ((d.d + pa.start_time) at time zone p_tz)
        + (n * make_interval(mins => pa.slot_length_minutes)) as slot_start,
      ((d.d + pa.start_time) at time zone p_tz)
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
