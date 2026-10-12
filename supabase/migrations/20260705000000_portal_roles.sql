-- CareCall Portal — UI & Roles (spec v1.1)
-- Adds multi-clinic scoping, roles/RLS, campaign lifecycle, review-queue
-- resolution, patient DNC/active flags, and an audit log.
--
-- This migration layers on top of 20260704000000_init.sql. It is idempotent
-- where practical so it can be re-run during development.

-- ============================================================
-- SEED CLINIC (D2: MVP seeds exactly one clinic; schema is multi-clinic)
-- ============================================================
create table if not exists clinics (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  phone_callback text,
  timezone text not null default 'America/Chicago',   -- IANA
  calling_hours jsonb not null default '{
    "0": null, "1": {"start":"09:00","end":"19:00"},
    "2": {"start":"09:00","end":"19:00"}, "3": {"start":"09:00","end":"19:00"},
    "4": {"start":"09:00","end":"19:00"}, "5": {"start":"09:00","end":"19:00"},
    "6": null
  }'::jsonb,                                            -- per-weekday {start,end} local; null = closed
  sms_fallback boolean not null default true,
  greeting_default text,
  active boolean not null default true,
  created_at timestamptz not null default now()
);

-- The single seed clinic every existing row backfills to.
insert into clinics (id, name, timezone, greeting_default)
values (
  '00000000-0000-0000-0000-000000000001',
  'BAIPOP Clinic',
  'America/Chicago',
  'We are calling to help you schedule an appointment.'
)
on conflict (id) do nothing;

-- ============================================================
-- clinic_id ON EVERY CLINIC-SCOPED TABLE (D2: none may be created without it)
-- ============================================================
alter table patients   add column if not exists clinic_id uuid references clinics(id);
alter table campaigns  add column if not exists clinic_id uuid references clinics(id);
alter table providers  add column if not exists clinic_id uuid references clinics(id);
alter table call_logs  add column if not exists clinic_id uuid references clinics(id);

-- Backfill existing single-clinic data to the seed clinic.
update patients  set clinic_id = '00000000-0000-0000-0000-000000000001' where clinic_id is null;
update campaigns set clinic_id = '00000000-0000-0000-0000-000000000001' where clinic_id is null;
update providers set clinic_id = '00000000-0000-0000-0000-000000000001' where clinic_id is null;
update call_logs set clinic_id = '00000000-0000-0000-0000-000000000001' where clinic_id is null;

alter table patients   alter column clinic_id set not null;
alter table campaigns  alter column clinic_id set not null;
alter table providers  alter column clinic_id set not null;
-- call_logs may have historical rows without a clinic; keep nullable-safe default
update call_logs set clinic_id = '00000000-0000-0000-0000-000000000001' where clinic_id is null;

create index if not exists idx_patients_clinic   on patients(clinic_id);
create index if not exists idx_campaigns_clinic  on campaigns(clinic_id);
create index if not exists idx_providers_clinic  on providers(clinic_id);
create index if not exists idx_call_logs_clinic  on call_logs(clinic_id);

-- ============================================================
-- PATIENTS: do-not-call + active (§4.2)
-- ============================================================
alter table patients add column if not exists do_not_call boolean not null default false;
alter table patients add column if not exists active      boolean not null default true;

-- ============================================================
-- CAMPAIGNS: status machine + scheduling + created_by (§4.3)
-- ============================================================
do $$ begin
  create type campaign_status as enum ('draft','scheduled','active','paused','completed');
exception when duplicate_object then null; end $$;

alter table campaigns add column if not exists status campaign_status;
alter table campaigns add column if not exists scheduled_start timestamptz;
alter table campaigns add column if not exists created_by uuid;

-- Migrate the old boolean `active` into the new status enum, then drop it.
do $$ begin
  if exists (
    select 1 from information_schema.columns
    where table_name = 'campaigns' and column_name = 'active'
  ) then
    update campaigns set status = case when active then 'active'::campaign_status
                                       else 'paused'::campaign_status end
      where status is null;
    alter table campaigns drop column active;
  end if;
