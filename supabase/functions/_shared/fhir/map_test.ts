// FHIR export (slice F1): CareCall rows → FHIR R4 with PH Core profiles.
// These check the R4 rules each resource must meet (required elements,
// invariants) and the PH Core rules we rely on (fixed identifier systems,
// profiles). The official HL7 validator is planned for CI (F2).
// Run: deno test supabase/functions/_shared/fhir/map_test.ts
import {
  bundle, clean, formatPhilhealthId, type Resource, toAppointment, toComposition, toConsent, toEncounter,
  toCarePlan, toMedicationAdministration, toMedicationRequest, toObservations, toOrganization, toPatient, toPractitioner,
} from "./map.ts";
import { PROFILE, SYSTEM, VITALS_PROFILE } from "./systems.ts";

function eq(actual: unknown, expected: unknown, msg = "") {
  const a = JSON.stringify(actual), e = JSON.stringify(expected);
  if (a !== e) throw new Error(`${msg}\n  expected ${e}\n  got      ${a}`);
}
function ok(cond: unknown, msg: string) { if (!cond) throw new Error(msg); }

/** FHIR ele-1 (no empty elements), id format, and dateTime / date shapes, everywhere. */
function wellFormed(r: unknown, path = "") {
  if (r === null || r === undefined || r === "") throw new Error(`empty value at ${path}`);
  if (Array.isArray(r)) { ok(r.length, `empty array at ${path}`); r.forEach((x, i) => wellFormed(x, `${path}[${i}]`)); return; }
  if (typeof r === "object") {
    const o = r as Record<string, unknown>;
    ok(Object.keys(o).length, `empty object at ${path}`);
    if (typeof o.resourceType === "string" && o.id !== undefined) ok(/^[A-Za-z0-9\-.]{1,64}$/.test(String(o.id)), `bad id at ${path}`);
    for (const [k, v] of Object.entries(o)) {
      wellFormed(v, `${path}.${k}`);
      if (/^(birthDate|start|end|authoredOn|effectiveDateTime|dateTime|created)$/.test(k) && typeof v === "string") {
        ok(/^\d{4}-\d{2}-\d{2}(T\d{2}:\d{2}(:\d{2}(\.\d+)?)?(Z|[+-]\d{2}:\d{2}))?$/.test(v), `bad date ${v} at ${path}.${k}`);
      }
    }
  }
}

const CLINIC = "00000000-0000-0000-0000-000000000001";
const patientRow = {
  id: "aaaaaaaa-0000-0000-0000-000000000001", clinic_id: CLINIC, first_name: "Juan", middle_name: "Santos",
  last_name: "Dela Cruz", phone: "+639171234567", email: null, date_of_birth: "1960-05-01", sex: "male",
  address_line: "123 Mabini St", barangay: "Malinis", city_municipality: "Quezon City", province: "Metro Manila",
  postal_code: "1100", philhealth_id: "635847898455", provider_id: "11111111-1111-1111-1111-111111111111", active: true,
};

Deno.test("Patient: PH Core profile, name, PhilHealth PIN, address", () => {
  const p = toPatient(patientRow);
  wellFormed(p);
  eq(p.meta.profile, [PROFILE.patient]);
  eq(p.name[0].given, ["Juan", "Santos"], "PH Core Name: given[0] first, given[1] middle");
  eq(p.name[0].family, "Dela Cruz");
  // PHCorePhilHealthID: system and type fixed exactly.
  eq(p.identifier, [{ system: "http://philhealth.gov.ph/fhir/Identifier/philhealth-id",
    type: { coding: [{ system: "http://terminology.hl7.org/CodeSystem/v2-0203", code: "NH" }], text: "PhilHealth ID" },
    value: "63-584789845-5" }]);
  eq(p.gender, "male");
  eq(p.address[0].line, ["123 Mabini St", "Malinis"]);
  eq(p.address[0].city, "Quezon City");
  eq(p.address[0].district, "Metro Manila");
  eq(p.address[0].country, "PH");
  eq(p.telecom, [{ system: "phone", value: "+639171234567", use: "mobile" }], "no empty email");
  eq(p.managingOrganization, { reference: `Organization/${CLINIC}` });
});

Deno.test("Patient with only the basics has no empty elements", () => {
  const p = toPatient({ id: "b1", clinic_id: CLINIC, first_name: "Ana", last_name: "Cruz", phone: "+639170000000" });
  wellFormed(p);
  eq(p.identifier, undefined); eq(p.address, undefined); eq(p.gender, undefined);
  eq(p.name[0].given, ["Ana"]);
});

