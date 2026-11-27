// Historical record/access regression. Live archive exclusion is tested in destination-archive.test.ts.
import { test } from "node:test";
import assert from "node:assert/strict";
import { destinationAccessData } from "./fixtures/archived-destination-data";
import { placeRegistryData } from "../content/places/records";
import { validateDestinationAccess } from "../src/domain/destination-access/validation";
import { arrivalAccess } from "../src/domain/destination-access/arrival";
import { createDestinationAccessStore } from "../src/travel/runtime/access-store";
import { createTravelProviders } from "./fixtures/archived-destination-data";
import { createDestinationImages } from "../src/providers/server/images";
import { defaultRequest } from "../src/domain/request";
import { getTripTemplates } from "../src/services/travel";
import { pricePlan } from "../src/domain/pricing";
import { matchingFlight, referenceFlight } from "../src/domain/flight-pricing";
import { flightHandoff } from "../src/domain/affiliate";
import { explainTrips } from "../src/services/ai/explain-trips";
import { explanationFacts } from "../src/domain/ai/explanations";
import { curate } from "../src/domain/ranking";
import { approvedDestinationContent } from "./fixtures/archived-destination-data";
import { money, safetyBufferFor } from "../src/domain/budget";
import type { FlightDiscoveryFare, TripRequest } from "../src/domain/types";
const subject = "place:Q34600";
const now = Date.parse("2026-10-14T12:00:00Z");
// Gateway regressions use only the real Kyoto record; direct-city coverage is separate.
const data = () => ({
  schemaVersion: 1 as const,
  records: structuredClone(
    destinationAccessData.records
      .filter((p) => p.gateways !== undefined)
      .filter((p) => p.destinationSubject === "place:Q34600"),
  ),
});
const places = placeRegistryData.records;
const store = (d = data(), identities = places) =>
  createDestinationAccessStore(d, identities, () => now);
