// Vital signs (M3): parser, limits, due requests, messages.
// Run: deno test supabase/functions/_shared/vitals_test.ts
import {
  classify, dueVitalRequests, formatReading, looksLikeReading, MEASURE_INFO, parseReading, planMessage, readingReply,
  requestText, targetText, type VitalItem, vitalsConsentText,
} from "./vitals.ts";

function eq(actual: unknown, expected: unknown, msg = "") {
  const a = JSON.stringify(actual), e = JSON.stringify(expected);
  if (a !== e) throw new Error(`${msg}\n  expected ${e}\n  got      ${a}`);
}
const TZ = "Asia/Manila";
const bpItem: VitalItem = {
  id: "v1", patient_id: "p1", measure: "bp", times_of_day: ["07:00:00"], start_date: "2026-10-01", until_date: "2026-10-31",
  reason: "We started amlodipine and want to see if the dose is right.",
  ...MEASURE_INFO.bp.defaults, if_high: "if it's above 160/100 twice in a row, message the clinic.",
  if_low: "sit or lie down and message the clinic.",
};

Deno.test("blood pressure replies", () => {
  eq(parseReading("bp", "128/82"), { value1: 128, value2: 82, pulse: null });
  eq(parseReading("bp", "BP 152 / 96 pulse 78"), { value1: 152, value2: 96, pulse: 78 });
  eq(parseReading("bp", "130 over 85"), { value1: 130, value2: 85, pulse: null });
  eq(parseReading("bp", "12/8"), null, "implausible");
  eq(parseReading("bp", "80/120"), null, "diastolic above systolic");
  eq(parseReading("bp", "ok po"), null);
  eq(looksLikeReading("mine is 140/90 today"), "bp");
  eq(looksLikeReading("1"), null);
});

Deno.test("other measures, with unit conversions", () => {
  eq(parseReading("glucose", "110"), { value1: 110 });
  eq(parseReading("glucose", "6.1 mmol"), { value1: 110 });
  eq(parseReading("glucose", "5"), null, "too low to be mg/dL");
  eq(parseReading("temperature", "38,2"), { value1: 38.2 });
  eq(parseReading("temperature", "101.3 F"), { value1: 38.5 });
  eq(parseReading("weight", "154 lbs"), { value1: 69.9 });
  eq(parseReading("spo2", "96%"), { value1: 96 });
  eq(parseReading("spo2", "101"), null);
});

Deno.test("limits: target and critical (same rules as SQL vital_flag)", () => {
  const L = MEASURE_INFO.bp.defaults;
  eq(classify("bp", { value1: 128, value2: 82 }, L), "ok");
  eq(classify("bp", { value1: 140, value2: 90 }, L), "ok", "at the target is fine");
  eq(classify("bp", { value1: 152, value2: 96 }, L), "out_of_range");
  eq(classify("bp", { value1: 130, value2: 95 }, L), "out_of_range", "diastolic alone");
  eq(classify("bp", { value1: 180, value2: 100 }, L), "critical", "at critical");
  eq(classify("bp", { value1: 85, value2: 55 }, L), "critical", "low");
  eq(classify("glucose", { value1: 65 }, MEASURE_INFO.glucose.defaults), "critical");
  eq(classify("glucose", { value1: 250 }, MEASURE_INFO.glucose.defaults), "ok", "no target set");
  eq(classify("temperature", { value1: 38.0 }, MEASURE_INFO.temperature.defaults), "out_of_range");
  eq(classify("temperature", { value1: 39.5 }, MEASURE_INFO.temperature.defaults), "critical");
  eq(classify("spo2", { value1: 93 }, MEASURE_INFO.spo2.defaults), "out_of_range");
  eq(classify("spo2", { value1: 89 }, MEASURE_INFO.spo2.defaults), "critical");
  eq(classify("weight", { value1: 80 }, {}), "ok");
});

Deno.test("due requests: window, days of week, dates", () => {
  const at7 = new Date("2026-10-13T23:05:00Z"); // 7:05 AM Wed Oct 14 in Manila
  eq(dueVitalRequests(at7, [bpItem], TZ, new Set()).map((d) => d.dueAt.toISOString()), ["2026-10-13T23:00:00.000Z"]);
  eq(dueVitalRequests(at7, [bpItem], TZ, new Set(["v1|2026-10-13T23:00:00.000Z"])).length, 0, "already sent");
  eq(dueVitalRequests(at7, [{ ...bpItem, days_of_week: [1, 5] }], TZ, new Set()).length, 0, "Wednesday not in Mon/Fri");
  eq(dueVitalRequests(at7, [{ ...bpItem, days_of_week: [3] }], TZ, new Set()).length, 1, "Wednesday");
  eq(dueVitalRequests(at7, [{ ...bpItem, until_date: "2026-10-13" }], TZ, new Set()).length, 0, "ended");
  eq(dueVitalRequests(new Date("2026-10-13T23:40:00Z"), [bpItem], TZ, new Set()).length, 0, "past the window");
});

Deno.test("messages", () => {
  const reply = (flag: "ok" | "out_of_range" | "critical", v1: number, v2: number) =>
    readingReply(flag, "bp", { value1: v1, value2: v2 }, bpItem, { doctor: "Dr. Reyes", clinic: "Santos Clinic", clinicPhone: "0917 123 4567" });
  eq(reply("ok", 128, 82), "Thanks, saved: 128/82. ✅");
  const high = reply("out_of_range", 152, 96);
  eq(high.includes("higher than the target Dr. Reyes set (below 140/90)"), true, high);
  eq(high.includes("if it's above 160/100 twice in a row"), true);
  eq(high.includes("office hours"), true);
  const crit = reply("critical", 185, 122);
  eq(crit.indexOf("call 911") < crit.indexOf("contact Santos Clinic"), true, "911 first");
  eq(crit.includes("very high"), true);
  eq(reply("critical", 85, 55).includes("very low"), true);
  eq(formatReading("bp", { value1: 120, value2: 80, pulse: 72 }), "120/80, pulse 72");
  eq(formatReading("temperature", { value1: 37.2 }), "37.2°C");
  eq(targetText("spo2", MEASURE_INFO.spo2.defaults), "94% or above");
  eq(targetText("temperature", MEASURE_INFO.temperature.defaults), "37.9°C or below");
  eq(requestText([bpItem], "Dr. Reyes").startsWith("🩺 Time for your blood pressure check (see your plan from Dr. Reyes)"), true);
  const plan = planMessage([bpItem], { doctor: "Dr. Reyes", clinic: "Santos Clinic", tz: TZ });
  eq(plan.includes("When: every day at 7:00 AM until October 31."), true, plan);
  eq(plan.includes("Your target: below 140/90."), true);
  eq(plan.includes("call 911"), true);
  eq(vitalsConsentText("Santos Clinic", "Dr. Reyes", ["bp"]).includes("send your blood pressure by chat"), true);
});
