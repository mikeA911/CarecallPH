---
id: changelog
title: What's new
summary: Dated list of user-visible changes; read when asked what's new or whether a feature exists.
roles: staff
routes: []
updated: 2026-10-16
---

## 2026-10-16

- **Patient sign-up page**: new patients scan a QR poster at the front desk,
  enter their own details, accept the privacy notice and choose chat messages
  or texts. Those who choose chat connect their app straight away. Turn it on
  in Clinic settings; their page shows **signed up on the clinic's page**.

## 2026-10-13

- **Holidays and closures**: no booking slots on Philippine holidays (choose
  all holidays, regular only, or none) or on the clinic's own closed days, in
  Clinic settings. **Message history**: old messages and call transcripts are
  deleted every night after a set period (365 and 90 days by default).

- **Dictate a monitoring plan**: on a patient's Vital signs, say (or type) the
  plan; CC fills in a draft with only what was said and lists what to check,
  like a missing time or emergency limit. The doctor edits, saves and signs.

- **Patient privacy requests**: log a patient's request to see, correct,
  restrict or erase their data on their page; clinic admins answer it.
  Restriction stops all messages and calls and makes the record view-only;
  erasure also deletes what the clinic needn't keep. Records past the
  retention period can be disposed of from Clinic settings, with a disposal
  record kept.

- **Care plan alerts and reports**: 3 missed medicine reminders in a row, or
  no readings for 3 days, files a CC action item for nurses and doctors (once
  per streak; the patient isn't messaged). Ask CC about adherence, response
  rate, readings waiting and the blood pressure trend; the nightly review
  looks at them too. Action items about readings and medicines are now shown
  to nurses and doctors only.

- **Vital signs by chat** (nurses and doctors): on a patient's page, draft a
  monitoring plan (blood pressure, blood sugar, temperature, weight, oxygen)
  with the doctor's targets, critical limits and what to do if high or low; a
  doctor signs it with their password. After the patient agrees, CareCall asks
  for readings at the plan's times. Out-of-range and critical readings go to
  the new **Readings to review** page; critical ones tell the patient to call
  911 first. Chart per measure; readings in the FHIR record.

- **Nearby care** in the symptom check: nearest emergency rooms on the
  emergency screen; on the result, CareCall clinics near the patient (with
  booking) and other nearby hospitals and doctors. Patients share their
  location or type their town; Telegram users can send their location. Set
  your clinic's location in Clinic settings → **Find on map**.

- **Telegram buttons**: reminders, medicine check-ins, consent requests and
  chat replies now have buttons to tap (Confirm, Change time, Taken, Yes…).
  Typed replies still work on every app.
- **Change the time by chat**: when a patient replies 2 to a reminder, the chat
  offers open times; they pick one and the appointment moves. Staff see it in
  CC action items.

- **Clinical notes** (nurses and doctors): on a patient's page, dictate, record
  a consultation with the patient's agreement, or type; CC transcribes and
  drafts a SOAP note; the doctor edits and signs with their password. Signed
  notes can't be changed; add an addendum.
- **Records retention**: records are kept 7 years after the last consultation
  by default; Clinic settings lists records past the period for review.
- **Patient details for the national format**: middle name, sex, address and
  PhilHealth PIN (**Edit details**), the clinic's DOH facility code, and
  **Download record (FHIR)** for nurses and doctors.
- **Clinical roles** on Users: front desk, nurse / assistant, doctor (linked to
  their clinician record and PRC number). **Platform admin** can be given to
  others by a platform admin.
- **Automatic sign-out** when the browser closes or after 20 minutes without
  activity, with a warning 2 minutes before.
- Fixed: clinic admins can now save **Clinic settings**.

## 2026-10-12

- **Medicine reminders**: on the patient page, add the patient's medicines and
  ask them to agree in the chat; they get reminders at the doctor's times and
  reply 1 taken / 2 skipped. Adherence shows the last 30 days.
- **Appointment reminders**: chat reminders 24 hours and 2 hours before each
  appointment (turn on in Clinic settings). Patients reply 1 to confirm, 2 to
  change the time, 3 to cancel; requests appear in CC action items.
- **Symptom check**: one switch in Clinic settings creates the clinic's link
  and QR code; the CareCall page `/check` lets patients pick a clinic and book.
- **CC** now opens from the CareCall logo at the top of the sidebar; the
  CareCall name next to it opens About. **History** in the CC panel keeps your
  last 20 chats in this browser.
- **Symptom check** (testing only): a public page at the clinic's link (`/check/...`)
  and `/check` in Telegram. Emergency questions first, with a Call 911 screen;
  then how soon to see a doctor and what kind. Turn it on in Clinic settings.

## 2026-10-11

- **Chat campaigns**: on New campaign, choose **Chat message with a booking
  link**. Patients get a booking link on their chat app with one reminder, and
  no calls. Patients without a chat app show as **needs chat invite**.
- **Invite to chat** on a patient's page: a link, QR code and ready-made English
  and Filipino messages. The page also shows **Chat apps** and **Messages**.
- **Clinic settings**: new switches for **Self-booking links in call campaigns**
  and **Chat app invites in text messages**.
- **Mark completed** button on active and paused campaigns.
- **Birthday check in chat apps**: after opening an invite, the patient confirms
  their date of birth before saying YES. Two wrong dates lock the invite.
- **Patients per clinic**: the same person can now be a patient at more than one
  clinic. CSV import reports how many rows were already on file.

## 2026-10-02

- **Philippine phone numbers**: patient mobiles can be entered as 09…, 9… or
  +639… (CSV import and Add patient) and are saved as +639…; invalid numbers
  are rejected with a message. The clinic callback number also accepts landlines.
- **Philippine defaults**: new clinics start on `Asia/Manila` with calling
  hours Mon–Fri 08:00–18:00 and Sat 08:00–12:00. Booking links show
  "Philippine Time (PHT)". Voicemails read the callback number the local way.
- **CC nightly review**: at 2:00 AM Manila time CC reviews running campaigns and
  the Review queue, files up to 5 action items, and posts a summary at the top
  of the CC action items page.

## 2026-10-01

- **CC**, the in-portal assistant, and the **CC action items** page.
- **Chat app reminders**: Viber, Messenger, WhatsApp and Telegram, opt-in by
  invite link, with YES / STOP / BOOK keywords in English, Filipino and Cebuano.
- Messages now go to the patient's chat app when they've opted in, otherwise SMS.

## Earlier

- Self-booking links, pre-call text messages, roles and multi-clinic support,
  AI voice scheduling with identity verification.
