// ApiMedic (priaid) adapter: the build-and-test engine for the symptom check.
//
// API (from priaid's official SDK, github.com/priaid-eHealth/symptomchecker):
//   POST <auth>/login   Authorization: Bearer <username>:<base64(HMAC-MD5(password, loginUrl))>
//                       → { Token, ValidThrough (seconds) }
//   GET  <health>/symptoms                                     → [{ ID, Name }]
//   GET  <health>/symptoms/proposed?symptoms=[..]&gender=&year_of_birth= → [{ ID, Name }]
//   GET  <health>/diagnosis?symptoms=[..]&gender=&year_of_birth=
//        → [{ Issue: { ID, Name, Accuracy, … }, Specialisation: [{ ID, Name, SpecialistID }] }]
//   GET  <health>/redflag?symptomId=<id>                       → "warning text" or ""
//   Every GET also takes token, format=json, language.
//
// The sandbox returns made-up results; it's for building, not clinical use.
// ApiMedic has no triage levels, so urgency is coarse: a red-flag warning on
// any chosen symptom → "urgent" (see a doctor today), otherwise "routine".
// Emergencies are caught earlier by CareCall's own emergency screen.
//
// Secrets: APIMEDIC_USERNAME (API key), APIMEDIC_PASSWORD (secret key),
//          APIMEDIC_SANDBOX ("false" for the live service; anything else = sandbox)
import { base64, hmacMd5 } from "./md5.ts";
import {
  type Answer, type Assessment, EngineError, type Person, type Question,
  type Symptom, type SymptomEngine,
} from "./types.ts";

type Fetch = typeof fetch;

const LANGUAGE = "en-gb";
const SYMPTOM_LIST_TTL_MS = 24 * 60 * 60 * 1000;
const MAX_FOLLOW_UPS = 6;
const MAX_RED_FLAG_LOOKUPS = 8;

// Module-level caches survive between requests on a warm instance.
let tokenCache: { key: string; token: string; expiresAt: number } | null = null;
let symptomCache: { key: string; at: number; list: Symptom[] } | null = null;
const redFlagCache = new Map<string, string>();

type DiagnosisRow = {
  Issue?: { ID?: number; Name?: string; Accuracy?: number };
  Specialisation?: { ID?: number; Name?: string }[];
};

