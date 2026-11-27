// Historical record/access regression. Live archive exclusion is tested in destination-archive.test.ts.
import { test } from "node:test";
import assert from "node:assert/strict";
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
const now = new Date("2026-10-14T12:00:00Z");
const request: TripRequest = {
  ...defaultRequest,
  originId: "zurich",
  budget: money(300000),
  when: "custom",
  nights: 2,
  dates: { startDate: "2026-11-20", endDate: "2026-11-22", flexibleDays: 0 },
};
const cities = [
  { id: "city:BCN", code: "BCN", airport: "BCN", other: "BCN" },
  { id: "london", code: "LON", airport: "STN", other: "LCY" },
  { id: "place:Q334", code: "SIN", airport: "SIN", other: "XSP" },
  { id: "place:Q1861", code: "BKK", airport: "DMK", other: "BKK" },
  { id: "place:Q24639", code: "YVR", airport: "YVR", other: "CXH" },
];
async function setup(city: (typeof cities)[number], mode = "priced") {
  const queries: string[] = [];
  const providers = await createTravelProviders(
    {},
    async (url) => {
      const u = new URL(url);
      assert.equal(u.hostname, "autocomplete.travelpayouts.com");
      assert.equal(u.searchParams.get("term"), "BCN");
      // Synthetic public metadata shape matching inspected BCN identity; no live CI research.
      return Response.json([
        {
          type: "city",
          code: "BCN",
          name: "Barcelona",
          country_code: "ES",
          country_name: "Spain",
          coordinates: { lat: 41.387917, lon: 2.1699187 },
        },
      ]);
    },
    false,
    request,
  );
  providers.discovery = createTravelpayoutsDiscovery(
    "synthetic-batch1",
    async (url) => {
      queries.push(new URL(url).searchParams.get("destination") ?? "BROAD");
      if (mode === "failure") return new Response(null, { status: 503 });
      const row = (airport: string, price: number, day: number) => ({
        origin: "ZRH",
        origin_airport: "ZRH",
        destination: city.code,
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
                row(city.other, 10, 18),
                row(city.airport, 200, 20),
                row(city.other, 260, 20),
              ],
      });
    },
    () => now,
  );
  return { providers, queries };
}
for (const city of cities) {
  test(`${city.id}: discovery deduplicates, preserves exact actual airport, reviewed content stays available`, async () => {
    const { providers } = await setup(city);
    const result = await getTripTemplates(request, providers);
    const rows = result.templates.filter((t) => t.id === city.id);
    assert.equal(rows.length, 1);
    const plan = pricePlan(rows[0], request);
    assert.equal(matchingFlight(plan)?.destinationAirport, city.airport);
    assert.equal(flightHandoff(plan)?.destinationCode, city.airport);
    assert.equal(plan.arrival, undefined);
    assert.equal(
      plan.costs.some((c) => c.category === "gatewayTransfer"),
      false,
    );
    assert.equal(
      (await approvedDestinationContent.get(city.id)).status,
      "reviewed",
    );
  });
  for (const mode of ["priced", "empty", "failure"])
    test(`${city.id}: independent detail ${mode} keeps trusted destination`, async () => {
      const { providers, queries } = await setup(city, mode);
      const result = await getTripTemplates(request, providers, city.id);
      assert.equal(result.templates.length, 1);
      assert.equal(result.templates[0].id, city.id);
      assert.deepEqual(queries, [city.code]);
      const plan = pricePlan(result.templates[0], request);
      assert.equal(
        plan.pricingCompleteness,
        mode === "priced" ? "complete" : "flight-unpriced",
      );
      if (mode !== "priced") assert.equal(plan.budget, undefined);
      assert.equal(
        flightHandoff(plan)?.destinationCode,
        mode === "priced" ? city.airport : city.code,
      );
      assert.equal(
        result.diagnostics?.some(
          (d) => d.code === "provider-failed" && d.count > 0,
        ),
        mode === "failure",
      );
      assert.equal(
        (await approvedDestinationContent.get(city.id)).status,
        "reviewed",
      );
    });
}
