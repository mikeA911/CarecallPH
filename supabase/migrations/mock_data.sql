-- CareCall — mock data for UI testing (dashboard, campaigns, call history).
-- Safe to run on a dev project ONLY. All names/phones/DOBs are fictional;
-- phones use the reserved 555-01xx range so no real number can be dialed.
-- Dates are relative to now() so the data always looks fresh.
-- Re-runnable: uses fixed UUIDs with on-conflict handling.

begin;

-- Every clinic-scoped row must belong to the seed clinic, or the portal
-- (which filters on clinic_id) will not display it.
-- Seed clinic id from 20260705000000_portal_roles.sql:
--   00000000-0000-0000-0000-000000000001

-- ============================================================
-- PROVIDERS (Dr. Jones ships in the base seed; add a second)
-- ============================================================
insert into providers (id, clinic_id, name, specialty) values
  ('22222222-2222-2222-2222-222222222222', '00000000-0000-0000-0000-000000000001', 'Dr. Patel', 'Internal Medicine')
on conflict (id) do nothing;

-- Ensure the base-seed provider (Dr. Jones) is attached to the seed clinic too.
update providers set clinic_id = '00000000-0000-0000-0000-000000000001'
where id = '11111111-1111-1111-1111-111111111111' and clinic_id is null;

insert into provider_availability (provider_id, weekday, start_time, end_time, slot_length_minutes)
select '22222222-2222-2222-2222-222222222222', w, '10:00', '15:00', 30
from (values (1),(4)) as t(w)   -- Mon + Thu
where not exists (
  select 1 from provider_availability
  where provider_id = '22222222-2222-2222-2222-222222222222'
);

-- ============================================================
-- PATIENTS (10)
-- ============================================================
insert into patients (id, clinic_id, first_name, last_name, phone, email, date_of_birth, provider_id, notes) values
  ('a0000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000000001', 'John',    'Smith',    '+639170000001', 'john.smith@example.com',    '1962-03-14', '11111111-1111-1111-1111-111111111111', 'Needs annual wellness visit'),
  ('a0000000-0000-0000-0000-000000000002', '00000000-0000-0000-0000-000000000001', 'Maria',   'Garcia',   '+639170000002', 'maria.garcia@example.com',  '1975-11-02', '11111111-1111-1111-1111-111111111111', null),
  ('a0000000-0000-0000-0000-000000000003', '00000000-0000-0000-0000-000000000001', 'Robert',  'Chen',     '+639170000003', null,                        '1958-07-21', '22222222-2222-2222-2222-222222222222', 'Prefers morning appointments'),
  ('a0000000-0000-0000-0000-000000000004', '00000000-0000-0000-0000-000000000001', 'Linda',   'Johnson',  '+639170000004', 'ljohnson@example.com',      '1949-01-30', '11111111-1111-1111-1111-111111111111', null),
  ('a0000000-0000-0000-0000-000000000005', '00000000-0000-0000-0000-000000000001', 'David',   'Nguyen',   '+639170000005', null,                        '1983-09-05', '22222222-2222-2222-2222-222222222222', null),
  ('a0000000-0000-0000-0000-000000000006', '00000000-0000-0000-0000-000000000001', 'Susan',   'Williams', '+639170000006', 'susanw@example.com',        '1966-05-18', '11111111-1111-1111-1111-111111111111', 'Hard of hearing — speak slowly'),
  ('a0000000-0000-0000-0000-000000000007', '00000000-0000-0000-0000-000000000001', 'James',   'Brown',    '+639170000007', null,                        '1971-12-25', '22222222-2222-2222-2222-222222222222', null),
  ('a0000000-0000-0000-0000-000000000008', '00000000-0000-0000-0000-000000000001', 'Patricia','Miller',   '+639170000008', 'pmiller@example.com',       '1990-04-09', '11111111-1111-1111-1111-111111111111', null),
  ('a0000000-0000-0000-0000-000000000009', '00000000-0000-0000-0000-000000000001', 'Michael', 'Davis',    '+639170000009', null,                        '1955-08-12', '22222222-2222-2222-2222-222222222222', 'New patient'),
  ('a0000000-0000-0000-0000-000000000010', '00000000-0000-0000-0000-000000000001', 'Jennifer','Wilson',   '+639170000010', 'jwilson@example.com',       '1979-02-28', '11111111-1111-1111-1111-111111111111', null)
on conflict (id) do nothing;

-- Backfill in case a prior run inserted these without clinic_id.
update patients set clinic_id = '00000000-0000-0000-0000-000000000001'
where id between 'a0000000-0000-0000-0000-000000000001' and 'a0000000-0000-0000-0000-000000000010'
  and clinic_id is null;

