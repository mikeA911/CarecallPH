// CareCall rows → FHIR R4 resources with the Philippine profiles (PH Core).
// Pure functions: the `fhir` edge function loads rows and calls these.
// Mapping table and rules: docs/fhir-design.md
import { EXT, PROFILE, SYSTEM, VITALS_PROFILE } from "./systems.ts";

// deno-lint-ignore no-explicit-any
export type Resource = { resourceType: string; id?: string; [k: string]: any };
// deno-lint-ignore no-explicit-any
export type Element = { [k: string]: any };

export type PatientRow = {
  id: string; clinic_id: string; first_name: string; middle_name?: string | null; last_name: string;
  phone: string; email?: string | null; date_of_birth?: string | null; sex?: string | null;
  address_line?: string | null; barangay?: string | null; city_municipality?: string | null;
  province?: string | null; postal_code?: string | null; philhealth_id?: string | null;
  provider_id?: string | null; active?: boolean;
};
export type ProviderRow = { id: string; clinic_id: string; name: string; specialty?: string | null; prc_number?: string | null; active?: boolean };
export type ClinicRow = {
  id: string; name: string; phone_callback?: string | null; nhfr_code?: string | null; active?: boolean;
  address_line?: string | null; barangay?: string | null; city_municipality?: string | null;
  province?: string | null; postal_code?: string | null;
};
export type AppointmentRow = {
  id: string; patient_id: string; provider_id?: string | null; starts_at: string; ends_at: string;
  status: string; created_at?: string | null; source?: string | null;
};
export type MedicationRow = {
  id: string; patient_id: string; name: string; dose?: string | null; instructions?: string | null;
  times_of_day: string[]; start_date: string; end_date?: string | null; active: boolean; created_at?: string | null;
};
export type DoseRow = { id: string; medication_id: string; patient_id: string; due_at: string; status: string; answered_at?: string | null };
export type ConsentRow = {
  id: string; patient_id: string; clinic_id: string; scopes: string[]; wording_version: string; channel?: string | null;
  requested_at: string; consented_at?: string | null; declined_at?: string | null; withdrawn_at?: string | null;
};

const ref = (type: string, id: string | null | undefined) => (id ? { reference: `${type}/${id}` } : undefined);

/** Drop undefined, null, empty strings and empty arrays/objects, recursively. */
export function clean<T>(v: T): T {
  if (Array.isArray(v)) return v.map(clean).filter((x) => !isEmpty(x)) as T;
  if (v && typeof v === "object") {
    const out: Record<string, unknown> = {};
    for (const [k, x] of Object.entries(v)) { const c = clean(x); if (!isEmpty(c)) out[k] = c; }
    return out as T;
  }
  return v;
}
function isEmpty(x: unknown): boolean {
  return x === undefined || x === null || x === "" ||
    (Array.isArray(x) && x.length === 0) || (typeof x === "object" && x !== null && Object.keys(x).length === 0);
}

/** "123456789012" → "12-345678901-2" (PhilHealth PIN display format). */
export function formatPhilhealthId(pin: string): string {
  const d = pin.replace(/\D/g, "");
  return d.length === 12 ? `${d.slice(0, 2)}-${d.slice(2, 11)}-${d.slice(11)}` : pin;
}

type AddressFields = Pick<PatientRow, "address_line" | "barangay" | "city_municipality" | "province" | "postal_code">;

/**
 * PH Core Address. Names only in F1 (no PSGC codes yet, so no extensions):
 * line = street, barangay; city; district = province.
 */
export function phAddress(a: AddressFields): Element[] | undefined {
  if (!a.address_line && !a.barangay && !a.city_municipality && !a.province && !a.postal_code) return undefined;
  return [clean({
    use: "home",
    line: [a.address_line, a.barangay].filter(Boolean),
    city: a.city_municipality,
    district: a.province,
    postalCode: a.postal_code,
    country: "PH",
    text: [a.address_line, a.barangay, a.city_municipality, a.province, a.postal_code].filter(Boolean).join(", "),
  }) as Element];
}

