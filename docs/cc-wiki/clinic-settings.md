---
id: clinic-settings
title: Clinic settings
summary: Display name, callback number, timezone, calling hours, greeting, pre-call message and lead time, campaign types.
roles: clinic_admin
routes:
  - /settings/clinic | clinic_admin | Clinic settings
updated: 2026-10-01
---

- **Display name**: how the clinic is named in calls and messages.
- **Callback phone number**: given to patients in voicemails and messages.
  Use international format (+63…).
- **Timezone (IANA)**: should be `Asia/Manila` for Philippine clinics. All
  calling hours and slot times use it.
- **Calling hours (clinic-local)**: per weekday start and end. Outside these
  hours no calls or pre-call messages go out. Closed days have no hours.
- **Default greeting context**: default "reason" for new campaigns.
- **Pre-call text message**: on/off, and **Lead time before the call
  (seconds, 60–600)**. Patients get a heads-up message, then the call after the
  lead time. Longer leads (5–10 minutes) give patients time to use a booking link.
- **Campaign types & Telnyx assistants**: maps each campaign type to the AI
  voice assistant that handles it.

Self-booking and chat invites are not in this screen yet; a platform admin
turns them on.
