// Infermedica Engine API v3 adapter: the go-live candidate for the symptom check.
//
// Endpoints and headers from Infermedica's official client
// (github.com/infermedica/python-api) and developer docs:
//   base  https://api.infermedica.com/v3
//   headers  App-Id, App-Key, Interview-Id (one per check), Model (optional, e.g. infermedica-en)
//   GET  /symptoms?age.value=N                → [{ id, name, common_name, … }]
//   POST /diagnosis  { sex, age: { value }, evidence: [{ id, choice_id, source? }] }
//        → { question: { type, text, items: [{ id, name, choices: [{ id, label }] }] } | null,
//            conditions: [{ id, name, common_name, probability }], should_stop, has_emergency_evidence }
//   POST /triage               (same body)  → { triage_level, serious: [...] }
//   POST /recommend_specialist (same body)  → { recommended_specialist: { id, name }, recommended_channel }
// choice_id is "present" | "absent" | "unknown"; source "initial" marks what the patient picked.
// Response shapes beyond the request format are from the docs and still need
// checking against a trial account (slice D1d).
//
// Calls per check: 1 per follow-up question, then triage + specialist (2).
// The symptom list is fetched once a day per warm instance and searched here,
// so typing in the search box doesn't use API calls (the trial has 2,000).
//
// Secrets: INFERMEDICA_APP_ID, INFERMEDICA_APP_KEY, optional INFERMEDICA_MODEL
import {
  type Answer, type Assessment, EngineError, type Person, type Question,
  type Symptom, type SymptomEngine, type Urgency,
} from "./types.ts";

type Fetch = typeof fetch;

const BASE = "https://api.infermedica.com/v3";
const SYMPTOM_LIST_TTL_MS = 24 * 60 * 60 * 1000;
const MAX_FOLLOW_UP_ANSWERS = 15; // then assess, even if the engine would ask more

let symptomCache: { key: string; at: number; list: Symptom[] } | null = null;

type InfQuestion = {
  type: "single" | "group_single" | "group_multiple";
  text: string;
  items: { id: string; name: string; choices?: { id: string; label: string }[] }[];
};
type DiagnosisResp = {
  question?: InfQuestion | null;
  conditions?: { id: string; name: string; common_name?: string; probability: number }[];
  should_stop?: boolean;
  has_emergency_evidence?: boolean;
};

