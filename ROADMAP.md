# CareCall + CareLink roadmap

**Last updated:** 11 October 2026

**Status key:** **Done** = built and verified live. **Built** = code complete,
type-checked and building, not yet run against live Supabase / Telnyx / chat
platforms. **Planned** = designed, not started. **Idea** = worth doing, not yet designed.

## Product progression

CareCall starts as patient engagement for small Philippine clinics and grows
into CareLink, a records and remote-monitoring layer. Five services on one
platform, in this order. Business case, pricing hypotheses and indicative
economics are in the concept paper (*CareCall + CareLink: a connected
healthcare access and continuity platform for Southeast Asia*, Oct 2026).

| Service | What it does | Engineering phases | Status |
|---|---|---|---|
| **CareCall Recall** | Re-engage existing patients by chat; due follow-ups and missed visits become booked appointments | 1, 1T, 1C | **Built**; first commercial MVP |
| **CareCall Discover** | Free-to-patient symptom-guided navigation and booking with participating clinics at CareCallPH.com | D | **Planned** (after Recall pilot) |
| **CareCall Voice** | AI outbound calls for non-responders; later the inbound receptionist | Base, 0b, 2 | Outbound **Done** in US build; PH carrier test pending |
| **CareLink Records** | FHIR patient timeline; store observations or access authorized EHR records | L | **Planned** |
| **CareLink RPM Intelligence** | Device readings, trends and a prioritized clinician review queue | R | **Idea** (later clinical pilot) |

**Delivery stages** (indicative, may overlap; each opens only when its gate is met)

| Stage | Priority | Gate |
|---|---|---|
| 0–3 months | Recall clinic pilots and appointment outcome reporting | Validated messaging economics, consent and scheduling |
| 3–6 months | Discover pilot with bounded free assessments | Infermedica contract, clinical governance and safe matching |
| 6–9 months | Voice add-on and CareLink FHIR demonstrator | Carrier economics; secure records and authorized integration |
| 9–18 months | Selected EHR/device integrations and RPM clinical pilot | Clinical validation, oversight and jurisdiction-specific compliance |

The Philippines is the reference market; channel adoption, clinical
regulation, privacy law, provider economics and EHR access are assessed country
by country before any Southeast Asian expansion.

## Where we are

| Phase | Scope | Status |
|---|---|---|
| Base | Outbound AI scheduling (inherited from CareCall US) | **Done** in the US build; needs re-verifying on PH accounts |
| 0a | PH accounts for the Recall pilot: Supabase, Vercel, Telegram | **In progress**: code built; accounts being set up |
| 0b | PH telephony for Voice: Telnyx, carrier test, call-detection tuning | **Planned**: needed for Voice (6–9 months) |
| 1 | Chat channels: Viber, Messenger, WhatsApp, Telegram | **Built** |
| 1T | Chat-first pilot: chat campaigns, staff invites, Telegram first | **Built** |
| 1C | CC assistant, LLM wiki, nightly review | **Built** |
| 2 | Inbound: AI receptionist, appointment requests and changes | **Planned** |
| 3 | Localization and compliance hardening | **Planned** |
| 4 | Pilot and commercial launch | **Planned**: founding-clinic Recall pilots first |
| D | CareCall Discover: symptom-guided booking at CareCallPH.com | **Planned** |
| L | CareLink Records: FHIR timeline and authorized EHR access | **Planned** |
| R | CareLink RPM Intelligence: device readings and review queue | **Idea** |

**Next three actions**

1. Stand up the new Supabase project (Singapore) and the Vercel portal, create
   the Telegram bot, and run the README chat-only pilot (§9) end to end.
2. Apply now for the slow approvals: Meta business verification and app review
   (Messenger, WhatsApp) and a Viber commercial agreement (€100/month per bot).
