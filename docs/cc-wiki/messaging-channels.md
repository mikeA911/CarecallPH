---
id: messaging-channels
title: Messaging channels (Viber, Messenger, WhatsApp, Telegram, SMS)
summary: How patients opt in to chat apps, which channel CareCall uses, keywords patients can reply, limits.
roles: staff
routes: []
updated: 2026-10-01
---

## Which channel is used

For each message CareCall picks, in order:

1. the chat app the patient last said YES on,
2. any other chat app they opted in to, in this order: **Viber, Messenger,
   WhatsApp, Telegram** (most to least used in the Philippines),
3. SMS, only if the patient has SMS consent.

If none of these apply, no message is sent; the call still happens.

Messenger and WhatsApp can only be used within 24 hours of the patient's last
message to the clinic. Outside that window CareCall uses the patient's next
channel.

## How patients opt in

1. A text message from the clinic includes a link: "Get reminders on Viber,
   Messenger…".
2. The link opens a page with a button for each app.
3. The app opens a chat with the clinic's assistant, which asks the patient to
   reply **YES** (or OO / OPO / SIGE).
4. Nothing is sent on that app until they reply YES. That reply is recorded as
   their consent.

One chat account can be linked to several patients, for example a parent who
manages their children's appointments.

## Keywords patients can send

- **YES / OO / OPO / SIGE / OK**: start messages on this app.
- **STOP / TIGIL / HINTO / AYAW NA / UNSUBSCRIBE**: stop messages on this app.
- **BOOK / BOOKING / SCHEDULE / ISKEDYUL / APPOINTMENT**: get a booking link
  (when self-booking is on).

Any other message gets a short reply pointing to BOOK, the clinic's number and
911 for emergencies. Staff can't yet reply to chat messages from the portal.

## Turning it on

Chat invites are enabled per clinic by a platform admin. There is no toggle in
Clinic settings yet.