end $$;

update campaigns set status = 'draft' where status is null;
alter table campaigns alter column status set not null;
alter table campaigns alter column status set default 'draft';

-- ============================================================
-- campaign_patients: review-queue resolution (§2.4, §4.3)
-- Postgres enums can't drop values; add 'resolved'.
-- ============================================================
alter type campaign_patient_status add value if not exists 'resolved';

alter table campaign_patients add column if not exists resolved_by  uuid;
alter table campaign_patients add column if not exists resolved_at  timestamptz;

-- ============================================================
-- AUDIT LOG (§4.5)
-- ============================================================
create table if not exists audit_log (
  id uuid primary key default gen_random_uuid(),
  clinic_id uuid references clinics(id),
  actor_user_id uuid,
  action text not null,
  target_type text,
  target_id uuid,
  detail jsonb,
  created_at timestamptz not null default now()
);
create index if not exists idx_audit_log_clinic on audit_log(clinic_id, created_at desc);

-- ============================================================
-- ROLE HELPERS (§4.6) — read role/clinic straight from the JWT claims.
-- app_metadata is set only by admin-manage and is never client-writable.
-- ============================================================
create or replace function jwt_role() returns text
language sql stable as $$
  select coalesce(
    nullif(current_setting('request.jwt.claims', true), '')::jsonb
      -> 'app_metadata' ->> 'role',
    ''
  );
$$;

create or replace function jwt_clinic_id() returns uuid
language sql stable as $$
  select nullif(
    coalesce(
      nullif(current_setting('request.jwt.claims', true), '')::jsonb
        -> 'app_metadata' ->> 'clinic_id',
      ''
    ), ''
  )::uuid;
$$;

create or replace function is_admin() returns boolean
language sql stable as $$ select jwt_role() = 'admin'; $$;

create or replace function is_clinic_admin() returns boolean
language sql stable as $$ select jwt_role() in ('admin','clinic_admin'); $$;

-- ============================================================
-- RLS REWRITE (§4.6)
-- Drop the permissive "any authenticated" policies and replace with
-- clinic-scoped policies. Edge functions still use the service role key
-- and bypass RLS entirely.
-- ============================================================
alter table clinics            enable row level security;
alter table audit_log          enable row level security;
alter table appointments       enable row level security;

