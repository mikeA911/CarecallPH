// Symptom check engine interface (docs/symptom-check-design.md §3).
//
// The check talks to one SymptomEngine; which one is picked by the
// SYMPTOM_ENGINE secret (empty = feature off):
//   demo        — built-in rules for testing and demos; never for patients
//   infermedica — the go-live candidate (needs a trial or contract)
//   apimedic    — kept for reference; the service appears to be offline (Oct 2026) The engine does the
// clinical assessment; CareCall's own emergency screen runs before it.
import { ApiMedicEngine } from "./apimedic.ts";
import { DemoEngine } from "./demo.ts";
import { InfermedicaEngine } from "./infermedica.ts";
import type { EngineName, SymptomEngine } from "./types.ts";

export * from "./types.ts";

/**
 * A fresh engine per request, so `calls` counts that request only.
 * `interviewId` groups one patient's requests (Infermedica's Interview-Id).
 */
export function createEngine(interviewId?: string): SymptomEngine | null {
  switch (engineName()) {
    case "demo": return new DemoEngine();
    case "infermedica": return InfermedicaEngine.fromEnv(interviewId);
    case "apimedic": return ApiMedicEngine.fromEnv();
    default: return null;
  }
}

export function engineName(): EngineName | null {
  const n = (Deno.env.get("SYMPTOM_ENGINE") ?? "").trim().toLowerCase();
  return n === "demo" || n === "infermedica" || n === "apimedic" ? n : null;
}
