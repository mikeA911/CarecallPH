# CareCall PH — Phase 1: Chat Messaging Channels

Viber, Facebook Messenger, WhatsApp and Telegram as opt-in patient channels, alongside SMS.

Fallback priority follows Philippine reach (MEF): **Viber 71%, Messenger 60%, WhatsApp 40%, Telegram 20%**, then SMS. Set in `CHANNEL_PRIORITY` in `_shared/channels.ts`; the `/connect` page orders its buttons the same way.

## How it works

```
SMS / voicemail follow-up ─┐
"Invite to chat" (portal) ─┴► /connect/<token> page ──► deep link opens bot
        ▲                                                     │
        │                                     channel-webhook links chat → patient
        │                                     bot asks for the date of birth (2 tries)
        │                                     bot asks: "Reply YES (or OO)…"
        │                                                     │
start-campaign / telnyx-call-events ◄── sendToPatient() ◄── YES = opted_in_at (DPA consent)
```

- **Staff invites** (no SMS needed): **Invite to chat** on a patient's page calls
  `channel-invite`, which mints the same `/connect/<token>` link (hash stored,
  30 days) and the portal shows it with a QR code and English/Filipino messages.
- **Chat campaigns** (`campaigns.outreach_mode = 'chat'`): `start-campaign`
  sends each patient a booking link instead of calling. `pending → messaged`
  (one reminder after `chat_reminder_hours`, a fresh link each time) `→ booked`
  or `→ no_answer`. No permitted channel → `needs_invite`; when that patient
  replies YES, `channel-webhook` moves them back to `pending` in any active chat
  campaign. Messages only go out inside the clinic's calling hours.
- **One shared bot per platform**, multi-clinic. The clinic travels in the invite token.
- **Birthday check on link** (`patient_channels.verified_at`, `verify_attempts`): the invite proves
  possession of a link, not identity, so the bot asks for the patient's date of birth before YES.
  `_shared/dob.ts` parses common formats (ISO, DD/MM and MM/DD with both readings tried when
  ambiguous, English and Filipino month names); a non-date reply doesn't use a try. The second wrong
  date locks the link, expires the patient's open invites and writes `chat_birthday_check_locked` to
  `audit_log`. Birthday replies are logged as `[date of birth reply]`, never as typed.
- **Family accounts:** one chat account can be linked to several patients. `BOOK` returns one link per patient with an open campaign, labelled by first name.
- **Channel choice** (`_shared/channels.ts → resolveChannel`): preferred opted-in chat → other opted-in chats in priority order → SMS with consent → nothing.
- **Messenger and WhatsApp** are used only inside the 24h window after the patient's last message. Outside it, the patient falls back to their next channel. Utility/template messages for out-of-window reminders are Phase 1b.
- **WhatsApp opt-in** has no deep-link payload, so the `/connect` page opens `wa.me/<number>?text=CONNECT <token>` and the webhook parses that first message.
- **Keywords** (whole message, case-insensitive): `YES/OO/OPO/SIGE/OK`, `STOP/TIGIL/HINTO/UNSUBSCRIBE/AYAW NA`, `BOOK/BOOKING/SCHEDULE/ISKEDYUL/APPOINTMENT`. Anything else is logged to `channel_messages` with a short auto-reply.

## Files

| File | Change |
|---|---|
| `supabase/migrations/20261001000000_messaging_channels.sql` | new: `message_channel` enum, `patient_channels`, `channel_invites`, `channel_messages`, `patients.preferred_channel`, `clinics.chat_optin_enabled` |
| `supabase/functions/_shared/channels.ts` | new: channel resolution, senders, invites, message log |
| `supabase/functions/channel-webhook/index.ts` | new: inbound webhook for all three platforms |
| `supabase/functions/start-campaign/index.ts` | pre-call notice via `sendToPatient`; SMS carries chat invite |
| `supabase/functions/telnyx-call-events/index.ts` | voicemail follow-up via `sendToPatient` |
| `web/src/pages/ConnectPage.tsx`, `web/src/App.tsx` | public `/connect/:token` page |
| `supabase/migrations/20261011000000_chat_first_campaigns.sql` | chat campaigns: `campaigns.outreach_mode`, `chat_reminder_hours`, statuses `messaged` / `needs_invite`, `campaign_stats` buckets |
| `supabase/functions/channel-invite/index.ts` | staff-created invite links (JWT, own clinic only, audited) |
| `web/src/components/ChatSection.tsx` | patient page: chat status, Invite to chat (link, QR, messages), message history |

