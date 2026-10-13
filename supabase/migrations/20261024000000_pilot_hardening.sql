-- Pilot hardening: holidays and closures in booking; scheduled purge of old
-- messages and call records. (Telnyx webhook signatures are checked in the
-- telnyx-call-events function.)

-- ===========================================================================
-- 1. Holidays and clinic closures
-- ===========================================================================
-- National holidays (platform admins keep the list; check it against each
-- year's Malacañang proclamation) and each clinic's own closed days. A clinic
-- chooses which national holidays close it: all (default), regular only, or
-- none. Closed days get no slots for booking links, chat, the symptom check
-- or the dashboard.

create table if not exists holidays (
  date date primary key,
  name text not null check (length(name) <= 100),
  kind text not null check (kind in ('regular', 'special')),
  updated_by uuid references auth.users(id),
  updated_at timestamptz not null default now()
);
alter table holidays enable row level security;
drop policy if exists holidays_read on holidays;
create policy holidays_read on holidays for select to authenticated using (true);
drop policy if exists holidays_write on holidays;
create policy holidays_write on holidays for all to authenticated using ( is_admin() ) with check ( is_admin() );

-- Regular holidays and special non-working days set by law (RA 9492 and
-- others) and the Holy Week dates. Eid'l Fitr and Eid'l Adha are proclaimed
-- each year: platform admins add them. Check every year's proclamation.
insert into holidays (date, name, kind) values
  ('2026-11-01', 'All Saints'' Day', 'special'),
  ('2026-11-30', 'Bonifacio Day', 'regular'),
  ('2026-12-08', 'Feast of the Immaculate Conception', 'special'),
  ('2026-12-24', 'Christmas Eve', 'special'),
  ('2026-12-25', 'Christmas Day', 'regular'),
  ('2026-12-30', 'Rizal Day', 'regular'),
  ('2026-12-31', 'Last Day of the Year', 'special'),
  ('2027-01-01', 'New Year''s Day', 'regular'),
  ('2027-02-06', 'Chinese New Year', 'special'),
  ('2027-03-25', 'Maundy Thursday', 'regular'),
  ('2027-03-26', 'Good Friday', 'regular'),
  ('2027-03-27', 'Black Saturday', 'special'),
  ('2027-04-09', 'Araw ng Kagitingan', 'regular'),
  ('2027-05-01', 'Labor Day', 'regular'),
  ('2027-06-12', 'Independence Day', 'regular'),
  ('2027-08-21', 'Ninoy Aquino Day', 'special'),
  ('2027-08-30', 'National Heroes Day', 'regular'),
  ('2027-11-01', 'All Saints'' Day', 'special'),
  ('2027-11-30', 'Bonifacio Day', 'regular'),
  ('2027-12-08', 'Feast of the Immaculate Conception', 'special'),
  ('2027-12-24', 'Christmas Eve', 'special'),
  ('2027-12-25', 'Christmas Day', 'regular'),
  ('2027-12-30', 'Rizal Day', 'regular'),
  ('2027-12-31', 'Last Day of the Year', 'special')
on conflict (date) do nothing;

alter table clinics add column if not exists holiday_closures text not null default 'all'
  check (holiday_closures in ('all', 'regular', 'none'));

create table if not exists clinic_closures (
  id uuid primary key default gen_random_uuid(),
  clinic_id uuid not null references clinics(id) on delete cascade,
  date date not null,
  reason text check (length(reason) <= 100),
  created_by uuid references auth.users(id),
  created_at timestamptz not null default now(),
  unique (clinic_id, date)
);
alter table clinic_closures enable row level security;
drop policy if exists clinic_closures_read on clinic_closures;
create policy clinic_closures_read on clinic_closures for select to authenticated
  using ( is_admin() or clinic_id = jwt_clinic_id() );
drop policy if exists clinic_closures_write on clinic_closures;
create policy clinic_closures_write on clinic_closures for all to authenticated
  using ( is_admin() or (is_clinic_admin() and clinic_id = jwt_clinic_id()) )
  with check ( is_admin() or (is_clinic_admin() and clinic_id = jwt_clinic_id()) );

/** Whether a clinic is closed on a (clinic-local) date: its own closures and the holidays it observes. */
create or replace function clinic_closed_on(p_clinic uuid, p_date date) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from clinic_closures c where c.clinic_id = p_clinic and c.date = p_date)
      or exists (select 1 from holidays h join clinics k on k.id = p_clinic
                  where h.date = p_date
                    and (k.holiday_closures = 'all' or (k.holiday_closures = 'regular' and h.kind = 'regular')));
$$;
grant execute on function clinic_closed_on(uuid, date) to authenticated, anon;