const request: TripRequest = {
  ...defaultRequest,
  originId: "zurich",
  budget: money(200000),
  when: "custom",
  nights: 2,
  dates: { startDate: "2026-11-20", endDate: "2026-11-22", flexibleDays: 0 },
};
function fare(
  airport: string | undefined = "KIX",
  code = "OSA",
): FlightDiscoveryFare {
  return {
    retrievedAt: "2026-10-14T12:00:00Z",
    originCode: "ZRH",
    destinationCode: code,
    destinationAirport: airport,
    price: {
      amount: money(20000),
      confidence: "recent",
      source: { status: "available" },
      providerId: "travelpayouts",
      observedAt: "2026-10-14T10:00:00Z",
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
async function setup(fares = [fare()], d = data(), identities = places) {
  const p = await createTravelProviders(
    {},
    async () => {
      throw Error("unexpected network");
    },
    false,
    request,
  );
  p.destinationAccess = store(d, identities);
  p.discovery = {
    async discover() {
      return { status: "available", value: { fares, diagnostics: [] } };
    },
  };
  p.destinationResolver = {
    async resolve() {
      return [];
    },
  };
  return p;
}
async function template(fares = [fare()], d = data()) {
  const result = await getTripTemplates(
    request,
    await setup(fares, d),
    subject,
  );
  assert.equal(result.templates.length, 1);
  return result.templates[0];
}
const pricedAccess = () => {
  const d = data();
  d.records[0].gateways[0].onwardTransfer.pricing = {
    kind: "estimate",
    amount: money(3000),
    unit: "person-return",
    reviewAfter: "2026-12-01T00:00:00Z",
    sourceIds: [d.records[0].sources[0].id],
  };
  return d;
};

test("reviewed Kyoto access validates without duplicating canonical identity", () => {
  assert.equal(validateDestinationAccess(data(), places).records.length, 1);
  const a = store().get(subject)!;
  assert.equal(a.destination.name.en, "Kyoto");
  assert.equal(a.destination.id, subject);
  assert.equal(a.destination.iataCodes, undefined);
  assert.deepEqual(
    a.gateways.map((g) => g.airportCode),
    ["KIX", "ITM"],
  );
});
for (const state of ["draft", "expired", "future", "unresolved"])
  test(`${state} access never activates`, () => {
    const d = data(),
      identities = structuredClone(places);
    if (state === "draft") d.records[0].reviewStatus = "draft";
    if (state === "expired") d.records[0].reviewAfter = "2026-10-14T00:00:00Z";
    if (state === "future") d.records[0].reviewedAt = "2026-10-15T00:00:00Z";
    if (state === "unresolved")
      identities.find((p) => p.subject === subject)!.confidence = "unresolved";
    assert.equal(store(d, identities).get(subject), undefined);
    assert.equal(store(d, identities).forFare(fare()).length, 0);
  });
for (const [label, mutate] of Object.entries<
  Record<string, (d: ReturnType<typeof data>) => void>[string]
>({
  unknown: (d) => (d.records[0].destinationSubject = "unknown"),
  airport: (d) => (d.records[0].gateways[0].airportCode = "place:Q34600"),
  city: (d) => (d.records[0].gateways[0].providerCityCode = "osaka"),
  duplicate: (d) => d.records[0].gateways.push(d.records[0].gateways[0]),
  profile: (d) => d.records.push(d.records[0]),
  unsafeSource: (d) => (d.records[0].sources[0].url = "http://localhost/a"),
  unsupportedSource: (d) => (d.records[0].gateways[0].sourceIds = ["unknown"]),
  backwardsReview: (d) => (d.records[0].reviewAfter = "2000-01-01T00:00:00Z"),
  futureSource: (d) =>
    (d.records[0].sources[0].checkedAt = "2030-01-01T00:00:00Z"),
  invalidTransfer: (d) =>
    (d.records[0].gateways[0].onwardTransfer.pricing = {
      kind: "estimate",
      amount: money(0),
      unit: "person-return",
      reviewAfter: d.records[0].reviewAfter,
      sourceIds: [d.records[0].sources[0].id],
    }),
}))
  test(`access rejects ${label}`, () => {
    const d = data();
    mutate(d);
    assert.throws(() => store(d), /invalid-destination-access/);
  });

test("many-to-many city, island and nature relationships are generic and indexed", () => {
  const d = data(),
    identities = structuredClone(places);
  for (const placeKind of ["city", "island", "nature-area"] as const) {
    const id = `test:${placeKind}`;
    identities.push({
      ...identities.find((p) => p.subject === subject)!,
      subject: id,
      name: "Synthetic place",
      placeKind,
    });
    d.records.push({
      ...structuredClone(d.records[0]),
      destinationSubject: id,
    });
  }
  assert.equal(store(d, identities).forFare(fare()).length, 4);
  for (const id of ["test:city", "test:island", "test:nature-area"])
    assert.equal(store(d, identities).get(id)?.gateways.length, 2);
});
test("actual airport dominates city grouping; unknown OSA never becomes KIX", () => {
  const a = store().get(subject)!;
  for (const airport of ["KIX", "ITM"]) {
    const access = arrivalAccess(a, fare(airport))!;
    assert.equal(access.airportCode, airport);
    assert.equal(access.flightDestinationCode, airport);
  }
  const groupFare = fare();
  delete groupFare.destinationAirport;
  assert.equal(arrivalAccess(a, groupFare)?.flightDestinationCode, "OSA");
  assert.equal(arrivalAccess(a, groupFare)?.airportCode, undefined);
  assert.equal(arrivalAccess(a, groupFare)?.onwardTransfer.status, "unpriced");
  assert.equal(arrivalAccess(a, fare("UKB")), undefined);
  assert.equal(arrivalAccess(a, fare("KIX", "TYO")), undefined);
  assert.equal(store().forFare(fare("UKB")).length, 0);
});
test("search discovers final Kyoto without mutating gateway fare evidence or fetching research", async () => {
  const f = fare(),
    before = structuredClone(f);
  const result = await getTripTemplates(request, await setup([f]));
  const base = result.templates.find((t) => t.id === subject)!;
  assert.ok(base);
  const plan = pricePlan(base, request);
  assert.equal(plan.destination.name.en, "Kyoto");
  assert.deepEqual(matchingFlight(plan), before);
  assert.deepEqual(f, before);
  assert.equal(plan.arrival?.destinationSubject, subject);
  assert.equal(plan.arrival?.airportCode, "KIX");
  assert.equal(plan.pricingCompleteness, "required-transfer-unpriced");
  assert.equal(plan.budget, undefined);
  assert.equal(plan.safetyBuffer, undefined);
  assert.equal(plan.flightAffordability.status, "required-transfer-unpriced");
  if (plan.pricingCompleteness !== "required-transfer-unpriced") throw Error();
  assert.equal(plan.knownCosts.cents - plan.knownNonFlightCosts.cents, 40000);
  assert.ok(
    !plan.costs
      .flatMap((c) => c.planning ?? [])
      .some((p) => p.component === "arrivalTransport"),
  );
  assert.equal(curate([plan], request).fits.length, 0);
  assert.deepEqual(explanationFacts([plan], "en"), []);
});
test("transfer estimate includes both directions, all travellers and reserve without double count", async () => {
  const base = await template([fare()], pricedAccess());
  const plan = pricePlan(base, request, "none", undefined, {
    today: "2026-10-14",
  });
  assert.equal(plan.pricingCompleteness, "complete");
  if (plan.pricingCompleteness !== "complete") throw Error();
  const transfer = plan.costs.find((c) => c.category === "gatewayTransfer")!;
  assert.equal(transfer.amount.cents, 6000);
  assert.equal(transfer.confidence, "estimate");
  assert.equal(transfer.planning?.[0].component, "gatewayTransfer");
  assert.equal(
    plan.costs
      .flatMap((c) => c.planning ?? [])
      .filter((p) => p.component === "arrivalTransport").length,
    0,
  );
  assert.deepEqual(
    plan.safetyBuffer,
    safetyBufferFor(plan.budget.estimatedSpend),
  );
  assert.equal(
    plan.budget.estimatedSpend.cents,
    plan.costs.reduce((n, c) => n + c.amount.cents, 0),
  );
  const family = pricePlan(
    base,
    { ...request, party: { adults: 2, children: 1 } },
    "none",
    undefined,
    { today: "2026-10-14" },
  );
  assert.equal(
    family.costs.find((c) => c.category === "gatewayTransfer")?.amount.cents,
    9000,
  );
  const incomplete = pricePlan(await template(), request);
  assert.equal(
    curate([incomplete, plan], request).fits[0].pricingCompleteness,
    "complete",
  );
});
test("expired or currency-mismatched transfer allowance fails closed", async () => {
  const base = await template([fare()], pricedAccess());
  assert.equal(
    pricePlan(base, request, "none", undefined, { today: "2026-12-02" })
      .pricingCompleteness,
    "required-transfer-unpriced",
  );
  if (base.transport.arrival?.onwardTransfer.status !== "estimate")
    throw Error();
  base.transport.arrival.onwardTransfer.perPersonReturn.currency = "CHF";
  assert.equal(
    pricePlan(base, request).pricingCompleteness,
    "required-transfer-unpriced",
  );
});
test("canonical reload restores all gateway groups and remains usable with no fare or provider failure", async () => {
  const d = data();
  d.records[0].gateways[1].providerCityCode = "ITM";
  const p = await setup([], d);
  const queries: string[] = [];
  p.discovery = {
    async discover(r) {
      queries.push(r.destination!.iataCodes![0]);
      return { status: "unavailable", reason: "provider-error" };
    },
  };
  const result = await getTripTemplates(request, p, subject);
  assert.deepEqual(queries, ["OSA", "ITM"]);
  assert.equal(result.templates.length, 1);
  const plan = pricePlan(result.templates[0], request);
  assert.equal(plan.id, subject);
  assert.equal(plan.pricingCompleteness, "required-transfer-unpriced");
  assert.equal(matchingFlight(plan), undefined);
  assert.equal(plan.budget, undefined);
});
test("reference and stale fares do not price the flight; handoff uses selected trip dates", async () => {
  const f = fare();
  f.scope.dates = {
    startDate: "2026-11-12",
    endDate: "2026-11-14",
    flexibleDays: 0,
  };
  const plan = pricePlan(await template([f]), request);
  assert.ok(referenceFlight(plan));
  assert.equal(matchingFlight(plan), undefined);
  assert.equal(
    plan.costs.some((c) => c.category === "transport"),
    false,
  );
  assert.equal(flightHandoff(plan)?.destinationCode, "KIX");
  assert.equal(flightHandoff(plan)?.departureDate, request.dates.startDate);
  f.price.source = { status: "stale", reason: "expired" };
  assert.equal(
    matchingFlight(pricePlan(await template([f]), request)),
    undefined,
  );
});
for (const airport of ["KIX", "ITM", "OSA"])
  test(`affiliate preserves ${airport} endpoint`, async () => {
    const f = fare(airport);
    if (airport === "OSA") delete f.destinationAirport;
    const plan = pricePlan(await template([f]), request);
    assert.equal(flightHandoff(plan)?.destinationCode, airport);
    assert.equal(flightHandoff(plan)?.originCode, "ZRH");
    assert.equal(flightHandoff(plan)?.returnDate, request.dates.endDate);
    assert.ok(!JSON.stringify(flightHandoff(plan)).includes(subject));
  });
test("flexible and weekend gateway fares keep actual displayed dates", async () => {
  const f = fare();
  f.scope.dates = {
    startDate: "2026-11-21",
    endDate: "2026-11-23",
    flexibleDays: 0,
  };
  for (const dates of [
    { ...request.dates, flexibleDays: 3 },
    { ...request.dates, mode: "weekends" as const, month: "2026-11" },
  ]) {
    const r = { ...request, dates },
      p = await setup([f]);
    const b = (await getTripTemplates(r, p, subject)).templates[0];
    const plan = pricePlan(b, r);
    assert.equal(flightHandoff(plan)?.departureDate, "2026-11-21");
    assert.equal(plan.request.dates.startDate, "2026-11-21");
  }
});
test("draft access cannot add a search candidate; domestic still skips discovery", async () => {
  const d = data();
  d.records[0].reviewStatus = "draft";
  const p = await setup([fare()], d);
  assert.ok(
    !(await getTripTemplates(request, p)).templates.some(
      (t) => t.id === subject,
    ),
  );
  let calls = 0;
  p.discovery = {
    async discover() {
      calls++;
      throw Error();
    },
  };
  await getTripTemplates(
    { ...request, originId: "prishtina", scope: "domestic" },
    p,
  );
  assert.equal(calls, 0);
});
test("content and media use canonical subject; Paris current and drafts remain contained", async () => {
  assert.equal(
    (await approvedDestinationContent.get(subject)).status,
    "reviewed",
  );
  assert.equal(
    (await approvedDestinationContent.get("paris")).status,
    "reviewed",
  );
  for (const id of ["new-york", "bali"])
    assert.notEqual(
      (await approvedDestinationContent.get(id)).status,
      "reviewed",
    );
  const ids: string[] = [];
  const images = createDestinationImages(
    [],
    {
      async get(id) {
        ids.push(id);
        return { status: "none", reason: "missing-selection" };
      },
    },
    store(),
  );
  assert.equal(await images.forDestination(subject), undefined);
  assert.deepEqual(ids, [subject]);
});
test("direct Paris and both Crete airports preserve exact destination ID and pricing", async () => {
  const p = await createTravelProviders(
    { TRAVELPAYOUTS_API_TOKEN: "fixture" },
    async () => Response.json([]),
    false,
    request,
  );
  p.destinationAccess = store();
  p.destinationResolver = {
    async resolve() {
      return [];
    },
  };
  for (const [code, id] of [
    ["PAR", "paris"],
    ["HER", "crete"],
    ["CHQ", "crete"],
  ]) {
    const f = fare(code, code);
    p.discovery = {
      async discover() {
        return { status: "available", value: { fares: [f], diagnostics: [] } };
      },
    };
    const plan = pricePlan(
      (await getTripTemplates(request, p, id)).templates[0],
      request,
    );
    assert.equal(plan.id, id);
    assert.equal(plan.arrival, undefined);
    assert.equal(plan.pricingCompleteness, "complete");
    assert.ok(
      plan.costs
        .flatMap((c) => c.planning ?? [])
        .some((p) => p.component === "arrivalTransport"),
    );
  }
});

test("unpriced flight with a known transfer retains the transfer in its ceiling", async () => {
  const f = fare();
  f.scope.dates = {
    startDate: "2026-11-12",
    endDate: "2026-11-14",
    flexibleDays: 0,
  };
  const plan = pricePlan(
    await template([f], pricedAccess()),
    request,
    "none",
    undefined,
    { today: "2026-10-14" },
  );
  assert.equal(plan.pricingCompleteness, "flight-unpriced");
  assert.equal(
    plan.costs.find((c) => c.category === "gatewayTransfer")?.amount.cents,
    6000,
  );
  assert.equal(plan.budget, undefined);
});
test("gateway estimates cannot make a city-only fare look airport-specific", () => {
  const a = store(pricedAccess()).get(subject)!;
  const f = fare();
  delete f.destinationAirport;
  assert.equal(arrivalAccess(a, f)?.onwardTransfer.status, "unpriced");
});
test("many gateway groups restore with bounded concurrency and recent evidence first", async () => {
  const d = data();
  d.records[0].gateways[1].providerCityCode = "ITM";
  const p = await setup([], d);
  let active = 0,
    max = 0;
  p.discovery = {
    async discover(r) {
      max = Math.max(max, ++active);
      await Promise.resolve();
      active--;
      const f = fare(
        r.destination!.cityCode === "ITM" ? "ITM" : "KIX",
        r.destination!.cityCode,
      );
      if (r.destination!.cityCode !== "ITM")
        f.scope.dates = {
          startDate: "2026-11-12",
          endDate: "2026-11-14",
          flexibleDays: 0,
        };
      return { status: "available", value: { fares: [f], diagnostics: [] } };
    },
  };
  const result = await getTripTemplates(request, p, subject);
  assert.equal(max, 2); // Target groups share the bounded worker pool; no sequential waterfall.
  const chosen = curate(
    result.templates.map((t) => pricePlan(t, request)),
    request,
  ).ideas[0];
  assert.equal(chosen.arrival?.airportCode, "ITM");
  assert.ok(matchingFlight(chosen));
});
test("runtime access has no path to official sites, research or AI", () => {
  const fetcher = globalThis.fetch;
  globalThis.fetch = async () => {
    throw Error("forbidden runtime fetch");
  };
  try {
    assert.equal(store().forFare(fare()).length, 1);
  } finally {
    globalThis.fetch = fetcher;
  }
});

test("gateway-only AI explanation input makes zero provider calls", async () => {
  const plan = pricePlan(await template(), request);
  let calls = 0;
  const result = await explainTrips(true, [plan], "en", {
    async explain() {
      calls++;
      throw Error("must not call");
    },
  });
  assert.deepEqual(result, {});
  assert.equal(calls, 0);
});
test("synthetic city, two-gateway island and nature destinations survive the trip pipeline", async () => {
  const d = data(),
    identities = structuredClone(places);
  for (const placeKind of ["city", "island", "nature-area"] as const) {
    const id = `test:${placeKind}`;
    identities.push({
      ...identities.find((p) => p.subject === subject)!,
      subject: id,
      name: "Synthetic place",
      placeKind,
    });
    d.records.push({
      ...structuredClone(d.records[0]),
      destinationSubject: id,
    });
  }
  for (const airport of ["KIX", "ITM"]) {
    const result = await getTripTemplates(
      request,
      await setup([fare(airport)], d, identities),
    );
    for (const id of ["test:city", "test:island", "test:nature-area"]) {
      const base = result.templates.find((t) => t.id === id)!;
      assert.ok(base);
      const plan = pricePlan(base, request);
      assert.equal(plan.arrival?.airportCode, airport);
      assert.equal(plan.pricingCompleteness, "required-transfer-unpriced");
      assert.equal(flightHandoff(plan)?.destinationCode, airport);
    }
  }
});