Deno.test("Practitioner: PRC licence in qualification", () => {
  const r = toPractitioner({ id: "11111111-1111-1111-1111-111111111111", clinic_id: CLINIC, name: "Dr. Jones", specialty: "Family Medicine", prc_number: "0123456" });
  wellFormed(r);
  eq(r.meta.profile, [PROFILE.practitioner]);
  eq(r.qualification[0].identifier, [{ system: SYSTEM.prcLicense, value: "0123456" }]);
  eq(r.qualification[0].code.coding[0].code, "MD");
  eq(toPractitioner({ id: "x", clinic_id: CLINIC, name: "Dr. No PRC" }).qualification, undefined);
});

Deno.test("Organization: DOH NHFR facility code", () => {
  const o = toOrganization({ id: CLINIC, name: "CareCall Test Site", nhfr_code: "4XYZ123", city_municipality: "Makati" });
  wellFormed(o);
  eq(o.meta.profile, [PROFILE.organization]);
  eq(o.identifier, [{ system: "https://fhir.doh.gov.ph/phcore/Identifier/doh-nhfr-code", value: "4XYZ123" }]);
  eq(o.address[0].use, "work");
});

Deno.test("Appointment: R4 status codes, both start and end, participants", () => {
  const base = { id: "c1", patient_id: "p1", provider_id: "d1", starts_at: "2026-10-20T01:00:00+00:00", ends_at: "2026-10-20T01:30:00+00:00" };
  const a = toAppointment({ ...base, status: "confirmed", source: "symptom_check", created_at: "2026-10-13T02:00:00Z" });
  wellFormed(a);
  eq(a.status, "booked");
  ok(a.start && a.end, "app-2: start and end together");
  eq(a.participant.length, 2);
  ok(a.participant.every((x: Resource) => x.status && x.actor), "participant needs status and actor");
  eq(toAppointment({ ...base, status: "cancelled" }).status, "cancelled");
  eq(toAppointment({ ...base, status: "no_show" }).status, "noshow");
  eq(toAppointment({ ...base, status: "weird" }).status, "booked");
  eq(toAppointment({ ...base, provider_id: null, status: "booked" }).participant.length, 1);
});

const med = {
  id: "m1", patient_id: "p1", name: "Amlodipine", dose: "5 mg, 1 tablet", instructions: "after breakfast",
  times_of_day: ["08:00:00", "20:00"], start_date: "2026-10-01", end_date: null, active: true, created_at: "2026-10-01T03:00:00Z",
};

Deno.test("MedicationRequest: status, intent, medication, timing", () => {
  const r = toMedicationRequest(med, CLINIC);
  wellFormed(r);
  eq(r.meta.profile, [PROFILE.medicationRequest]);
  eq([r.status, r.intent], ["active", "order"]);
  eq(r.medicationCodeableConcept, { text: "Amlodipine" });
  eq(r.dosageInstruction[0].text, "5 mg, 1 tablet, after breakfast");
  eq(r.dosageInstruction[0].timing.repeat.timeOfDay, ["08:00:00", "20:00:00"]);
  eq(r.dosageInstruction[0].timing.repeat.frequency, 2);
  eq(toMedicationRequest({ ...med, active: false }, CLINIC).status, "stopped");
  eq(toMedicationRequest({ ...med, end_date: "2026-01-31" }, CLINIC).status, "completed");
});

Deno.test("MedicationAdministration: taken / skipped only, required elements", () => {
  const d = { id: "d1", medication_id: "m1", patient_id: "p1", due_at: "2026-10-12T00:00:00Z", status: "taken", answered_at: "2026-10-12T00:05:00Z" };
  const t = toMedicationAdministration(d, "Amlodipine")!;
  wellFormed(t);
  eq(t.meta.profile, [PROFILE.medicationAdministration]);
  eq(t.status, "completed");
  ok(t.medicationCodeableConcept && t.subject && t.effectiveDateTime, "medication[x], subject, effective[x] are 1..1");
  eq(t.request, { reference: "MedicationRequest/m1" });
  eq(toMedicationAdministration({ ...d, status: "skipped" }, "Amlodipine")!.status, "not-done");
  for (const s of ["sent", "missed", "failed", "no_channel"]) eq(toMedicationAdministration({ ...d, status: s }, "x"), null, s);
});

