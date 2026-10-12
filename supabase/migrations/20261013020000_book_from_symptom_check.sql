-- CareCall PH — book from the symptom check result (Discover slice D1c).
--
-- appointments.intake: what the patient agreed to share with the clinic when
-- booking from a symptom check (urgency, kind of doctor, symptom names, PH
-- warnings). It belongs to the clinic's record of the visit, so it is kept
-- with the appointment; symptom_checks itself stays minimal and is deleted
-- after 90 days. Readable by clinic staff under the existing appointments RLS.
alter table appointments
  add column if not exists intake jsonb;

comment on column appointments.intake is
  'Symptom check summary shared by the patient when booking: urgency, specialty, symptoms, PH warnings.';
