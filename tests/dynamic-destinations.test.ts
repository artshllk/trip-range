import { completePlan, referenceFlight } from "../src/domain/flight-pricing";
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  createDestinationResolver,
  destinationMetadata,
  DESTINATION_METADATA_TTL,
} from "../src/providers/server/destination-resolver";
import { dynamicDestination } from "../src/domain/dynamic-destinations";
import { createTravelProviders } from "./flight-provider-fixture";
import {
  defaultRequestFor,
  requestQuery,
  parseRequest,
} from "../src/domain/request";
import { getTripTemplates } from "../src/services/travel";
import { pricePlan } from "../src/domain/pricing";
import { curate } from "../src/domain/ranking";
import { flightHandoff } from "../src/domain/affiliate";
import { resolveTravelIntent } from "../src/services/ai/resolve-intent";
import { emptyIntent } from "../src/domain/ai/intent";
import { locations } from "../src/catalogue/locations";
import type { Destination, TripRequest } from "../src/domain/types";
import type { ProviderFetch } from "../src/providers/server/http";
const metadata = (
  code: string,
  cityCode: string,
  name: string,
  country = "IT",
) => ({
  type: code === cityCode ? "city" : "airport",
  code,
  name: code === cityCode ? name : `${name} Airport`,
  city_code: cityCode,
  city_name: name,
  country_code: country,
  country_name:
    country === "IT"
      ? "Italy"
      : country === "GB"
        ? "United Kingdom"
        : "Germany",
  coordinates: { lat: 41, lon: 12 },
});
const records: Record<string, unknown> = {
  FCO: metadata("FCO", "ROM", "Rome"),
  CIA: metadata("CIA", "ROM", "Rome"),
  ROM: metadata("ROM", "ROM", "Rome"),
  BER: metadata("BER", "BER", "Berlin", "DE"),
  LHR: metadata("LHR", "LON", "London", "GB"),
  LGW: metadata("LGW", "LON", "London", "GB"),
  STN: metadata("STN", "LON", "London", "GB"),
  LON: metadata("LON", "LON", "London", "GB"),
};
const request: TripRequest = {
  ...defaultRequestFor("2026-10-07"),
  originId: "zurich",
  budget: { cents: 200000, currency: "EUR" },
  when: "custom",
  dates: { startDate: "2026-11-07", endDate: "2026-11-09", flexibleDays: 0 },
};
async function fixture(r = request, codes = ["FCO"], preferred?: string) {
  const calls: { host: string; code: string | null }[] = [];
  const images: string[] = [];
  const fetcher: ProviderFetch = async (url, options) => {
    const u = new URL(url);
    const origin = u.searchParams.get("origin");
    calls.push({
      host: u.hostname,
      code: u.searchParams.get("term") ?? origin,
    });
    if (u.hostname === "api.travelpayouts.com")
      return Response.json({
        success: true,
        currency: "EUR",
        data: codes.map((code) => ({
          origin,
          destination:
            u.searchParams.get("destination") === "ROM" && code === "FCO"
              ? "ROM"
              : code,
          destination_airport:
            code === "ROM" ||
            (u.searchParams.get("destination") === "ROM" && code === "FCO")
              ? "FCO"
              : undefined,
          price: origin === "SKP" ? 40 : origin === "TIA" ? 90 : 150,
          found_at: new Date().toISOString(),
          departure_at: request.dates.startDate,
          return_at: request.dates.endDate,
        })),
      });
    if (u.hostname === "autocomplete.travelpayouts.com") {
      assert.equal(options.next?.revalidate, DESTINATION_METADATA_TTL);
      return Response.json(
        records[u.searchParams.get("term")!]
          ? [records[u.searchParams.get("term")!]]
          : [],
      );
    }
    if (u.hostname === "commons.wikimedia.org") {
      images.push(u.searchParams.get("gsrsearch") ?? "");
      return Response.json({ query: { pages: [] } });
    }
    throw Error("Unexpected provider");
  };
  const providers = await createTravelProviders(
    { TRAVELPAYOUTS_API_TOKEN: "synthetic" },
    fetcher,
    false,
    r,
  );
  // Exercise a genuinely uncurated Rome without changing the production catalogue.
  const catalogue = await providers.destinations.list();
  const rome = catalogue.findIndex((d) => d.id === "rome");
  if (rome >= 0) catalogue.splice(rome, 1);
  const search = await getTripTemplates(r, providers, preferred);
  return { search, calls, images, providers };
}
test("FCO resolves to stable Rome city with honest styles, stay and provenance", () => {
  const d = destinationMetadata([records.FCO], "FCO")!;
  assert.equal(d.id, "city:ROM");
  assert.equal(d.name.en, "Rome");
  assert.equal(d.countryCode, "IT");
  assert.deepEqual(d.styles, ["city"]);
  assert.equal(d.stylesKnown, false);
  assert.deepEqual(d.estimatedStay, { cents: 18000, currency: "EUR" });
  assert.equal(d.metadataSource, "travelpayouts-autocomplete");
  assert.equal(d.coordinates, undefined);
  assert.equal(d.imageQuery, "Rome Italy");
});
test("BER metadata resolves Berlin; wrong or contradictory codes rejected", () => {
  assert.equal(destinationMetadata([records.BER], "BER")?.name.en, "Berlin");
  assert.equal(destinationMetadata([records.FCO], "XYZ"), undefined);
  assert.equal(
    destinationMetadata(
      [records.FCO, { ...metadata("FCO", "ZZZ", "Other") }],
      "FCO",
    ),
    undefined,
  );
});
test("London airport aliases deduplicate canonical city within lookup cap", async () => {
  const catalogue: Destination[] = [];
  let calls = 0;
  const resolver = createDestinationResolver(catalogue, async (url) => {
    calls++;
    return Response.json([records[new URL(url).searchParams.get("term")!]]);
  });
  await resolver.resolve(["LHR", "LGW", "STN", "LHR"]);
  assert.equal(calls, 3);
  assert.equal(catalogue.length, 1);
  assert.equal(catalogue[0].id, "city:LON");
  assert.deepEqual(
    new Set(catalogue[0].iataCodes),
    new Set(["LON", "LHR", "LGW", "STN"]),
  );
  await resolver.resolve(["LHR"]);
  assert.equal(calls, 3);
});
test("resolution total bounded at ten and four concurrent, cache request contract", async () => {
  let calls = 0,
    active = 0,
    peak = 0;
  const resolver = createDestinationResolver([], async (_url, options) => {
    calls++;
    active++;
    peak = Math.max(peak, active);
    assert.equal(options.cache, "force-cache");
    assert.equal(options.next?.revalidate, 604800);
    assert.deepEqual(options.headers, { Accept: "application/json" });
    await new Promise((r) => setTimeout(r, 2));
    active--;
    return Response.json([]);
  });
  await resolver.resolve(
    Array.from(
      { length: 30 },
      (_, i) => `A${String.fromCharCode(65 + i)}A`,
    ).filter((c) => /^[A-Z]{3}$/.test(c)),
  );
  await resolver.resolve(["XYZ"]);
  assert.equal(calls, 10);
  assert.ok(peak <= 4);
  assert.ok(peak > 1);
});
test("metadata failure skips only failing destination and does not warn globally", async () => {
  const { search } = await fixture(request, ["XXX", "FCO"]);
  assert.ok(search.templates.some((t) => t.id === "city:ROM"));
  assert.ok(!search.templates.some((t) => t.id.includes("XXX")));
  assert.equal(search.issues.length, 0);
});
test("Anywhere discovers unknown destination with unchanged pricing and no image search", async () => {
  const { search, images } = await fixture();
  const t = search.templates.find((t) => t.id === "city:ROM")!;
  assert.ok(t);
  const p = pricePlan(t, request);
  assert.equal(
    p.costs.find((c) => c.category === "transport")?.confidence,
    "recent",
  );
  assert.equal(p.accommodation?.quote?.providerId, "goeksplo-stay-estimate");
  assert.equal(p.accommodation?.quote?.confidence, "estimate");
  assert.deepEqual(images, []);
  assert.ok(!JSON.stringify(t.itinerary).includes("old town"));
  assert.ok(!JSON.stringify(t.itinerary).includes("Colosseum"));
  assert.equal(flightHandoff(p)?.destinationCode, "FCO");
});
test("country Italy includes dynamic Rome, city filter passes but beach/nature/quiet do not", async () => {
  const country = {
    id: "country:IT",
    name: "Italy",
    countryCode: "IT",
    countryName: { en: "Italy", sq: "Italia" },
    type: "country" as const,
  };
  assert.ok(
    (
      await fixture({ ...request, destination: country, styles: ["city"] })
    ).search.templates.some((t) => t.id === "city:ROM"),
  );
  for (const style of ["beach", "nature", "quiet"] as const)
    assert.ok(
      !(await fixture({ ...request, styles: [style] })).search.templates.some(
        (t) => t.id === "city:ROM",
      ),
    );
});
test("specific Rome normalized selection creates actual target, no fixture replacement", async () => {
  const destination = {
    id: "city:ROM",
    name: "Rome",
    type: "city" as const,
    cityCode: "ROM",
    iataCodes: ["ROM"],
    countryCode: "IT",
    countryName: { en: "Italy", sq: "Italia" },
  };
  const r = { ...request, destination };
  const { search } = await fixture(r, ["FCO"]);
  assert.equal(search.templates.length, 1);
  assert.equal(search.templates[0].id, "city:ROM");
  assert.equal(
    flightHandoff(pricePlan(search.templates[0], r))?.destinationCode,
    "FCO",
  );
});
test("dynamic shared detail URL restores without relying on prior process catalogue", async () => {
  const r = parseRequest(
    Object.fromEntries(new URLSearchParams(requestQuery(request))),
    undefined,
    "2026-10-07",
  );
  const { search } = await fixture(r, ["FCO"], "city:ROM");
  assert.equal(search.templates.length, 1);
  assert.equal(search.templates[0].id, "city:ROM");
  assert.deepEqual(pricePlan(search.templates[0], r).request.dates, r.dates);
});
test("curated Berlin wins and bypasses unnecessary metadata resolution", async () => {
  const { search, calls } = await fixture(request, ["BER"]);
  assert.ok(search.templates.some((t) => t.id === "berlin"));
  assert.ok(!search.templates.some((t) => t.id === "city:BER"));
  assert.ok(!calls.some((c) => c.code === "BER"));
});
test("PRN/SKP/TIA route variants share one city; cheapest full-cost departure reaches affiliate", async () => {
  const r = {
    ...request,
    originId: "prishtina",
    preferences: { ...request.preferences, nearbyAirports: true },
  };
  const { search, calls } = await fixture(r, ["FCO", "CIA"]);
  const plans = search.templates
    .filter((t) => t.id === "city:ROM")
    .map((t) => pricePlan(t, r));
  assert.equal(plans.length, 3);
  assert.equal(
    calls.filter((c) => c.host === "autocomplete.travelpayouts.com").length,
    2,
  );
  const ranked = curate(plans, r);
  assert.equal(ranked.fits.length, 1);
  assert.equal(ranked.fits[0].departure?.code, "SKP");
  assert.ok((ranked.fits[0].airportSavingCents ?? 0) > 0);
  assert.equal(flightHandoff(ranked.fits[0])?.originCode, "SKP");
  assert.deepEqual(
    flightHandoff(ranked.fits[0])?.departureDate,
    r.dates.startDate,
  );
});
test("reference fares retain requested dates without an actual transport cost", async () => {
  const changed = {
    ...request,
    dates: { ...request.dates, startDate: "2026-11-14", endDate: "2026-11-16" },
  };
  const { search } = await fixture(changed);
  const t = search.templates.find((t) => t.id === "city:ROM")!;
  const p = pricePlan(t, changed);
  assert.equal(
    p.costs.find((c) => c.category === "transport"),
    undefined,
  );
  assert.equal(flightHandoff(p)?.departureDate, "2026-11-14");
  assert.ok(referenceFlight(p));
});
test("AI intent reaches identical resolver; destination creation has no AI dependency", async () => {
  const resolved = await resolveTravelIntent(
    { ...emptyIntent, originQuery: "Zurich", styles: ["city"] },
    Object.fromEntries(new URLSearchParams(requestQuery(request))),
    "nga Zurich dua qytet",
    "2026-10-07",
    {
      async search() {
        return {
          locations: locations.filter((l) => l.id === "zurich"),
          status: "available",
        };
      },
    },
  );
  const { search, calls } = await fixture(resolved.request);
  assert.ok(search.templates.some((t) => t.id === "city:ROM"));
  assert.ok(calls.every((c) => !c.host.includes("openai")));
});
test("normalized airport without confirmed city cannot invent city styles", () => {
  const d = dynamicDestination({
    id: "airport:FCO",
    name: "Fiumicino Airport",
    type: "airport",
    airportIata: "FCO",
    countryCode: "IT",
    countryName: { en: "Italy", sq: "Italy" },
  });
  assert.deepEqual(d.styles, []);
});

