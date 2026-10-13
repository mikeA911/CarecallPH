// Telnyx webhook signature check.
// Run: deno test supabase/functions/_shared/telnyx_sig_test.ts
import { tokenMatches, verifyTelnyxSignature } from "./telnyx_sig.ts";

function eq(actual: unknown, expected: unknown, msg = "") {
  if (actual !== expected) throw new Error(`${msg}: expected ${expected}, got ${actual}`);
}
const toB64 = (b: ArrayBuffer) => btoa(String.fromCharCode(...new Uint8Array(b)));

Deno.test("Ed25519 signature over timestamp|body, with replay window", async () => {
  const pair = await crypto.subtle.generateKey({ name: "Ed25519" }, true, ["sign", "verify"]) as CryptoKeyPair;
  const publicKey = toB64(await crypto.subtle.exportKey("raw", pair.publicKey));
  const now = 1_790_000_000, timestamp = String(now - 10);
  const rawBody = JSON.stringify({ data: { event_type: "call.hangup", payload: { call_control_id: "abc" } } });
  const sign = async (msg: string) => toB64(await crypto.subtle.sign({ name: "Ed25519" }, pair.privateKey, new TextEncoder().encode(msg)));
  const signature = await sign(`${timestamp}|${rawBody}`);

  eq(await verifyTelnyxSignature({ rawBody, signature, timestamp, publicKey, now }), true, "valid");
  eq(await verifyTelnyxSignature({ rawBody: rawBody + " ", signature, timestamp, publicKey, now }), false, "body changed");
  eq(await verifyTelnyxSignature({ rawBody, signature, timestamp: String(now - 9), publicKey, now }), false, "timestamp changed");
  eq(await verifyTelnyxSignature({ rawBody, signature, timestamp, publicKey, now: now + 400 }), false, "too old");
  eq(await verifyTelnyxSignature({ rawBody, signature: null, timestamp, publicKey, now }), false, "no signature");
  eq(await verifyTelnyxSignature({ rawBody, signature: "!!", timestamp, publicKey, now }), false, "malformed signature");
  const other = await crypto.subtle.generateKey({ name: "Ed25519" }, true, ["sign", "verify"]) as CryptoKeyPair;
  eq(await verifyTelnyxSignature({ rawBody, signature, timestamp, publicKey: toB64(await crypto.subtle.exportKey("raw", other.publicKey)), now }), false, "wrong key");
  eq(await verifyTelnyxSignature({ rawBody, signature, timestamp, publicKey: "", now }), false, "no key configured");
});

Deno.test("URL token fallback", () => {
  eq(tokenMatches("s3cret-token", "s3cret-token"), true);
  eq(tokenMatches("s3cret-tokeX", "s3cret-token"), false);
  eq(tokenMatches(null, "s3cret-token"), false);
  eq(tokenMatches("", ""), false, "no token configured never matches");
});
