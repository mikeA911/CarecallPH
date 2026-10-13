---
id: vital-signs
title: Vital signs by chat
summary: Monitoring plans the doctor signs, consent in the chat, reading requests and replies, out-of-range and critical readings, Readings to review, chart, FHIR.
roles: staff
routes:
  - /patients/:id | staff | Patient detail
  - /readings | staff | Readings to review
updated: 2026-10-13
---

Nurses and doctors only. Front desk never sees plans or readings.

## The monitoring plan (patient page → Vital signs)

1. **Start a monitoring plan** (nurse or doctor). Add a measure: blood
   pressure, blood sugar, temperature, weight or oxygen level (SpO₂). For each:
   - **What and why**: the doctor's words, sent to the patient.
   - **Times** (up to 4 a day, 5 AM to 10 PM), **days** (every day or chosen
     days), **start** and **until** dates.
   - **How to measure**: filled in, edit as needed.
   - **Target**: a reading beyond it is "out of range" and goes to Readings to
     review. **Critical**: at or beyond it, the patient is told to call 911
     first if they have danger signs. Blood pressure has systolic and
     diastolic limits.
   - **If high / If low**: what the doctor wants the patient to do, quoted to
     the patient.
   Default limits are suggestions for the doctor to confirm or change.
2. **Save draft.** Nothing runs until a **doctor** clicks **Sign plan** and
   re-enters their password. A signed plan can't be edited; **Change plan**
   makes a new version that replaces it when signed. **Stop plan** ends it.
3. **Ask patient to agree** (needs a chat app). The request names the doctor
   and the measures. When the patient replies YES, they get the doctor's plan
   (their instruction sheet) and requests start at the plan's times.

## What the patient does

At each time CareCall asks for the reading. The patient replies with the
numbers, e.g. "120/80", "120 over 80 pulse 72", "110", "37.8", "68.5 kg".
mmol/L, °F and lbs are converted. A blood pressure sent without a request is
saved too. If a reply can't be read, they're asked again.

- **In target**: "Thanks, saved."
- **Out of range**: saved; the reply quotes the doctor's plan and says the
  clinic will look at it during office hours. A warning goes to CC action items.
- **Critical**: saved; the reply says to call 911 now if they have danger
  signs, otherwise to contact the clinic today. An urgent CC action item is filed.
- No reply within 4 hours: the request is marked missed. No readings for 3
  days (after at least 2 requests) files a CC action item for nurses and
  doctors; the patient isn't messaged about it.
- **STOP REMINDERS** stops vital-sign requests and medicine reminders. Staff can
  click **Stop** next to "Vital signs by chat".

CareCall only compares numbers with the doctor's limits and quotes the doctor;
it never explains a reading.

## Readings

The patient page shows a chart per measure (last 90 days, target lines
dashed, dots coloured by check) and the latest readings. **Add a reading taken
at the clinic** records one measured at the clinic; it's checked against the
plan the same way.

**Readings to review** (sidebar, nurses and doctors) lists every out-of-range
and critical reading not yet reviewed, critical first. **Mark reviewed** with
an optional note (e.g. "called patient"). Readings can't be changed.

Ask CC for the clinic's response rate, readings waiting and blood pressure
trend (see Care plan reports and alerts).

Readings and signed plans are in **Download record (FHIR)** as Observations
(LOINC codes) and a CarePlan.

## Answers to common questions

- "Why isn't the patient getting requests?" The plan must be signed by a
  doctor, the patient must have said YES, be connected to a chat app, and today
  must be within the measure's dates and days.
- "Can a nurse sign the plan?" No, only a doctor linked to a clinician.
- "Does CareCall call 911?" No. It tells the patient to, and flags the reading.
