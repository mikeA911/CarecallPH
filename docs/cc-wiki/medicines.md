---
id: medicines
title: Medicine reminders
summary: Adding a patient's medicines, asking for consent in the chat, the reminder messages, 1 taken / 2 skipped, missed doses, adherence, STOP REMINDERS.
roles: staff
routes:
  - /patients/:id | staff | Patient detail
updated: 2026-10-15
---

## Setting it up (patient page → Medicines)

1. The patient must be connected to a chat app (Chat apps → **Invite to chat**).
2. Click **Ask patient to agree**. The patient gets a message in English and
   Filipino explaining: reminders at the times the doctor set, that their
   replies are saved in their record at the clinic, that they can stop any time
   with STOP REMINDERS, and to call 911 in an emergency. They reply **YES** (OO)
   or **NO** (HINDI). The status shows "Waiting for the patient's answer",
   "Agreed in the chat on <date>", "Declined", or "No answer" after 3 days.
3. **Add medicine**: enter exactly what the doctor prescribed: medicine
   (generic name, brand optional), dose, instructions (optional), reminder
   times (up to 6 a day, between 5 AM and 11 PM), start and end dates.
   **Discreet** leaves the medicine name out of chat messages, for shared phones.

Nothing is sent until the patient says YES. CareCall never changes doses or
gives medical advice.

## What the patient gets

At each time: "💊 8:00 AM: time for your medicine. • Amlodipine, 5 mg, 1 tablet.
Reply 1 when taken, 2 if you skipped it." with a Filipino line. Medicines due
at the same time come in one message.

- **1** (taken, OO, NAINOM): marked taken.
- **2** (skip, HINDI): marked skipped; the patient is told to mention problems to the clinic.
- No answer within 2 hours: **missed**.
- **STOP REMINDERS** (or TIGIL PAALALA): reminders stop. Staff can also click
  **Stop reminders**. The medicine list and history stay in the record.

## Adherence

**Last 30 days** shows, per medicine, how many answered or missed reminders
were taken, e.g. "26 of 30 taken". **Stop** on a medicine ends its reminders.

## Answers to common questions

- "Why didn't a reminder go out?" The patient must have agreed (YES), be
  connected to a chat app, and the medicine must be active and within its dates.
- "Can the doctor write the prescription in CareCall?" Coming next (Phase M2):
  the signed prescription will fill in the medicines automatically.
- "Can patients send blood pressure readings?" Coming in Phase M3, with a
  monitoring plan the doctor signs.
