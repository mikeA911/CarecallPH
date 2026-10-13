// Clinical roles: defaults and who may manage care.
// Run: deno test supabase/functions/_shared/roles_test.ts
import { canManageCare, clinicalRoleOf, isClinicalRole } from "./roles.ts";

function assertEquals(actual: unknown, expected: unknown) {
  if (actual !== expected) throw new Error(`expected ${expected}, got ${actual}`);
}

Deno.test("clinical role defaults by access level when unset", () => {
  assertEquals(clinicalRoleOf("staff", undefined), "front_desk");
  assertEquals(clinicalRoleOf("clinic_admin", null), "nurse");
  assertEquals(clinicalRoleOf("admin", undefined), "nurse");
  assertEquals(clinicalRoleOf("", undefined), null);
});

Deno.test("a stored clinical role wins over the default", () => {
  assertEquals(clinicalRoleOf("staff", "nurse"), "nurse");
  assertEquals(clinicalRoleOf("clinic_admin", "front_desk"), "front_desk");
  assertEquals(clinicalRoleOf("staff", "doctor"), "doctor");
  assertEquals(clinicalRoleOf("staff", "surgeon"), "front_desk"); // unknown value ignored
});

Deno.test("only nurses and doctors manage care", () => {
  assertEquals(canManageCare("doctor"), true);
  assertEquals(canManageCare("nurse"), true);
  assertEquals(canManageCare("front_desk"), false);
  assertEquals(canManageCare(null), false);
  assertEquals(isClinicalRole("front_desk"), true);
  assertEquals(isClinicalRole("admin"), false);
});
