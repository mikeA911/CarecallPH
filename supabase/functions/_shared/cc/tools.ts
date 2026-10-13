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
import { buildCareReport, type CareRows } from "./care_report.ts";

export const RANK: Record<WikiRole, number> = { staff: 0, clinic_admin: 1, admin: 2 };

export type Action = { type: "navigate"; route: string; label: string };
export type Ctx = {
  db: SupabaseClient;
  userId: string | null;          // null for the nightly job
  role: WikiRole;
  clinicId: string | null;
  /** Nurse or doctor (or the nightly job): may see care-plan reports and clinical action items. */
  clinical: boolean;
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
    name: "care_report",
    description: "Care plans for this clinic (nurses and doctors): medicine reminders (patients with reminders on, doses taken / skipped / missed, adherence now and in the previous period, patients by adherence band, patients with 3 missed in a row) and vital signs (running plans, drafts waiting for a doctor, requests and response rate, readings by measure and check, readings not yet reviewed, blood pressure trend: patients up / down / steady), and open alerts. Counts only.",
    input_schema: { type: "object", properties: { days: { type: "integer", enum: [7, 30], description: "Period, default 30" } } },
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
        clinical: { type: "boolean", description: "true for items about medicines, readings or care plans: shown to nurses and doctors only" },
      },
      required: ["title", "detail", "category", "severity"],
    },
  },
];

/** Tool set per caller: the nightly job has no UI, so no navigate; care_report for nurses and doctors. */
export function toolsFor(source: Ctx["source"], clinical = true) {
  return TOOLS.filter((t) => !(t.name === "navigate" && source !== "chat") && !(t.name === "care_report" && !clinical));
}

/**
 * An action item as CC sees it. Items about one patient have the name after
 * ": " in the title ("Wants a new time: Ana Cruz") and in the detail; CC gets
 * the kind of item only, never the name or the detail.
 */
export function redactItem<T extends { title: string; detail?: string | null; patient_id?: string | null }>(i: T) {
  if (!i.patient_id) return i;
  const kind = i.title.includes(": ") ? i.title.slice(0, i.title.lastIndexOf(": ")) : i.title;
  return { ...i, title: `${kind}: (a patient)`, detail: null, patient_id: undefined };
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
      let q = ctx.db.from("cc_action_items")
        .select("id, title, detail, category, severity, status, campaign_id, created_at, patient_id, clinical")
        .eq("clinic_id", ctx.clinicId).eq("status", input.status ?? "open");
      if (!ctx.clinical) q = q.eq("clinical", false);
      const { data, error } = await q.order("created_at", { ascending: false }).limit(30);
      if (error) return { error: error.message };
      type Row = { title: string; detail: string | null; patient_id: string | null; clinical?: boolean };
      return ((data ?? []) as Row[]).map((i) => { const { clinical: _c, ...rest } = redactItem(i); return rest; });
    }

    case "care_report": {
      if (!ctx.clinicId) return needClinic();
      if (!ctx.clinical) return { error: "Care plan reports are for nurses and doctors only." };
      const days = input.days === 7 ? 7 : 30;
      const now = new Date();
      // Previous period too (for comparison), and at least 14 days of readings for the BP trend.
      const since = new Date(now.getTime() - Math.max(2 * days, 14) * 24 * 3600_000).toISOString();
      const c = ctx.clinicId;
      const [consents, meds, doses, plans, requests, readings, alerts] = await Promise.all([
        ctx.db.from("care_consents").select("patient_id, scopes, consented_at, withdrawn_at").eq("clinic_id", c),
        ctx.db.from("medications").select("id, patient_id, active").eq("clinic_id", c),
        ctx.db.from("medication_doses").select("medication_id, patient_id, due_at, status").eq("clinic_id", c).gte("due_at", since),
        ctx.db.from("monitoring_plans").select("patient_id, status").eq("clinic_id", c).in("status", ["signed", "draft"]),
        ctx.db.from("vital_requests").select("patient_id, due_at, status").eq("clinic_id", c).gte("due_at", since),
        ctx.db.from("vital_readings").select("patient_id, measure, value1, taken_at, flag, reviewed_at").eq("clinic_id", c).gte("taken_at", since),
        ctx.db.from("care_alerts").select("kind").eq("clinic_id", c).is("cleared_at", null),
      ]);
      const failed = [consents, meds, doses, plans, requests, readings, alerts].find((x) => x.error);
      if (failed?.error) return { error: failed.error.message };
      // Older unreviewed readings count too.
      const { data: oldUnreviewed } = await ctx.db.from("vital_readings").select("patient_id, measure, value1, taken_at, flag, reviewed_at")
        .eq("clinic_id", c).lt("taken_at", since).neq("flag", "ok").is("reviewed_at", null).limit(500);
      return buildCareReport(now, days, {
        consents: consents.data ?? [], medications: meds.data ?? [], doses: doses.data ?? [], plans: plans.data ?? [],
        requests: requests.data ?? [], readings: [...(oldUnreviewed ?? []), ...(readings.data ?? [])], openAlerts: alerts.data ?? [],
      } as CareRows);
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
        clinical: ctx.clinical && input.clinical === true,
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

