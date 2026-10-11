// Philippine phone numbers: parse what clinic staff type, store E.164.
//
// Kept identical to web/src/lib/phone.ts (the portal and the edge functions
// are separate TypeScript projects). Change both together.
//
// Mobile:   09XX XXX XXXX · 9XX XXX XXXX · +63 9XX XXX XXXX  → +639XXXXXXXXX
// Landline: 02 8XXX XXXX (Metro Manila) · 0AA XXX XXXX (e.g. 032 Cebu)
//           → +632XXXXXXXX / +63AAXXXXXXX   (only with allowLandline)

export type PhoneResult = { ok: true; e164: string } | { ok: false; error: string };

const MOBILE_HINT = "Use a PH mobile number like 0917 123 4567, 917 123 4567 or +63 917 123 4567.";
const ANY_HINT = "Use a PH mobile (0917 123 4567) or a landline with area code (02 8123 4567, 032 123 4567).";

export function normalizePhPhone(raw: string, opts: { allowLandline?: boolean } = {}): PhoneResult {
  const hint = opts.allowLandline ? ANY_HINT : MOBILE_HINT;
  const s = (raw ?? "").trim().replace(/[\s\-().]/g, "");
  if (!s) return { ok: false, error: "Phone number is required." };
  if (!/^\+?\d+$/.test(s)) return { ok: false, error: `Invalid phone number "${raw.trim()}". ${hint}` };
  if (s.startsWith("+") && !s.startsWith("+63")) {
    return { ok: false, error: `Only Philippine (+63) numbers are supported. ${hint}` };
  }

  // National significant number: drop +63 / 63 / leading 0.
  let nsn: string | null = null;
  const d = s.replace(/^\+/, "");
  if (s.startsWith("+") || (d.startsWith("63") && d.length >= 11)) nsn = d.slice(2);
  else if (d.startsWith("0")) nsn = d.slice(1);
  else if (/^9\d{9}$/.test(d)) nsn = d; // mobile without the leading 0

  if (nsn && /^9\d{9}$/.test(nsn)) return { ok: true, e164: `+63${nsn}` };
  if (nsn && opts.allowLandline && /^[2-8]\d{8}$/.test(nsn)) return { ok: true, e164: `+63${nsn}` };
  return { ok: false, error: `Invalid phone number "${raw.trim()}". ${hint}` };
}

/** "+639171234567" → ["0917","123","4567"]; "+63281234567" → ["02","8123","4567"]. */
export function phLocalGroups(e164: string): string[] | null {
  const m = /^\+63(\d{9,10})$/.exec(e164);
  if (!m) return null;
  const local = "0" + m[1];
  if (local.length === 11) return [local.slice(0, 4), local.slice(4, 7), local.slice(7)]; // mobile
  if (local.startsWith("02")) return [local.slice(0, 2), local.slice(2, 6), local.slice(6)]; // Metro Manila
  return [local.slice(0, 3), local.slice(3, 6), local.slice(6)]; // provincial area code
}
