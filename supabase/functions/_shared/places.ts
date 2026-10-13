// Nearby care (Discover D1b): Google Places API (New) lookups and the pure
// helpers around them. Design: docs/symptom-check-design.md §3a.
//
// The patient's point goes to Google for the lookup and is never stored.
// Every failure (no key, budget spent, Google error) returns null so callers
// fall back to "call 911 / your barangay health center".
//
// Secrets: GOOGLE_PLACES_API_KEY (restricted to Places API (New)),
// PLACES_MONTHLY_BUDGET (calls a month, default 900), PLACES_CARE_TYPES
// (comma list for non-emergency lookups, default "hospital,doctor").

export type Point = { lat: number; lng: number };
export type NearbyKind = "emergency" | "care";

export type NearbyPlace = {
  name: string;
  address: string | null;
  distance_km: number;
  open_now: boolean | null;
  phone: string | null;
  maps_url: string;
  lat: number;
  lng: number;
};

const API = "https://places.googleapis.com/v1";
export const NEARBY_FIELDS = [
  "places.id", "places.displayName", "places.formattedAddress", "places.location", "places.nationalPhoneNumber",
  "places.currentOpeningHours.openNow", "places.googleMapsUri", "places.businessStatus",
  "places.websiteUri", "places.userRatingCount",
].join(",");

/** An address that is only a plus code ("H23F+VQW, Makati City"): no street. */
const PLUS_CODE_ADDRESS = /^[23456789CFGHJMPQRVWX]{4,8}\+[23456789CFGHJMPQRVWX]{2,3}\b/;

/**
 * Whether a Google result looks like a real, reachable facility. Anyone can
 * add a place to Google Maps, and personal listings tagged "hospital" turn
 * up at the searcher's own location. Keep a place only if it has a phone
 * number, a website or at least 3 reviews; one whose address is only a plus
 * code also needs a phone number.
 */
// deno-lint-ignore no-explicit-any
export function looksReal(p: any): boolean {
  const phone = !!p?.nationalPhoneNumber;
  const site = !!p?.websiteUri;
  const reviews = typeof p?.userRatingCount === "number" ? p.userRatingCount : 0;
  if (typeof p?.formattedAddress === "string" && PLUS_CODE_ADDRESS.test(p.formattedAddress) && !phone) return false;
  return phone || site || reviews >= 3;
}

/** Emergency: nearest 3 hospitals within 25 km. Care: nearest 5 within 10 km. */
export const KIND_RULES: Record<NearbyKind, { types: string[]; max: number; radiusM: number }> = {
  emergency: { types: ["hospital"], max: 3, radiusM: 25_000 },
  care: { types: ["hospital", "doctor"], max: 5, radiusM: 10_000 },
};

export function careTypes(env = Deno.env.get("PLACES_CARE_TYPES")): string[] {
  const list = (env ?? "").split(",").map((s) => s.trim()).filter((s) => /^[a-z_]+$/.test(s));
  return list.length ? list : KIND_RULES.care.types;
}

/** Great-circle distance in km. */
export function haversineKm(a: Point, b: Point): number {
  const R = 6371, rad = (d: number) => (d * Math.PI) / 180;
  const dLat = rad(b.lat - a.lat), dLng = rad(b.lng - a.lng);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}

/** "350 m", "1.2 km", "14 km". */
export function distanceLabel(km: number): string {
  if (km < 1) return `${Math.max(50, Math.round((km * 1000) / 50) * 50)} m`;
  if (km < 10) return `${km.toFixed(1)} km`;
  return `${Math.round(km)} km`;
}

export function validPoint(lat: unknown, lng: unknown): Point | null {
  const a = Number(lat), b = Number(lng);
  if (!Number.isFinite(a) || !Number.isFinite(b) || Math.abs(a) > 90 || Math.abs(b) > 180) return null;
  return { lat: a, lng: b };
}

/** Rough box around the Philippines: a sanity check, not a restriction for typed places. */
export function inPhilippines(p: Point): boolean {
  return p.lat >= 4 && p.lat <= 21.5 && p.lng >= 116 && p.lng <= 127;
}

export function directionsUrl(p: Point, placeId?: string): string {
  const base = `https://www.google.com/maps/dir/?api=1&destination=${p.lat.toFixed(6)},${p.lng.toFixed(6)}`;
  return placeId ? `${base}&destination_place_id=${encodeURIComponent(placeId)}` : base;
}

