// Changing an appointment time by chat, and reply buttons.
// Run: deno test supabase/functions/_shared/reschedule_test.ts
import { offerMessage, parsePick, pickSlots, type Slot, slotLabel } from "./reschedule.ts";
import { BUTTONS, replyFromCallback, telegramKeyboard } from "./buttons.ts";
import { parseReminderReply } from "./reminders.ts";
import { parseConsentReply, parseDoseReply } from "./care.ts";

function eq(actual: unknown, expected: unknown, msg = "") {
  const a = JSON.stringify(actual), e = JSON.stringify(expected);
  if (a !== e) throw new Error(`${msg}\n  expected ${e}\n  got      ${a}`);
}
const TZ = "Asia/Manila";
// Manila is UTC+8: 01:00Z = 9:00 AM.
const s = (iso: string): Slot => ({ start: iso, end: new Date(Date.parse(iso) + 30 * 60_000).toISOString() });

Deno.test("offer: two a day, an hour apart, first days first", () => {
  const slots = [
    s("2026-10-20T01:00:00.000Z"), s("2026-10-20T01:30:00.000Z"), s("2026-10-20T02:00:00.000Z"), s("2026-10-20T06:00:00.000Z"),
    s("2026-10-21T01:00:00.000Z"), s("2026-10-22T03:00:00.000Z"), s("2026-10-22T05:00:00.000Z"), s("2026-10-23T01:00:00.000Z"),
  ];
  eq(pickSlots(slots, TZ).map((x) => x.start), [
    "2026-10-20T01:00:00.000Z", "2026-10-20T02:00:00.000Z", "2026-10-21T01:00:00.000Z",
    "2026-10-22T03:00:00.000Z", "2026-10-22T05:00:00.000Z", "2026-10-23T01:00:00.000Z",
  ]);
  eq(pickSlots([], TZ), []);
});

Deno.test("days follow the clinic's time zone", () => {
  // 17:00Z on the 20th is 1 AM on the 21st in Manila: a different day.
  eq(pickSlots([s("2026-10-20T15:00:00.000Z"), s("2026-10-20T17:00:00.000Z"), s("2026-10-20T19:00:00.000Z")], TZ, 6, 1).length, 2);
  eq(slotLabel(s("2026-10-20T01:00:00.000Z"), TZ), "Tue, Oct 20, 9:00 AM");
});

Deno.test("offer message: letters for every app, a button per time", () => {
  const m = offerMessage([s("2026-10-20T01:00:00.000Z"), s("2026-10-21T06:30:00.000Z")], TZ, "Santos Clinic", "tomorrow at 9:00 AM");
  eq(m.text.includes("A: Tue, Oct 20, 9:00 AM\nB: Wed, Oct 21, 2:30 PM"), true);
  eq(m.text.includes("stays booked until you pick"), true);
  eq(m.buttons.map((r) => r.map((b) => b.reply)), [["A"], ["B"], ["OTHER", "KEEP"]]);
});

Deno.test("reading a pick", () => {
  eq(parsePick("a", 3), { kind: "slot", index: 0 });
  eq(parsePick(" C. ", 3), { kind: "slot", index: 2 });
  eq(parsePick("D", 3), null, "only offered letters");
  eq(parsePick("other", 3), { kind: "other" });
  eq(parsePick("Keep", 3), { kind: "keep" });
  eq(parsePick("hello", 3), null);
  eq(parsePick("1", 3), null, "numbers stay reminder replies");
});

Deno.test("buttons send the replies the parsers already understand", () => {
  eq(BUTTONS.reminder24[0].map((b) => parseReminderReply(b.reply)), ["confirm", "reschedule", "cancel"]);
  eq(BUTTONS.dose[0].map((b) => parseDoseReply(b.reply)), ["taken", "skipped"]);
  eq(BUTTONS.consent[0].map((b) => parseConsentReply(b.reply)), ["yes", "no"]);
  const kb = telegramKeyboard(BUTTONS.reminder24);
  eq(kb.inline_keyboard[0][0], { text: "✅ Confirm", callback_data: "r:1" });
  eq(replyFromCallback("r:YES"), "YES");
  eq(replyFromCallback("x:1"), null);
  eq(replyFromCallback(undefined), null);
});
