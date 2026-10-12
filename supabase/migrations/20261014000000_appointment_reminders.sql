-- CareCall PH — appointment reminders and confirmations (Phase 2c).
--
-- A chat reminder 24 hours and 2 hours before each booked appointment, on the
-- patient's opted-in channel. The patient replies:
--   1 / C / CONFIRM / OO            → appointment confirmed
--   2 / R / RESCHEDULE / PALIT      → the clinic is asked to arrange a new time
--   3 / X / CANCEL / KANSELA        → appointment cancelled (the slot opens up)
-- Reschedule and cancel requests become CC action items for the clinic.
--
-- Sent by the send-reminders function, called every 5 minutes by pg_cron
-- (same Vault secrets as tick_active_campaigns). Per-clinic switch, off by
-- default: Clinic settings → Appointment reminders.

alter table clinics
  add column if not exists reminders_enabled boolean not null default false;

create table if not exists appointment_reminders (
  id uuid primary key default gen_random_uuid(),
  appointment_id uuid not null references appointments(id) on delete cascade,
  clinic_id uuid references clinics(id) on delete cascade,
  patient_id uuid references patients(id) on delete cascade,
  kind text not null check (kind in ('24h', '2h')),
  status text not null check (status in ('sent', 'failed', 'no_channel')),
  channel text,
  created_at timestamptz not null default now(),
  response text check (response in ('confirm', 'reschedule', 'cancel')),
  responded_at timestamptz,
  unique (appointment_id, kind)
);

create index if not exists idx_appointment_reminders_patient
  on appointment_reminders (patient_id, created_at desc);

alter table appointment_reminders enable row level security;

drop policy if exists appointment_reminders_read on appointment_reminders;
create policy appointment_reminders_read on appointment_reminders for select to authenticated
  using ( is_admin() or clinic_id = jwt_clinic_id() );

-- CC action items can now come from reminder replies.
do $$
declare c text;
begin
  for c in
    select con.conname from pg_constraint con
    join pg_class rel on rel.oid = con.conrelid
    where rel.relname = 'cc_action_items' and con.contype = 'c'
      and pg_get_constraintdef(con.oid) like '%source%'
  loop
    execute format('alter table cc_action_items drop constraint %I', c);
  end loop;
end $$;

alter table cc_action_items
  add constraint cc_action_items_source_check check (source in ('chat', 'nightly', 'reminder'));

create or replace function tick_reminders()
returns void
language plpgsql
security definer as $$
declare
  v_url text;
  v_key text;
begin
  select decrypted_secret into v_url from vault.decrypted_secrets where name = 'functions_url';
  select decrypted_secret into v_key from vault.decrypted_secrets where name = 'service_role_key';
  if v_url is null or v_key is null then
    raise notice 'tick_reminders: vault secrets functions_url/service_role_key not set; skipping';
    return;
  end if;
  perform net.http_post(
    url     := v_url || '/send-reminders',
    headers := jsonb_build_object('Content-Type', 'application/json', 'Authorization', 'Bearer ' || v_key),
    body    := '{}'::jsonb
  );
end $$;

do $$ begin
  perform cron.unschedule('carecall_reminders');
exception when others then null; end $$;

select cron.schedule('carecall_reminders', '*/5 * * * *', $$select tick_reminders();$$);
