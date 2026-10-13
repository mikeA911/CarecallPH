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
never shows disease names. Patients open the clinic's link (`/check/<clinic link name>`), or by
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
   which kind of doctor, any warning signs, and the clinic's number.
7. **Book a visit** (on a clinic's page): pick a day and time (results marked
   "See a doctor today" only show today's times), then the patient's name,
   mobile and date of birth. The patient agrees to share their answers with the
   clinic. A new patient is added to **Patients** automatically; an existing
   patient (same mobile and birthday) is matched, never changed.

CareCall never calls 911 for the patient. The patient calls.

## Nearby care

- **Emergency screen**: under the **Call 911** button, **Find the nearest
  emergency room** lists the 3 nearest hospitals with distance, phone and
  directions. The 911 button never waits for it.
- **Result, on the CareCall page** (`/check`): **Near you** asks for the
  patient's location (**Use my location**, or type a town, city or barangay).
  CareCall clinics nearby come first with **Book a visit**; then **Other
  nearby options** from Google (hospitals and doctors within 10 km, nearest
  first), which we don't book: the patient calls them. **Find a clinic and
  book** then sorts clinics by distance too.
- **The clinic's own link** never lists other places, except emergency rooms.
- **Telegram**: a patient who sends their location in the chat (📎 →
  Location) gets the nearest emergency rooms, CareCall clinics and other
  options.
- The location is used for the search only and is never saved. Lists aren't
  complete and distances are straight-line. For a clinic to appear as "near
  you", set its map location (Clinic settings → **Find on map**).

## One page or the clinic's own link

- **The clinic's link** (`/check/<clinic link name>`): the clinic is already
  chosen; the patient books with this clinic only. Best for the clinic's QR
  poster, Facebook page and Google Maps listing.
- **The CareCall page** (`/check`, also what Telegram users get if they aren't
  connected to a clinic): after the result, **Find a clinic and book** lists
  every clinic that turned the symptom check on. Clinics with the kind of
  doctor the patient needs come first, then the soonest open time. Nothing is
  sponsored, and the list says it isn't every clinic nearby.

## Turning it on (clinic admin)

**Clinic settings → Symptom check and online booking**:

- Tick **Let patients check symptoms and book online** and save. The clinic's
  link is created automatically (clinic name + a random number) and shown with
  **Copy link** and **Show QR code**. It is one link for the whole clinic, the
  same for every patient: put the QR code on a poster, the link on Facebook or
  Google Maps.
- **Change link** (rarely needed) picks a different name; the old link stops working.
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

- "Where do I see what the patient reported?" Open the patient, then
  **Appointments**: the booking shows "Symptom check" with the urgency, kind of
  doctor, symptoms and any Philippine warnings to watch for.
- "Why no times?" The clinic needs clinicians with availability (Clinicians).
  Urgent results only show today's open times; otherwise up to 10 days ahead.
- "Does it show nearby clinics?" Yes, when the patient shares their location
  or types their town (CareCall page and emergency screen). The clinic needs its
  map location set (Clinic settings → **Find on map**).
- "A clinic doesn't show as nearby." It needs the symptom check on, a link, and
  a map location; it must be within 25 km of the patient.
- "Is it in Filipino?" The emergency questions and key lines are in English and
  Filipino; symptom names are English for now.
