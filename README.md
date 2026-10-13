# CareCallPH

Patient engagement and clinical workflows for small private clinics in the
Philippines (Metro Manila and Cebu). Clinics reach patients on the chat app
they already use (Viber, Messenger, WhatsApp, Telegram) or SMS, with booking
links, appointment and medicine reminders, and a symptom check that ends in a
booking. Doctors **dictate clinical notes** that CC drafts for them to sign,
and records can be exported in the national health data format (**FHIR R4,
PH Core**). An AI voice assistant can call patients, verify who they are and
book real slots. **CC**, an assistant inside the portal, explains the app,
guides setup, and reviews results every night.

Forked from CareCall, the earlier build for US clinics. **Where the project
stands and what's next: [ROADMAP.md](ROADMAP.md).**

```
Clinic staff ─► React portal ─► Supabase (Postgres + Edge Functions) ⇄ Telnyx AI Voice Assistant ─► Patient (voice)
                    │                     │
                    │                     ├──► Viber · Messenger · WhatsApp · Telegram · SMS ─► Patient (chat)
                    │                     ├──► Symptom engine (demo · Infermedica) ◄── Patient (/check)
                    └── CC assistant ─────┴──► Claude (Anthropic API), Gemini speech-to-text, CC wiki
```

Supabase is the single source of truth for patients, availability,
appointments, campaign outcomes, messages, medicines and clinical notes.
**How it fits together: [docs/architecture.md](docs/architecture.md).**

---

## What it does

### Outbound scheduling campaigns

A campaign is: who to contact, why, which clinician's calendar, and what slot
length. Campaigns move through `draft → scheduled → active ⇄ paused → completed`
and only dial inside the clinic's calling hours. A cron sweep advances every
active campaign once a minute.

### Call flow (enforced by code, not just the prompt)

1. **AMD gate**: calls are dialed with premium answering-machine detection.
   The AI starts only after Telnyx classifies the answer as a live human.
   Voicemail gets a brief message with no health details, plus a follow-up
   message on the patient's permitted channel.
2. **Identity verification**: the AI collects a date of birth and calls
   `verify_patient`; the comparison is **server-side** and the AI only sees
   match / no match. Two failures lock the call and send the patient to the
   Review queue. Scheduling tools return 403 until verified.
3. **Progressive slot disclosure**: `get_appointment_slots` returns at most 3
   days, then at most 3 times, as speech-ready strings, so the AI can't invent times.
4. **Explicit confirmation**: `create_appointment` is idempotent, and a Postgres
   exclusion constraint makes double-booking a clinician impossible.
5. **No forced bookings**: `mark_outcome` records declined / callback_requested /
   wrong_number / needs_human. Callbacks re-enter the queue after `callback_after`.

Optional per clinic: a **pre-call message** a few minutes before the call, and
**self-booking links** (`/book/<token>`) so patients can pick a slot themselves.

### Chat channels: Viber, Messenger, WhatsApp, Telegram

Chat apps are opt-in. Staff send a `/connect/<token>` invite from the patient's
page (link, QR code or ready-made message), or an SMS or voicemail follow-up
carries one; the patient opens their app and replies **YES** (or OO / OPO / SIGE),
which is recorded as consent. Messages then go to the patient's preferred app,
falling back by Philippine reach (MEF): **Viber 71% → Messenger 60% → WhatsApp
40% → Telegram 20% → SMS**. Patients can reply **BOOK** for a booking link or
**STOP / TIGIL** to opt out, in English, Filipino or Cebuano. One chat account
can manage several patients (a parent booking for their children).

**Chat campaigns** skip calls entirely: each patient gets a booking link on
their chat app, with one reminder. This is how a clinic can pilot CareCall with
only a Telegram bot, before a phone account is set up (Setup §9 below).

Details: [docs/messaging-channels.md](docs/messaging-channels.md).

### CC, the portal assistant

A chat drawer on every signed-in screen. CC:

- answers how-to questions from the **CC wiki** (`docs/cc-wiki/`),
- shows buttons to the right screen and runs guided setups step by step,
- analyses campaigns using **aggregate data only** (no names, phones or birthdates reach the model),
- files **action items** for clinic admins on the **CC action items** page,
- runs a **nightly review** of every clinic at 02:00 Manila time and posts a summary.

