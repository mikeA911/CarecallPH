// Patient sign-up page form checks.
// Run: deno test supabase/functions/_shared/signup_test.ts
import { parseSignup, PRIVACY_NOTICE_VERSION, validDob } from "./signup.ts";

function eq(actual: unknown, expected: unknown, msg = "") {
  const a = JSON.stringify(actual), e = JSON.stringify(expected);
  if (a !== e) throw new Error(`${msg}\n  expected ${e}\n  got      ${a}`);
}
const now = new Date("2026-10-16T02:00:00Z");
const good = {
  first_name: "  Maria ", last_name: "Santos", phone: "0917 123 4567", date_of_birth: "1985-03-14",
  privacy_accepted: true, privacy_notice_version: PRIVACY_NOTICE_VERSION, chat: true,
};
const parse = (b: Record<string, unknown>) => parseSignup(b, { allowInternational: false, now });

Deno.test("a complete form is accepted and tidied", () => {
  eq(parse(good), { ok: true, value: {
    first_name: "Maria", last_name: "Santos", phone: "+639171234567", date_of_birth: "1985-03-14", chat: true, sms: false,
  } });
});

Deno.test("each missing or wrong field is named", () => {
  eq(parse({ ...good, last_name: " " }), { ok: false, error: "name_required" });
  eq((parse({ ...good, phone: "12345" }) as { error: string }).error, "bad_phone");
  eq(parse({ ...good, date_of_birth: "1985-02-30" }), { ok: false, error: "bad_dob" });
  eq(parse({ ...good, date_of_birth: "2027-01-01" }), { ok: false, error: "bad_dob" }, "future");
  eq(parse({ ...good, privacy_accepted: false }), { ok: false, error: "privacy_required" });
  eq(parse({ ...good, privacy_accepted: "true" }), { ok: false, error: "privacy_required" }, "must be a real true");
  eq(parse({ ...good, privacy_notice_version: "old" }), { ok: false, error: "old_notice" });
});

Deno.test("chat and texts are only on when ticked", () => {
  const v = (b: Record<string, unknown>) => (parse(b) as { value: { chat: boolean; sms: boolean } }).value;
  eq([v({ ...good, chat: false }).chat, v({ ...good, sms: true }).sms, v({ ...good, sms: "yes" }).sms], [false, true, false]);
});

Deno.test("birthdays: real dates, not in the future, under 120 years", () => {
  eq([validDob("2000-01-01", now), validDob("1900-01-01", now), validDob("01/02/2000", now)], [true, false, false]);
});
