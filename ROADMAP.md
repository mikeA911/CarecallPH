# CareCall PH roadmap

**Last updated:** 2 October 2026

**Status key:** **Done** = built and verified live. **Built** = code complete,
type-checked and building, not yet run against live Supabase / Telnyx / chat
platforms. **Planned** = designed, not started. **Idea** = worth doing, not yet designed.

## Where we are

| Phase | Scope | Status |
|---|---|---|
| Base | Outbound AI scheduling (inherited from CareCall US) | **Done** in the US build; needs re-verifying on PH accounts |
| 0 | Revive on new accounts, Philippine defaults | **Planned**: waiting on Telnyx account |
| 1 | Chat channels: Viber, Messenger, WhatsApp, Telegram | **Built** |
| 1C | CC assistant, LLM wiki, nightly review | **Built** |
| 2 | Inbound: AI receptionist, appointment requests and changes | **Planned** |
| 3 | Localization and compliance hardening | **Planned** |
| 4 | Pilot and commercial launch | **Idea** |

**Next three actions**

1. Open the Telnyx account and confirm outbound voice and SMS to Globe, Smart
   and DITO numbers, plus availability of Philippine inbound numbers (Phase 2 depends on it).
2. Stand up the new Supabase project (Singapore), deploy everything, and run
   the README smoke test end to end.
3. Connect Telegram first (free) to verify the Phase 1 opt-in and fallback
   flow live, then apply for Viber commercial terms.

---

## Base: inherited from CareCall US

Done and verified end to end in the US build (August 2026):

- Campaign engine with status machine, calling-hours gate, DNC, 1-minute cron sweep
- Telnyx AI voice: premium AMD gate, server-side DOB verification, progressive
  slot disclosure, idempotent booking, DB-level double-booking prevention
- Pre-call SMS, voicemail SMS fallback, self-booking links
- Portal: roles (admin / clinic admin / staff), multi-clinic RLS, Review queue,
  call history with transcripts and summaries, clinicians and availability

## Phase 0: Revive on PH accounts

| Item | Status |
|---|---|
| New repo mirrored from BAI-POP2 with `upstream` remote | Planned |
| Telnyx account: number, Call Control app, AI Assistant, Messaging Profile | Planned |
| Supabase project in Singapore; migrations, Vault secrets, functions deployed | Planned |
| Phone normalization: accept `09xx…` / `9xx…`, store `+639xx…` (import, add patient, booking) | Planned |
| Defaults: clinic timezone `Asia/Manila`, PH-friendly calling hours, `+63` placeholders in the portal | Planned |
| `BookPage` timezone label for `Asia/Manila` | Planned |
| Carrier test: call and SMS to Globe, Smart, DITO; check caller ID display | Planned |
| AMD tuning: ringback tunes and "subscriber cannot be reached" announcements | Planned |
| Smoke test (README §8) passes on PH accounts | Planned |

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
| Clinic settings toggles: self-booking, chat invites, nightly review | Today these are SQL-only |
| Patient detail: channel status, consent timestamps, message history | Staff visibility |
| Staff inbox over `channel_messages` with replies | Patients write back; today they get an auto-reply |
| Front-desk QR code (clinic-level invite) | Opt-in at the counter, not only via SMS |
| Delivery receipts (Viber `delivered/seen`, Meta statuses) into `channel_messages` | Accurate channel analytics |

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
| Pricing and billing | Per-clinic subscription plus usage |
| Support playbook | Using CC action items and the wiki |

---

## Changelog

| Date | Change |
|---|---|
| 2026-10-02 | CC nightly review; README rewritten for CareCall PH; this roadmap |
| 2026-10-01 | CC assistant, CC wiki and action items; WhatsApp channel; channel priority by PH reach |
| 2026-10-01 | Phase 1 chat channels: Viber, Messenger, Telegram, `/connect` opt-in |
| 2026-10-01 | Forked from BAI-POP2 (CareCall US) |
