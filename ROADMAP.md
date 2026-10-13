# CareCall + CareLink roadmap

**Last updated:** 13 October 2026

**Status key:** **Done** = built and verified live. **Built** = code complete,
type-checked and building, not yet run against live Supabase / Telnyx / chat
platforms. **Planned** = designed, not started. **Idea** = worth doing, not yet designed.

## Product progression

CareCall starts as patient engagement for small Philippine clinics and grows
into CareLink, a records, clinical-workflow and remote-monitoring layer. Six services on one
platform, in this order. Business case, pricing hypotheses and indicative
economics are in the concept paper (*CareCall + CareLink: a connected
healthcare access and continuity platform for Southeast Asia*, Oct 2026).

| Service | What it does | Engineering phases | Status |
|---|---|---|---|
| **CareCall Recall** | Re-engage existing patients by chat; due follow-ups and missed visits become booked appointments | 1, 1T, 1C | **Built**; first commercial MVP |
| **CareCall Discover** | Free-to-patient symptom-guided navigation and booking with participating clinics at CareCallPH.com | D | **Built** on the demo engine (symptom check, Philippine layer, booking, `/check`); live engine waits on the Infermedica trial |
| **CareCall Voice** | AI outbound calls for non-responders; later the inbound receptionist | Base, 0b, 2 | Outbound **Done** in US build; PH work deferred until after Discover |
| **CareLink Records** | FHIR patient timeline; store observations or access authorized EHR records | L | **In progress**: FHIR R4 export with PH Core profiles **done** (F1) |
| **CareLink Care** | Clinical workflows in the clinic: roles, medicine reminders, clinical notes by voice, then prescriptions and vital signs | M | **In progress**: roles, medicine reminders, vital signs by chat and clinical notes (demo) **done** |
| **CareLink RPM Intelligence** | Device readings, trends and a prioritized clinician review queue | R | **Idea** (later clinical pilot) |

**Delivery stages** (indicative, may overlap; each opens only when its gate is met)

| Stage | Priority | Gate |
|---|---|---|
| 0–3 months | Recall clinic pilots and appointment outcome reporting | Validated messaging economics, consent and scheduling |
| 3–6 months | Discover: symptom check with nearby care, by Telegram and web (D1), then CareCallPH.com (D2) | D1: doctor-reviewed safety rules, engine agreement. D2: clinical governance and safe matching |
| 6–9 months | CareLink FHIR demonstrator | Secure records and authorized integration |
| 9–18 months | Voice add-on; selected EHR/device integrations and RPM clinical pilot | Carrier economics; clinical validation, oversight and jurisdiction-specific compliance |

The Philippines is the reference market; channel adoption, clinical
regulation, privacy law, provider economics and EHR access are assessed country
by country before any Southeast Asian expansion.

## Where we are

| Phase | Scope | Status |
|---|---|---|
| Base | Outbound AI scheduling (inherited from CareCall US) | **Done** in the US build; needs re-verifying on PH accounts |
| 0a | PH accounts for the Recall pilot: Supabase, Vercel, Telegram | **In progress**: accounts done; README §9 pilot test under way |
| 0b | PH telephony for Voice: Telnyx, carrier test, call-detection tuning | **Deferred**: Voice moved after Discover |
| 1 | Chat channels: Viber, Messenger, WhatsApp, Telegram | **Built** |
| 1T | Chat-first pilot: chat campaigns, staff invites, Telegram first | **Built** |
| 1C | CC assistant, LLM wiki, nightly review | **Built** |
| 2 | Inbound: AI receptionist, appointment requests and changes | **Planned** |
| 3 | Localization and compliance hardening | **In progress**: roles, auto sign-out, PH patient fields, retention setting, patient data requests done |
| 4 | Pilot and commercial launch | **Planned**: founding-clinic Recall pilots first |
| D | CareCall Discover: symptom check with nearby care (D1), then CareCallPH.com (D2) | **In progress**: D1a, b, c, e, f built; D1d needs the Infermedica trial |
| L | CareLink Records: FHIR-ready records (PH Core), FHIR timeline and authorized EHR access | **In progress**: F1 **done** (export incl. clinical notes; `docs/fhir-design.md`) |
| M | Care plans and clinical notes: roles, medicine reminders, clinical notes by voice, prescriptions, vital signs | **In progress**: M0 roles, M1 medicine reminders, M3 vital signs, M4 reports and alerts, M5 plan dictation, M6 clinical notes demo **done**; M2 prescriptions next (`docs/care-plan-design.md`) |
| R | CareLink RPM Intelligence: device readings and review queue | **Idea** |