/** A PSGC-coded address extension, for when the pickers (F2) store codes. */
export function psgcExtension(kind: keyof typeof EXT, code: string, display?: string) {
  return { url: EXT[kind], valueCoding: clean({ system: SYSTEM.psgc, code, display }) };
}

export function toPatient(p: PatientRow): Resource {
  return clean({
    resourceType: "Patient",
    id: p.id,
    meta: { profile: [PROFILE.patient] },
    identifier: p.philhealth_id ? [{
      system: SYSTEM.philhealthId,
      type: { coding: [{ system: SYSTEM.v2_0203, code: "NH" }], text: "PhilHealth ID" },
      value: formatPhilhealthId(p.philhealth_id),
    }] : undefined,
    active: p.active ?? true,
    // PH Core Name: given[0] first name, given[1] middle name.
    name: [{
      use: "official", family: p.last_name, given: [p.first_name, p.middle_name ?? undefined],
      text: [p.first_name, p.middle_name, p.last_name].filter(Boolean).join(" "),
    }],
    telecom: [
      { system: "phone", value: p.phone, use: "mobile" },
      p.email ? { system: "email", value: p.email } : undefined,
    ],
    gender: p.sex ?? undefined,
    birthDate: p.date_of_birth ?? undefined,
    address: phAddress(p),
    generalPractitioner: p.provider_id ? [ref("Practitioner", p.provider_id)] : undefined,
    managingOrganization: ref("Organization", p.clinic_id),
  });
}

export function toPractitioner(r: ProviderRow): Resource {
  return clean({
    resourceType: "Practitioner",
    id: r.id,
    meta: { profile: [PROFILE.practitioner] },
    active: r.active ?? true,
    name: [{ text: r.name }],
    qualification: r.prc_number ? [{
      identifier: [{ system: SYSTEM.prcLicense, value: r.prc_number }],
      code: { coding: [{ system: SYSTEM.v2_0360, code: "MD", display: "Doctor of Medicine" }], text: r.specialty ?? undefined },
    }] : undefined,
  });
}

export function toOrganization(c: ClinicRow): Resource {
  return clean({
    resourceType: "Organization",
    id: c.id,
    meta: { profile: [PROFILE.organization] },
    identifier: c.nhfr_code ? [{ system: SYSTEM.nhfrCode, value: c.nhfr_code }] : undefined,
    active: c.active ?? true,
    name: c.name,
    telecom: c.phone_callback ? [{ system: "phone", value: c.phone_callback, use: "work" }] : undefined,
    address: phAddress(c)?.map((a) => ({ ...a, use: "work" })),
  });
}

const APPT_STATUS: Record<string, string> = {
  booked: "booked", confirmed: "booked", cancelled: "cancelled", completed: "fulfilled",
  no_show: "noshow", noshow: "noshow", pending: "pending", proposed: "proposed",
};

export function toAppointment(a: AppointmentRow): Resource {
  return clean({
    resourceType: "Appointment",
    id: a.id,
    status: APPT_STATUS[a.status] ?? "booked",
    start: a.starts_at,
    end: a.ends_at,
    created: a.created_at?.slice(0, 10),
    comment: a.source ? `Booked by: ${a.source.replace(/_/g, " ")}` : undefined,
    participant: [
      { actor: ref("Patient", a.patient_id), status: "accepted" },
      a.provider_id ? { actor: ref("Practitioner", a.provider_id), status: "accepted" } : undefined,
    ],
  });
}

/** "08:00:00" or "08:00" → "08:00:00" (FHIR time). */
const fhirTime = (t: string) => (t.length === 5 ? `${t}:00` : t.slice(0, 8));

