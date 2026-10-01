---
id: campaign-analytics
title: Reading campaign results
summary: Metric definitions (booking rate, unreached, needs human) and a diagnostic playbook with which action items to file.
roles: staff
routes:
  - /campaigns/:id | staff | Campaign detail
  - /review | staff | Review queue
updated: 2026-10-02
---

## Metrics

- **Total**: patients in the campaign.
- **In queue**: pending + notified (still to be called).
- **Booked**, **Declined**.
- **Unreached**: no_answer + voicemail.
- **Needs human**: verification_failed + needs_human.
- **Booking rate**: booked ÷ patients who have been contacted (everyone not
  pending, notified or calling). Early in a campaign it moves a lot; don't
  judge it on a handful of patients.

## Diagnostic playbook

When analysing, look for these patterns. Each suggests an action item. These
are rules of thumb, not benchmarks; say how many patients a conclusion rests on.

| Pattern | Likely cause | Suggested action |
|---|---|---|
| Unreached is a large share of contacted | Calling at bad times; unknown number ignored | Review calling hours; turn on the pre-call message; enable chat invites |
| Many voicemail but few follow-up messages sent | Patients lack SMS consent / chat opt-in | Collect SMS consent at the front desk; enable chat invites |
| verification_failed above a few patients | DOB errors in the import | Check DOBs for those patients; fix and Requeue |
| wrong_number repeating | Old phone numbers | Update numbers at next visit; Remove or Do not call |
| Many declined | Reason text unclear, or timing | Rewrite the reason; check clinician availability |
| Booked low while availability is thin | Not enough slots | Add availability on Clinicians |
| Needs human waiting a long time | Queue not being worked | Work the Review queue |
| callback_requested piling up | Normal; they will be re-called | Nothing, unless they repeat |
| Channel failures | Patients blocked the bot / tokens expired | Check channel setup with the platform admin |

## Filing action items

The same rules apply to items filed in chat and by the nightly review.

File an action item when something needs a person to act. Include the campaign,
the numbers behind it, one concrete next step, and the screen to do it on. Use
severity **urgent** only for things blocking bookings now (e.g. no availability,
queue not moving), **warning** for things lowering results, **info** otherwise.
Don't file duplicates of open items.