**Next three actions**

1. **Pilot clinic demo**: chat booking and reminders, symptom check, medicine
   reminders and clinical notes (dictate and record). Ask the clinic's doctor
   to review the PH symptom rules, the consent wording and the note prompts;
   compare speech-to-text services on 10–20 Taglish dictations.
2. Domain and business email → Infermedica trial (D1d). Then turn
   international patient numbers off for the pilot.
3. Legal and approvals: confirm e-prescription rules (M2) and the DOH records
   retention circular; processing agreements (Supabase, Anthropic, Google,
   Telnyx, Meta, Viber, Telegram); Meta business verification and a Viber
   commercial agreement.

---

## Base: inherited from CareCall US

Done and verified end to end in the US build (August 2026):

- Campaign engine with status machine, calling-hours gate, DNC, 1-minute cron sweep
- Telnyx AI voice: premium AMD gate, server-side DOB verification, progressive
  slot disclosure, idempotent booking, DB-level double-booking prevention
- Pre-call SMS, voicemail SMS fallback, self-booking links
- Portal: roles (admin / clinic admin / staff), multi-clinic RLS, Review queue,
  call history with transcripts and summaries, clinicians and availability

## Phase 0a: PH accounts for the Recall pilot

Everything the chat-only Recall pilot needs. No phone account required.

| Item | Status |
|---|---|
| New repo from CareCall US (`upstream` remote is set per clone, see README §1) | **Done** |
| Phone normalization: accept `09xx…` / `9xx…`, store `+639xx…` (import, add patient, clinic callback number; `/book` takes no phone) | **Built** |
| Defaults: clinic timezone `Asia/Manila`, PH-friendly calling hours (Mon–Fri 08–18, Sat 08–12), `+63` placeholders in the portal | **Built** |
| `BookPage` timezone label for `Asia/Manila` ("Philippine Time (PHT)") | **Built** |
| Supabase project in Singapore; migrations, Vault secrets, functions deployed | **Done**: project `fpoiparkhyiqxrcktshy`, all migrations, cron running |
| `supabase/config.toml` `project_id` set to the new project | **Done** |
| Migrations apply on a new Supabase project (`gen_random_uuid()`; enum values compared as text) | **Built**: full chain tested on a local Supabase stand-in |
| Vercel portal with `VITE_*` variables | **Done** |
| CC turned on: `ANTHROPIC_API_KEY` function secret, `cc-chat` and `cc-nightly` deployed | **Done** |
| Telegram bot and webhook (`docs/messaging-channels.md` §3) | **Done** |
| Chat-only pilot test (README §9) passes | In progress (testers in the US and Singapore) |
| Turn international patient numbers back off (`ALLOW_INTERNATIONAL_PATIENT_PHONES` in `web/src/pages/Patients.tsx` and `ALLOW_INTERNATIONAL_PHONES` in `supabase/functions/symptom-check/booking.ts`, temporarily `true` for testing outside the Philippines) | Before the PH pilot |
| Restore timezone-correct slot generation (`get_available_slots` with `p_tz`), lost when the repo was flattened; booking links and voice slot tools need it | **Built**: migration `20261013010000` |

## Phase 0b: PH telephony for Voice

**Deferred** (12 Oct 2026): Voice moves after Discover. Needed before the Voice
add-on, not for the Recall pilot or the symptom check.

| Item | Status |
|---|---|
| AI voice instructions for the Philippines: Filipino/Taglish, "po/opo", PH date and time phrasing, 911 for emergencies, no reminder promise | **Built** |
| Telnyx account: number, Call Control app, AI Assistant, Messaging Profile | Planned |
| Carrier test: call and SMS to Globe, Smart, DITO; check caller ID display | Planned |
| Call-detection tuning: ringback tunes and "subscriber cannot be reached" announcements (from real test-call recordings) | Planned |
| Full smoke test (README §8) passes on PH accounts | Planned |

## Phase 1: Chat channels

**Built** (2026-10-01):

