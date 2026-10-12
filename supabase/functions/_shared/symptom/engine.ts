// Symptom check engine interface (docs/symptom-check-design.md §3).
//
// The check talks to one SymptomEngine; which one is picked by the
// SYMPTOM_ENGINE secret (empty = feature off). ApiMedic is the build-and-test
// engine; Infermedica is the go-live candidate (slice D1d). The engine does the
// clinical assessment; CareCall's own emergency screen runs before it.
import { ApiMedicEngine } from "./apimedic.ts";
import type { SymptomEngine } from "./types.ts";

export * from "./types.ts";

/** A fresh engine per request, so `calls` counts that request only. */
export function createEngine(): SymptomEngine | null {
  switch ((Deno.env.get("SYMPTOM_ENGINE") ?? "").trim().toLowerCase()) {
    case "apimedic": return ApiMedicEngine.fromEnv();
    default: return null;
  }
}

export function engineName(): string | null {
  const n = (Deno.env.get("SYMPTOM_ENGINE") ?? "").trim().toLowerCase();
  return n === "apimedic" ? n : null;
}