export class InfermedicaEngine implements SymptomEngine {
  readonly name = "infermedica" as const;
  readonly demo = false;
  #calls = 0;
  get calls() { return this.#calls; }

  constructor(
    private appId: string,
    private appKey: string,
    private interviewId: string | undefined,
    private model: string | undefined,
    private fetchFn: Fetch = fetch,
  ) {}

  static fromEnv(interviewId?: string): InfermedicaEngine | null {
    const id = Deno.env.get("INFERMEDICA_APP_ID") ?? "";
    const key = Deno.env.get("INFERMEDICA_APP_KEY") ?? "";
    if (!id || !key) return null;
    return new InfermedicaEngine(id, key, interviewId, Deno.env.get("INFERMEDICA_MODEL") || undefined);
  }

  private headers(): Record<string, string> {
    const h: Record<string, string> = { "App-Id": this.appId, "App-Key": this.appKey, "Content-Type": "application/json" };
    if (this.interviewId) h["Interview-Id"] = this.interviewId;
    if (this.model) h["Model"] = this.model;
    return h;
  }

  private async call<T>(method: "GET" | "POST", path: string, body?: unknown): Promise<T> {
    this.#calls++;
    const res = await this.fetchFn(`${BASE}${path}`, {
      method, headers: this.headers(), body: body === undefined ? undefined : JSON.stringify(body),
    });
    if (!res.ok) {
      const text = await res.text().catch(() => "");
      throw new EngineError(`Infermedica ${path} failed (${res.status}) ${text.slice(0, 200)}`);
    }
    return await res.json() as T;
  }

  async allSymptoms(): Promise<Symptom[]> {
    const now = Date.now();
    if (symptomCache && symptomCache.key === this.appId && now - symptomCache.at < SYMPTOM_LIST_TTL_MS) {
      return symptomCache.list;
    }
    // The list varies a little with age; an adult list is used for searching,
    // and /diagnosis applies the patient's real age.
    const rows = await this.call<{ id: string; name: string; common_name?: string }[]>("GET", "/symptoms?age.value=30");
    const list = rows
      .map((r) => ({ id: r.id, name: r.common_name || r.name }))
      .sort((a, b) => a.name.localeCompare(b.name));
    symptomCache = { key: this.appId, at: now, list };
    return list;
  }

  async searchSymptoms(text: string): Promise<Symptom[]> {
    const q = text.trim().toLowerCase();
    if (q.length < 2) return [];
    const list = await this.allSymptoms();
    const starts = list.filter((s) => s.name.toLowerCase().startsWith(q));
    const words = list.filter((s) => !s.name.toLowerCase().startsWith(q) && s.name.toLowerCase().includes(q));
    return [...starts, ...words].slice(0, 15);
  }

  async next(person: Person, answers: Answer[]): Promise<{ question: Question } | { assessment: Assessment }> {
    if (!answers.some((a) => a.present === true)) throw new EngineError("no symptoms chosen");
    const body = diagnosticBody(person, answers);
    const asked = new Set(answers.filter((a) => a.source === "question").map((a) => a.symptomId)).size;

    const d = await this.call<DiagnosisResp>("POST", "/diagnosis", body);
    const done = d.should_stop || d.has_emergency_evidence || !d.question || asked >= MAX_FOLLOW_UP_ANSWERS;
    if (!done && d.question) {
      const q = toQuestion(d.question);
      if (q) return { question: q };
    }

    const [triage, spec] = await Promise.all([
      this.call<{ triage_level?: string }>("POST", "/triage", body),
      this.call<{ recommended_specialist?: { name?: string } }>("POST", "/recommend_specialist", body)
        .catch(() => ({ recommended_specialist: undefined })), // specialist is a nice-to-have
    ]);
    return {
      assessment: {
        urgency: triageToUrgency(triage.triage_level, d.has_emergency_evidence === true),
        specialties: [spec.recommended_specialist?.name || "General practitioner"],
        conditions: (d.conditions ?? []).map((c) => ({ name: c.common_name || c.name, probability: c.probability })),
        redFlags: [],
      },
    };
  }
}

/** Our answers → Infermedica's request body. Exported for tests. */
export function diagnosticBody(person: Person, answers: Answer[]) {
  const age = Math.max(0, new Date().getUTCFullYear() - person.birthYear);
  const seen = new Set<string>();
  const evidence = [];
  for (const a of answers) {
    if (seen.has(a.symptomId)) continue;
    seen.add(a.symptomId);
    const choice_id = a.present === "unknown" ? "unknown" : a.present ? "present" : "absent";
    evidence.push(a.source === "search" ? { id: a.symptomId, choice_id, source: "initial" } : { id: a.symptomId, choice_id });
  }
  return { sex: person.sex, age: { value: age }, evidence };
}

/** Infermedica question → our question kinds. */
export function toQuestion(q: InfQuestion): Question | null {
  const choices = q.items.map((i) => ({ id: i.id, name: i.name }));
  if (!choices.length) return null;
  const kind = q.type === "single" ? "single" : q.type === "group_single" ? "one_of" : "multi";
  return { id: q.items.map((i) => i.id).join(","), text: q.text, kind, choices: kind === "single" ? choices.slice(0, 1) : choices };
}

export function triageToUrgency(level: string | undefined, emergencyEvidence: boolean): Urgency {
  switch (level) {
    case "emergency_ambulance":
    case "emergency": return "emergency";
    case "consultation_24": return "urgent";
    case "self_care": return "self_care";
    case "consultation": return "routine";
    default: return emergencyEvidence ? "emergency" : "routine";
  }
}

/** Test hook: clear module caches. */
export function _resetInfermedicaCaches() { symptomCache = null; }