- `patient_channels`, `channel_invites`, `channel_messages`; `patients.preferred_channel`
- `_shared/channels.ts`: channel resolution by PH reach (Viber → Messenger →
  WhatsApp → Telegram → SMS), senders, invites, message log, auto opt-out on block
- `channel-webhook`: Viber, Messenger, WhatsApp, Telegram with signature checks;
  YES / STOP / BOOK keywords in English, Filipino and Cebuano; family accounts
- `/connect/<token>` opt-in page; pre-call and voicemail messages routed through the channel layer

**Phase 1b: planned**

| Item | Why |
|---|---|
| Messenger and WhatsApp utility templates | Reminders outside the 24-hour window |
| Rich replies on Viber / Messenger / WhatsApp (keyboards, quick replies) | Telegram buttons **done**; same replies, so other apps only need the send side |
| Clinic settings toggle: nightly review | Self-booking and chat invites moved to Clinic settings in 1T |
| Staff inbox over `channel_messages` with replies | Patients write back; today they get an auto-reply |
| Clinic-wide front-desk QR code | Per-patient QR codes exist (1T); a clinic-wide one needs patient matching |
| Delivery receipts (Viber `delivered/seen`, Meta statuses) into `channel_messages` | Accurate channel analytics |

## Phase 1T: Chat-first pilot

Lets a clinic pilot CareCall with chat apps alone, before Telnyx is live, and
matches the chat plan in the concept paper (booking links by chat, no calls).

**Built** (2026-10-11):

| Item | Notes |
|---|---|
| Chat campaigns (`outreach_mode = 'chat'`) | Booking link by chat app (or SMS with consent), one reminder, no calls; `messaged` / `needs_invite` statuses |
| Invite to chat (patient page, `channel-invite`) | Link, QR code, English and Filipino messages; no SMS needed |
| Patient page: Chat apps and Messages | Channel status, consent time, last 20 messages |
| Clinic settings: self-booking and chat-invite switches | Were SQL-only |
| Re-queue on YES | A `needs_invite` patient who connects is messaged automatically |
| Birthday check when a chat is linked | Date of birth before YES; 2 wrong dates lock the invite; not stored as typed |
| Patients unique per clinic | `(clinic_id, phone, date_of_birth)`; one app and one Supabase project serve every clinic; one person can be a patient at several clinics |
| Patient pages load on their own | `/book` and `/connect` ~58 KB gzipped, no staff portal code |
| Telegram setup guide and chat-only pilot runbook | `docs/messaging-channels.md` §3, README §9 |

**Channel approvals**

| App | What it needs | Status |
|---|---|---|
| Telegram | BotFather bot, free | Ready to set up |
| Messenger | Meta business verification + app review (`pages_messaging`) | Planned: apply now |
| WhatsApp | Meta business verification + approved message templates | Planned |
| Viber | Commercial agreement, €100/month per bot + per-message fees | Planned: apply now |

**Next:** chat campaigns that fall back to an AI call when there's no reply
(needs Telnyx); appointment reminders 24 and 2 hours before (Phase 2c).

## Phase 1C: CC assistant

**Built** (2026-10-01 / 02):

- `cc-chat` with Claude tool loop: wiki lookup, navigation buttons, campaign
  report, Review queue summary, action items; aggregate data only; RLS-scoped
- CC wiki (`docs/cc-wiki/`, 16 pages incl. two guided setups), build script, CI check
- **CC action items** page with sidebar badge
- **Nightly review** (`cc-nightly`, 02:00 Manila): per-clinic analysis, up to 5
  action items, summary on the action items page; usage logged
- Opened from the sidebar logo (2026-10-12); **History** of up to 20 chats per
  user, kept in the browser only

**Planned**

| Item | Notes |
|---|---|
| Wiki pages for every Phase 0–2 feature as it ships | Rule: no wiki page, not done |
| Persist CC conversations server-side | History across devices; lets admins see what users ask; feeds wiki gaps. Browser-only history is built |
| "Wiki gap" log | CC records questions it couldn't answer from the wiki |
| Wizard prefill | e.g. open New campaign with fields from the chat |
| Morning digest by email or Viber to clinic admins | Pushes the nightly summary out |
| Cost dashboard from `cc_usage` | Per-clinic CC cost |

## Phase 2: Inbound, the AI receptionist

Patients call or message the clinic to book, change or cancel appointments, or
ask questions. The same tools serve voice and chat.

**2a. Inbound voice receptionist**