export class ApiMedicEngine implements SymptomEngine {
  readonly name = "apimedic" as const;
  #calls = 0;
  get calls() { return this.#calls; }

  constructor(
    private username: string,
    private password: string,
    private sandbox: boolean,
    private fetchFn: Fetch = fetch,
  ) {}

  static fromEnv(): ApiMedicEngine | null {
    const user = Deno.env.get("APIMEDIC_USERNAME") ?? "";
    const pass = Deno.env.get("APIMEDIC_PASSWORD") ?? "";
    if (!user || !pass) return null;
    return new ApiMedicEngine(user, pass, (Deno.env.get("APIMEDIC_SANDBOX") ?? "").toLowerCase() !== "false");
  }

  get authUrl() {
    return this.sandbox ? "https://sandbox-authservice.priaid.ch/login" : "https://authservice.priaid.ch/login";
  }
  get healthUrl() {
    return this.sandbox ? "https://sandbox-healthservice.priaid.ch" : "https://healthservice.priaid.ch";
  }
  private get cacheKey() { return `${this.username}|${this.sandbox}`; }

  private async token(): Promise<string> {
    const now = Date.now();
    if (tokenCache && tokenCache.key === this.cacheKey && tokenCache.expiresAt > now + 60_000) return tokenCache.token;
    const sig = base64(hmacMd5(new TextEncoder().encode(this.password), new TextEncoder().encode(this.authUrl)));
    const res = await this.fetchFn(this.authUrl, {
      method: "POST",
      headers: { Authorization: `Bearer ${this.username}:${sig}` },
    });
    const j = await res.json().catch(() => ({}));
    if (!res.ok || typeof j?.Token !== "string") {
      throw new EngineError(`ApiMedic login failed (${res.status})`);
    }
    const ttl = Number(j.ValidThrough) > 0 ? Number(j.ValidThrough) * 1000 : 60 * 60 * 1000;
    tokenCache = { key: this.cacheKey, token: j.Token, expiresAt: now + ttl };
    return j.Token;
  }

  private async get<T>(path: string, params: Record<string, string> = {}): Promise<T> {
    const token = await this.token();
    const qs = new URLSearchParams({ ...params, token, format: "json", language: LANGUAGE });
    this.#calls++;
    const res = await this.fetchFn(`${this.healthUrl}/${path}?${qs}`);
    if (res.status === 401) tokenCache = null; // expired early; next request logs in again
    if (!res.ok) throw new EngineError(`ApiMedic ${path} failed (${res.status})`);
    return await res.json() as T;
  }

  private personParams(person: Person, ids: string[]) {
    return {
      symptoms: JSON.stringify(ids.map(Number)),
      gender: person.sex === "female" ? "Female" : "Male",
      year_of_birth: String(person.birthYear),
    };
  }

  async allSymptoms(): Promise<Symptom[]> {
    const now = Date.now();
    if (symptomCache && symptomCache.key === this.cacheKey && now - symptomCache.at < SYMPTOM_LIST_TTL_MS) {
      return symptomCache.list;
    }
    const rows = await this.get<{ ID: number; Name: string }[]>("symptoms");
    const list = rows.map((r) => ({ id: String(r.ID), name: r.Name })).sort((a, b) => a.name.localeCompare(b.name));
    symptomCache = { key: this.cacheKey, at: now, list };
    return list;
  }

  async searchSymptoms(text: string): Promise<Symptom[]> {
    const q = text.trim().toLowerCase();
    if (q.length < 2) return [];
    const list = await this.allSymptoms();
    const starts = list.filter((s) => s.name.toLowerCase().startsWith(q));
    const contains = list.filter((s) => !s.name.toLowerCase().startsWith(q) && s.name.toLowerCase().includes(q));
    return [...starts, ...contains].slice(0, 15);
  }

  async next(person: Person, answers: Answer[]): Promise<{ question: Question } | { assessment: Assessment }> {
    const present = unique(answers.filter((a) => a.present).map((a) => a.symptomId));
    if (!present.length) throw new EngineError("no symptoms chosen");

    // One round of "do you also have any of these?" from ApiMedic's proposals.
    if (!answers.some((a) => a.source === "question")) {
      const answered = new Set(answers.map((a) => a.symptomId));
      const proposed = await this.get<{ ID: number; Name: string }[]>(
        "symptoms/proposed", this.personParams(person, present));
      const choices = proposed
        .map((p) => ({ id: String(p.ID), name: p.Name }))
        .filter((p) => !answered.has(p.id))
        .slice(0, MAX_FOLLOW_UPS);
      if (choices.length) {
        return { question: { id: "proposed", kind: "multi", text: "Do you also have any of these?", choices } };
      }
    }

    const rows = await this.get<DiagnosisRow[]>("diagnosis", this.personParams(person, present));
    const redFlags = await this.redFlags(present);
    return { assessment: toAssessment(rows, redFlags) };
  }

  private async redFlags(ids: string[]): Promise<string[]> {
    const out: string[] = [];
    for (const id of ids.slice(0, MAX_RED_FLAG_LOOKUPS)) {
      const key = `${this.cacheKey}|${id}`;
      let text = redFlagCache.get(key);
      if (text === undefined) {
        const r = await this.get<unknown>("redflag", { symptomId: id });
        text = typeof r === "string" ? r.trim() : "";
        redFlagCache.set(key, text);
      }
      if (text) out.push(text);
    }
    return unique(out);
  }
}

/** Diagnosis rows + red flags → CareCall assessment. Exported for tests. */
export function toAssessment(rows: DiagnosisRow[], redFlags: string[]): Assessment {
  const conditions = rows
    .filter((r) => r.Issue?.Name)
    .map((r) => ({ name: r.Issue!.Name!, probability: Math.round(Number(r.Issue!.Accuracy ?? 0)) / 100 }));

  // Weight each specialty by the accuracy of the conditions that point to it.
  const weight = new Map<string, number>();
  for (const r of rows) {
    for (const s of r.Specialisation ?? []) {
      if (!s.Name) continue;
      weight.set(s.Name, (weight.get(s.Name) ?? 0) + Number(r.Issue?.Accuracy ?? 0));
    }
  }
  const specialties = [...weight.entries()].sort((a, b) => b[1] - a[1]).map(([n]) => n).slice(0, 3);

  return {
    urgency: redFlags.length ? "urgent" : "routine",
    specialties: specialties.length ? specialties : ["General practice"],
    conditions,
    redFlags,
  };
}

function unique<T>(xs: T[]): T[] { return [...new Set(xs)]; }

/** Test hook: clear module caches. */
export function _resetApiMedicCaches() {
  tokenCache = null; symptomCache = null; redFlagCache.clear();
}
