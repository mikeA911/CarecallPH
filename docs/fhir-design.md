# FHIR-ready records: design

**Status:** slice F1 built (fields + read-only FHIR export). **Roadmap:** Phase L (CareLink Records),
started early so prescriptions (M2) and vital signs (M3) are built to the standard from day one.

## Decision

CareCall keeps its records in ordinary tables (one row per patient, appointment, medicine…) and
**produces FHIR R4 on request**. It does not store FHIR documents as its system of record.

- **Why not store FHIR JSON?** Who may see and change what (clinic scope, clinical roles) is
  enforced in the database on columns. FHIR blobs would make those rules hard to write and to
  check, and every working feature (reminders, booking, dashboard, CC) would need rewriting.
- **Why not wait?** The fields FHIR expects (sex, address, PhilHealth number, facility code,
  coded medicines and readings) are cheapest to collect from the start. M2 and M3 will create
  the most clinical data, so they must be shaped for FHIR before they are built.
- **Which standard?** HL7 **FHIR R4 (4.0.1)** with the Philippine profiles, **PH Core**. HL7
  version 2 (hospital and lab messaging) is not needed now; it can be added at an interface if
  a lab or hospital requires it.
- **PH Core is a draft** (v0.2.0, canonical `https://fhir.doh.gov.ph/phcore`, UP Manila
  National TeleHealth Center for DOH). Its URLs have changed between builds. Every PH Core
  URL CareCall uses is in one file, `supabase/functions/_shared/fhir/systems.ts`, pinned to
  the source we checked (GitHub `UPM-NTHC/ph-core`, commit `3299879`, 2026-09-09). When the
  guide changes, that file and the tests change; the database doesn't.

Legal basis: DOH–PhilHealth Joint Administrative Orders 2021-0001 (national health data
standards for interoperability) and 2021-0002 (integrated health information systems), under
the UHC Act (RA 11223). Health data stays subject to the Data Privacy Act (RA 10173).

## Mapping

| CareCall | FHIR R4 resource | Profile | Notes |
|---|---|---|---|
| `patients` | Patient | PH Core Patient | name (given = first, middle), gender, birthDate, telecom (mobile, email), address (PH Core Address), PhilHealth PIN |
| `providers` | Practitioner | PH Core Practitioner | name, qualification with PRC licence number |
| `clinics` | Organization | PH Core Organization | name, DOH NHFR facility code, address, phone |
| `appointments` | Appointment | base R4 (PH Core has none) | status mapped, participant patient + practitioner, start/end |
| symptom-check intake | QuestionnaireResponse | base R4 | slice F2 |
| `medications` | MedicationRequest | PH Core MedicationRequest | text medicine until M2 adds FDA codes; dosage text + timing (times of day, start/end) |
| `medication_doses` (taken / skipped) | MedicationAdministration | PH Core MedicationAdministration | patient-reported; `completed` or `not-done`; unanswered and missed are not exported |
| `care_consents` | Consent | base R4 | scope patient-privacy, category LOINC 59284-0, active / rejected / inactive |
| vital signs (M3) | Observation | PH Core Observation (vital signs) | LOINC codes, UCUM units |
| monitoring plan (M3) | CarePlan | base R4 | |
| `clinical_notes` (signed) | Encounter + Composition | base R4 | one Encounter per note (ambulatory); Composition LOINC 11506-3 with SOAP sections; addenda `relatesTo: appends`. Built with M6 |
| diagnoses (later) | Condition | PH Core Condition | ICD-10 |

Identifiers: resource ids are CareCall's own UUIDs. National identifiers use the PH Core
systems:

| Identifier | System | Where |
|---|---|---|
| PhilHealth PIN | `http://philhealth.gov.ph/fhir/Identifier/philhealth-id`, type v2-0203 `NH` | Patient |
| DOH NHFR facility code | `https://fhir.doh.gov.ph/phcore/Identifier/doh-nhfr-code` | Organization |
| PRC licence | `http://prc.gov.ph/fhir/Identifier/prc-license` (from PH Core's example; no profile yet) | Practitioner.qualification |
| PSGC place codes | `https://psa.gov.ph/classification/psgc` | Address extensions |

PhilSys (national ID) numbers are **not** collected: PH Core allows them, but CareCall has no
need for them and they raise the privacy risk.

## Slices

| Slice | Scope | Status |
|---|---|---|
| **F1** | Fields: patient middle name, sex, address (line, barangay, city/municipality, province, postal code), PhilHealth PIN; clinic DOH facility code and address. Portal: edit patient details, clinic facility code. **FHIR export**: `fhir` function returns Patient, Practitioner, Organization, Appointment, MedicationRequest, MedicationAdministration, Consent, and a patient's whole record as a Bundle (`Patient/{id}/$everything`), with a **Download record (FHIR)** button. Tests check output against the PH Core rules we use | **Built** |
| F2 | Symptom-check intake as QuestionnaireResponse; PSGC pickers for barangay / city / province (codes, not just names); official HL7 validator with the PH Core package in CI (needs network the build sandbox lacks) | Planned |
| F3 | M2 prescriptions with FDA drug codes (`PHFDACPRCS`, PH Core DrugsVS) and structured dosage; M3 readings as Observations (LOINC, UCUM); CarePlan | With M2/M3 |
| F4 | Import (patient-directed, from other FHIR systems) and exchange with PhilHealth or hospitals; SMART on FHIR access for authorized apps | Phase L |

## The export (F1)

`supabase/functions/fhir` (deploy with JWT verification on):

```
GET /functions/v1/fhir/Patient/{id}               → Patient
GET /functions/v1/fhir/Patient/{id}/$everything   → Bundle (searchset) of the patient's record
GET /functions/v1/fhir/Practitioner/{id}
GET /functions/v1/fhir/Organization/{id}
GET /functions/v1/fhir/metadata                   → CapabilityStatement
```

Also `POST { resource, id, everything? }` for the portal. Responses are
`application/fhir+json`; errors are OperationOutcome.

- **Who:** signed-in portal users of the patient's clinic (platform admins: any clinic). A
  patient's record (`Patient` and `$everything`) needs a **nurse or doctor** clinical role:
  it includes medicines and consents. Practitioner and Organization: any clinic user.
- **Audit:** every export writes `fhir_export` to the audit log (who, which patient, which
  resources).
- **Mapping code** is pure (`_shared/fhir/map.ts`) and unit-tested; the function only loads
  rows, checks access and wraps the result.
- Read only. No FHIR writes into CareCall in F1.

## Field rules (F1)

- **Sex** (`patients.sex`): FHIR administrative gender, `male | female | other | unknown`.
  Optional. PH Core's SOGIE extensions (sex at birth, gender identity) are not collected.
- **Middle name**: the Filipino middle name (usually the mother's maiden surname); exported as
  the second given name, per PH Core Name.
- **PhilHealth PIN**: 12 digits, stored without dashes, shown and exported as `nn-nnnnnnnnn-n`.
  Optional; not verified with PhilHealth.
- **Address**: free text in F1 (street/house, barangay, city or municipality, province, postal
  code); exported in `line`, `city`, `district` (province), `postalCode`, `country = PH`. PSGC
  codes come with the pickers in F2.
- **Facility code** (`clinics.nhfr_code`): the DOH National Health Facility Registry code, as
  issued. Optional.
