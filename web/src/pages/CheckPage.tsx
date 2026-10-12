// Public symptom check — /check and /check/:slug (Discover slice D1a).
// Design: docs/symptom-check-design.md
//
// Flow: intro + consent → emergency questions → about you → symptoms →
// follow-up questions (tick any / yes-no-don't know / pick one) → result. The emergency questions and the emergency
// screen are in this page, so they work even if the API or the engine is down.
// The page never shows condition names; only urgency, the kind of doctor and
// engine warnings. Nothing typed here is stored as typed.
import { useCallback, useEffect, useRef, useState } from "react";
import { useParams, useSearchParams } from "react-router-dom";
import {
  type Answer, type CheckClinic, EMERGENCY_QUESTIONS, type NextResp, type Question, type Sex,
  type Symptom, specialtyLabel, symptomApi,
} from "../lib/symptomCheck";
import { phLocalGroups } from "../lib/phone";

/** "+639171234567" → "0917 123 4567"; other numbers unchanged. */
const showPhone = (e164: string) => phLocalGroups(e164)?.join(" ") ?? e164;

type Step = "intro" | "screen" | "emergency" | "about" | "symptoms" | "question" | "result" | "unavailable" | "notfound";

const THIS_YEAR = new Date().getFullYear();

export default function CheckPage() {
  const { slug = "" } = useParams();
  const [params] = useSearchParams();
  const entry = params.get("src") === "telegram" ? "telegram" : "web";

  const [step, setStep] = useState<Step>("intro");
  const [checkId, setCheckId] = useState<string | null>(null);
  const [clinic, setClinic] = useState<CheckClinic | null>(null);
  const [demo, setDemo] = useState(false);
  const [available, setAvailable] = useState(true);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");

  const [flags, setFlags] = useState<Record<string, boolean>>({});
  const [birthYear, setBirthYear] = useState("");
  const [sex, setSex] = useState<Sex | "">("");
  const [chosen, setChosen] = useState<Symptom[]>([]);
  const [question, setQuestion] = useState<Question | null>(null);
  const [ticked, setTicked] = useState<Record<string, boolean>>({});
  const [followUps, setFollowUps] = useState<Answer[]>([]);
  const [result, setResult] = useState<NextResp["result"] | null>(null);

  // Start the check in the background; the intro and emergency questions don't need it.
  const starting = useRef<Promise<string | null> | null>(null);
  const begin = useCallback(() => {
    setCheckId(null);
    starting.current = symptomApi.start(slug || null, slug && entry === "web" ? "clinic_page" : entry)
      .then(({ data, error }) => {
        if (error === "not_found") { setStep("notfound"); return null; }
        if (!data) { setAvailable(false); return null; }
        setCheckId(data.check_id);
        setClinic(data.clinic);
        setDemo(data.demo === true);
        setAvailable(data.available);
        return data.check_id;
      });
  }, [slug, entry]);
  useEffect(() => { begin(); }, [begin]);
  const goUnavailable = useCallback(() => setStep("unavailable"), []);

  useEffect(() => { window.scrollTo({ top: 0 }); }, [step]);

  const age = birthYear ? THIS_YEAR - Number(birthYear) : null;
  const person = { birthYear: Number(birthYear), sex: sex as Sex };

  async function submitScreen() {
    const emergency = EMERGENCY_QUESTIONS.some((q) => flags[q.id]);
    // The emergency screen never waits for the network.
    if (emergency) {
      if (checkId) symptomApi.screen(checkId, true);
      setStep("emergency");
      return;
    }
    setBusy(true);
    const id = checkId ?? await starting.current;
    const ok = id ? !(await symptomApi.screen(id, false)).error : false;
    setBusy(false);
    setStep(ok && available ? "about" : "unavailable");
  }

  async function runNext(answers: Answer[]) {
    if (!checkId) { setStep("unavailable"); return; }
    setBusy(true); setErr("");
    const { data, error } = await symptomApi.next(checkId, person, answers);
    setBusy(false);
    if (!data) {
      if (error === "emergency") { setStep("emergency"); return; }
      setStep("unavailable");
      return;
    }
    if (data.question) {
      setQuestion(data.question);
      setTicked({});
      setStep("question");
      return;
    }
    setResult(data.result ?? null);
    setStep(data.result?.urgency === "emergency" ? "emergency" : "result");
  }

  const searchAnswers = (): Answer[] => chosen.map((s) => ({ symptomId: s.id, present: true, source: "search" }));

  /** "multi": every choice ticked or not. */
  function answerTicked(noneOfThese: boolean) {
    if (!question) return;
    answerWith(question.choices.map((c) => ({
      symptomId: c.id, present: !noneOfThese && !!ticked[c.id], source: "question",
    })));
  }

  function answerWith(answers: Answer[]) {
    const all = [...followUps, ...answers];
    setFollowUps(all);
    runNext([...searchAnswers(), ...all]);
  }

  // A new check each time: an earlier one may be marked as an emergency.
  function restart() {
    setFlags({}); setChosen([]); setQuestion(null); setFollowUps([]); setResult(null); setErr("");
    begin();
    setStep("screen");
  }

  return (
    <div className="book-screen">
      <div className="book-card">
        <div className="book-clinic">{clinic?.name ?? "CareCall"}</div>
        <div className="book-subtitle">Symptom check</div>
        {demo && (
          <div className="check-demo" role="note">
            <strong>DEMO</strong> Test version with made-up rules. Not medical advice.
          </div>
        )}

        <div className="book-body">
          {step === "notfound" && (
            <>
              <h1>This page isn't available</h1>
              <p className="book-muted">The clinic may have turned off its symptom check.</p>
              <EmergencyFooter />
            </>
          )}

          {step === "intro" && (
            <>
              <h1>Not feeling well?</h1>
              <p className="book-muted">
                Answer a few questions. We'll tell you how soon to see a doctor and what kind of doctor.
              </p>
              <div className="check-note">
                <strong>This is not a diagnosis.</strong> It doesn't replace a doctor. If you feel very
                unwell, call <a href="tel:911">911</a>.
                <br /><span lang="fil">Hindi ito diagnosis. Kung malubha ang pakiramdam, tumawag sa 911.</span>
              </div>
              <p className="book-muted small">
                We keep only your age range, sex and the symptoms you pick, with no name or phone number,
                and delete them after 90 days.
              </p>
              <button className="book-btn" onClick={() => setStep("screen")}>I understand, start</button>
            </>
          )}

          {step === "screen" && (
            <>
              <h1>First, is this an emergency?</h1>
              <p className="book-muted">Tick anything that's happening now.</p>
              <div className="check-list">
                {EMERGENCY_QUESTIONS.map((q) => (
                  <label key={q.id} className={`check-option${flags[q.id] ? " on" : ""}`}>
                    <input type="checkbox" checked={!!flags[q.id]}
                      onChange={(e) => setFlags({ ...flags, [q.id]: e.target.checked })} />
                    <span>
                      {q.en}
                      <span className="check-fil" lang="fil">{q.fil}</span>
                    </span>
                  </label>
                ))}
              </div>
              <button className="book-btn" disabled={busy} onClick={submitScreen}>
                {EMERGENCY_QUESTIONS.some((q) => flags[q.id]) ? "Continue" : "None of these, continue"}
              </button>
            </>
          )}

          {step === "emergency" && (
            <EmergencyScreen clinic={clinic} selfHarm={!!flags.selfharm} onBack={restart} />
          )}

          {step === "about" && (
            <>
              <h1>About the patient</h1>
              <label htmlFor="by">Year of birth</label>
              <input id="by" className="book-input" inputMode="numeric" maxLength={4} placeholder="e.g. 1985"
                value={birthYear} onChange={(e) => setBirthYear(e.target.value.replace(/\D/g, ""))} />
              <label style={{ marginTop: 16 }}>Sex at birth</label>
              <div className="check-seg">
                {(["female", "male"] as const).map((s) => (
                  <button key={s} type="button" className={sex === s ? "on" : ""} onClick={() => setSex(s)}>
                    {s === "female" ? "Female" : "Male"}
                  </button>
                ))}
              </div>
              {age !== null && age >= 0 && age < 18 && (
                <p className="check-note">For a child, a parent or guardian should answer the questions.</p>
              )}
              {err && <p className="book-err">{err}</p>}
              <button className="book-btn" onClick={() => {
                const y = Number(birthYear);
                if (!(y >= THIS_YEAR - 120 && y <= THIS_YEAR)) { setErr("Please enter a 4-digit year of birth."); return; }
                if (!sex) { setErr("Please choose female or male."); return; }
                setErr(""); setStep("symptoms");
              }}>Next</button>
            </>
          )}

          {step === "symptoms" && checkId && (
            <SymptomPicker checkId={checkId} chosen={chosen} setChosen={setChosen} busy={busy}
              onNext={() => { setFollowUps([]); runNext(searchAnswers()); }}
              onUnavailable={goUnavailable} />
          )}

          {step === "question" && question && (
            <>
              <h1>{question.text}</h1>
              {question.kind === "multi" && (
                <>
                  <p className="book-muted">Tick any that apply.</p>
                  <div className="check-list">
                    {question.choices.map((c) => (
                      <label key={c.id} className={`check-option${ticked[c.id] ? " on" : ""}`}>
                        <input type="checkbox" checked={!!ticked[c.id]}
                          onChange={(e) => setTicked({ ...ticked, [c.id]: e.target.checked })} />
                        <span>{c.name}</span>
                      </label>
                    ))}
                  </div>
                  <button className="book-btn" disabled={busy} onClick={() => answerTicked(false)}>
                    {busy ? "Checking…" : "Continue"}
                  </button>
                  <button className="book-link" disabled={busy} onClick={() => answerTicked(true)}>None of these</button>
                </>
              )}
              {question.kind === "single" && question.choices[0] && (
                <div className="book-list">
                  {([["Yes", true], ["No", false], ["Don't know", "unknown"]] as const).map(([label, present]) => (
                    <button key={label} className="book-option" disabled={busy}
                      onClick={() => answerWith([{ symptomId: question.choices[0].id, present, source: "question" }])}>
                      <span className="book-option-main">{label}</span>
                    </button>
                  ))}
                </div>
              )}
              {question.kind === "one_of" && (
                <div className="book-list">
                  {question.choices.map((c) => (
                    <button key={c.id} className="book-option" disabled={busy}
                      onClick={() => answerWith([{ symptomId: c.id, present: true, source: "question" }])}>
                      <span className="book-option-main">{c.name}</span>
                    </button>
                  ))}
                </div>
              )}
              {busy && question.kind !== "multi" && <p className="book-muted small">Checking…</p>}
            </>
          )}

          {step === "result" && result && <Result result={result} clinic={clinic} onRestart={restart} />}

          {step === "unavailable" && (
            <>
              <h1>We can't run the check right now</h1>
              <p className="book-muted">
                {clinic?.phone ? <>Please call {clinic.name} at <a href={`tel:${clinic.phone}`}>{showPhone(clinic.phone)}</a>, or </> : "Please "}
                see a doctor or visit your barangay health center if you're worried.
              </p>
              <EmergencyFooter />
            </>
          )}
        </div>
      </div>
    </div>
  );
}