test("malformed metadata cannot invent names, countries or airport-city associations", () => {
  for (const row of [
    { ...metadata("FCO", "ROM", "Rome"), city_name: undefined },
    { ...metadata("FCO", "ROM", "Rome"), country_name: undefined },
    { ...metadata("FCO", "ROM", "Rome"), city_code: "invalid" },
  ])
    assert.equal(destinationMetadata([row], "FCO"), undefined);
});
test("deterministic diversity preserves first two choices and rejects costly new-city replacement", async () => {
  const { search } = await fixture();
  const base = pricePlan(
    search.templates.find((t) => t.id === "city:ROM")!,
    request,
  );
  assert.ok(completePlan(base));
  const make = (id: string, cents: number, dynamic = false) => ({
    ...base,
    id,
    destination: {
      ...base.destination,
      id,
      metadataSource: dynamic ? "travelpayouts-autocomplete" : undefined,
    },
    budget: {
      ...base.budget,
      budgetNeeded: { cents, currency: "EUR" as const },
    },
  });
  const plans = [
    make("a", 50000),
    make("b", 51000),
    make("c", 52000),
    make("city:ROM", 55000, true),
  ];
  assert.deepEqual(
    curate(plans, request).fits.map((p) => p.id),
    ["a", "b", "city:ROM"],
  );
  assert.deepEqual(
    curate(
      [...plans.slice(0, 3), make("city:ROM", 80000, true)],
      request,
    ).fits.map((p) => p.id),
    ["a", "b", "c"],
  );
});
