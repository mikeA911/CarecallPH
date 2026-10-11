---
id: messaging-channels
title: Messaging channels (Viber, Messenger, WhatsApp, Telegram, SMS)
summary: How patients opt in to chat apps, which channel CareCall uses, keywords patients can reply, limits.
roles: staff
routes: []
updated: 2026-10-11
---

## Which channel is used

For each message CareCall picks, in order:

1. the chat app the patient last said YES on,
2. any other chat app they opted in to, in this order: **Viber, Messenger,
   WhatsApp, Telegram** (most to least used in the Philippines),
3. SMS, only if the patient has SMS consent.

If none of these apply, no message is sent. In a call campaign the call still
happens; in a chat campaign the patient is shown as **needs chat invite**.

Messenger and WhatsApp can only be used within 24 hours of the patient's last
message to the clinic. Outside that window CareCall uses the patient's next
channel.

## How patients opt in

1. The patient gets an invite link, either:
   - from staff: **Invite to chat** on the patient's page gives a link, a QR
     code and ready-made messages in English and Filipino to send from the
     clinic's phone or show at the front desk; or
   - inside a text message from CareCall, when **Chat app invites in text
     messages** is on in Clinic settings.
2. The link opens a page with a button for each app the clinic has set up.
3. The app opens a chat with the clinic's assistant, which asks the patient to
   reply **YES** (or OO / OPO / SIGE).
4. Nothing is sent on that app until they reply YES. That reply is recorded as
   their consent.

One chat account can be linked to several patients, for example a parent who
manages their children's appointments. Invite links work for 30 days.

The patient's page shows **Chat apps** (connected, said YES, status) and their
recent **Messages**.

## Which apps are available

Each app needs its own setup by the platform team. Telegram works right away.
Messenger and WhatsApp need Meta approval, and Viber needs a commercial
agreement with Viber, so they appear on the invite page only once approved.

## Keywords patients can send

- **YES / OO / OPO / SIGE / OK**: start messages on this app.
- **STOP / TIGIL / HINTO / AYAW NA / UNSUBSCRIBE**: stop messages on this app.
- **BOOK / BOOKING / SCHEDULE / ISKEDYUL / APPOINTMENT**: get a booking link
  for any open chat campaign, or any open call campaign when **Self-booking
  links in call campaigns** is on.

Any other message gets a short reply pointing to BOOK, the clinic's number and
911 for emergencies. Staff can't yet reply to chat messages from the portal.

## Turning it on

**Invite to chat** on a patient's page always works. Clinic admins control
**Self-booking links in call campaigns** and **Chat app invites in text
messages** in Clinic settings.