function SymptomPicker({ checkId, chosen, setChosen, busy, onNext, onUnavailable }: {
  checkId: string; chosen: Symptom[]; setChosen: (s: Symptom[]) => void; busy: boolean;
  onNext: () => void; onUnavailable: () => void;
}) {
  const [q, setQ] = useState("");
  const [hits, setHits] = useState<Symptom[]>([]);
  const [searching, setSearching] = useState(false);
  const seq = useRef(0);

  useEffect(() => {
    const text = q.trim();
    if (text.length < 2) { setHits([]); return; }
    const n = ++seq.current;
    const t = setTimeout(async () => {
      setSearching(true);
      const { data, error } = await symptomApi.search(checkId, text);
      if (n !== seq.current) return;
      setSearching(false);
      if (error === "unavailable") { onUnavailable(); return; }
      setHits((data?.symptoms ?? []).filter((s) => !chosen.some((c) => c.id === s.id)));
    }, 250);
    return () => clearTimeout(t);
  }, [q, checkId, chosen, onUnavailable]);

  return (
    <>
      <h1>What are the symptoms?</h1>
      <p className="book-muted">Type a word, like "fever", "cough" or "headache", and pick from the list. Add all that apply.</p>
      {chosen.length > 0 && (
        <div className="check-chips">
          {chosen.map((s) => (
            <span key={s.id} className="check-chip">
              {s.name}
              <button type="button" aria-label={`Remove ${s.name}`}
                onClick={() => setChosen(chosen.filter((c) => c.id !== s.id))}>×</button>
            </span>
          ))}
        </div>
      )}
      <input className="book-input" placeholder="Search symptoms (in English)" value={q} autoFocus
        onChange={(e) => setQ(e.target.value)} aria-label="Search symptoms" />
      {searching && <p className="book-muted small">Searching…</p>}
      {hits.length > 0 && (
        <div className="book-list" style={{ marginTop: 10 }}>
          {hits.map((s) => (
            <button key={s.id} className="book-option" onClick={() => { setChosen([...chosen, s]); setQ(""); setHits([]); }}>
              <span className="book-option-main">{s.name}</span>
            </button>
          ))}
        </div>
      )}
      {!searching && q.trim().length >= 2 && hits.length === 0 && (
        <p className="book-muted small">No match. Try another word.</p>
      )}
      <button className="book-btn" disabled={!chosen.length || busy} onClick={onNext}>
        {busy ? "Checking…" : "Next"}
      </button>
    </>
  );
}

