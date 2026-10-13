// Vital signs (care plans M3): what the portal needs to show and edit a
// monitoring plan. Kept in step with supabase/functions/_shared/vitals.ts,
// which checks readings on the server. Design: docs/care-plan-design.md §4, §4a.
//
// DRAFT: default limits and how-to text need doctor review before patient use.

export type Measure = "bp" | "glucose" | "temperature" | "weight" | "spo2";
export const MEASURES: Measure[] = ["bp", "glucose", "temperature", "weight", "spo2"];
export type Flag = "ok" | "out_of_range" | "critical";

export type Limits = {
  target_low: number | null; target_high: number | null; target_low2: number | null; target_high2: number | null;
  critical_low: number | null; critical_high: number | null; critical_low2: number | null; critical_high2: number | null;
};
export const LIMIT_KEYS: (keyof Limits)[] = [
  "target_low", "target_high", "target_low2", "target_high2",
  "critical_low", "critical_high", "critical_low2", "critical_high2",
];

export type VitalPlan = Limits & {
  id?: string; measure: Measure; reason: string | null; how_to: string | null;
  times_of_day: string[]; days_of_week: number[] | null; start_date: string; until_date: string | null;
  if_high: string | null; if_low: string | null;
};

export const MEASURE_INFO: Record<Measure, {
  label: string; unit: string; step: number; defaults: Partial<Limits>; howTo: string; times: string[];
}> = {
  bp: {
    label: "Blood pressure", unit: "mmHg", step: 1,
    defaults: { target_high: 140, target_high2: 90, critical_high: 180, critical_high2: 120, critical_low: 89, critical_low2: 59 },
    howTo: "Sit quietly for 5 minutes, feet flat, back supported, arm resting at heart level. No coffee, cigarettes or " +
      "exercise for 30 minutes before. Send the numbers like 120/80 (add your pulse if the machine shows it: 120/80 72).",
    times: ["07:00", "19:00"],
  },
  glucose: {
    label: "Blood sugar", unit: "mg/dL", step: 1, defaults: { critical_low: 69, critical_high: 301 },
    howTo: "Wash and dry your hands, use a new lancet, and follow your meter's instructions. Send the number in mg/dL, like 110.",
    times: ["06:30"],
  },
  temperature: {
    label: "Temperature", unit: "°C", step: 0.1, defaults: { target_high: 37.9, critical_high: 39.5 },
    howTo: "Use a thermometer under the tongue or the armpit for the time its instructions say. Send it in °C, like 37.2.",
    times: ["08:00", "20:00"],
  },
  weight: {
    label: "Weight", unit: "kg", step: 0.1, defaults: {},
    howTo: "Weigh yourself in the morning after using the toilet and before eating, in light clothes, on the same scale. " +
      "Send it in kg, like 68.5.",
    times: ["07:00"],
  },
  spo2: {
    label: "Oxygen level (SpO₂)", unit: "%", step: 1, defaults: { target_low: 94, critical_low: 89 },
    howTo: "Rest for a few minutes, warm hands, no nail polish on that finger. Wait until the number is steady, then send it, like 97.",
    times: ["08:00"],
  },
};

export const DAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

export function newVitalPlan(measure: Measure): VitalPlan {
  const info = MEASURE_INFO[measure];
  const limits = Object.fromEntries(LIMIT_KEYS.map((k) => [k, info.defaults[k] ?? null])) as Limits;
  return {
    measure, reason: "", how_to: info.howTo, times_of_day: [...info.times], days_of_week: null,
    start_date: new Date().toLocaleDateString("en-CA"), until_date: null, if_high: "", if_low: "", ...limits,
  };
}

export function formatValue(measure: Measure, v1: number, v2: number | null, pulse?: number | null): string {
  const n = (x: number) => String(Number(x));
  const main = measure === "bp" ? `${n(v1)}/${n(v2 ?? 0)}` : n(v1);
  return `${main} ${MEASURE_INFO[measure].unit}${pulse ? `, pulse ${n(pulse)}` : ""}`;
}

/** Same rules as the server and the database: critical at or beyond, out of range strictly beyond. */
export function classify(measure: Measure, v1: number, v2: number | null, l: Partial<Limits>): Flag {
  const ge = (v: number | null | undefined, lim: number | null | undefined) => v != null && lim != null && v >= lim;
  const le = (v: number | null | undefined, lim: number | null | undefined) => v != null && lim != null && v <= lim;
  const gt = (v: number | null | undefined, lim: number | null | undefined) => v != null && lim != null && v > lim;
  const lt = (v: number | null | undefined, lim: number | null | undefined) => v != null && lim != null && v < lim;
  const bp = measure === "bp";
  if (ge(v1, l.critical_high) || le(v1, l.critical_low) || (bp && (ge(v2, l.critical_high2) || le(v2, l.critical_low2)))) return "critical";
  if (gt(v1, l.target_high) || lt(v1, l.target_low) || (bp && (gt(v2, l.target_high2) || lt(v2, l.target_low2)))) return "out_of_range";
  return "ok";
}

export const FLAG_LABEL: Record<Flag, string> = { ok: "In target", out_of_range: "Out of range", critical: "Critical" };

export function label12(t: string): string {
  const [h, m] = t.slice(0, 5).split(":").map(Number);
  return `${((h + 11) % 12) + 1}:${String(m).padStart(2, "0")} ${h < 12 ? "AM" : "PM"}`;
}

/** "Target below 140/90 · critical at 180/120 or above, 89/59 or below" */
export function limitsText(measure: Measure, l: Partial<Limits>): string {
  const pair = (a: number | null | undefined, b: number | null | undefined) =>
    measure === "bp" ? `${a ?? "–"}/${b ?? "–"}` : `${a}`;
  const unit = MEASURE_INFO[measure].unit;
  const parts: string[] = [];
  const tLo = l.target_low != null || (measure === "bp" && l.target_low2 != null);
  const tHi = l.target_high != null || (measure === "bp" && l.target_high2 != null);
  if (tLo && tHi) parts.push(`target ${pair(l.target_low, l.target_low2)} to ${pair(l.target_high, l.target_high2)} ${unit}`);
  else if (tHi) parts.push(`target at or below ${pair(l.target_high, l.target_high2)} ${unit}`);
  else if (tLo) parts.push(`target at or above ${pair(l.target_low, l.target_low2)} ${unit}`);
  const crit: string[] = [];
  if (l.critical_high != null || (measure === "bp" && l.critical_high2 != null)) crit.push(`${pair(l.critical_high, l.critical_high2)} or above`);
  if (l.critical_low != null || (measure === "bp" && l.critical_low2 != null)) crit.push(`${pair(l.critical_low, l.critical_low2)} or below`);
  if (crit.length) parts.push(`critical at ${crit.join(", ")}`);
  return parts.length ? parts.join(" · ") : "no limits set: readings are recorded only";
}