`start-campaign` now imports `_shared/`, so it **must be deployed with the CLI** (dashboard paste won't bundle `_shared/`).

## Setup

### 1. Database + functions

```bash
supabase db push
supabase functions deploy channel-webhook --no-verify-jwt
supabase functions deploy start-campaign
supabase functions deploy telnyx-call-events --no-verify-jwt
```

Enable per clinic:

```sql
update clinics set chat_optin_enabled = true where id = '<clinic id>';
```

### 2. Secrets

```bash
supabase secrets set \
  PORTAL_URL=https://<portal-domain> \
  VIBER_AUTH_TOKEN=<from Viber bot registration> \
  TELEGRAM_BOT_TOKEN=<from @BotFather> \
  TELEGRAM_WEBHOOK_SECRET=$(openssl rand -hex 32) \
  META_PAGE_ACCESS_TOKEN=<page token> \
  META_APP_SECRET=<app secret> \
  META_VERIFY_TOKEN=$(openssl rand -hex 16)
```

Any platform without credentials is simply never selected.

Webhook base: `WH=https://<PROJECT_REF>.supabase.co/functions/v1/channel-webhook`

### 3. Telegram (fastest to test, free, no approval)

A Telegram bot can't message someone first: the patient opens the invite link,
presses **Start**, and replies YES. That's why every patient needs an invite.

1. **Create the bot.** In Telegram, open **@BotFather** (blue check mark) and send
   `/newbot`.
   - Name: what patients see, e.g. `CareCall PH`.
   - Username: must end in `bot`, e.g. `CareCallPH_bot`. This is
     `VITE_TELEGRAM_BOT` (without the `@`).
   - BotFather replies with a token like `123456789:AA…`. This is
     `TELEGRAM_BOT_TOKEN`. Treat it like a password; if it leaks, send
     `/revoke` to BotFather and update the secret.
2. **Tidy the profile (optional, a few minutes).** In BotFather:
   - `/setdescription`: shown before the patient presses Start, e.g. "Appointment
     reminders and booking links from your clinic. Reply STOP anytime."
   - `/setabouttext` and `/setuserpic` (the CareCall logo).
   - `/setcommands`, then paste:
     ```
     start - Connect to your clinic
     stop - Stop messages
     ```
3. **Make a webhook secret** and set the Supabase secrets (`PORTAL_URL` must be
   the portal's public address, for example your Vercel URL):
   ```bash
   export TELEGRAM_WEBHOOK_SECRET=$(openssl rand -hex 32)
   supabase secrets set TELEGRAM_BOT_TOKEN=<token> \
     TELEGRAM_WEBHOOK_SECRET=$TELEGRAM_WEBHOOK_SECRET PORTAL_URL=https://<portal-domain>
   ```
4. **Deploy** `channel-webhook --no-verify-jwt` and `channel-invite` (see §1).
5. **Point Telegram at the webhook:**
   ```bash
   curl -s "https://api.telegram.org/bot$TELEGRAM_BOT_TOKEN/setWebhook" \
     -d "url=$WH?ch=telegram" \
     -d "secret_token=$TELEGRAM_WEBHOOK_SECRET" \
     -d 'allowed_updates=["message","my_chat_member","callback_query"]'
   ```
   It should answer `{"ok":true,"result":true,"description":"Webhook was set"}`.
   `callback_query` delivers taps on reply buttons (reminders, medicine
   check-ins, consent, new times); without it the buttons do nothing. Bots set
   up before 13 October 2026 need this command run again.
   Check it any time with
   `curl -s "https://api.telegram.org/bot$TELEGRAM_BOT_TOKEN/getWebhookInfo"`:
   `last_error_message` shows the latest failure (a 401 means the secret in
   Telegram and in Supabase don't match).
6. **Portal:** set `VITE_TELEGRAM_BOT=<username>` in Vercel and redeploy. The
   **Open in Telegram** button appears on `/connect` pages.
7. **Test:** send `/start` to the bot with no link. It should answer "Please
   open the invite link your clinic sent you". Then follow the chat-only pilot
   in the README.

### 4. Viber

1. Apply for a bot (commercial terms required for bot-initiated messages).
2. Register the webhook:

```bash
curl -s -X POST https://chatapi.viber.com/pa/set_webhook \
  -H "X-Viber-Auth-Token: $VIBER_AUTH_TOKEN" \
  -d "{\"url\":\"$WH?ch=viber\",\"event_types\":[\"conversation_started\",\"unsubscribed\"],\"send_name\":true}"
```

### 5. Messenger

1. Meta app with the Messenger product, linked to the CareCall Facebook Page.
2. Webhook callback `$WH?ch=messenger`, verify token = `META_VERIFY_TOKEN`.
3. Subscribe the page to `messages`, `messaging_postbacks`, `messaging_referrals`.
4. Set a Get Started button with payload `GET_STARTED`.
5. App Review is needed for `pages_messaging` before non-testers can use it.

### 6. WhatsApp (Meta Cloud API)

1. WhatsApp Business Account + phone number in the same Meta app.
2. Webhook callback `$WH?ch=whatsapp`, verify token = `META_VERIFY_TOKEN`; subscribe to `messages`.
3. Secrets: `WHATSAPP_PHONE_NUMBER_ID`, `WHATSAPP_ACCESS_TOKEN` (system-user token).

### 7. Portal env (Vercel)

```
VITE_VIBER_CHAT_URI=<bot uri>
VITE_MESSENGER_PAGE=<page username>
VITE_WHATSAPP_NUMBER=<business number digits, e.g. 639171234567>
VITE_TELEGRAM_BOT=<bot username>
```

Redeploy after setting.

## Smoke test

1. Patient with `sms_consent = true`; clinic with `chat_optin_enabled = true` and `self_booking_enabled = false`.
2. Start the campaign. The pre-call SMS should include a `/connect/…` link.
3. Open it, pick Telegram, press Start. The bot should ask for YES.
4. Reply `OO`. Check `patient_channels.opted_in_at` is set and `patients.preferred_channel = 'telegram'`.
5. Re-queue the patient. The pre-call notice should now arrive in Telegram, not SMS.
6. Turn on `self_booking_enabled`, reply `BOOK`, and confirm a `/book/…` link arrives.
7. Reply `TIGIL`. `opted_out_at` should be set and the next notice goes back to SMS.

## Not built yet

- Messenger utility templates (reminders outside the 24h window)
- Viber/Messenger rich buttons for YES / BOOK / STOP
- Staff inbox with replies over `channel_messages` (the patient page shows history only)
- Clinic-wide front-desk QR code (today's QR codes are per patient)
- Chat campaigns that fall back to a call when there's no reply (needs Telnyx)
- Conversational booking in chat (reuse assistant-tools behind an LLM)