// deno-lint-ignore no-explicit-any
export function mapPlaces(raw: any, origin: Point, max: number, maxKm = Number.POSITIVE_INFINITY): NearbyPlace[] {
  const out: NearbyPlace[] = [];
  for (const p of (raw?.places ?? []) as any[]) {
    const lat = p?.location?.latitude, lng = p?.location?.longitude;
    const name = p?.displayName?.text;
    if (typeof lat !== "number" || typeof lng !== "number" || !name) continue;
    if (p.businessStatus && p.businessStatus !== "OPERATIONAL") continue;
    if (!looksReal(p)) continue;
    const at = { lat, lng };
    // Beyond the search radius (with some slack) means a bad match: skip it.
    if (haversineKm(origin, at) > maxKm * 1.2) continue;
    out.push({
      name: String(name),
      address: p.formattedAddress ?? null,
      distance_km: Math.round(haversineKm(origin, at) * 10) / 10,
      open_now: typeof p.currentOpeningHours?.openNow === "boolean" ? p.currentOpeningHours.openNow : null,
      phone: p.nationalPhoneNumber ?? null,
      maps_url: directionsUrl(at, p.id),
      lat, lng,
    });
  }
  return out.sort((a, b) => a.distance_km - b.distance_km).slice(0, max);
}

/** Drop Google results that are a CareCall clinic already listed (within 150 m). */
export function withoutListed(places: NearbyPlace[], listed: Point[]): NearbyPlace[] {
  return places.filter((p) => !listed.some((c) => haversineKm(p, c) < 0.15));
}

// --- calls --------------------------------------------------------------------

type Fetch = typeof fetch;
type Budget = { allow: (calls: number) => Promise<boolean> };

export class PlacesClient {
  constructor(
    private key = Deno.env.get("GOOGLE_PLACES_API_KEY") ?? "",
    private budget?: Budget,
    private fetchFn: Fetch = fetch,
  ) {}

  get configured(): boolean { return !!this.key; }

  private async post(path: string, fieldMask: string, body: unknown): Promise<unknown | null> {
    if (!this.key) return null;
    if (this.budget && !(await this.budget.allow(1))) return null;
    try {
      const res = await this.fetchFn(`${API}/${path}`, {
        method: "POST",
        headers: { "Content-Type": "application/json", "X-Goog-Api-Key": this.key, "X-Goog-FieldMask": fieldMask },
        body: JSON.stringify(body),
      });
      const j = await res.json().catch(() => null);
      if (!res.ok) { console.error(`places ${path} ${res.status}`, JSON.stringify(j).slice(0, 300)); return null; }
      return j;
    } catch (e) {
      console.error(`places ${path}`, e);
      return null;
    }
  }

  /** Nearest facilities around a point, nearest first; null when unavailable. */
  async nearby(origin: Point, kind: NearbyKind): Promise<NearbyPlace[] | null> {
    const rule = KIND_RULES[kind];
    const types = kind === "care" ? careTypes() : rule.types;
    const j = await this.post("places:searchNearby", NEARBY_FIELDS, {
      includedTypes: types,
      // The most Google returns, at the same price: many are filtered out
      // (closed, personal listings, CareCall clinics already shown).
      maxResultCount: 20,
      rankPreference: "DISTANCE",
      regionCode: "PH",
      languageCode: "en",
      locationRestriction: { circle: { center: { latitude: origin.lat, longitude: origin.lng }, radius: rule.radiusM } },
    });
    return j === null ? null : mapPlaces(j, origin, rule.max, rule.radiusM / 1000);
  }

  /** A typed town, barangay or address → a point in the Philippines; null when not found. */
  async locate(text: string): Promise<{ point: Point; label: string } | null> {
    const q = text.trim().slice(0, 120);
    if (q.length < 2) return null;
    const j = await this.post("places:searchText", "places.location,places.formattedAddress", {
      textQuery: /philippines/i.test(q) ? q : `${q}, Philippines`,
      regionCode: "PH",
      languageCode: "en",
    }) as { places?: { location?: { latitude?: number; longitude?: number }; formattedAddress?: string }[] } | null;
    const p = j?.places?.[0];
    const point = validPoint(p?.location?.latitude, p?.location?.longitude);
    if (!point || !inPhilippines(point)) return null;
    return { point, label: p?.formattedAddress ?? q };
  }
}
