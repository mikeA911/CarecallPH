// Recent page errors and failed requests, attached to a bug report filed
// through CC. Kept in memory only (last 15 of each) and sent with each CC
// message; cc-chat stores them only when a report is filed. Never request or
// response bodies: a failed request is its method, path (query string and
// ids removed), status and error code. Numbers and emails are scrubbed here
// and again on the server.
//
// Installed in main.tsx before the Supabase client is created, so its
// requests go through the fetch wrapper.

type Err = { at: string; message: string };
type Req = { at: string; method: string; path: string; status: number; code: string };

const MAX = 15;
const errors: Err[] = [];
const requests: Req[] = [];
let installed = false;

export function scrub(s: unknown, max = 300): string {
  return String(s ?? "")
    .replace(/[\w.+-]+@[\w-]+\.[\w.-]+/g, "[email]")
    .replace(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi, ":id")
    .replace(/\+?\d[\d\s-]{6,}\d/g, "[number]")
    .slice(0, max);
}

function push<T>(list: T[], item: T) {
  list.push(item);
  if (list.length > MAX) list.shift();
}
const now = () => new Date().toISOString();

function pathOf(input: RequestInfo | URL): string {
  try {
    const url = new URL(input instanceof Request ? input.url : String(input), window.location.origin);
    return scrub(url.pathname, 120);
  } catch {
    return "";
  }
}

export function installDiagnostics() {
  if (installed || typeof window === "undefined") return;
  installed = true;

  window.addEventListener("error", (e) => push(errors, { at: now(), message: scrub(e.message) }));
  window.addEventListener("unhandledrejection", (e) =>
    push(errors, { at: now(), message: scrub(e.reason instanceof Error ? e.reason.message : e.reason) }));
  const origError = console.error.bind(console);
  console.error = (...args: unknown[]) => {
    push(errors, { at: now(), message: scrub(args.map((a) => (a instanceof Error ? a.message : typeof a === "string" ? a : "")).join(" ")) });
    origError(...args);
  };

  const origFetch = window.fetch.bind(window);
  window.fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
    const method = (init?.method ?? (input instanceof Request ? input.method : "GET")).toUpperCase();
    try {
      const res = await origFetch(input, init);
      if (!res.ok) {
        let code = "";
        try {
          const j = await res.clone().json() as { code?: unknown; error?: unknown };
          code = scrub(typeof j.code === "string" ? j.code : typeof j.error === "string" ? j.error : "", 60);
        } catch { /* not JSON */ }
        push(requests, { at: now(), method, path: pathOf(input), status: res.status, code });
      }
      return res;
    } catch (e) {
      push(requests, { at: now(), method, path: pathOf(input), status: 0, code: "network error" });
      throw e;
    }
  };
}

export function diagnosticsSnapshot() {
  return {
    errors: [...errors],
    requests: [...requests],
    viewport: `${window.innerWidth}x${window.innerHeight}`,
    user_agent: navigator.userAgent.slice(0, 200),
  };
}
