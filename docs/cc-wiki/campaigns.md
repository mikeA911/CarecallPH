---
id: campaigns
title: Campaigns
summary: Creating, scheduling, starting and pausing campaigns; campaign statuses; how dialing runs.
roles: staff
routes:
  - /campaigns | staff | Campaigns
  - /campaigns/new | clinic_admin | New campaign
  - /campaigns/:id | staff | Campaign detail
updated: 2026-10-01
---

A campaign is: who to contact, why, with which clinician, and what slot length.

## Campaign statuses

- **draft**: being set up; nothing is sent.
- **scheduled**: will become active at its schedule start time.
- **active**: the dialer is working through its patients.
- **paused**: stopped by a user; nothing is sent until resumed.
- **completed**: set automatically when no patient is left to contact.

## Creating a campaign (clinic admin)

On **New campaign** fill in:

- **Name**, for example "Annual check-ups".
- **Campaign type**: selects which AI voice assistant makes the calls.
- **Clinician (blank = patient's own)**: whose calendar slots are offered.
- **Reason the AI gives the patient**: one sentence the assistant says, e.g.
  "Dr. Santos would like to schedule your annual check-up." Keep it short and
  free of diagnoses.
- **Slot length (minutes)**.
- **Schedule start (optional)**.
- **Patients**: tick patients to include (filter by name or phone).

Save as draft or scheduled.

## Running a campaign

On the campaign's detail page, **Start calling** makes it active and **Pause**
stops it. The detail page shows **Progress** and a **Patients** tab with each
patient's status.

While active, CareCall works through patients automatically every few minutes,
but only inside the clinic's calling hours (Clinic settings). Each round it
contacts a small batch of patients. If the pre-call message is on, it sends the
message first and calls after the lead time.

Patients marked **Do not call** or inactive are always skipped.
