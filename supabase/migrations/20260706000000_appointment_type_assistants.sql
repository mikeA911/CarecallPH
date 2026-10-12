-- CareCall — per-appointment-type Telnyx AI assistants.
--
-- Different appointment types (New Patient, medication reminder, vital-sign
-- reminder, ...) should be handled by different Telnyx AI Assistants, each with
-- its own prompt/voice/tools. This migration:
--   1. Adds a clinic-scoped mapping of appointment_type -> telnyx_assistant_id.
--   2. Persists the resolved assistant on each campaign so a mapping change
--      later never silently re-routes an in-flight campaign.
--
-- The call webhook (telnyx-call-events) reads campaign.telnyx_assistant_id and
-- falls back to the TELNYX_ASSISTANT_ID env default when it is null.

-- ============================================================
-- MAPPING TABLE (clinic_id, appointment_type) -> assistant
-- ============================================================
create table if not exists appointment_type_assistants (
  id uuid primary key default gen_random_uuid(),
  clinic_id uuid not null references clinics(id) on delete cascade,
  appointment_type text not null,          -- matches campaigns.appointment_type
  label text,                              -- human-friendly name for the UI
  telnyx_assistant_id text not null,       -- Telnyx AI Assistant ID for this type
  active boolean not null default true,
  created_at timestamptz not null default now(),
  unique (clinic_id, appointment_type)
);

create index if not exists idx_atassistants_clinic
  on appointment_type_assistants(clinic_id);

alter table appointment_type_assistants enable row level security;

-- Clinic Admin+ manage their own clinic's mappings; Admin sees all.
drop policy if exists atassistants_read  on appointment_type_assistants;
drop policy if exists atassistants_write on appointment_type_assistants;
create policy atassistants_read on appointment_type_assistants for select to authenticated
  using ( is_admin() or clinic_id = jwt_clinic_id() );
create policy atassistants_write on appointment_type_assistants for all to authenticated
  using ( (is_admin() or clinic_id = jwt_clinic_id()) and is_clinic_admin() )
  with check ( (is_admin() or clinic_id = jwt_clinic_id()) and is_clinic_admin() );

-- ============================================================
-- CAMPAIGN: resolved assistant snapshot
-- ============================================================
alter table campaigns
  add column if not exists telnyx_assistant_id text;

-- ============================================================
-- NORMALIZE EXISTING CAMPAIGN TYPES
-- Only the "New Patient" campaign type is live today; migrate every existing
-- campaign to it. Remove/adjust this once additional types go live.
-- ============================================================
update campaigns set appointment_type = 'new_patient'
where appointment_type is distinct from 'new_patient';
