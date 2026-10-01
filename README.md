# CareCall PH

AI appointment scheduling for small private clinics in the Philippines (Metro
Manila and Cebu). Clinic staff run outreach campaigns; an AI voice assistant
calls patients, verifies who they are, and books real slots in a clinician's
calendar. Follow-ups go out on the patient's preferred chat app (Viber,
Messenger, WhatsApp, Telegram) or SMS. **CC**, an assistant inside the portal,
explains the app, guides setup, and reviews campaign results every night.

Forked from CareCall (BAI-POP2, built for US clinics). **Where the project
stands and what's next: [ROADMAP.md](ROADMAP.md).**

```
Clinic staff ─► React portal ─► Supabase (Postgres + Edge Functions) ⇄ Telnyx AI Voice Assistant ─► Patient (voice)
                    │                     │
                    │                     ├──► Viber · Messenger · WhatsApp · Telegram · SMS ─► Patient (chat)
                    └── CC assistant ─────┴──► Claude (Anthropic API), CC wiki
```

Supabase is the single source of truth for patients, availability,
appointments, campaign outcomes and messages.

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

Chat apps are opt-in. An SMS or voicemail follow-up carries a `/connect/<token>`
invite; the patient opens their app and replies **YES** (or OO / OPO / SIGE),
which is recorded as consent. Messages then go to the patient's preferred app,
falling back by Philippine reach (MEF): **Viber 71% → Messenger 60% → WhatsApp
40% → Telegram 20% → SMS**. Patients can reply **BOOK** for a booking link or
**STOP / TIGIL** to opt out, in English, Filipino or Cebuano. One chat account
can manage several patients (a parent booking for their children).

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

---

## Repository layout

```
├── ROADMAP.md                       # phases, status, next steps
├── docs/
│   ├── cc-wiki/                     # CC's knowledge base (one .md per topic) ← update with every feature
│   ├── cc-assistant.md              # CC architecture, setup, wiki workflow
│   ├── messaging-channels.md        # chat channel design + per-platform setup
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
│       │   └── cc/                  # CC tools, Claude tool loop, generated wiki bundle
│       ├── start-campaign/          # cron sweep: pre-call notice, then dial (status/hours/DNC gated)
│       ├── telnyx-call-events/      # Call Control webhook: AMD, voicemail follow-up, hangup, insights
│       ├── assistant-tools/         # verify_patient, get_appointment_slots, create_appointment, mark_outcome
│       ├── booking-api/             # public self-booking API behind /book/<token>
│       ├── channel-webhook/         # inbound Viber / Messenger / WhatsApp / Telegram
│       ├── admin-manage/            # portal users & clinics
│       ├── cc-chat/                 # CC interactive
│       └── cc-nightly/              # CC nightly review (one clinic per call)
├── telnyx/
│   ├── assistant-instructions.md    # paste into the Telnyx AI Assistant
│   └── tools.json                   # webhook tool definitions to register
├── web/                             # React (Vite + TS) staff portal, /book and /connect public pages
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
git clone <this repo> carecall-ph && cd carecall-ph
git remote add upstream https://github.com/mikeA911/BAI-POP2.git   # pull core fixes later
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

That admin creates clinics, clinic admins and staff from the portal. For each
Philippine clinic set **Timezone** to `Asia/Manila` (the schema default is still
`America/Chicago`; see ROADMAP Phase 0).

Per-clinic feature flags (no portal toggle yet):

```sql
update clinics set self_booking_enabled = true,   -- /book links in messages
                   chat_optin_enabled   = true,   -- /connect chat invites
                   cc_nightly_enabled   = true    -- default true
where id = '<clinic id>';
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
supabase functions deploy cc-chat
supabase functions deploy telnyx-call-events --no-verify-jwt
supabase functions deploy assistant-tools    --no-verify-jwt
supabase functions deploy booking-api        --no-verify-jwt
supabase functions deploy channel-webhook    --no-verify-jwt
supabase functions deploy cc-nightly         --no-verify-jwt
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
Telegram (free, about 5 minutes), then Viber (commercial terms needed for
bot-initiated messages), then Messenger and WhatsApp (Meta app review).

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

Hardening still open (tracked in [ROADMAP.md](ROADMAP.md)): Telnyx webhook
signature verification (`telnyx-signature-ed25519`) in `telnyx-call-events`,
recording access controls, data-retention jobs, NPC registration and
breach-response procedure.

---

## Docs

| Doc | What's in it |
|---|---|
| [ROADMAP.md](ROADMAP.md) | Phases, status, next steps |
| [docs/messaging-channels.md](docs/messaging-channels.md) | Chat channel design and platform setup |
| [docs/cc-assistant.md](docs/cc-assistant.md) | CC architecture, nightly review, wiki workflow |
| [docs/cc-wiki/README.md](docs/cc-wiki/README.md) | How to write CC wiki pages |
| [docs/self-booking-link-spec.md](docs/self-booking-link-spec.md) | Self-booking link spec |
| [docs/precall-sms-implementation-note.md](docs/precall-sms-implementation-note.md) | Pre-call message design |
| [docs/portal-ui-roles-spec_1.md](docs/portal-ui-roles-spec_1.md) | Portal roles and permissions |

**Never commit real patient data or API keys.** `.gitignore` excludes `.env`,
`node_modules` and build output.
