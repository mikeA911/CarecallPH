---
id: reminders
title: Appointment reminders
summary: Chat reminders 24 and 2 hours before appointments; tap or reply 1 confirm, 2 change time (patient picks a new time in the chat), 3 cancel; Telegram buttons.
roles: staff
routes:
  - /settings/clinic | clinic_admin | Clinic settings
  - /cc | staff | CC action items
updated: 2026-10-13
---

## What patients get

When **Clinic settings → Appointment reminders** is on, CareCall sends each
patient with a booked appointment a message on their chat app (or SMS, only if
they agreed to texts):

- **24 hours before**: "Reminder from <clinic>: your appointment is tomorrow,
  <day> at <time> with <doctor>. Reply 1 to confirm, 2 to change the time, 3 to
  cancel." with a Filipino line.
- **2 hours before**: "See you soon…" with 2 to change the time or 3 to cancel.

On **Telegram** the reminder has buttons (**Confirm**, **Change time**,
**Cancel**); tapping one is the same as replying 1, 2 or 3, and the buttons
disappear once tapped. Other chat apps show the same choices as numbers.

Reminders go out only between 7 AM and 9 PM clinic time. Appointments booked
less than 2 hours before the 24-hour reminder would go (e.g. a same-day booking)
only get the 2-hour one. Patients without a connected chat app (and no SMS
consent) get no reminder; the patient's page says so.

## What the replies do

- **1** (or C, CONFIRM, OO, OK): the appointment becomes **confirmed**.
- **2** (or R, PALIT, CHANGE TIME): the chat offers up to six open times with
  the same doctor over the next days (A, B, C… or buttons on Telegram). The
  patient picks one and the appointment **moves** to it; they get reminders for
  the new time and staff get a CC action item "Moved by patient". **None of
  these** (OTHER) asks staff to contact them ("Wants a new time"); **Keep my
  appointment** (KEEP) changes nothing. If no times are open, staff are asked to
  contact them. The old appointment stays booked until a new time is picked.
- **3** (or X, CANCEL, KANSELA): the appointment is **cancelled**, the time is
  open again, and a CC action item tells staff.

Replies only count for the latest reminder sent in the last 30 hours; a pick
from the offered times counts for 24 hours. If someone else books the picked
time first, the patient is offered the remaining times. Other messages are
handled as usual.

## Where to see it

On the patient's page, **Appointments** shows the status (booked, confirmed,
cancelled) and under it, e.g. "Reminded 24h, 2h · patient confirmed" or
"patient moved it in the chat".
Change and cancel requests are in **CC action items**.

## Answers to common questions

- "Why didn't a patient get a reminder?" Reminders must be on in Clinic
  settings, the patient needs a connected chat app (or SMS consent), and the
  appointment must be booked at least 2 hours before the reminder time.
- "Can patients pick a new time themselves by chat?" Yes: they reply 2 (or tap
  **Change time**) and pick from the open times offered.
