-- Bug reports from pilot users, filed through CC ("report a problem").
-- CC asks what happened, what they expected and the steps, reads the summary
-- back, and files it with the screen they were on. Platform admins work
-- through them on Admin -> Bug reports; reporters can ask CC for the status.
--
-- No patient data: CC is told never to put names, phones or birthdays in a
-- report, and the portal says so. Reports are kept after a user leaves.
--
-- Attached automatically: `diagnostics`, the page's recent errors and failed
-- requests (paths and codes only, numbers scrubbed by the portal and again by
-- cc-chat). Optional: a screenshot of the page, patient details blurred unless
-- the reporter chose otherwise; kept 90 days, platform admins only.

create table if not exists bug_reports (
  id bigint generated always as identity primary key,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  clinic_id uuid references clinics(id) on delete set null,
  reported_by uuid references auth.users(id) on delete set null,
  reporter_email text,
  route text,
  summary text not null check (length(summary) between 3 and 140),
  what_happened text not null check (length(what_happened) <= 2000),
  expected text check (length(expected) <= 1000),
  steps text check (length(steps) <= 2000),
  severity text not null check (severity in ('blocker', 'problem', 'annoyance')),
  status text not null default 'new' check (status in ('new', 'seen', 'fixed', 'wont_fix')),
  admin_note text check (length(admin_note) <= 1000),
  diagnostics jsonb check (diagnostics is null or length(diagnostics::text) <= 20000)
);

create index if not exists idx_bug_reports_status on bug_reports (status, created_at desc);
create index if not exists idx_bug_reports_reporter on bug_reports (reported_by, created_at desc);

comment on table bug_reports is
  'Problems reported by portal users through CC. Never patient data. Platform admins triage them.';

-- Who and where come from the session, never from what the client sends.
create or replace function fn_bug_report_defaults() returns trigger
language plpgsql as $$
declare
  v_claims jsonb := nullif(current_setting('request.jwt.claims', true), '')::jsonb;
begin
  if tg_op = 'INSERT' then
    new.reported_by := (v_claims ->> 'sub')::uuid;
    new.reporter_email := v_claims ->> 'email';
    new.status := 'new';
    new.admin_note := null;
    if not is_admin() then new.clinic_id := jwt_clinic_id(); end if;
  else
    -- Only triage fields change after filing.
    new.reported_by := old.reported_by;  new.reporter_email := old.reporter_email;
    new.clinic_id := old.clinic_id;      new.route := old.route;
    new.summary := old.summary;          new.what_happened := old.what_happened;
    new.expected := old.expected;        new.steps := old.steps;
    new.severity := old.severity;        new.created_at := old.created_at;
    new.diagnostics := old.diagnostics;
    new.updated_at := now();
  end if;
  return new;
end $$;

drop trigger if exists trg_bug_report_defaults on bug_reports;
create trigger trg_bug_report_defaults before insert or update on bug_reports
  for each row execute function fn_bug_report_defaults();

alter table bug_reports enable row level security;

drop policy if exists bug_reports_insert on bug_reports;
create policy bug_reports_insert on bug_reports for insert to authenticated
  with check (true);  -- the trigger fixes reporter and clinic

drop policy if exists bug_reports_select on bug_reports;
create policy bug_reports_select on bug_reports for select to authenticated
  using (is_admin() or reported_by = auth.uid());

drop policy if exists bug_reports_update on bug_reports;
create policy bug_reports_update on bug_reports for update to authenticated
  using (is_admin()) with check (is_admin());

grant select, insert, update on bug_reports to authenticated;

-- ------------------------------------------------------------------
-- Screenshots: the reporter adds up to 3 within an hour of filing; only
-- platform admins can see them; deleted after 90 days.
-- ------------------------------------------------------------------
create table if not exists bug_report_screenshots (
  id bigint generated always as identity primary key,
  report_id bigint not null references bug_reports(id) on delete cascade,
  created_at timestamptz not null default now(),
  masked boolean not null default true,
  image text not null check (image like 'data:image/jpeg;base64,%' and length(image) <= 3000000)
);

create index if not exists idx_bug_report_screenshots_report on bug_report_screenshots (report_id);

comment on column bug_report_screenshots.masked is
  'true = patient details were blurred on the page before capture; false = the reporter chose to show them.';

-- The insert check needs the reporter's own report and a count of its
-- screenshots, which RLS would hide from the reporter: read them here.
create or replace function can_add_bug_screenshot(p_report bigint) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from bug_reports r
    where r.id = p_report and r.reported_by = auth.uid() and r.created_at > now() - interval '1 hour')
  and (select count(*) from bug_report_screenshots s where s.report_id = p_report) < 3;
$$;
revoke all on function can_add_bug_screenshot(bigint) from public, anon;
grant execute on function can_add_bug_screenshot(bigint) to authenticated;

alter table bug_report_screenshots enable row level security;

drop policy if exists bug_screens_insert on bug_report_screenshots;
create policy bug_screens_insert on bug_report_screenshots for insert to authenticated
  with check (can_add_bug_screenshot(report_id));

drop policy if exists bug_screens_select on bug_report_screenshots;
create policy bug_screens_select on bug_report_screenshots for select to authenticated
  using (is_admin());

drop policy if exists bug_screens_delete on bug_report_screenshots;
create policy bug_screens_delete on bug_report_screenshots for delete to authenticated
  using (is_admin());

grant select, insert, delete on bug_report_screenshots to authenticated;

create or replace function purge_bug_screenshots() returns int
language sql security definer set search_path = public as $$
  with gone as (delete from bug_report_screenshots where created_at < now() - interval '90 days' returning 1)
  select count(*)::int from gone;
$$;
revoke execute on function purge_bug_screenshots() from public, anon, authenticated;

do $$ begin
  perform cron.unschedule('carecall_bug_screenshot_purge');
exception when others then null; end $$;
-- 03:50 Manila.
do $$ begin
  perform cron.schedule('carecall_bug_screenshot_purge', '50 19 * * *', $cron$select purge_bug_screenshots();$cron$);
exception when undefined_function or invalid_schema_name then
  raise notice 'pg_cron not available: schedule purge_bug_screenshots() yourself';
end $$;