export function toMedicationRequest(m: MedicationRow, clinicId: string): Resource {
  const today = new Date().toISOString().slice(0, 10);
  const ended = !!m.end_date && m.end_date < today;
  return clean({
    resourceType: "MedicationRequest",
    id: m.id,
    meta: { profile: [PROFILE.medicationRequest] },
    // Entered by clinic staff from the doctor's prescription (M1). Signed
    // prescriptions with FDA drug codes come with M2.
    status: m.active ? (ended ? "completed" : "active") : "stopped",
    intent: "order",
    medicationCodeableConcept: { text: m.name },
    subject: ref("Patient", m.patient_id),
    authoredOn: m.created_at ?? undefined,
    requester: ref("Organization", clinicId),
    dosageInstruction: [{
      text: [m.dose, m.instructions].filter(Boolean).join(", ") || undefined,
      timing: { repeat: {
        boundsPeriod: { start: m.start_date, end: m.end_date ?? undefined },
        frequency: m.times_of_day.length, period: 1, periodUnit: "d",
        timeOfDay: m.times_of_day.map(fhirTime),
      } },
    }],
  });
}

/** Patient-reported doses: taken → completed, skipped → not-done. Others are not exported. */
export function toMedicationAdministration(d: DoseRow, medicineName: string): Resource | null {
  if (d.status !== "taken" && d.status !== "skipped") return null;
  return clean({
    resourceType: "MedicationAdministration",
    id: d.id,
    meta: { profile: [PROFILE.medicationAdministration] },
    status: d.status === "taken" ? "completed" : "not-done",
    statusReason: d.status === "skipped" ? [{ text: "Patient replied that they skipped this dose" }] : undefined,
    medicationCodeableConcept: { text: medicineName },
    subject: ref("Patient", d.patient_id),
    effectiveDateTime: d.due_at,
    performer: [{ actor: ref("Patient", d.patient_id) }],
    request: ref("MedicationRequest", d.medication_id),
    note: [{ text: `Reported by the patient in chat${d.answered_at ? ` at ${d.answered_at}` : ""}` }],
  });
}

export function toConsent(c: ConsentRow): Resource {
  const status = c.withdrawn_at ? "inactive" : c.consented_at ? "active" : c.declined_at ? "rejected" : "proposed";
  return clean({
    resourceType: "Consent",
    id: c.id,
    status,
    scope: { coding: [{ system: SYSTEM.consentScope, code: "patient-privacy" }] },
    category: [{ coding: [{ system: SYSTEM.loinc, code: "59284-0", display: "Patient Consent" }] }],
    patient: ref("Patient", c.patient_id),
    dateTime: c.consented_at ?? c.declined_at ?? c.requested_at,
    organization: [ref("Organization", c.clinic_id)],
    policy: [{ uri: `urn:carecall:consent:${c.wording_version}` }],
    provision: {
      type: status === "rejected" ? "deny" : "permit",
      period: c.consented_at ? { start: c.consented_at, end: c.withdrawn_at ?? undefined } : undefined,
      purpose: [{ system: SYSTEM.actCode, code: "TREAT", display: "treatment" }],
      action: c.scopes.map((s) => ({ text: s.replace(/_/g, " ") })),
    },
    sourceAttachment: { title: `Answered in ${c.channel ?? "chat"}; wording ${c.wording_version}` },
  });
}

/** A searchset Bundle (what Patient/$everything returns). */
export function bundle(resources: Resource[], baseUrl: string): Resource {
  return {
    resourceType: "Bundle",
    type: "searchset",
    timestamp: new Date().toISOString(),
    total: resources.length,
    entry: resources.map((r) => ({
      fullUrl: `${baseUrl}/${r.resourceType}/${r.id}`,
      resource: r,
      search: { mode: r.resourceType === "Patient" ? "match" : "include" },
    })),
  };
}

export function operationOutcome(code: string, text: string): Resource {
  return { resourceType: "OperationOutcome", issue: [{ severity: "error", code, diagnostics: text }] };
}

// --- Clinical notes (M6): Encounter + Composition ---------------------------

