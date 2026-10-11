---
id: clinic-settings
title: Clinic settings
summary: Display name, callback number, timezone, calling hours, greeting, pre-call message and lead time, campaign types.
roles: clinic_admin
routes:
  - /settings/clinic | clinic_admin | Clinic settings
updated: 2026-10-02
---

- **Display name**: how the clinic is named in calls and messages.
- **Callback phone number**: given to patients in voicemails and messages.
  Optional. Accepts a Philippine mobile (`0917 123 4567`, `+63 917 123 4567`)
  or a landline with its area code (`02 8123 4567` Metro Manila, `032 123 4567`
  Cebu). It is saved in international format (`+639171234567`, `+63281234567`)
  and read out in voicemails the local way ("0 9 1 7, 1 2 3, 4 5 6 7"). An
  invalid number blocks **Save** with a message explaining the accepted formats.
- **Timezone (IANA)**: `Asia/Manila` for Philippine clinics (the default for
  new clinics). All calling hours and slot times use it, and booking links say
  "All times Philippine Time (PHT)".
- **Calling hours (clinic-local)**: per weekday start and end. Outside these
  hours no calls or pre-call messages go out. Closed days have no hours.
  New clinics start with Mon–Fri 08:00–18:00, Sat 08:00–12:00, Sunday closed.
  Opening a closed day fills in 08:00–18:00. One window per day (no lunch break).
- **Default greeting context**: default "reason" for new campaigns.
- **Pre-call text message**: on/off, and **Lead time before the call
  (seconds, 60–600)**. Patients get a heads-up message, then the call after the
  lead time. Longer leads (5–10 minutes) give patients time to use a booking link.
- **Campaign types & Telnyx assistants**: maps each campaign type to the AI
  voice assistant that handles it.

Self-booking and chat invites are not in this screen yet; a platform admin
turns them on.
