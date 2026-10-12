// Philippine layer around the symptom engine (design §8a, roadmap D1e).
//
// Wraps whichever engine is active (demo, Infermedica, …) and adds what a
// European engine may miss for Filipino patients:
//   1. Questions the engine doesn't ask: days of fever, flood water exposure,
//      a cough of 2+ weeks. Asked once, before the engine's own questions.
//   2. Extra searchable items: an animal bite or scratch (rabies).
//   3. Rules that can only RAISE urgency, never lower it, each with a warning
//      shown to the patient and a kind of doctor or facility.
// Fired rule IDs are returned so each check records them (measuring accuracy).
//
// DRAFT RULES, version PH_RULES_VERSION. Written from public DOH guidance
// (dengue warning signs, leptospirosis after floods, TB, rabies post-exposure
// care); a doctor must review and sign off every rule and its wording before
// patients use them. Rules match symptoms by name (any engine's wording), so
// they work without knowing each engine's IDs.
import type {
  Answer, Assessment, Person, Question, Symptom, SymptomEngine, Urgency,
} from "./types.ts";

export const PH_RULES_VERSION = "draft-2026-10-12";

// --- Layer items (IDs start with "ph_", never sent to the engine) ----------
const FEVER_DAYS: Symptom[] = [
  { id: "ph_fever_lt2", name: "Less than 2 days" },
  { id: "ph_fever_2to7", name: "2 to 7 days" },
  { id: "ph_fever_gt7", name: "More than 7 days" },
];
const FLOOD = "ph_flood";
const COUGH_2W = "ph_cough_2w";
const BITE: Symptom = { id: "ph_animal_bite", name: "Animal bite or scratch (dog, cat)" };
const SEARCHABLE: Symptom[] = [BITE];

// --- Concepts: matched against symptom names, lowercase substrings ---------
const CONCEPTS = {
  fever: ["fever", "high temperature"],
  belly_pain: ["abdominal pain", "stomach pain", "belly pain", "stomach or belly pain", "abdominal tenderness"],
  vomiting: ["vomit"],
  bleeding: ["bleeding gums", "gum bleeding", "nosebleed", "nose bleed", "blood in", "bloody", "bruis", "petechiae"],
  drowsy: ["drowsi", "letharg", "unusually sleepy", "restless", "confus"],
  cough: ["cough"],
  diarrhea: ["diarrh", "loose stool", "watery stool"],
  yellow: ["yellow eyes", "yellow skin", "jaundice"],
  calf_pain: ["calf pain", "muscle pain in the legs"],
} satisfies Record<string, string[]>;
type Concept = keyof typeof CONCEPTS;

export type Facts = {
  has: (c: Concept) => boolean;
  feverDays: "lt2" | "2to7" | "gt7" | null;
  flood: boolean;
  cough2w: boolean;
  bite: boolean;
  age: number;
};

type Rule = {
  id: string;
  when: (f: Facts) => boolean;
  urgency: Exclude<Urgency, "emergency">;
  flag: string;
  specialties?: string[];
};

/** Ordered: the first matching rule's specialties win. */
export const PH_RULES: Rule[] = [
  {
    id: "animal_bite",
    when: (f) => f.bite,
    urgency: "urgent",
    flag: "Wash the wound with soap and running water for 15 minutes, then go today to an Animal Bite " +
      "Treatment Center or health center for rabies shots. Rabies can be prevented, but not cured once it starts.",
    specialties: ["Animal Bite Treatment Center"],
  },
  {
    id: "dengue_warning",
    when: (f) => f.has("fever") && (f.has("belly_pain") || f.has("vomiting") || f.has("bleeding") || f.has("drowsy")),
    urgency: "urgent",
    flag: "Fever with belly pain, repeated vomiting, bleeding (gums, nose, or in vomit or stool) or unusual " +
      "sleepiness can be dengue warning signs. See a doctor today. Drink plenty of fluids, and take " +
      "paracetamol, not ibuprofen or aspirin.",
    specialties: ["General practice", "Internal medicine"],
  },
  {
    id: "leptospirosis",
    when: (f) => f.has("fever") && f.flood,
    urgency: "urgent",
    flag: "Fever after wading in flood water or mud can be leptospirosis, which needs early treatment. " +
      "See a doctor today and tell them about the flood water.",
    specialties: ["General practice", "Internal medicine"],
  },
  {
    id: "child_dehydration",
    when: (f) => f.age < 5 && f.has("diarrhea") && f.has("vomiting"),
    urgency: "urgent",
    flag: "Young children with diarrhea and vomiting can lose water quickly. Give oral rehydration " +
      "solution (ORS / oresol) in small sips and see a doctor today.",
    specialties: ["Pediatrics"],
  },
  {
    id: "long_fever",
    when: (f) => f.feverDays === "gt7",
    urgency: "urgent",
    flag: "A fever lasting more than a week needs a doctor's check, for example for typhoid.",
    specialties: ["General practice", "Internal medicine"],
  },
  {
    id: "jaundice",
    when: (f) => f.has("yellow"),
    urgency: "urgent",
    flag: "Yellow eyes or skin need a doctor's check soon.",
    specialties: ["Internal medicine"],
  },
  {
    id: "dengue_watch",
    when: (f) => f.feverDays === "2to7",
    urgency: "routine",
    flag: "A fever of 2 days or more should be seen by a doctor, who may check your blood for dengue. " +
      "Go sooner if belly pain, vomiting, bleeding or unusual sleepiness starts.",
  },
  {
    id: "tb_cough",
    when: (f) => f.cough2w,
    urgency: "routine",
    flag: "A cough of 2 weeks or more should be checked for TB. Testing and treatment are free at health centers.",
    specialties: ["General practice", "Pulmonology"],
  },
];