export type NoteRow = {
  id: string; clinic_id: string; patient_id: string; kind: string; amends_note_id?: string | null;
  encounter_date: string; mode: string; subjective?: string | null; objective?: string | null;
  assessment?: string | null; plan?: string | null; addendum?: string | null;
  status: string; signed_provider_id?: string | null; signed_at?: string | null;
};

const escapeXhtml = (s: string) =>
  s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
const narrative = (s: string) => ({
  status: "generated",
  div: `<div xmlns="http://www.w3.org/1999/xhtml">${s.split("\n").map((l) => `<p>${escapeXhtml(l)}</p>`).join("")}</div>`,
});

/** The visit a signed note documents (ambulatory). Shares the note's id. */
export function toEncounter(n: NoteRow): Resource {
  return clean({
    resourceType: "Encounter",
    id: n.id,
    status: "finished",
    class: { system: SYSTEM.actCode, code: "AMB", display: "ambulatory" },
    subject: ref("Patient", n.patient_id),
    participant: n.signed_provider_id ? [{ individual: ref("Practitioner", n.signed_provider_id) }] : undefined,
    period: { start: n.encounter_date, end: n.encounter_date },
    serviceProvider: ref("Organization", n.clinic_id),
  });
}

const SOAP: [keyof NoteRow, string, string][] = [
  ["subjective", "Subjective", "61150-9"],
  ["objective", "Objective", "61149-1"],
  ["assessment", "Assessment", "51848-0"],
  ["plan", "Plan", "18776-5"],
];

/** A signed note (or addendum) as a Composition. Drafts are not exported. */
export function toComposition(n: NoteRow): Resource | null {
  if (n.status !== "signed" || !n.signed_at) return null;
  const addendum = n.kind === "addendum";
  const sections = addendum
    ? [{ title: "Addendum", text: narrative(n.addendum ?? "") }]
    : SOAP.filter(([k]) => String(n[k] ?? "").trim()).map(([k, title, code]) => ({
      title, code: { coding: [{ system: SYSTEM.loinc, code, display: title }] }, text: narrative(String(n[k])),
    }));
  return clean({
    resourceType: "Composition",
    id: n.id,
    status: "final",
    type: { coding: [{ system: SYSTEM.loinc, code: "11506-3", display: "Progress note" }], text: addendum ? "Addendum" : "Clinical note" },
    subject: ref("Patient", n.patient_id),
    encounter: addendum ? undefined : ref("Encounter", n.id),
    date: n.signed_at,
    author: [n.signed_provider_id ? ref("Practitioner", n.signed_provider_id) : ref("Organization", n.clinic_id)],
    title: addendum ? "Addendum to clinical note" : "Clinical note",
    attester: n.signed_provider_id ? [{ mode: "legal", time: n.signed_at, party: ref("Practitioner", n.signed_provider_id) }] : undefined,
    custodian: ref("Organization", n.clinic_id),
    relatesTo: addendum && n.amends_note_id ? [{ code: "appends", targetReference: ref("Composition", n.amends_note_id) }] : undefined,
    section: sections,
  });
}

// --- Vital signs (M3): Observation + CarePlan --------------------------------

export type ReadingRow = {
  id: string; clinic_id: string; patient_id: string; vital_plan_id?: string | null; measure: string;
  value1: number | string; value2?: number | string | null; pulse?: number | string | null; taken_at: string;
  source: string; flag: string;
};
export type MonitoringPlanRow = {
  id: string; clinic_id: string; patient_id: string; version: number; status: string;
  signed_provider_id?: string | null; signed_at?: string | null; stopped_at?: string | null; updated_at?: string | null;
};
export type VitalPlanRow = {
  id: string; plan_id: string; measure: string; reason?: string | null; how_to?: string | null;
  times_of_day: string[]; days_of_week?: number[] | null; start_date: string; until_date?: string | null;
  if_high?: string | null; if_low?: string | null;
  target_low?: number | null; target_high?: number | null; target_low2?: number | null; target_high2?: number | null;
  critical_low?: number | null; critical_high?: number | null; critical_low2?: number | null; critical_high2?: number | null;
};

