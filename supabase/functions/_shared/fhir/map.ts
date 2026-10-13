// CareCall rows → FHIR R4 resources with the Philippine profiles (PH Core).
// Pure functions: the `fhir` edge function loads rows and calls these.
// Mapping table and rules: docs/fhir-design.md
import { EXT, PROFILE, SYSTEM } from "./systems.ts";

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