/** Short labels for staff (appointment intake), by rule ID. */
export const PH_RULE_LABELS: Record<string, string> = {
  animal_bite: "Animal bite or scratch (rabies risk)",
  dengue_warning: "Possible dengue warning signs",
  leptospirosis: "Fever after flood water (leptospirosis risk)",
  child_dehydration: "Young child with diarrhea and vomiting (dehydration risk)",
  long_fever: "Fever over a week",
  jaundice: "Yellow eyes or skin",
  dengue_watch: "Fever 2–7 days (dengue check)",
  tb_cough: "Cough 2+ weeks (TB check)",
};

const RANK: Record<Urgency, number> = { self_care: 0, routine: 1, urgent: 2, emergency: 3 };

/** Apply the PH rules to an engine assessment. Exported for tests. */
export function applyRules(base: Assessment, f: Facts): Assessment & { phRules: string[] } {
  const fired = PH_RULES.filter((r) => r.when(f));
  let urgency = base.urgency;
  for (const r of fired) if (RANK[r.urgency] > RANK[urgency]) urgency = r.urgency;
  const specialties = fired.find((r) => r.specialties)?.specialties ?? base.specialties;
  // A self-care tip doesn't fit once a rule has raised the urgency.
  const baseFlags = urgency !== base.urgency && base.urgency === "self_care" ? [] : base.redFlags;
  return {
    ...base,
    urgency,
    specialties,
    redFlags: [...fired.map((r) => r.flag), ...baseFlags],
    phRules: fired.map((r) => r.id),
  };
}

export class PhLayer implements SymptomEngine {
  constructor(private inner: SymptomEngine) {}
  get name() { return this.inner.name; }
  get demo() { return this.inner.demo; }
  get calls() { return this.inner.calls; }

  async nameOf(id: string): Promise<string | null> {
    if (id === BITE.id) return BITE.name;
    return id.startsWith("ph_") ? null : await this.inner.nameOf(id);
  }

  async searchSymptoms(text: string, person: Person | null): Promise<Symptom[]> {
    const q = text.trim().toLowerCase();
    const extra = q.length >= 2 ? SEARCHABLE.filter((s) => s.name.toLowerCase().includes(q)) : [];
    return [...extra, ...(await this.inner.searchSymptoms(text, person))].slice(0, 15);
  }

  async next(person: Person, answers: Answer[]): Promise<{ question: Question } | { assessment: Assessment & { phRules?: string[] } }> {
    const own = answers.filter((a) => a.symptomId.startsWith("ph_"));
    const engineAnswers = answers.filter((a) => !a.symptomId.startsWith("ph_"));
    const facts = await this.facts(person, engineAnswers, own);
    const answered = (id: string) => own.some((a) => a.symptomId === id);

    // 1. Our questions first, so the engine's calls aren't repeated afterwards.
    if (facts.has("fever") && !FEVER_DAYS.some((o) => answered(o.id))) {
      return { question: { id: "ph_fever_days", kind: "one_of", text: "How many days have you had the fever?", choices: FEVER_DAYS } };
    }
    if (facts.has("fever") && !answered(FLOOD)) {
      return { question: {
        id: FLOOD, kind: "single", text: "In the last 2 weeks, have you waded through flood water or mud?",
        choices: [{ id: FLOOD, name: "Waded through flood water or mud" }],
      } };
    }
    if (facts.has("cough") && !answered(COUGH_2W)) {
      return { question: {
        id: COUGH_2W, kind: "single", text: "Have you been coughing for 2 weeks or more?",
        choices: [{ id: COUGH_2W, name: "Coughing for 2 weeks or more" }],
      } };
    }

    // 2. The engine (skipped when only layer items were picked, e.g. a dog bite).
    let base: Assessment = { urgency: "routine", specialties: ["General practice"], conditions: [], redFlags: [] };
    if (engineAnswers.some((a) => a.present === true)) {
      const step = await this.inner.next(person, engineAnswers);
      if ("question" in step) return step;
      base = step.assessment;
    }
    if (base.urgency === "emergency") return { assessment: { ...base, phRules: [] } };

    // 3. Our rules on top.
    return { assessment: applyRules(base, facts) };
  }

  private async facts(person: Person, engineAnswers: Answer[], own: Answer[]): Promise<Facts> {
    const names: string[] = [];
    for (const a of engineAnswers) {
      if (a.present !== true) continue;
      const n = await this.inner.nameOf(a.symptomId);
      if (n) names.push(n.toLowerCase());
    }
    const yes = (id: string) => own.some((a) => a.symptomId === id && a.present === true);
    return {
      has: (c) => CONCEPTS[c].some((term) => names.some((n) => n.includes(term))),
      feverDays: yes("ph_fever_gt7") ? "gt7" : yes("ph_fever_2to7") ? "2to7" : yes("ph_fever_lt2") ? "lt2" : null,
      flood: yes(FLOOD),
      cough2w: yes(COUGH_2W),
      bite: yes(BITE.id),
      age: Math.max(0, new Date().getUTCFullYear() - person.birthYear),
    };
  }
}
