// Historical record/access regression. Live archive exclusion is tested in destination-archive.test.ts.
import assert from "node:assert/strict";
import { test } from "node:test";
import { destinationAccessData } from "./fixtures/archived-destination-data";
import { placeRegistryData } from "../content/places/records";
import { validateDestinationAccess } from "../src/domain/destination-access/validation";
import { createDestinationAccessStore } from "../src/travel/runtime/access-store";
import {
  arrivalAccess,
  directArrival,
} from "../src/domain/destination-access/arrival";
import {
  flightQueryPlan,
  MAX_RESTORATION_QUERIES,
} from "../src/domain/flight-query";
import { createTravelProviders } from "../src/providers/server/composition";
import { createTravelpayoutsDiscovery } from "./flight-provider-fixture";
import {
  defaultRequest,
  parseRequest,
  requestQuery,
} from "../src/domain/request";
import { getTripTemplates } from "../src/services/travel";
import { selectTripDetailTemplate } from "../src/services/trip-detail-selection";
import { pricePlan } from "../src/domain/pricing";
import { matchingFlight } from "../src/domain/flight-pricing";
import { flightHandoff } from "../src/domain/affiliate";
import { curate } from "../src/domain/ranking";
import { comparePlans } from "../src/domain/airport-comparison";
import { approvedDestinationContent } from "./fixtures/archived-destination-data";
import { selectedDeparture } from "../src/domain/airports";
import { locations } from "../src/catalogue/locations";
import {
  searchFlightPlan,
  FLIGHT_SEARCH_CONCURRENCY,
  FLIGHT_SEARCH_BUDGET_MS,
} from "../src/services/flight-search";
import type { TripRequest, FlightDiscoveryFare } from "../src/domain/types";
const id = "place:Q24451";
const now = new Date("2026-10-15T15:00:00Z");
const routes = [
  { group: "SZK", airport: "SZK" },
  { group: "NLP", airport: "MQP" },
  { group: "HDS", airport: "HDS" },
  { group: "PHW", airport: "PHW" },
];
const profile = destinationAccessData.records.find(
  (r) => r.destinationSubject === id,
)!;
const store = createDestinationAccessStore(
  destinationAccessData,
  placeRegistryData.records,
  () => +now,
);
const access = store.get(id)!;
const request: TripRequest = {
  ...defaultRequest,
  originId: "zurich",
  budget: { cents: 300000, currency: "EUR" },
  when: "custom",
  dates: { startDate: "2026-11-20", endDate: "2026-11-22", flexibleDays: 0 },
  nights: 2,
};
// SYNTHETIC fare evidence only; exact metadata relationships are independently sourced.
async function setup(airports = routes.map((r) => r.airport), mode = "priced") {
  const queries: string[] = [];
  const providers = await createTravelProviders(
    {},
    async () => assert.fail("No external metadata"),
    false,
    request,
  );
  providers.destinationAccess = store;
  providers.discovery = createTravelpayoutsDiscovery(
    "synthetic-phase5m",
    async (url) => {
      const target = new URL(url).searchParams.get("destination");
      queries.push(target ?? "BROAD");
      if (mode === "failure") return new Response(null, { status: 503 });
      const rows = routes
        .filter(
          (r) =>
            airports.includes(r.airport) && (!target || target === r.group),
        )
        .flatMap((r) =>
          [18, 20].map((day) => ({
            origin: "ZRH",
            origin_airport: "ZRH",
            destination: r.group,
            destination_airport: r.airport,
            // Gateway airfare is deliberately cheaper, but its required transfer is missing.
            price: day === 18 ? 10 : r.airport === "SZK" ? 200 : 50,
            departure_at: `2026-11-${day}`,
            return_at: `2026-11-${day + 2}`,
            found_at: now.toISOString(),
          })),
        )
        .filter((r) => mode !== "reference" || r.departure_at.endsWith("18"));
      return Response.json({
        success: true,
        currency: "EUR",
        data: mode === "empty" ? [] : rows,
      });
    },
    () => now,
  );
  return { providers, queries };
}
for (const { group, airport } of routes) {
  test(`mixed ${airport}: canonical route, required-transfer truth and actual affiliate endpoint`, async () => {
    const { providers } = await setup([airport]);
    const result = await getTripTemplates(request, providers);
    const rows = result.templates.filter((r) => r.id === id);
    assert.equal(rows.length, 1);
    assert.ok(
      !result.templates.some((t) =>
        routes.some((r) => t.id === `city:${r.group}`),
      ),
    );
    const p = pricePlan(rows[0], request);
    assert.equal(matchingFlight(p)?.destinationAirport, airport);
    assert.equal(flightHandoff(p)?.destinationCode, airport);
    assert.equal(flightHandoff(p)?.departureDate, request.dates.startDate);
    assert.equal(
      p.directArrival?.flightDestinationCode,
      airport === "SZK" ? airport : undefined,
    );
    assert.equal(
      p.arrival?.airportCode,
      airport === "SZK" ? undefined : airport,
    );
    if (airport === "SZK")
      assert.ok(!p.costs.some((c) => c.category === "gatewayTransfer"));
    else {
      assert.equal(p.pricingCompleteness, "required-transfer-unpriced");
      assert.equal(p.arrival?.onwardTransfer.status, "unpriced");
      assert.equal(p.budget, undefined);
      assert.ok(!p.costs.some((c) => c.category === "gatewayTransfer"));
    }
    const restored = parseRequest(
      Object.fromEntries(new URLSearchParams(requestQuery(p.request))),
    );
    assert.deepEqual(restored.arrivalEntry, {
      destinationId: id,
      code: airport,
    });
    assert.equal(
      store.directForCode(airport)?.destination.id,
      airport === "SZK" ? id : undefined,
    );
    assert.equal(
      store.forFare({
        destinationCode: group,
        destinationAirport: airport,
      } as FlightDiscoveryFare)[0]?.destination.id,
      id,
    );
    assert.equal((await approvedDestinationContent.get(id)).status, "reviewed");
  });
  for (const mode of ["priced", "empty", "failure", "reference"])
    test(`mixed ${airport}: serialized link restores ${mode} independently within three targets`, async () => {
      const first = await setup([airport]);
      const initial = (
        await getTripTemplates(request, first.providers)
      ).templates.find((t) => t.id === id)!;
      const restored = parseRequest(
        Object.fromEntries(
          new URLSearchParams(
            requestQuery(pricePlan(initial, request).request),
          ),
        ),
      );
      const { providers, queries } = await setup([airport], mode);
      const result = await getTripTemplates(restored, providers, id);
      assert.deepEqual(
        queries,
        [...new Set([group, "SZK", "NLP", "HDS"])].slice(0, 3),
      );
      assert.equal(result.templates.length, 1);
      const p = pricePlan(result.templates[0], restored);
      assert.equal(p.destination.id, id);
      assert.equal(flightHandoff(p)?.destinationCode, airport);
      assert.equal(
        p.arrival?.onwardTransfer.required,
        airport === "SZK" ? undefined : true,
      );
      if (mode !== "priced") {
        assert.equal(matchingFlight(p), undefined);
        assert.equal(p.budget, undefined);
        assert.equal(
          p.pricingCompleteness,
          airport === "SZK" ? "flight-unpriced" : "required-transfer-unpriced",
        );
      }
      assert.equal(
        result.diagnostics?.some((d) => d.code === "provider-failed"),
        mode === "failure",
      );
      assert.equal(
        (await approvedDestinationContent.get(id)).status,
        "reviewed",
      );
    });
}
test("all approaches compete after completeness; one canonical result and no gateway city substitutes", async () => {
  const s = await setup();
  const result = await getTripTemplates(request, s.providers);
  assert.equal(result.templates.filter((t) => t.id === id).length, 4);
  assert.ok(
    !result.templates.some((t) =>
      routes.some((r) => t.id === `city:${r.group}`),
    ),
  );
  const plans = result.templates
    .filter((t) => t.id === id)
    .map((t) => pricePlan(t, request));
  assert.equal(
    plans.find((p) => p.directArrival)?.pricingCompleteness,
    "complete",
  );
  const cards = curate(plans, request).cards;
  assert.equal(cards.length, 1);
  assert.equal(flightHandoff(cards[0])?.destinationCode, "SZK");
  assert.equal(
    plans.sort(comparePlans)[0].directArrival?.flightDestinationCode,
    "SZK",
  );
});
test("all incomplete candidates retain strongest fare evidence before price", async () => {
  const s = await setup(["MQP", "HDS"]);
  const result = await getTripTemplates(request, s.providers);
  const plans = result.templates
    .filter((t) => t.id === id)
    .map((t) => pricePlan(t, request));
  assert.equal(plans.length, 2);
  assert.ok(
    plans.every(
      (p) =>
        matchingFlight(p)?.scope.dates.startDate === request.dates.startDate,
    ),
  );
  assert.equal(curate(plans, request).cards.length, 1);
  assert.ok(plans.every((p) => !p.budget));
});
test("old canonical link survives fourth-approach-only data without extra queries", async () => {
  const s = await setup(["PHW"]);
  const r = await getTripTemplates(request, s.providers, id);
  assert.deepEqual(s.queries, ["SZK", "NLP", "HDS"]);
  assert.equal(r.templates.length, 1);
  const p = pricePlan(r.templates[0], request);
  assert.equal(p.pricingCompleteness, "flight-unpriced");
  assert.equal(p.directArrival, undefined);
  assert.equal(p.arrival, undefined);
});
test("reviewed detail arrival survives competing fares; invalid hints cannot establish context", async () => {
  for (const code of ["SZK", "MQP", "NLP", "HDS", "PHW"])
    assert.equal(
      flightQueryPlan(access.destination, undefined, access, code).targets[0]
        ?.cityCode,
      code === "MQP" ? "NLP" : code,
    );
  for (const arrivalEntry of [
    { destinationId: id, code: "XXX" },
    { destinationId: "place:Q1490", code: "PHW" },
  ]) {
    const s = await setup([]);
    await getTripTemplates({ ...request, arrivalEntry }, s.providers, id);
    assert.deepEqual(s.queries, ["SZK", "NLP", "HDS"]);
  }
  const s = await setup(["SZK"]);
  const r = { ...request, arrivalEntry: { destinationId: id, code: "MQP" } };
  const found = await getTripTemplates(r, s.providers, id);
  const base = selectTripDetailTemplate(found.templates, r, id, access)!;
  assert.ok(base);
  const p = pricePlan(base, r);
  assert.equal(p.arrival?.airportCode, "MQP");
  assert.equal(matchingFlight(p), undefined);
  assert.equal(p.budget, undefined);
  assert.equal(flightHandoff(p)?.destinationCode, "MQP");
  for (const q of [
    { arrival: ["MQP", "SZK"], arrivalFor: id },
    { arrival: "MQP", arrivalFor: [id, id] },
    { arrival: "http://evil.test", arrivalFor: id },
  ])
    assert.equal(parseRequest(q).arrivalEntry, undefined);
  assert.equal(directArrival(access, undefined, "MQP"), undefined);
  assert.equal(arrivalAccess(access, undefined, "EUR", "SZK"), undefined);
  assert.equal(
    arrivalAccess(access, undefined, "EUR", "NLP")?.flightDestinationCode,
    "MQP",
  );
  for (const f of [
    { destinationCode: "NLP", destinationAirport: "NLP" },
    { destinationCode: "SZK", destinationAirport: "MQP" },
    { destinationCode: "NLP", destinationAirport: "SZK" },
  ]) {
    assert.deepEqual(store.forFare(f as FlightDiscoveryFare), []);
    assert.equal(directArrival(access, f as FlightDiscoveryFare), undefined);
    assert.equal(arrivalAccess(access, f as FlightDiscoveryFare), undefined);
  }
});
test("mixed validation is nature-area only, strict collisions, bounded reviewed policy", () => {
  const validate = (p: unknown) =>
    validateDestinationAccess(
      { schemaVersion: 1, records: [p] },
      placeRegistryData.records,
    );
  assert.doesNotThrow(() => validate(profile));
  for (const change of [
    { destinationSubject: "place:Q60" },
    { destinationSubject: "place:Q3593416" },
    { destinationSubject: "place:Q1273" },
    { relationship: "direct-destination" },
    { restoration: undefined },
    { directEntries: [] },
    { gateways: [] },
    {
      restoration: {
        ...profile.restoration,
        providerCityCodes: ["SZK", "NLP", "HDS", "PHW"],
      },
    },
    { restoration: { ...profile.restoration, providerCityCodes: ["ZZZ"] } },
    { restoration: { ...profile.restoration, sourceIds: ["missing"] } },
    {
      restoration: {
        ...profile.restoration,
        providerCityCodes: ["SZK", "SZK"],
      },
    },
    {
      gateways: [
        ...profile.gateways!,
        { ...profile.gateways![0], airportCode: "SZK" },
      ],
    },
    { gateways: [{ ...profile.gateways![0], providerCityCode: "SZK" }] },
    { directEntries: [...profile.directEntries!, profile.directEntries![0]] },
    { gateways: [...profile.gateways!, profile.gateways![0]] },
  ])
    assert.throws(() => validate({ ...profile, ...change }));
  for (const change of [
    { reviewStatus: "draft", reviewedAt: null },
    { reviewAfter: "2026-10-15T14:30:00Z" },
  ]) {
    const inactive = createDestinationAccessStore(
      { schemaVersion: 1, records: [{ ...profile, ...change }] },
      placeRegistryData.records,
      () => +now,
    );
    assert.equal(inactive.get(id), undefined);
    assert.equal(inactive.directForCode("SZK"), undefined);
    assert.deepEqual(
      inactive.forFare({
        destinationCode: "NLP",
        destinationAirport: "MQP",
      } as FlightDiscoveryFare),
      [],
    );
  }
});
test("shared executor remains 3 targets x 3 departures, concurrency 3, 4500ms", async () => {
  assert.equal(MAX_RESTORATION_QUERIES, 3);
  assert.equal(FLIGHT_SEARCH_CONCURRENCY, 3);
  assert.equal(FLIGHT_SEARCH_BUDGET_MS, 4500);
  const plan = flightQueryPlan(access.destination, undefined, access, "PHW");
  const departure = selectedDeparture(
    locations.find((l) => l.id === "zurich")!,
  )!;
  let calls = 0,
    active = 0,
    peak = 0;
  await searchFlightPlan(
    {
      async discover(_r, _o, options) {
        calls++;
        active++;
        peak = Math.max(peak, active);
        assert.ok(options!.timeoutMs! <= 4500);
        await new Promise((r) => setTimeout(r, 2));
        active--;
        return { status: "available", value: { fares: [], diagnostics: [] } };
      },
    },
    request,
    Array.from({ length: 4 }, () => departure),
    { ...plan, targets: [...plan.targets, plan.targets[0]] },
  );
  assert.equal(calls, 9);
  assert.equal(peak, 3);
});

test("multiple airports in one mixed gateway group still use one query; ambiguous hints never select an airport", () => {
  const synthetic = structuredClone(access);
  synthetic.gateways.push({ ...synthetic.gateways[0], airportCode: "AAA" });
  const plan = flightQueryPlan(
    synthetic.destination,
    undefined,
    synthetic,
    "NLP",
  );
  assert.deepEqual(
    plan.targets.map((t) => t?.cityCode),
    ["NLP", "SZK", "HDS"],
  );
  assert.ok(plan.targets[0]?.iataCodes?.includes("AAA"));
  assert.equal(
    arrivalAccess(synthetic, undefined, "EUR", "NLP")?.airportCode,
    undefined,
  );
  assert.equal(
    arrivalAccess(synthetic, undefined, "EUR", "MQP")?.airportCode,
    "MQP",
  );
  const groupFare = { destinationCode: "NLP" } as FlightDiscoveryFare;
  assert.equal(arrivalAccess(access, groupFare)?.airportCode, undefined);
  assert.equal(
    arrivalAccess(access, groupFare)?.onwardTransfer.status,
    "unpriced",
  );
});