Clinic isolation is enforced by Postgres RLS (interactive CC runs as the
signed-in user). CC can't change settings, start campaigns or contact patients.

Details: [docs/cc-assistant.md](docs/cc-assistant.md).

### Symptom check and reminders

- **Symptom check** (`/check`, the clinic's own link, or `/check` in Telegram):
  emergency questions first (911 screen), then a symptom engine inside a
  **Philippine layer** (dengue, leptospirosis, TB, rabies…); the result says how
  soon and what kind of doctor, and can book a visit. Setup §10 below;
  [docs/symptom-check-design.md](docs/symptom-check-design.md).
- **Appointment reminders** by chat 24 hours and 2 hours before; patients reply
  1 confirm, 2 change the time, 3 cancel.

### Care plans and clinical notes

- **Clinical roles**: each user has an access level (platform admin, clinic
  admin, staff) and a clinical role (front desk, nurse / assistant, doctor),
  enforced in the database.
- **Medicine reminders** by chat after the patient agrees in the chat; 1 taken /
  2 skipped; adherence on the patient page.
- **Clinical notes**: the doctor dictates, records the consultation with the
  patient's consent, or types; speech-to-text makes a transcript (audio never
  stored); CC drafts a SOAP note; the doctor signs with their password. Signed
  notes are final; corrections are signed addenda.
- **FHIR export**: **Download record (FHIR)** gives the patient's record in FHIR
  R4 with the Philippine profiles (PH Core).
- **Records retention**: 7 years after the last consultation by default, with a
  review list; nothing is deleted automatically.

Details: [docs/care-plan-design.md](docs/care-plan-design.md),
[docs/fhir-design.md](docs/fhir-design.md).

---

## Repository layout

```
├── ROADMAP.md                       # phases, status, next steps
├── docs/
│   ├── architecture.md              # how the system fits together
│   ├── cc-wiki/                     # CC's knowledge base (one .md per topic) ← update with every feature
│   ├── cc-assistant.md              # CC architecture, setup, wiki workflow
│   ├── messaging-channels.md        # chat channel design + per-platform setup
│   ├── symptom-check-design.md      # symptom check, engines, Philippine layer
│   ├── care-plan-design.md          # roles, medicines, prescriptions, vital signs, clinical notes
│   ├── fhir-design.md               # FHIR-ready records and the PH Core export
│   ├── self-booking-link-spec.md, precall-sms-implementation-note.md, portal-ui-roles-spec_1.md
│   └── CHANGES.md                   # historical change notes from the US build
├── scripts/
│   └── build-cc-wiki.ts             # docs/cc-wiki → supabase/functions/_shared/cc/wiki.generated.ts
├── supabase/
│   ├── migrations/                  # schema, RLS, slot generation, cron jobs, channels, CC
│   └── functions/
│       ├── _shared/
│       │   ├── lib.ts               # supabase + telnyx clients, auth/audit, booking-link helpers
│       │   ├── channels.ts          # channel resolution + senders (SMS/Viber/Messenger/WhatsApp/Telegram)
│       │   ├── roles.ts, reminders.ts, care.ts, notes.ts   # pure rules, with tests
│       │   ├── fhir/                # FHIR R4 mapping + PH Core systems
│       │   ├── symptom/             # symptom engines + Philippine layer
│       │   └── cc/                  # CC tools, Claude tool loop, generated wiki bundle
│       ├── start-campaign/          # cron sweep: pre-call notice, then dial (status/hours/DNC gated)
│       ├── telnyx-call-events/      # Call Control webhook: AMD, voicemail follow-up, hangup, insights
│       ├── assistant-tools/         # verify_patient, get_appointment_slots, create_appointment, mark_outcome
│       ├── booking-api/             # public self-booking API behind /book/<token>
│       ├── channel-webhook/         # inbound Viber / Messenger / WhatsApp / Telegram
│       ├── channel-invite/          # staff "Invite to chat" links (portal)
│       ├── admin-manage/            # portal users & clinics
│       ├── cc-chat/                 # CC interactive
│       ├── cc-nightly/              # CC nightly review (one clinic per call)
│       ├── symptom-check/           # public symptom check + booking from the result
│       ├── send-reminders/          # appointment and medicine reminders (pg_cron)
│       ├── care-plan/               # medicine reminder consent
│       ├── clinical-note/           # speech-to-text, SOAP draft, doctor signature
│       └── fhir/                    # FHIR R4 export (PH Core)
├── telnyx/
│   ├── assistant-instructions.md    # paste into the Telnyx AI Assistant
│   └── tools.json                   # webhook tool definitions to register
├── web/                             # React (Vite + TS) staff portal, /book /connect /check public pages
└── .github/workflows/cc-wiki.yml    # CI: wiki valid and generated bundle current
```

