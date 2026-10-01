// Shared CC tools — used by cc-chat (interactive, caller's JWT) and
// cc-nightly (scheduled, service role).
//
// SECURITY: interactive calls pass a client carrying the user's JWT, so RLS
// scopes every query. The nightly job uses the service role (RLS bypassed), so
// EVERY query here must also filter by ctx.clinicId explicitly. Keep it that way.
//
// Data tools return aggregates only — no names, phones or DOBs.

import type { SupabaseClient } from "npm:@supabase/supabase-js@2";
import { WIKI_PAGES, type WikiRole } from "./wiki.generated.ts";

export const RANK: Record<WikiRole, number> = { staff: 0, clinic_admin: 1, admin: 2 };

export type Action = { type: "navigate"; route: string; label: string };
export type Ctx = {
  db: SupabaseClient;
  userId: string | null;          // null for the nightly job
  role: WikiRole;
  clinicId: string | null;
  source: "chat" | "nightly";
  actions: Action[];
  itemsCreated: number;
};

export function visiblePages(role: WikiRole) {
  return WIKI_PAGES.filter((p) => RANK[p.roles] <= RANK[role]);
}

export const TOOLS = [
  {
    name: "read_wiki",
    description: "Open a CC wiki page by id. Returns its full text and the screens (routes) it covers.",
    input_schema: { type: "object", properties: { id: { type: "string" } }, required: ["id"] },
  },
  {
    name: "navigate",
    description: "Show the user a button that takes them to a portal screen. Use routes listed in wiki pages; replace :id with a real campaign or patient id from tool results.",
    input_schema: {
      type: "object",
      properties: {
        route: { type: "string", description: "e.g. /review or /campaigns/<uuid>" },
        label: { type: "string", description: "Button text, e.g. 'Open Review queue'" },
      },
      required: ["route", "label"],
    },
  },
  {
    name: "list_campaigns",
    description: "Campaigns in this clinic with headline numbers (total, in queue, booked, declined, unreached, needs human, booking rate).",
    input_schema: {
      type: "object",
      properties: { status: { type: "string", enum: ["draft", "scheduled", "active", "paused", "completed"] } },
    },
  },
  {
    name: "campaign_report",
    description: "Detailed aggregate analysis of one campaign: patient statuses, attempts, flag reasons, call results, calls by hour of day, voicemail share, message channels, booking-link funnel, bookings by source.",
    input_schema: { type: "object", properties: { campaign_id: { type: "string" } }, required: ["campaign_id"] },
  },
  {
    name: "review_queue_summary",
    description: "Aggregate view of the Review queue: counts by status, reason and campaign, and how long the oldest item has waited.",
    input_schema: { type: "object", properties: {} },
  },
  {
    name: "list_action_items",
    description: "CC action items for this clinic.",
    input_schema: { type: "object", properties: { status: { type: "string", enum: ["open", "done", "dismissed"] } } },
  },
  {
    name: "create_action_item",
    description: "File an action item for the clinic admin. One concrete next step per item.",
    input_schema: {
      type: "object",
      properties: {
        title: { type: "string", description: "Short imperative, e.g. 'Fix DOBs for 6 failed verifications'" },
        detail: { type: "string", description: "Numbers behind it and the next step" },
        category: { type: "string", enum: ["campaign", "review", "patients", "messaging", "settings", "other"] },
        severity: { type: "string", enum: ["info", "warning", "urgent"] },
        route: { type: "string", description: "Screen to act on it, e.g. /review" },
        campaign_id: { type: "string" },
      },
      required: ["title", "detail", "category", "severity"],
    },
  },
];

/** Tool set per caller: the nightly job has no UI, so no navigate. */
export function toolsFor(source: Ctx["source"]) {
  return source === "chat" ? TOOLS : TOOLS.filter((t) => t.name !== "navigate");
}

export const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** A route is allowed if it matches a wiki route pattern visible to this role. */
export function routeAllowed(route: string, role: WikiRole): boolean {
  for (const page of WIKI_PAGES) {
    for (const r of page.routes) {
      if (RANK[r.minRole] > RANK[role]) continue;
      const re = new RegExp("^" + r.path.replace(/:[a-z_]+/gi, "([^/]+)") + "$");
      const m = route.match(re);
      if (m && m.slice(1).every((seg) => UUID.test(seg))) return true;
    }
  }
  return false;
}

