-- CareCall PH — Phase 0 Philippine defaults.
--
-- New clinics default to Asia/Manila and PH-friendly calling hours:
-- Mon–Fri 08:00–18:00, Sat 08:00–12:00, Sun closed (clinic-local time).
-- Existing clinic rows are left as they are; change them in Clinic settings.
--
-- Phones are normalized to E.164 by the portal and admin-manage
-- (09XX… / 9XX… / +639XX… → +639XXXXXXXXX); see _shared/phone.ts.

alter table clinics
  alter column timezone set default 'Asia/Manila',
  alter column calling_hours set default '{
    "0": null,
    "1": {"start":"08:00","end":"18:00"}, "2": {"start":"08:00","end":"18:00"},
    "3": {"start":"08:00","end":"18:00"}, "4": {"start":"08:00","end":"18:00"},
    "5": {"start":"08:00","end":"18:00"},
    "6": {"start":"08:00","end":"12:00"}
  }'::jsonb;

comment on column clinics.timezone is 'IANA timezone; Asia/Manila for Philippine clinics.';
comment on column clinics.phone_callback is 'E.164, PH mobile (+639XXXXXXXXX) or landline (+632…, +63AA…).';
comment on column patients.phone is 'E.164 PH mobile, e.g. +639171234567.';