---

## Setup

### 0. Prerequisites

- Node.js 20+, Git, **Deno 2** (wiki build, type checks), Supabase CLI (`npm i -g supabase`)
- A **Supabase** project. Use the **Singapore (ap-southeast-1)** region for latency to the Philippines.
- A **Telnyx** account with: a phone number that can call Philippine mobiles,
  a **Call Control Application**, an **AI Assistant**, and a **Messaging Profile** for SMS
- An **Anthropic API key** for CC
- Optional, per chat channel: a Viber bot, a Meta app (Messenger and/or
  WhatsApp Cloud API), a Telegram bot

### 1. Clone

```bash
git clone https://github.com/mikeA911/CarecallPH.git && cd CarecallPH
git remote add upstream https://github.com/mikeA911/CareCall.git   # the US CareCall build, to pull core fixes later
code .
```

`.vscode/settings.json` scopes Deno to `supabase/functions` so it doesn't fight
the React app's TypeScript.

### 2. Database

```bash
supabase login
supabase link --project-ref <PROJECT_REF>
supabase db push
```

The campaign sweep and CC nightly review run on `pg_cron` and read two Vault
secrets. Create them once in the SQL editor:

```sql
select vault.create_secret('https://<PROJECT_REF>.supabase.co/functions/v1', 'functions_url');
select vault.create_secret('<SERVICE_ROLE_KEY>', 'service_role_key');
```

Bootstrap the first platform admin (after signing up that email in Supabase Auth):

```sql
update auth.users
set raw_app_meta_data = raw_app_meta_data || '{"role":"admin","clinic_id":null}'::jsonb
where email = 'you@example.com';
```

That admin creates clinics, clinic admins and staff from the portal. New clinics
default to **Timezone** `Asia/Manila` and calling hours Mon–Fri 08:00–18:00,
Sat 08:00–12:00; adjust per clinic in Clinic settings.

Self-booking links and chat invites are switched on per clinic in **Clinic
settings**. The CC nightly review is on by default; to turn it off for a clinic:

```sql
update clinics set cc_nightly_enabled = false where id = '<clinic id>';
```

### 3. Secrets

```bash
supabase secrets set \
  TELNYX_API_KEY=KEY_xxx \
  TELNYX_CONNECTION_ID=<call control app id> \
  TELNYX_ASSISTANT_ID=<assistant id> \
  TELNYX_FROM_NUMBER=+<E.164> \
  TELNYX_MESSAGING_PROFILE_ID=<messaging profile id> \
  TOOL_WEBHOOK_SECRET=$(openssl rand -hex 32) \
  CLINIC_NAME="Fallback Clinic Name" \
  CLINIC_CALLBACK_NUMBER=+63XXXXXXXXXX \
  CLINIC_TZ=Asia/Manila \
  PORTAL_URL=https://<portal-domain> \
  ANTHROPIC_API_KEY=sk-ant-...
```

Clinical notes: `GEMINI_API_KEY` (speech-to-text; paid Google AI account;
without it doctors type or paste). Optional: `NOTES_MODEL` (default
`claude-opus-5-5`), `GEMINI_STT_MODEL` (default `gemini-2.5-flash`).

Optional: `CC_MODEL` (default `claude-sonnet-5-5`), `SMS_PRECALL_LEAD_SECONDS`
(default 120), and the chat-channel secrets listed in
[docs/messaging-channels.md](docs/messaging-channels.md). A channel without
credentials is never used.

