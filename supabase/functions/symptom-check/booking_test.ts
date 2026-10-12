// Pure helpers of the symptom check booking (D1c).
// Run: deno test --allow-env supabase/functions/symptom-check/booking_test.ts
// (lib.ts creates a Supabase client at import; dummy env values are enough.)
Deno.env.set("SUPABASE_URL", Deno.env.get("SUPABASE_URL") ?? "http://localhost:54321");
Deno.env.set("SUPABASE_SERVICE_ROLE_KEY", Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "test");
const { specialtyMatches, validDob } = await import("./booking.ts");

function eq(actual: unknown, expected: unknown, msg = "") {
  const a = JSON.stringify(actual), e = JSON.stringify(expected);
  if (a !== e) throw new Error(`${msg}\n  expected ${e}\n  got      ${a}`);
}

Deno.test("specialty matching by shared word stems", () => {
  eq(specialtyMatches("Pediatrics", "Pediatrician"), true);
  eq(specialtyMatches("ENT / Otolaryngology", "Otolaryngologist"), true);
  eq(specialtyMatches("Internal Medicine", "Internal medicine"), true);
  eq(specialtyMatches("Family medicine", "General practice"), false);
  eq(specialtyMatches(null, "Pediatrics"), false);
  eq(specialtyMatches("Dermatology", null), false);
});

Deno.test("date of birth must be a real past date", () => {
  eq(validDob("1985-03-14"), true);
  eq(validDob("1985-02-30"), false);
  eq(validDob("14/03/1985"), false);
  eq(validDob(`${new Date().getUTCFullYear() + 1}-01-01`), false);
  eq(validDob("1890-01-01"), false);
});
