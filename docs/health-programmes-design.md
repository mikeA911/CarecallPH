# Health programmes: campaigns and care schedules beyond recall

Status: **designed, not built** (Oct 2026). Comes after the first clinic pilot.
Builds on chat campaigns (Phase 1T), care plans and doctor sign-off (Phase M),
the sign-up page and consent records.

Once a clinic has enough patients who agreed to hear from it, it can run
health programmes: one-off **drives** (a flu or measles vaccination day, a
blood-pressure screening week) and ongoing **programmes** that follow one
patient over months (maternity, a child's vaccinations). Nothing reaches a
patient who didn't opt in to this purpose.

## 1. What exists today

| Piece | Today | Gap |
|---|---|---|
| Chat campaigns | Booking-link message, one reminder, reply BOOK, statuses and analytics | Patients picked one by one by name or phone |
| Consent | Chat YES covers appointment reminders and booking links; separate YES for medicine reminders and vital signs; sign-up page records the privacy notice version | No opt-in for health programmes and announcements |
| Schedules | Monitoring plans: nurse drafts, doctor signs, versions, requests at set times | No schedule tied to a pregnancy or a child's age |
| Family | One chat account can hold several patients (a parent and children) | Messages don't yet group a family's schedules |

## 2. Consent for health programmes

A new consent scope, `health_programmes`, separate from appointment messages:

- **Sign-up page:** an extra box, unticked: "Tell me about health programmes at
  the clinic (vaccinations, check-ups, screenings)". Stored with the wording
  version, like the privacy notice.
- **Existing patients:** staff send the ask in the chat ("Reply YES to hear
  about…"), recorded in `care_consents` with its wording version, as medicine
  reminders are today.
- **Withdraw anytime:** STOP PROGRAMMES (and Filipino equivalents) stops
  programme messages only; STOP still stops everything.
- **Enrolment in an ongoing programme** (maternity, child vaccinations) is its
  own consent per programme, asked by a nurse or doctor, naming the programme
  and what messages to expect.

Drives only reach patients with `health_programmes`; the campaign screen shows
how many in the chosen group can be reached and how many have not opted in.

## 3. Drives: choosing patients by group

Campaigns gain an **audience** instead of (or as well as) ticking names:

| Filter | Source | Example |
|---|---|---|
| Age band | Date of birth | Children 6–59 months; adults 60+ |
| Sex | Patient record | Women 25–65 for a screening week |
| Last visit | Appointments marked came | Not seen in 12 months |
| Care plan | Running monitoring plan or medicines | Patients on a blood-pressure plan |
| Programme | Enrolled in a programme | Mothers in the maternity programme |

- Filters that use clinical data (care plans, programmes) are for nurses and
  doctors only; front desk can build drives from age, sex and last visit.
- The preview shows counts, then the list for staff to untick anyone.
- The message is approved wording from a template library (below), not free
  text, plus the booking link for the drive's own slots (e.g. a vaccination
  day with 5-minute slots).

## 4. Ongoing programmes

A **programme** is a schedule a doctor signs for one patient, like a monitoring
plan, made from a doctor-approved template.

### Maternity (antenatal and postnatal)

1. A nurse or doctor enrols the patient with her expected delivery date (or
   last menstrual period) and asks for consent.
2. The template places the antenatal visits at the clinic's agreed weeks
   (the DOH and WHO schedules to be confirmed by the clinic's doctor); each
   becomes a booking invitation, then normal reminders.
3. Between visits: short messages at set weeks (what to expect, tetanus
   vaccination, iron supplements as prescribed) and **warning signs**
   (bleeding, severe headache, blurred vision, swelling, fever, reduced baby
   movements: go to the hospital now, with the clinic's local emergency
   numbers).
4. Optional: blood-pressure readings through the existing vital-signs plan.
5. After birth: a postnatal check, then the baby is added as a patient (on the
   mother's chat account) and moved to the child vaccination programme.

### Child vaccinations

- The template follows the national immunisation schedule by the child's age
  (doses and timing confirmed by the clinic's doctor).
- Each due dose is a booking invitation to the parent's chat, then reminders.
- Staff record each dose given at the visit (date, vaccine, batch optional);
  the next dose is placed from it. Missed doses create a CC action item.
- FHIR: Immunization resources in the record export.

### Other programmes from the same parts

Senior check-ups and flu season, TB treatment follow-up, diabetes or
hypertension reviews every 3 months, family planning follow-ups. Each is a
template a doctor approves before the clinic can use it.

## 5. Templates and wording

- A **template** holds the schedule (offsets from a date: delivery date, birth
  date, enrolment), the message for each step in English and Filipino, and
  any warning-sign text. Templates are versioned and signed by a doctor;
  a clinic uses only signed templates.
- Messages never name a diagnosis unless the patient opted for it, follow the
  **Discreet** rule for shared phones, and never advertise products.
- Warning-sign messages go to 911 and local emergency numbers first, as the
  critical-reading messages do.

## 6. Privacy and roles

- Pregnancy, vaccinations and programme membership are health data: only
  nurses and doctors enrol patients and see programmes; front desk sees the
  resulting appointments only.
- CC sees counts only (patients enrolled, doses due, visits attended).
- Every enrolment, consent, dose recorded and message sent is audited.
- Patients' privacy rights apply: a restricted record gets no programme
  messages; disposal removes programme data with the record.

## 7. Measuring it

On the pilot dashboard, per drive or programme: invited, booked, came; doses
due vs given on time; antenatal visits attended vs planned; opt-outs.

## 8. Build order

1. **Consent scope** `health_programmes` (sign-up box, chat ask, STOP
   PROGRAMMES) and **audience filters** for campaigns, with counts.
2. **Drives**: drive slots, approved templates, results on the dashboard.
3. **Programme engine**: templates, doctor sign-off, enrolment, schedule
   steps, booking invitations and messages.
4. **Child vaccinations** (dose records, FHIR Immunization), then
   **maternity**, with the clinic's doctor approving both schedules.

## 9. Open questions

- Which schedules the pilot clinic's doctors want to use, and in which
  language mix.
- Whether barangay health stations (public) join through the DOH for
  vaccination drives (section 4 of `care-platform-design.md`).
- Whether vaccination records should be shareable with the patient's other
  clinics (a CareLink access grant with consent).