- **Number strategy.** Mom-and-pop clinics will want to keep their existing
  number. Primary path: **conditional call forwarding** from the clinic's
  mobile or landline (busy / no answer / after hours) to a CareCall Telnyx
  number. Secondary: a new local Telnyx number, if PH inbound DIDs are available.
- **Caller lookup.** Match caller ID to patients; if several share the number
  (family), ask whose appointment it's about; verify with DOB (reuse `verify_patient`).
- **Intents and tools:**
  - book new: reuse `get_appointment_slots` / `create_appointment` with an
    inbound appointment type,
  - `find_appointments`: upcoming appointments for the verified patient,
  - `reschedule_appointment` / `cancel_appointment`: within clinic policy
    (minimum notice), audited,
  - `get_clinic_info`: hours, address, directions, services, fees, accepted
    HMOs and PhilHealth, from a new clinic profile,
  - `take_message`: name, number, reason, into the staff inbox,
  - `transfer_call`: warm transfer to staff during hours,
  - emergency language: tell the caller to hang up and call 911; never triage.
- **New patients** (number not on file): capture name, mobile, DOB and reason
  as a new-patient request for staff; optional per clinic: allow direct booking.
- **After hours:** full self-service plus messages for the morning.

**2b. Inbound chat agent**

- Replace the keyword bot with an LLM agent on Viber / Messenger / WhatsApp /
  Telegram using the same tools as 2a; keywords stay as fast paths.
- Human handoff into the staff inbox (Phase 1b) when asked or unsure.

**2c. Appointment reminders and confirmations**

- **Built** (2026-10-12): reminder 24 hours and 2 hours before, on the
  patient's channel, 07:00–21:00 clinic time, per-clinic switch: reply **1** (C)
  to confirm, **2** (R) to ask for a new time (CC action item for staff),
  **3** (X) to cancel (slot freed, action item). Shown on the patient page.
- **Built** (2026-10-13): **change the time by chat**: reply 2 (or tap Change
  time) offers up to six open times with the same doctor; the patient picks one
  and the appointment moves (fresh reminders for the new time, CC action item);
  OTHER asks staff, KEEP changes nothing. **Telegram buttons** on reminders,
  medicine check-ins, consent requests and chat replies.
- `appointments.status` confirmed / no_show tracking; no-show rate in CC reports.

**2d. Portal and data**

| Item | Notes |
|---|---|
| Clinic profile editor (hours, address, services, fees, HMOs, policies) | Source for `get_clinic_info` |
| Staff inbox: messages, new-patient requests, callback requests | Shared with Phase 1b inbox |
| Inbound call log with transcript and outcome | Extends Call history |
| Appointment change audit (`appointment_changes`) | Who changed what, via which channel |
| Calendar view of appointments by clinician | Front-desk day view |
| CC: inbound volume, top call reasons, missed-call rate in reports and nightly review | Plus wiki pages for all of the above |

**Dependencies and risks**

- Telnyx inbound coverage for Philippine numbers, and how forwarded calls
  present caller ID (needed for patient lookup).
- Tagalog / Taglish / Cebuano speech recognition quality: inbound callers
  won't adapt to English the way outbound calls can set the tone. Test before building.
- Concurrency: several simultaneous inbound calls per clinic at peak times.

## Phase 3: Localization and compliance

