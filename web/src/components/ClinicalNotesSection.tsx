// Patient detail → "Clinical notes" (care plans M6, demo). Nurses and doctors
// only (the database enforces it too). A doctor dictates, or records the
// consultation with the patient's agreement; speech-to-text makes a
// transcript; CC drafts a SOAP note; the doctor edits and signs. Audio is
// never stored. Signed notes can't be changed, only amended by an addendum.
// Design: docs/care-plan-design.md (M6)
import { useCallback, useEffect, useState } from "react";
import { supabase } from "../lib/supabase";
import { callFunction } from "../lib/api";
import { useSession } from "../lib/session";
import { mmss, useRecorder } from "../lib/recorder";

type Note = {
  id: string; patient_id: string; kind: "note" | "addendum"; amends_note_id: string | null; encounter_date: string;
  mode: "dictation" | "recording" | "typed"; transcript: string | null;
  subjective: string | null; objective: string | null; assessment: string | null; plan: string | null;
  addendum: string | null; status: "draft" | "signed"; signed_at: string | null; signed_provider_id: string | null;
  created_at: string;
};
type Mode = Note["mode"];
type Soap = Pick<Note, "subjective" | "objective" | "assessment" | "plan">;
type Med = { name: string; dose: string; how_often: string; duration: string };

const SOAP_FIELDS: { key: keyof Soap; label: string }[] = [
  { key: "subjective", label: "Subjective (complaint, history)" },
  { key: "objective", label: "Objective (findings, vital signs)" },
  { key: "assessment", label: "Assessment" },
  { key: "plan", label: "Plan" },
];
const SAMPLE =
  "Patient is a 58-year-old male, follow-up for hypertension. Sabi niya medyo nahihilo siya sa umaga for the past one week, " +
  "no chest pain, no shortness of breath. Compliant naman daw sa amlodipine 5 milligrams once a day pero minsan nakakalimutan. " +
  "BP today 150 over 95, heart rate 82, regular. Lungs clear, no edema. Assessment: hypertension, not controlled. " +
  "Plan: increase amlodipine to 10 milligrams once a day in the morning for 30 days, home BP monitoring every morning, " +
  "low salt diet, bawas sa bagoong at patis. Follow up in two weeks with BP log.";

const fmtDate = (iso: string) => new Date(iso.length === 10 ? `${iso}T00:00` : iso).toLocaleDateString();


export default function ClinicalNotesSection({ patientId, clinicId }: { patientId: string; clinicId: string }) {
  const { clinicalRole } = useSession();
  const isDoctor = clinicalRole === "doctor";
  const [notes, setNotes] = useState<Note[]>([]);
  const [doctors, setDoctors] = useState<Record<string, string>>({});
  const [stt, setStt] = useState<string | null>(null);
  const [editing, setEditing] = useState<Note | "new" | null>(null);
  const [addendumFor, setAddendumFor] = useState<Note | null>(null);
  const [msg, setMsg] = useState("");

  const load = useCallback(async () => {
    const { data } = await supabase.from("clinical_notes").select("*").eq("patient_id", patientId)
      .order("created_at", { ascending: false });
    const list = (data as Note[]) ?? [];
    setNotes(list);
    const ids = [...new Set(list.map((n) => n.signed_provider_id).filter(Boolean))] as string[];
    if (ids.length) {
      const { data: p } = await supabase.from("providers").select("id, name").in("id", ids);
      setDoctors(Object.fromEntries(((p ?? []) as { id: string; name: string }[]).map((x) => [x.id, x.name])));
    }
  }, [patientId]);

  useEffect(() => { load(); }, [load]);
  useEffect(() => {
    callFunction<{ stt: string | null }>("clinical-note", { action: "status" }).then(({ data }) => setStt(data?.stt ?? null));
  }, []);

  const main = notes.filter((n) => n.kind === "note");
  const addenda = (id: string) => notes.filter((n) => n.amends_note_id === id).reverse();

  return (
    <>
      <h2>Clinical notes</h2>
      {msg && <p role="status">{msg}</p>}
      {!editing && (
        <div className="row-actions" style={{ marginBottom: 10 }}>
          <button className="secondary" onClick={() => { setEditing("new"); setMsg(""); }}>New note</button>
        </div>
      )}
      {editing && (
        <NoteEditor patientId={patientId} clinicId={clinicId} stt={stt} isDoctor={isDoctor}
          existing={editing === "new" ? null : editing}
          onClose={(text) => { setEditing(null); if (text) setMsg(text); load(); }} />
      )}

      {main.map((n) => (
        <div key={n.id} className="form-card note-card">
          <div className="row-actions" style={{ justifyContent: "space-between" }}>
            <strong>{fmtDate(n.encounter_date)}</strong>
            {n.status === "signed"
              ? <span className="small muted">Signed by {doctors[n.signed_provider_id ?? ""] ?? "a doctor"} on {fmtDate(n.signed_at!)}</span>
              : <span className="badge pending">draft</span>}
          </div>
          {SOAP_FIELDS.map((f) => n[f.key] ? (
            <div key={f.key} className="note-field"><span>{f.label.split(" (")[0]}</span><p>{n[f.key]}</p></div>
          ) : null)}
          {addenda(n.id).map((a) => (
            <div key={a.id} className="note-addendum">
              <span className="small muted">
                Addendum, {a.status === "signed" ? `signed by ${doctors[a.signed_provider_id ?? ""] ?? "a doctor"} on ${fmtDate(a.signed_at!)}` : "draft"}
              </span>
              <p>{a.addendum}</p>
              {a.status === "draft" && isDoctor && <SignButton noteId={a.id} label="Sign addendum" onDone={(t) => { setMsg(t); load(); }} />}
            </div>
          ))}
          <div className="row-actions" style={{ marginTop: 8 }}>
            {n.status === "draft" && <button className="link" onClick={() => setEditing(n)}>Continue draft</button>}
            {n.status === "signed" && <button className="link" onClick={() => setAddendumFor(n)}>Add addendum</button>}
          </div>
          {addendumFor?.id === n.id && (
            <Addendum note={n} clinicId={clinicId} isDoctor={isDoctor}
              onClose={(t) => { setAddendumFor(null); if (t) setMsg(t); load(); }} />
          )}
        </div>
      ))}
      {!main.length && !editing && <p className="empty">No clinical notes yet.</p>}
    </>
  );
}

