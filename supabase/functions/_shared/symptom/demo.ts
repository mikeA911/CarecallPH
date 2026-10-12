// Demo engine: a small built-in rule set so the symptom check can be tried end
// to end without a vendor (SYMPTOM_ENGINE=demo).
//
// ILLUSTRATIVE ONLY. These rules are not clinically validated and must never
// be used for real patients; the page shows a DEMO banner whenever this engine
// is on. Philippine patterns (dengue, leptospirosis, TB…) come from the PH
// layer (ph_layer.ts), which wraps every engine, this one included. No API calls.
import type { Answer, Assessment, Person, Question, Symptom, SymptomEngine, Urgency } from "./types.ts";

const SYMPTOMS: Symptom[] = [
  { id: "d_fever", name: "Fever" },
  { id: "d_headache", name: "Headache" },
  { id: "d_eye_pain", name: "Pain behind the eyes" },
  { id: "d_muscle_pain", name: "Muscle or body pain" },
  { id: "d_calf_pain", name: "Calf pain" },
  { id: "d_joint_pain", name: "Joint pain" },
  { id: "d_rash", name: "Skin rash" },
  { id: "d_cough", name: "Cough" },
  { id: "d_sore_throat", name: "Sore throat" },
  { id: "d_runny_nose", name: "Runny or blocked nose" },
  { id: "d_ear_pain", name: "Ear pain" },
  { id: "d_diarrhea", name: "Diarrhea" },
  { id: "d_vomiting", name: "Vomiting" },
  { id: "d_belly_pain", name: "Stomach or belly pain" },
  { id: "d_bleeding_gums", name: "Bleeding gums or nosebleed" },
  { id: "d_yellow", name: "Yellow eyes or skin" },
  { id: "d_pee_pain", name: "Pain or burning when peeing" },
  { id: "d_tired", name: "Tiredness" },
  { id: "d_dizzy", name: "Dizziness" },
  { id: "d_back_pain", name: "Back pain" },
  { id: "d_itchy_eyes", name: "Red or itchy eyes" },
  { id: "d_night_sweats", name: "Night sweats" },
  { id: "d_weight_loss", name: "Losing weight without trying" },
];
const NAME = new Map(SYMPTOMS.map((s) => [s.id, s.name]));
const MILD = ["d_runny_nose", "d_sore_throat", "d_cough", "d_itchy_eyes"];

/** Follow-up "do you also have…" lists, by the first matching symptom. */
const RELATED: [string, string[]][] = [
  ["d_fever", ["d_headache", "d_eye_pain", "d_muscle_pain", "d_rash", "d_bleeding_gums", "d_belly_pain", "d_vomiting"]],
  ["d_cough", ["d_fever", "d_sore_throat", "d_runny_nose", "d_night_sweats", "d_weight_loss"]],
  ["d_diarrhea", ["d_vomiting", "d_belly_pain", "d_fever"]],
  ["d_belly_pain", ["d_vomiting", "d_diarrhea", "d_fever", "d_yellow"]],
  ["d_headache", ["d_fever", "d_dizzy", "d_eye_pain", "d_vomiting"]],
  ["d_sore_throat", ["d_fever", "d_cough", "d_runny_nose", "d_ear_pain"]],
];


export class DemoEngine implements SymptomEngine {
  readonly name = "demo" as const;
  readonly demo = true;
  readonly calls = 0;

  nameOf(id: string): Promise<string | null> { return Promise.resolve(NAME.get(id) ?? null); }

  searchSymptoms(text: string): Promise<Symptom[]> {
    const q = text.trim().toLowerCase();
    if (q.length < 2) return Promise.resolve([]);
    const starts = SYMPTOMS.filter((s) => s.name.toLowerCase().startsWith(q));
    const contains = SYMPTOMS.filter((s) => !s.name.toLowerCase().startsWith(q) && s.name.toLowerCase().includes(q));
    return Promise.resolve([...starts, ...contains].slice(0, 15));
  }

  next(_person: Person, answers: Answer[]): Promise<{ question: Question } | { assessment: Assessment }> {
    const has = (id: string) => answers.some((a) => a.symptomId === id && a.present === true);
    const answered = (id: string) => answers.some((a) => a.symptomId === id);

    // 1. "Do you also have any of these?"
    if (!answers.some((a) => a.source === "question")) {
      const related = RELATED.find(([id]) => has(id))?.[1].filter((id) => !answered(id)) ?? [];
      if (related.length) {
        return Promise.resolve({ question: {
          id: "related", kind: "multi", text: "Do you also have any of these?",
          choices: related.map((id) => ({ id, name: NAME.get(id)! })),
        } });
      }
    }
    return Promise.resolve({ assessment: assess(has) });
  }
}

function assess(has: (id: string) => boolean): Assessment {
  const flags: string[] = [];
  let urgency: Urgency = "routine";
  let specialties = ["General practice"];

  if (has("d_yellow")) {
    urgency = "urgent";
    flags.push("Yellow eyes or skin need a doctor's check soon.");
    specialties = ["Internal medicine", "Gastroenterology"];
  }
  if (has("d_night_sweats") || has("d_weight_loss")) specialties = ["General practice", "Internal medicine"];
  if (has("d_pee_pain") && urgency === "routine") specialties = ["General practice", "Urology"];
  if (has("d_ear_pain") && urgency === "routine") specialties = ["General practice", "Otolaryngology"];
  if (has("d_rash") && !has("d_fever") && urgency === "routine") specialties = ["Dermatology"];

  const others = SYMPTOMS.map((s) => s.id).filter((id) => !MILD.includes(id));
  if (urgency === "routine" && MILD.some(has) && !others.some(has)) {
    urgency = "self_care";
    flags.push("Rest, fluids and paracetamol for discomfort. See a doctor if it lasts more than a week or you get a fever.");
  }
  return { urgency, specialties, conditions: [], redFlags: flags };
}