-- Give a couple of mock patients SMS consent so the pre-call text path is
-- exercisable in dev; the rest dial directly (no consent → no text).
update patients set sms_consent = true
where id in (
  'a0000000-0000-0000-0000-000000000001',
  'a0000000-0000-0000-0000-000000000009'
);

-- ============================================================
-- CAMPAIGNS (2 active, 1 older)
-- ============================================================
-- NOTE: after the portal_roles migration, campaigns use `status` (enum), not `active`,
-- and require clinic_id.
-- Only the "New Patient" campaign type is live today, so all mock campaigns
-- use appointment_type = 'new_patient'. Additional types are added later and
-- their Telnyx assistant IDs are configured in Clinic settings.
insert into campaigns (id, clinic_id, name, appointment_type, greeting_context, provider_id, slot_length_minutes, status) values
  ('c0000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000000001', 'Annual Wellness Visits — July', 'new_patient',
   'Dr. Jones would like to schedule your annual wellness visit.',
   '11111111-1111-1111-1111-111111111111', 30, 'active'),
  ('c0000000-0000-0000-0000-000000000002', '00000000-0000-0000-0000-000000000001', 'Flu Vaccination Outreach', 'new_patient',
   'We are scheduling flu vaccination appointments ahead of the season.',
   '22222222-2222-2222-2222-222222222222', 30, 'active'),
  ('c0000000-0000-0000-0000-000000000003', '00000000-0000-0000-0000-000000000001', 'Q2 Follow-up Calls', 'new_patient',
   'The doctor asked us to schedule your follow-up appointment.',
   '11111111-1111-1111-1111-111111111111', 30, 'completed')
on conflict (id) do nothing;

-- Force any pre-existing mock campaigns (from an earlier run with other types)
-- onto the New Patient type as well, since on-conflict above skips updates.
update campaigns set appointment_type = 'new_patient'
where id in (
  'c0000000-0000-0000-0000-000000000001',
  'c0000000-0000-0000-0000-000000000002',
  'c0000000-0000-0000-0000-000000000003'
);

-- ============================================================
-- CAMPAIGN PATIENTS — a realistic spread of every status
-- ============================================================
insert into campaign_patients (campaign_id, patient_id, status, attempts, last_attempt_at, callback_after, flag_reason) values
  -- Wellness campaign
  ('c0000000-0000-0000-0000-000000000001', 'a0000000-0000-0000-0000-000000000001', 'booked',              1, now() - interval '2 hours', null, null),
  ('c0000000-0000-0000-0000-000000000001', 'a0000000-0000-0000-0000-000000000002', 'booked',              1, now() - interval '3 hours', null, null),
  ('c0000000-0000-0000-0000-000000000001', 'a0000000-0000-0000-0000-000000000004', 'declined',            1, now() - interval '5 hours', null, null),
  ('c0000000-0000-0000-0000-000000000001', 'a0000000-0000-0000-0000-000000000006', 'verification_failed', 1, now() - interval '4 hours', null, 'DOB mismatch after retry'),
  ('c0000000-0000-0000-0000-000000000001', 'a0000000-0000-0000-0000-000000000008', 'voicemail',           2, now() - interval '1 hour',  null, null),
  ('c0000000-0000-0000-0000-000000000001', 'a0000000-0000-0000-0000-000000000010', 'callback_requested',  1, now() - interval '6 hours', now() + interval '1 day', null),
  -- Flu campaign
  ('c0000000-0000-0000-0000-000000000002', 'a0000000-0000-0000-0000-000000000003', 'booked',              1, now() - interval '26 hours', null, null),
  ('c0000000-0000-0000-0000-000000000002', 'a0000000-0000-0000-0000-000000000005', 'no_answer',           2, now() - interval '25 hours', null, null),
  ('c0000000-0000-0000-0000-000000000002', 'a0000000-0000-0000-0000-000000000007', 'needs_human',         1, now() - interval '24 hours', null, 'Patient has insurance questions'),
  ('c0000000-0000-0000-0000-000000000002', 'a0000000-0000-0000-0000-000000000009', 'pending',             0, null, null, null),
  -- Old follow-up campaign (completed history)
  ('c0000000-0000-0000-0000-000000000003', 'a0000000-0000-0000-0000-000000000001', 'booked',              1, now() - interval '30 days', null, null),
  ('c0000000-0000-0000-0000-000000000003', 'a0000000-0000-0000-0000-000000000004', 'wrong_number',        1, now() - interval '30 days', null, null)
on conflict (campaign_id, patient_id) do nothing;

