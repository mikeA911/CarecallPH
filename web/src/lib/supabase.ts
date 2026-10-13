import { createClient } from "@supabase/supabase-js";
import { tabSessionStorage } from "./tabSession";

const url = import.meta.env.VITE_SUPABASE_URL;
const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY;

if (!url || !anonKey) {
  // Vite inlines VITE_* vars at BUILD time. If this fires in production, the
  // vars were missing during the Vercel build — set VITE_SUPABASE_URL and
  // VITE_SUPABASE_ANON_KEY in the project's Environment Variables and redeploy.
  throw new Error(
    "Missing Supabase config: set VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY " +
      "(exact names, VITE_ prefix required) and rebuild. " +
      "NEXT_PUBLIC_* names are ignored by Vite.",
  );
}

// Signed out when the browser closes: the session lives only in open tabs
// (tabSession.ts). Inactivity sign-out is in idle.ts.
export const supabase = createClient(url, anonKey, {
  auth: { storage: tabSessionStorage },
});
