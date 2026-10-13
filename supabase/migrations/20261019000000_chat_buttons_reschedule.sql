-- Telegram buttons and changing an appointment time by chat.
--
-- Reminders are now recorded per appointment TIME (for_starts_at), so an
-- appointment moved by chat gets fresh 24 h / 2 h reminders for its new time
-- while the history of the old ones stays.
--
-- When a patient answers a reminder with "change time", the chat offers up to
-- six open times (offered_slots). The patient picks one (button, or letter
-- A–F); the appointment moves to it. OTHER asks the clinic to call; KEEP
-- leaves the appointment as it is.

alter table appointment_reminders add column if not exists for_starts_at timestamptz;
update appointment_reminders r set for_starts_at = a.starts_at
  from appointments a where a.id = r.appointment_id and r.for_starts_at is null;

alter table appointment_reminders drop constraint if exists appointment_reminders_appointment_id_kind_key;
create unique index if not exists uq_appointment_reminders_time
  on appointment_reminders (appointment_id, kind, for_starts_at);

alter table appointment_reminders add column if not exists offered_slots jsonb;   -- [{start, end}]
alter table appointment_reminders add column if not exists offered_at timestamptz;
alter table appointment_reminders add column if not exists offer_closed_at timestamptz;
alter table appointment_reminders add column if not exists rescheduled_to timestamptz;

-- Appointments moved by the patient in the chat.
alter table appointments add column if not exists rescheduled_at timestamptz;
