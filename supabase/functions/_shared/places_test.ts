// Nearby care: distances, mapping Google's response, request shape, failures.
// Run: deno test supabase/functions/_shared/places_test.ts
import {
  directionsUrl, distanceLabel, haversineKm, inPhilippines, mapPlaces, PlacesClient, validPoint, withoutListed,
} from "./places.ts";

function eq(actual: unknown, expected: unknown, msg = "") {
  const a = JSON.stringify(actual), e = JSON.stringify(expected);
  if (a !== e) throw new Error(`${msg}\n  expected ${e}\n  got      ${a}`);
}
const MAKATI = { lat: 14.5547, lng: 121.0244 };
const BGC = { lat: 14.5509, lng: 121.0503 };

Deno.test("distances", () => {
  const d = haversineKm(MAKATI, BGC);
  eq(d > 2.6 && d < 3.0, true, `Makati–BGC ~2.8 km, got ${d}`);
  eq(distanceLabel(0.34), "350 m");
  eq(distanceLabel(0.01), "50 m");
  eq(distanceLabel(2.84), "2.8 km");
  eq(distanceLabel(14.4), "14 km");
});

Deno.test("points", () => {
  eq(validPoint("14.5", "121"), { lat: 14.5, lng: 121 });
  eq(validPoint(91, 0), null);
  eq(validPoint("x", 1), null);
  eq(inPhilippines(MAKATI), true);
  eq(inPhilippines({ lat: 1.35, lng: 103.8 }), false, "Singapore");
  eq(directionsUrl(BGC, "abc"), "https://www.google.com/maps/dir/?api=1&destination=14.550900,121.050300&destination_place_id=abc");
});

const raw = { places: [
  { id: "far", displayName: { text: "Far Hospital" }, location: { latitude: 14.60, longitude: 121.03 }, businessStatus: "OPERATIONAL" },
  { id: "near", displayName: { text: "Near Clinic" }, formattedAddress: "Ayala Ave, Makati", location: { latitude: 14.556, longitude: 121.025 },
    nationalPhoneNumber: "(02) 8888 8999", currentOpeningHours: { openNow: true }, businessStatus: "OPERATIONAL" },
  { id: "shut", displayName: { text: "Closed for good" }, location: { latitude: 14.555, longitude: 121.0245 }, businessStatus: "CLOSED_PERMANENTLY" },
  { id: "noloc", displayName: { text: "No location" } },
] };

Deno.test("mapping: nearest first, closed and incomplete dropped", () => {
  const list = mapPlaces(raw, MAKATI, 5);
  eq(list.map((p) => p.name), ["Near Clinic", "Far Hospital"]);
  eq(list[0].phone, "(02) 8888 8999");
  eq(list[0].open_now, true);
  eq(list[1].open_now, null);
  eq(list[0].maps_url.includes("destination_place_id=near"), true);
  eq(mapPlaces(raw, MAKATI, 1).length, 1);
  eq(mapPlaces({}, MAKATI, 3), []);
  eq(mapPlaces(raw, { lat: 10.3157, lng: 123.8854 }, 5, 10), [], "Cebu origin: Makati places are out of range");
});

Deno.test("CareCall clinics aren't listed twice", () => {
  const list = mapPlaces(raw, MAKATI, 5);
  eq(withoutListed(list, [{ lat: 14.5561, lng: 121.0251 }]).map((p) => p.name), ["Far Hospital"]);
});

Deno.test("request shape and failures", async () => {
  const sent: { url: string; headers: Record<string, string>; body: any }[] = [];
  const ok = (body: unknown, status = 200) => Promise.resolve(new Response(JSON.stringify(body), { status }));
  let reply: () => Promise<Response> = () => ok(raw);
  const fakeFetch = ((url: string, init: RequestInit) => {
    sent.push({ url, headers: init.headers as Record<string, string>, body: JSON.parse(String(init.body)) });
    return reply();
  }) as unknown as typeof fetch;
  let budgetLeft = 2;
  const client = new PlacesClient("KEY", { allow: () => Promise.resolve(budgetLeft-- > 0) }, fakeFetch);

  const er = await client.nearby(MAKATI, "emergency");
  eq(er?.length, 2);
  eq(sent[0].url, "https://places.googleapis.com/v1/places:searchNearby");
  eq(sent[0].headers["X-Goog-Api-Key"], "KEY");
  eq(sent[0].headers["X-Goog-FieldMask"].includes("places.nationalPhoneNumber"), true);
  eq(sent[0].body.includedTypes, ["hospital"]);
  eq(sent[0].body.rankPreference, "DISTANCE");
  eq(sent[0].body.locationRestriction.circle, { center: { latitude: 14.5547, longitude: 121.0244 }, radius: 25000 });

  reply = () => ok({ places: [{ location: { latitude: 10.3157, longitude: 123.8854 }, formattedAddress: "Cebu City, Cebu, Philippines" }] });
  eq(await client.locate("Cebu City"), { point: { lat: 10.3157, lng: 123.8854 }, label: "Cebu City, Cebu, Philippines" });
  eq(sent[1].url.endsWith("places:searchText"), true);
  eq(sent[1].body.textQuery, "Cebu City, Philippines");

  eq(await client.nearby(MAKATI, "care"), null, "budget spent");
  eq(sent.length, 2, "no call over budget");

  budgetLeft = 5;
  reply = () => ok({ error: { status: "INVALID_ARGUMENT" } }, 400);
  eq(await client.nearby(MAKATI, "care"), null, "Google error");
  reply = () => Promise.reject(new Error("network"));
  eq(await client.nearby(MAKATI, "care"), null, "network error");
  reply = () => ok({ places: [{ location: { latitude: 1.35, longitude: 103.8 } }] });
  eq(await client.locate("Orchard"), null, "outside the Philippines");
  eq(await new PlacesClient("", undefined, fakeFetch).nearby(MAKATI, "care"), null, "no key");
});
