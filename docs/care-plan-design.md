# Care plans: prescriptions, medication reminders and vital signs (Phase M)

**Status:** M1 built (consent, medicines, reminders, adherence); M2–M4 designed. **Roadmap:** Phase M, the first step toward
CareLink RPM (Phase R). **Last updated:** 12 October 2026

The doctor (or an assistant) writes the prescription in CareCall. That one
entry produces the printable prescription for the pharmacy **and** the
patient's medicine reminders. Separately, the doctor can ask the patient to
send vital signs (blood pressure, blood sugar…) by chat. Readings outside the
doctor's limits go to the clinic for review. Nothing starts until the patient
agrees in the chat.

## 1. Decisions

| Decision | Choice | Why |
|---|---|---|
| Where medicines come from | **The prescription written in CareCall**; or "add a medicine" for ones prescribed elsewhere | One entry, no retyping; the reminder always matches what was prescribed |
| Who writes, who signs | Doctor or assistant drafts; **only the doctor signs** (the clinician linked to their login) | Assistants save the doctor time; the legal act stays with the doctor |
| What CareCall decides | **Nothing clinical.** No dose suggestions, no changes, no interpretation beyond the doctor's limits | CareCall is a tool for the doctor, not a prescriber |
| Channel | Telegram first (other chat apps as they're approved); SMS only for reminders, never for readings | Readings need a two-way chat; SMS costs and is less private |
| Consent | Separate, explicit consent in the chat **before** any medicine or vital-sign message; recorded with the wording shown; withdraw any time | Health information is sensitive personal information under the Data Privacy Act |
| Review | Out-of-range readings → **Readings to review** for the clinic, during clinic hours. A dangerous reading also tells the patient at once to seek care | The clinic must not appear to watch around the clock unless it does |
| Not included | Dangerous drugs (S2, yellow prescription), injections given at home, insulin dose adjustment | Separate legal process; higher clinical risk |

## 2. The doctor's flow (portal)

```
Patient page → Care plan
  ├─ Prescriptions      [New prescription]
  │     generic name*, brand (optional), strength, form, dose, how often
  │     (times of day), for how many days, quantity, instructions
  │     [Save draft]  (assistant or doctor)
  │     [Sign]        (doctor only)  → printable prescription / PDF
  │                                  → "Send to patient" (Telegram, as a file)
  │                                  → [x] remind the patient for each medicine
  ├─ Medicines          list with reminder times, adherence ("taken 26 of 30")
  ├─ Vital signs        [New monitoring plan]  what, when, how, why, targets,
  │                     what to do if high or low  [Save draft] [Sign] (doctor)
  │                     → printable plan / PDF → "Send to patient" (Telegram)
  │                     chart and list of readings
  └─ Consent            status, date, wording version, withdraw
Readings to review  (new list for the clinic, with a badge)
```

**Prescription contents** (printed and PDF):
- Clinic letterhead: name, address, phone.
- Doctor: name, **PRC license no.**, **PTR no.**, specialty (from the clinician's profile).
- Patient: name, age, sex, date.
- Rx lines: **generic name** (required by the Generics Act, RA 6675), brand in
  brackets if the doctor wants, strength, form, quantity, and the instructions
  in plain English and Filipino ("1 tablet in the morning / 1 tableta sa umaga").
- Doctor's signature (uploaded image) or "signed electronically by Dr. X on
  <date>", and a QR code that opens a verify page (prescription number, doctor,
  date, items; no other patient details).

**To confirm before launch:** current DOH, PMA and FDA rules on electronic
prescriptions and whether pharmacies accept the PDF or the signed printout
(telemedicine guidance allows electronic prescriptions with the doctor's
details and signature, but check the latest circulars).

## 3. The patient's flow (Telegram)

**Consent (once, before anything else):**
> Dr. Reyes at Santos Clinic set up medicine reminders and blood pressure
> tracking for you. We'll message you at the times your doctor set, and save
> your replies (whether you took your medicine, your readings) in your record
> at Santos Clinic. The clinic reviews readings during office hours, not 24
> hours a day. In an emergency, call 911.
> Reply YES to start, or NO. You can stop any time by replying STOP REMINDERS.
>
> (Filipino version below it.)

The consent is stored with: patient, clinic, what was agreed (medicine
reminders, vital signs), the exact wording version, the time, the chat app,
and the reply. NO, or no reply within 3 days, means nothing is sent; staff see
"Declined" or "No answer".

**Medicine reminder** (at each time the doctor set):
> 💊 8:00 AM: Amlodipine 5 mg, 1 tablet.
> Reply 1 when taken, 2 if you skipped it.

No reply in 2 hours counts as **missed**. "Discreet" option per patient: "Time
for your 8 AM medicine" without the medicine's name (for shared phones).

**Vital sign request:**
> 🩺 Good morning! Please check your blood pressure and reply with the numbers,
> for example 120/80.

| Reply | CareCall |
|---|---|
| Normal, within the doctor's limits | "Thanks, saved: 128/82." |
| Outside the limits | "Saved: 152/96. That's higher than the target Dr. Reyes set. The clinic will look at it during office hours." + **Readings to review** |
| Dangerous (doctor's critical limit, defaults below) | "Saved: 185/122. This is very high. If you have chest pain, trouble breathing, weakness on one side, confusion or a severe headache, call 911 now. Otherwise contact Santos Clinic today: 0917…" + **urgent** item for the clinic |
| Not understood / implausible (e.g. 12/8) | "Sorry, I didn't get that. Please send your blood pressure like 120/80." |

## 4. Vital signs: the monitoring plan

Like the prescription, the doctor (or assistant, as a draft) writes a
**monitoring plan** and the doctor signs it. It is the patient's instruction
sheet, sent on Telegram as a document and printable for the clinic visit, so
the patient knows exactly what to do and why. It is also what drives the chat
requests and the limits.

**What the plan says** (one section per measure):

| Part | Example (blood pressure) | Who writes it |
|---|---|---|
| **What and why** | "Check your blood pressure because we started a new medicine (Amlodipine) and want to see if the dose is right." | Doctor, in plain words |
| **When** | "Every morning before breakfast and before your medicine, for 2 weeks." | Doctor; becomes the chat schedule |
| **How** | "Sit quietly for 5 minutes. Feet flat, back supported, arm resting at heart level. No coffee, cigarettes or exercise 30 minutes before. Take 2 readings 1 minute apart and send both." | Ready-made instructions per measure (draft for doctor review); the doctor can edit |
| **Your target** | "Below 140/90." | Doctor; becomes the out-of-range limit |
| **If it's high or low** | "Above 160/100 twice in a row: message the clinic. Below 90/60 with dizziness: sit or lie down and message the clinic." | Doctor's action plan; shown back in the chat reply |
| **When to call 911** | "Above 180/120 with chest pain, trouble breathing, weakness on one side, confusion or a severe headache." | Standard text plus the doctor's critical limit |
| **Who reviews** | "Santos Clinic reviews your readings Monday to Saturday, 8 AM to 5 PM." | From clinic settings |

The plan has English and Filipino versions (templates for the "how" and the
standard texts; the doctor's own sentences are shown as written). The chat
request links back to it: "🩺 Time for your blood pressure check (see your
plan from Dr. Reyes). Reply like 120/80." Out-of-range replies quote the
doctor's own action plan: "That's above your target. Dr. Reyes's plan says:
if it's above 160/100 twice in a row, message the clinic."

The plan carries the same signature, date, PRC number and verify QR as the
prescription, and a new version is created when the doctor changes it (the old
one stays in the record).

## 4a. Measures and limits

| Measure | Reply format | Plausible | Default limits (doctor confirms per patient) |
|---|---|---|---|
| Blood pressure | `120/80`, optional pulse `120/80 72` | 60–260 / 30–160 | Target set by doctor (e.g. < 140/90); critical ≥ 180/120 or < 90/60 |
| Blood sugar (mg/dL) | `110` | 20–600 | Target set by doctor; critical < 70 or > 300 |
| Temperature (°C) | `37.8` | 34–43 | ≥ 38.0 out of range; ≥ 39.5 critical |
| Weight (kg) | `68.5` | 2–300 | Change of more than N kg in a week (doctor sets N) |
| Oxygen (SpO₂ %) | `96` | 50–100 | < 94 out of range; < 90 critical |

The defaults are **drafts for the doctor to confirm**; each patient's limits are
the doctor's, set when tracking starts. CareCall only compares numbers with
those limits and never explains what a reading means.

## 5. Data

```
providers (+)         prc_license_no, ptr_no, s2_license_no (shown only, S2 drugs excluded),
                      signature_image (storage path)
care_consents         patient, clinic, scopes (medication_reminders, vital_signs),
                      wording_version, channel, consented_at | declined_at, withdrawn_at
prescriptions         clinic, patient, provider (doctor), number, status
                      (draft | signed | cancelled), drafted_by, signed_by, signed_at, notes
prescription_items    prescription, generic_name, brand, strength, form, dose,
                      times_of_day[], days, quantity, instructions_en, instructions_fil, remind
medications           patient, clinic, from prescription item or added by staff,
                      times_of_day[], start_date, end_date, active, discreet
medication_doses      medication, due_at, status (sent | taken | skipped | missed), answered_at
monitoring_plans      clinic, patient, provider, version, status (draft | signed | replaced),
                      drafted_by, signed_by, signed_at, review_hours_text
vital_plans           monitoring plan, measure, reason, how_to (en/fil), times_of_day[],
                      days_of_week[], until_date, target_low/high, critical_low/high,
                      if_high / if_low (doctor's action plan text)
vital_readings        patient, clinic, measure, values (e.g. {sys, dia, pulse}), unit,
                      taken_at, source (chat | staff), flag (ok | out_of_range | critical),
                      reviewed_by, reviewed_at, review_note
```

- RLS: staff read their own clinic; only the linked doctor signs prescriptions
  (checked in a database function, not just the portal).
- Every view and change of prescriptions and readings goes to `audit_log`.
- Records stay as part of the clinic's patient record (the clinic sets the
  retention period). Withdrawing consent stops new messages; it doesn't delete
  what's already in the record, and the consent notice says so.
- Later (Phase L/R): readings map to FHIR Observations with LOINC codes.

## 6. How it runs

- **Cron, every 5 minutes** (like appointment reminders): send due medicine
  reminders and vital-sign requests, mark doses missed after 2 hours.
- **channel-webhook:** replies are matched in this order: birthday check →
  care-plan consent (YES/NO) → reply to the latest medicine reminder (1/2) →
  a reading (when a vital-sign request is open, or the message looks like one) →
  appointment reminder replies → existing keywords.
- Only to patients with consent, an active plan, and a connected chat app.
  07:00–21:00 by default; medicine times outside that window need the doctor
  to tick "allow night-time reminders".

## 7. Safety and privacy

1. The doctor sets every medicine, time and limit; CareCall never suggests or
   changes them.
2. Dangerous readings always get the 911 message first, then the clinic's number.
3. The patient is told, at consent and on every out-of-range reply, that the
   clinic reviews during office hours.
4. Several missed doses (default 3 in a row) or no readings for 3 days → an
   item for the clinic, not a message that scolds the patient.
5. Chat messages are kept short; discreet mode hides medicine names.
6. Consent is specific, recorded with its wording, and easy to withdraw
   (STOP REMINDERS, or staff on the patient page).
7. A doctor reviews the default limits, message wording (English and Filipino)
   and the escalation rules before patients use it.

## 8. Delivery slices

| Slice | Scope |
|---|---|
| **M1** | Consent in chat; medicines added by staff (no prescription yet); reminders, 1/2 replies, missed doses, adherence on the patient page; STOP REMINDERS |
| **M2** | Prescriptions: draft by assistant or doctor, sign by the doctor, printable/PDF with PRC and PTR numbers, send to the patient on Telegram, verify page; signed items feed M1 reminders |
| **M3** | Vital signs: monitoring plan (what, when, how, why, targets, what to do if high or low) drafted and signed like a prescription, sent as a document; chat requests from the plan, reading parser, Readings to review, critical-reading message, chart on the patient page |
| **M4** | Reports: adherence and readings in CC (aggregate), missed-dose and no-reading alerts; FHIR mapping groundwork for Phase R |

### Later: dictate to CC (M5)

A **Dictate** button in CC, shown to doctors (clinicians linked to a login).
The doctor speaks, e.g. *"Amlodipine 5 milligrams once a day in the morning
for 30 days, and blood pressure every morning for two weeks, target below
140 over 90, call the clinic if above 160 over 100"*.

1. Speech to text: the browser's speech recognition (English and Filipino
   where supported) or a speech-to-text service; the text is shown so the
   doctor can correct it.
2. CC turns the text into a **draft** prescription and/or monitoring plan in
   the same forms staff use, with any unclear item flagged ("dose not stated",
   "how long?"). It never invents a dose or a limit that wasn't said.
3. The doctor reviews, edits and **signs** as usual. Nothing is sent to the
   patient or a pharmacy until the doctor signs.

Privacy: the audio isn't stored; the transcript is kept only in the draft.
Needs M2 and M3 first.

**Before building:** confirm the e-prescription rules (§2) and who reviews
readings at the pilot clinic and how quickly.
