// Vital signs by chat (care plans M3): measures, reading parser, limits,
// due requests and the chat messages. Pure functions, used by
// send-reminders, channel-webhook and care-plan. Design:
// docs/care-plan-design.md §3, §4, §4a.
//
// DRAFT: default limits, how-to text and message wording need doctor review
// before patient use. CareCall only compares numbers with the doctor's limits;
// it never explains what a reading means.
import { localDate, localToUtc } from "./care.ts";

export type Measure = "bp" | "glucose" | "temperature" | "weight" | "spo2";
export const MEASURES: Measure[] = ["bp", "glucose", "temperature", "weight", "spo2"];

export type Limits = {
  target_low?: number | null; target_high?: number | null; target_low2?: number | null; target_high2?: number | null;
  critical_low?: number | null; critical_high?: number | null; critical_low2?: number | null; critical_high2?: number | null;
};

type MeasureInfo = {
  label: string; fil: string; unit: string; example: string;
  /** Plausible range (BP: systolic, diastolic). Outside → "didn't get that". */
  range: [number, number]; range2?: [number, number];
  /** Defaults for the doctor to confirm (design §4a). Critical: at or beyond. Target: beyond. */
  defaults: Limits;
  howTo: string; howToFil: string;
};

export const MEASURE_INFO: Record<Measure, MeasureInfo> = {
  bp: {
    label: "blood pressure", fil: "presyon", unit: "mmHg", example: "120/80", range: [60, 260], range2: [30, 160],
    defaults: { target_high: 140, target_high2: 90, critical_high: 180, critical_high2: 120, critical_low: 89, critical_low2: 59 },
    howTo: "Sit quietly for 5 minutes, feet flat, back supported, arm resting at heart level. No coffee, cigarettes or " +
      "exercise for 30 minutes before. Send the numbers like 120/80 (add your pulse if the machine shows it: 120/80 72).",
    howToFil: "Umupo nang tahimik nang 5 minuto, nakasandal, nakapatong ang braso sa antas ng puso. Walang kape, sigarilyo " +
      "o ehersisyo 30 minuto bago. Ipadala ang numero, halimbawa 120/80.",
  },
  glucose: {
    label: "blood sugar", fil: "asukal sa dugo", unit: "mg/dL", example: "110", range: [20, 600],
    defaults: { critical_low: 69, critical_high: 301 },
    howTo: "Wash and dry your hands, use a new lancet, and follow your meter's instructions. Send the number in mg/dL, like 110.",
    howToFil: "Maghugas at magpatuyo ng kamay, gumamit ng bagong lancet, at sundin ang instructions ng meter. Ipadala ang numero (mg/dL), halimbawa 110.",
  },
  temperature: {
    label: "temperature", fil: "temperatura", unit: "°C", example: "37.2", range: [34, 43],
    defaults: { target_high: 37.9, critical_high: 39.5 },
    howTo: "Use a thermometer under the tongue or the armpit for the time its instructions say. Send it in °C, like 37.2.",
    howToFil: "Gumamit ng thermometer sa ilalim ng dila o sa kilikili. Ipadala sa °C, halimbawa 37.2.",
  },
  weight: {
    label: "weight", fil: "timbang", unit: "kg", example: "68.5", range: [2, 300],
    defaults: {},
    howTo: "Weigh yourself in the morning after using the toilet and before eating, in light clothes, on the same scale. " +
      "Send it in kg, like 68.5.",
    howToFil: "Magtimbang sa umaga pagkatapos mag-CR at bago kumain, sa parehong timbangan. Ipadala sa kg, halimbawa 68.5.",
  },
  spo2: {
    label: "oxygen level", fil: "oxygen", unit: "%", example: "97", range: [50, 100],
    defaults: { target_low: 94, critical_low: 89 },
    howTo: "Rest for a few minutes, warm hands, no nail polish on that finger. Wait until the number is steady, then send it, like 97.",
    howToFil: "Magpahinga nang ilang minuto, mainit ang kamay, walang nail polish. Hintaying tumigil ang numero, at ipadala, halimbawa 97.",
  },
};

