// Changing an appointment time by chat: which open times to offer, the offer
// message and its buttons, and reading the patient's pick. Pure functions,
// used by channel-webhook. Buttons appear on Telegram; other apps get the same
// choices as letters to reply with.
import type { ChatButton } from "./buttons.ts";

export type Slot = { start: string; end: string };

export const OFFER_LETTERS = ["A", "B", "C", "D", "E", "F"] as const;
/** A pick is accepted this long after the offer. */
export const OFFER_VALID_MS = 24 * 60 * 60_000;

const localDate = (iso: string, tz: string) => new Date(iso).toLocaleDateString("en-CA", { timeZone: tz });

/**
 * Up to `max` open times, at most `perDay` a day, over the first days that
 * have any (so the patient sees a spread, not six times on one morning).
 * Times are spaced at least an hour apart within a day.
 */
export function pickSlots(slots: Slot[], tz: string, max = 6, perDay = 2): Slot[] {
  const out: Slot[] = [];
  const byDay = new Map<string, Slot[]>();
  for (const s of [...slots].sort((a, b) => a.start.localeCompare(b.start))) {
    const day = localDate(s.start, tz);
    const list = byDay.get(day) ?? [];
    const last = list[list.length - 1];
    if (list.length >= perDay) continue;
    if (last && Date.parse(s.start) - Date.parse(last.start) < 60 * 60_000) continue;
    list.push(s);
    byDay.set(day, list);
  }
  for (const list of byDay.values()) {
    for (const s of list) if (out.length < max) out.push(s);
  }
  return out;
}

export function slotLabel(s: Slot, tz: string): string {
  const d = new Date(s.start);
  const day = d.toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric", timeZone: tz });
  const time = d.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit", timeZone: tz });
  return `${day}, ${time}`;
}

/** The offer: the times as lettered lines (all apps) plus one button per time. */
export function offerMessage(slots: Slot[], tz: string, clinic: string, current: string):
  { text: string; buttons: ChatButton[][] } {
  const lines = slots.map((s, i) => `${OFFER_LETTERS[i]}: ${slotLabel(s, tz)}`);
  const text = `Here are the next open times at ${clinic}. Your appointment ${current} stays booked until you pick one.\n` +
    `${lines.join("\n")}\n` +
    `Reply with a letter, OTHER if none of these suit you, or KEEP to keep your appointment.\n\n` +
    `Pumili ng oras: sumagot ng titik (A, B…), OTHER para sa ibang oras, o KEEP para hindi magbago.`;
  const buttons: ChatButton[][] = [
    ...slots.map((s, i) => [{ label: slotLabel(s, tz), reply: OFFER_LETTERS[i] }]),
    [{ label: "None of these", reply: "OTHER" }, { label: "Keep my appointment", reply: "KEEP" }],
  ];
  return { text, buttons };
}

export type Pick = { kind: "slot"; index: number } | { kind: "other" } | { kind: "keep" };

const OTHER = new Set(["OTHER", "OTHERS", "IBA", "IBANG ORAS", "NONE", "WALA"]);
const KEEP = new Set(["KEEP", "KEEP IT", "STAY", "HINDI NA", "OK NA", "SAME"]);

/** A reply to an offer, or null when the text isn't one. */
export function parsePick(text: string, offered: number): Pick | null {
  const t = text.trim().toUpperCase().replace(/[^A-Z ]/g, "").replace(/\s+/g, " ").trim();
  const i = (OFFER_LETTERS as readonly string[]).indexOf(t);
  if (i >= 0) return i < offered ? { kind: "slot", index: i } : null;
  if (OTHER.has(t)) return { kind: "other" };
  if (KEEP.has(t)) return { kind: "keep" };
  return null;
}
