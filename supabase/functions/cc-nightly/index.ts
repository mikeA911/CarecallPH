// cc-nightly — CC's scheduled review of one clinic.
//
// Called by pg_cron (cc_nightly_review(), 02:00 Asia/Manila) with
//   POST { clinic_id }   Authorization: Bearer <service role key>
// Can also be run by hand for one clinic with the same request.
//
// Deploy: supabase functions deploy cc-nightly --no-verify-jwt
// (the function checks the service role key itself; this also works with the
// newer sb_secret_ keys, which are not JWTs).
//
// Runs with the SERVICE ROLE (no user), so RLS is bypassed: every tool in
// _shared/cc/tools.ts filters by ctx.clinicId explicitly. Tools available here
// are the chat tools minus navigate. The final model message is saved to
// cc_reviews as the summary shown on the CC action items page.

import { supabase as admin, json } from "../_shared/lib.ts";
import { WIKI_PAGES, WIKI_VERSION } from "../_shared/cc/wiki.generated.ts";
import { type Ctx, toolsFor, visiblePages } from "../_shared/cc/tools.ts";
import { CC_MODEL, ccConfigured, runConversation } from "../_shared/cc/claude.ts";

const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

Deno.serve(async (req) => {
  if (req.method !== "POST") return json({ error: "method not allowed" }, 405);
  const auth = req.headers.get("Authorization") ?? "";
  if (!SERVICE_KEY || auth !== `Bearer ${SERVICE_KEY}`) return json({ error: "unauthorized" }, 401);
  if (!ccConfigured()) return json({ error: "ANTHROPIC_API_KEY missing" }, 503);

  const body = await req.json().catch(() => ({}));
  const clinicId = String(body.clinic_id ?? "");
  if (!UUID.test(clinicId)) return json({ error: "clinic_id required" }, 400);

  const { data: clinic } = await admin.from("clinics")
    .select("id, name, active, cc_nightly_enabled").eq("id", clinicId).maybeSingle();
  if (!clinic || !clinic.active || !clinic.cc_nightly_enabled) {
    return json({ status: "skipped", reason: "clinic inactive or nightly review disabled" });
  }

  // Cheap pre-check: skip clinics with nothing to review (no model call).
  if (!(await hasActivity(clinicId))) {
    await admin.from("cc_reviews").insert({
      clinic_id: clinicId, status: "skipped", summary: "Nothing to review: no running campaigns and the Review queue is empty.",
      wiki_version: WIKI_VERSION,
    });
    return json({ status: "skipped" });
  }

  const ctx: Ctx = {
    db: admin, userId: null, role: "clinic_admin", clinicId,
    source: "nightly", actions: [], itemsCreated: 0,
  };

  try {
    const result = await runConversation(
      ctx,
      nightlyPrompt(clinic.name as string),
      [{ role: "user", content: "Run tonight's review." }],
      toolsFor("nightly"),
      2000,
    );
    await admin.from("cc_reviews").insert({
      clinic_id: clinicId, status: "ok", summary: result.text.slice(0, 4000),
      items_created: ctx.itemsCreated, tool_calls: result.toolCalls,
      input_tokens: result.inputTokens, output_tokens: result.outputTokens,
      model: CC_MODEL, wiki_version: WIKI_VERSION,
    });
    await admin.from("cc_usage").insert({
      user_id: null, clinic_id: clinicId, model: CC_MODEL,
      input_tokens: result.inputTokens, output_tokens: result.outputTokens,
      tool_calls: result.toolCalls, wiki_version: WIKI_VERSION,
    });
    return json({ status: "ok", items_created: ctx.itemsCreated });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error(`cc-nightly ${clinicId} failed`, msg);
    await admin.from("cc_reviews").insert({
      clinic_id: clinicId, status: "error", error: msg.slice(0, 1000),
      items_created: ctx.itemsCreated, model: CC_MODEL, wiki_version: WIKI_VERSION,
    });
    return json({ status: "error" }, 500);
  }
});

/** Anything worth a model call: running campaigns, or people waiting in the Review queue. */
async function hasActivity(clinicId: string): Promise<boolean> {
  const { count: running } = await admin.from("campaigns")
    .select("id", { count: "exact", head: true })
    .eq("clinic_id", clinicId).in("status", ["active", "paused", "scheduled"]);
  if ((running ?? 0) > 0) return true;
  const { count: waiting } = await admin.from("campaign_patients")
    .select("patient_id, campaigns!inner(clinic_id)", { count: "exact", head: true })
    .eq("campaigns.clinic_id", clinicId)
    .in("status", ["needs_human", "verification_failed"]);
  return (waiting ?? 0) > 0;
}

function nightlyPrompt(clinicName: string): string {
  const today = new Date().toLocaleDateString("en-PH", {
    weekday: "long", year: "numeric", month: "long", day: "numeric", timeZone: "Asia/Manila",
  });
  const index = visiblePages("clinic_admin").map((p) => `- ${p.id}: ${p.title}. ${p.summary}`).join("\n");
  const analytics = WIKI_PAGES.find((p) => p.id === "campaign-analytics")?.body ?? "";

  return `You are CC, the CareCall assistant, running the nightly review for the clinic "${clinicName}" on ${today} (Asia/Manila).
No user is present. Your final message is saved as the review summary that clinic staff read in the morning.

Steps
1. list_action_items (open) so you know what is already filed.
2. list_campaigns. Call campaign_report for every campaign that is active, paused or scheduled.
3. review_queue_summary.
4. File action items with create_action_item only for issues a person must act on:
   - at most 5 tonight, most important first;
   - never duplicate an open item about the same issue, even if you'd word it differently;
   - include the numbers and how many patients they rest on, one concrete next step, the screen (route) and the campaign_id;
   - don't draw conclusions from fewer than about 10 contacted patients unless something blocks bookings outright (no availability, nothing moving, Review queue waiting more than 24 hours).
5. Use read_wiki if you need exact screen names or settings.

Final message: 2-4 plain sentences. Overall state, what you filed (or that nothing needed filing), and one thing that went well if there is one. No headings, lists or markdown. No patient names (you don't have them).

Interpretation guide (wiki page campaign-analytics)
${analytics}

Wiki index
${index}`;
}