function Result({ result, clinic, onRestart }: {
  result: NonNullable<NextResp["result"]>; clinic: CheckClinic | null; onRestart: () => void;
}) {
  const head = {
    urgent: { en: "See a doctor today", fil: "Magpatingin sa doktor ngayong araw." },
    routine: { en: "See a doctor in the next few days", fil: "Magpatingin sa doktor sa susunod na mga araw." },
    self_care: { en: "You can probably look after this at home", fil: "Maaaring alagaan muna sa bahay." },
    emergency: { en: "Get emergency help now", fil: "Humingi agad ng tulong pang-emergency." },
  }[result.urgency];

  return (
    <>
      <div className={`check-urgency check-urgency-${result.urgency}`}>
        <strong>{head.en}</strong>
        <span lang="fil">{head.fil}</span>
      </div>

      <h2 className="check-h2">Who to see</h2>
      <p>{result.specialties.length > 1 ? "Start with " : ""}{specialtyLabel(result.specialties[0] ?? "General practice")}.
        {result.specialties.length > 1 && <> They may refer you to {result.specialties.slice(1).map(specialtyLabel).join(" or ")}.</>}
      </p>

      {result.red_flags.length > 0 && (
        <>
          <h2 className="check-h2">Warning signs</h2>
          <ul className="check-flags">{result.red_flags.map((f) => <li key={f}>{f}</li>)}</ul>
        </>
      )}

      {clinic && (
        <div className="check-clinic">
          <strong>{clinic.name}</strong>
          {clinic.phone
            ? <p>Call to book: <a href={`tel:${clinic.phone}`}>{showPhone(clinic.phone)}</a></p>
            : <p>Contact the clinic to book a visit.</p>}
        </div>
      )}

      <div className="check-note">
        If it gets worse, or any emergency sign appears, call <a href="tel:911">911</a>.
        This is not a diagnosis.
      </div>
      <button className="book-link" onClick={onRestart}>Start a new check</button>
    </>
  );
}