/**
 * Electronic signature: the doctor re-enters their password; the server checks
 * it before signing. A signed note can't be changed.
 */
function SignButton({ noteId, onDone, beforeSign, label = "Sign note" }: {
  noteId: string | null; onDone: (msg: string) => void; label?: string;
  /** Save first; returns the id to sign, or null to stop. */
  beforeSign?: () => Promise<string | null>;
}) {
  const [asking, setAsking] = useState(false);
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  async function sign() {
    setBusy(true); setErr("");
    const id = beforeSign ? await beforeSign() : noteId;
    if (!id) { setBusy(false); return; }
    const { error } = await callFunction("clinical-note", { action: "sign", note_id: id, password });
    setBusy(false); setPassword("");
    if (error) { setErr(error); return; }
    onDone("Note signed.");
  }
  if (!asking) return <button onClick={() => setAsking(true)}>{label}</button>;
  return (
    <form className="sign-box" onSubmit={(e) => { e.preventDefault(); if (password) sign(); }}>
      <label htmlFor={`sign-pw-${noteId ?? "new"}`}>Enter your password to sign</label>
      <span className="small muted">Signing is final: the note can't be changed afterwards, only amended with an addendum.</span>
      <div className="row-actions" style={{ marginTop: 6 }}>
        <input id={`sign-pw-${noteId ?? "new"}`} type="password" autoComplete="current-password" autoFocus style={{ width: 220 }}
               value={password} onChange={(e) => setPassword(e.target.value)} />
        <button type="submit" disabled={busy || !password}>{busy ? "Signing…" : "Sign"}</button>
        <button type="button" className="link" onClick={() => { setAsking(false); setPassword(""); setErr(""); }}>Cancel</button>
      </div>
      {err && <p role="alert" className="small">{err}</p>}
    </form>
  );
}