/** LOINC code, UCUM unit and profile per measure (BP: panel + systolic/diastolic components). */
export const VITAL_CODES: Record<string, { code: string; display: string; unit: string; ucum: string; profile?: string;
  extra?: { code: string; display: string }; category: "vital-signs" | "laboratory" }> = {
  bp: { code: "85354-9", display: "Blood pressure panel with all children optional", unit: "mmHg", ucum: "mm[Hg]",
    profile: VITALS_PROFILE.bp, category: "vital-signs" },
  glucose: { code: "41653-7", display: "Glucose [Mass/volume] in Capillary blood by Glucometer", unit: "mg/dL", ucum: "mg/dL",
    category: "laboratory" },
  temperature: { code: "8310-5", display: "Body temperature", unit: "Cel", ucum: "Cel", profile: VITALS_PROFILE.bodytemp,
    category: "vital-signs" },
  weight: { code: "29463-7", display: "Body weight", unit: "kg", ucum: "kg", profile: VITALS_PROFILE.bodyweight,
    category: "vital-signs" },
  spo2: { code: "59408-5", display: "Oxygen saturation in Arterial blood by Pulse oximetry", unit: "%", ucum: "%",
    profile: VITALS_PROFILE.oxygensat, extra: { code: "2708-6", display: "Oxygen saturation in Arterial blood" },
    category: "vital-signs" },
};
const SYSTOLIC = { code: "8480-6", display: "Systolic blood pressure" };
const DIASTOLIC = { code: "8462-4", display: "Diastolic blood pressure" };
const HEART_RATE = { code: "8867-4", display: "Heart rate" };

const quantity = (value: number | string, unit: string, ucum: string) =>
  ({ value: Number(value), unit, system: SYSTEM.ucum, code: ucum });
const loinc = (c: { code: string; display: string }) => ({ system: SYSTEM.loinc, code: c.code, display: c.display });
const INTERPRETATION: Record<string, { code: string; display: string }> = {
  ok: { code: "N", display: "Normal" },
  out_of_range: { code: "A", display: "Abnormal" },
  critical: { code: "AA", display: "Critical abnormal" },
};

/**
 * A reading as Observation(s): the measure, plus a heart-rate Observation when
 * a pulse came with a blood pressure. "Normal / abnormal" here means against
 * the doctor's limits in the patient's plan, not a population range.
 */
export function toObservations(r: ReadingRow, planIdOf?: (vitalPlanId: string) => string | undefined): Resource[] {
  const c = VITAL_CODES[r.measure];
  if (!c) return [];
  const planId = r.vital_plan_id && planIdOf ? planIdOf(r.vital_plan_id) : undefined;
  const common = {
    status: "final",
    category: [{ coding: [{ system: SYSTEM.observationCategory, code: c.category,
      display: c.category === "vital-signs" ? "Vital Signs" : "Laboratory" }] }],
    subject: ref("Patient", r.patient_id),
    effectiveDateTime: r.taken_at,
    performer: [r.source === "chat" ? ref("Patient", r.patient_id) : ref("Organization", r.clinic_id)],
    basedOn: planId ? [ref("CarePlan", planId)] : undefined,
    note: r.source === "chat" ? [{ text: "Measured at home and sent by the patient in chat" }] : undefined,
  };
  const interpretation = r.vital_plan_id
    ? [{ coding: [{ system: SYSTEM.interpretation, ...INTERPRETATION[r.flag] ?? INTERPRETATION.ok }],
      text: "Compared with the limits in the doctor's monitoring plan" }]
    : undefined;
  const coding = [loinc(c), ...(c.extra ? [loinc(c.extra)] : [])];
  const main: Resource = r.measure === "bp"
    ? {
      resourceType: "Observation", id: r.id, meta: { profile: [c.profile] }, ...common,
      code: { coding, text: "Blood pressure" }, interpretation,
      component: [
        { code: { coding: [loinc(SYSTOLIC)] }, valueQuantity: quantity(r.value1, c.unit, c.ucum) },
        { code: { coding: [loinc(DIASTOLIC)] }, valueQuantity: quantity(r.value2 ?? 0, c.unit, c.ucum) },
      ],
    }
    : {
      resourceType: "Observation", id: r.id, meta: c.profile ? { profile: [c.profile] } : undefined, ...common,
      code: { coding, text: c.display }, valueQuantity: quantity(r.value1, c.unit, c.ucum), interpretation,
    };
  const out = [clean(main)];
  if (r.pulse != null && r.pulse !== "") {
    out.push(clean({
      resourceType: "Observation", id: `${r.id}-pulse`, meta: { profile: [VITALS_PROFILE.heartrate] }, ...common,
      code: { coding: [loinc(HEART_RATE)], text: "Pulse" }, valueQuantity: quantity(r.pulse, "/min", "/min"),
      derivedFrom: [ref("Observation", r.id)],
    }));
  }
  return out;
}