function count<T>(rows: T[], key: (r: T) => string | null | undefined): Record<string, number> {
  const out: Record<string, number> = {};
  for (const r of rows) {
    const k = key(r) ?? "unknown";
    out[k] = (out[k] ?? 0) + 1;
  }
  return out;
}

// deno-lint-ignore no-explicit-any
export async function runTool(ctx: Ctx, name: string, input: any): Promise<unknown> {
  const needClinic = () => ({ error: "No clinic selected. An admin must pick a clinic in the sidebar first." });

  switch (name) {
    case "read_wiki": {
      const page = visiblePages(ctx.role).find((p) => p.id === input.id);
      if (!page) return { error: `No wiki page "${input.id}" available to this user.` };
      return { id: page.id, title: page.title, updated: page.updated, routes: page.routes, body: page.body };
    }

    case "navigate": {
      if (ctx.source !== "chat") return { error: "navigate is only available in chat." };
      const route = String(input.route ?? "");
      if (!routeAllowed(route, ctx.role)) return { error: `Route ${route} is not available to this user.` };
      ctx.actions.push({ type: "navigate", route, label: String(input.label ?? "Open").slice(0, 40) });
      return { ok: true, note: "Button shown to the user below your reply." };
    }

    case "list_campaigns": {
      if (!ctx.clinicId) return needClinic();
      let q = ctx.db.from("campaign_stats").select("*").eq("clinic_id", ctx.clinicId);
      if (input.status) q = q.eq("status", input.status);
      const { data: stats, error } = await q;
      if (error) return { error: error.message };
      const ids = (stats ?? []).map((s: { campaign_id: string }) => s.campaign_id);
      const { data: meta } = ids.length
        ? await ctx.db.from("campaigns").select("id, appointment_type, created_at, scheduled_start").in("id", ids)
        : { data: [] };
      const byId = new Map((meta ?? []).map((m: Record<string, unknown>) => [m.id as string, m]));
      return (stats ?? [])
        .map((s: Record<string, unknown>): Record<string, unknown> => ({ ...s, ...(byId.get(s.campaign_id as string) ?? {}) }))
        .sort((a, b) => String(b.created_at ?? "").localeCompare(String(a.created_at ?? "")))
        .slice(0, 50);
    }

    case "campaign_report": {
      if (!ctx.clinicId) return needClinic();
      const id = String(input.campaign_id ?? "");
      if (!UUID.test(id)) return { error: "campaign_id must be a campaign uuid (use list_campaigns)." };
      const { data: camp } = await ctx.db.from("campaigns")
        .select("id, name, status, appointment_type, slot_length_minutes, created_at, scheduled_start")
        .eq("id", id).eq("clinic_id", ctx.clinicId).maybeSingle();
      if (!camp) return { error: "Campaign not found in this clinic." };

      const [stats, cps, calls, msgs, links, appts] = await Promise.all([
        ctx.db.from("campaign_stats").select("*").eq("campaign_id", id).maybeSingle(),
        ctx.db.from("campaign_patients").select("status, attempts, flag_reason").eq("campaign_id", id),
        ctx.db.from("call_logs").select("result, duration_seconds, amd_result, started_at, verified").eq("campaign_id", id),
        ctx.db.from("channel_messages").select("channel, direction, status").eq("campaign_id", id),
        ctx.db.from("booking_links").select("verified_at, booked_appointment_id, locked").eq("campaign_id", id),
        ctx.db.from("appointments").select("source, status").eq("campaign_id", id),
      ]);

      type Call = { result: string | null; duration_seconds: number | null; amd_result: string | null; started_at: string; verified: boolean };
      const callRows = (calls.data ?? []) as Call[];
      const durations = callRows.map((c) => c.duration_seconds ?? 0).filter((d) => d > 0);
      const hourOf = (iso: string) =>
        new Date(iso).toLocaleString("en-US", { hour: "numeric", hour12: false, timeZone: "Asia/Manila" });
      const byHour: Record<string, { calls: number; booked: number; unreached: number }> = {};
      for (const c of callRows) {
        const h = hourOf(c.started_at);
        byHour[h] ??= { calls: 0, booked: 0, unreached: 0 };
        byHour[h].calls++;
        if (c.result === "booked") byHour[h].booked++;
        if (c.result === "no_answer" || c.result === "voicemail") byHour[h].unreached++;
      }
      const cpRows = (cps.data ?? []) as { status: string; attempts: number; flag_reason: string | null }[];
      const linkRows = (links.data ?? []) as { verified_at: string | null; booked_appointment_id: string | null; locked: boolean }[];
      const msgRows = (msgs.data ?? []) as { channel: string; direction: string; status: string }[];

      return {
        campaign: camp,
        headline: stats.data,
        patient_status_counts: count(cpRows, (r) => r.status),
        attempts_distribution: count(cpRows, (r) => String(r.attempts ?? 0)),
        flag_reasons: count(cpRows.filter((r) => r.flag_reason), (r) => r.flag_reason),
        calls: {
          total: callRows.length,
          by_result: count(callRows, (r) => r.result),
          answered_by_machine: callRows.filter((c) => c.amd_result === "machine").length,
          identity_verified: callRows.filter((c) => c.verified).length,
          avg_duration_seconds: durations.length ? Math.round(durations.reduce((a, b) => a + b, 0) / durations.length) : null,
          by_hour_manila: byHour,
        },
        messages: {
          outbound_by_channel: count(msgRows.filter((m) => m.direction === "outbound"), (m) => `${m.channel}:${m.status}`),
          inbound_by_channel: count(msgRows.filter((m) => m.direction === "inbound"), (m) => m.channel),
        },
        booking_links: {
          sent: linkRows.length,
          verified: linkRows.filter((l) => l.verified_at).length,
          booked: linkRows.filter((l) => l.booked_appointment_id).length,
          locked: linkRows.filter((l) => l.locked).length,
        },
        appointments_by_source: count((appts.data ?? []) as { source: string }[], (a) => a.source),
      };
    }

    case "review_queue_summary": {
      if (!ctx.clinicId) return needClinic();
      const { data, error } = await ctx.db.from("campaign_patients")
        .select("status, flag_reason, updated_at, campaign_id, campaigns!inner(name, clinic_id)")
        .eq("campaigns.clinic_id", ctx.clinicId)
        .in("status", ["needs_human", "verification_failed"]);
      if (error) return { error: error.message };
      type R = { status: string; flag_reason: string | null; updated_at: string; campaigns: { name: string } };
      const rows = (data ?? []) as unknown as R[];
      const oldest = rows.reduce<string | null>((m, r) => (!m || r.updated_at < m ? r.updated_at : m), null);
      return {
        total: rows.length,
        by_status: count(rows, (r) => r.status),
        by_reason: count(rows, (r) => r.flag_reason),
        by_campaign: count(rows, (r) => r.campaigns?.name),
        oldest_waiting_hours: oldest ? Math.round((Date.now() - Date.parse(oldest)) / 36e5) : null,
      };
    }

    case "list_action_items": {
      if (!ctx.clinicId) return needClinic();
      const { data, error } = await ctx.db.from("cc_action_items")
        .select("id, title, detail, category, severity, route, status, campaign_id, created_at")
        .eq("clinic_id", ctx.clinicId).eq("status", input.status ?? "open")
        .order("created_at", { ascending: false }).limit(30);
      return error ? { error: error.message } : data;
    }

    case "create_action_item": {
      if (!ctx.clinicId) return needClinic();
      const title = String(input.title ?? "").trim().slice(0, 140);
      if (!title) return { error: "title required" };
      const route = input.route ? String(input.route) : null;
      if (route && !routeAllowed(route, "clinic_admin")) return { error: `Route ${route} is not a valid portal screen.` };
      const campaignId = input.campaign_id && UUID.test(String(input.campaign_id)) ? String(input.campaign_id) : null;

      const { data: dup } = await ctx.db.from("cc_action_items")
        .select("id").eq("clinic_id", ctx.clinicId).eq("status", "open").ilike("title", title).limit(1);
      if (dup?.length) return { ok: true, duplicate: true, id: (dup[0] as { id: string }).id, note: "An open item with this title already exists." };

      const { data, error } = await ctx.db.from("cc_action_items").insert({
        clinic_id: ctx.clinicId,
        campaign_id: campaignId,
        created_by: ctx.userId,
        title,
        detail: String(input.detail ?? "").slice(0, 2000),
        category: input.category,
        severity: input.severity,
        route,
        source: ctx.source,
      }).select("id").single();
      if (error) return { error: error.message };
      ctx.itemsCreated++;
      if (ctx.source === "chat") ctx.actions.push({ type: "navigate", route: "/cc", label: "View action items" });
      return { ok: true, id: (data as { id: string }).id };
    }

    default:
      return { error: `Unknown tool ${name}` };
  }
}

