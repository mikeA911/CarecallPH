-- FHIR-ready records, slice F1 (docs/fhir-design.md): the fields FHIR R4 and
-- the Philippine profiles (PH Core) expect, collected from now on. All
-- optional. The FHIR export itself is the `fhir` edge function.

-- Patients: Filipino middle name, administrative sex, address, PhilHealth PIN.
alter table patients add column if not exists middle_name text;
alter table patients add column if not exists sex text
  check (sex in ('male', 'female', 'other', 'unknown'));
alter table patients add column if not exists address_line text;       -- house / street / building
alter table patients add column if not exists barangay text;
alter table patients add column if not exists city_municipality text;
alter table patients add column if not exists province text;
alter table patients add column if not exists postal_code text;
-- 12 digits, no dashes (shown as nn-nnnnnnnnn-n).
alter table patients add column if not exists philhealth_id text
  check (philhealth_id ~ '^[0-9]{12}$');

-- Clinics: DOH National Health Facility Registry code and address.
alter table clinics add column if not exists nhfr_code text;
alter table clinics add column if not exists address_line text;
alter table clinics add column if not exists barangay text;
alter table clinics add column if not exists city_municipality text;
alter table clinics add column if not exists province text;
alter table clinics add column if not exists postal_code text;
