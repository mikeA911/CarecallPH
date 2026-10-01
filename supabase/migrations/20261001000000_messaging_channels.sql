-- CareCall PH — Phase 1: chat-app messaging channels (Viber, Messenger, WhatsApp, Telegram).
--
-- Model:
--   • Chat apps are OPT-IN channels. A patient is first reached by SMS/voice,
--     which carries a /connect/<token> invite. Opening a deep link from that page
--     sends the token to our bot; we LINK the chat account to the patient, then
--     ask for an explicit "YES" before any message is sent there. The YES reply
--     is the Data Privacy Act (RA 10173) consent record (opted_in_at).
--   • One chat account may serve several patients (a parent managing a family's
--     appointments on one Viber). So external_id is NOT unique per channel;
--     uniqueness is (patient_id, channel).
--   • One shared bot per platform, multi-clinic. The clinic is carried by the
--     invite token, not by the bot.
--
-- Written idempotently so it is safe to re-run during development.

-- ============================================================
-- Channel enum + patient preference
-- ============================================================
do $$ begin
  create type message_channel as enum ('sms', 'viber', 'messenger', 'whatsapp', 'telegram');
exception when duplicate_object then null; end $$;

alter table patients
  add column if not exists preferred_channel message_channel not null default 'sms';

-- Per-clinic rollout flag for chat invites (default OFF, same pattern as
-- self_booking_enabled).
alter table clinics
  add column if not exists chat_optin_enabled boolean not null default false;

-- ============================================================
-- patient_channels — one row per (patient, chat channel)
-- ============================================================
create table if not exists patient_channels (
  id uuid primary key default uuid_generate_v4(),
  patient_id uuid not null references patients(id) on delete cascade,
  clinic_id uuid references clinics(id),
  channel message_channel not null check (channel <> 'sms'),
  external_id text not null,              -- Viber user id / Messenger PSID / WhatsApp wa_id / Telegram chat id
  display_name text,                      -- name shown by the platform (not trusted for identity)
  linked_at timestamptz not null default now(),
  opted_in_at timestamptz,                -- explicit YES; null = linked but not consented
  opted_out_at timestamptz,               -- STOP / unsubscribe / bot blocked
  last_inbound_at timestamptz,            -- Messenger 24h standard-messaging window
  unique (patient_id, channel)
);

create index if not exists idx_patient_channels_external
  on patient_channels (channel, external_id);

-- ============================================================
-- channel_invites — /connect/<token> opt-in tokens
-- Same hashing rule as booking_links: raw token only in the URL / deep link.
-- A token may be claimed on more than one channel until it expires.
-- ============================================================
create table if not exists channel_invites (
  id uuid primary key default uuid_generate_v4(),
  token_hash text not null unique,
  patient_id uuid not null references patients(id) on delete cascade,
  clinic_id uuid references clinics(id),
  created_at timestamptz not null default now(),
  expires_at timestamptz not null default (now() + interval '30 days')
);

create index if not exists idx_channel_invites_patient on channel_invites (patient_id);

-- ============================================================
-- channel_messages — outbound + inbound log for every channel (incl. SMS)
-- ============================================================
create table if not exists channel_messages (
  id uuid primary key default uuid_generate_v4(),
  clinic_id uuid references clinics(id),
  patient_id uuid references patients(id) on delete set null,
  campaign_id uuid references campaigns(id) on delete set null,
  channel message_channel not null,
  direction text not null check (direction in ('outbound', 'inbound')),
  external_id text,                       -- chat id / phone the message went to or came from
  body text,
  provider_message_id text,
  status text not null default 'sent',    -- sent | failed | received
  error text,
  created_at timestamptz not null default now()
);

create index if not exists idx_channel_messages_patient
  on channel_messages (patient_id, created_at desc);
create index if not exists idx_channel_messages_clinic
  on channel_messages (clinic_id, created_at desc);

-- ============================================================
-- RLS: staff read within their clinic; all writes via edge functions
-- (service role). Mirrors booking_links.
-- ============================================================
alter table patient_channels enable row level security;
alter table channel_invites  enable row level security;
alter table channel_messages enable row level security;

drop policy if exists patient_channels_read on patient_channels;
create policy patient_channels_read on patient_channels for select to authenticated
  using ( is_admin() or clinic_id = jwt_clinic_id() );

drop policy if exists channel_messages_read on channel_messages;
create policy channel_messages_read on channel_messages for select to authenticated
  using ( is_admin() or clinic_id = jwt_clinic_id() );

-- channel_invites: no client policies at all (tokens are server-only).
