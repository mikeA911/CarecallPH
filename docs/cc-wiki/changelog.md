---
id: changelog
title: What's new
summary: Dated list of user-visible changes; read when asked what's new or whether a feature exists.
roles: staff
routes: []
updated: 2026-10-11
---

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
