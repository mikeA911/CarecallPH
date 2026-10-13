---
id: privacy-requests
title: Patient privacy requests
summary: Logging and answering a patient's request to see, correct, restrict or erase their data; restricted records; disposal after the retention period.
roles: staff
routes:
  - /patients/:id | staff | Patient detail
  - /settings/clinic | clinic_admin | Clinic settings
updated: 2026-10-13
---

Under the Data Privacy Act a patient can ask to see their data, correct it,
stop its use or have it erased. General information only: the clinic's Data
Protection Officer (DPO) decides each case.

## Logging a request (anyone)

On the patient's page, **Privacy requests → Log a request**. Pick what the
patient asks for, how it came in (in person, chat, phone, email, letter), the
date received and the **answer-by** date (15 days by default; confirm the
period with your DPO). Tick **Identity checked** once you've seen ID or asked
questions only the patient can answer. A clinic admin gets a CC action item.

## Answering (clinic admins)

Click **Handle** on the request.

- **See a copy of their record**: a nurse or doctor clicks **Download record
  (FHIR)**; give the file or a printout to the patient. **Mark completed**
  with what was given.
- **Correct their details**: **Edit details**, or a signed addendum for a
  clinical note (notes are never edited). **Mark completed**.
- **Stop using their data (restrict)**: **Restrict now**. All messages,
  calls, reminders and campaigns stop at once, consents are withdrawn,
  do-not-call is set, and the record becomes **view-only**. **Lift
  restriction** (with a reason) if the patient later asks to resume;
  do-not-call stays on until they agree to be contacted.
- **Delete their data (erase)**: **Review erasure** shows what is deleted now
  (chat links and messages, booking links, campaign and call history with
  transcripts, reminders, symptom checks) and what the clinic must keep
  (appointments, clinical notes, medicines, readings, consents) and until when
  (the retention period after the last consultation). Upcoming appointments
  are cancelled. Type the patient's last name and click **Erase**. It can't be
  undone; the record stays restricted and view-only until it is disposed of.
  Tell the patient what is kept and why.
- **Refuse** with a reason (e.g. identity couldn't be confirmed).

Overdue requests show in red. Clinic settings → Records retention lists all
open requests.

## Disposal

Clinic settings → Records retention → **Due for review** lists records past
the retention period (latest of a visit, note, medicine, dose reply or
reading). **Dispose…** deletes the whole record after typing the last name,
keeps a **disposal record** without personal data (date, counts, note) and
blanks the patient's data in the audit log. Check no law, claim or ongoing
care needs the record first. Nothing is ever deleted automatically.

## Answers to common questions

- "Can we just delete a patient?" Only through erasure and, after the
  retention period, disposal. Medical records must be kept for that period.
- "Why can't I edit this patient?" The record is restricted by a privacy request.
- "Can front desk handle requests?" They log them; a clinic admin answers.
