// CC — the CareCall assistant drawer, mounted once in the signed-in layout and
// opened from the logo at the top of the sidebar.
//
// Thin client over the cc-chat edge function. Sends the current route and
// active clinic as context and turns CC's navigate actions into buttons.
//
// Chat history lives in this browser only (localStorage, one list per signed-in
// user): New chat keeps the old conversation, History reopens or deletes it.
// Nothing is stored on the server.
import { useEffect, useRef, useState, type KeyboardEvent } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { callFunction } from "../lib/api";
import { useClinic } from "../lib/clinic";
import { useSession, roleAtLeast } from "../lib/session";

type Action = { type: "navigate"; route: string; label: string };
type Msg = { role: "user" | "assistant"; content: string; actions?: Action[]; error?: boolean };
type Resp = { reply: string; actions: Action[]; wiki_version: string };

type Chat = { id: string; title: string; updatedAt: string; msgs: Msg[] };

const MAX_CHATS = 20;
const MAX_MSGS = 40;

function storeKey(userId: string) { return `cc-chats-v1:${userId}`; }

function loadChats(userId: string): Chat[] {
  try { return JSON.parse(localStorage.getItem(storeKey(userId)) ?? "[]") as Chat[]; } catch { return []; }
}

function saveChats(userId: string, chats: Chat[]) {
  try { localStorage.setItem(storeKey(userId), JSON.stringify(chats.slice(0, MAX_CHATS))); } catch { /* storage full/blocked */ }
}

function newId() { return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`; }

export default function CCPanel({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { role, session } = useSession();
  const userId = session?.user?.id ?? "anon";
  // Resume the most recent chat, as before.
  const [chats, setChats] = useState<Chat[]>(() => loadChats(userId));
  const [chatId, setChatId] = useState<string>(() => chats[0]?.id ?? newId());
  const [msgs, setMsgs] = useState<Msg[]>(() => chats[0]?.msgs ?? []);
  const [showHistory, setShowHistory] = useState(false);
  const [draft, setDraft] = useState("");
  const [busy, setBusy] = useState(false);
  const location = useLocation();
  const navigate = useNavigate();
  const { activeClinicId } = useClinic();
  const listRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  // Save the open chat to the top of the history whenever it changes.
  useEffect(() => {
    if (!msgs.length) return;
    setChats((prev) => {
      const old = prev.find((c) => c.id === chatId);
      if (old && old.msgs === msgs) return prev; // just reopened from History: keep its place
      const title = old?.title ?? msgs.find((m) => m.role === "user")?.content.slice(0, 80) ?? "Chat";
      const next = [{ id: chatId, title, updatedAt: new Date().toISOString(), msgs: msgs.slice(-MAX_MSGS) },
        ...prev.filter((c) => c.id !== chatId)];
      saveChats(userId, next);
      return next;
    });
  }, [msgs, chatId, userId]);

  useEffect(() => {
    listRef.current?.scrollTo({ top: listRef.current.scrollHeight, behavior: "smooth" });
  }, [msgs, busy, showHistory]);

  function startNewChat() {
    setChatId(newId()); setMsgs([]); setShowHistory(false);
    inputRef.current?.focus();
  }

  function openChat(c: Chat) {
    setChatId(c.id); setMsgs(c.msgs); setShowHistory(false);
  }

  function deleteChat(id: string) {
    const next = chats.filter((c) => c.id !== id);
    setChats(next); saveChats(userId, next);
    if (id === chatId) { setChatId(newId()); setMsgs([]); }
  }

  useEffect(() => { if (open) inputRef.current?.focus(); }, [open]);

  const starters = roleAtLeast(role, "clinic_admin")
    ? ["What needs my attention today?", "How did my latest campaign do?", "Walk me through setting up my first campaign", "Report a problem"]
    : ["What needs my attention today?", "How did my latest campaign do?", "What does “needs human” mean?", "Report a problem"];

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
    if (e.key === "Escape") onClose();
  }

  if (!open) return null;

  return (
    <aside className="cc-panel" role="dialog" aria-label="CC assistant">
      <header className="cc-head">
        <img className="cc-mark" src="/website-192x192.png" alt="" width={32} height={32} />
        <div className="cc-head-text">
          <strong>CC</strong>
          <span>CareCall assistant</span>
        </div>
        {chats.length > 0 && (
          <button className="link cc-new" onClick={() => setShowHistory((v) => !v)} disabled={busy}
            aria-pressed={showHistory}>{showHistory ? "Back" : "History"}</button>
        )}
        {(msgs.length > 0 || showHistory) && (
          <button className="link cc-new" onClick={startNewChat} disabled={busy}>New chat</button>
        )}
        <button className="cc-close" onClick={onClose} aria-label="Close">×</button>
      </header>

      {showHistory ? (
        <div className="cc-list" ref={listRef}>
          <p className="cc-history-note">Saved in this browser only. Up to {MAX_CHATS} chats.</p>
          <ul className="cc-history">
            {chats.map((c) => (
              <li key={c.id} className={c.id === chatId ? "cc-history-current" : undefined}>
                <button className="cc-history-open" onClick={() => openChat(c)}>
                  <span className="cc-history-title">{c.title}</span>
                  <span className="cc-history-when">
                    {new Date(c.updatedAt).toLocaleString([], { dateStyle: "medium", timeStyle: "short" })}
                    {" · "}{c.msgs.length} messages
                  </span>
                </button>
                <button className="cc-history-del" onClick={() => deleteChat(c.id)}
                  aria-label={`Delete chat: ${c.title}`} title="Delete">×</button>
              </li>
            ))}
          </ul>
        </div>
      ) : (
      <div className="cc-list" ref={listRef} aria-live="polite">
        {msgs.length === 0 && (
          <div className="cc-empty">
            <p>Hi! I can explain how CareCall works, take you to the right screen, walk you through setup, and look at how your campaigns are doing. Something not working? Tell me and I'll file a bug report (no patient names or numbers, please).</p>
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
      )}

      <div className="cc-compose">
        <textarea
          ref={inputRef}
          rows={2}
          value={draft}
          placeholder="Ask CC anything about CareCall…"
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={onKey}
          disabled={busy}
          onFocus={() => setShowHistory(false)}
        />
        <button onClick={() => send(draft)} disabled={busy || !draft.trim()}>Send</button>
      </div>
      <p className="cc-foot">CC sees totals, not patient details. Double-check before acting.</p>
    </aside>
  );
}
