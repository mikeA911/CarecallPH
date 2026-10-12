// Symptom check types shared by the engines and the symptom-check function.

export type Sex = "male" | "female";
export type Urgency = "emergency" | "urgent" | "routine" | "self_care";

export interface Person { birthYear: number; sex: Sex }
export interface Symptom { id: string; name: string }
export interface Question {
  id: string;
  text: string;
  /**
   * "multi": tick any that apply; unticked choices count as absent.
   * "single": yes / no / don't know about the one choice.
   * "one_of": pick exactly one choice; only that one is sent, as present.
   */
  kind: "multi" | "single" | "one_of";
  choices: Symptom[];
}
export interface Answer {
  symptomId: string;
  present: boolean | "unknown";
  /** "search": picked by the patient; "question": answered a follow-up. */
  source: "search" | "question";
}

export interface Assessment {
  urgency: Urgency;
  specialties: string[];
  /** Kept server-side for audit and tuning; not shown to patients in D1. */
  conditions: { name: string; probability: number }[];
  /** Engine warnings, shown to the patient as "see a doctor today if…". */
  redFlags: string[];
}

export interface SymptomEngine {
  readonly name: EngineName;
  /** True for the built-in demo engine: results are illustrative only. */
  readonly demo: boolean;
  /** Upstream calls made by this instance (for the monthly budget). */
  readonly calls: number;
  searchSymptoms(text: string, person: Person | null): Promise<Symptom[]>;
  /** Display name of a symptom ID, or null if unknown (used by the PH layer). */
  nameOf(id: string): Promise<string | null>;
  /** Next question, or the assessment when the engine has enough. */
  next(person: Person, answers: Answer[]): Promise<{ question: Question } | { assessment: Assessment }>;
}

export type EngineName = "demo" | "apimedic" | "infermedica";

export class EngineError extends Error {}

export function ageBand(birthYear: number, now = new Date()): "0-17" | "18-39" | "40-64" | "65+" {
  const age = now.getUTCFullYear() - birthYear;
  if (age < 18) return "0-17";
  if (age < 40) return "18-39";
  if (age < 65) return "40-64";
  return "65+";
}