export type Reading = { value1: number; value2?: number | null; pulse?: number | null };
export type Flag = "ok" | "out_of_range" | "critical";

const inRange = (v: number, [lo, hi]: [number, number]) => v >= lo && v <= hi;
const num = (s: string) => Number(s.replace(",", "."));

/** Read a reply as a reading of `measure`; null if it isn't one or isn't plausible. */
export function parseReading(measure: Measure, text: string): Reading | null {
  const t = text.trim().toLowerCase();
  const info = MEASURE_INFO[measure];
  if (measure === "bp") {
    const m = t.match(/(\d{2,3})\s*(?:\/|\\|over|-|x)\s*(\d{2,3})(?:\D+(\d{2,3}))?/);
    if (!m) return null;
    const sys = Number(m[1]), dia = Number(m[2]);
    const pulse = m[3] ? Number(m[3]) : null;
    if (!inRange(sys, info.range) || !inRange(dia, info.range2!) || dia >= sys) return null;
    return { value1: sys, value2: dia, pulse: pulse != null && pulse >= 30 && pulse <= 220 ? pulse : null };
  }
  const m = t.match(/(\d{1,3}(?:[.,]\d{1,2})?)/);
  if (!m) return null;
  let v = num(m[1]);
  if (measure === "glucose" && /mmol/.test(t)) v = Math.round(v * 18);           // mmol/L → mg/dL
  if (measure === "temperature" && v >= 93 && v <= 110) v = Math.round(((v - 32) / 1.8) * 10) / 10; // °F → °C
  if (measure === "weight" && /\b(lb|lbs|pounds?)\b/.test(t)) v = Math.round((v / 2.2046) * 10) / 10;
  if (!inRange(v, info.range)) return null;
  return { value1: v };
}

/** Which measure a message looks like when no request is open (only BP is unmistakable). */
export function looksLikeReading(text: string): Measure | null {
  return /\b\d{2,3}\s*(?:\/|\\)\s*\d{2,3}\b/.test(text) ? "bp" : null;
}

/** The doctor's limits decide: critical at or beyond critical, out of range beyond target. Same rules as SQL vital_flag(). */
export function classify(measure: Measure, r: Reading, l: Limits): Flag {
  const v2 = r.value2 ?? null;
  const at = (v: number | null, lim: number | null | undefined, dir: "hi" | "lo") =>
    v != null && lim != null && (dir === "hi" ? v >= lim : v <= lim);
  const beyond = (v: number | null, lim: number | null | undefined, dir: "hi" | "lo") =>
    v != null && lim != null && (dir === "hi" ? v > lim : v < lim);
  const bp = measure === "bp";
  if (at(r.value1, l.critical_high, "hi") || at(r.value1, l.critical_low, "lo") ||
    (bp && (at(v2, l.critical_high2, "hi") || at(v2, l.critical_low2, "lo")))) return "critical";
  if (beyond(r.value1, l.target_high, "hi") || beyond(r.value1, l.target_low, "lo") ||
    (bp && (beyond(v2, l.target_high2, "hi") || beyond(v2, l.target_low2, "lo")))) return "out_of_range";
  return "ok";
}

/** Which side of the limits a flagged reading is on. */
export function direction(measure: Measure, r: Reading, l: Limits): "high" | "low" {
  const low = (l.critical_low != null && r.value1 <= l.critical_low) || (l.target_low != null && r.value1 < l.target_low) ||
    (measure === "bp" && r.value2 != null && ((l.critical_low2 != null && r.value2 <= l.critical_low2) ||
      (l.target_low2 != null && r.value2 < l.target_low2)));
  return low ? "low" : "high";
}

export function formatReading(measure: Measure, r: Reading): string {
  if (measure === "bp") return `${r.value1}/${r.value2}${r.pulse ? `, pulse ${r.pulse}` : ""}`;
  return withUnit(measure, r.value1);
}

