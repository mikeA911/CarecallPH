---
id: wizard-first-campaign
title: Guided setup - your first campaign
summary: Step-by-step walkthrough from clinic settings to a running campaign; use when a user is new or asks how to get started.
roles: clinic_admin
routes:
  - /settings/clinic | clinic_admin | Clinic settings
  - /clinicians | clinic_admin | Clinicians
  - /patients | staff | Patients
  - /campaigns/new | clinic_admin | New campaign
  - /campaigns | staff | Campaigns
updated: 2026-10-02
---

Guide one step at a time. Offer the navigation button for each step, wait for
the user to say they're done or ask a question, then move on. Skip steps the
user says are already done.

## Steps

1. **Clinic settings** (/settings/clinic): set Display name, Callback phone
   number (mobile or landline, e.g. 0917 123 4567), Timezone `Asia/Manila`,
   and Calling hours. Turn on the
   Pre-call text message with a lead time of about 300 seconds.
2. **Clinicians** (/clinicians): add each clinician and their Weekly
   availability. Without availability nothing can be booked.
3. **Patients** (/patients): import a CSV (first_name, last_name, phone,
   date_of_birth, optional sms_consent). Phones can be 09…, 9… or +639…
   mobiles; the preview flags any it can't read. Check DOBs are right. Start with a small test list, including a staff member's own number.
4. **New campaign** (/campaigns/new): name it, pick the campaign type and
   clinician, write a one-sentence reason, set the slot length, tick the
   patients, and save as draft.
5. **Start** (/campaigns): open the campaign and press **Start calling**
   (within calling hours). Watch the Progress and Patients tab.
6. **Follow up**: check the Review queue daily, and ask CC to analyse the
   campaign after the first batch.
