-- CareCall PH — CC nightly review.
--
-- Every night at 02:00 Asia/Manila (18:00 UTC), pg_cron posts one request per
-- enabled clinic to the cc-nightly edge function. CC reviews that clinic's
-- campaigns and Review queue, files action items (source = 'nightly'), and
-- saves a short summary in cc_reviews, shown at the top of the CC action items page.
--
-- Uses the same Vault secrets as tick_active_campaigns (functions_url,
-- service_role_key). Written idempotently.

-- Where an action item came from: interactive chat or the nightly job.
alter table cc_action_items
  add column if not exists source text not null default 'chat'
    check (source in ('chat', 'nightly'));

-- Per-clinic switch (default on).
alter table clinics
  add column if not exists cc_nightly_enabled boolean not null default true;

create table if not exists cc_reviews (
  id uuid primary key default uuid_generate_v4(),
  clinic_id uuid not null references clinics(id) on delete cascade,
  run_at timestamptz not null default now(),
  status text not null check (status in ('ok', 'skipped', 'error')),
  summary text,
  items_created int not null default 0,
  tool_calls int not null default 0,
  input_tokens int not null default 0,
  output_tokens int not null default 0,
  model text,
  wiki_version text,
  error text
);

create index if not exists idx_cc_reviews_clinic on cc_reviews (clinic_id, run_at desc);

alter table cc_reviews enable row level security;

drop policy if exists cc_reviews_read on cc_reviews;
create policy cc_reviews_read on cc_reviews for select to authenticated
  using ( is_admin() or clinic_id = jwt_clinic_id() );

-- One HTTP request per enabled, active clinic. pg_net requests run
-- asynchronously, so clinics are reviewed in parallel.
create or replace function cc_nightly_review()
returns void
language plpgsql
security definer as $$
declare
  v_url text;
  v_key text;
  v_clinic record;
begin
  select decrypted_secret into v_url
    from vault.decrypted_secrets where name = 'functions_url';
  select decrypted_secret into v_key
    from vault.decrypted_secrets where name = 'service_role_key';

  if v_url is null or v_key is null then
    raise notice 'cc_nightly_review: vault secrets functions_url/service_role_key not set; skipping';
    return;
  end if;

  for v_clinic in
    select id from clinics where active and cc_nightly_enabled
  loop
    perform net.http_post(
      url     := v_url || '/cc-nightly',
      headers := jsonb_build_object(
        'Content-Type', 'application/json',
        'Authorization', 'Bearer ' || v_key
      ),
      body    := jsonb_build_object('clinic_id', v_clinic.id),
      timeout_milliseconds := 150000
    );
  end loop;
end $$;

do $$ begin
  perform cron.unschedule('carecall_cc_nightly');
exception when others then null; end $$;

-- 18:00 UTC = 02:00 Asia/Manila (no DST in the Philippines).
select cron.schedule('carecall_cc_nightly', '0 18 * * *', $$select cc_nightly_review();$$);
