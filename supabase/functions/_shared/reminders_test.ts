// Appointment reminder rules (Phase 2c).
// Run: deno test supabase/functions/_shared/reminders_test.ts
import { dueKind, inMessagingWindow, parseReminderReply, reminderText, whenText } from "./reminders.ts";

function eq(actual: unknown, expected: unknown, msg = "") {
  const a = JSON.stringify(actual), e = JSON.stringify(expected);
  if (a !== e) throw new Error(`${msg}\n  expected ${e}\n  got      ${a}`);
}
const H = 3600_000;
const now = new Date("2026-10-14T02:00:00Z"); // 10:00 AM Manila, Wednesday
const at = (hoursFromNow: number) => new Date(now.getTime() + hoursFromNow * H);

Deno.test("24h reminder: 24 to 4 hours before, booked 2+ hours ago", () => {
  eq(dueKind(now, at(23), at(-48), []), "24h");
  eq(dueKind(now, at(24.5), at(-48), []), null, "too early");
  eq(dueKind(now, at(3), at(-48), []), null, "too late for 24h, too early for 2h");
  eq(dueKind(now, at(20), at(-1), []), null, "just booked");
  eq(dueKind(now, at(20), at(-48), ["24h"]), null, "already sent");
});

Deno.test("2h reminder: 2 hours to 30 minutes before", () => {
  eq(dueKind(now, at(1.5), at(-48), ["24h"]), "2h");
  eq(dueKind(now, at(1.5), at(-48), []), "2h", "even without a 24h reminder");
  eq(dueKind(now, at(0.4), at(-48), []), null, "too close");
  eq(dueKind(now, at(1.5), at(-0.2), []), null, "booked minutes ago");
  eq(dueKind(now, at(1.5), at(-48), ["2h"]), null);
});

Deno.test("messaging window 07:00–21:00 clinic time", () => {
  eq(inMessagingWindow(new Date("2026-10-14T02:00:00Z"), "Asia/Manila"), true, "10:00");
  eq(inMessagingWindow(new Date("2026-10-13T22:30:00Z"), "Asia/Manila"), false, "06:30");
  eq(inMessagingWindow(new Date("2026-10-13T23:00:00Z"), "Asia/Manila"), true, "07:00");
  eq(inMessagingWindow(new Date("2026-10-14T13:00:00Z"), "Asia/Manila"), false, "21:00");
});

Deno.test("when: today / tomorrow / weekday in clinic time", () => {
  eq(whenText(at(3), now, "Asia/Manila").day, "today");
  eq(whenText(at(23), now, "Asia/Manila").day, "tomorrow, Thursday, October 15");
  eq(whenText(at(23), now, "Asia/Manila").time, "9:00 AM");
});

Deno.test("reminder text asks for 1/2/3, in English and Filipino", () => {
  const t = reminderText("24h", { clinic: "Santos Clinic", firstName: "Ana", doctor: "Dr. Reyes", startsAt: at(23), now, tz: "Asia/Manila", confirmed: false });
  eq(t.startsWith("Reminder from Santos Clinic: Ana, your appointment is tomorrow, Thursday, October 15 at 9:00 AM with Dr. Reyes."), true, t);
  eq(t.includes("Reply 1 to confirm, 2 to change the time, 3 to cancel."), true);
  eq(t.includes("kumpirmahin"), true);
  const t2 = reminderText("2h", { clinic: "Santos Clinic", startsAt: at(1.5), now, tz: "Asia/Manila", confirmed: true });
  eq(t2.includes("today at 11:30 AM"), true, t2);
  eq(t2.includes("1 to confirm"), false, "confirmed: no need to ask again");
});

Deno.test("replies", () => {
  eq(["1", " c ", "Confirm", "OO", "opo!", "ok"].map(parseReminderReply), Array(6).fill("confirm"));
  eq(["2", "R", "palit", "Change time"].map(parseReminderReply), Array(4).fill("reschedule"));
  eq(["3", "x", "CANCEL", "kansela"].map(parseReminderReply), Array(4).fill("cancel"));
  eq(["hello", "12", "BOOK", "STOP"].map(parseReminderReply), [null, null, null, null]);
});
