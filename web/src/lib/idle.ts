// Sign out after 20 minutes without activity (mouse, keyboard, touch,
// scrolling) in any portal tab, with a warning 2 minutes before. The last
// activity time is shared by all tabs in localStorage, so working in one tab
// keeps the others signed in. A computer that slept past the limit signs out
// as soon as it wakes, before any new activity counts.
import { useEffect, useRef, useState } from "react";

export const IDLE_LIMIT_MS = 20 * 60_000;
export const IDLE_WARN_MS = 18 * 60_000;
const LAST_KEY = "carecall-last-activity";
const CHECK_EVERY_MS = 10_000;
const WRITE_EVERY_MS = 5_000;

function readLast(): number {
  try { return Number(localStorage.getItem(LAST_KEY)) || 0; } catch { return 0; }
}
export function markActive(now = Date.now()) {
  try { localStorage.setItem(LAST_KEY, String(now)); } catch { /* storage blocked */ }
}

/** True when the last activity is older than the limit. */
export function isIdle(now: number, last: number): boolean {
  return last > 0 && now - last >= IDLE_LIMIT_MS;
}

/**
 * While `active` (signed in), calls `onIdle` once after the limit and returns
 * `warning` (true in the last 2 minutes) and `stay` (counts as activity).
 */
export function useIdleSignOut(active: boolean, onIdle: () => void) {
  const [warning, setWarning] = useState(false);
  const fired = useRef(false);
  const onIdleRef = useRef(onIdle);
  onIdleRef.current = onIdle;

  useEffect(() => {
    if (!active) { setWarning(false); fired.current = false; return; }
    let lastWrite = 0;

    const check = () => {
      const now = Date.now();
      const last = readLast();
      if (isIdle(now, last)) {
        if (!fired.current) { fired.current = true; setWarning(false); onIdleRef.current(); }
        return true;
      }
      setWarning(last > 0 && now - last >= IDLE_WARN_MS);
      return false;
    };
    const activity = () => {
      // Check first: activity after the limit (e.g. waking the computer) doesn't count.
      if (check()) return;
      const now = Date.now();
      if (now - lastWrite < WRITE_EVERY_MS) return;
      lastWrite = now;
      markActive(now);
      setWarning(false);
    };

    if (!readLast()) markActive();
    check();
    // Not "scroll": the page scrolls itself (focus, layout); wheel and keys cover the user.
    const events = ["pointerdown", "pointermove", "keydown", "wheel", "touchstart"] as const;
    events.forEach((e) => window.addEventListener(e, activity, { passive: true, capture: true }));
    const onVisible = () => { if (document.visibilityState === "visible") check(); };
    document.addEventListener("visibilitychange", onVisible);
    const timer = setInterval(check, CHECK_EVERY_MS);
    return () => {
      events.forEach((e) => window.removeEventListener(e, activity, { capture: true }));
      document.removeEventListener("visibilitychange", onVisible);
      clearInterval(timer);
    };
  }, [active]);

  return { warning, stay: () => { markActive(); setWarning(false); } };
}
