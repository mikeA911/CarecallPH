// CC bug reports: checks and which callers get the tools.
// Run: deno test supabase/functions/_shared/cc/bug_report_test.ts
import { checkBugReport, type Ctx, runTool, toolsFor } from "./tools.ts";

function eq(actual: unknown, expected: unknown, msg = "") {
  const a = JSON.stringify(actual), e = JSON.stringify(expected);
  if (a !== e) throw new Error(`${msg}\n  expected ${e}\n  got      ${a}`);
}
const good = { summary: " Book button does nothing ", what_happened: "Tapped Book on the patient page; nothing happened", severity: "problem" };

Deno.test("a report is tidied; empty optional fields become null", () => {
  eq(checkBugReport({ ...good, steps: "  " }), { ok: true, value: {
    summary: "Book button does nothing", what_happened: "Tapped Book on the patient page; nothing happened",
    expected: null, steps: null, severity: "problem" } });
});

Deno.test("missing fields and a wrong severity are refused", () => {
  eq(checkBugReport({ ...good, summary: "" }).ok, false);
  eq(checkBugReport({ ...good, what_happened: " " }).ok, false);
  eq(checkBugReport({ ...good, severity: "urgent" }).ok, false);
});

Deno.test("phone numbers (patient details) are refused, ordinary numbers are fine", () => {
  for (const p of ["0917 123 4567", "09171234567", "+63 917 123 4567", "+639171234567", "+1 415 555 0100"]) {
    eq(checkBugReport({ ...good, steps: `1. Open the patient with ${p}` }).ok, false, p);
  }
  eq(checkBugReport({ ...good, steps: "1. Book Oct 20 at 9:30\n2. 3 of 12 slots missing" }).ok, true);
});

Deno.test("only the chat gets bug report tools", () => {
  const names = (s: Ctx["source"]) => toolsFor(s).map((t) => t.name);
  eq([names("chat").includes("report_bug"), names("chat").includes("my_bug_reports")], [true, true]);
  eq([names("nightly").includes("report_bug"), names("nightly").includes("my_bug_reports")], [false, false]);
});

Deno.test("report_bug saves the screen and clinic and returns the number", async () => {
  let saved: Record<string, unknown> | null = null;
  const db = { from: () => ({ insert: (row: Record<string, unknown>) => { saved = row;
    return { select: () => ({ single: async () => ({ data: { id: 42 }, error: null }) }) }; } }) };
  const ctx = { db, userId: "u1", role: "staff", clinicId: "c1", clinical: false, source: "chat", route: "/patients/abc",
    actions: [], itemsCreated: 0 } as unknown as Ctx;
  const r = await runTool(ctx, "report_bug", good) as { number: number };
  eq(r.number, 42);
  eq([saved!.route, saved!.clinic_id, saved!.severity], ["/patients/abc", "c1", "problem"]);
  const odd = await runTool({ ...ctx, route: "javascript:alert(1)" } as Ctx, "report_bug", good);
  eq([(odd as { number: number }).number, saved!.route], [42, null], "an odd route is dropped");
});

Deno.test("diagnostics: numbers, emails and ids are scrubbed, shapes kept, lists capped", async () => {
  const { sanitizeDiagnostics } = await import("./tools.ts");
  const d = sanitizeDiagnostics({
    errors: [{ at: "2026-10-16T01:02:03.000Z", message: "Duplicate (phone)=(+639171234567) for maria@x.ph" }],
    requests: Array.from({ length: 20 }, (_, i) => ({ at: "x", method: "patch", path: `/rest/v1/patients?id=eq.0000000${i}-0000-0000-0000-000000000001`, status: 409, code: "23505" })),
    viewport: "1280x800", user_agent: "Chrome",
  })!;
  eq(d.errors[0].message, "Duplicate (phone)=([number]) for [email]");
  eq([d.requests.length, d.requests[0].path, d.requests[0].method, d.requests[0].at], [15, "/rest/v1/patients", "PATCH", ""]);
  eq(sanitizeDiagnostics("nope"), null);
  eq(sanitizeDiagnostics({ viewport: "<script>" })!.viewport, "");
});

Deno.test("report_bug stores diagnostics and tells the portal to offer a screenshot", async () => {
  let saved: Record<string, unknown> | null = null;
  const db = { from: () => ({ insert: (row: Record<string, unknown>) => { saved = row;
    return { select: () => ({ single: async () => ({ data: { id: 9 }, error: null }) }) }; } }) };
  const diagnostics = { errors: [], requests: [], viewport: "1x1", user_agent: "" };
  const ctx = { db, userId: "u1", role: "staff", clinicId: "c1", clinical: false, source: "chat", route: "/",
    diagnostics, actions: [], itemsCreated: 0 } as unknown as Ctx;
  await runTool(ctx, "report_bug", good);
  eq([saved!.diagnostics, ctx.actions], [diagnostics, [{ type: "bug_filed", report: 9 }]]);
});
