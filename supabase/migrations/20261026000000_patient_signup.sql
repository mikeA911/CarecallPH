-- Patient sign-up page: a new patient at the clinic scans the clinic's QR
-- poster (/join/<public_slug>), enters her own details, accepts the privacy
-- notice and chooses chat and text messages. The patient-signup function
-- creates her record; a new record gets a chat invite that skips the
-- birthday question, because she has just typed it herself.
--
--   clinics.signup_enabled           — show the sign-up page for this clinic
--   patients.signed_up_at            — record created by the patient on the sign-up page
--   patients.privacy_notice_version  — the notice she accepted (wording version)
--   patients.privacy_notice_accepted_at
--   channel_invites.verified         — identity already confirmed (sign-up page);
--                                      the chat asks only for YES

alter table clinics
  add column if not exists signup_enabled boolean not null default false;

comment on column clinics.signup_enabled is
  'Patients can register themselves at /join/<public_slug> (QR poster at the front desk).';

alter table patients
  add column if not exists signed_up_at timestamptz,
  add column if not exists privacy_notice_version text,
  add column if not exists privacy_notice_accepted_at timestamptz;

comment on column patients.signed_up_at is
  'Set when the patient created this record on the clinic''s sign-up page; staff check her ID at the desk.';

alter table channel_invites
  add column if not exists verified boolean not null default false;

comment on column channel_invites.verified is
  'Issued to the person who just created the record on the sign-up page: the chat skips the birthday check.';
