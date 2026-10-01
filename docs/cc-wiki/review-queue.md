---
id: review-queue
title: Review queue
summary: Patients needing a human; what each action (Resolve, Requeue, Remove, Do not call) does.
roles: staff
routes:
  - /review | staff | Review queue
updated: 2026-10-01
---

The Review queue lists patients with status **verification_failed** or
**needs_human**, with the reason. The sidebar badge shows how many are waiting.

Actions:

- **Resolve**: you handled it (e.g. called the patient yourself). Removes it
  from the queue.
- **Requeue**: put the patient back to pending so the campaign tries again.
  Fix the cause first (for example correct the date of birth).
- **Remove**: take the patient out of this campaign.
- **Do not call**: never contact this patient again from any campaign.

Common causes:

- verification_failed: wrong DOB in the import, or someone else answered.
- needs_human with "dial failed after pre-call SMS": the number may be
  unreachable or invalid.
