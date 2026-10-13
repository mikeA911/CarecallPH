---
id: clinical-notes
title: Clinical notes
summary: Doctors dictate or record a consultation (with consent); CC transcribes and drafts a SOAP note; the doctor edits and signs with their password; addenda; who sees notes; retention.
roles: staff
routes:
  - /patients/:id | staff | Patient detail
updated: 2026-10-13
---

On a patient's page, **Clinical notes** shows the notes for each visit. Only
nurses and doctors see this section; front desk never does.

## Writing a note

Click **New note** and choose how to capture it:

- **Dictate**: the doctor speaks the note after (or during) the visit.
- **Record consultation**: records the conversation between doctor and
  patient. Ask the patient first and tick **The patient agreed to recording
  this consultation**; it can't start without that. A red **Recording** dot
  shows while recording.
- **Type**: type or paste notes.

Recording stops at 10 minutes. The recording is sent for transcription and
deleted right after; it is never stored. Check and correct the transcript,
then click **Draft note with CC**. CC organizes it into a SOAP note:
Subjective (complaint, history), Objective (findings, vital signs),
Assessment and Plan. It only uses what was said and lists anything to
**Check before signing** (unclear words, a medicine without a dose).
Medicines mentioned are listed but never ordered: add them under Medicines.

If speech-to-text isn't set up, type or paste the dictation (there is a
sample dictation for demos).

## Signing

Edit the note, then **Sign note** and enter your password (the one you sign
in with): that is your electronic signature, checked again at every signing
so no one else can sign from a computer you left signed in. Doctors only: a
doctor login linked to their clinician record (see Users and roles). Nurses
save drafts for the doctor. Every signature, and every wrong password, is in
the audit log. A signed note can't be changed or deleted; to correct or add
something, use **Add addendum**, which the doctor also signs. The transcript
is deleted when the note is signed.

Signed notes are part of the patient's record and are included in
**Download record (FHIR)**. Drafts are not.

## Records retention

Patient records are kept for a number of years after the last consultation:
7 by default (the DOH records schedule appears to set 7 years for outpatient
records). Platform admins set the default (Global settings) and can set a
different period per clinic. **Clinic settings → Records retention** lists
patients past the period for review, where a clinic admin can dispose of a
record (see Patient privacy requests); nothing is deleted automatically.