| Item | Notes |
|---|---|
| Voice prompts in Filipino / Taglish and Cebuano; per-patient language | Choose STT/TTS voices by measured accuracy |
| PhilHealth PIN, barangay / city / province fields | **Done** (F1); PSGC pickers and HMO planned |
| Philippine public holidays in slot generation | Regular and special non-working days |
| Telnyx webhook signature verification | `telnyx-signature-ed25519` in `telnyx-call-events` |
| Data Privacy Act package | Privacy notice and consent text for clinics, DPO contact, breach-response runbook, NPC registration check |
| Records retention | **Done**: 7 years after the last consultation by default, per clinic, review list; nothing deleted automatically |
| Purge jobs | Messages, call transcripts and recordings deleted on a schedule (symptom checks: 90 days, done) |
| Patient data requests | **Built**: log requests (any staff), answer (clinic admins): access via FHIR download, correction, restriction (view-only, no messages or calls, liftable), erasure (deletes what needn't be kept, rest view-only until retention ends), disposal after retention with a disposal record and audit-log redaction (L F5) |
| Clinical roles and sessions | **Done**: access level + clinical role in the database; sign-out on browser close and after 20 minutes idle |
| Recording access controls | Signed URLs, role-gated |
| Processing agreements | Supabase, Telnyx, Anthropic, Google (Gemini), Meta, Viber, Telegram |

## Phase 4: Pilot and commercial

| Item | Notes |
|---|---|
| 1–3 pilot clinics (Manila and Cebu) | Measure bookings, no-shows, staff time saved |
| Clinic self-onboarding | Sign-up, clinic profile, clinicians, first campaign via CC wizard |
| Unit cost model | Telnyx minutes and SMS, Viber per-message and monthly fees, Meta conversations, Claude tokens |
| Pricing and billing | Per-clinic subscription plus add-ons (hypotheses below) |
| Founding-clinic programme | Up to 12 months limited free service, transparent usage allowances, explicit paid conversion |
| Outcome measurement | Recall: contacted → replied → booked → attended, with an estimate of incremental visits |
| Support playbook | Using CC action items and the wiki |

---

**Pricing hypotheses** (unvalidated; from the concept paper)

| Module | Hypothesis |
|---|---|
| Recall | ₱1,500 / clinic / month |
| Discover | ₱2,500 / subscribing clinic / month, or a compliant acquisition-based fee |
| Voice | ₱3,500 / clinic / month add-on, or ₱75 per AI-booked appointment |
| CareLink records / workflows | ₱3,000–10,000 / clinic / month (model uses ₱5,000) |
| RPM intelligence | ₱100 / monitored patient / month (enterprise) |

---

## Phase D: CareCall Discover

Public patient entry point. A patient describes symptoms, gets medically
governed care-navigation guidance, sees suitable participating clinics and books
into real availability. Design: `docs/symptom-check-design.md`.

**D1: symptom check with nearby care** (next)

| Slice | Scope | Status |
|---|---|---|
| D1a | `SymptomEngine` interface, built-in **demo engine** (made-up rules, DEMO banner), public `symptom-check` function, our own emergency screen (tap-to-call 911, local rescue numbers, no booking), `/check` page up to the result, Telegram `/check` entry, `symptom_checks` (minimal, 90-day retention), clinic switch, CC wiki page | **Built**: runs with `SYMPTOM_ENGINE=demo` (README §10) |
| D1b | Nearby care: location from Telegram or the browser, Google Places lookup, nearest ER on the emergency screen; CareCall clinics first, other facilities by distance only, no booking | **Built**: Places API (New) Nearby and Text Search; CareCall clinics first (Clinic settings → Find on map); Telegram location; monthly budget; location never stored. OpenStreetMap fallback not built |
| D1c | Book from the result as a new patient (clinic page, non-emergency; urgent = today only); staff see the shared summary under Appointments on the patient page | **Built** |
| D1d | Infermedica adapter (interview, triage, specialist); switch engines by secret | **Built**, tested against a fake API: needs the Infermedica trial (organization + business email) |
| D1f | One public page (`/check`) with a clinic picker: participating clinics ordered by matching doctor, then soonest open time; clinic links skip it. Clinic link made automatically (name + random number) with copy and QR code | **Built** (early D2) |
| D1e | Philippine layer: PH questions (fever days, flood water, long cough), 8 draft PH rules (animal bite, dengue, leptospirosis, child dehydration, long fever, jaundice, TB) that only raise urgency, fired rules saved per check, Infermedica region evidence, PH test cases (design §8a) | **Built** (draft rules): needs doctor sign-off; outcome comparison after D1c |

CareCall never calls 911 for the patient: dispatchers need the person, and
Telnyx doesn't list PH emergency calling. In Voice, the AI tells the caller to
dial 911 and sends the nearest ER by chat.

D1 shows urgency and the kind of doctor, not condition names. Before any patient
uses it: a doctor signs off the red-flag list, wording and test cases; PH FDA
(medical device software) and Data Privacy Act checks; a commercial engine agreement.

**Engine options reviewed (12 Oct 2026)**

| Engine | Verdict |
|---|---|
| ApiMedic (priaid) | Was the test engine; website and API appeared offline in October 2026. Adapter kept, unused; replaced by the built-in demo engine |
| Infermedica | Go-live candidate: interview, triage, specialist; trial needs an organization and business email |
| Isabel | Strong clinically, but access by request only; no advantage over Infermedica for us |
| Open-source rule engines | Not for patients: no clinical validation |
| Own knowledge base + local LLM | Not now: years of clinician work to validate, inconsistent LLM answers, and CareCall would become a medical device maker. Instead a Philippine layer around Infermedica (D1e), whose outcome data could support our own engine later |

**D2 and later**

| Item | Notes |
|---|---|
| CareCallPH.com public portal | Patient-facing; free symptom assessment within a defined budget |
| Provider matching | CareCall clinics with booking first; other facilities by distance only, never sponsored; clear disclosure that listings aren't exhaustive |
| Safety rules | Commercial listings never affect triage; emergencies never routed to paid listings; care-seeking guidance even with no match |
| Filipino / Cebuano intake (D3) | Claude maps free text to engine symptom IDs only, never assesses; start a check from a chat app |

**Gate for D2:** engine contract, clinical governance and safe matching; legal
review of paid referral / fee-splitting restrictions.

## Phase L: CareLink Records

Records stay in CareCall's tables, shaped so each maps to a FHIR R4 resource
with the Philippine profiles (PH Core, draft v0.2.0); CareCall produces FHIR on
request. Design: `docs/fhir-design.md`.

| Slice | Scope | Status |
|---|---|---|
| F1 | Patient middle name, sex, address, PhilHealth PIN; clinic DOH facility code and address; `fhir` export (Patient, Practitioner, Organization, Appointment, MedicationRequest, MedicationAdministration, Consent; `Patient/$everything` Bundle), **Download record (FHIR)** for nurses and doctors, audited | **Done** |
| F2 | Symptom-check intake as QuestionnaireResponse; PSGC pickers (barangay, city, province codes); official HL7 validator with PH Core in CI | Planned |
| F3 | M2 prescriptions with FDA drug codes, M3 readings as Observations (LOINC, UCUM), CarePlan, clinical notes (M6) as Encounter + Composition | With M2/M3/M6 |
| F4 | Patient-directed import, exchange with PhilHealth or hospitals, SMART on FHIR | Planned |
| F5 | Patient data requests (Data Privacy Act): access (FHIR download), correction (Edit details, addenda), and erasure: stop all messages and processing at once, delete what the clinic needn't keep (chat links and messages, symptom checks, campaign history), restrict the medical record to view-only until its retention period ends, then dispose with a record of disposal | **Built** |

| Item | Notes |
|---|---|
| FHIR R4 export | Built (F1); a FHIR store is not planned: tables stay the system of record |
| Patient timeline | For clinics without a suitable system, and for patient-held records |
| Patient-directed import from US EHRs | US patient-access FHIR APIs; first users could be Filipinos retiring home |
| Authorized EHR integration | University of the Philippines-associated EHR is a lead to identify and verify, not an established interface |
| Consent and access | Purpose-limited, patient-controlled sharing under the Data Privacy Act |

**Gate:** secure records and authorized integration.

## Phase M: Care plans (medicines and vital signs)

The doctor or an assistant writes the prescription in CareCall; the doctor
signs it. The same entry gives the pharmacy prescription (PDF / print, with
PRC and PTR numbers, generic names) and the patient's medicine reminders by
chat. The doctor can also ask for vital signs (blood pressure, blood sugar…)
by chat, with limits they set; out-of-range readings go to **Readings to
review**, dangerous ones also tell the patient to seek care or call 911.
Nothing is sent before the patient agrees in the chat (recorded consent,
withdraw any time). Design: `docs/care-plan-design.md`.

| Slice | Scope | Status |
|---|---|---|
| M0 | Clinical roles: front desk / nurse-assistant / doctor per user, separate from access level (platform admin, clinic admin, staff); doctor linked to their clinician record and PRC number; enforced in the database | **Done** |
| M1 | Consent in chat; medicines added by a nurse or doctor; reminders with 1 taken / 2 skipped, missed doses, adherence; STOP REMINDERS | **Done** |
| M2 | Prescriptions: draft (assistant/doctor), sign (doctor), PDF and print, send by Telegram, verify page; feeds M1 | **Designed**: confirm e-prescription rules first |
| M3 | Vital signs: a monitoring plan the doctor signs like a prescription (what, when, how, why, targets, what to do if high or low), sent to the patient; chat requests, reading parser, Readings to review, critical-reading message, chart | **Built**: plan drafted by a nurse or doctor, signed by a doctor (password), versions; vitals consent in chat and plan sent after YES; requests at the plan's times, replies parsed (BP, glucose, temperature, weight, SpO₂, unit conversion), checked against the doctor's limits; out-of-range and critical replies and CC action items; Readings to review; staff readings; chart; FHIR Observation + CarePlan. Before patient use: doctor sign-off on default limits and wording |
| M4 | Adherence and readings reports in CC; missed-dose and no-reading alerts; FHIR groundwork for Phase R | **Built**: hourly alerts (3 missed in a row, no readings for 3 days) as clinical CC action items, once per streak; CC `care_report` (adherence and bands, response rate, readings to review, BP trend; counts only) in chat and the nightly review; clinical action items shown to nurses and doctors only and patient names kept from CC; device-readings mapping noted in `docs/fhir-design.md` |
| M5 | **Dictate to CC** (doctors): a microphone button in CC; the doctor says the medicines or the monitoring plan, CC fills in a **draft** prescription or plan for the doctor to check, edit and sign. Never signs or sends by itself | **Monitoring plans built**: **Dictate a plan** on the patient page (speak or type), Gemini speech-to-text, Claude drafts the measures with structured output, never adds an unsaid limit or time, lists what to check; the doctor edits, saves and signs. Prescriptions part waits on M2 |
| M6 | **Clinical notes** (doctors): the doctor records the consultation note by voice (dictation after the visit first; recording the consultation itself only with the patient's consent); CC transcribes (English, Filipino, Taglish) and drafts a structured note (SOAP: complaint, findings, assessment, plan) for the doctor to edit and sign. Notes visible to nurses and doctors only, never front desk. FHIR: Encounter + Composition | **Demo done**: dictate / record with consent / type, Gemini speech-to-text (typing without a key), CC SOAP draft, doctor signs, addenda, FHIR Encounter + Composition; records retention setting and review list. Before patient use: doctor review of the prompts, speech-to-text comparison, privacy review |

**Gate:** doctor sign-off on default limits, wording and escalation; agreed
review times at the pilot clinic; e-prescription rules confirmed. Dangerous
drugs (S2) are out of scope.

## Phase R: CareLink RPM Intelligence

| Item | Notes |
|---|---|
| Device bridge | Cellular devices via vendor cloud; Bluetooth devices via a phone bridge app |
| Normalization | Readings → FHIR Observation with LOINC codes |
| Review queue | Clinician-approved thresholds first; AI prioritization only after feasibility and clinical validation |
| Measures | Clinically important events detected, false negatives, unnecessary alerts, clinician workload, time to intervention |

**Gate:** clinical validation, clinical oversight and jurisdiction-specific
compliance. Pseudonymized RPM data is still sensitive health data.

---

## Changelog

| Date | Change |
|---|---|
| 2026-10-13 | Dictate a monitoring plan (M5): speak or type the plan, CC drafts the measures (never invents a limit or time) and lists what to check; the doctor edits and signs. Shared microphone recorder for notes and plans |
| 2026-10-13 | Patient data requests (Phase 3, L F5): log and answer access, correction, restriction and erasure requests; restricted records view-only with no messages or calls; disposal after the retention period with a disposal record and audit-log redaction |
| 2026-10-13 | Care plan reports and alerts (M4): missed-dose and no-reading alerts, CC care report, nightly review of care plans; fix: action items about readings were visible to front desk and their patient names reached CC |
| 2026-10-13 | Vital signs by chat (M3): monitoring plans (draft, doctor signs, versions), vitals consent, reading requests and replies with the doctor's limits, critical-reading 911 message, Readings to review, staff readings, chart, FHIR Observation (LOINC, UCUM) and CarePlan; STOP REMINDERS reply names what stopped |
| 2026-10-13 | Nearby care: first live test showed personal listings tagged "hospital" at the search point; results now need a phone, website or 3+ reviews (plus-code-only addresses need a phone) |
| 2026-10-13 | Nearby care (D1b): nearest ERs on the emergency screen, CareCall clinics and other nearby care on the result (browser location or typed town), clinic picker by distance, Telegram location, clinic map location; Places budget |
| 2026-10-13 | Telegram buttons (reminders, doses, consent, opt-in, BOOK / check symptoms); change the appointment time by chat, with fresh reminders for the new time |
| 2026-10-13 | Docs: architecture (`docs/architecture.md`), README features, roadmap status, CC navigation and what's new, About page. Clinical notes, FHIR export, roles and medicine reminders verified live |
| 2026-10-13 | Fix: clinic admins can save Clinic settings for their own clinic (only platform admins could; the page said "saved" but nothing changed); switching a clinic on or off and the retention period stay with platform admins |
| 2026-10-13 | Clinical notes demo (M6): dictate, record a consultation with consent, or type; Gemini speech-to-text (audio never stored); CC drafts a SOAP note; doctors sign; addenda; notes in the FHIR export. Records retention: platform default 7 years, per-clinic value, records due for review. Planned: patient data requests (deletion, restriction) |
| 2026-10-13 | FHIR-ready records (L, F1): records stay relational, FHIR R4 with PH Core on request; patient middle name, sex, address, PhilHealth PIN; clinic DOH facility code and address; `fhir` export and **Download record (FHIR)**; clinical notes by voice added to Phase M (M6, idea) |
| 2026-10-13 | Automatic sign-out: when the browser (or every CareCall tab) closes, and after 20 minutes without activity with a 2-minute warning; sidebar scrolls so Sign out is always reachable |
| 2026-10-13 | Clinical roles (M0): front desk / nurse-assistant / doctor on the Users page; medicines and reminder consent limited to nurses and doctors in the database; front desk sees intake urgency only; doctor login linked to a clinician with PRC number; platform admins shown and assignable by platform admins |
| 2026-10-12 | Care plans M1: medicine reminders by chat with recorded consent, 1 taken / 2 skipped, missed doses, adherence on the patient page |
| 2026-10-12 | Phase M designed: prescriptions in CareCall feeding medicine reminders, vital signs by chat with doctor's limits, chat consent |
| 2026-10-12 | Appointment reminders (2c): 24h and 2h chat reminders, replies 1 confirm / 2 new time / 3 cancel, action items, patient page status |
| 2026-10-12 | Clinic settings: one switch for the symptom check, link made automatically with copy and QR; one public page `/check` with a clinic picker |
| 2026-10-12 | Book from the symptom check (D1c), Appointments on the patient page; restored `get_available_slots(p_tz)` (booking links failed without it) |
| 2026-10-12 | Philippine layer (D1e): PH questions and draft rules around every symptom engine, rules recorded per check, PH test cases |
| 2026-10-12 | Demo symptom engine and Infermedica adapter; ApiMedic appeared offline; Philippine layer planned (D1e) |
| 2026-10-12 | Symptom check D1a built: `/check` page and Telegram `/check`, emergency screen with 911 and local numbers, ApiMedic adapter, `symptom_checks` with 90-day retention, Clinic settings section |
| 2026-10-12 | Discover D1 symptom check designed (ApiMedic to build, Infermedica to go live; Telegram entry, nearby care by location, 911 emergency screen); Voice and Phase 0b deferred until after Discover |
| 2026-10-12 | CC opens from the sidebar logo (wordmark → About); CC chat History in the browser; Phase 0a accounts set up, pilot test under way |
| 2026-10-11 | Phase 0 split into 0a (Recall pilot accounts) and 0b (telephony for Voice); AI voice instructions adapted for the Philippines |
| 2026-10-11 | Product progression CareCall → CareLink (Recall, Discover, Voice, CareLink Records, RPM), delivery stages and gates, phases D / L / R, pricing hypotheses |
| 2026-10-11 | Chat birthday check, per-clinic patient uniqueness, lighter patient pages |
| 2026-10-11 | Phase 1T chat-first pilot: chat campaigns, Invite to chat with QR codes, chat status and messages on the patient page, clinic settings switches, Telegram setup guide |
| 2026-10-02 | Phase 0 PH defaults: phone normalization to `+639…`, `Asia/Manila` and PH calling hours, PHT label on booking links, voicemail reads PH callback numbers locally |
| 2026-10-02 | CC nightly review; README rewritten for CareCall PH; this roadmap |
| 2026-10-01 | CC assistant, CC wiki and action items; WhatsApp channel; channel priority by PH reach |
| 2026-10-01 | Phase 1 chat channels: Viber, Messenger, Telegram, `/connect` opt-in |
| 2026-10-01 | Forked from CareCall US |
