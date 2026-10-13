---
id: care-reports
title: Care plan reports and alerts
summary: Missed-dose and no-reading alerts, who sees clinical action items, and CC's care report (adherence, response rate, readings to review, BP trend) with how to read it.
roles: staff
routes:
  - /cc | staff | CC action items
  - /readings | staff | Readings to review
updated: 2026-10-13
---

For nurses and doctors. Front desk doesn't see these alerts or the report.

## Alerts

CareCall checks every hour and files a **CC action item** (warning) when:

- **3 medicine reminders in a row** for one medicine were missed (no answer):
  "Missed 3 medicine reminders in a row: <patient>".
- **No readings for 3 days** from a patient whose monitoring plan is running
  and who was asked at least twice in that time: "No readings for 3 days:
  <patient>". A plan asking less often (e.g. weekly weight) doesn't trigger it.

Only for patients who still agree to reminders or vital signs. The patient is
not messaged about it. Each alert is filed once; when the patient answers
again (a dose taken or skipped, a reading sent) it clears, and a new streak
files a new item. Mark the item **Done** after following up (usually a call).

## Who sees what in CC action items

Items about readings, missed doses and no readings are **clinical**: nurses
and doctors see them; front desk doesn't. Booking items (a new time wanted,
a cancellation) are seen by everyone. Items about one patient open that
patient's page.

## CC's care report

Ask CC, e.g. "how are our patients doing with their medicines?" or "any
readings waiting?". CC uses the **care report** for the last 7 or 30 days:

- **Medicines**: patients with reminders on, doses taken / skipped / missed,
  adherence (taken out of answered and missed doses) compared with the
  period before, patients by adherence (80–100%, 50–79%, under 50%; fewer
  than 5 doses isn't banded), patients with 3 missed in a row.
- **Vital signs**: patients with a running plan and who agreed, drafts waiting
  for a doctor, requests and the response rate, readings by measure and check
  (in target, out of range, critical), readings not yet reviewed and how long
  the oldest has waited, and the **blood pressure trend**: patients whose
  average systolic over the last 7 days is 5 mmHg or more above (up) or below
  (down) the 7 days before (3+ readings in each week).
- **Open alerts** by kind.

The report has counts only: no names, no single patient's readings. CC never
interprets a reading or suggests treatment; for one patient, open their page.

## How to read it (also used by the nightly review)

- Readings not reviewed for more than 24 hours → someone should go through
  **Readings to review**.
- Adherence or response rate falling against the previous period, on 10 or
  more patients → check whether reminders arrive (chat app still connected)
  and whether times suit patients.
- Drafts waiting for a doctor → a doctor signs or deletes them.
- More patients trending up → for the doctors to look at; not an alarm.
- Small numbers (a handful of patients or doses) are not conclusions.

The nightly review (2:00 AM) also looks at the care report and files at most
a few clinic-wide items. It doesn't repeat the per-patient alerts.
