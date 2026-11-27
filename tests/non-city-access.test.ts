// Historical record/access regression. Live archive exclusion is tested in destination-archive.test.ts.
import { matchesDirectFare } from "../src/domain/destination-access/arrival";
import { flightQueryPlan } from "../src/domain/flight-query";
import { test } from "node:test";
import assert from "node:assert/strict";
import { destinationAccessData } from "./fixtures/archived-destination-data";
import { placeRegistryData } from "../content/places/records";
import { validateDestinationAccess } from "../src/domain/destination-access/validation";
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
const now = new Date("2026-10-14T12:00:00Z");
const request: TripRequest = {
  ...defaultRequest,
  originId: "zurich",
  budget: money(300000),
  when: "custom",
  nights: 2,
  dates: { startDate: "2026-11-20", endDate: "2026-11-22", flexibleDays: 0 },
};
// SYNTHETIC fare evidence. Metadata mappings independently researched in Phase 5G.
const proofs = [
  {
    id: "crete",
    groups: ["HER", "CHQ"],
    airport: "CHQ",
    code: "CHQ",
    other: "HER",
    otherCode: "HER",
    gateway: false,
  },
  {
    id: "place:Q1490",
    groups: ["TYO"],
    airport: "NRT",
    code: "TYO",
    other: "HND",
    otherCode: "TYO",
    gateway: false,
  },
  {
    id: "place:Q1273",
    groups: ["FLR", "PSA"],
    airport: "PSA",
    code: "PSA",
    other: "FLR",
    otherCode: "FLR",
    gateway: false,
  },
  {
    id: "place:Q180402",
    groups: ["FAT"],
    airport: "FAT",
    code: "FAT",
    other: "FAT",
    otherCode: "FAT",
    gateway: true,
  },
];
async function setup(proof: (typeof proofs)[number], mode = "priced") {
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
    "synthetic-phase5g",
    async (url) => {
      const target = new URL(url).searchParams.get("destination");
      queries.push(target ?? "BROAD");
      if (mode === "failure") return new Response(null, { status: 503 });
      const row = (
        destination: string,
        airport: string,
        price: number,
        day: number,
      ) => ({
        origin: "ZRH",
        origin_airport: "ZRH",
        destination,
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
                row(proof.otherCode, proof.other, 10, 18),
                row(proof.code, proof.airport, 200, 20),
                row(proof.otherCode, proof.other, 260, 20),
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
for (const proof of proofs) {
  test(`${proof.id}: discovery canonical deduplication, real endpoint and reviewed content`, async () => {
    const { providers, queries } = await setup(proof);
    const result = await getTripTemplates(request, providers);
    const rows = result.templates.filter((t) => t.id === proof.id);
    assert.equal(rows.length, 1);
    assert.deepEqual(queries, ["BROAD"]);
    assert.ok(
      !result.templates.some(
        (t) => !proof.gateway && proof.groups.some((c) => t.id === `city:${c}`),
      ),
    );
    const plan = pricePlan(rows[0], request);
    assert.equal(matchingFlight(plan)?.destinationAirport, proof.airport);
    assert.equal(flightHandoff(plan)?.destinationCode, proof.airport);
    assert.equal(!!plan.arrival, proof.gateway);
    assert.equal(
      (await approvedDestinationContent.get(proof.id)).status,
      "reviewed",
    );
    if (proof.gateway) {
      assert.equal(plan.pricingCompleteness, "required-transfer-unpriced");
      assert.equal(plan.budget, undefined);
      assert.equal(plan.arrival?.onwardTransfer.status, "unpriced");
    } else assert.ok(!plan.costs.some((c) => c.category === "gatewayTransfer"));
  });
  for (const mode of ["priced", "empty", "failure"])
    test(`${proof.id}: independent targeted restoration ${mode}`, async () => {
      const { providers, queries } = await setup(proof, mode);
      const result = await getTripTemplates(request, providers, proof.id);
      assert.equal(result.templates.length, 1);
      assert.deepEqual(queries, proof.groups);
      assert.ok(queries.length <= 3);
      const plan = pricePlan(result.templates[0], request);
      assert.equal(plan.destination.id, proof.id);
      assert.equal(
        (await approvedDestinationContent.get(proof.id)).status,
        "reviewed",
      );
      assert.equal(
        plan.pricingCompleteness,
        proof.gateway
          ? "required-transfer-unpriced"
          : mode === "priced"
            ? "complete"
            : "flight-unpriced",
      );
      if (mode !== "priced" || proof.gateway)
        assert.equal(plan.budget, undefined);
      if (mode === "priced")
        assert.equal(flightHandoff(plan)?.destinationCode, proof.airport);
      else assert.equal(matchingFlight(plan), undefined);
      assert.match(flightHandoff(plan)!.destinationCode, /^[A-Z]{3}$/);
      assert.equal(
        result.diagnostics?.some(
          (d) => d.code === "provider-failed" && d.count > 0,
        ),
        mode === "failure",
      );
    });
}
test("direct-destination validation is bounded and distinct from direct-city and parks", () => {
  const tokyo = structuredClone(
    destinationAccessData.records.find(
      (r) => r.destinationSubject === "place:Q1490",
    )!,
  );
  assert.equal(tokyo.relationship, "direct-destination");
  const validate = (r: unknown) =>
    validateDestinationAccess(
      { schemaVersion: 1, records: [r] },
      placeRegistryData.records,
    );
  assert.doesNotThrow(() => validate(tokyo));
  assert.throws(() => validate({ ...tokyo, relationship: "direct-city" }));
  assert.throws(() =>
    validate({ ...tokyo, destinationSubject: "place:Q180402" }),
  );
  assert.throws(() => validate({ ...tokyo, gateways: [] }));
  assert.throws(() =>
    validate({
      ...tokyo,
      directEntries: [...tokyo.directEntries!, ...tokyo.directEntries!],
    }),
  );
  assert.throws(() =>
    validate({
      ...tokyo,
      directEntries: ["AAA", "BBB", "CCC", "DDD"].map((c) => ({
        ...tokyo.directEntries![0],
        providerCityCode: c,
        airportCodes: [c],
      })),
    }),
  );
  assert.throws(() =>
    validate({
      ...tokyo,
      directEntries: [
        {
          ...tokyo.directEntries![0],
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
      ],
    }),
  );
  assert.throws(() =>
    validate({
      ...tokyo,
      directEntries: [{ ...tokyo.directEntries![0], sourceIds: ["unproven"] }],
    }),
  );
});
test("new direct profiles reject mismatched airports and cannot mutate stored relationships", async () => {
  const { providers } = await setup(proofs[1]);
  const result = await getTripTemplates(request, providers, proofs[1].id);
  const fare = matchingFlight(pricePlan(result.templates[0], request))!;
  const store = createDestinationAccessStore(
    destinationAccessData,
    placeRegistryData.records,
    () => now.getTime(),
  );
  const a = store.get("place:Q1490")!;
  assert.equal(matchesDirectFare(a, fare), true);
  assert.equal(
    matchesDirectFare(a, { ...fare, destinationAirport: "AAA" }),
    false,
  );
  assert.equal(
    matchesDirectFare(a, { ...fare, destinationCode: "PSA" }),
    false,
  );
  a.directEntries![0].airportCodes.push("AAA");
  assert.deepEqual(
    store.get(a.destination.id)!.directEntries![0].airportCodes,
    ["HND", "NRT"],
  );
  assert.equal(store.get("place:Q60")!.directCity!.providerCityCode, "NYC");
  assert.deepEqual(
    store.get("place:Q34600")!.gateways.map((g) => g.airportCode),
    ["KIX", "ITM"],
  );
});

test("generic direct reference endpoint is informational and matches check-current handoff", async () => {
  const { providers } = await setup(proofs[2]);
  const old = providers.discovery!;
  providers.discovery = {
    async discover(...args) {
      const r = await old.discover(...args);
      if (r.status !== "unavailable")
        r.value.fares = r.value.fares.filter(
          (f) => f.scope.dates.startDate !== request.dates.startDate,
        );
      return r;
    },
  };
  const result = await getTripTemplates(request, providers, proofs[2].id);
  const plan = pricePlan(result.templates[0], request);
  assert.equal(plan.pricingCompleteness, "flight-unpriced");
  assert.equal(plan.budget, undefined);
  assert.equal(matchingFlight(plan), undefined);
  assert.equal(plan.directArrival?.label.en, "Florence");
  assert.equal(flightHandoff(plan)?.destinationCode, "FLR");
  assert.equal(flightHandoff(plan)?.departureDate, request.dates.startDate);
});
test("non-city profile freshness and direct code collisions fail closed", () => {
  const data = structuredClone(destinationAccessData);
  const tokyo = data.records.find(
    (r) => r.destinationSubject === "place:Q1490",
  )!;
  tokyo.reviewStatus = "draft";
  tokyo.reviewedAt = null;
  const store = createDestinationAccessStore(
    data,
    placeRegistryData.records,
    () => now.getTime(),
  );
  assert.equal(store.get(tokyo.destinationSubject), undefined);
  const expired = createDestinationAccessStore(
    destinationAccessData,
    placeRegistryData.records,
    () => Date.parse("2027-01-11"),
  );
  assert.equal(expired.get(tokyo.destinationSubject), undefined);
  const collision = structuredClone(destinationAccessData);
  const region = collision.records.find(
    (r) => r.destinationSubject === "place:Q1273",
  )!;
  region.directEntries![0].airportCodes = ["JFK"];
  assert.throws(() =>
    validateDestinationAccess(collision, placeRegistryData.records),
  );
});

test("generic direct restoration is bounded to three explicit groups, including island semantics", () => {
  // SYNTHETIC island access configuration; no production island is migrated.
  const prototype = structuredClone(
    destinationAccessData.records.find(
      (r) => r.destinationSubject === "place:Q1490",
    )!,
  );
  assert.equal(prototype.relationship, "direct-destination");
  const groups = ["AAA", "BBB", "CCC"];
  const data = {
    schemaVersion: 1,
    records: [
      {
        ...prototype,
        destinationSubject: "place:Q4648",
        directEntries: groups.map((code) => ({
          ...prototype.directEntries![0],
          providerCityCode: code,
          airportCodes: [code],
        })),
      },
    ],
  };
  const access = createDestinationAccessStore(
    data,
    placeRegistryData.records,
    () => now.getTime(),
  ).get("place:Q4648")!;
  const query = flightQueryPlan(access.destination, undefined, access);
  assert.equal(query.kind, "targeted");
  assert.deepEqual(
    query.targets.map((t) => t?.cityCode),
    groups,
  );
  assert.ok(query.targets.every((t) => t && !t.id.startsWith("place:")));
  assert.equal(access.gateways.length, 0);
});

test("an explicitly selected regional airport stays targeted and is retained for handoff", async () => {
  const { providers, queries } = await setup(proofs[2]);
  const selected: TripRequest = {
    ...request,
    destination: {
      id: "airport:PSA",
      type: "airport",
      airportIata: "PSA",
      cityCode: "PSA",
      iataCodes: ["PSA"],
      name: "Pisa",
      countryCode: "IT",
      countryName: { en: "Italy", sq: "Itali" },
    },
  };
  const result = await getTripTemplates(selected, providers, "place:Q1273");
  assert.deepEqual(queries, ["PSA"]);
  assert.equal(result.templates.length, 1);
  const plan = pricePlan(result.templates[0], selected);
  assert.equal(plan.destination.id, "place:Q1273");
  assert.equal(matchingFlight(plan)?.destinationAirport, "PSA");
  assert.equal(flightHandoff(plan)?.destinationCode, "PSA");
  assert.equal(plan.directArrival?.label.en, "Pisa");
});
