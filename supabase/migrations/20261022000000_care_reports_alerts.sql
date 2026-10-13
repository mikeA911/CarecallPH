-- Care plans M4: missed-dose and no-reading alerts; clinical action items.
-- Design: docs/care-plan-design.md §7 (4) and §8.
--
-- 1. cc_action_items gets patient_id and clinical. Clinical items (readings,
--    missed doses, no readings) are visible to nurses and doctors only, like
--    the readings themselves; front desk still sees booking items. CC's tools
--    use patient_id to keep patient names away from the model.
-- 2. care_alerts remembers which alerts are raised, so an alert is filed once
--    and again only after the problem has cleared (a dose taken, a reading sent)
--    and come back.

alter table cc_action_items add column if not exists patient_id uuid references patients(id) on delete cascade;
alter table cc_action_items add column if not exists clinical boolean not null default false;
create index if not exists idx_cc_action_items_patient on cc_action_items (patient_id) where patient_id is not null;

-- Existing patient items (route /patients/<uuid>) get their patient; reading
-- items filed by M3 are clinical.
update cc_action_items
   set patient_id = substring(route from '^/patients/([0-9a-fA-F-]{36})$')::uuid
 where patient_id is null and route ~ '^/patients/[0-9a-fA-F-]{36}$'
   and exists (select 1 from patients p where p.id = substring(route from '^/patients/([0-9a-fA-F-]{36})$')::uuid);
update cc_action_items set clinical = true
 where not clinical
   and (title ilike '% out of range: %' or title ilike 'Very high %' or title ilike 'Very low %');

drop policy if exists cc_action_items_read on cc_action_items;
create policy cc_action_items_read on cc_action_items for select to authenticated
  using ( (is_admin() or clinic_id = jwt_clinic_id()) and (not clinical or can_manage_care()) );

drop policy if exists cc_action_items_update on cc_action_items;
create policy cc_action_items_update on cc_action_items for update to authenticated
  using ( (is_admin() or clinic_id = jwt_clinic_id()) and (not clinical or can_manage_care()) )
  with check ( (is_admin() or clinic_id = jwt_clinic_id()) and (not clinical or can_manage_care()) );

create table if not exists care_alerts (
  id uuid primary key default gen_random_uuid(),
  clinic_id uuid not null references clinics(id) on delete cascade,
  patient_id uuid not null references patients(id) on delete cascade,
  kind text not null check (kind in ('missed_doses', 'no_readings')),
  subject_id uuid not null,                 -- the medication or the monitoring plan
  action_item_id uuid references cc_action_items(id) on delete set null,
  raised_at timestamptz not null default now(),
  cleared_at timestamptz
);
-- One open alert per patient, kind and subject.
create unique index if not exists uq_care_alerts_open on care_alerts (patient_id, kind, subject_id) where cleared_at is null;
create index if not exists idx_care_alerts_clinic on care_alerts (clinic_id, raised_at desc);

alter table care_alerts enable row level security;
drop policy if exists care_alerts_read on care_alerts;
create policy care_alerts_read on care_alerts for select to authenticated
  using ( can_manage_care() and (is_admin() or clinic_id = jwt_clinic_id()) );
-- Written only by send-reminders (service role).
