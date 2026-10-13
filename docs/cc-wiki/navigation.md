---
id: navigation
title: Finding your way around
summary: Every screen in the portal, what it is for, who can see it, and automatic sign-out (browser closed, 20 minutes inactive).
roles: staff
routes:
  - / | staff | Dashboard
  - /review | staff | Review queue
  - /campaigns | staff | Campaigns
  - /patients | staff | Patients
  - /history | staff | Call history
  - /cc | staff | CC action items
  - /settings/profile | staff | Profile
  - /clinicians | clinic_admin | Clinicians
  - /settings/clinic | clinic_admin | Clinic settings
  - /settings/users | clinic_admin | Users
  - /admin/clinics | admin | Clinics (platform)
  - /admin/settings | admin | Global settings
updated: 2026-10-13
---

At the top of the left sidebar, the CareCall logo opens CC (this assistant) and
the **CareCall** name next to it opens the About page.

The left sidebar has these items:

- **Dashboard**: today's activity, quick links, appointment slots, recent activity.
- **Review queue**: patients who need a human (failed identity check, asked for
  a person, dialing problems). The number badge shows how many are waiting.
- **Campaigns**: list of campaigns and their progress. Open one for detail.
- **Patients**: patient list, CSV import, add one patient, assign to a campaign.
- **Call history**: every call with outcome, duration and AI summary.
- **CC action items**: follow-ups CC has filed for the clinic.

Under **Manage** (clinic admin and above): **Clinicians**, **Clinic settings**, **Users**.

Under **Platform** (admin only): **Clinics**, **Global settings**.

**Profile** and **Sign out** are at the bottom of the sidebar (scroll the
sidebar on a short screen).

## Automatic sign-out

To protect patient information on shared computers:

- Closing the browser, or every CareCall tab, signs you out. Opening another
  CareCall tab while one is open keeps you signed in.
- After **20 minutes** without activity (mouse, keyboard or touch) in any
  CareCall tab you are signed out. A warning appears 2 minutes before; moving
  the mouse or clicking **Stay signed in** keeps you in. Anything not saved
  is lost, so save forms before stepping away.
