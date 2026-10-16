-- Bug reports from pilot users, filed through CC ("report a problem").
-- CC asks what happened, what they expected and the steps, reads the summary
-- back, and files it with the screen they were on. Platform admins work
-- through them on Admin -> Bug reports; reporters can ask CC for the status.
--
-- No patient data: CC is told never to put names, phones or birthdays in a
-- report, and the portal says so. Reports are kept after a user leaves.

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
  admin_note text check (length(admin_note) <= 1000)
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
