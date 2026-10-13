---
id: navigation
title: Finding your way around
summary: Every screen and patient-page section, what it is for, who can see it (access and clinical role), and automatic sign-out.
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

- **Dashboard**: today's activity, quick links, appointment slots, recent activity,
  and a map of the clinic (its location is set in Clinic settings → **Find on map**).
- **Review queue**: patients who need a human (failed identity check, asked for
  a person, dialing problems). The number badge shows how many are waiting.
- **Campaigns**: list of campaigns and their progress. Open one for detail.
- **Patients**: patient list, CSV import, add one patient, assign to a campaign.
- **Call history**: every call with outcome, duration and AI summary.
- **CC action items**: follow-ups CC has filed for the clinic.

Under **Manage** (clinic admin and above): **Clinicians** (clinicians, their
weekly hours and PRC numbers), **Clinic settings** (clinic details, DOH
facility code and address, reminders, symptom check link, calling hours,
records retention), **Users** (invite users, access and clinical role, make a
doctor).

Under **Platform** (platform admins only): **Clinics**, **Global settings**
(including the default records retention period).

The sidebar depends on the user's access (staff, clinic admin, platform
admin). Their clinical role (front desk, nurse / assistant, doctor) doesn't
change the sidebar; it changes what they see on a patient's page.

## A patient's page

Open a patient from **Patients**. From top to bottom:

- **Details**: phone, birthday, sex, email, address, PhilHealth PIN, consent
  flags. **Edit details** (clinic admins); **Download record (FHIR)** (nurses
  and doctors) saves the record in the national health data format.
- **Chat apps** and **Messages**: invite to a chat app, and the last messages.
- **Medicines**: medicine reminders by chat and adherence. Everyone sees the
  list; nurses and doctors add or stop medicines and ask for consent.
- **Clinical notes** (nurses and doctors only): dictate, record a consultation
  with consent, or type; CC drafts the note; doctors sign with their password.
- **Appointments**: visits, how they were booked and reminder answers. A
  symptom-check booking shows the urgency to everyone and the symptoms to
  nurses and doctors.
- **Call history**: AI calls to this patient.

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
