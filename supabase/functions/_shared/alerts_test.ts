// Care plans M4: missed-dose and no-reading alert rules.
// Run: deno test supabase/functions/_shared/alerts_test.ts
import { missedDosesItem, missedStreak, noReadings, reconcile } from "./alerts.ts";

function assertEquals(actual: unknown, expected: unknown, msg = "") {
  const a = JSON.stringify(actual), e = JSON.stringify(expected);
  if (a !== e) throw new Error(`${msg}\n  expected ${e}\n  got      ${a}`);
}

Deno.test("missedStreak counts missed doses from the newest", () => {
  assertEquals(missedStreak(["missed", "missed", "missed", "taken"]), 3);
  assertEquals(missedStreak(["taken", "missed", "missed", "missed"]), 0);
  assertEquals(missedStreak(["missed", "skipped", "missed"]), 1, "a skipped answer breaks the streak");
  assertEquals(missedStreak([]), 0);
});

Deno.test("noReadings: whole window, enough requests, nothing back", () => {
  const now = new Date("2026-10-20T12:00:00Z");
  const base = { runningSince: "2026-10-10T00:00:00Z", lastReadingAt: "2026-10-16T00:00:00Z", requestsInWindow: 6 };
  assertEquals(noReadings(now, base), true);
  assertEquals(noReadings(now, { ...base, lastReadingAt: "2026-10-18T00:00:00Z" }), false, "recent reading");
  assertEquals(noReadings(now, { ...base, lastReadingAt: null }), true, "never sent one");
  assertEquals(noReadings(now, { ...base, runningSince: "2026-10-19T00:00:00Z" }), false, "plan too new");
  assertEquals(noReadings(now, { ...base, requestsInWindow: 1 }), false, "barely asked (e.g. weekly weight)");
});

Deno.test("reconcile raises once per streak and clears when it ends", () => {
  const a = { patient_id: "p1", kind: "missed_doses" as const, subject_id: "m1" };
  const b = { patient_id: "p2", kind: "no_readings" as const, subject_id: "mp1" };
  assertEquals(reconcile([a, b], []), { raise: [a, b], clear: [] });
  assertEquals(reconcile([a, b], [{ ...a, id: "x1" }]), { raise: [b], clear: [] }, "already open: not again");
  assertEquals(reconcile([b], [{ ...a, id: "x1" }, { ...b, id: "x2" }]), { raise: [], clear: ["x1"] });
});

Deno.test("alert items never scold and say no message was sent", () => {
  const i = missedDosesItem("Ana Cruz", "Amlodipine", 3);
  assertEquals(i.title, "Missed 3 medicine reminders in a row: Ana Cruz");
  assertEquals(i.detail.includes("No message was sent to the patient"), true);
});
