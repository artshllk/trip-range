// Historical record/access regression. Live archive exclusion is tested in destination-archive.test.ts.
import { test } from "node:test";
import assert from "node:assert/strict";
import { destinationAccessData } from "./fixtures/archived-destination-data";
import { placeRegistryData } from "../content/places/records";
import nyContent from "../content/archive/cost-scope-2026-11-02/destinations/place-Q60.json";
import { validateDestinationAccess } from "../src/domain/destination-access/validation";
import { arrivalAccess } from "../src/domain/destination-access/arrival";
import { createDestinationAccessStore } from "../src/travel/runtime/access-store";
import { createTravelProviders } from "../src/providers/server/composition";
import { createTravelpayoutsDiscovery } from "./flight-provider-fixture";
import { dynamicDestination } from "../src/domain/dynamic-destinations";
import { defaultRequest } from "../src/domain/request";
import { flightQueryPlan } from "../src/domain/flight-query";
import { getTripTemplates } from "../src/services/travel";
import { pricePlan } from "../src/domain/pricing";
import { matchingFlight, referenceFlight } from "../src/domain/flight-pricing";
import { flightHandoff } from "../src/domain/affiliate";
import { approvedDestinationContent } from "./fixtures/archived-destination-data";
import { money } from "../src/domain/budget";
import type { FlightDiscoveryFare, TripRequest } from "../src/domain/types";
const subject = "place:Q60";
const now = Date.parse("2026-10-14T12:00:00Z");
const places = placeRegistryData.records;
const directData = () => ({
  schemaVersion: 1 as const,
  records: structuredClone(
    destinationAccessData.records
      .filter((p) => p.directCity !== undefined)
      .filter((p) => p.destinationSubject === subject),
  ),
});
const store = (d: unknown = directData(), identities = places) =>
  createDestinationAccessStore(d, identities, () => now);
const request: TripRequest = {
  ...defaultRequest,
  originId: "zurich",
  budget: money(200000),
  when: "custom",
  nights: 2,
  dates: { startDate: "2026-11-20", endDate: "2026-11-22", flexibleDays: 0 },
};
// Synthetic fare evidence only; amounts/timestamps are not live provider observations.
function fare(
  airport: string | undefined = "JFK",
  code = "NYC",
): FlightDiscoveryFare {
  return {
    retrievedAt: new Date(now).toISOString(),
    originCode: "ZRH",
    destinationCode: code,
    destinationAirport: airport,
    price: {
      amount: money(20000),
      confidence: "recent",
      source: { status: "available" },
      providerId: "synthetic-travelpayouts",
      observedAt: new Date(now - 3600000).toISOString(),
      demo: false,
    },
    scope: {
      journey: "return",
      fees: "provider-unspecified",
      unit: "per-traveller",
      dates: { ...request.dates },
    },
  };
}
async function setup(fares = [fare()]) {
  const p = await createTravelProviders(
    {},
    async () => {
      throw Error("forbidden network");
    },
    false,
    request,
  );
  p.destinationAccess = store();
  p.discovery = {
    async discover() {
      return { status: "available", value: { fares, diagnostics: [] } };
    },
  };
  p.destinationResolver = {
    async resolve(codes) {
      assert.ok(
        !codes.some((c) => ["NYC", "JFK", "LGA", "EWR"].includes(c)),
        "reviewed direct identity needs no remote metadata",
      );
      return [];
    },
  };
  return p;
}
test("production direct binding preserves Q60 registry identity and verified provider grouping", () => {
  assert.equal(
    validateDestinationAccess(destinationAccessData, places).records.length,
    23,
  );
  const a = store().get(subject)!;
  assert.equal(a.destination.name.en, "New York City");
  assert.equal(a.destination.id, subject);
  assert.deepEqual(
    a.destination.coordinates,
    places.find((p) => p.subject === subject)!.coordinates,
  );
  assert.equal(a.destination.cityCode, "NYC");
  assert.deepEqual(a.directCity?.airportCodes, ["JFK", "LGA", "EWR"]);
  assert.deepEqual(a.gateways, []);
  assert.deepEqual(a.transferPrices, {});
  assert.equal(arrivalAccess(a, fare()), undefined);
  for (const code of ["NYC", "JFK", "LGA", "EWR"])
    assert.equal(store().directForCode(code)?.destination.id, subject);
  assert.equal(store().directForCode("New York"), undefined);
});
for (const state of ["draft", "expired", "future", "unresolved"])
  test(`direct ${state} binding is inactive`, () => {
    const d = directData(),
      identities = structuredClone(places);
    if (state === "draft") d.records[0].reviewStatus = "draft";
    if (state === "expired") d.records[0].reviewAfter = "2026-10-14T00:00:00Z";
    if (state === "future") d.records[0].reviewedAt = "2026-10-15T00:00:00Z";
    if (state === "unresolved")
      identities.find((p) => p.subject === subject)!.confidence = "unresolved";
    const s = store(d, identities);
    assert.equal(s.get(subject), undefined);
    assert.equal(s.directForCode("NYC"), undefined);
    assert.deepEqual(s.forFare(fare()), []);
  });