-- ============================================================
-- APPOINTMENTS (booked future + completed past; distinct times
-- per provider to satisfy the no-double-booking constraint)
-- ============================================================
insert into appointments (id, patient_id, provider_id, campaign_id, starts_at, ends_at, status, idempotency_key) values
  ('e0000000-0000-0000-0000-000000000001', 'a0000000-0000-0000-0000-000000000001',
   '11111111-1111-1111-1111-111111111111', 'c0000000-0000-0000-0000-000000000001',
   date_trunc('hour', now()) + interval '3 days',  date_trunc('hour', now()) + interval '3 days 30 minutes',  'booked',   'mock-appt-1'),
  ('e0000000-0000-0000-0000-000000000002', 'a0000000-0000-0000-0000-000000000002',
   '11111111-1111-1111-1111-111111111111', 'c0000000-0000-0000-0000-000000000001',
   date_trunc('hour', now()) + interval '4 days',  date_trunc('hour', now()) + interval '4 days 30 minutes',  'booked',   'mock-appt-2'),
  ('e0000000-0000-0000-0000-000000000003', 'a0000000-0000-0000-0000-000000000003',
   '22222222-2222-2222-2222-222222222222', 'c0000000-0000-0000-0000-000000000002',
   date_trunc('hour', now()) + interval '5 days',  date_trunc('hour', now()) + interval '5 days 30 minutes',  'booked',   'mock-appt-3'),
  ('e0000000-0000-0000-0000-000000000004', 'a0000000-0000-0000-0000-000000000001',
   '11111111-1111-1111-1111-111111111111', 'c0000000-0000-0000-0000-000000000003',
   now() - interval '25 days', now() - interval '25 days' + interval '30 minutes', 'completed', 'mock-appt-4')
on conflict (id) do nothing;