-- Same function as 20261013010000_restore_slot_timezone.sql, plus: no slots on
-- days the provider's clinic is closed.
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
    select coalesce(p_from, (now() at time zone p_tz)::date + 1) as from_date,
           (select clinic_id from providers where id = p_provider_id) as clinic_id
  ),
  days as (
    select generate_series(b.from_date, b.from_date + (p_days - 1), interval '1 day')::date as d, b.clinic_id
    from bounds b
  ),
  open_days as (
    select d, clinic_id from days where clinic_id is null or not clinic_closed_on(clinic_id, d)
  ),
  raw_slots as (
    select
      ((d.d + pa.start_time) at time zone p_tz)
        + (n * make_interval(mins => pa.slot_length_minutes)) as slot_start,
      ((d.d + pa.start_time) at time zone p_tz)
        + ((n + 1) * make_interval(mins => pa.slot_length_minutes)) as slot_end
    from open_days d
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

drop trigger if exists trg_audit_holidays on holidays;
create trigger trg_audit_holidays after insert or update or delete on holidays
  for each row execute function fn_audit();

-- ===========================================================================
-- 2. Purge old messages and call records
-- ===========================================================================
-- Chat and SMS messages, and call transcripts, summaries and recording links,
-- are contact history, not the medical record. They are deleted (calls: the
-- transcript, summary and recording link blanked; the call's outcome stays)
-- after a period: platform defaults, optional per clinic. Readings, dose
-- answers and appointments are kept with the record.

insert into platform_settings (key, value) values
  ('message_retention_days', '365'),
  ('call_record_retention_days', '90')
on conflict (key) do nothing;

alter table clinics add column if not exists message_retention_days integer
  check (message_retention_days between 30 and 3650);
alter table clinics add column if not exists call_record_retention_days integer
  check (call_record_retention_days between 7 and 3650);

create or replace function contact_retention_days(p_clinic uuid, p_kind text) returns integer
language sql stable security definer set search_path = public as $$
  select coalesce(
    (select case when p_kind = 'messages' then message_retention_days else call_record_retention_days end
       from clinics where id = p_clinic),
    (select (value #>> '{}')::integer from platform_settings
      where key = case when p_kind = 'messages' then 'message_retention_days' else 'call_record_retention_days' end),
    case when p_kind = 'messages' then 365 else 90 end);
$$;

/** Nightly: delete old messages, blank old call transcripts and recording links, drop spent invites and links. */
create or replace function purge_contact_history() returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  c record; n int;
  v_messages int := 0; v_calls int := 0; v_invites int := 0; v_links int := 0;
begin
  for c in select id from clinics loop
    delete from channel_messages
     where clinic_id = c.id and created_at < now() - make_interval(days => contact_retention_days(c.id, 'messages'));
    get diagnostics n = row_count; v_messages := v_messages + n;
    update call_logs set transcript = null, summary = null, recording_url = null
     where clinic_id = c.id and coalesce(ended_at, started_at, created_at) < now() - make_interval(days => contact_retention_days(c.id, 'calls'))
       and (transcript is not null or summary is not null or recording_url is not null);
    get diagnostics n = row_count; v_calls := v_calls + n;
  end loop;
  -- Messages and calls not tied to a clinic: platform defaults.
  delete from channel_messages where clinic_id is null and created_at < now() - make_interval(days => contact_retention_days(null, 'messages'));
  get diagnostics n = row_count; v_messages := v_messages + n;
  update call_logs set transcript = null, summary = null, recording_url = null
   where clinic_id is null and coalesce(ended_at, started_at, created_at) < now() - make_interval(days => contact_retention_days(null, 'calls'))
     and (transcript is not null or summary is not null or recording_url is not null);
  get diagnostics n = row_count; v_calls := v_calls + n;
  -- Chat invites and booking links that expired (or locked) more than 30 days ago.
  delete from channel_invites where expires_at < now() - interval '30 days';
  get diagnostics v_invites = row_count;
  delete from booking_links where booked_appointment_id is null
     and (expires_at < now() - interval '30 days' or (locked and created_at < now() - interval '30 days'));
  get diagnostics v_links = row_count;

  insert into audit_log (clinic_id, actor_user_id, action, target_type, target_id, detail)
  values (null, null, 'contact_history_purged', 'platform', null,
          jsonb_build_object('messages_deleted', v_messages, 'calls_blanked', v_calls,
                             'invites_deleted', v_invites, 'booking_links_deleted', v_links));
  return jsonb_build_object('messages_deleted', v_messages, 'calls_blanked', v_calls,
                            'invites_deleted', v_invites, 'booking_links_deleted', v_links);
end $$;
revoke execute on function purge_contact_history() from public, anon, authenticated;

do $$ begin
  perform cron.unschedule('carecall_contact_purge');
exception when others then null; end $$;
-- 03:45 Manila.
do $$ begin
  perform cron.schedule('carecall_contact_purge', '45 19 * * *', $cron$select purge_contact_history();$cron$);
exception when undefined_function or invalid_schema_name then
  raise notice 'pg_cron not available: schedule purge_contact_history() yourself';
end $$;
