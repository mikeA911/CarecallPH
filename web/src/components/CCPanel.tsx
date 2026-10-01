// CC — the CareCall assistant drawer, mounted once in the signed-in layout.
//
// Thin client over the cc-chat edge function. Keeps the conversation in
// sessionStorage so it survives navigation and reloads within the tab, sends
// the current route and active clinic as context, and turns CC's navigate
// actions into buttons.
import { useEffect, useRef, useState, type KeyboardEvent } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { callFunction } from "../lib/api";
import { useClinic } from "../lib/clinic";
import { useSession, roleAtLeast } from "../lib/session";

type Action = { type: "navigate"; route: string; label: string };
type Msg = { role: "user" | "assistant"; content: string; actions?: Action[]; error?: boolean };
type Resp = { reply: string; actions: Action[]; wiki_version: string };

const STORE = "cc-chat-v1";

function loadHistory(): Msg[] {
  try { return JSON.parse(sessionStorage.getItem(STORE) ?? "[]") as Msg[]; } catch { return []; }
}

export default function CCPanel() {
  const [open, setOpen] = useState(false);
  const [msgs, setMsgs] = useState<Msg[]>(loadHistory);
  const [draft, setDraft] = useState("");
  const [busy, setBusy] = useState(false);
  const location = useLocation();
  const navigate = useNavigate();
  const { activeClinicId } = useClinic();
  const { role } = useSession();
  const listRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    try { sessionStorage.setItem(STORE, JSON.stringify(msgs.slice(-40))); } catch { /* storage full/blocked */ }
    listRef.current?.scrollTo({ top: listRef.current.scrollHeight, behavior: "smooth" });
  }, [msgs, busy]);

  useEffect(() => { if (open) inputRef.current?.focus(); }, [open]);

  const starters = roleAtLeast(role, "clinic_admin")
    ? ["What needs my attention today?", "How did my latest campaign do?", "Walk me through setting up my first campaign"]
    : ["What needs my attention today?", "How did my latest campaign do?", "What does “needs human” mean?"];

  async function send(text: string) {
    const content = text.trim();
    if (!content || busy) return;
    const next: Msg[] = [...msgs, { role: "user", content }];
    setMsgs(next);
    setDraft("");
    setBusy(true);
    const { data, error } = await callFunction<Resp>("cc-chat", {
      messages: next.filter((m) => !m.error).map(({ role, content }) => ({ role, content })),
      route: location.pathname,
      active_clinic_id: activeClinicId,
    });
    setBusy(false);
    setMsgs((m) => [
      ...m,
      data
        ? { role: "assistant", content: data.reply, actions: data.actions }
        : { role: "assistant", content: error ?? "Something went wrong.", error: true },
    ]);
  }

  function onKey(e: KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); send(draft); }
    if (e.key === "Escape") setOpen(false);
  }

  if (!open) {
    return (
      <button className="cc-launch" onClick={() => setOpen(true)} aria-label="Ask CC, the CareCall assistant">
        <span className="cc-mark" aria-hidden="true">CC</span>
        <span className="cc-launch-text">Ask CC</span>
      </button>
    );
  }

  return (
    <aside className="cc-panel" role="dialog" aria-label="CC assistant">
      <header className="cc-head">
        <span className="cc-mark" aria-hidden="true">CC</span>
        <div className="cc-head-text">
          <strong>CC</strong>
          <span>CareCall assistant</span>
        </div>
        {msgs.length > 0 && (
          <button className="link cc-new" onClick={() => setMsgs([])} disabled={busy}>New chat</button>
        )}
        <button className="cc-close" onClick={() => setOpen(false)} aria-label="Close">×</button>
      </header>

      <div className="cc-list" ref={listRef} aria-live="polite">
        {msgs.length === 0 && (
          <div className="cc-empty">
            <p>Hi! I can explain how CareCall works, take you to the right screen, walk you through setup, and look at how your campaigns are doing.</p>
            <div className="cc-starters">
              {starters.map((s) => <button key={s} className="cc-starter" onClick={() => send(s)}>{s}</button>)}
            </div>
          </div>
        )}
        {msgs.map((m, i) => (
          <div key={i} className={`cc-msg cc-${m.role}${m.error ? " cc-error" : ""}`}>
            <div className="cc-bubble">{m.content}</div>
            {m.actions && m.actions.length > 0 && (
              <div className="cc-actions">
                {m.actions.map((a) => (
                  <button key={a.route} className="secondary" onClick={() => navigate(a.route)}>{a.label}</button>
                ))}
              </div>
            )}
          </div>
        ))}
        {busy && <div className="cc-msg cc-assistant"><div className="cc-bubble cc-typing">CC is looking into it…</div></div>}
      </div>

      <div className="cc-compose">
        <textarea
          ref={inputRef}
          rows={2}
          value={draft}
          placeholder="Ask CC anything about CareCall…"
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={onKey}
          disabled={busy}
        />
        <button onClick={() => send(draft)} disabled={busy || !draft.trim()}>Send</button>
      </div>
      <p className="cc-foot">CC sees totals, not patient details. Double-check before acting.</p>
    </aside>
  );
}
