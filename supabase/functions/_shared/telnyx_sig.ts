// Telnyx webhook signatures (API v2): Telnyx signs "<timestamp>|<raw body>"
// with Ed25519 and sends the signature (base64) in `telnyx-signature-ed25519`
// and the Unix timestamp in `telnyx-timestamp`. The public key (base64) is in
// the Telnyx portal (Account → Public Key): secret TELNYX_PUBLIC_KEY.

/** Events older or newer than this are refused (replay protection). */
export const SIGNATURE_TOLERANCE_S = 300;

const b64 = (s: string) => Uint8Array.from(atob(s.trim()), (c) => c.charCodeAt(0));

export async function verifyTelnyxSignature(o: {
  rawBody: string; signature: string | null; timestamp: string | null; publicKey: string; now?: number;
}): Promise<boolean> {
  if (!o.signature || !o.timestamp || !o.publicKey) return false;
  const ts = Number(o.timestamp);
  const now = o.now ?? Math.floor(Date.now() / 1000);
  if (!Number.isFinite(ts) || Math.abs(now - ts) > SIGNATURE_TOLERANCE_S) return false;
  try {
    const key = await crypto.subtle.importKey("raw", b64(o.publicKey), { name: "Ed25519" }, false, ["verify"]);
    return await crypto.subtle.verify({ name: "Ed25519" }, key, b64(o.signature),
      new TextEncoder().encode(`${o.timestamp}|${o.rawBody}`));
  } catch {
    return false;   // malformed key or signature
  }
}

/** Constant-time comparison for the fallback URL token. */
export function tokenMatches(given: string | null, expected: string): boolean {
  if (!given || !expected || given.length !== expected.length) return false;
  let diff = 0;
  for (let i = 0; i < given.length; i++) diff |= given.charCodeAt(i) ^ expected.charCodeAt(i);
  return diff === 0;
}
