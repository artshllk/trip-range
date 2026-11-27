// Historical record/access regression. Live archive exclusion is tested in destination-archive.test.ts.
import { loadEditorialWorkspace } from "./fixtures/archived-destination-data";
import { reviewContext } from "../scripts/lib/editorial-review";
import { contentItems } from "../src/content/integrity";
import { createPinnedDestinationContentStore } from "../src/content/runtime/publication";
import { destinationAccessData } from "./fixtures/archived-destination-data";
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
// SYNTHETIC fares only. Airport sets come from the separately inspected public metadata.
const cities = [
  { id: "prishtina", code: "PRN", airport: "PRN", other: "PRN" },
  { id: "place:Q1489", code: "MEX", airport: "TLC", other: "MEX" },
  { id: "place:Q8678", code: "RIO", airport: "SDU", other: "GIG" },
  { id: "place:Q1486", code: "BUE", airport: "EZE", other: "AEP" },
  { id: "place:Q5465", code: "CPT", airport: "CPT", other: "CPT" },
  { id: "place:Q101625", code: "RAK", airport: "RAK", other: "RAK" },
  { id: "place:Q612", code: "DXB", airport: "DXB", other: "DWC" },
  { id: "istanbul", code: "IST", airport: "SAW", other: "IST" },
  { id: "place:Q3130", code: "SYD", airport: "SYD", other: "WSI" },
];
async function setup(city: (typeof cities)[number], mode = "priced") {
  const queries: string[] = [];
  const providers = await createTravelProviders(
    {},
    async () => {
      throw Error("Unexpected external metadata lookup");
    },
    false,
    request,
  );
  providers.discovery = createTravelpayoutsDiscovery(
    "synthetic-batch2",
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
  test(`${city.id}: discovery deduplicates, preserves exact actual airport, reviewed editorial stays available`, async () => {
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
  test(`${city.id}: trusted travel binding cannot publish an in-memory draft or change access data`, async () => {
    const accessBefore = JSON.stringify(destinationAccessData);
    const { record, identity } = loadEditorialWorkspace(
      undefined,
      undefined,
      Date.parse("2026-10-26T16:00:00Z"),
    ).inputs.get(city.id)!;
    const draft = structuredClone(record);
    for (const item of [
      draft,
      ...contentItems(draft).map(({ item }) => item),
    ]) {
      item.reviewStatus = "draft";
      item.reviewedAt = null;
    }
    delete draft.publication;
    const { providers } = await setup(city);
    const result = await getTripTemplates(request, providers, city.id);
    assert.equal(result.templates[0].id, city.id);
    assert.equal(
      flightHandoff(pricePlan(result.templates[0], request))?.destinationCode,
      city.airport,
    );
    assert.deepEqual(
      await createPinnedDestinationContentStore(
        { schemaVersion: 1, records: [draft] },
        reviewContext(identity),
        () => now.getTime(),
      ).get(city.id),
      { status: "none", reason: "not-reviewed" },
    );
    assert.equal(
      (await approvedDestinationContent.get(city.id)).status,
      "reviewed",
    );
    assert.equal(JSON.stringify(destinationAccessData), accessBefore);
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
