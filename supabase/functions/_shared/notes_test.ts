// Clinical notes (M6): prompts, schema checks, audio limits.
// Run: deno test supabase/functions/_shared/notes_test.ts
import {
  ageOn, audioTypeOk, base64Bytes, consentProblem, DRAFT_SYSTEM, draftUserMessage, NOTE_SCHEMA, parseDraft,
  transcribePrompt,
} from "./notes.ts";

function eq(actual: unknown, expected: unknown, msg = "") {
  const a = JSON.stringify(actual), e = JSON.stringify(expected);
  if (a !== e) throw new Error(`${msg}\n  expected ${e}\n  got      ${a}`);
}

Deno.test("recording needs consent; dictation and typing don't", () => {
  eq(consentProblem("recording", false) !== null, true);
  eq(consentProblem("recording", true), null);
  eq(consentProblem("dictation", false), null);
  eq(consentProblem("typed", false), null);
});

Deno.test("audio type and size", () => {
  eq(audioTypeOk("audio/webm;codecs=opus"), true);
  eq(audioTypeOk("audio/mp4"), true);
  eq(audioTypeOk("video/mp4"), false);
  eq(base64Bytes(btoa("hello")), 5);
  eq(base64Bytes(btoa("hell")), 4);
});

Deno.test("transcription prompt keeps the language and labels speakers in recordings", () => {
  eq(transcribePrompt("recording").includes("\"Doctor:\""), true);
  eq(transcribePrompt("dictation").includes("Doctor:"), false);
  eq(transcribePrompt("dictation").includes("Do not translate"), true);
});

Deno.test("draft message wraps the transcript as data", () => {
  const m = draftUserMessage("BP 150/95", { mode: "dictation", patientAge: 58, sex: "male" });
  eq(m.includes("<transcript>\nBP 150/95\n</transcript>"), true);
  eq(m.includes("58 years old, male"), true);
  eq(DRAFT_SYSTEM.includes("Never add a finding"), true);
});

Deno.test("schema: every object closed, every property required", () => {
  eq(NOTE_SCHEMA.additionalProperties, false);
  eq([...NOTE_SCHEMA.required].sort(), Object.keys(NOTE_SCHEMA.properties).sort());
  const med = NOTE_SCHEMA.properties.medicines_mentioned.items;
  eq(med.additionalProperties, false);
  eq([...med.required].sort(), Object.keys(med.properties).sort());
});

Deno.test("parseDraft validates and tidies", () => {
  const good = JSON.stringify({ subjective: " Dizzy ", objective: "BP 150/95", assessment: "HTN", plan: "Amlodipine 10 mg",
    unclear: ["", "duration?"], medicines_mentioned: [{ name: "Amlodipine", dose: "10 mg", how_often: "once a day", duration: "30 days" }, { name: " ", dose: "", how_often: "", duration: "" }] });
  const d = parseDraft(good)!;
  eq(d.subjective, "Dizzy");
  eq(d.unclear, ["duration?"]);
  eq(d.medicines_mentioned.length, 1);
  eq(parseDraft("not json"), null);
  eq(parseDraft(JSON.stringify({ subjective: "x" })), null);
});

Deno.test("age", () => {
  eq(ageOn("1968-10-14", "2026-10-13"), 57);
  eq(ageOn("1968-10-13", "2026-10-13"), 58);
  eq(ageOn(null, "2026-10-13"), null);
});
