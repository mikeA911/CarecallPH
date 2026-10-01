---
id: call-outcomes
title: How a call works and what each status means
summary: The AI call flow (voicemail detection, identity check, slot offer) and every patient status and call result.
roles: staff
routes:
  - /history | staff | Call history
updated: 2026-10-01
---

## The call

1. **Voicemail detection.** If a machine answers, the AI never starts. A short
   callback message with no health details is left, and a follow-up message is
   sent if the patient has a permitted channel.
2. **Identity check.** A live person is asked for their date of birth. The
   check happens on the server; the AI only learns match or no match. Two
   failures end the attempt and send the patient to the Review queue.
3. **Slot offer.** The AI offers up to 3 days, then up to 3 times on the chosen
   day, from the clinician's real availability. It cannot invent times.
4. **Confirmation.** The booking is made only after the patient confirms.
   Double-booking a clinician is impossible.
5. **No forced bookings.** Patients can decline, ask to be called another day,
   or ask for a person.

## Patient statuses in a campaign

| Status | Meaning |
|---|---|
| pending | Not contacted yet |
| notified | Pre-call message sent; call coming after the lead time |
| calling | Call in progress |
| booked | Appointment booked (by call or booking link) |
| declined | Patient said no |
| callback_requested | Patient asked to be called later; re-queued automatically after that time |
| no_answer | Nobody picked up |
| voicemail | Went to voicemail; message left |
| wrong_number | The person said it's the wrong number |
| verification_failed | Failed the date-of-birth check twice; in Review queue |
| needs_human | Patient asked for a person, or dialing kept failing; in Review queue |

## Call results (Call history)

booked, declined, callback_requested, no_answer, voicemail, wrong_number,
verification_failed, transferred, error. Each call also has a duration, whether
a machine answered, and an AI summary.
