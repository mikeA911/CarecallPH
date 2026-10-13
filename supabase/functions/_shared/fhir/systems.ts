// Every FHIR / PH Core URL CareCall uses, in one place (docs/fhir-design.md).
//
// PH Core is a DRAFT (v0.2.0). Values checked against the guide's source:
// GitHub UPM-NTHC/ph-core, commit 3299879 (2026-09-09). When the guide
// changes, change this file and the tests; the database stays as it is.

export const PH_CORE = "https://fhir.doh.gov.ph/phcore";
export const PH_CORE_VERSION = "0.2.0";

export const profile = (id: string) => `${PH_CORE}/StructureDefinition/${id}`;
export const PROFILE = {
  patient: profile("ph-core-patient"),
  practitioner: profile("ph-core-practitioner"),
  organization: profile("ph-core-organization"),
  medicationRequest: profile("ph-core-medicationrequest"),
  medicationAdministration: profile("ph-core-medicationadministration"),
};

export const EXT = {
  barangay: `${PH_CORE}/StructureDefinition/barangay`,
  cityMunicipality: `${PH_CORE}/StructureDefinition/city-municipality`,
  province: `${PH_CORE}/StructureDefinition/province`,
};

export const SYSTEM = {
  /** PhilHealth Identification Number (PIN), PH Core PHCorePhilHealthID. */
  philhealthId: "http://philhealth.gov.ph/fhir/Identifier/philhealth-id",
  /** DOH National Health Facility Registry code, PH Core PHCoreDOHNHFRCode. */
  nhfrCode: `${PH_CORE}/Identifier/doh-nhfr-code`,
  /** PRC licence: from PH Core's Practitioner example; not yet a profile. */
  prcLicense: "http://prc.gov.ph/fhir/Identifier/prc-license",
  /** Philippine Standard Geographic Code (PSA). */
  psgc: "https://psa.gov.ph/classification/psgc",
  v2_0203: "http://terminology.hl7.org/CodeSystem/v2-0203",
  v2_0360: "http://terminology.hl7.org/CodeSystem/v2-0360",
  loinc: "http://loinc.org",
  consentScope: "http://terminology.hl7.org/CodeSystem/consentscope",
  actCode: "http://terminology.hl7.org/CodeSystem/v3-ActCode",
  /** CareCall's own ids (UUIDs), for systems that need an identifier. */
  carecallId: "urn:ietf:rfc:3986",
};
