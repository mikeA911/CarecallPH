# Symptom check: design sketch (Phase D1)

**Status:** D1a, D1c and D1e built (demo engine; ApiMedic appeared offline); Infermedica adapter built, awaiting a trial; D1b designed. **Roadmap:** Phase D (CareCall Discover), first slice D1.
**Last updated:** 12 October 2026

A patient answers a few questions about their symptoms, gets care-navigation
advice (how urgently to seek care and which kind of doctor), sees the nearest
suitable care, and can book with a CareCall clinic. CareCall never tells a patient what they have; the engine does the
clinical assessment, CareCall handles safety rules, consent and booking.

## 1. Decisions

| Decision | Choice | Why |
|---|---|---|
| Engine | **Demo** rules to build, test and show; **Infermedica** to go live. (ApiMedic, the first choice for testing, appeared offline in October 2026; its adapter is kept but unused) | Infermedica needs an organization and business email, and is the stronger clinical engine; the demo engine needs nothing and never goes to patients |
| Swap | One `SymptomEngine` interface, engine picked by a secret | Moving to Infermedica is a config change, not a rewrite |
| Entry points | **Telegram bot** (`/check` or "CHECK") and the web page `/check` (optionally `/check/<clinic>`) | Telegram is already live for the pilot; the web page serves everyone else |
| Nearby care | Patient shares their **location** (Telegram location button, or the browser's location on the web, or types a town/barangay). We look up nearby facilities with the **Google Places API**, not a general web search | Few CareCall clinics at launch; the patient should still get a useful "where to go" answer |
| Who is listed | CareCall clinics within reach first, with booking. Then **other nearby facilities**, sorted by distance only, with call and directions, no booking | Useful from day one; nothing sponsored or ranked by payment |
| What the patient sees | Urgency level + kind of doctor + next step. **Condition names off by default** (clinic setting, later) | Positions D1 as care navigation, not diagnosis (see §8) |
| Emergencies | CareCall's own red-flag screen runs **before** the engine. Any emergency: tap-to-call **911**, the **nearest emergency room** from the patient's location with directions, and **no booking button**. CareCall never calls 911 for the patient (§4a) | Safety must not depend on a third-party engine or its uptime; dispatchers need to talk to the person |
| AI (Claude) | Not in D1. Later (D3) only to map free text, e.g. Filipino, to engine symptom IDs; it never assesses | Keeps clinical judgement in a governed engine |
| What we store | Age band, sex, selected symptom IDs, urgency, specialty, outcome. No free text, no condition list, **no location**. Deleted after 90 days | Symptoms are sensitive personal information under the Data Privacy Act (RA 10173) |

## 2. Patient flow

```
Telegram: patient sends /check (or CHECK)      Web: /check  or  /check/<clinic-slug>
        │  bot replies with a button that opens the check (Telegram Mini App / link with a
        │  short-lived session token), so the questions use the same web screens
        ▼
  1. Intro + consent        "This is not a diagnosis…"  [I agree]
  2. Emergency screen       Chest pain? Trouble breathing? Face drooping / weak arm?
                            Heavy bleeding? Thoughts of self-harm? Pregnant with bleeding or pain?
                            → any YES: emergency screen (§4a). STOP.
  3. About you              Year of birth, sex at birth (engines need both). Under 18: "a parent or
                            guardian should fill this in".
  4. Symptoms               Type-ahead search over the engine's symptom list (English first)
  5. Follow-up questions    Infermedica: interview questions until it says stop.
                            ApiMedic: optional "do you also have…" from proposed symptoms.
  6. Where are you?         Telegram: [📍 Share my location] button (one tap on a phone).
                            Web: "Use my location" (browser asks permission) or type town / barangay.
                            Skippable; skipping still shows the advice.
  7. Result                 Urgency, kind of doctor, what to do next, disclaimer, then nearby care (§3a).
                            emergency → §4a
                            urgent    → "be seen today": nearest open facilities first; book a CareCall
                                        clinic only if it has a slot today
                            routine   → CareCall clinics with booking, then other nearby options
                            self_care → advice; nearby options and booking optional
  8. Booking (D1b)          Name, mobile, date of birth → slots → confirm. In Telegram the
                            confirmation also arrives as a chat message.
```

With `/check/<clinic>` the patient came from that clinic, so it is listed first
when it fits the result; nearby options still appear for emergencies and for
results the clinic doesn't cover.

## 3. Architecture

```
web: /check/:clinic  (PublicApp, lazy-loaded like /book and /connect)
        │  POST {action, …}
        ▼
edge function  symptom-check  (public; verify_jwt = false)
        ├─ rate limit per IP + per session, monthly budget per engine, kill switch
        ├─ red-flag screen (our rules, no engine call)
        ├─ SymptomEngine ── apimedic.ts   (ApiMedic: auth token, symptoms, diagnosis, specialisations)
        │                └─ infermedica.ts (Infermedica: search, diagnosis loop, triage, recommend_specialist)
        ├─ nearby care: Google Places API (§3a); location used for the lookup, never stored
        └─ symptom_checks row (minimal, §6)
        ▼
booking (D1b): booking-api, new action for new patients → get_available_slots → appointments
```

### 3a. Nearby care

**Why not a web search:** search results are pages, not places. They come back
without reliable distance, opening hours or phone numbers, change from day to
day, and can surface ads. A places API returns structured facilities.

**Lookup:** Google Places API (New), Nearby Search around the patient's point:

| Result | Place types asked for | Radius |
|---|---|---|
| emergency | `hospital` (filtered to those with an emergency room where known) | nearest 3, up to 25 km |
| urgent / routine / self_care | `hospital`, `doctor`, `medical_clinic`; text filter by specialty where useful (e.g. "pediatric") | nearest 5, up to 10 km |

Each listing: name, distance, open now, phone (tap to call), and a Google Maps
directions link. In Telegram the nearest one can also be sent as a map pin
(`sendVenue`).

**CareCall clinics** come from our own `clinics` table (new `lat`, `lng`
columns), matched by distance and by providers whose `specialty` fits the
result. They're shown first, labelled "Book with CareCall"; other facilities
are labelled "Other nearby options. We don't book these; call them directly."
Wording on every list: "Not a complete list. Distances are approximate."

**Typed location:** a town or barangay is turned into a point with the same
provider's geocoding (restricted to the Philippines).

**Cost and terms:** Google charges per call above a monthly free allowance per
API (Nearby Search is listed around 1,000 free calls a month, then about
US$35 per 1,000; check the live pricing page). Keep the field list short,
cache nothing beyond what Google's terms allow, and show the Google Maps
attribution. Fallback if Google is down or over budget: OpenStreetMap (free,
but clinic coverage in the Philippines is patchy), then "call 911 / your
barangay health center".

**Privacy:** coordinates go to Google for the lookup and are not stored by us;
`symptom_checks` keeps only whether a location was shared.

### Engine interface (`supabase/functions/_shared/symptom/engine.ts`)

```ts
export type Sex = "male" | "female";
export type Urgency = "emergency" | "urgent" | "routine" | "self_care";

export interface Person { birthYear: number; sex: Sex }
export interface Symptom { id: string; name: string }
export interface Question { id: string; text: string; choices: { id: string; label: string }[] }
export interface Answer { symptomId: string; present: boolean | "unknown" }

export interface Assessment {
  urgency: Urgency;
  specialties: string[];                 // engine's names, mapped to providers.specialty (§7)
  conditions: { name: string; probability: number }[]; // kept server-side; not shown in D1
  redFlags: string[];                    // engine-reported serious possibilities
}

export interface SymptomEngine {
  readonly name: "apimedic" | "infermedica";
  searchSymptoms(text: string, person: Person): Promise<Symptom[]>;
  /** Next question, or the assessment when the engine has enough. */
  next(person: Person, answers: Answer[]): Promise<{ question: Question } | { assessment: Assessment }>;
}
```

ApiMedic is single-shot (symptoms in, ranked conditions out), so its `next()`
returns the assessment straight away or asks one "do you also have…" question
from its proposed symptoms. Infermedica is an interview, so `next()` maps
directly to its diagnosis loop and then its triage and specialist calls.

**Urgency mapping**

| Infermedica triage level | ApiMedic signal | CareCall urgency |
|---|---|---|
| `emergency_ambulance`, `emergency` | — (our emergency screen) | `emergency` |
| `consultation_24` | red-flag warning on a chosen symptom | `urgent` |
| `consultation` | no red-flag warning | `routine` |
| `self_care` | — | `self_care` |

ApiMedic has no triage endpoint, so with ApiMedic the urgency is coarser: a
red-flag warning on any chosen symptom gives `urgent` and the warning text is
shown; otherwise `routine`. ApiMedic's red flags are conditional ("if the pain
is sudden and severe…"), so they don't jump straight to the 911 screen;
emergencies are caught by our own screen first. Another reason ApiMedic is only
the build-and-test engine.

**State:** the browser holds the answers so far and sends them with each call,
so the edge function stays stateless. The server keeps a `symptom_checks` row
per session only to count usage and record the outcome.

### Secrets

| Secret | Engine |
|---|---|
| `SYMPTOM_ENGINE` | `apimedic` or `infermedica` (empty = feature off) |
| `APIMEDIC_USERNAME`, `APIMEDIC_PASSWORD`, `APIMEDIC_SANDBOX` | ApiMedic API key, secret key; `true` uses the sandbox |
| `INFERMEDICA_APP_ID`, `INFERMEDICA_APP_KEY` | Infermedica |
| `SYMPTOM_MONTHLY_BUDGET` | Max engine calls per month across all clinics (default 90 for ApiMedic's free 100) |
| `GOOGLE_PLACES_API_KEY`, `PLACES_MONTHLY_BUDGET` | Nearby care lookups; key restricted to the Places API |

## 4. Safety rules

1. The emergency screen (step 2) is ours, in code, reviewed by a doctor, and
   runs even when the engine is down.
2. `emergency` from any source: the emergency screen (§4a), no booking, no
   "wait and see".
3. Every screen carries: "This is not a diagnosis. If you feel very unwell, call 911."
4. Engine errors or budget reached: "We can't run the check right now. Call the
   clinic at <number>, or 911 in an emergency." Never a silent failure.
5. No commercial influence: D1 is a clinic's own page, so nothing is ranked or sponsored.
6. A doctor (your brother's network) signs off the red-flag list, the wording
   and a set of test cases before any patient uses it.

### 4a. Emergencies

The Philippines' national emergency number is **911** (Unified 911, national
since September 2025 and still being rolled out area by area; the PNP's 117
also works). The emergency screen shows, in English and Filipino:

1. **[Call 911]**: a tap-to-call button (`tel:911`).
2. **Nearest emergency room** from the patient's location: name, distance,
   phone, directions; in Telegram also a map pin.
3. **What to tell the dispatcher:** "I'm at <address or landmark>", the main
   symptom, and the patient's age, ready to read out.
4. **Local numbers** where 911 coverage is weak: each clinic can add its
   city/municipal rescue and nearest-hospital numbers in Clinic settings.
5. While waiting: no food or drink, don't drive yourself, unlock the door, keep
   the phone on.

**CareCall does not call 911 for the patient**, in chat or in Voice:

- Dispatchers need to talk to the person: location, breathing, consciousness.
  An AI relaying second-hand adds delay and errors.
- Telnyx doesn't list the Philippines among the countries where it supports
  emergency calling, so a Telnyx line can't reliably reach 911 anyway.
- Calls from an automated system that can't answer follow-up questions risk
  being treated as nuisance calls, and the liability sits with CareCall.

**In Voice (later):** if a caller describes an emergency, the AI stops the
booking conversation, tells them to hang up and dial 911 now (in Filipino or
English), offers to send the nearest ER by chat, and flags the call in the
Review queue so the clinic can follow up. A later option is to message the
patient's emergency contact, with consent given in advance.

## 5. Abuse and cost controls

- Per-IP rate limit (reuse the `bump_booking_rate` pattern from `booking-api`).
- One session = one `symptom_checks` row; max 15 engine calls per session.
- Monthly budget per engine (`SYMPTOM_MONTHLY_BUDGET`); over budget → rule 4 above.
- Clinic setting `symptom_check_enabled` (off by default) and a global kill
  switch (empty `SYMPTOM_ENGINE`).

## 6. Data

```sql
create table symptom_checks (
  id uuid primary key default gen_random_uuid(),
  clinic_id uuid not null references clinics(id) on delete cascade,
  engine text not null,                    -- apimedic | infermedica
  created_at timestamptz not null default now(),
  age_band text,                           -- '0-17', '18-39', '40-64', '65+'
  sex text,
  symptom_ids text[],                      -- engine IDs only, never free text
  urgency text,                            -- emergency | urgent | routine | self_care
  entry text,                              -- telegram | web | clinic_page
  location_shared boolean not null default false,  -- coordinates themselves are never stored
  specialty text,
  engine_calls int not null default 0,
  outcome text,                            -- abandoned | advised | booked | emergency_shown
  appointment_id uuid references appointments(id)
);
-- RLS: clinic staff read their clinic's rows; writes only via the edge function.
-- Retention: pg_cron deletes rows older than 90 days.
```

Not stored: names typed during the check, free text, the condition list, location, IP addresses.

## 7. Booking from the result (D1c, built)

`symptom-check/booking.ts`, actions `slots` and `book`. Only for checks started
on a clinic's page, after a non-emergency result.

1. **Times:** `get_available_slots` (clinic timezone) for the clinic's active
   providers whose `specialty` shares a word stem with the result's first kind
   of doctor ("Pediatrics" ~ "Pediatrician"); all active providers if none
   match. `urgent` results only offer times **today**; others up to 10 days.
2. **Details:** first and last name, mobile (`normalizePhPhone`; international
   numbers allowed while testers are abroad, `ALLOW_INTERNATIONAL_PHONES`), date
   of birth. The page says the answers will be shared with the clinic.
3. **Patient:** found on `(clinic_id, phone, date_of_birth)` or created. An
   existing patient's record is never edited from this public page, and the
   response doesn't say whether the patient existed.
4. **Book:** the slot is re-checked against `get_available_slots`, then inserted
   with `source = 'symptom_check'` and idempotency key `check:<id>` (one booking
   per check). The `no_double_booking` constraint catches races (`slot_taken`).
5. **Intake:** the appointment stores `intake` (urgency, kind of doctor, age
   band, sex, symptom names, PH warnings). Staff see it under **Appointments** on
   the patient's page. It is the clinic's record of the visit, so it stays with
   the appointment; `symptom_checks` keeps its 90-day deletion.
6. `symptom_checks.outcome = 'booked'` and `appointment_id` link the check to
   the visit, which is what the outcome comparison in §8a needs.

## 8. Regulation and privacy (to confirm before going live)

- **PH FDA, Center for Device Regulation:** check whether symptom-assessment
  software needs registration as a medical device. Showing urgency and the kind
  of doctor (not condition names) is the conservative position for D1.
- **Data Privacy Act / NPC:** consent screen, a privacy notice, the minimal
  storage in §6, and the engine as a personal-information processor (a data
  processing agreement with Infermedica).
- **Engine terms:** ApiMedic's free tier and Infermedica's trial are for
  testing; patient use needs a commercial agreement.

## 8a. Fitting the engine to the Philippines

**Status:** built as `_shared/symptom/ph_layer.ts` (rules version
`draft-2026-10-12`, awaiting doctor sign-off): PH questions (days of fever,
flood water, cough of 2+ weeks), an animal-bite search item, 8 rules (animal
bite, dengue warning signs, leptospirosis, child dehydration, fever over a
week, jaundice, dengue watch, TB cough) that only raise urgency, fired rules
saved in `symptom_checks.ph_rules`, Infermedica region evidence via
`INFERMEDICA_EXTRA_EVIDENCE`, and PH test cases in `ph_layer_test.ts`.
Next: doctor review of rules, wording and cases; confirm Infermedica's region
risk factors on the trial; outcome comparison once booking from the result
(D1c) links a check to a visit.

Infermedica's knowledge base is built in Europe, and disease patterns differ in
the Philippines: dengue, leptospirosis after floods, typhoid, TB and other
endemic infections are far more common. Rather than building our own engine,
CareCall adds a thin Philippine layer around a validated one:

1. **Tell the engine where the patient is.** Infermedica takes risk factors as
   evidence; send the region (residence in Southeast Asia) and recent travel, if
   the trial confirms such risk factors exist, so its probabilities shift.
2. **Our own Philippine rules, owned by a doctor.** Deterministic, reviewed
   rules applied after the engine, which can only raise urgency, never lower it:
   DOH dengue warning signs, fever after flood water (leptospirosis), a cough
   for 2+ weeks (TB, with free testing at health centers). The demo engine shows
   what these look like; the doctor writes the real ones.
3. **Measure it here.** A doctor-written set of Philippine test cases is run
   against the engine before go-live and after every engine update, and (with
   consent, later) the check's advice is compared with what the doctor found at
   the visit. That data shows where the engine is off for Filipino patients.
4. **AI only for language.** Claude or a local model may turn Filipino, Taglish
   or Cebuano free text into engine symptom IDs (D3). It never decides urgency.

Building our own knowledge base plus a local language model as the engine was
considered and rejected for now: a validated medical knowledge base takes
years of clinician work, language models give inconsistent answers to the same
symptoms, and an engine of our own would make CareCall the maker of a medical
device under the PH FDA, with the clinical evidence and liability that brings.
The outcome data from step 3 is what would make our own engine possible later.

## 9. Delivery slices

| Slice | Scope | Needs |
|---|---|---|
| **D1a** | Engine interface, demo engine + ApiMedic adapter, `symptom-check` function, emergency screen with 911 and local numbers, `/check` page up to the result, Telegram `/check` entry, `symptom_checks`, clinic switch, CC wiki page | ApiMedic sandbox account |
| **D1b** | Nearby care: location from Telegram or the browser, Google Places lookup, nearest ER on the emergency screen, CareCall clinics first (clinic `lat`/`lng`) | Google Cloud project + Places API key |
| **D1c** | Booking for new patients from the result, staff view of the check. **Built** | D1a |
| **D1d** | Infermedica adapter (interview, triage, specialist); switch `SYMPTOM_ENGINE`. Adapter **built** and tested against a fake API; live test needs the trial. Then the Philippine layer (§8a) | Infermedica trial (organization + business email) |
| D2 | CareCallPH.com: the same check as the public front door, many CareCall clinics | Gates in ROADMAP Phase D |
| D3 | Filipino / Cebuano free-text intake (Claude maps words to engine symptom IDs only); start a check from a chat app | D1c |

## 10. Test cases (doctor to extend)

| Input | Expected |
|---|---|
| Chest pain, sweating, 58 M, location shared | Emergency screen catches it; no engine call; 911 button and nearest ER shown |
| Fever 3 days, cough, 30 F | routine (or urgent), GP / Internal medicine, booking offered |
| Runny nose, sneezing, 25 M | self_care, optional booking |
| Severe headache + stiff neck + fever | emergency from engine; no booking |
| Engine down / over budget | Rule 4 message with the clinic number |
| Location skipped | Advice shown; "share your location or type your town to see nearby care" |
| Places API down / over budget | OpenStreetMap results, else 911 / barangay health center message |
