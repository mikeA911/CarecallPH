// Appointment reminders (Phase 2c): when to send, what to say, how to read
// the reply. Pure functions, used by send-reminders and channel-webhook.

export type ReminderKind = "24h" | "2h";
export type ReminderResponse = "confirm" | "reschedule" | "cancel";

const HOUR = 60 * 60 * 1000;

/**
 * Which reminder is due now, if any.
 *   24h: between 24 and 4 hours before, for appointments booked 2+ hours ago
 *        (a same-day booking doesn't need a "tomorrow" reminder).
 *   2h:  between 2 hours and 30 minutes before, booked 30+ minutes ago.
 */
export function dueKind(
  now: Date, startsAt: Date, createdAt: Date, alreadySent: ReminderKind[],
): ReminderKind | null {
  const left = (startsAt.getTime() - now.getTime()) / HOUR;
  const age = (now.getTime() - createdAt.getTime()) / HOUR;
  if (left <= 2 && left > 0.5 && age >= 0.5 && !alreadySent.includes("2h")) return "2h";
  if (left <= 24 && left > 4 && age >= 2 && !alreadySent.includes("24h")) return "24h";
  return null;
}

/** Reminders only go out between 07:00 and 21:00 clinic time. */
export function inMessagingWindow(now: Date, tz: string): boolean {
  const hour = Number(new Intl.DateTimeFormat("en-US", { hour: "numeric", hourCycle: "h23", timeZone: tz }).format(now));
  return hour >= 7 && hour < 21;
}

export function whenText(startsAt: Date, now: Date, tz: string): { day: string; time: string; today: boolean } {
  const date = (d: Date) => d.toLocaleDateString("en-CA", { timeZone: tz });
  const tomorrow = new Date(now.getTime() + 24 * HOUR);
  const time = startsAt.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit", timeZone: tz });
  const long = startsAt.toLocaleDateString("en-US", { weekday: "long", month: "long", day: "numeric", timeZone: tz });
  if (date(startsAt) === date(now)) return { day: "today", time, today: true };
  if (date(startsAt) === date(tomorrow)) return { day: `tomorrow, ${long}`, time, today: false };
  return { day: long, time, today: false };
}

export function reminderText(kind: ReminderKind, o: {
  clinic: string; firstName?: string | null; doctor?: string | null; startsAt: Date; now: Date; tz: string;
  confirmed: boolean;
}): string {
  const w = whenText(o.startsAt, o.now, o.tz);
  const hi = o.firstName ? `${o.firstName}, ` : "";
  const withDoc = o.doctor ? ` with ${o.doctor}` : "";
  if (kind === "24h" && !o.confirmed) {
    return `Reminder from ${o.clinic}: ${hi}your appointment is ${w.day} at ${w.time}${withDoc}.\n` +
      `Reply 1 to confirm, 2 to change the time, 3 to cancel.\n\n` +
      `Paalala: sumagot ng 1 para kumpirmahin, 2 para magpalit ng oras, 3 para kanselahin.`;
  }
  return `See you soon at ${o.clinic}: ${hi}your appointment is ${w.day} at ${w.time}${withDoc}.\n` +
    `Reply 2 if you need to change the time, or 3 to cancel.\n\n` +
    `Sumagot ng 2 para magpalit ng oras, o 3 para kanselahin.`;
}

const CONFIRM = new Set(["1", "C", "CONFIRM", "CONFIRMED", "KUMPIRMA", "YES", "Y", "OK", "OKAY", "OO", "OPO", "SIGE"]);
const RESCHEDULE = new Set(["2", "R", "RESCHEDULE", "CHANGE", "CHANGE TIME", "PALIT", "PALIT ORAS", "IBANG ORAS"]);
const CANCEL = new Set(["3", "X", "CANCEL", "KANSELA", "KANSELAHIN", "HINDI MAKAKAPUNTA"]);

/** Read a reply to a reminder; null if it isn't one of the choices. */
export function parseReminderReply(text: string): ReminderResponse | null {
  const t = text.trim().toUpperCase().replace(/[^A-Z0-9 ]/g, "").replace(/\s+/g, " ").trim();
  if (CONFIRM.has(t)) return "confirm";
  if (RESCHEDULE.has(t)) return "reschedule";
  if (CANCEL.has(t)) return "cancel";
  return null;
}