`TOOL_WEBHOOK_SECRET` must match in Supabase **and** in all four Telnyx tool
header definitions; change both together.

### 4. Deploy functions

Deploy with the **CLI**: several functions import `_shared/`, which pasting
into the dashboard editor does not include.

```bash
deno run -A scripts/build-cc-wiki.ts             # refresh CC's wiki bundle first

supabase functions deploy start-campaign
supabase functions deploy admin-manage
supabase functions deploy channel-invite
supabase functions deploy cc-chat
supabase functions deploy telnyx-call-events --no-verify-jwt
supabase functions deploy assistant-tools    --no-verify-jwt
supabase functions deploy booking-api        --no-verify-jwt
supabase functions deploy channel-webhook    --no-verify-jwt
supabase functions deploy cc-nightly         --no-verify-jwt
supabase functions deploy symptom-check      --no-verify-jwt
supabase functions deploy send-reminders     --no-verify-jwt
supabase functions deploy care-plan
supabase functions deploy clinical-note
supabase functions deploy fhir
```

`--no-verify-jwt` functions are called by Telnyx, chat platforms, patients'
browsers or pg_cron; each authenticates requests itself (shared secret,
platform signature, booking token, or service key). JWT-verified functions are
called only by signed-in portal users or the cron sweep.

### 5. Telnyx

1. **Call Control Application**: webhook URL
   `https://<PROJECT_REF>.supabase.co/functions/v1/telnyx-call-events`, and
   **Answering Machine Detection: Premium**.
2. **AI Assistant**: paste `telnyx/assistant-instructions.md` into its
   instructions, choose a voice, and register the four tools from
   `telnyx/tools.json` (replace `<PROJECT_REF>` and `<TOOL_WEBHOOK_SECRET>`).
   Use the **Dynamic Variables Webhook URL** for per-call variables, and note
   Telnyx sends tool calls to the base URL, not per-tool paths. Point the
   insights/transcript webhook at the events URL to store transcripts.
3. Assign the outbound number to the Call Control Application and the
   Messaging Profile.

### 6. Chat channels

Follow [docs/messaging-channels.md](docs/messaging-channels.md). Start with
Telegram (free, about 10 minutes, no approval). Messenger and WhatsApp need Meta
business verification and app review; Viber needs a commercial agreement
(€100 a month per bot plus per-message fees). Apply for those early.

### 7. Portal

```bash
cd web
cp .env.example .env        # Supabase URL + anon key, chat-app links for /connect
npm install
npm run dev
```

On Vercel, set the same `VITE_*` variables and redeploy (Vite inlines them at
build time). `vercel.json` already rewrites `/book/*` and `/connect/*` to the SPA.

### 8. Smoke test

1. Clinic settings: `Asia/Manila`, calling hours covering now, pre-call message on.
2. Clinicians: add one with availability today and tomorrow.
3. Patients: add yourself with your PH mobile (`+639…`), real DOB, SMS consent.
4. Campaign: create, assign yourself, **Start calling**.
5. Expect the pre-call SMS (with a `/connect` link if chat invites are on), then the call.
6. Answer, state your DOB, pick a slot, confirm. The dashboard shows **booked**.
7. Re-run and let it go to voicemail: message left, follow-up message sent, no AI.
8. Open the `/connect` link, connect Telegram, reply `OO`, re-run: the notice now arrives in Telegram.
9. Ask CC "How did my campaign do?" and check **CC action items**.

### 9. Chat-only pilot (Telegram, no phone account)

Everything except calls and SMS works without Telnyx. You need the Supabase
project, the portal on Vercel and a Telegram bot.

1. **Supabase:** §2 (database, Vault secrets, first admin), then secrets
   `PORTAL_URL`, `TELEGRAM_BOT_TOKEN`, `TELEGRAM_WEBHOOK_SECRET` (and
   `ANTHROPIC_API_KEY` for CC). Telnyx secrets can wait.
2. **Functions:** deploy `start-campaign`, `admin-manage`, `channel-invite`,
   `cc-chat`, and with `--no-verify-jwt`: `booking-api`, `channel-webhook`,
   `cc-nightly`.
