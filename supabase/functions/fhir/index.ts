// CareCall PH — FHIR R4 export (slice F1). Design: docs/fhir-design.md
//
// Read only. CareCall rows are mapped to FHIR R4 with the Philippine profiles
// (PH Core) by _shared/fhir/map.ts.
//
//   GET /functions/v1/fhir/metadata                   CapabilityStatement
//   GET /functions/v1/fhir/Patient/{id}               Patient
//   GET /functions/v1/fhir/Patient/{id}/$everything   Bundle: the patient's record
//   GET /functions/v1/fhir/Practitioner/{id}
//   GET /functions/v1/fhir/Organization/{id}
//   POST { resource, id, everything? }                the same, for the portal
//
// Access: signed-in portal users of the clinic (platform admins: any clinic).
// Patient and $everything need a nurse or doctor (they include medicines and
// consents). Every export is written to the audit log.
//
// Deploy: supabase functions deploy fhir   (JWT verification on)
import { audit, getCaller, supabase } from "../_shared/lib.ts";
import { canManageCare } from "../_shared/roles.ts";
import {
  bundle, type ConsentRow, type DoseRow, type MedicationRow, operationOutcome, type Resource, toAppointment,
  toConsent, toMedicationAdministration, toMedicationRequest, toOrganization, toPatient, toPractitioner,
} from "../_shared/fhir/map.ts";
import { PH_CORE, PH_CORE_VERSION, PROFILE } from "../_shared/fhir/systems.ts";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
};
const fhir = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body, null, 2), { status, headers: { "Content-Type": "application/fhir+json", ...CORS } });
const fail = (status: number, code: string, text: string) => fhir(operationOutcome(code, text), status);

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });

  // What is asked for: from the path (GET) or the body (POST).
  let resource = "", id = "", everything = false;
  const parts = new URL(req.url).pathname.split("/").filter(Boolean);
  const at = parts.indexOf("fhir");
  const rest = at >= 0 ? parts.slice(at + 1) : parts;
  if (req.method === "GET") {
    [resource = "", id = ""] = rest;
    everything = rest[2] === "$everything";
  } else if (req.method === "POST") {
    const body = await req.json().catch(() => ({}));
    resource = String(body.resource ?? ""); id = String(body.id ?? ""); everything = body.everything === true;
  } else {
    return fail(405, "not-supported", "Only GET and POST are supported.");
  }

  if (resource === "metadata") return fhir(capabilityStatement(req));

  const caller = await getCaller(req);
  if (!caller || !caller.role) return fail(401, "login", "Sign in to the CareCall portal.");
  if (!UUID.test(id)) return fail(400, "invalid", "Give a resource id.");
  const base = `${new URL(req.url).origin}/functions/v1/fhir`;
  const inClinic = (clinicId: string) => caller.role === "admin" || clinicId === caller.clinicId;

  if (resource === "Practitioner") {
    const { data } = await supabase.from("providers").select("id, clinic_id, name, specialty, prc_number, active").eq("id", id).maybeSingle();
    if (!data || !inClinic(data.clinic_id)) return fail(404, "not-found", "Practitioner not found.");
    return fhir(toPractitioner(data));
  }
  if (resource === "Organization") {
    if (!inClinic(id)) return fail(404, "not-found", "Organization not found.");
    const { data } = await supabase.from("clinics").select("*").eq("id", id).maybeSingle();
    if (!data) return fail(404, "not-found", "Organization not found.");
    return fhir(toOrganization(data));
  }
  if (resource !== "Patient") return fail(400, "not-supported", `${resource || "This resource"} is not available yet.`);

  const { data: p } = await supabase.from("patients").select("*").eq("id", id).maybeSingle();
  if (!p || !inClinic(p.clinic_id)) return fail(404, "not-found", "Patient not found.");
  if (!canManageCare(caller.clinicalRole)) {
    return fail(403, "forbidden", "Only a nurse or doctor can export a patient's record.");
  }

  if (!everything) {
    await audit({ clinicId: p.clinic_id, actorUserId: caller.userId, action: "fhir_export",
      targetType: "patient", targetId: p.id, detail: { resources: ["Patient"] } });
    return fhir(toPatient(p));
  }

  const [clinic, appts, meds, doses, consents] = await Promise.all([
    supabase.from("clinics").select("*").eq("id", p.clinic_id).single(),
    supabase.from("appointments").select("id, patient_id, provider_id, starts_at, ends_at, status, created_at, source")
      .eq("patient_id", p.id).order("starts_at"),
    supabase.from("medications").select("*").eq("patient_id", p.id).order("created_at"),
    supabase.from("medication_doses").select("id, medication_id, patient_id, due_at, status, answered_at")
      .eq("patient_id", p.id).in("status", ["taken", "skipped"]).order("due_at"),
    supabase.from("care_consents").select("*").eq("patient_id", p.id).order("requested_at"),
  ]);
  const apptRows = (appts.data ?? []) as Parameters<typeof toAppointment>[0][];
  const medRows = (meds.data ?? []) as MedicationRow[];
  const providerIds = [...new Set([p.provider_id, ...apptRows.map((a) => a.provider_id)].filter(Boolean))] as string[];
  const { data: providers } = providerIds.length
    ? await supabase.from("providers").select("id, clinic_id, name, specialty, prc_number, active").in("id", providerIds)
    : { data: [] };
  const medName = new Map(medRows.map((m) => [m.id, m.name]));

  const resources: Resource[] = [
    toPatient(p),
    ...(clinic.data ? [toOrganization(clinic.data)] : []),
    ...(providers ?? []).map(toPractitioner),
    ...apptRows.map(toAppointment),
    ...medRows.map((m) => toMedicationRequest(m, p.clinic_id)),
    ...((doses.data ?? []) as DoseRow[])
      .map((d) => toMedicationAdministration(d, medName.get(d.medication_id) ?? "medicine"))
      .filter((r): r is Resource => r !== null),
    ...((consents.data ?? []) as ConsentRow[]).map(toConsent),
  ];

  const counts: Record<string, number> = {};
  for (const r of resources) counts[r.resourceType] = (counts[r.resourceType] ?? 0) + 1;
  await audit({ clinicId: p.clinic_id, actorUserId: caller.userId, action: "fhir_export",
    targetType: "patient", targetId: p.id, detail: { everything: true, resources: counts } });
  return fhir(bundle(resources, base));
});

function capabilityStatement(req: Request): Resource {
  const read = (type: string, profile?: string, ops: string[] = []) => ({
    type, profile, interaction: [{ code: "read" }],
    operation: ops.length ? ops.map((name) => ({ name, definition: "http://hl7.org/fhir/OperationDefinition/Patient-everything" })) : undefined,
  });
  return {
    resourceType: "CapabilityStatement",
    status: "draft",
    date: "2026-10-13",
    kind: "instance",
    software: { name: "CareCall PH" },
    implementation: { description: "CareCall PH FHIR export (read only)", url: `${new URL(req.url).origin}/functions/v1/fhir` },
    fhirVersion: "4.0.1",
    format: ["json"],
    instantiates: [`${PH_CORE}/ImplementationGuide/fhir.ph.core|${PH_CORE_VERSION}`],
    rest: [{
      mode: "server",
      security: { description: "Supabase sign-in (bearer token). Patient data: nurse or doctor of the patient's clinic." },
      resource: [
        read("Patient", PROFILE.patient, ["everything"]),
        read("Practitioner", PROFILE.practitioner),
        read("Organization", PROFILE.organization),
      ],
    }],
  };
}