Deno.test("Consent: status from the answer, scope, category, policy (ppc-1)", () => {
  const c = { id: "k1", patient_id: "p1", clinic_id: CLINIC, scopes: ["medication_reminders"], wording_version: "meds-v1-2026-10-15",
    channel: "telegram", requested_at: "2026-10-12T01:00:00Z", consented_at: "2026-10-12T01:05:00Z" };
  const r = toConsent(c);
  wellFormed(r);
  eq(r.status, "active");
  ok(r.scope && r.category?.length && r.patient, "scope, category, patient");
  ok(r.policy?.length || r.policyRule, "ppc-1: policy or policyRule");
  eq(r.provision.period, { start: "2026-10-12T01:05:00Z" });
  eq(toConsent({ ...c, withdrawn_at: "2026-10-13T00:00:00Z" }).status, "inactive");
  eq(toConsent({ ...c, consented_at: null, declined_at: "2026-10-12T02:00:00Z" }).status, "rejected");
  eq(toConsent({ ...c, consented_at: null }).status, "proposed");
});

Deno.test("Bundle: searchset with the patient as match", () => {
  const b = bundle([toPatient(patientRow), toMedicationRequest(med, CLINIC)], "https://x/fhir");
  wellFormed(b);
  eq(b.total, 2);
  eq(b.entry.map((e: Resource) => e.search.mode), ["match", "include"]);
  eq(b.entry[0].fullUrl, `https://x/fhir/Patient/${patientRow.id}`);
});

Deno.test("helpers", () => {
  eq(formatPhilhealthId("635847898455"), "63-584789845-5");
  eq(clean({ a: "", b: [], c: { d: undefined }, e: [null, 1], f: 0, g: false }), { e: [1], f: 0, g: false });
});

const note = {
  id: "n1", clinic_id: CLINIC, patient_id: "p1", kind: "note", encounter_date: "2026-10-13", mode: "dictation",
  subjective: "Dizzy in the mornings <1 week>", objective: "BP 150/95", assessment: "Hypertension, not controlled",
  plan: "Amlodipine 10 mg once a day\nFollow up in 2 weeks", status: "signed", signed_provider_id: "d1",
  signed_at: "2026-10-13T03:00:00Z",
};

Deno.test("Composition: signed SOAP note, escaped narrative, Encounter", () => {
  const c = toComposition(note)!;
  wellFormed(c);
  eq([c.status, c.type.coding[0].code, c.date], ["final", "11506-3", "2026-10-13T03:00:00Z"]);
  ok(c.subject && c.author.length && c.title, "Composition needs subject, author, title");
  eq(c.section.map((s: Resource) => s.title), ["Subjective", "Objective", "Assessment", "Plan"]);
  ok(c.section[0].text.div.includes("&lt;1 week&gt;"), "narrative must be escaped xhtml");
  ok(c.section[3].text.div.includes("<p>Follow up in 2 weeks</p>"), "one paragraph per line");
  eq(c.encounter, { reference: "Encounter/n1" });
  eq(c.attester[0].party, { reference: "Practitioner/d1" });
  const e = toEncounter(note);
  wellFormed(e);
  eq([e.status, e.class.code], ["finished", "AMB"]);
  eq(toComposition({ ...note, status: "draft" }), null, "drafts are not exported");
});

Deno.test("Composition: addendum appends to the signed note", () => {
  const a = toComposition({ ...note, id: "n2", kind: "addendum", amends_note_id: "n1", subjective: null, objective: null,
    assessment: null, plan: null, addendum: "BP recheck 130/80" })!;
  wellFormed(a);
  eq(a.relatesTo, [{ code: "appends", targetReference: { reference: "Composition/n1" } }]);
  eq(a.section.length, 1);
  eq(a.encounter, undefined);
});

const reading = {
  id: "r1", clinic_id: CLINIC, patient_id: "p1", vital_plan_id: "vp1", measure: "bp", value1: "152", value2: "96",
  pulse: 80, taken_at: "2026-10-13T23:05:00Z", source: "chat", flag: "out_of_range",
};