3. **Telegram bot:** follow §3 of
   [docs/messaging-channels.md](docs/messaging-channels.md).
4. **Portal:** §7 with `VITE_TELEGRAM_BOT` set.
5. **Test the loop:**
   1. Clinic settings: `Asia/Manila`, calling hours covering now.
   2. Clinicians: one clinician with availability in the next few days.
   3. Patients: add yourself. Open your page, click **Invite to chat**, scan the
      QR code with your phone, choose Telegram, press **Start**, reply with your
      date of birth (e.g. `March 14, 1985`), then `OO`. Try a wrong date once to
      see the retry message.
      **Chat apps** now shows Telegram as **Active**.
   4. New campaign: **Chat message with a booking link**, reminder after
      `1` hour, tick yourself, save, then **Start sending**.
   5. The booking link arrives in Telegram. Open it, enter your date of birth,
      pick a time. The campaign shows **booked**.
   6. Add a second patient with no chat app to the campaign: they show as
      **needs chat invite**. Invite and connect them, and their link arrives
      within a minute.
   7. Reply `BOOK` for a fresh link, then `TIGIL` to stop messages.

### 10. Symptom check

Discover slice D1: [docs/symptom-check-design.md](docs/symptom-check-design.md).
Pick the engine with the `SYMPTOM_ENGINE` secret (empty = feature off):

| `SYMPTOM_ENGINE` | What it is | Secrets |
|---|---|---|
| `demo` | Built-in, made-up rules for trying the flow; the page shows a DEMO banner. Never for patients | none |
| `infermedica` | Infermedica Engine API v3, the go-live candidate | `INFERMEDICA_APP_ID`, `INFERMEDICA_APP_KEY`, optional `INFERMEDICA_MODEL` |
| `apimedic` | ApiMedic (priaid); the service appeared offline in October 2026 | `APIMEDIC_USERNAME`, `APIMEDIC_PASSWORD`, `APIMEDIC_SANDBOX` |

1. Start with the demo engine:
   ```bash
   supabase secrets set SYMPTOM_ENGINE=demo --project-ref <ref>
   ```
   For Infermedica, once the trial is approved:
   ```bash
   supabase secrets set "INFERMEDICA_APP_ID=<app id>" "INFERMEDICA_APP_KEY=<app key>" --project-ref <ref>
   supabase secrets set SYMPTOM_ENGINE=infermedica SYMPTOM_MONTHLY_BUDGET=600 --project-ref <ref>
   ```
   Every engine runs inside the **Philippine layer** (PH questions and rules
   that only raise urgency; design §8a). `SYMPTOM_PH_LAYER=off` turns it off.
   For Infermedica, `INFERMEDICA_EXTRA_EVIDENCE` (comma list of risk-factor
   IDs, e.g. living in Southeast Asia) is sent as present on every check;
   confirm the IDs on the trial account.
   `SYMPTOM_MONTHLY_BUDGET` caps engine API calls per month (the Infermedica
   trial has 2,000 calls in 60 days; one check uses roughly 5–12). The demo
   engine makes no calls and ignores it.
2. `supabase db push` (adds `symptom_checks` and the clinic fields), then deploy
   `symptom-check` with `--no-verify-jwt` and redeploy `channel-webhook` and `cc-chat`.
3. Portal: **Clinic settings → Symptom check and online booking**: tick **Let
   patients check symptoms and book online**, add local emergency numbers, save.
   The clinic's link (name + random number) appears with Copy link and QR code.
4. Test: open the clinic's link on your phone, tick an emergency question
   once (Call 911 screen), then do a normal check through to the result. With
   the demo engine, try Fever → "Less than 2 days" → flood water Yes (urgent,
   leptospirosis note), Cough → "2 weeks or more" Yes (TB note), and "dog"
   (animal bite: urgent, rabies shots). In Telegram,
   send `/check` to the bot.
5. Booking from the result (clinic page only): add a clinician with
   availability (Clinicians), then on a result click **Book a visit**, pick a
   time, enter name, mobile and date of birth. The patient and appointment
   appear in the portal; the patient's page shows the shared summary under
   **Appointments**. Urgent results only offer times today.
