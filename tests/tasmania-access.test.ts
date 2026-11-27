// Historical record/access regression. Live archive exclusion is tested in destination-archive.test.ts.
import assert from "node:assert/strict";
import { test } from "node:test";
import { destinationAccessData } from "./fixtures/archived-destination-data";
import { placeRegistryData } from "../content/places/records";
import { validateDestinationAccess } from "../src/domain/destination-access/validation";
import { createDestinationAccessStore } from "../src/travel/runtime/access-store";
import {
  directArrival,
  matchesDirectFare,
} from "../src/domain/destination-access/arrival";
import { flightQueryPlan } from "../src/domain/flight-query";
import { createTravelProviders } from "./fixtures/archived-destination-data";
import { createTravelpayoutsDiscovery } from "./flight-provider-fixture";
import {
  defaultRequest,
  parseRequest,
  requestQuery,
} from "../src/domain/request";
import { getTripTemplates } from "../src/services/travel";
import { pricePlan } from "../src/domain/pricing";
import { matchingFlight } from "../src/domain/flight-pricing";
import { flightHandoff } from "../src/domain/affiliate";
import { approvedDestinationContent } from "./fixtures/archived-destination-data";
import { selectedDeparture } from "../src/domain/airports";
import { locations } from "../src/catalogue/locations";
import {
  searchFlightPlan,
  FLIGHT_SEARCH_CONCURRENCY,
  FLIGHT_SEARCH_BUDGET_MS,
} from "../src/services/flight-search";
import type { TripRequest } from "../src/domain/types";
const id = "place:Q3593416";
const codes = ["HBA", "LST", "DPO", "BWT"];
const now = new Date("2026-10-15T10:00:00Z");
const profile = destinationAccessData.records.find(
  (r) => r.destinationSubject === id,
)!;
const store = createDestinationAccessStore(
  destinationAccessData,
  placeRegistryData.records,
  () => now.getTime(),
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
// SYNTHETIC fares only. Exact access identities were independently researched.
async function setup(chosen = "BWT", mode = "priced", onlyChosen = false) {
  const queries: string[] = [];
  const providers = await createTravelProviders(
    {},
    async () => {
      assert.fail("No external metadata lookup");
    },
    false,
    request,
  );
  providers.discovery = createTravelpayoutsDiscovery(
    "synthetic-phase5k",
    async (url) => {
      const target = new URL(url).searchParams.get("destination");
      queries.push(target ?? "BROAD");
      if (mode === "failure") return new Response(null, { status: 503 });
      const rows = codes
        .flatMap((code) =>
          [18, 20].map((day) => ({
            origin: "ZRH",
            origin_airport: "ZRH",
            destination: code,
            destination_airport: code,
            price: day === 18 ? 10 : code === chosen ? 200 : 260,
            departure_at: `2026-11-${day}`,
            return_at: `2026-11-${day + 2}`,
            found_at: now.toISOString(),
          })),
        )
        .filter(
          (r) =>
            (!target || r.destination === target) &&
            (!onlyChosen || r.destination === chosen) &&
            (mode !== "reference" || r.departure_at.endsWith("18")),
        );
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
for (const code of codes) {
  test(`Tasmania ${code}: one canonical card, strongest evidence, endpoint and shareable link`, async () => {
    const { providers, queries } = await setup(code);
    const result = await getTripTemplates(request, providers);
    const rows = result.templates.filter((t) => t.id === id);
    assert.equal(rows.length, 1);
    assert.deepEqual(queries, ["BROAD"]);
    assert.ok(
      !result.templates.some((t) => codes.some((c) => t.id === `city:${c}`)),
    );
    const plan = pricePlan(rows[0], request);
    assert.equal(matchingFlight(plan)?.destinationAirport, code);
    assert.equal(plan.directArrival?.flightDestinationCode, code);
    assert.equal(flightHandoff(plan)?.destinationCode, code);
    assert.equal(flightHandoff(plan)?.departureDate, request.dates.startDate);
    assert.equal(plan.arrival, undefined);
    assert.ok(!plan.costs.some((c) => c.category === "gatewayTransfer"));
    const restored = parseRequest(
      Object.fromEntries(new URLSearchParams(requestQuery(plan.request))),
    );
    assert.deepEqual(restored.arrivalEntry, { destinationId: id, code });
    assert.equal((await approvedDestinationContent.get(id)).status, "reviewed");
  });
  for (const mode of ["priced", "empty", "failure", "reference"])
    test(`Tasmania ${code}: independent reload ${mode}, selected entry first and reviewed content retained`, async () => {
      const initial = await setup(code);
      const search = await getTripTemplates(request, initial.providers);
      const link = requestQuery(
        pricePlan(search.templates.find((t) => t.id === id)!, request).request,
      );
      const restored = parseRequest(
        Object.fromEntries(new URLSearchParams(link)),
      );
      const { providers, queries } = await setup(code, mode, true);
      const result = await getTripTemplates(restored, providers, id);
      assert.deepEqual(queries, [...new Set([code, "HBA", "LST"])]);
      assert.ok(queries.length <= 3);
      assert.equal(result.templates.length, 1);
      const plan = pricePlan(result.templates[0], restored);
      assert.equal(plan.destination.id, id);
      assert.equal(plan.destination.cityCode, undefined);
      assert.equal(flightHandoff(plan)?.destinationCode, code);
      assert.equal(flightHandoff(plan)?.departureDate, request.dates.startDate);
      assert.equal(plan.arrival, undefined);
      assert.ok(!plan.costs.some((c) => c.category === "gatewayTransfer"));
      if (mode !== "priced") {
        assert.equal(matchingFlight(plan), undefined);
        assert.equal(plan.budget, undefined);
        assert.equal(plan.pricingCompleteness, "flight-unpriced");
      } else assert.equal(matchingFlight(plan)?.destinationAirport, code);
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
test("unhinted old links query only evidenced primary pair; BWT-only evidence may remain unpriced", async () => {
  const { providers, queries } = await setup("BWT", "priced", true);
  const result = await getTripTemplates(request, providers, id);
  assert.deepEqual(queries, ["HBA", "LST"]);
  assert.equal(result.templates.length, 1);
  assert.equal(
    pricePlan(result.templates[0], request).pricingCompleteness,
    "flight-unpriced",
  );
});
test("reviewed arrival pins detail only; discovery and invalid hints retain their boundaries", async () => {
  const r = { ...request, arrivalEntry: { destinationId: id, code: "BWT" } };
  const s = await setup("HBA");
  const result = await getTripTemplates(r, s.providers, id);
  assert.deepEqual(s.queries, ["BWT", "HBA", "LST"]);
  assert.equal(
    flightHandoff(pricePlan(result.templates[0], r))?.destinationCode,
    "BWT",
  );
  assert.equal(
    matchingFlight(pricePlan(result.templates[0], r))?.destinationAirport,
    "BWT",
  );
  assert.equal(
    matchingFlight(pricePlan(result.templates[0], r))?.price.amount.cents,
    26000,
  );
  for (const arrivalEntry of [
    { destinationId: id, code: "FLS" },
    { destinationId: "place:Q1490", code: "BWT" },
  ]) {
    const s = await setup();
    await getTripTemplates({ ...request, arrivalEntry }, s.providers, id);
    assert.deepEqual(s.queries, ["HBA", "LST"]);
  }
  const broad = await setup();
  await getTripTemplates(r, broad.providers);
  assert.deepEqual(broad.queries, ["BROAD"]);
  for (const q of [
    { arrival: "BWT" },
    { arrival: "https://evil.test", arrivalFor: id },
    { arrival: ["BWT", "HBA"], arrivalFor: id },
    { arrival: "BWT", arrivalFor: "city:HBA" },
  ])
    assert.equal(parseRequest(q).arrivalEntry, undefined);
});
test("four exact direct entries are indexed, never an island/city equality or external transfer", () => {
  assert.equal(access.destination.id, id);
  assert.equal(
    placeRegistryData.records.find((p) => p.subject === id)?.placeKind,
    "island",
  );
  assert.equal(access.destination.cityCode, undefined);
  for (const code of codes)
    assert.equal(store.directForCode(code)?.destination.id, id);
  for (const code of ["FLS", "KNS"])
    assert.equal(store.directForCode(code), undefined);
  assert.equal(access.gateways.length, 0);
  assert.deepEqual(access.restorationGroups, ["HBA", "LST"]);
  const contradictory = {
    destinationCode: "HBA",
    destinationAirport: "BWT",
  } as Parameters<typeof matchesDirectFare>[1];
  assert.equal(matchesDirectFare(access, contradictory), false);
  assert.equal(directArrival(access, contradictory), undefined);
  access.restorationGroups!.push("BWT");
  assert.deepEqual(store.get(id)?.restorationGroups, ["HBA", "LST"]);
  access.restorationGroups!.pop();
});
test("expanded recognition requires bounded, source-pinned restoration policy; other variants fail closed", () => {
  const validate = (record: unknown) =>
    validateDestinationAccess(
      { schemaVersion: 1, records: [record] },
      placeRegistryData.records,
    );
  assert.doesNotThrow(() => validate(profile));
  const noPolicy = { ...profile, restoration: undefined };
  assert.throws(() => validate(noPolicy));
  for (const policy of [
    {
      providerCityCodes: codes,
      sourceIds: ["official-access"],
      rationale: "Too many queries",
    },
    {
      providerCityCodes: [],
      sourceIds: ["official-access"],
      rationale: "Empty",
    },
    {
      providerCityCodes: ["HBA", "HBA"],
      sourceIds: ["official-access"],
      rationale: "Duplicate",
    },
    {
      providerCityCodes: ["KNS"],
      sourceIds: ["official-access"],
      rationale: "Wrong island",
    },
    {
      providerCityCodes: ["HBA"],
      sourceIds: ["missing"],
      rationale: "Unproven",
    },
    {
      providerCityCodes: ["HBA"],
      sourceIds: ["official-access"],
      rationale: "",
    },
  ])
    assert.throws(() => validate({ ...profile, restoration: policy }));
  for (const subject of ["place:Q60", "place:Q34600"])
    assert.throws(() =>
      validate({
        ...destinationAccessData.records.find(
          (r) => r.destinationSubject === subject,
        ),
        restoration: profile.restoration,
      }),
    );
  assert.throws(() =>
    validate({ ...profile, destinationSubject: "place:Q24451" }),
  );
  assert.throws(() =>
    validate({
      ...profile,
      directEntries: [...profile.directEntries!, profile.directEntries![0]],
    }),
  );
  const stale = createDestinationAccessStore(
    destinationAccessData,
    placeRegistryData.records,
    () => Date.parse("2027-01-11T00:00:00Z"),
  );
  assert.equal(stale.directForCode("BWT"), undefined);
});
test("generic policy caps selected plus priorities at three, and shared executor remains 3 x 3 / concurrency 3", async () => {
  const synthetic = { ...access, restorationGroups: ["HBA", "LST", "DPO"] };
  const plan = flightQueryPlan(access.destination, undefined, synthetic, "BWT");
  assert.deepEqual(
    plan.targets.map((t) => t?.cityCode),
    ["BWT", "HBA", "LST"],
  );
  assert.equal(FLIGHT_SEARCH_CONCURRENCY, 3);
  assert.equal(FLIGHT_SEARCH_BUDGET_MS, 4500);
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
    { kind: "targeted", targets: [...plan.targets, plan.targets[0]] },
  );
  assert.equal(calls, 9);
  assert.equal(peak, 3);
});
