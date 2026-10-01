// cc-chat — CC, the CareCall in-portal assistant (interactive).
//
// POST { messages: [{role:"user"|"assistant", content:string}], route?, active_clinic_id? }
//   → { reply, actions: [{type:"navigate", route, label}], wiki_version }
//
// Deploy (JWT verification ON — only signed-in portal users):
//   deno run -A scripts/build-cc-wiki.ts
//   supabase functions deploy cc-chat
// Secrets: ANTHROPIC_API_KEY, optional CC_MODEL (default claude-sonnet-5-5)
//
// Design:
//   • Knowledge comes from the CC wiki (docs/cc-wiki → _shared/cc/wiki.generated.ts).
//     The page index is in the system prompt; CC opens pages with read_wiki.
//   • Tools live in _shared/cc/tools.ts (shared with cc-nightly). Here they run
//     with the CALLER's JWT, so Postgres RLS limits CC to the user's clinic.
//   • Data tools return AGGREGATES only: no names, phones or DOBs reach the model.
//   • CC acts in the UI only by returning navigate actions; it changes data only
//     by filing cc_action_items.

import { createClient } from "npm:@supabase/supabase-js@2";
import { supabase as admin, getCaller, corsHeaders } from "../_shared/lib.ts";
import { WIKI_PAGES, WIKI_VERSION, type WikiRole } from "../_shared/cc/wiki.generated.ts";
import { type Action, type Ctx, toolsFor, visiblePages } from "../_shared/cc/tools.ts";
import { CC_MODEL, ccConfigured, runConversation } from "../_shared/cc/claude.ts";

const MAX_HISTORY = 30;
const MAX_MSG_CHARS = 4000;

function reply(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json", ...corsHeaders() },
  });
}


// ---------------------------------------------------------------------------
// Entry
// ---------------------------------------------------------------------------
Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders() });
  if (req.method !== "POST") return reply({ error: "method not allowed" }, 405);
  if (!ccConfigured()) return reply({ error: "CC is not configured (ANTHROPIC_API_KEY missing)." }, 503);

  const caller = await getCaller(req);
  if (!caller || !caller.role) return reply({ error: "unauthorized" }, 401);
  const role = caller.role as WikiRole;

  const body = await req.json().catch(() => ({}));
  const history = sanitizeHistory(body.messages);
  if (!history) return reply({ error: "messages must end with a user message" }, 400);

  // Admins pick a clinic in the portal; everyone else is pinned to theirs.
  let clinicId = caller.clinicId;
  if (role === "admin" && typeof body.active_clinic_id === "string") clinicId = body.active_clinic_id;

  const db = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_ANON_KEY")!, {
    global: { headers: { Authorization: req.headers.get("Authorization")! } },
    auth: { persistSession: false },
  });

  let clinicName = "no clinic selected";
  if (clinicId) {
    const { data } = await db.from("clinics").select("name").eq("id", clinicId).maybeSingle();
    if (!data) clinicId = null; // not visible to this user
    else clinicName = (data as { name: string }).name;
  }

  const ctx: Ctx = { db, userId: caller.userId, role, clinicId, source: "chat", actions: [], itemsCreated: 0 };
  const system = systemPrompt(role, clinicName, typeof body.route === "string" ? body.route : "/");

  try {
    const result = await runConversation(ctx, system, history, toolsFor("chat"));
    await admin.from("cc_usage").insert({
      user_id: caller.userId, clinic_id: clinicId, model: CC_MODEL,
      input_tokens: result.inputTokens, output_tokens: result.outputTokens,
      tool_calls: result.toolCalls, wiki_version: WIKI_VERSION,
    });
    return reply({ reply: result.text, actions: dedupeActions(ctx.actions), wiki_version: WIKI_VERSION });
  } catch (e) {
    console.error("cc-chat failed", e);
    return reply({ error: "CC couldn't answer just now. Please try again." }, 502);
  }
});

function sanitizeHistory(raw: unknown): { role: "user" | "assistant"; content: string }[] | null {
  if (!Array.isArray(raw)) return null;
  const msgs = raw
    .filter((m) => m && (m.role === "user" || m.role === "assistant") && typeof m.content === "string" && m.content.trim())
    .map((m) => ({ role: m.role as "user" | "assistant", content: String(m.content).slice(0, MAX_MSG_CHARS) }))
    .slice(-MAX_HISTORY);
  while (msgs.length && msgs[0].role !== "user") msgs.shift();
  if (!msgs.length || msgs[msgs.length - 1].role !== "user") return null;
  return msgs;
}

function dedupeActions(a: Action[]): Action[] {
  const seen = new Set<string>();
  return a.filter((x) => (seen.has(x.route) ? false : (seen.add(x.route), true))).slice(0, 4);
}


// ---------------------------------------------------------------------------
// Prompt
// ---------------------------------------------------------------------------
function systemPrompt(role: WikiRole, clinicName: string, route: string): string {
  const today = new Date().toLocaleDateString("en-PH", {
    weekday: "long", year: "numeric", month: "long", day: "numeric", timeZone: "Asia/Manila",
  });
  const overview = WIKI_PAGES.find((p) => p.id === "overview")!;
  const index = visiblePages(role)
    .filter((p) => p.id !== "overview")
    .map((p) => `- ${p.id}: ${p.title}. ${p.summary}`)
    .join("\n");

  return `You are CC, the assistant inside the CareCall clinic portal.

Context
- Today: ${today} (Asia/Manila)
- User role: ${role}
- Clinic: ${clinicName}
- Screen the user is on: ${route}

How you work
- Your knowledge of CareCall comes ONLY from the CC wiki. The overview is below; open any other page with read_wiki before relying on it. If the wiki doesn't cover something, say so plainly. Never invent features, settings, buttons or numbers.
- Use the exact on-screen labels from the wiki. When directing someone to a screen, call navigate so they get a button.
- Guided setups (wiki pages starting with "wizard-"): go one step at a time, offer the navigate button for that step, then wait for the user before the next step.
- For results, use the data tools. State the numbers and how many patients they rest on; small samples are not conclusions. Use the campaign-analytics page's playbook to interpret.
- When something needs a person to act, offer to file an action item, or file it if the user asked you to. Check list_action_items first to avoid duplicates. Tell the user what you filed.
- You cannot change settings, start or pause campaigns, contact patients, or see individual patients. Say so and point to the right screen.
- No medical, legal or clinical advice. For privacy rules, refer to the compliance-ph page and suggest the clinic's Data Protection Officer.
- Reply in the user's language (English, Filipino/Taglish or Cebuano). Be brief: short paragraphs, plain text, simple "-" lists only when listing several items. No markdown headings or tables.

Wiki index (open with read_wiki)
${index}

Wiki page: overview
${overview.body}`;
}