for (const [label, change] of Object.entries<Record<string, unknown>>({
  "invalid city": { providerCityCode: "place:Q60" },
  "invalid airport": { airportCodes: ["jfk"] },
  "no airports": { airportCodes: [] },
  "too many airports": {
    airportCodes: [
      "AAA",
      "AAB",
      "AAC",
      "AAD",
      "AAE",
      "AAF",
      "AAG",
      "AAH",
      "AAI",
    ],
  },
  "duplicate airport": { airportCodes: ["JFK", "JFK"] },
  "unknown source": { sourceIds: ["missing"] },
  "gateway transfer in direct relationship": {
    onwardTransfer: { required: true, pricing: { kind: "unpriced" } },
  },
}))
  test(`direct validation rejects ${label}`, () => {
    const d = directData();
    Object.assign(d.records[0].directCity, change);
    assert.throws(() => store(d), /invalid-destination-access/);
  });
test("direct relationship cannot silently replace gateway, contain both, or duplicate provider city", () => {
  for (const change of [
    { relationship: "external-gateway" },
    { relationship: undefined },
    { gateways: [] },
  ]) {
    const d = directData();
    Object.assign(d.records[0], change);
    assert.throws(() => store(d), /invalid-destination-access/);
  }
  const d = directData();
  d.records.push({
    ...structuredClone(d.records[0]),
    destinationSubject: "paris",
  });
  assert.throws(() => store(d), /invalid-destination-access/);
  const missing = directData();
  missing.records[0].destinationSubject = "place:Q999999999";
  assert.throws(() => store(missing), /invalid-destination-access/);
  const identities = structuredClone(places);
  identities.find((p) => p.subject === subject)!.placeKind = "island";
  assert.throws(
    () => store(directData(), identities),
    /invalid-destination-access/,
  );
});
test("explicit airport/city contradictions fail closed; group-only stays group-only", () => {
  for (const f of [fare("XXX"), fare("JFK", "LON"), fare("JFK", "EWR")])
    assert.deepEqual(store().forFare(f), []);
  for (const f of [
    fare(),
    fare("EWR"),
    fare("LGA"),
    fare(undefined),
    fare(undefined, "JFK"),
  ])
    assert.equal(store().forFare(f)[0]?.destination.id, subject);
});
test("one test-only second city proves generic exact bindings without new production identity", async () => {
  const d = directData(),
    identities = structuredClone(places),
    id = "place:Q999999999";
  identities.push({
    ...structuredClone(places.find((p) => p.subject === subject)!),
    subject: id,
    name: "Synthetic City",
    external: { authority: "wikidata", id: "Q999999999" },
  });
  d.records.push({
    ...structuredClone(d.records[0]),
    destinationSubject: id,
    directCity: {
      ...d.records[0].directCity,
      providerCityCode: "AAA",
      airportCodes: ["AAB", "AAC"],
    },
  });
  const p = await setup([fare("AAC", "AAA")]);
  p.destinationAccess = store(d, identities);
  const result = await getTripTemplates(request, p, id);
  assert.equal(result.templates.length, 1);
  assert.equal(result.templates[0].id, id);
  assert.equal(
    flightHandoff(pricePlan(result.templates[0], request))?.destinationCode,
    "AAC",
  );
});
test("broad discovery produces one canonical city, no metadata lookup or provider-city duplicate", async () => {
  const weak = fare("JFK");
  weak.price.amount = money(1000);
  weak.scope.dates = {
    ...request.dates,
    startDate: "2026-11-18",
    endDate: "2026-11-20",
  };
  const strong = fare("EWR"),
    original = structuredClone([weak, strong]);
  const p = await setup([weak, strong]);
  const result = await getTripTemplates(request, p);
  const rows = result.templates.filter((t) =>
    t.destination.iataCodes?.includes("NYC"),
  );
  assert.equal(rows.length, 1);
  assert.equal(rows[0].id, subject);
  const plan = pricePlan(rows[0], request);
  assert.equal(matchingFlight(plan)?.destinationAirport, "EWR");
  assert.equal(flightHandoff(plan)?.destinationCode, "EWR");
  assert.deepEqual([weak, strong], original);
  assert.equal(plan.arrival, undefined);
  assert.equal(plan.pricingCompleteness, "complete");
  assert.equal(
    plan.costs.some((c) => c.category === "gatewayTransfer"),
    false,
  );
  assert.ok(
    plan.costs
      .flatMap((c) => c.planning ?? [])
      .some((p) => p.component === "arrivalTransport"),
  );
  assert.equal(
    plan.costs.find((c) => c.category === "stay")?.confidence,
    "estimate",
  );
});
test("each verified New York airport remains the exact current-trip affiliate destination", async () => {
  for (const airport of ["JFK", "LGA", "EWR"]) {
    const providers = await setup([fare(airport)]);
    const result = await getTripTemplates(request, providers, subject);
    assert.equal(result.templates.length, 1);
    const plan = pricePlan(result.templates[0], request);
    assert.equal(plan.id, subject);
    assert.equal(matchingFlight(plan)?.destinationAirport, airport);
    assert.deepEqual(flightHandoff(plan), {
      originCode: "ZRH",
      destinationCode: airport,
      departureDate: request.dates.startDate,
      returnDate: request.dates.endDate,
      party: request.party,
    });
    assert.equal(plan.arrival, undefined);
  }
});
test("existing city selection alias resolves to canonical destination and cannot absorb unreviewed airports", async () => {
  const location = {
    id: "city:NYC",
    type: "city" as const,
    cityCode: "NYC",
    iataCodes: ["NYC"],
    name: "New York",
    countryCode: "US",
    countryName: { en: "United States", sq: "Shtetet e Bashkuara" },
  };
  const p = await setup();
  const list = await p.destinations.list();
  p.destinations = {
    ...p.destinations,
    async list() {
      return [...list, dynamicDestination(location)];
    },
  };
  for (const preferred of [undefined, "city:NYC", subject]) {
    const result = await getTripTemplates(
      { ...request, destination: location },
      p,
      preferred,
    );
    assert.equal(result.templates.length, 1);
    assert.equal(result.templates[0].id, subject);
  }
  const bad = fare("XXX");
  bad.price.amount = money(1);
  p.discovery = {
    async discover() {
      return {
        status: "available",
        value: { fares: [bad, fare("LGA")], diagnostics: [] },
      };
    },
  };
  assert.equal(
    matchingFlight(
      pricePlan(
        (await getTripTemplates(request, p, subject)).templates[0],
        request,
      ),
    )?.destinationAirport,
    "LGA",
  );
});
for (const state of ["priced", "empty", "failure"] as const)
  test(`fresh canonical restoration ${state} uses only targeted NYC and survives without prior search state`, async () => {
    const p = await setup(),
      queries: string[] = [];
    // Exercise real normalization with verified response field relationships; all evidence synthetic.
    p.discovery = createTravelpayoutsDiscovery(
      "synthetic-fixture",
      async (url) => {
        const u = new URL(url);
        queries.push(u.searchParams.get("destination") ?? "BROAD");
        if (state === "failure") return new Response(null, { status: 503 });
        return Response.json({
          success: true,
          currency: "eur",
          data:
            state === "empty"
              ? []
              : [
                  {
                    origin: "ZRH",
                    origin_airport: "ZRH",
                    destination: "NYC",
                    destination_airport: "EWR",
                    price: 200,
                    departure_at: request.dates.startDate,
                    return_at: request.dates.endDate,
                    found_at: new Date(now - 1000).toISOString(),
                  },
                ],
        });
      },
      () => new Date(now),
    );
    const result = await getTripTemplates(request, p, subject);
    assert.deepEqual(queries, ["NYC"]);
    assert.equal(result.templates.length, 1);
    const plan = pricePlan(result.templates[0], request);
    assert.equal(plan.id, subject);
    assert.equal(
      plan.pricingCompleteness,
      state === "priced" ? "complete" : "flight-unpriced",
    );
    assert.equal(!!matchingFlight(plan), state === "priced");
    if (state !== "priced") assert.equal(plan.budget, undefined);
    assert.equal(
      result.diagnostics?.some(
        (d) => d.code === "provider-failed" && d.count > 0,
      ),
      state === "failure",
    );
    assert.equal(
      flightHandoff(plan)?.destinationCode,
      state === "priced" ? "EWR" : "NYC",
    );
  });