/** New note or a draft: capture → transcript → CC draft → edit → save / sign. */
function NoteEditor({ patientId, clinicId, stt, isDoctor, existing, onClose }: {
  patientId: string; clinicId: string; stt: string | null; isDoctor: boolean; existing: Note | null; onClose: (msg?: string) => void;
}) {
  const [mode, setMode] = useState<Mode>(existing?.mode ?? (stt ? "dictation" : "typed"));
  const [consent, setConsent] = useState(existing?.mode === "recording");
  const [transcript, setTranscript] = useState(existing?.transcript ?? "");
  const [engine, setEngine] = useState<string | null>(null);
  const [note, setNote] = useState<Note | null>(existing);
  const [soap, setSoap] = useState<Soap>({
    subjective: existing?.subjective ?? "", objective: existing?.objective ?? "",
    assessment: existing?.assessment ?? "", plan: existing?.plan ?? "",
  });
  const [unclear, setUnclear] = useState<string[]>([]);
  const [meds, setMeds] = useState<Med[]>([]);
  const [busy, setBusy] = useState("");
  const [err, setErr] = useState("");

  // Recorder
  async function finish(audio_base64: string, mime: string) {
    setBusy("Transcribing…");
    const { data, error } = await callFunction<{ transcript: string; engine: string }>("clinical-note", {
      action: "transcribe", patient_id: patientId, mode, recording_consent: consent, audio_base64, mime,
    });
    setBusy("");
    if (error) { setErr(error); return; }
    setEngine(data?.engine ?? null);
    setTranscript((t) => (t ? `${t}\n${data?.transcript ?? ""}` : data?.transcript ?? ""));
  }
  const { recording, seconds, error: micError, start, stop } = useRecorder(finish);
  useEffect(() => { if (micError) setErr(micError); }, [micError]);

  const audioMode = mode !== "typed";
  const canRecord = audioMode && !!stt && (mode === "dictation" || consent);

  async function draft() {
    setErr(""); setBusy("CC is drafting the note…");
    const { data, error } = await callFunction<{ note: Note; unclear: string[]; medicines_mentioned: Med[] }>("clinical-note", {
      action: "draft", patient_id: patientId, mode, recording_consent: consent, transcript, engine, note_id: note?.id,
    });
    setBusy("");
    if (error || !data) { setErr(error ?? "No draft."); return; }
    setNote(data.note);
    setSoap({ subjective: data.note.subjective ?? "", objective: data.note.objective ?? "",
      assessment: data.note.assessment ?? "", plan: data.note.plan ?? "" });
    setUnclear(data.unclear); setMeds(data.medicines_mentioned);
  }

  /** Save the edited SOAP fields (a typed note is created here if needed). */
  async function save(): Promise<Note | null> {
    setErr("");
    const fields = { subjective: soap.subjective || null, objective: soap.objective || null,
      assessment: soap.assessment || null, plan: soap.plan || null };
    const q = note
      ? supabase.from("clinical_notes").update(fields).eq("id", note.id)
      : supabase.from("clinical_notes").insert({ ...fields, patient_id: patientId, clinic_id: clinicId, mode: "typed" });
    const { data, error } = await q.select("*").single();
    if (error || !data) { setErr(`Couldn't save: ${error?.message ?? "not found"}`); return null; }
    setNote(data as Note);
    return data as Note;
  }

  async function discard() {
    if (note && confirm("Delete this draft?")) {
      await supabase.from("clinical_notes").delete().eq("id", note.id);
      onClose("Draft deleted.");
    } else if (!note) onClose();
  }

  const hasSoap = Object.values(soap).some((v) => v?.trim());

  return (
    <div className="form-card note-editor">
      <strong>{existing ? "Continue draft" : "New clinical note"}</strong>

      {!note?.subjective && !hasSoap && (
        <>
          <div className="row-actions" role="radiogroup" aria-label="How to capture the note" style={{ marginTop: 8 }}>
            {(["dictation", "recording", "typed"] as Mode[]).map((m) => (
              <label key={m} style={{ display: "flex", gap: 6, alignItems: "center", margin: 0 }}>
                <input type="radio" name="note-mode" style={{ width: "auto" }} checked={mode === m} disabled={recording}
                       onChange={() => setMode(m)} />
                {m === "dictation" ? "Dictate" : m === "recording" ? "Record consultation" : "Type"}
              </label>
            ))}
          </div>

          {mode === "recording" && (
            <label style={{ display: "flex", gap: 8, alignItems: "flex-start", marginTop: 10 }}>
              <input type="checkbox" style={{ width: "auto", marginTop: 3 }} checked={consent} disabled={recording}
                     onChange={(e) => setConsent(e.target.checked)} />
              <span>The patient agreed to recording this consultation. <span className="small muted">
                The recording is only used to write the note and is deleted right after; it is never stored.
                Ask in their language, e.g. "Okay lang po ba na i-record ko ang usapan natin para sa notes ko?"</span></span>
            </label>
          )}

          {audioMode && !stt && (
            <p className="small muted">
              Speech-to-text isn't set up yet, so type or paste the dictation below.{" "}
              <button className="link" onClick={() => setTranscript(SAMPLE)}>Use a sample dictation</button>
            </p>
          )}
          {canRecord && (
            <div className="row-actions" style={{ marginTop: 10 }}>
              {!recording
                ? <button onClick={start} disabled={!!busy}>{transcript ? "Record more" : mode === "recording" ? "Start recording" : "Start dictating"}</button>
                : <button className="danger" onClick={stop}>Stop ({mmss(seconds)})</button>}
              {recording && <span className="rec-dot" aria-live="polite">Recording</span>}
            </div>
          )}

          <label htmlFor="note-transcript">{mode === "typed" ? "Your notes" : "Transcript (check and correct it)"}</label>
          <textarea id="note-transcript" rows={6} value={transcript} disabled={recording}
                    placeholder={mode === "typed" ? "Type the consultation notes; CC organizes them into a SOAP note." : "The transcript appears here."}
                    onChange={(e) => setTranscript(e.target.value)} />
          <div className="row-actions" style={{ marginTop: 10 }}>
            <button disabled={!transcript.trim() || !!busy || recording || (mode === "recording" && !consent)} onClick={draft}>
              Draft note with CC
            </button>
            <button className="link" onClick={() => setSoap({ subjective: transcript, objective: "", assessment: "", plan: "" })}
                    disabled={!transcript.trim() || recording}>Write it myself</button>
            <button className="link" onClick={discard}>Cancel</button>
          </div>
        </>
      )}

      {(hasSoap || note?.subjective) && (
        <>
          {!!unclear.length && (
            <div className="note-check" role="note">
              <strong>Check before signing</strong>
              <ul>{unclear.map((u, i) => <li key={i}>{u}</li>)}</ul>
            </div>
          )}
          {SOAP_FIELDS.map((f) => (
            <span key={f.key}>
              <label htmlFor={`soap-${f.key}`}>{f.label}</label>
              <textarea id={`soap-${f.key}`} rows={3} value={soap[f.key] ?? ""}
                        onChange={(e) => setSoap({ ...soap, [f.key]: e.target.value })} />
            </span>
          ))}
          {!!meds.length && (
            <p className="small muted">
              Medicines mentioned (not ordered): {meds.map((m) => [m.name, m.dose, m.how_often, m.duration].filter(Boolean).join(" ")).join("; ")}.
              Add them under Medicines if needed.
            </p>
          )}
          <div className="row-actions" style={{ marginTop: 12 }}>
            {isDoctor && note && (
              <SignButton noteId={note.id} beforeSign={async () => (await save())?.id ?? null} onDone={(t) => onClose(t)} />
            )}
            <button className="secondary" onClick={async () => { if (await save()) onClose("Draft saved."); }}>Save draft</button>
            <button className="link" onClick={discard}>{note ? "Delete draft" : "Cancel"}</button>
          </div>
          {!isDoctor && <p className="small muted">A doctor signs this note. Save it as a draft for them.</p>}
          {isDoctor && !note && <p className="small muted">Save the draft first, then sign.</p>}
        </>
      )}

      {busy && <p role="status" className="small">{busy}</p>}
      {err && <p role="alert" className="small">{err}</p>}
    </div>
  );
}

