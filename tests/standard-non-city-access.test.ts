// Historical record/access regression. Live archive exclusion is tested in destination-archive.test.ts.
import assert from "node:assert/strict";
import { test } from "node:test";
import { destinationAccessData } from "./fixtures/archived-destination-data";
import { placeRegistryData } from "../content/places/records";
import { createDestinationAccessStore } from "../src/travel/runtime/access-store";
import { createTravelProviders } from "./fixtures/archived-destination-data";
import { createTravelpayoutsDiscovery } from "./flight-provider-fixture";
import { defaultRequest } from "../src/domain/request";
import { money } from "../src/domain/budget";
import { getTripTemplates } from "../src/services/travel";
import { pricePlan } from "../src/domain/pricing";
import { matchingFlight } from "../src/domain/flight-pricing";
import { flightHandoff } from "../src/domain/affiliate";
import { approvedDestinationContent } from "./fixtures/archived-destination-data";
import type { TripRequest } from "../src/domain/types";

const now = new Date("2026-10-14T18:00:00Z");
const request: TripRequest = {
  ...defaultRequest,
  originId: "zurich",
  budget: money(300000),
  when: "custom",
  nights: 2,
  dates: { startDate: "2026-11-20", endDate: "2026-11-22", flexibleDays: 0 },
};
const cases = [
  { id: "place:Q4648", group: "DPS", airports: ["DPS"], gateway: false },
  {
    id: "place:Q40846",
    group: "TCI",
    airports: ["TFN", "TFS"],
    gateway: false,
  },
  { id: "place:Q2656389", group: "MRU", airports: ["MRU"], gateway: false },
  { id: "place:Q131347", group: "HNL", airports: ["HNL"], gateway: false },
  { id: "place:Q76516549", group: "FAO", airports: ["FAO"], gateway: false },
  { id: "place:Q41858", group: "YYC", airports: ["YYC"], gateway: true },
];
// All fare amounts/dates are SYNTHETIC. Airport mappings were separately researched.
async function setup(
  c: (typeof cases)[number],
  mode = "priced",
  selected = c.airports[c.airports.length - 1],
) {
  const queries: string[] = [];
  const providers = await createTravelProviders(
    {},
    async () => {
      assert.fail("No external metadata lookup for a reviewed access identity");
    },
    false,
    request,
  );
  providers.discovery = createTravelpayoutsDiscovery(
    "synthetic-phase5i",
    async (url) => {
      const target = new URL(url).searchParams.get("destination");
      queries.push(target ?? "BROAD");
      if (target) assert.match(target, /^[A-Z]{3}$/);
      if (mode === "failure") return new Response(null, { status: 503 });
      const row = (airport: string, price: number, day: number) => ({
        origin: "ZRH",
        origin_airport: "ZRH",
        destination: c.group,
        destination_airport: airport,
        price,
        departure_at: `2026-11-${day}`,
        return_at: `2026-11-${day + 2}`,
        found_at: now.toISOString(),
      });
      return Response.json({
        success: true,
        currency: "eur",
        data:
          mode === "empty"
            ? []
            : [
                ...c.airports.map((a) => row(a, 10, 18)), // cheaper reference fare must lose
                ...(mode === "reference"
                  ? []
                  : c.airports.map((a) =>
                      row(a, a === selected ? 200 : 260, 20),
                    )),
              ].filter(
                (r) =>
                  !target ||
                  r.destination === target ||
                  r.destination_airport === target,
              ),
      });
    },
    () => now,
  );
  return { providers, queries };
}
for (const c of cases) {
  test(`${c.id}: one canonical discovery, selected affiliate endpoint and reviewed content`, async () => {
    const { providers, queries } = await setup(c);
    const result = await getTripTemplates(request, providers);
    const rows = result.templates.filter((t) => t.id === c.id);
    assert.equal(rows.length, 1);
    assert.deepEqual(queries, ["BROAD"]);
    if (!c.gateway)
      assert.ok(
        !result.templates.some((t) =>
          [c.group, ...c.airports].some((a) => t.id === `city:${a}`),
        ),
      );
    const plan = pricePlan(rows[0], request);
    assert.equal(plan.destination.id, c.id);
    assert.equal(
      matchingFlight(plan)?.destinationAirport,
      c.airports[c.airports.length - 1],
    );
    assert.equal(
      flightHandoff(plan)?.destinationCode,
      c.airports[c.airports.length - 1],
    );
    assert.equal(flightHandoff(plan)?.departureDate, request.dates.startDate);
    assert.equal(!!plan.arrival, c.gateway);
    assert.equal(
      (await approvedDestinationContent.get(c.id)).status,
      "reviewed",
    );
    if (c.gateway) {
      assert.equal(plan.pricingCompleteness, "required-transfer-unpriced");
      assert.equal(plan.arrival?.onwardTransfer.status, "unpriced");
      assert.equal(plan.budget, undefined);
      assert.equal(plan.safetyBuffer, undefined);
      assert.deepEqual(plan.flightAffordability, {
        status: "required-transfer-unpriced",
      });
      assert.ok(
        !plan.costs.some((cost) => cost.category === "gatewayTransfer"),
      );
    } else
      assert.ok(
        !plan.costs.some((cost) => cost.category === "gatewayTransfer"),
      );
  });
  for (const mode of ["priced", "empty", "failure", "reference"]) {
    test(`${c.id}: fresh targeted restoration ${mode} preserves destination and pricing truth`, async () => {
      const { providers, queries } = await setup(c, mode);
      const result = await getTripTemplates(request, providers, c.id);
      assert.equal(result.templates.length, 1);
      assert.deepEqual(queries, [c.group]);
      const plan = pricePlan(result.templates[0], request);
      assert.equal(plan.destination.id, c.id);
      assert.equal(
        plan.pricingCompleteness,
        c.gateway
          ? "required-transfer-unpriced"
          : mode === "priced"
            ? "complete"
            : "flight-unpriced",
      );
      if (mode !== "priced" || c.gateway) assert.equal(plan.budget, undefined);
      if (mode === "priced")
        assert.equal(
          flightHandoff(plan)?.destinationCode,
          c.airports[c.airports.length - 1],
        );
      else assert.equal(matchingFlight(plan), undefined);
      if (c.gateway)
        assert.equal(plan.arrival?.onwardTransfer.status, "unpriced");
      assert.match(flightHandoff(plan)!.destinationCode, /^[A-Z]{3}$/);
      assert.equal(flightHandoff(plan)?.departureDate, "2026-11-20");
      assert.equal(flightHandoff(plan)?.returnDate, "2026-11-22");
      assert.equal(
        (await approvedDestinationContent.get(c.id)).status,
        "reviewed",
      );
      assert.equal(
        result.diagnostics?.some(
          (d) => d.code === "provider-failed" && d.count > 0,
        ),
        mode === "failure",
      );
    });
  }
}
for (const airport of ["TFN", "TFS"])
  test(`Tenerife selects strongest ${airport} evidence, not alphabetical airport order`, async () => {
    const { providers } = await setup(cases[1], "priced", airport);
    const result = await getTripTemplates(request, providers);
    const plans = result.templates
      .filter((t) => t.id === "place:Q40846")
      .map((t) => pricePlan(t, request));
    assert.equal(plans.length, 1);
    assert.equal(matchingFlight(plans[0])?.destinationAirport, airport);
    assert.equal(flightHandoff(plans[0])?.destinationCode, airport);
    assert.equal(plans[0].arrival, undefined);
  });
