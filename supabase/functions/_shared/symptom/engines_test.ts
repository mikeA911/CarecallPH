// Tests for the demo engine and the Infermedica adapter (fake Infermedica).
// Run: deno test supabase/functions/_shared/symptom/
import { DemoEngine } from "./demo.ts";
import {
  _resetInfermedicaCaches, diagnosticBody, InfermedicaEngine, toQuestion, triageToUrgency,
} from "./infermedica.ts";
import type { Answer, Assessment, Question } from "./types.ts";

function eq(actual: unknown, expected: unknown, msg = "") {
  const a = JSON.stringify(actual), e = JSON.stringify(expected);
  if (a !== e) throw new Error(`${msg}\n  expected ${e}\n  got      ${a}`);
}
const person = { birthYear: 1990, sex: "female" as const };
const pick = (id: string): Answer => ({ symptomId: id, present: true, source: "search" });
const ans = (id: string, present: Answer["present"]): Answer => ({ symptomId: id, present, source: "question" });
function question(r: { question: Question } | { assessment: Assessment }): Question {
  if (!("question" in r)) throw new Error("expected a question, got " + JSON.stringify(r));
  return r.question;
}
function assessment(r: { question: Question } | { assessment: Assessment }): Assessment {
  if (!("assessment" in r)) throw new Error("expected an assessment, got " + JSON.stringify(r));
  return r.assessment;
}

// ---------------------------------------------------------------- demo
Deno.test("demo: related question, then an assessment; mild cold → self care", async () => {
  const e = new DemoEngine();
  eq((await e.searchSymptoms("fev")).map((s) => s.id), ["d_fever"]);
  eq(await e.nameOf("d_fever"), "Fever");
  const q1 = question(await e.next(person, [pick("d_cough")]));
  eq(q1.kind, "multi");
  const r = assessment(await e.next(person, [pick("d_cough"), ...q1.choices.map((c) => ans(c.id, c.id === "d_runny_nose"))]));
  eq(r.urgency, "self_care");
  eq(e.calls, 0);
});

Deno.test("demo: yellow eyes → urgent", async () => {
  const e = new DemoEngine();
  const r = assessment(await e.next(person, [pick("d_yellow"), ans("d_fever", false)]));
  eq(r.urgency, "urgent");
});

// ---------------------------------------------------------- infermedica
type Req = { path: string; method: string; headers: Headers; body: unknown };

function fakeInfermedica(diagnosis: unknown[], triage = "consultation", specialist = "Otolaryngologist") {
  const reqs: Req[] = [];
  let d = 0;
  const fetchFn = (input: string | URL | Request, init?: RequestInit) => {
    const url = new URL(String(input));
    const path = url.pathname.replace("/v3", "") + url.search;
    reqs.push({ path, method: init?.method ?? "GET", headers: new Headers(init?.headers), body: init?.body ? JSON.parse(String(init.body)) : null });
    const body = (() => {
      if (path.startsWith("/symptoms")) return [
        { id: "s_21", name: "Headache", common_name: "Headache" },
        { id: "s_98", name: "Fever", common_name: "Fever" },
        { id: "s_102", name: "Cough", common_name: "Cough" },
      ];
      if (path === "/diagnosis") return diagnosis[Math.min(d++, diagnosis.length - 1)];
      if (path === "/triage") return { triage_level: triage, serious: [] };
      if (path === "/recommend_specialist") return { recommended_specialist: { id: "sp_1", name: specialist } };
      return null;
    })();
    return Promise.resolve(new Response(JSON.stringify(body), { status: body === null ? 404 : 200 }));
  };
  return { reqs, fetchFn: fetchFn as typeof fetch };
}

const singleQ = { type: "single", text: "Do you have a sore throat?", items: [{ id: "s_20", name: "Sore throat", choices: [] }] };

Deno.test("infermedica: headers, cached symptom list, local search", async () => {
  _resetInfermedicaCaches();
  const f = fakeInfermedica([]);
  const e = new InfermedicaEngine("app", "key", "check-123", "infermedica-en", f.fetchFn);
  eq((await e.searchSymptoms("fe")).map((s) => s.id), ["s_98"]);
  await e.searchSymptoms("cou");
  eq(f.reqs.length, 1, "list fetched once");
  eq(f.reqs[0].path, "/symptoms?age.value=30");
  const h = f.reqs[0].headers;
  eq([h.get("App-Id"), h.get("App-Key"), h.get("Interview-Id"), h.get("Model")], ["app", "key", "check-123", "infermedica-en"]);
});

Deno.test("infermedica: asks while should_stop is false, then triage + specialist", async () => {
  _resetInfermedicaCaches();
  const f = fakeInfermedica([
    { question: singleQ, should_stop: false, conditions: [] },
    { question: null, should_stop: true, conditions: [{ id: "c_1", name: "Common cold", common_name: "Cold", probability: 0.6 }] },
  ], "consultation_24");
  const e = new InfermedicaEngine("app", "key", "check-1", undefined, f.fetchFn);

  const q = question(await e.next(person, [pick("s_98")]));
  eq([q.kind, q.text, q.choices[0].id], ["single", "Do you have a sore throat?", "s_20"]);

  const r = assessment(await e.next(person, [pick("s_98"), ans("s_20", "unknown")]));
  eq(r.urgency, "urgent");
  eq(r.specialties, ["Otolaryngologist"]);
  eq(r.conditions, [{ name: "Cold", probability: 0.6 }]);
  const diag = f.reqs.filter((x) => x.path === "/diagnosis").at(-1)!;
  eq(diag.body, {
    sex: "female", age: { value: new Date().getUTCFullYear() - 1990 },
    evidence: [{ id: "s_98", choice_id: "present", source: "initial" }, { id: "s_20", choice_id: "unknown" }],
  });
  eq(e.calls, 4);
});

Deno.test("infermedica: emergency evidence stops the interview", async () => {
  _resetInfermedicaCaches();
  const f = fakeInfermedica([{ question: singleQ, should_stop: false, has_emergency_evidence: true }], "emergency_ambulance");
  const e = new InfermedicaEngine("app", "key", undefined, undefined, f.fetchFn);
  eq(assessment(await e.next(person, [pick("s_98")])).urgency, "emergency");
});

Deno.test("infermedica: question and triage mapping", () => {
  eq(toQuestion({ type: "group_single", text: "How long?", items: [{ id: "a", name: "Days" }, { id: "b", name: "Weeks" }] })?.kind, "one_of");
  eq(toQuestion({ type: "group_multiple", text: "Any of these?", items: [{ id: "a", name: "A" }] })?.kind, "multi");
  eq(["emergency_ambulance", "emergency", "consultation_24", "consultation", "self_care", undefined].map((l) => triageToUrgency(l, false)),
    ["emergency", "emergency", "urgent", "routine", "self_care", "routine"]);
  eq(diagnosticBody(person, [pick("x"), pick("x")]).evidence.length, 1, "duplicates dropped");
  eq(diagnosticBody(person, [pick("s_98")], ["p_region"]).evidence.at(-1),
    { id: "p_region", choice_id: "present", source: "predefined" }, "region evidence");
});
