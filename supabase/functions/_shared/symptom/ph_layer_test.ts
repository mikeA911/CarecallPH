// Philippine layer tests: its questions, its rules, and a doctor-extendable
// table of PH cases run through the demo engine + layer.
// Run: deno test supabase/functions/_shared/symptom/
import { DemoEngine } from "./demo.ts";
import { applyRules, PhLayer } from "./ph_layer.ts";
import type { Answer, Assessment, Person, Question, Urgency } from "./types.ts";

function eq(actual: unknown, expected: unknown, msg = "") {
  const a = JSON.stringify(actual), e = JSON.stringify(expected);
  if (a !== e) throw new Error(`${msg}\n  expected ${e}\n  got      ${a}`);
}
const year = new Date().getUTCFullYear();
const adult: Person = { birthYear: year - 34, sex: "female" };
const toddler: Person = { birthYear: year - 2, sex: "male" };

/**
 * Run a whole check: pick `symptoms` by name, then answer every question —
 * yes to anything named in `yes`, the option named in `pick` for pick-one
 * questions, no to everything else.
 */
async function run(person: Person, symptoms: string[], yes: string[] = [], pick: string[] = []) {
  const layer = new PhLayer(new DemoEngine());
  const answers: Answer[] = [];
  for (const s of symptoms) {
    const hit = (await layer.searchSymptoms(s, person))[0];
    if (!hit) throw new Error(`no symptom for "${s}"`);
    answers.push({ symptomId: hit.id, present: true, source: "search" });
  }
  const asked: string[] = [];
  for (let i = 0; i < 10; i++) {
    const step = await layer.next(person, answers);
    if ("assessment" in step) return { ...(step.assessment as Assessment & { phRules?: string[] }), asked };
    const q: Question = step.question;
    asked.push(q.id);
    if (q.kind === "one_of") {
      const c = q.choices.find((c) => pick.includes(c.name)) ?? q.choices[0];
      answers.push({ symptomId: c.id, present: true, source: "question" });
    } else {
      for (const c of q.choices) answers.push({ symptomId: c.id, present: yes.includes(c.name), source: "question" });
    }
  }
  throw new Error("too many questions");
}

/** PH cases. A doctor should review, extend and sign these off with the rules. */
const CASES: { name: string; person: Person; symptoms: string[]; yes?: string[]; pick?: string[]; urgency: Urgency; rules: string[] }[] = [
  { name: "Dengue warning signs", person: adult, symptoms: ["Fever"], yes: ["Bleeding gums or nosebleed"], pick: ["2 to 7 days"],
    urgency: "urgent", rules: ["dengue_warning", "dengue_watch"] },
  { name: "Fever 3 days, no warning signs", person: adult, symptoms: ["Fever"], pick: ["2 to 7 days"],
    urgency: "routine", rules: ["dengue_watch"] },
  { name: "Fever after flood water", person: adult, symptoms: ["Fever"], yes: ["Muscle or body pain", "Waded through flood water or mud"], pick: ["Less than 2 days"],
    urgency: "urgent", rules: ["leptospirosis"] },
  { name: "Fever over a week", person: adult, symptoms: ["Fever"], pick: ["More than 7 days"],
    urgency: "urgent", rules: ["long_fever"] },
  { name: "Cough 3 weeks", person: adult, symptoms: ["Cough"], yes: ["Coughing for 2 weeks or more"],
    urgency: "routine", rules: ["tb_cough"] },
  { name: "Short cold", person: adult, symptoms: ["Runny"], yes: [],
    urgency: "self_care", rules: [] },
  { name: "Dog bite only", person: adult, symptoms: ["dog"],
    urgency: "urgent", rules: ["animal_bite"] },
  { name: "Toddler with diarrhea and vomiting", person: toddler, symptoms: ["Diarrhea"], yes: ["Vomiting"],
    urgency: "urgent", rules: ["child_dehydration"] },
];

for (const c of CASES) {
  Deno.test(`PH case: ${c.name}`, async () => {
    const r = await run(c.person, c.symptoms, c.yes, c.pick);
    eq(r.urgency, c.urgency, "urgency");
    eq([...(r.phRules ?? [])].sort(), [...c.rules].sort(), "rules fired");
  });
}

Deno.test("PH questions come first, once each", async () => {
  const r = await run(adult, ["Fever", "Cough"], [], ["Less than 2 days"]);
  eq(r.asked.slice(0, 3), ["ph_fever_days", "ph_flood", "ph_cough_2w"]);
  eq(new Set(r.asked).size, r.asked.length, "no question asked twice");
});

Deno.test("rules never lower urgency and keep the engine's emergency", () => {
  const facts = { has: () => false, feverDays: null, flood: false, cough2w: true, bite: false, age: 30 } as const;
  const urgent: Assessment = { urgency: "urgent", specialties: ["Cardiology"], conditions: [], redFlags: ["x"] };
  const r = applyRules(urgent, facts);
  eq([r.urgency, r.phRules], ["urgent", ["tb_cough"]]);
  eq(r.redFlags.at(-1), "x", "engine warnings kept");
});

Deno.test("search adds the animal bite item", async () => {
  const layer = new PhLayer(new DemoEngine());
  eq((await layer.searchSymptoms("bite", null))[0]?.id, "ph_animal_bite");
  eq(await layer.nameOf("ph_flood"), null);
});
