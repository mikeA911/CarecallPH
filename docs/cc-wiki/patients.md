---
id: patients
title: Patients
summary: Importing patients by CSV, required fields, phone format, consent flags, do-not-call.
roles: staff
routes:
  - /patients | staff | Patients
  - /patients/:id | staff | Patient detail
updated: 2026-10-02
---

## Importing

On **Patients**, use **Import CSV** with the columns
`first_name, last_name, phone, date_of_birth` and optionally
`email, notes, sms_consent`. You get a preview before anything is saved.

- **phone** is the patient's Philippine mobile number. Any of these work:
  `09171234567`, `9171234567`, `+639171234567`; spaces, dashes and brackets
  are ignored (`0917-123-4567`, `+63 (917) 123 4567`). It is saved as
  `+639171234567`. Landlines and non-Philippine numbers are rejected, because
  text messages need a mobile. Rejected rows show the reason in the preview's
  **Issue** column, for example "Invalid phone number "0917123456". Use a PH
  mobile number like 0917 123 4567, 917 123 4567 or +63 917 123 4567." or
  "Only Philippine (+63) numbers are supported."; fix them in the file and import again.
- **date_of_birth** is `YYYY-MM-DD`. It is used to verify identity on calls and
  booking links, so a wrong DOB means the patient fails verification.
- **sms_consent** `true` allows automated text messages. Without it CareCall can
  still call, but won't text.

You can also add one patient at a time with **Or add one patient**. The
**Mobile (09… or +63…)** field accepts the same formats and shows the same
message if the number is invalid.

## Assigning to a campaign

Select patients and use **Assign to campaign**, or pick patients when creating
the campaign.

## Do not call

A patient marked **Do not call** (from the Review queue) is never called or
messaged again by any campaign.

## Chat apps

Patients link Viber, Messenger, WhatsApp or Telegram themselves from an invite
link. See the messaging-channels page.

## Patient detail

Shows the patient's **Call history** across campaigns.