6. The one public page: open `/check` (no clinic). After the result, **Find a
   clinic and book** lists every clinic with the symptom check turned on.

Engine, PH layer and PH case tests: `deno test supabase/functions/_shared/symptom/`.
The PH cases live in `ph_layer_test.ts` for a doctor to review and extend.

---

## Keeping CC's wiki current

**A feature isn't done until its CC wiki page is.** For every user-visible change:

1. Edit or add `docs/cc-wiki/<id>.md` using exact on-screen labels and listing its routes.
2. Add a line to `docs/cc-wiki/changelog.md`.
3. Run `deno run -A scripts/build-cc-wiki.ts` and commit the generated file.
4. Redeploy `cc-chat` and `cc-nightly`.

CI fails the PR if the wiki is invalid or the bundle is stale. Format and
writing rules: [docs/cc-wiki/README.md](docs/cc-wiki/README.md).

---

## Privacy and compliance (Philippines)

Patient names, phone numbers, birthdates, call recordings and transcripts are
**sensitive personal information** under the **Data Privacy Act of 2012 (RA
10173)**. This is not legal advice; each clinic should confirm obligations with
its Data Protection Officer or counsel. What the code does:

- **Consent**: SMS requires `patients.sms_consent`; chat apps require an
  explicit YES (timestamped in `patient_channels.opted_in_at`); STOP is
  honoured immediately. Lack of messaging consent never blocks the call itself.
- **Minimal content**: voicemails and messages carry no diagnoses, only the
  clinic name, a callback number and optional booking link.
- **Tokens**: booking and invite tokens are stored only as SHA-256 hashes.
- **Isolation**: RLS scopes every table by clinic and role; CC's interactive
  tools run as the user, and CC sees aggregates only.
- **Vendors**: Supabase, Telnyx, Anthropic and Meta/Viber/Telegram process
  personal data on the clinic's behalf; put processing agreements in place
  before using real patient data.

- **Roles**: access level and clinical role per user; front desk never sees
  clinical notes or intake symptoms; only doctors sign, with their password.
- **Sessions**: signed out when the browser closes or after 20 minutes idle.
- **Clinical notes**: consultation recordings only with recorded consent; audio
  is transcribed and never stored; signed notes can't be changed; the audit log
  never holds note text.
- **Retention**: 7 years after the last consultation by default (DOH records
  schedule, to be confirmed); records past it are listed for review, never
  deleted automatically.

Hardening still open (tracked in [ROADMAP.md](ROADMAP.md)): Telnyx webhook
signature verification (`telnyx-signature-ed25519`) in `telnyx-call-events`,
recording access controls, purge jobs for messages and transcripts, patient
data requests (deletion and restriction), NPC registration and
breach-response procedure.

---

## Docs

| Doc | What's in it |
|---|---|
| [ROADMAP.md](ROADMAP.md) | Phases, status, next steps |
| [docs/architecture.md](docs/architecture.md) | Parts, data, roles, outside services, main flows |
| [docs/symptom-check-design.md](docs/symptom-check-design.md) | Symptom check and the Philippine layer |
| [docs/care-plan-design.md](docs/care-plan-design.md) | Clinical roles, medicines, prescriptions, vital signs, clinical notes |
| [docs/fhir-design.md](docs/fhir-design.md) | FHIR-ready records and the PH Core export |
| [docs/messaging-channels.md](docs/messaging-channels.md) | Chat channel design and platform setup |
| [docs/cc-assistant.md](docs/cc-assistant.md) | CC architecture, nightly review, wiki workflow |
| [docs/cc-wiki/README.md](docs/cc-wiki/README.md) | How to write CC wiki pages |
| [docs/self-booking-link-spec.md](docs/self-booking-link-spec.md) | Self-booking link spec |
| [docs/precall-sms-implementation-note.md](docs/precall-sms-implementation-note.md) | Pre-call message design |
| [docs/portal-ui-roles-spec_1.md](docs/portal-ui-roles-spec_1.md) | Portal roles and permissions |

**Never commit real patient data or API keys.** `.gitignore` excludes `.env`,
`node_modules` and build output.