test("reference airport remains informational; handoff uses actual requested dates", async () => {
  const f = fare("EWR");
  f.scope.dates = {
    ...request.dates,
    startDate: "2026-11-18",
    endDate: "2026-11-20",
  };
  const result = await getTripTemplates(request, await setup([f]), subject);
  const plan = pricePlan(result.templates[0], request);
  assert.equal(matchingFlight(plan), undefined);
  assert.equal(referenceFlight(plan)?.destinationAirport, "EWR");
  assert.equal(plan.pricingCompleteness, "flight-unpriced");
  assert.equal(plan.budget, undefined);
  assert.deepEqual(flightHandoff(plan), {
    originCode: "ZRH",
    destinationCode: "NYC",
    departureDate: request.dates.startDate,
    returnDate: request.dates.endDate,
    party: request.party,
  });
});
test("direct query remains bounded after canonical editorial publication", async () => {
  const a = store().get(subject)!;
  const q = flightQueryPlan(a.destination, undefined, a);
  assert.equal(q.kind, "targeted");
  assert.equal(q.targets.length, 1);
  assert.equal(q.targets[0]?.cityCode, "NYC");
  assert.equal(
    (await approvedDestinationContent.get(subject)).status,
    "reviewed",
  );
  assert.equal(nyContent.contentVersion, 3);
  assert.equal(nyContent.reviewStatus, "reviewed");
  assert.equal(nyContent.reviewedAt, nyContent.publication.approvedAt);
  assert.equal(nyContent.attractions.length, 4);
  assert.equal(nyContent.dayTemplates.length, 0);
  assert.ok(nyContent.publication);
});