const withUnit = (measure: Measure, v: number) => {
  const u = MEASURE_INFO[measure].unit;
  return u === "%" ? `${v}%` : u.startsWith("°") ? `${v}${u}` : `${v} ${u}`;
};

/** "below 140/90", "70 to 180 mg/dL", "94% or above". */
export function targetText(measure: Measure, l: Limits): string {
  if (measure === "bp") {
    if (l.target_high != null && l.target_high2 != null) return `below ${l.target_high}/${l.target_high2}`;
    return "as your doctor tells you";
  }
  if (l.target_low != null && l.target_high != null) return `${l.target_low} to ${withUnit(measure, l.target_high)}`;
  if (l.target_high != null) return `${withUnit(measure, l.target_high)} or below`;
  if (l.target_low != null) return `${withUnit(measure, l.target_low)} or above`;
  return "as your doctor tells you";
}

export type VitalItem = Limits & {
  id: string; patient_id: string; measure: Measure; reason?: string | null; how_to?: string | null;
  times_of_day: string[]; days_of_week?: number[] | null; start_date: string; until_date?: string | null;
  if_high?: string | null; if_low?: string | null;
};

export const REQUEST_WINDOW_MS = 30 * 60_000;   // sent in the 30 minutes after its time
export const REQUEST_OPEN_MS = 4 * 60 * 60_000;  // a reply counts for 4 hours, then missed

/** Requests due now (not yet sent), for today's date in the clinic's timezone. */
export function dueVitalRequests(now: Date, items: VitalItem[], tz: string, alreadySent: Set<string>):
  { item: VitalItem; dueAt: Date }[] {
  const today = localDate(now, tz);
  const weekday = new Date(`${today}T12:00:00Z`).getUTCDay();
  const out: { item: VitalItem; dueAt: Date }[] = [];
  for (const it of items) {
    if (today < it.start_date || (it.until_date && today > it.until_date)) continue;
    if (it.days_of_week?.length && !it.days_of_week.includes(weekday)) continue;
    for (const t of it.times_of_day) {
      const dueAt = localToUtc(today, t.slice(0, 5), tz);
      const late = now.getTime() - dueAt.getTime();
      if (late < 0 || late >= REQUEST_WINDOW_MS) continue;
      if (alreadySent.has(`${it.id}|${dueAt.toISOString()}`)) continue;
      out.push({ item: it, dueAt });
    }
  }
  return out;
}

// --- messages ----------------------------------------------------------------

export const VITALS_CONSENT_VERSION = "vitals-v1-2026-10-13";

export function vitalsConsentText(clinic: string, doctor: string | null, measures: Measure[]): string {
  const what = measures.length ? measures.map((m) => MEASURE_INFO[m].label).join(", ") : "your vital signs";
  const by = doctor ? `${doctor} at ${clinic}` : clinic;
  return (
    `${by} would like you to send your ${what} by chat, at the times your doctor set. ` +
    `Your readings will be saved in your record at ${clinic}. The clinic reviews readings during office hours, ` +
    `not 24 hours a day. In an emergency, call 911. Reply YES to start, or NO. ` +
    `You can stop any time by replying STOP REMINDERS.\n\n` +
    `Nais ng ${by} na ipadala mo ang iyong ${measures.map((m) => MEASURE_INFO[m].fil).join(", ") || "vital signs"} ` +
    `sa chat, sa mga oras na itinakda ng doktor. Itatabi ang iyong mga reading sa record mo sa ${clinic}. ` +
    `Tinitingnan ng clinic ang mga reading sa oras ng opisina, hindi 24 oras. Sa emergency, tumawag sa 911. ` +
    `Sumagot ng OO para magsimula, o HINDI. Maaari kang tumigil: sumagot ng STOP REMINDERS.`
  );
}