Deno.test("Observation: blood pressure panel with components, pulse, plan and interpretation", () => {
  const [bp, hr] = toObservations(reading, (id) => (id === "vp1" ? "mp1" : undefined));
  wellFormed(bp); wellFormed(hr);
  eq([bp.status, bp.code.coding[0].code, bp.meta.profile[0]], ["final", "85354-9", VITALS_PROFILE.bp]);
  eq(bp.category[0].coding[0].code, "vital-signs");
  eq(bp.component.map((c: Resource) => [c.code.coding[0].code, c.valueQuantity.value, c.valueQuantity.code]),
    [["8480-6", 152, "mm[Hg]"], ["8462-4", 96, "mm[Hg]"]]);
  eq(bp.valueQuantity, undefined, "BP carries values in components only");
  eq(bp.interpretation[0].coding[0].code, "A");
  eq(bp.basedOn, [{ reference: "CarePlan/mp1" }]);
  eq(bp.performer, [{ reference: "Patient/p1" }]);
  eq([hr.id, hr.code.coding[0].code, hr.valueQuantity.value, hr.valueQuantity.code], ["r1-pulse", "8867-4", 80, "/min"]);
  ok(/^[A-Za-z0-9\-.]{1,64}$/.test(String(hr.id)), "FHIR id rules");
});

Deno.test("Observation: other measures, UCUM units, staff readings", () => {
  const one = (measure: string, value1: number, extra = {}) =>
    toObservations({ ...reading, measure, value1, value2: null, pulse: null, flag: "ok", ...extra })[0];
  const t = one("temperature", 38.2);
  wellFormed(t);
  eq([t.code.coding[0].code, t.valueQuantity.code, t.valueQuantity.value], ["8310-5", "Cel", 38.2]);
  const g = one("glucose", 110, { source: "staff" });
  eq([g.code.coding[0].code, g.valueQuantity.code, g.category[0].coding[0].code], ["41653-7", "mg/dL", "laboratory"]);
  eq(g.performer, [{ reference: `Organization/${CLINIC}` }]);
  eq(g.note, undefined);
  const s = one("spo2", 97);
  eq(s.code.coding.map((c: Resource) => c.code), ["59408-5", "2708-6"], "oxygensat profile needs 2708-6");
  eq(one("weight", 68.5).valueQuantity.code, "kg");
  eq(one("weight", 68.5, { vital_plan_id: null }).interpretation, undefined, "no plan, no interpretation");
  eq(toObservations({ ...reading, pulse: null }).length, 1);
  eq(toObservations({ ...reading, measure: "unknown" }), []);
});

Deno.test("CarePlan: signed monitoring plan, one activity per measure; drafts not exported", () => {
  const plan = { id: "mp1", clinic_id: CLINIC, patient_id: "p1", version: 2, status: "signed",
    signed_provider_id: "d1", signed_at: "2026-10-13T03:00:00Z" };
  const items = [{
    id: "vp1", plan_id: "mp1", measure: "bp", reason: "Check the new medicine", how_to: "Sit 5 minutes",
    times_of_day: ["07:00:00", "19:00:00"], days_of_week: [1, 3, 5], start_date: "2026-10-14", until_date: "2026-11-14",
    target_high: 140, target_high2: 90, critical_high: 180, critical_high2: 120, if_high: "Rest and recheck",
  }, {
    id: "vp2", plan_id: "mp1", measure: "weight", times_of_day: ["07:00"], days_of_week: null, start_date: "2026-10-14",
  }];
  const c = toCarePlan(plan, items)!;
  wellFormed(c);
  eq([c.status, c.intent, c.author], ["active", "plan", { reference: "Practitioner/d1" }]);
  eq(c.activity.length, 2);
  const a = c.activity[0].detail;
  eq([a.kind, a.status, a.code.coding[0].code], ["ServiceRequest", "in-progress", "85354-9"]);
  eq(a.scheduledTiming.repeat.timeOfDay, ["07:00:00", "19:00:00"]);
  eq(a.scheduledTiming.repeat.dayOfWeek, ["mon", "wed", "fri"]);
  ok(a.description.includes("critical at or above 180/120 mmHg") && a.description.includes("If high: Rest and recheck"), "description");
  eq(c.activity[1].detail.scheduledTiming.repeat.dayOfWeek, undefined);
  eq(toCarePlan({ ...plan, status: "stopped", stopped_at: "2026-10-20T00:00:00Z" }, items)!.status, "completed");
  eq(toCarePlan({ ...plan, status: "replaced" }, items)!.activity[0].detail.status, "stopped");
  eq(toCarePlan({ ...plan, status: "draft", signed_at: null }, items), null);
});
