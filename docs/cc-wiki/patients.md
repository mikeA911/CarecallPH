---
id: patients
title: Patients
summary: Importing by CSV, phone format, editing details (middle name, sex, address, PhilHealth PIN), consent, do-not-call, chat invites, messages, self sign-up, downloading the record (FHIR).
roles: staff
routes:
  - /patients | staff | Patients
  - /patients/:id | staff | Patient detail
updated: 2026-10-16
---

## Importing

On **Patients**, use **Import CSV** with the columns
`first_name, last_name, phone, date_of_birth` and optionally
`email, notes, sms_consent`. You get a preview before anything is saved.

- **phone** is the patient's Philippine mobile number. Any of these work:
  `09171234567`, `9171234567`, `+639171234567`; spaces, dashes and brackets
  are ignored (`0917-123-4567`, `+63 (917) 123 4567`). It is saved as
  `+639171234567`. Landlines are rejected, because text messages need a mobile.
  For testing, numbers from other countries are currently accepted too when
  written with + and the country code (e.g. `+1 415 555 0100` or `+65 9123 4567`); Philippine
  numbers are still required for the pilot. Rejected rows show the reason in the preview's
  **Issue** column, for example "Invalid phone number "0917123456". Use a PH
  mobile number like 0917 123 4567, 917 123 4567 or +63 917 123 4567." or
  "Only Philippine (+63) numbers are supported."; fix them in the file and import again.
- **date_of_birth** is `YYYY-MM-DD`. It is used to verify identity on calls and
  booking links, so a wrong DOB means the patient fails verification.
- **sms_consent** `true` allows automated text messages. Without it CareCall can
  still call, but won't text.

You can also add one patient at a time with **Or add one patient**. The
**Mobile** field (09…, +63… or +country code…) accepts the same formats and shows the same
message if the number is invalid.

A patient is identified by mobile number plus date of birth **within your
clinic**. Import skips rows already on file and says how many; the same person
can also be a patient at another clinic.

## Assigning to a campaign

Select patients and use **Assign to campaign**, or pick patients when creating
the campaign.

## Do not call

A patient marked **Do not call** (from the Review queue) is never called or
messaged again by any campaign.

## Patients signing themselves up

With **Patient sign-up page** on (Clinic settings), new patients scan the
clinic's QR poster at the front desk and register themselves:

1. They enter first and last name, mobile and date of birth.
2. They read the privacy notice and tick that they agree (required), and can
   tick **chat app** messages and **text messages** (both optional, unticked).
3. A new patient appears in **Patients** with the badge **signed up on the
   clinic's page**; the patient page shows when they accepted the privacy
   notice and which version. Text messages are allowed only if they ticked it.
4. If they ticked chat, they tap their chat app right away and reply **YES**.
   The chat doesn't ask for their birthday: they just typed it.

Check the details against an ID at the desk and fix any typo with **Edit
details**. Someone already on file (same mobile and date of birth) is never
changed; the page asks them to see the front desk, who use **Invite to chat**.
That way nobody can connect a chat to an existing patient from outside the
clinic.

## Chat apps

Patients link Viber, Messenger, WhatsApp or Telegram themselves from an invite
link. On the patient's page, **Invite to chat** creates one (valid 30 days) with
a QR code and ready-made messages in English and Filipino to copy and send from
the clinic's phone. It isn't available for inactive or do-not-call patients.
See the messaging-channels page.

## Patient detail

**Edit details** (clinic admins): first, middle and last name, sex, email,
PhilHealth PIN (12 digits, `nn-nnnnnnnnn-n`) and address (house/street,
barangay, city or municipality, province, postal code). All optional except
the names. These are the details the national health data standard expects.

**Download record (FHIR)** (nurses and doctors): saves the patient's record as a
file in FHIR R4, the format of the Philippine health data standard (PH Core):
details, clinic, clinicians, appointments, medicines, the doses they reported
taking or skipping, and consents. Use it to send a record to another clinic or
hospital system. Every download is recorded in the audit log. Treat the file
like a paper chart: share it only with the patient's permission.

Shows the patient's details, **Medicines** (medicine reminders by chat, with
consent and adherence; see the medicine reminders page), **Chat apps** (each app, when they connected, when
they said YES, and a status: Waiting for birthday, Birthday didn't match, Waiting
for YES, Active or Stopped messages), the
last 20 **Messages** sent and received, their **Appointments** (when, clinician,
how it was booked: AI call, booking link or symptom check, status, and
reminders sent and the patient's answer), and
their **Call history** across campaigns. A booking from the symptom check also
shows what the patient shared: urgency, kind of doctor, symptoms and any
Philippine warnings to watch for.
