---
id: campaigns
title: Campaigns
summary: Creating, scheduling, starting, pausing and completing campaigns; AI calls or chat messages; campaign and patient statuses.
roles: staff
routes:
  - /campaigns | staff | Campaigns
  - /campaigns/new | clinic_admin | New campaign
  - /campaigns/:id | staff | Campaign detail
updated: 2026-10-11
---

A campaign is: who to contact, why, with which clinician, what slot length, and
how to reach them: **AI phone calls** or a **Chat message with a booking link**.

## Campaign statuses

- **draft**: being set up; nothing is sent.
- **scheduled**: will become active at its schedule start time.
- **active**: CareCall is working through its patients.
- **paused**: stopped by a user; nothing is sent until resumed.
- **completed**: set automatically when no patient is left to contact, or by
  **Mark completed** on the campaign page.

## Creating a campaign (clinic admin)

On **New campaign** fill in:

- **Name**, for example "Annual check-ups".
- **How to reach patients**: **AI phone calls**, or **Chat message with a
  booking link** (no calls; see Chat campaigns below).
- **Send one reminder after (hours)**: chat campaigns only, 1–168, default 24.
- **Campaign type**: selects which AI voice assistant makes the calls.
- **Clinician (blank = patient's own)**: whose calendar slots are offered.
- **Reason the AI gives the patient** (chat campaigns: **Reason in the message
  to the patient**): one sentence, e.g. "Dr. Santos would like to schedule your
  annual check-up." Keep it short and free of diagnoses.
- **Slot length (minutes)**.
- **Schedule start (optional)**.
- **Patients**: tick patients to include (filter by name or phone).

Save as draft or scheduled.

## Running a campaign

On the campaign's detail page, **Start calling** (chat campaigns: **Start
sending**) makes it active, **Pause** stops it and **Mark completed** ends it.
The detail page shows **Progress** and a **Patients** tab with each patient's
status.

While active, CareCall works through patients automatically every few minutes,
but only inside the clinic's calling hours (Clinic settings). Each round it
contacts a small batch of patients. If the pre-call message is on, it sends the
message first and calls after the lead time.

Patients marked **Do not call** or inactive are always skipped.

## Chat campaigns

A chat campaign never calls. Inside calling hours, each patient gets one message
with a personal booking link (valid 7 days) on the chat app they connected, or
by SMS if they agreed to texts and SMS is set up:

1. **link sent**: message sent; waiting for the patient to book.
2. If they haven't booked after the reminder time, they get **one reminder**
   with a fresh link.
3. **booked** as soon as they pick a time from the link.
4. **no answer** if there's still no booking after the reminder time again.

Patients with no way to be messaged are shown as **needs chat invite**. Open the
patient and use **Invite to chat**. When they connect and reply YES, they're
messaged automatically while the campaign is active. These patients keep the
campaign open; use **Mark completed** when you're done waiting.

A message that fails to send goes to the Review queue as **needs review**.