test("a selected city cannot authenticate an arbitrary canonical detail ID", async () => {
  const p = await setup();
  const result = await getTripTemplates(
    {
      ...request,
      destination: {
        id: "city:NYC",
        type: "city",
        cityCode: "NYC",
        iataCodes: ["NYC"],
        name: "New York",
        countryCode: "US",
        countryName: { en: "United States", sq: "Shtetet e Bashkuara" },
      },
    },
    p,
    "place:Q999999998",
  );
  assert.deepEqual(result.templates, []);
  assert.deepEqual(result.diagnostics, [
    { code: "unknown-destination", count: 1 },
  ]);
});
test("direct discovery needs no destination metadata resolver", async () => {
  const p = await setup();
  delete p.destinationResolver;
  const result = await getTripTemplates(request, p);
  assert.equal(result.templates.filter((t) => t.id === subject).length, 1);
});

test("explicit bound airport retains its city-group response identity without metadata calls", async () => {
  const p = await setup(),
    queryTargets: string[] = [];
  p.discovery = createTravelpayoutsDiscovery(
    "synthetic-fixture",
    async (url) => {
      queryTargets.push(new URL(url).searchParams.get("destination")!);
      return Response.json({
        success: true,
        currency: "eur",
        data: ["JFK", "LGA"].map((airport) => ({
          origin: "ZRH",
          destination: "NYC",
          destination_airport: airport,
          price: 200,
          departure_at: request.dates.startDate,
          return_at: request.dates.endDate,
          found_at: new Date(now - 1000).toISOString(),
        })),
      });
    },
    () => new Date(now),
  );
  const r = {
    ...request,
    destination: {
      id: "airport:LGA",
      type: "airport" as const,
      airportIata: "LGA",
      iataCodes: ["LGA"],
      name: "LaGuardia",
      countryCode: "US",
      countryName: { en: "United States", sq: "Shtetet e Bashkuara" },
    },
  };
  const result = await getTripTemplates(r, p);
  assert.deepEqual(queryTargets, ["LGA"]);
  assert.equal(result.templates.length, 1);
  assert.equal(result.templates[0].id, subject);
  assert.equal(
    matchingFlight(pricePlan(result.templates[0], r))?.destinationAirport,
    "LGA",
  );
  assert.equal(
    flightHandoff(pricePlan(result.templates[0], r))?.destinationCode,
    "LGA",
  );
});