const PLAN_STATUS: Record<string, string> = { signed: "active", replaced: "revoked", stopped: "completed" };
const DAY_CODES = ["sun", "mon", "tue", "wed", "thu", "fri", "sat"];

function limitsDescription(v: VitalPlanRow, unit: string): string {
  const bp = v.measure === "bp";
  const pair = (a?: number | null, b?: number | null) => (bp ? `${a ?? "-"}/${b ?? "-"}` : `${a}`);
  const parts: string[] = [];
  if (v.target_low != null || (bp && v.target_low2 != null)) parts.push(`target low ${pair(v.target_low, v.target_low2)} ${unit}`);
  if (v.target_high != null || (bp && v.target_high2 != null)) parts.push(`target high ${pair(v.target_high, v.target_high2)} ${unit}`);
  if (v.critical_low != null || (bp && v.critical_low2 != null)) parts.push(`critical at or below ${pair(v.critical_low, v.critical_low2)} ${unit}`);
  if (v.critical_high != null || (bp && v.critical_high2 != null)) parts.push(`critical at or above ${pair(v.critical_high, v.critical_high2)} ${unit}`);
  return parts.join("; ");
}

/** A signed monitoring plan as a CarePlan; one activity per measure. Drafts are not exported. */
export function toCarePlan(m: MonitoringPlanRow, items: VitalPlanRow[]): Resource | null {
  const status = PLAN_STATUS[m.status];
  if (!status || !m.signed_at) return null;
  return clean({
    resourceType: "CarePlan",
    id: m.id,
    status,
    intent: "plan",
    title: `Home vital signs monitoring, version ${m.version}`,
    category: [{ text: "Home vital signs monitoring" }],
    subject: ref("Patient", m.patient_id),
    period: { start: m.signed_at, end: m.status === "stopped" ? m.stopped_at ?? undefined : undefined },
    created: m.signed_at,
    author: m.signed_provider_id ? ref("Practitioner", m.signed_provider_id) : ref("Organization", m.clinic_id),
    activity: items.map((v) => {
      const c = VITAL_CODES[v.measure];
      const lines = [v.reason, v.how_to && `How: ${v.how_to}`, c && limitsDescription(v, c.unit),
        v.if_high && `If high: ${v.if_high}`, v.if_low && `If low: ${v.if_low}`].filter(Boolean);
      return {
        detail: {
          kind: "ServiceRequest",
          code: c ? { coding: [loinc(c)], text: c.display } : { text: v.measure },
          status: status === "active" ? "in-progress" : "stopped",
          scheduledTiming: { repeat: {
            boundsPeriod: { start: v.start_date, end: v.until_date ?? undefined },
            dayOfWeek: v.days_of_week?.length ? v.days_of_week.map((d) => DAY_CODES[d]) : undefined,
            timeOfDay: v.times_of_day.map(fhirTime),
          } },
          performer: [ref("Patient", m.patient_id)],
          description: lines.join("\n"),
        },
      };
    }),
  });
}