function Addendum({ note, clinicId, isDoctor, onClose }: {
  note: Note; clinicId: string; isDoctor: boolean; onClose: (msg?: string) => void;
}) {
  const [text, setText] = useState("");
  const [draftId, setDraftId] = useState<string | null>(null);
  const [err, setErr] = useState("");
  /** Save (or update) the addendum as a draft; returns its id, or null on failure. */
  async function saveDraft(): Promise<string | null> {
    setErr("");
    const q = draftId
      ? supabase.from("clinical_notes").update({ addendum: text.trim() }).eq("id", draftId)
      : supabase.from("clinical_notes").insert({
        clinic_id: clinicId, patient_id: note.patient_id, kind: "addendum", amends_note_id: note.id,
        addendum: text.trim(), mode: "typed",
      });
    const { data, error } = await q.select("id").single();
    if (error || !data) { setErr(`Couldn't save: ${error?.message ?? "not found"}`); return null; }
    const id = (data as { id: string }).id;
    setDraftId(id);
    return id;
  }
  return (
    <div style={{ marginTop: 8 }}>
      <label htmlFor={`add-${note.id}`}>Addendum</label>
      <textarea id={`add-${note.id}`} rows={3} value={text} onChange={(e) => setText(e.target.value)}
                placeholder="e.g. Lab result received: HbA1c 7.2%" />
      <div className="row-actions" style={{ marginTop: 8 }}>
        {isDoctor && text.trim() && (
          <SignButton noteId={draftId} label="Sign addendum" beforeSign={saveDraft}
            onDone={() => onClose("Addendum signed.")} />
        )}
        <button className="secondary" disabled={!text.trim()}
                onClick={async () => { if (await saveDraft()) onClose("Addendum saved as a draft."); }}>Save draft</button>
        <button className="link" onClick={() => onClose()}>Cancel</button>
      </div>
      {err && <p role="alert" className="small">{err}</p>}
    </div>
  );
}