3. Open the Telnyx account and confirm outbound voice and SMS to Globe, Smart
   and DITO numbers, plus Philippine inbound numbers (Phase 2 depends on it).

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
| New repo from BAI-POP2 (`upstream` remote is set per clone, see README §1) | **Done** |
| Phone normalization: accept `09xx…` / `9xx…`, store `+639xx…` (import, add patient, clinic callback number; `/book` takes no phone) | **Built** |
| Defaults: clinic timezone `Asia/Manila`, PH-friendly calling hours (Mon–Fri 08–18, Sat 08–12), `+63` placeholders in the portal | **Built** |
| `BookPage` timezone label for `Asia/Manila` ("Philippine Time (PHT)") | **Built** |
| Supabase project in Singapore; migrations, Vault secrets, functions deployed | Planned |
| `supabase/config.toml` `project_id` set to the new project | **Done** |
| Migrations apply on a new Supabase project (`gen_random_uuid()`; enum values compared as text) | **Built**: full chain tested on a local Supabase stand-in |
| Vercel portal with `VITE_*` variables | Planned |
| Telegram bot and webhook (`docs/messaging-channels.md` §3) | Planned |
| Chat-only pilot test (README §9) passes | Planned |
| Turn international patient numbers back off (`ALLOW_INTERNATIONAL_PATIENT_PHONES` in `web/src/pages/Patients.tsx`, temporarily `true` for testing outside the Philippines) | Before the PH pilot |

## Phase 0b: PH telephony for Voice

Needed before the Voice add-on (stage 6–9 months), not for the Recall pilot.

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
| Rich replies (buttons for YES / BOOK / STOP) | Fewer typos, higher opt-in |
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

**Planned**

| Item | Notes |
|---|---|
| Wiki pages for every Phase 0–2 feature as it ships | Rule: no wiki page, not done |
| Persist CC conversations | Let admins see what users ask; feeds wiki gaps |
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

- Reminder 24 hours and 2 hours before, on the patient's channel: reply
  **C** to confirm, **R** to reschedule (hands off to 2a/2b), **X** to cancel.
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
| PhilHealth PIN (partial), HMO, barangay / city / province fields | Optional per clinic |
| Philippine public holidays in slot generation | Regular and special non-working days |
| Telnyx webhook signature verification | `telnyx-signature-ed25519` in `telnyx-call-events` |
| Data Privacy Act package | Privacy notice and consent text for clinics, DPO contact, breach-response runbook, NPC registration check |
| Data retention jobs | Transcripts, recordings and messages purged on a schedule |
| Recording access controls | Signed URLs, role-gated |
| Processing agreements | Supabase, Telnyx, Anthropic, Meta, Viber, Telegram |

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
into real availability.

| Item | Notes |
|---|---|
| CareCallPH.com public portal | Patient-facing; free symptom assessment within a defined budget |
| Symptom assessment integration | Infermedica is the candidate partner; pricing, approved intended use, Filipino/Cebuano support unconfirmed |
| Provider matching | Only participating clinics shown, with clear disclosure that listings aren't exhaustive |
| Safety rules | Commercial listings never affect triage; emergencies never routed to paid listings; care-seeking guidance even with no match |
| Booking | Reuses slot generation and self-booking links |

**Gate:** Infermedica contract, clinical governance and safe matching; legal
review of paid referral / fee-splitting restrictions.

## Phase L: CareLink Records

| Item | Notes |
|---|---|
| FHIR R4 store | Patient, Observation, Encounter, Appointment; aligned with the draft PH Core guide |
| Patient timeline | For clinics without a suitable system, and for patient-held records |
| Patient-directed import from US EHRs | US patient-access FHIR APIs; first users could be Filipinos retiring home |
| Authorized EHR integration | University of the Philippines-associated EHR is a lead to identify and verify, not an established interface |
| Consent and access | Purpose-limited, patient-controlled sharing under the Data Privacy Act |

**Gate:** secure records and authorized integration.

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
| 2026-10-11 | Phase 0 split into 0a (Recall pilot accounts) and 0b (telephony for Voice); AI voice instructions adapted for the Philippines |
| 2026-10-11 | Product progression CareCall → CareLink (Recall, Discover, Voice, CareLink Records, RPM), delivery stages and gates, phases D / L / R, pricing hypotheses |
| 2026-10-11 | Chat birthday check, per-clinic patient uniqueness, lighter patient pages |
| 2026-10-11 | Phase 1T chat-first pilot: chat campaigns, Invite to chat with QR codes, chat status and messages on the patient page, clinic settings switches, Telegram setup guide |
| 2026-10-02 | Phase 0 PH defaults: phone normalization to `+639…`, `Asia/Manila` and PH calling hours, PHT label on booking links, voicemail reads PH callback numbers locally |
| 2026-10-02 | CC nightly review; README rewritten for CareCall PH; this roadmap |
| 2026-10-01 | CC assistant, CC wiki and action items; WhatsApp channel; channel priority by PH reach |
| 2026-10-01 | Phase 1 chat channels: Viber, Messenger, Telegram, `/connect` opt-in |
| 2026-10-01 | Forked from BAI-POP2 (CareCall US) |
