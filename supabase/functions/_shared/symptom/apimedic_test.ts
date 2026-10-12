// Tests for the ApiMedic adapter and HMAC-MD5 against a fake ApiMedic.
// Run: deno test supabase/functions/_shared/symptom/
import { _resetApiMedicCaches, ApiMedicEngine, toAssessment } from "./apimedic.ts";
import { base64, hmacMd5, md5 } from "./md5.ts";
import { ageBand } from "./types.ts";

function eq(actual: unknown, expected: unknown, msg = "") {
  const a = JSON.stringify(actual), e = JSON.stringify(expected);
  if (a !== e) throw new Error(`${msg}\n  expected ${e}\n  got      ${a}`);
}

const enc = (s: string) => new TextEncoder().encode(s);
const hex = (b: Uint8Array) => [...b].map((x) => x.toString(16).padStart(2, "0")).join("");

Deno.test("md5 and hmac-md5 match RFC / Python values", () => {
  eq(hex(md5(enc(""))), "d41d8cd98f00b204e9800998ecf8427e");
  eq(hex(md5(enc("The quick brown fox jumps over the lazy dog"))), "9e107d9d372bb6826bd81d3542a419d6");
  // RFC 2104 test case 2
  eq(hex(hmacMd5(enc("Jefe"), enc("what do ya want for nothing?"))), "750c783e6ab0b503eaa86e310a5db738");
  // Key longer than one block (checked against Python's hmac module)
  eq(base64(hmacMd5(enc("s3cr3t-".repeat(20)), enc("https://sandbox-authservice.priaid.ch/login"))),
    "qmuaQ3z9huL9SAcoOhUMPg==");
});

type Call = { url: string; auth?: string | null };

function fakeApiMedic(opts: { proposed?: { ID: number; Name: string }[]; redflag?: Record<string, string> } = {}) {
  const calls: Call[] = [];
  const fetchFn = (input: string | URL | Request, init?: RequestInit) => {
    const url = String(input);
    calls.push({ url, auth: new Headers(init?.headers).get("Authorization") });
    const body = (() => {
      if (url.endsWith("/login")) return { Token: "tok", ValidThrough: 7200 };
      const u = new URL(url);
      switch (u.pathname) {
        case "/symptoms": return [{ ID: 10, Name: "Abdominal pain" }, { ID: 11, Name: "Fever" }, { ID: 9, Name: "Headache" }];
        case "/symptoms/proposed": return opts.proposed ?? [{ ID: 11, Name: "Fever" }, { ID: 14, Name: "Cough" }];
        case "/diagnosis": return [
          { Issue: { ID: 1, Name: "Common cold", Accuracy: 60 }, Specialisation: [{ ID: 15, Name: "General practice" }] },
          { Issue: { ID: 2, Name: "Sinusitis", Accuracy: 30 }, Specialisation: [{ ID: 22, Name: "Otolaryngology" }, { ID: 15, Name: "General practice" }] },
        ];
        case "/redflag": return opts.redflag?.[u.searchParams.get("symptomId") ?? ""] ?? "";
      }
      return null;
    })();
    return Promise.resolve(new Response(JSON.stringify(body), { status: body === null ? 404 : 200 }));
  };
  return { calls, fetchFn: fetchFn as typeof fetch };
}

const person = { birthYear: 1990, sex: "female" as const };

Deno.test("login signs the auth URL and the token is reused", async () => {
  _resetApiMedicCaches();
  const f = fakeApiMedic();
  const e = new ApiMedicEngine("user", "pass", true, f.fetchFn);
  await e.searchSymptoms("fe");
  await e.searchSymptoms("he");
  const logins = f.calls.filter((c) => c.url.endsWith("/login"));
  eq(logins.length, 1, "one login");
  const sig = base64(hmacMd5(enc("pass"), enc("https://sandbox-authservice.priaid.ch/login")));
  eq(logins[0].auth, `Bearer user:${sig}`);
  eq(f.calls.filter((c) => c.url.includes("/symptoms?")).length, 1, "symptom list cached");
  eq(e.calls, 1, "one billable call");
});

Deno.test("search: prefix matches first, needs 2+ letters", async () => {
  _resetApiMedicCaches();
  const e = new ApiMedicEngine("u", "p", true, fakeApiMedic().fetchFn);
  eq(await e.searchSymptoms("a"), []);
  eq((await e.searchSymptoms("he")).map((s) => s.name), ["Headache"]);
  eq((await e.searchSymptoms("ache")).map((s) => s.name), ["Headache"]);
});

Deno.test("next: one follow-up question, then an assessment", async () => {
  _resetApiMedicCaches();
  const f = fakeApiMedic({ redflag: {} });
  const e = new ApiMedicEngine("u", "p", true, f.fetchFn);

  const step1 = await e.next(person, [{ symptomId: "9", present: true, source: "search" }]);
  if (!("question" in step1)) throw new Error("expected a question");
  eq(step1.question.choices.map((c) => c.id), ["11", "14"]);
  const proposedUrl = new URL(f.calls.find((c) => c.url.includes("/symptoms/proposed"))!.url);
  eq(proposedUrl.searchParams.get("symptoms"), "[9]");
  eq(proposedUrl.searchParams.get("gender"), "Female");
  eq(proposedUrl.searchParams.get("year_of_birth"), "1990");

  const step2 = await e.next(person, [
    { symptomId: "9", present: true, source: "search" },
    { symptomId: "11", present: true, source: "question" },
    { symptomId: "14", present: false, source: "question" },
  ]);
  if (!("assessment" in step2)) throw new Error("expected an assessment");
  eq(step2.assessment.urgency, "routine");
  eq(step2.assessment.specialties, ["General practice", "Otolaryngology"]);
  const diagUrl = new URL(f.calls.find((c) => c.url.includes("/diagnosis"))!.url);
  eq(diagUrl.searchParams.get("symptoms"), "[9,11]", "absent symptoms not sent");
});

Deno.test("next: no proposals goes straight to the assessment", async () => {
  _resetApiMedicCaches();
  const e = new ApiMedicEngine("u", "p", true, fakeApiMedic({ proposed: [] }).fetchFn);
  const step = await e.next(person, [{ symptomId: "9", present: true, source: "search" }]);
  eq("assessment" in step, true);
});

Deno.test("a red-flag warning makes it urgent and is passed on", async () => {
  _resetApiMedicCaches();
  const f = fakeApiMedic({ proposed: [], redflag: { "9": "Sudden severe headache: see a doctor today." } });
  const e = new ApiMedicEngine("u", "p", true, f.fetchFn);
  const step = await e.next(person, [{ symptomId: "9", present: true, source: "search" }]);
  if (!("assessment" in step)) throw new Error("expected an assessment");
  eq(step.assessment.urgency, "urgent");
  eq(step.assessment.redFlags, ["Sudden severe headache: see a doctor today."]);
});

Deno.test("no conditions found → routine, general practice", () => {
  eq(toAssessment([], []), { urgency: "routine", specialties: ["General practice"], conditions: [], redFlags: [] });
});

Deno.test("age bands", () => {
  const now = new Date("2026-10-12T00:00:00Z");
  eq([2015, 2008, 1990, 1970, 1950].map((y) => ageBand(y, now)), ["0-17", "18-39", "18-39", "40-64", "65+"]);
});