/** The patient's instruction sheet, sent when the doctor signs the plan. */
export function planMessage(items: VitalItem[], o: { doctor: string; clinic: string; tz: string }): string {
  const time12 = (t: string) => {
    const [h, m] = t.slice(0, 5).split(":").map(Number);
    return `${((h + 11) % 12) + 1}:${String(m).padStart(2, "0")} ${h < 12 ? "AM" : "PM"}`;
  };
  const DAY = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
  const blocks = items.map((it) => {
    const info = MEASURE_INFO[it.measure];
    const days = it.days_of_week?.length ? it.days_of_week.map((d) => DAY[d]).join(", ") : "every day";
    const until = it.until_date ? ` until ${new Date(`${it.until_date}T00:00:00Z`).toLocaleDateString("en-US", { month: "long", day: "numeric", timeZone: "UTC" })}` : "";
    const lines = [
      `🩺 ${info.label[0].toUpperCase()}${info.label.slice(1)}`,
      it.reason ? `Why: ${it.reason}` : null,
      `When: ${days} at ${it.times_of_day.map(time12).join(" and ")}${until}. We'll message you at these times.`,
      `How: ${it.how_to || info.howTo}`,
      `Your target: ${targetText(it.measure, it)}.`,
      it.if_high ? `If it's high: ${it.if_high}` : null,
      it.if_low ? `If it's low: ${it.if_low}` : null,
    ];
    return lines.filter(Boolean).join("\n");
  });
  return `Your monitoring plan from ${o.doctor} (${o.clinic}):\n\n${blocks.join("\n\n")}\n\n` +
    `${o.clinic} reviews readings during office hours, not 24 hours a day. ` +
    `If you have chest pain, trouble breathing, weakness on one side, confusion or a severe headache, call 911 now.`;
}

export function requestText(items: VitalItem[], doctor: string | null): string {
  const plan = doctor ? ` (see your plan from ${doctor})` : "";
  if (items.length === 1) {
    const info = MEASURE_INFO[items[0].measure];
    return `🩺 Time for your ${info.label} check${plan}. Reply with the number, like ${info.example}.\n\n` +
      `Oras na para sa iyong ${info.fil}. Ipadala ang numero, halimbawa ${info.example}.`;
  }
  return `🩺 Time for your checks${plan}. Send each one as its own message:\n` +
    items.map((it) => `• ${MEASURE_INFO[it.measure].label}, like ${MEASURE_INFO[it.measure].example}`).join("\n") +
    `\n\nIpadala ang bawat isa nang hiwalay.`;
}

/** The reply to a reading: thanks, above target with the doctor's plan, or critical with 911 first. */
export function readingReply(flag: Flag, measure: Measure, r: Reading, item: VitalItem,
  o: { doctor: string | null; clinic: string; clinicPhone: string | null }): string {
  const saved = formatReading(measure, r);
  if (flag === "ok") return `Thanks, saved: ${saved}. ✅`;
  const dir = direction(measure, r, item);
  const who = o.doctor ?? o.clinic;
  if (flag === "critical") {
    const call = o.clinicPhone ? `: ${o.clinicPhone}` : "";
    return `Saved: ${saved}. This is very ${dir}. If you have chest pain, trouble breathing, weakness on one side, ` +
      `confusion or a severe headache, call 911 now. Otherwise contact ${o.clinic} today${call}.\n\n` +
      `Tumawag sa 911 kung may pananakit ng dibdib, hirap huminga, panghihina ng isang bahagi ng katawan, ` +
      `pagkalito o matinding sakit ng ulo.`;
  }
  const action = dir === "high" ? item.if_high : item.if_low;
  return `Saved: ${saved}. That's ${dir === "high" ? "higher" : "lower"} than the target ${who} set (${targetText(measure, item)}). ` +
    (action ? `${who}'s plan says: ${action} ` : "") +
    `${o.clinic} will look at it during office hours.`;
}

export function notUnderstood(measure: Measure): string {
  const info = MEASURE_INFO[measure];
  return `Sorry, I didn't get that. Please send your ${info.label} like ${info.example}.`;
}
