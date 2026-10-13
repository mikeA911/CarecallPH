// Sign-in storage that lasts only while a portal tab is open.
//
// The Supabase session is kept in sessionStorage (cleared when the tab or
// window closes) instead of localStorage (kept forever). Open tabs share it
// over a BroadcastChannel: a new tab asks the others for the session, and
// token refreshes and sign-out reach every tab. When the last portal tab
// closes, nothing is left and the next visit starts at the login screen.
import type { SupportedStorage } from "@supabase/supabase-js";

const CHANNEL = "carecall-auth";
/** How long a new tab waits for an open tab to answer. */
const ASK_TIMEOUT_MS = 250;

type Msg =
  | { t: "ask"; key: string; id: string }
  | { t: "answer"; key: string; id: string; value: string }
  | { t: "set"; key: string; value: string }
  | { t: "remove"; key: string };

function ss(): Storage | null {
  try { return window.sessionStorage; } catch { return null; }
}

// Sessions saved by earlier versions in localStorage would outlive the browser.
try {
  for (const k of Object.keys(localStorage)) {
    if (k.startsWith("sb-") && k.includes("-auth-token")) localStorage.removeItem(k);
  }
} catch { /* storage blocked */ }

const channel: BroadcastChannel | null =
  typeof BroadcastChannel === "undefined" ? null : new BroadcastChannel(CHANNEL);
const waiting = new Map<string, (value: string) => void>();

channel?.addEventListener("message", (e: MessageEvent<Msg>) => {
  const m = e.data;
  const store = ss();
  if (m.t === "ask") {
    const value = store?.getItem(m.key);
    if (value != null) channel.postMessage({ t: "answer", key: m.key, id: m.id, value } satisfies Msg);
  } else if (m.t === "answer") {
    waiting.get(m.id)?.(m.value);
  } else if (m.t === "set") {
    store?.setItem(m.key, m.value);
  } else if (m.t === "remove") {
    store?.removeItem(m.key);
  }
});

function askOtherTabs(key: string): Promise<string | null> {
  if (!channel) return Promise.resolve(null);
  const id = crypto.randomUUID();
  return new Promise((resolve) => {
    const done = (value: string | null) => { waiting.delete(id); clearTimeout(timer); resolve(value); };
    const timer = setTimeout(() => done(null), ASK_TIMEOUT_MS);
    waiting.set(id, done);
    channel.postMessage({ t: "ask", key, id } satisfies Msg);
  });
}

export const tabSessionStorage: SupportedStorage = {
  async getItem(key) {
    const store = ss();
    const own = store?.getItem(key);
    if (own != null) return own;
    const shared = await askOtherTabs(key);
    if (shared != null) store?.setItem(key, shared);
    return shared;
  },
  setItem(key, value) {
    ss()?.setItem(key, value);
    channel?.postMessage({ t: "set", key, value } satisfies Msg);
  },
  removeItem(key) {
    ss()?.removeItem(key);
    channel?.postMessage({ t: "remove", key } satisfies Msg);
  },
};
