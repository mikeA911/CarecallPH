-- CareCall PH — symptom check, Philippine layer (design §8a, roadmap D1e).
-- Which PH rules raised or annotated each check's result, and the rule-set
-- version, so advice can later be compared with what the doctor found.
alter table symptom_checks
  add column if not exists ph_rules text[],
  add column if not exists ph_rules_version text;

comment on column symptom_checks.ph_rules is 'PH layer rule IDs that fired (e.g. dengue_warning, leptospirosis).';
comment on column symptom_checks.ph_rules_version is 'PH rule-set version used (PH_RULES_VERSION).';
