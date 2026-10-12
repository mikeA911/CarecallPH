// Care plans, slice M1: consent wording, due medicine doses, messages and
// reply parsing. Pure functions, used by care-plan, send-reminders and
// channel-webhook. Design: docs/care-plan-design.md
//
// DRAFT WORDING: the consent text and messages need doctor and legal review
// before patient use. Changing the consent text means a new version ID.

export const CONSENT_VERSION = "meds-v1-2026-10-15";

export function consentText(clinic: string): string {
  return (
    `${clinic} would like to send you reminders to take your medicines, at the times your doctor set. ` +
    `Your replies (taken or skipped) will be saved in your record at ${clinic}. ` +
    `Reply YES to start, or NO. You can stop any time by replying STOP REMINDERS. ` +
    `In an emergency, call 911.\n\n` +
    `Nais ng ${clinic} na magpadala sa iyo ng paalala sa pag-inom ng gamot, sa mga oras na itinakda ng ` +
    `iyong doktor. Ang iyong mga sagot ay itatabi sa iyong record sa ${clinic}. Sumagot ng OO para ` +
    `magsimula, o HINDI. Maaari kang tumigil anumang oras: sumagot ng STOP REMINDERS. ` +
    `Sa emergency, tumawag sa 911.`
  );
}

const norm = (t: string) => t.trim().toUpperCase().replace(/[^A-Z0-9 ]/g, "").replace(/\s+/g, " ").trim();

const CONSENT_YES = new Set(["YES", "Y", "OO", "OPO", "AGREE", "I AGREE", "SIGE", "PAYAG", "OK", "OKAY"]);
const CONSENT_NO = new Set(["NO", "N", "HINDI", "AYAW", "DECLINE", "HINDI PO"]);
export function parseConsentReply(text: string): "yes" | "no" | null {
  const t = norm(text);
  return CONSENT_YES.has(t) ? "yes" : CONSENT_NO.has(t) ? "no" : null;
}

const WITHDRAW = new Set(["STOP REMINDERS", "STOP REMINDER", "STOP MEDS", "STOP MEDICINE", "TIGIL PAALALA", "TIGIL GAMOT"]);
export function isWithdraw(text: string): boolean {
  return WITHDRAW.has(norm(text));
}

const TAKEN = new Set(["1", "TAKEN", "DONE", "YES", "Y", "OO", "OPO", "OK", "NAINOM", "NAINOM NA", "INUMIN NA"]);
const SKIPPED = new Set(["2", "SKIP", "SKIPPED", "NO", "HINDI", "HINDI NAINOM", "HINDI PA"]);
export function parseDoseReply(text: string): "taken" | "skipped" | null {
  const t = norm(text);
  return TAKEN.has(t) ? "taken" : SKIPPED.has(t) ? "skipped" : null;
}

// --- time helpers -----------------------------------------------------------

/** Minutes to add to UTC to get local time in `tz` at `at`. */
function offsetMinutes(at: Date, tz: string): number {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat("en-US", {
      timeZone: tz, hourCycle: "h23", year: "numeric", month: "2-digit", day: "2-digit",
      hour: "2-digit", minute: "2-digit", second: "2-digit",
    }).formatToParts(at).map((p) => [p.type, p.value]),
  );
  const asUtc = Date.UTC(+parts.year, +parts.month - 1, +parts.day, +parts.hour, +parts.minute, +parts.second);
  return Math.round((asUtc - at.getTime()) / 60000);
}

/** "2026-10-15" + "08:00" in `tz` → the UTC instant. */
export function localToUtc(date: string, time: string, tz: string): Date {
  const [y, m, d] = date.split("-").map(Number);
  const [hh, mm] = time.split(":").map(Number);
  const guess = Date.UTC(y, m - 1, d, hh, mm);
  const first = guess - offsetMinutes(new Date(guess), tz) * 60000;
  return new Date(guess - offsetMinutes(new Date(first), tz) * 60000);
}

export const localDate = (at: Date, tz: string) => at.toLocaleDateString("en-CA", { timeZone: tz });

export type Med = {
  id: string; patient_id: string; name: string; dose: string | null; instructions: string | null;
  times_of_day: string[]; start_date: string; end_date: string | null; discreet: boolean;
};

/** A reminder is sent in the 30 minutes after its time (the job runs every 5 minutes). */
export const SEND_WINDOW_MS = 30 * 60_000;
/** No answer this long after the time: missed. */
export const MISSED_AFTER_MS = 2 * 60 * 60_000;

/** Doses due now (not yet sent), for today's date in the clinic's timezone. */
export function dueDoses(now: Date, meds: Med[], tz: string, alreadySent: Set<string>): { med: Med; dueAt: Date }[] {
  const today = localDate(now, tz);
  const out: { med: Med; dueAt: Date }[] = [];
  for (const m of meds) {
    if (today < m.start_date || (m.end_date && today > m.end_date)) continue;
    for (const t of m.times_of_day) {
      const dueAt = localToUtc(today, t.slice(0, 5), tz);
      const late = now.getTime() - dueAt.getTime();
      if (late < 0 || late >= SEND_WINDOW_MS) continue;
      if (alreadySent.has(`${m.id}|${dueAt.toISOString()}`)) continue;
      out.push({ med: m, dueAt });
    }
  }
  return out;
}

/** One message for all of a patient's medicines due at the same time. */
export function doseText(meds: Med[], dueAt: Date, tz: string): string {
  const time = dueAt.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit", timeZone: tz });
  const discreet = meds.some((m) => m.discreet);
  const ask = meds.length > 1
    ? "Reply 1 when you've taken them, 2 if you skipped them."
    : "Reply 1 when taken, 2 if you skipped it.";
  const fil = "Sumagot ng 1 kapag nainom na, 2 kung hindi.";
  if (discreet) return `💊 Time for your ${time} medicine${meds.length > 1 ? "s" : ""}.\n${ask}\n\n${fil}`;
  const lines = meds.map((m) =>
    `• ${m.name}${m.dose ? `, ${m.dose}` : ""}${m.instructions ? ` (${m.instructions})` : ""}`);
  return `💊 ${time}: time for your medicine${meds.length > 1 ? "s" : ""}.\n${lines.join("\n")}\n${ask}\n\n${fil}`;
}
