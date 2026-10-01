# CareCall PH — Phase 1: Chat Messaging Channels

Viber, Facebook Messenger, WhatsApp and Telegram as opt-in patient channels, alongside SMS.

Fallback priority follows Philippine reach (MEF): **Viber 71%, Messenger 60%, WhatsApp 40%, Telegram 20%**, then SMS. Set in `CHANNEL_PRIORITY` in `_shared/channels.ts`; the `/connect` page orders its buttons the same way.

## How it works

```
SMS / voicemail follow-up ──► /connect/<token> page ──► deep link opens bot
        ▲                                                     │
        │                                     channel-webhook links chat → patient
        │                                     bot asks: "Reply YES (or OO)…"
        │                                                     │
start-campaign / telnyx-call-events ◄── sendToPatient() ◄── YES = opted_in_at (DPA consent)
```

- **One shared bot per platform**, multi-clinic. The clinic travels in the invite token.
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

### 3. Telegram (fastest to test, free)

1. Create the bot with @BotFather.
2. Register the webhook:

```bash
curl -s "https://api.telegram.org/bot$TELEGRAM_BOT_TOKEN/setWebhook" \
  -d "url=$WH?ch=telegram" \
  -d "secret_token=$TELEGRAM_WEBHOOK_SECRET" \
  -d 'allowed_updates=["message","my_chat_member"]'
```

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

## Not in Phase 1

- Messenger utility templates (reminders outside the 24h window)
- Viber/Messenger rich buttons for YES / BOOK / STOP
- Portal UI: per-patient channel status and a staff inbox over `channel_messages`
- Clinic front-desk QR code (generate from a clinic-level invite)
- Conversational booking in chat (reuse assistant-tools behind an LLM)
