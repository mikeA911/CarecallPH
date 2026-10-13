// Nearby care (Discover D1b): CareCall clinics near a point, Google Places
// results, the monthly Places budget, and the chat text. Used by the
// symptom-check function (web) and channel-webhook (Telegram location).
// Design: docs/symptom-check-design.md §3a. The point is never stored.
import { supabase } from "./lib.ts";
import { distanceLabel, haversineKm, type NearbyKind, type NearbyPlace, PlacesClient, type Point, withoutListed } from "./places.ts";

export const PLACES_MONTHLY_BUDGET = Number(Deno.env.get("PLACES_MONTHLY_BUDGET") ?? "900") || 900;
/** CareCall clinics further than this aren't offered as "near you". */
export const CARECALL_MAX_KM = 25;

export type NearCareCallClinic = {
  slug: string; name: string; phone: string | null; distance_km: number; lat: number; lng: number;
};

/** The monthly Places budget, counted in the database. */
export const placesBudget = {
  async allow(calls: number): Promise<boolean> {
    const { data } = await supabase.rpc("places_calls_this_month");
    if (typeof data === "number" && data + calls > PLACES_MONTHLY_BUDGET) return false;
    await supabase.rpc("bump_places_usage", { p_calls: calls });
    return true;
  },
};

export const places = () => new PlacesClient(undefined, placesBudget);

/** Participating CareCall clinics with a location, nearest first. */
export async function careCallClinicsNear(origin: Point, maxKm = CARECALL_MAX_KM): Promise<NearCareCallClinic[]> {
  const { data } = await supabase.from("clinics")
    .select("name, phone_callback, public_slug, lat, lng")
    .eq("symptom_check_enabled", true).eq("active", true)
    .not("public_slug", "is", null).not("lat", "is", null).not("lng", "is", null);
  return ((data ?? []) as { name: string; phone_callback: string | null; public_slug: string; lat: number; lng: number }[])
    .map((c) => ({
      slug: c.public_slug, name: c.name, phone: c.phone_callback, lat: c.lat, lng: c.lng,
      distance_km: Math.round(haversineKm(origin, c) * 10) / 10,
    }))
    .filter((c) => c.distance_km <= maxKm)
    .sort((a, b) => a.distance_km - b.distance_km);
}

/**
 * Nearby facilities from Google, minus CareCall clinics already listed.
 * `places` is null when Google can't be used (no key, budget, error).
 */
export async function nearbyCare(origin: Point, kind: NearbyKind):
  Promise<{ careCall: NearCareCallClinic[]; places: NearbyPlace[] | null }> {
  const careCall = kind === "care" ? await careCallClinicsNear(origin) : [];
  const found = await places().nearby(origin, kind);
  return { careCall, places: found && withoutListed(found, careCall) };
}

/** The Telegram reply to a shared location: nearest ERs, then clinics. */
export function nearbyText(o: {
  er: NearbyPlace[] | null; careCall: NearCareCallClinic[]; care: NearbyPlace[] | null; portal: string;
}): string {
  const line = (p: { name: string; distance_km: number; phone: string | null }) =>
    `• ${p.name} (${distanceLabel(p.distance_km)})${p.phone ? `, ${p.phone}` : ""}`;
  const parts: string[] = ["In an emergency, call 911 now."];
  if (o.er?.length) {
    parts.push(`Nearest emergency rooms:\n${o.er.map((p) => `${line(p)}\n  ${p.maps_url}`).join("\n")}`);
  }
  if (o.careCall.length) {
    parts.push(`Clinics you can book with CareCall:\n${o.careCall.slice(0, 3)
      .map((c) => `${line(c)}\n  ${o.portal}/check/${c.slug}`).join("\n")}`);
  }
  if (o.care?.length) {
    parts.push(`Other nearby options (we don't book these; call them directly):\n${o.care
      .map((p) => `${line(p)}${p.open_now === true ? " · open now" : p.open_now === false ? " · closed now" : ""}\n  ${p.maps_url}`)
      .join("\n")}`);
  }
  if (!o.er?.length && !o.careCall.length && !o.care?.length) {
    parts.push("We couldn't look up places near you right now. Please go to your barangay health center or the nearest hospital.");
  }
  parts.push("Not a complete list. Distances are straight-line and approximate. Data from Google.");
  return parts.join("\n\n");
}
