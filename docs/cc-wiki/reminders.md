---
id: reminders
title: Appointment reminders
summary: Chat reminders 24 hours and 2 hours before appointments; patient replies 1 confirm, 2 change time, 3 cancel; where requests show up.
roles: staff
routes:
  - /settings/clinic | clinic_admin | Clinic settings
  - /cc | staff | CC action items
updated: 2026-10-14
---

## What patients get

When **Clinic settings → Appointment reminders** is on, CareCall sends each
patient with a booked appointment a message on their chat app (or SMS, only if
they agreed to texts):

- **24 hours before**: "Reminder from <clinic>: your appointment is tomorrow,
  <day> at <time> with <doctor>. Reply 1 to confirm, 2 to change the time, 3 to
  cancel." with a Filipino line.
- **2 hours before**: "See you soon…" with 2 to change the time or 3 to cancel.

Reminders go out only between 7 AM and 9 PM clinic time. Appointments booked
less than 2 hours before the 24-hour reminder would go (e.g. a same-day booking)
only get the 2-hour one. Patients without a connected chat app (and no SMS
consent) get no reminder; the patient's page says so.

## What the replies do

- **1** (or C, CONFIRM, OO, OK): the appointment becomes **confirmed**.
- **2** (or R, PALIT, CHANGE TIME): the appointment stays booked, and a **CC
  action item** "Wants a new time: <patient>" asks staff to contact them.
- **3** (or X, CANCEL, KANSELA): the appointment is **cancelled**, the time is
  open again, and a CC action item tells staff.

Replies only count for the latest reminder sent in the last 30 hours. Other
messages are handled as usual.

## Where to see it

On the patient's page, **Appointments** shows the status (booked, confirmed,
cancelled) and under it, e.g. "Reminded 24h, 2h · patient confirmed".
Change and cancel requests are in **CC action items**.

## Answers to common questions

- "Why didn't a patient get a reminder?" Reminders must be on in Clinic
  settings, the patient needs a connected chat app (or SMS consent), and the
  appointment must be booked at least 2 hours before the reminder time.
- "Can patients pick a new time themselves by chat?" Not yet; staff contact them.