-- ============================================================
-- CALL LOGS — what Call History renders: AMD results, verification,
-- durations, transcripts, summaries, every outcome type
-- ============================================================
insert into call_logs (id, call_control_id, patient_id, campaign_id, started_at, ended_at,
                       duration_seconds, amd_result, verification_attempts, verified,
                       result, transcript, summary, appointment_id) values
  -- 1. Successful booking (John Smith)
  ('f0000000-0000-0000-0000-000000000001', 'mock-ccid-001',
   'a0000000-0000-0000-0000-000000000001', 'c0000000-0000-0000-0000-000000000001',
   now() - interval '2 hours', now() - interval '2 hours' + interval '3 minutes 12 seconds',
   192, 'human', 1, true, 'booked',
   '[{"role":"assistant","content":"Hello, this is Sarah calling on behalf of River Valley Family Clinic. Am I speaking with John?"},
     {"role":"user","content":"Yes, this is John."},
     {"role":"assistant","content":"Before we continue, for your privacy I just need to verify your identity. Could you please tell me your date of birth?"},
     {"role":"user","content":"March 14th, 1962."},
     {"role":"assistant","content":"Thank you. Dr. Jones would like to schedule your annual wellness visit. Is there a day of the week that generally works best for you?"},
     {"role":"user","content":"Tuesdays are usually good."},
     {"role":"assistant","content":"I have Tuesday the 7th at 9:00 AM, 9:30 AM, or 10:00 AM. Would any of those work?"},
     {"role":"user","content":"10 AM works."},
     {"role":"assistant","content":"Just to confirm, that''s Tuesday, July 7th at 10:00 AM with Dr. Jones. Shall I book that for you?"},
     {"role":"user","content":"Yes please."},
     {"role":"assistant","content":"You''re all set. You''ll receive a text reminder before your visit."}]'::jsonb,
   'Identity verified on first attempt. Patient booked annual wellness visit for Tuesday 10:00 AM with Dr. Jones. Friendly call, no issues.',
   'e0000000-0000-0000-0000-000000000001'),

  -- 2. Successful booking (Maria Garcia)
  ('f0000000-0000-0000-0000-000000000002', 'mock-ccid-002',
   'a0000000-0000-0000-0000-000000000002', 'c0000000-0000-0000-0000-000000000001',
   now() - interval '3 hours', now() - interval '3 hours' + interval '2 minutes 45 seconds',
   165, 'human', 1, true, 'booked',
   '[{"role":"assistant","content":"Hello, this is Sarah calling on behalf of River Valley Family Clinic. Am I speaking with Maria?"},
     {"role":"user","content":"Speaking."},
     {"role":"assistant","content":"Could you please tell me your date of birth to verify your identity?"},
     {"role":"user","content":"November 2nd, 1975."},
     {"role":"assistant","content":"Thank you. We''d like to schedule your annual wellness visit. What day works best?"},
     {"role":"user","content":"Wednesday afternoon?"},
     {"role":"assistant","content":"I have Wednesday at 1:00 PM, 1:30 PM, or 2:00 PM."},
     {"role":"user","content":"1:30."},
     {"role":"assistant","content":"Confirming Wednesday at 1:30 PM with Dr. Jones — shall I book it?"},
     {"role":"user","content":"Yes."}]'::jsonb,
   'Verified, booked Wednesday 1:30 PM wellness visit. Quick, cooperative call.',
   'e0000000-0000-0000-0000-000000000002'),

  -- 3. Declined (Linda Johnson)
  ('f0000000-0000-0000-0000-000000000003', 'mock-ccid-003',
   'a0000000-0000-0000-0000-000000000004', 'c0000000-0000-0000-0000-000000000001',
   now() - interval '5 hours', now() - interval '5 hours' + interval '1 minute 58 seconds',
   118, 'human', 1, true, 'declined',
   '[{"role":"assistant","content":"Hello, this is Sarah calling on behalf of River Valley Family Clinic. Am I speaking with Linda?"},
     {"role":"user","content":"Yes."},
     {"role":"assistant","content":"Could you verify your date of birth for me?"},
     {"role":"user","content":"January 30th, 1949."},
     {"role":"assistant","content":"Thank you. We''re calling to schedule your annual wellness visit."},
     {"role":"user","content":"I already saw a doctor at another clinic last month. I don''t need this."},
     {"role":"assistant","content":"No problem at all. Would it be alright if we call you back another time?"},
     {"role":"user","content":"No, please don''t call again about this."},
     {"role":"assistant","content":"Understood, I''ve noted that. Thank you for your time, Linda."}]'::jsonb,
   'Patient declined — already received care elsewhere. Asked not to be called again for this campaign.', null),

  -- 4. Verification failed (Susan Williams)
  ('f0000000-0000-0000-0000-000000000004', 'mock-ccid-004',
   'a0000000-0000-0000-0000-000000000006', 'c0000000-0000-0000-0000-000000000001',
   now() - interval '4 hours', now() - interval '4 hours' + interval '2 minutes 20 seconds',
   140, 'human', 2, false, 'verification_failed',
   '[{"role":"assistant","content":"Hello, this is Sarah calling on behalf of River Valley Family Clinic. Am I speaking with Susan?"},
     {"role":"user","content":"Yes, who is this?"},
     {"role":"assistant","content":"This is Sarah from River Valley Family Clinic. For your privacy, could you verify your date of birth?"},
     {"role":"user","content":"Um, May 8th, 1966."},
     {"role":"assistant","content":"I''m sorry, that doesn''t match what we have on file. Could you repeat it once more?"},
     {"role":"user","content":"May 8th... or maybe the 18th? 1966."},
     {"role":"assistant","content":"I''m sorry, I''m not able to verify your identity over this call. Someone from our office will follow up with you directly. Thank you, and have a good day."}]'::jsonb,
   'Identity verification failed after retry. Flagged for human follow-up. No appointment details discussed.', null),

  -- 5. Voicemail (Patricia Miller) — AI never started
  ('f0000000-0000-0000-0000-000000000005', 'mock-ccid-005',
   'a0000000-0000-0000-0000-000000000008', 'c0000000-0000-0000-0000-000000000001',
   now() - interval '1 hour', now() - interval '1 hour' + interval '38 seconds',
   38, 'machine', 0, false, 'voicemail', null,
   null, null),

  -- 6. Callback requested (Jennifer Wilson)
  ('f0000000-0000-0000-0000-000000000006', 'mock-ccid-006',
   'a0000000-0000-0000-0000-000000000010', 'c0000000-0000-0000-0000-000000000001',
   now() - interval '6 hours', now() - interval '6 hours' + interval '2 minutes 5 seconds',
   125, 'human', 1, true, 'callback_requested',
   '[{"role":"assistant","content":"Hello, this is Sarah calling on behalf of River Valley Family Clinic. Am I speaking with Jennifer?"},
     {"role":"user","content":"Yes, but I''m at work right now."},
     {"role":"assistant","content":"I completely understand. Would it be alright if we call you back another day?"},
     {"role":"user","content":"Sure, tomorrow evening is better."},
     {"role":"assistant","content":"We''ll call you back then. Thank you, Jennifer!"}]'::jsonb,
   'Patient at work, requested callback tomorrow evening. Identity was confirmed by name only; full verification deferred to callback.', null),

  -- 7. Booked (Robert Chen, flu campaign)
  ('f0000000-0000-0000-0000-000000000007', 'mock-ccid-007',
   'a0000000-0000-0000-0000-000000000003', 'c0000000-0000-0000-0000-000000000002',
   now() - interval '26 hours', now() - interval '26 hours' + interval '3 minutes 40 seconds',
   220, 'human', 1, true, 'booked',
   '[{"role":"assistant","content":"Hello, this is Sarah calling on behalf of River Valley Family Clinic. Am I speaking with Robert?"},
     {"role":"user","content":"Yes."},
     {"role":"assistant","content":"Could you verify your date of birth?"},
     {"role":"user","content":"July 21, 1958."},
     {"role":"assistant","content":"Thank you. We''re scheduling flu vaccination appointments ahead of the season. What day works for you?"},
     {"role":"user","content":"Mornings are best. Maybe Monday?"},
     {"role":"assistant","content":"I have Monday at 10:00 AM, 10:30 AM, or 11:00 AM with Dr. Patel."},
     {"role":"user","content":"10 AM."},
     {"role":"assistant","content":"Confirming Monday at 10:00 AM — shall I book it?"},
     {"role":"user","content":"Yes, thank you."}]'::jsonb,
   'Verified, booked flu shot Monday 10:00 AM with Dr. Patel. Patient noted preference for mornings.',
   'e0000000-0000-0000-0000-000000000003'),

  -- 8. No answer (David Nguyen)
  ('f0000000-0000-0000-0000-000000000008', 'mock-ccid-008',
   'a0000000-0000-0000-0000-000000000005', 'c0000000-0000-0000-0000-000000000002',
   now() - interval '25 hours', now() - interval '25 hours' + interval '30 seconds',
   30, null, 0, false, 'no_answer', null, null, null),

  -- 9. Escalation / needs human (James Brown)
  ('f0000000-0000-0000-0000-000000000009', 'mock-ccid-009',
   'a0000000-0000-0000-0000-000000000007', 'c0000000-0000-0000-0000-000000000002',
   now() - interval '24 hours', now() - interval '24 hours' + interval '4 minutes 2 seconds',
   242, 'human', 1, true, 'transferred',
   '[{"role":"assistant","content":"Hello, this is Sarah calling on behalf of River Valley Family Clinic. Am I speaking with James?"},
     {"role":"user","content":"Yeah."},
     {"role":"assistant","content":"Could you verify your date of birth?"},
     {"role":"user","content":"December 25th, 1971."},
     {"role":"assistant","content":"Thank you. We''re scheduling flu vaccination appointments. What day works for you?"},
     {"role":"user","content":"Before I book anything — does my insurance cover this? I switched plans last month."},
     {"role":"assistant","content":"That''s a great question, and a staff member is better suited to help with insurance. I''ve noted your question and someone from our office will follow up with you."},
     {"role":"user","content":"Okay, have them call me."}]'::jsonb,
   'Patient verified but has insurance coverage questions after switching plans. Needs staff follow-up before booking.', null),

  -- 10. Wrong number (old follow-up campaign)
  ('f0000000-0000-0000-0000-000000000010', 'mock-ccid-010',
   'a0000000-0000-0000-0000-000000000004', 'c0000000-0000-0000-0000-000000000003',
   now() - interval '30 days', now() - interval '30 days' + interval '45 seconds',
   45, 'human', 0, false, 'wrong_number',
   '[{"role":"assistant","content":"Hello, this is Sarah calling on behalf of River Valley Family Clinic. Am I speaking with Linda?"},
     {"role":"user","content":"No, there''s no Linda here. You have the wrong number."},
     {"role":"assistant","content":"I apologize for the inconvenience. Thank you, and have a good day."}]'::jsonb,
   'Wrong number — no Linda at this line. Flagged for record correction.', null)
on conflict (id) do nothing;

-- call_logs.clinic_id is nullable in the schema, but the portal filters on it,
-- so stamp every mock call with the seed clinic.
update call_logs
   set clinic_id = '00000000-0000-0000-0000-000000000001'
 where id in (
   'f0000000-0000-0000-0000-000000000001','f0000000-0000-0000-0000-000000000002',
   'f0000000-0000-0000-0000-000000000003','f0000000-0000-0000-0000-000000000004',
   'f0000000-0000-0000-0000-000000000005','f0000000-0000-0000-0000-000000000006',
   'f0000000-0000-0000-0000-000000000007','f0000000-0000-0000-0000-000000000008',
   'f0000000-0000-0000-0000-000000000009','f0000000-0000-0000-0000-000000000010'
 );

commit;

-- Quick checks after running:
-- select * from campaign_stats;
-- select result, count(*) from call_logs group by 1;