function EmergencyScreen({ clinic, selfHarm, onBack }: { clinic: CheckClinic | null; selfHarm: boolean; onBack: () => void }) {
  const local = (clinic?.local_emergency_numbers ?? "").split("\n").map((s) => s.trim()).filter(Boolean);
  return (
    <div className="check-emergency" role="alert">
      <h1>Call 911 now</h1>
      <p lang="fil" className="check-fil-lead">Tumawag agad sa 911.</p>
      <a className="check-call" href="tel:911">Call 911</a>
      <p className="small">Or go to the nearest hospital emergency room. Don't drive yourself if you can avoid it.</p>

      {selfHarm && (
        <div className="check-note">
          You're not alone. NCMH Crisis Hotline: <a href="tel:1553">1553</a> (24 hours).
        </div>
      )}

      {local.length > 0 && (
        <>
          <h2 className="check-h2">Local emergency numbers</h2>
          <ul className="check-local">
            {local.map((l) => {
              const tel = l.replace(/[^\d+]/g, "");
              return <li key={l}>{tel.length >= 3 ? <a href={`tel:${tel}`}>{l}</a> : l}</li>;
            })}
          </ul>
        </>
      )}

      <h2 className="check-h2">Tell the dispatcher</h2>
      <ul>
        <li>Where you are: address or a landmark</li>
        <li>What's happening, and since when</li>
        <li>The patient's age, and whether they're awake and breathing</li>
      </ul>

      <h2 className="check-h2">While you wait</h2>
      <ul>
        <li>Stay with the patient and keep your phone on</li>
        <li>Don't give food or drink</li>
        <li>Unlock the door and turn on a light so responders can find you</li>
      </ul>

      <button className="book-link" onClick={onBack}>I ticked something by mistake</button>
    </div>
  );
}

function EmergencyFooter() {
  return <p className="check-note">In an emergency, call <a href="tel:911">911</a>.</p>;
}
