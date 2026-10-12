// Care plans M1: due doses, messages, replies.
// Run: deno test supabase/functions/_shared/care_test.ts
import {
  consentText, doseText, dueDoses, isWithdraw, localToUtc, type Med, parseConsentReply, parseDoseReply,
} from "./care.ts";

function eq(actual: unknown, expected: unknown, msg = "") {
  const a = JSON.stringify(actual), e = JSON.stringify(expected);
  if (a !== e) throw new Error(`${msg}\n  expected ${e}\n  got      ${a}`);
}
const TZ = "Asia/Manila";
const med = (o: Partial<Med> = {}): Med => ({
  id: "m1", patient_id: "p1", name: "Amlodipine", dose: "5 mg, 1 tablet", instructions: null,
  times_of_day: ["08:00:00", "20:00:00"], start_date: "2026-10-01", end_date: null, discreet: false, ...o,
});

Deno.test("local time to UTC", () => {
  eq(localToUtc("2026-10-15", "08:00", TZ).toISOString(), "2026-10-15T00:00:00.000Z");
  eq(localToUtc("2026-10-15", "08:00", "America/New_York").toISOString(), "2026-10-15T12:00:00.000Z", "EDT");
  eq(localToUtc("2026-12-15", "08:00", "America/New_York").toISOString(), "2026-12-15T13:00:00.000Z", "EST");
});

Deno.test("due in the 30 minutes after the time, once", () => {
  const at = (iso: string) => new Date(iso);
  eq(dueDoses(at("2026-10-15T00:10:00Z"), [med()], TZ, new Set()).map((d) => d.dueAt.toISOString()),
    ["2026-10-15T00:00:00.000Z"], "8:10 AM Manila");
  eq(dueDoses(at("2026-10-14T23:55:00Z"), [med()], TZ, new Set()).length, 0, "7:55, not yet");
  eq(dueDoses(at("2026-10-15T00:31:00Z"), [med()], TZ, new Set()).length, 0, "8:31, too late");
  eq(dueDoses(at("2026-10-15T00:10:00Z"), [med()], TZ, new Set(["m1|2026-10-15T00:00:00.000Z"])).length, 0, "already sent");
});

Deno.test("start and end dates in clinic time", () => {
  const now = new Date("2026-10-15T00:10:00Z");
  eq(dueDoses(now, [med({ start_date: "2026-10-16" })], TZ, new Set()).length, 0, "not started");
  eq(dueDoses(now, [med({ end_date: "2026-10-14" })], TZ, new Set()).length, 0, "ended");
  eq(dueDoses(now, [med({ end_date: "2026-10-15" })], TZ, new Set()).length, 1, "last day");
});

Deno.test("messages: grouped, discreet", () => {
  const due = new Date("2026-10-15T00:00:00Z");
  const one = doseText([med()], due, TZ);
  eq(one.includes("8:00 AM") && one.includes("Amlodipine, 5 mg, 1 tablet") && one.includes("Reply 1 when taken"), true, one);
  const two = doseText([med(), med({ id: "m2", name: "Metformin", dose: "500 mg", instructions: "after breakfast" })], due, TZ);
  eq(two.includes("Metformin, 500 mg (after breakfast)") && two.includes("taken them"), true, two);
  const quiet = doseText([med({ discreet: true })], due, TZ);
  eq(quiet.includes("Amlodipine"), false, "discreet hides the name");
  eq(consentText("Santos Clinic").includes("STOP REMINDERS") && consentText("X").includes("911"), true);
});

Deno.test("replies", () => {
  eq(["1", "taken", "oo", "Nainom na"].map(parseDoseReply), Array(4).fill("taken"));
  eq(["2", "skip", "hindi"].map(parseDoseReply), Array(3).fill("skipped"));
  eq(["yes", "OO", "payag"].map(parseConsentReply), Array(3).fill("yes"));
  eq(["no", "Hindi", "ayaw"].map(parseConsentReply), Array(3).fill("no"));
  eq([isWithdraw("stop reminders"), isWithdraw("Tigil paalala"), isWithdraw("STOP")], [true, true, false]);
});