test("six access profiles have exact bounded groups; Tasmania/Kruger stay inactive", () => {
  const store = createDestinationAccessStore(
    destinationAccessData,
    placeRegistryData.records,
    () => now.getTime(),
  );
  for (const c of cases) {
    const source = destinationAccessData.records.find(
      (r) => r.destinationSubject === c.id,
    )!;
    assert.equal(
      source.relationship,
      c.gateway ? "external-gateway" : "direct-destination",
    );
    assert.equal(source.reviewOwner, "GoEksplo travel-data maintenance");
    const access = store.get(c.id)!;
    assert.equal(access.destination.id, c.id);
    if (c.gateway) {
      assert.deepEqual(
        access.gateways.map((g) => g.airportCode),
        ["YYC"],
      );
      assert.equal(access.directEntries, undefined);
    } else {
      assert.deepEqual(
        access.directEntries?.map((e) => [e.providerCityCode, e.airportCodes]),
        [[c.group, c.airports]],
      );
      assert.equal(access.gateways.length, 0);
    }
  }
  assert.equal(store.get("place:Q3593416"), undefined);
  assert.equal(store.get("place:Q24451"), undefined);
  assert.ok(!JSON.stringify(destinationAccessData).includes('"ZYF"'));
  assert.equal(store.get("place:Q60")!.directCity!.providerCityCode, "NYC");
  assert.deepEqual(
    store.get("place:Q34600")!.gateways.map((g) => g.airportCode),
    ["KIX", "ITM"],
  );
  assert.deepEqual(
    store.get("place:Q180402")!.gateways.map((g) => g.airportCode),
    ["FAT"],
  );
  assert.deepEqual(
    store.get("place:Q1490")!.directEntries!.map((g) => g.providerCityCode),
    ["TYO"],
  );
  assert.deepEqual(
    store.get("place:Q1273")!.directEntries!.map((g) => g.providerCityCode),
    ["FLR", "PSA"],
  );
  assert.equal(store.get("crete"), undefined); // Legacy model remains intact.
});
