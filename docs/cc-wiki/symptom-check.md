---
id: symptom-check
title: Symptom check
summary: The public symptom check page (/check/<clinic>), what patients see, emergencies and 911, turning it on in Clinic settings, and what is stored.
roles: staff
routes:
  - /settings/clinic | clinic_admin | Clinic settings
updated: 2026-10-13
---

## What it is

A public page where a patient answers a few questions and learns **how soon to
see a doctor** and **what kind of doctor**. It is **not a diagnosis**, and it
never shows disease names. Patients open it at `/check/<page address>`, or by
sending `/check` (or `CHECK`) to the clinic's Telegram bot.

Status: test version. It runs on a built-in **demo** engine with made-up
rules, and the page shows a DEMO banner; it isn't for real patients yet. The
real engine (Infermedica) comes once the clinic platform's trial is approved.

## What the patient goes through

1. A short intro: not a diagnosis; call 911 if very unwell.
2. **Emergency questions** first: chest pain, severe trouble breathing, stroke
   signs, heavy bleeding, fainting or seizure, thoughts of self-harm, pregnancy
   with bleeding or severe pain, a baby under 3 months with fever. Any yes shows
   the **emergency screen**: a Call 911 button, the clinic's local emergency
   numbers, what to tell the dispatcher, and what to do while waiting. No booking.
3. Year of birth and sex at birth.
4. Symptoms, picked from a search list (English for now).
5. A few follow-up questions: "Do you also have any of these?", yes / no /
   don't know questions, or pick one (e.g. how long a cough has lasted).
   Philippine questions are added where they matter: how many days of fever,
   flood water in the last 2 weeks (leptospirosis), a cough of 2 weeks or more
   (TB). Patients can also pick "Animal bite or scratch (dog, cat)" (rabies).
6. The result: **See a doctor today** or **See a doctor in the next few days**,
   which kind of doctor, any warning signs, and the clinic's number to book.

CareCall never calls 911 for the patient. The patient calls.

## Turning it on (clinic admin)

**Clinic settings → Symptom check**:

- **Page address**: e.g. `santos-family-clinic` gives `/check/santos-family-clinic`.
- **Show the symptom check on the clinic's page**: on or off.
- **Local emergency numbers**: one per line, e.g. city rescue and the nearest
  hospital ER. Shown next to 911.

The platform admin must also choose the engine (`SYMPTOM_ENGINE`, see README §10).

## Philippine rules

Draft rules, waiting for a doctor's sign-off, can only make the advice more
urgent, never less: animal bite (rabies shots today), dengue warning signs,
fever after flood water, a young child with diarrhea and vomiting, fever over
a week, yellow eyes or skin, fever of 2–7 days (dengue check), and a cough of
2+ weeks (free TB testing at health centers). Each check records which rules
applied.

## What is stored

Per check: age range, sex, the symptom codes picked, the urgency, the top kind
of doctor, and the outcome. **No** name, phone, typed text, disease names,
location or IP address. Checks are deleted after 90 days.

## Answers to common questions

- "Can the patient book from the result?" Not yet: they call the clinic. Booking
  from the result is the next slice.
- "Does it show nearby clinics?" Not yet: nearby care by location comes next.
- "Is it in Filipino?" The emergency questions and key lines are in English and
  Filipino; symptom names are English for now.
