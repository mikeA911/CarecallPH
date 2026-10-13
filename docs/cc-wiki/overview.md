---
id: overview
title: What CareCall is
summary: Product overview, who uses it, roles, and what CC can and cannot do.
roles: staff
routes:
  - / | staff | Dashboard
  - /about | staff | About CareCall
updated: 2026-10-12
---

CareCall helps small private clinics in the Philippines (Metro Manila, Cebu)
fill their appointment books. Clinic staff create **campaigns** (for example
"Annual check-ups" or "Follow-up visits"). For each patient in a campaign,
CareCall can send a heads-up message, place an AI voice call that verifies the
patient's identity and books a slot in a clinician's calendar, and fall back to
a message with a self-booking link when the patient doesn't answer.

Patients can be reached by voice call, SMS, Viber, Messenger, WhatsApp or
Telegram. Chat apps are opt-in only.

## Roles

Every user has an **access level** and a **clinical role**.

Access level (what they can manage):

- **Staff**: run campaigns, manage patients, work the Review queue, read call history.
- **Clinic admin**: everything staff can do, plus create campaigns, manage
  clinicians and availability, clinic settings and users.
- **Platform admin**: manages all clinics and global settings. Only a platform
  admin can make someone else a platform admin.

Clinical role (what they can do with health information):

- **Front desk**: bookings and messages. Sees the urgency of a symptom-check
  intake but not the symptoms; sees medicines but can't change them.
- **Nurse / assistant**: sees intake details, adds and stops medicines, asks
  patients to agree to reminders, drafts monitoring plans, reviews readings.
- **Doctor**: everything a nurse can do; linked to their clinician record and
  PRC number; signs clinical notes and monitoring plans (prescriptions next).

Users only ever see data for their own clinic (platform admins see all).

## About CC

CC is the assistant in the portal. Open it by clicking the CareCall logo (the
icon) at the top of the sidebar; click the **CareCall** name next to it for the
About page. CC can:

- answer questions about how CareCall works (from this wiki),
- take you to the right screen,
- walk you through workflows step by step,
- analyse campaign results with aggregate numbers,
- report on medicine adherence and vital-sign readings (nurses and doctors),
- file **action items** for the clinic admin, listed on the CC action items page.

**New chat** starts a fresh conversation and keeps the old one. **History**
lists your last 20 chats so you can reopen or delete them. History is saved in
this browser only: it doesn't follow you to another computer, and clearing the
browser's site data removes it.

Every night at 2:00 AM (Manila time) CC also reviews each clinic's running
campaigns, Review queue and care plans on its own. It files up to 5 action items marked
"nightly review" and leaves a short summary at the top of the CC action items
page. Clinics with nothing running are skipped. Missed-dose and no-reading
alerts are filed every hour on their own (see Care plan reports and alerts).

CC cannot change settings, start or stop campaigns, call or message patients,
or show individual patients' details. CC does not give medical advice.
