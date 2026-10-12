// Checks the portal's build-time Supabase settings before anything uses them.
//
// Vite inlines VITE_* variables when the site is BUILT, so a missing or
// mistyped value in Vercel only shows up in the browser. Instead of the
// Supabase client's "Invalid supabaseUrl" crash (a blank page), main.tsx shows
// a setup page that names the variable and what's wrong with it.

export function supabaseConfigProblems(): string[] {
  const url = String(import.meta.env.VITE_SUPABASE_URL ?? "");
  const key = String(import.meta.env.VITE_SUPABASE_ANON_KEY ?? "");
  const problems: string[] = [];

  if (!url) {
    problems.push("VITE_SUPABASE_URL isn't set.");
  } else if (/["'\s]/.test(url)) {
    problems.push("VITE_SUPABASE_URL contains quotes or spaces. Enter the address on its own, e.g. https://abcd1234.supabase.co");
  } else if (!/^https:\/\/[^/]+$/.test(url.replace(/\/$/, ""))) {
    problems.push("VITE_SUPABASE_URL must be the project address only, starting with https://, e.g. https://abcd1234.supabase.co");
  }

  if (!key) {
    problems.push("VITE_SUPABASE_ANON_KEY isn't set.");
  } else if (/["'\s]/.test(key)) {
    problems.push("VITE_SUPABASE_ANON_KEY contains quotes or spaces. Paste the key on its own.");
  } else if (/^sb_secret_/.test(key) || /service_role/.test(atobSafe(key.split(".")[1] ?? ""))) {
    problems.push("VITE_SUPABASE_ANON_KEY is the secret service_role key. Use the anon (public) or publishable key instead, and rotate the secret key in Supabase since it was exposed in the site.");
  }
  return problems;
}

function atobSafe(s: string): string {
  try { return atob(s.replace(/-/g, "+").replace(/_/g, "/")); } catch { return ""; }
}