-- Remove old blanket policies (safe if they don't exist).
drop policy if exists "staff read/write" on patients;
drop policy if exists "staff read/write" on campaigns;
drop policy if exists "staff read/write" on campaign_patients;
drop policy if exists "staff read/write" on providers;
drop policy if exists "staff read/write" on provider_availability;
drop policy if exists "staff read/write" on appointments;
drop policy if exists "staff read" on call_logs;

-- ---------- clinics ----------
drop policy if exists clinics_read  on clinics;
drop policy if exists clinics_write on clinics;
create policy clinics_read on clinics for select to authenticated
  using ( is_admin() or id = jwt_clinic_id() );
-- Only platform Admin may create/edit clinics.
create policy clinics_write on clinics for all to authenticated
  using ( is_admin() ) with check ( is_admin() );

-- ---------- patients (Clinic Admin+ manage; Staff read) ----------
drop policy if exists patients_read   on patients;
drop policy if exists patients_write  on patients;
create policy patients_read on patients for select to authenticated
  using ( is_admin() or clinic_id = jwt_clinic_id() );
create policy patients_write on patients for all to authenticated
  using ( (is_admin() or clinic_id = jwt_clinic_id()) and is_clinic_admin() )
  with check ( (is_admin() or clinic_id = jwt_clinic_id()) and is_clinic_admin() );

-- ---------- providers (clinicians) — Clinic Admin+ ----------
drop policy if exists providers_read  on providers;
drop policy if exists providers_write on providers;
create policy providers_read on providers for select to authenticated
  using ( is_admin() or clinic_id = jwt_clinic_id() );
create policy providers_write on providers for all to authenticated
  using ( (is_admin() or clinic_id = jwt_clinic_id()) and is_clinic_admin() )
  with check ( (is_admin() or clinic_id = jwt_clinic_id()) and is_clinic_admin() );

-- ---------- provider_availability — Clinic Admin+ (scope via provider) ----------
drop policy if exists provider_availability_read  on provider_availability;
drop policy if exists provider_availability_write on provider_availability;
create policy provider_availability_read on provider_availability for select to authenticated
  using ( exists (
    select 1 from providers p where p.id = provider_availability.provider_id
      and ( is_admin() or p.clinic_id = jwt_clinic_id() )
  ) );
create policy provider_availability_write on provider_availability for all to authenticated
  using ( is_clinic_admin() and exists (
    select 1 from providers p where p.id = provider_availability.provider_id
      and ( is_admin() or p.clinic_id = jwt_clinic_id() )
  ) )
  with check ( is_clinic_admin() and exists (
    select 1 from providers p where p.id = provider_availability.provider_id
      and ( is_admin() or p.clinic_id = jwt_clinic_id() )
  ) );

-- ---------- campaigns (D1: Staff read-only; Clinic Admin+ create/edit) ----------
drop policy if exists campaigns_read   on campaigns;
drop policy if exists campaigns_write  on campaigns;
create policy campaigns_read on campaigns for select to authenticated
  using ( is_admin() or clinic_id = jwt_clinic_id() );
create policy campaigns_write on campaigns for all to authenticated
  using ( (is_admin() or clinic_id = jwt_clinic_id()) and is_clinic_admin() )
  with check ( (is_admin() or clinic_id = jwt_clinic_id()) and is_clinic_admin() );

-- ---------- campaign_patients (all roles may run/resolve within their clinic) ----------
drop policy if exists campaign_patients_read  on campaign_patients;
drop policy if exists campaign_patients_write on campaign_patients;
create policy campaign_patients_read on campaign_patients for select to authenticated
  using ( exists (
    select 1 from campaigns c where c.id = campaign_patients.campaign_id
      and ( is_admin() or c.clinic_id = jwt_clinic_id() )
  ) );
-- Staff may update (resolve / requeue) but campaign creation stays with Clinic Admin+ (RLS on campaigns).
create policy campaign_patients_write on campaign_patients for all to authenticated
  using ( exists (
    select 1 from campaigns c where c.id = campaign_patients.campaign_id
      and ( is_admin() or c.clinic_id = jwt_clinic_id() )
  ) )
  with check ( exists (
    select 1 from campaigns c where c.id = campaign_patients.campaign_id
      and ( is_admin() or c.clinic_id = jwt_clinic_id() )
  ) );

-- ---------- appointments (scope via provider clinic) ----------
drop policy if exists appointments_read  on appointments;
drop policy if exists appointments_write on appointments;
create policy appointments_read on appointments for select to authenticated
  using ( exists (
    select 1 from providers p where p.id = appointments.provider_id
      and ( is_admin() or p.clinic_id = jwt_clinic_id() )
  ) );
create policy appointments_write on appointments for all to authenticated
  using ( exists (
    select 1 from providers p where p.id = appointments.provider_id
      and ( is_admin() or p.clinic_id = jwt_clinic_id() )
  ) )
  with check ( exists (
    select 1 from providers p where p.id = appointments.provider_id
      and ( is_admin() or p.clinic_id = jwt_clinic_id() )
  ) );

-- ---------- call_logs (read-only in portal) ----------
drop policy if exists call_logs_read on call_logs;
create policy call_logs_read on call_logs for select to authenticated
  using ( is_admin() or clinic_id = jwt_clinic_id() );

-- ---------- audit_log (read-only; Admin all, Clinic Admin own clinic) ----------
drop policy if exists audit_log_read on audit_log;
create policy audit_log_read on audit_log for select to authenticated
  using ( is_admin() or clinic_id = jwt_clinic_id() );

-- ============================================================
-- AUDIT TRIGGERS on patients / campaigns / clinics (§4.5)
-- Captures create/update/delete. actor is the JWT subject when available.
-- ============================================================
create or replace function fn_audit() returns trigger
language plpgsql security definer as $$
declare
  v_actor uuid;
  v_clinic uuid;
  v_target uuid;
begin
  begin
    v_actor := nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'sub';
  exception when others then v_actor := null; end;

  if tg_op = 'DELETE' then
    v_target := old.id;
    v_clinic := case when tg_table_name = 'clinics' then old.id else old.clinic_id end;
  else
    v_target := new.id;
    v_clinic := case when tg_table_name = 'clinics' then new.id else new.clinic_id end;
  end if;

  insert into audit_log (clinic_id, actor_user_id, action, target_type, target_id, detail)
  values (
    v_clinic, v_actor,
    lower(tg_op), tg_table_name, v_target,
    case when tg_op = 'DELETE' then to_jsonb(old) else to_jsonb(new) end
  );

  if tg_op = 'DELETE' then return old; else return new; end if;
end $$;

drop trigger if exists trg_audit_patients  on patients;
drop trigger if exists trg_audit_campaigns on campaigns;
drop trigger if exists trg_audit_clinics   on clinics;
create trigger trg_audit_patients  after insert or update or delete on patients  for each row execute function fn_audit();
create trigger trg_audit_campaigns after insert or update or delete on campaigns for each row execute function fn_audit();
create trigger trg_audit_clinics   after insert or update or delete on clinics   for each row execute function fn_audit();

-- ============================================================
-- DASHBOARD VIEW — refresh to include clinic_id + resolved bucket.
-- Drop first: column order/name changes are not allowed by CREATE OR REPLACE.
-- ============================================================
drop view if exists campaign_stats;
create view campaign_stats as
select
  c.id as campaign_id,
  c.clinic_id,
  c.name,
  c.status,
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
group by c.id, c.clinic_id, c.name, c.status;

-- ============================================================
-- CALLING-HOURS HELPER (§4.4) — used by start-campaign.
-- Returns true if `now` (in the clinic's tz) falls inside the clinic's
-- configured window for the current weekday.
-- ============================================================
create or replace function clinic_within_calling_hours(p_clinic_id uuid)
returns boolean
language plpgsql stable as $$
declare
  v_tz text;
  v_hours jsonb;
  v_local timestamp;
  v_dow int;
  v_day jsonb;
  v_start time;
  v_end time;
begin
  select timezone, calling_hours into v_tz, v_hours from clinics where id = p_clinic_id;
  if v_tz is null then return false; end if;

  v_local := (now() at time zone v_tz);
  v_dow := extract(dow from v_local)::int;          -- 0 = Sunday
  v_day := v_hours -> v_dow::text;
  if v_day is null or v_day = 'null'::jsonb then
    return false;                                    -- clinic closed this weekday
  end if;

  v_start := (v_day ->> 'start')::time;
  v_end   := (v_day ->> 'end')::time;
  return v_local::time >= v_start and v_local::time < v_end;
end $$;

-- ============================================================
-- STORAGE: avatars bucket (§2.8) — public read, authenticated write.
-- ============================================================
insert into storage.buckets (id, name, public)
values ('avatars', 'avatars', true)
on conflict (id) do nothing;

do $$ begin
  create policy "avatars public read" on storage.objects for select
    using ( bucket_id = 'avatars' );
exception when duplicate_object then null; end $$;

do $$ begin
  create policy "avatars owner write" on storage.objects for insert to authenticated
    with check ( bucket_id = 'avatars' );
exception when duplicate_object then null; end $$;

do $$ begin
  create policy "avatars owner update" on storage.objects for update to authenticated
    using ( bucket_id = 'avatars' );
exception when duplicate_object then null; end $$;
