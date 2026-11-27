// Historical record/access regression. Live archive exclusion is tested in destination-archive.test.ts.
import assert from "node:assert/strict";
import { test } from "node:test";
import { destinationAccessData } from "./fixtures/archived-destination-data";
import { placeRegistryData } from "../content/places/records";
import { createDestinationAccessStore } from "../src/travel/runtime/access-store";
import { createTravelProviders } from "./fixtures/archived-destination-data";
import { createTravelpayoutsDiscovery } from "./flight-provider-fixture";
import {
  defaultRequest,
  parseRequest,
  requestQuery,
} from "../src/domain/request";
import { getTripTemplates } from "../src/services/travel";
import { getAppTripTemplates } from "../src/services/app-travel";
import {
  reviewedDetailArrival,
  selectTripDetailTemplate,
} from "../src/services/trip-detail-selection";
import { pricePlan } from "../src/domain/pricing";
import { matchingFlight, referenceFlight } from "../src/domain/flight-pricing";
import { flightHandoff } from "../src/domain/affiliate";
import { curate } from "../src/domain/ranking";
import type { TripRequest, TripPlan } from "../src/domain/types";
import type { DestinationAccessStore } from "../src/domain/destination-access/types";

const kruger = "place:Q24451";
const now = new Date("2026-10-15T16:30:00Z");
const makeStore = () =>
  createDestinationAccessStore(
    destinationAccessData,
    placeRegistryData.records,
    () => +now,
  );
const request: TripRequest = {
  ...defaultRequest,
  originId: "zurich",
  budget: { cents: 300000, currency: "EUR" },
  party: { adults: 2, children: 1 },
  when: "custom",
  dates: { startDate: "2026-11-20", endDate: "2026-11-22", flexibleDays: 0 },
  nights: 2,
};
const krugerRoutes = [
  { group: "SZK", airport: "SZK" },
  { group: "NLP", airport: "MQP" },
  { group: "HDS", airport: "HDS" },
  { group: "PHW", airport: "PHW" },
];
// All fare amounts and observations below are synthetic, never live inventory.
const row = (
  airport: string,
  group = krugerRoutes.find((r) => r.airport === airport)!.group,
  price = 200,
) => ({
  origin: "ZRH",
  origin_airport: "ZRH",
  destination: group,
  destination_airport: airport,
  price,
  departure_at: request.dates.startDate,
  return_at: request.dates.endDate,
  found_at: now.toISOString(),
});
type FareRow = Omit<ReturnType<typeof row>, "destination_airport"> & {
  destination_airport?: string;
};
async function setup(
  rows: FareRow[],
  mode: "normal" | "failure" | "timeout" | "disabled" = "normal",
  store: DestinationAccessStore | undefined = makeStore(),
  r = request,
) {
  const queries: string[] = [];
  const providers = await createTravelProviders(
    {},
    async () => assert.fail("No external metadata"),
    false,
    r,
  );
  providers.destinationAccess = store;
  if (mode !== "disabled")
    providers.discovery = createTravelpayoutsDiscovery(
      "synthetic-arrival-continuity",
      async (url) => {
        const query = new URL(url).searchParams;
        const target = query.get("destination");
        queries.push(target ?? "BROAD");
        if (mode === "failure") return new Response(null, { status: 503 });
        if (mode === "timeout") return new Promise(() => {});
        return Response.json({
          success: true,
          currency: "EUR",
          data: rows.filter(
            (r) =>
              r.origin === query.get("origin") &&
              (!target || target === r.destination),
          ),
        });
      },
      () => now,
      100,
    );
  return { providers, queries };
}
function link(plan: TripPlan) {
  return `/plan/trips/${encodeURIComponent(plan.destination.id)}?${requestQuery(plan.request)}`;
}
function readLink(path: string) {
  const url = new URL(path, "https://goeksplo.com");
  return {
    id: decodeURIComponent(url.pathname.split("/").pop()!),
    request: parseRequest(Object.fromEntries(url.searchParams)),
  };
}
async function discoverLink(airport: string, r = request, fare = row(airport)) {
  const s = await setup([fare]);
  const search = await getTripTemplates(r, s.providers);
  const plan = curate(
    search.templates.map((t) => pricePlan(t, r)),
    r,
  ).cards.find((p) => p.id === kruger)!;
  assert.ok(plan);
  const path = link(plan);
  assert.deepEqual(readLink(path).request.arrivalEntry, {
    destinationId: kruger,
    code: airport,
  });
  return { path, plan };
}
async function restore(
  path: string,
  rows: FareRow[],
  mode: "normal" | "failure" | "timeout" | "disabled" = "normal",
  store = makeStore(),
) {
  const saved = readLink(path);
  const s = await setup(rows, mode, store);
  const search = await getTripTemplates(saved.request, s.providers, saved.id);
  const base = selectTripDetailTemplate(
    search.templates,
    saved.request,
    saved.id,
    store.get(saved.id),
  );
  assert.ok(
    base,
    "The saved reviewed arrival must survive as a detail candidate",
  );
  return { ...s, search, plan: pricePlan(base, saved.request) };
}
function sameArrival(plan: TripPlan, airport: string, saved: TripRequest) {
  assert.equal(plan.destination.id, kruger);
  assert.deepEqual(flightHandoff(plan), {
    originCode: "ZRH",
    destinationCode: airport,
    departureDate: saved.dates.startDate,
    returnDate: saved.dates.endDate,
    party: saved.party,
  });
  assert.deepEqual(plan.request.arrivalEntry, {
    destinationId: kruger,
    code: airport,
  });
  if (airport === "SZK") {
    assert.equal(plan.arrival, undefined);
    assert.equal(plan.directArrival?.airportCode, "SZK");
  } else {
    assert.equal(plan.directArrival, undefined);
    assert.equal(plan.arrival?.airportCode, airport);
    assert.equal(plan.arrival?.onwardTransfer.status, "unpriced");
    assert.equal(plan.arrival?.onwardTransfer.required, true);
    assert.equal(plan.budget, undefined);
    assert.equal(plan.pricingCompleteness, "required-transfer-unpriced");
  }
}
for (const { airport, group } of krugerRoutes) {
  for (const mode of [
    "matching",
    "changed",
    "missing",
    "competitor",
    "failure",
    "timeout",
    "reference",
    "stale",
    "disabled",
  ] as const)
    test(`${airport} saved arrival: ${mode} retains endpoint, relationship, dates and party`, async (t) => {
      const { path } = await discoverLink(airport);
      const saved = readLink(path).request;
      const competitor = airport === "SZK" ? "MQP" : "SZK";
      const selected = row(airport, group, mode === "changed" ? 350 : 200);
      if (mode === "stale") selected.found_at = "2026-09-01T00:00:00Z";
      if (mode === "reference") {
        selected.departure_at = "2026-11-18";
        selected.return_at = "2026-11-20";
      }
      const rows =
        mode === "matching" ||
        mode === "changed" ||
        mode === "reference" ||
        mode === "stale"
          ? [selected, row(competitor, undefined, 10)]
          : mode === "competitor"
            ? [row(competitor, undefined, 10)]
            : [];
      if (mode === "timeout") t.mock.timers.enable({ apis: ["setTimeout"] });
      const pending = restore(
        path,
        rows,
        mode === "failure" || mode === "timeout" || mode === "disabled"
          ? mode
          : "normal",
      );
      if (mode === "timeout") {
        // Drain setup microtasks, then expire the synthetic adapter without sleeps.
        await new Promise<void>((resolve) => setImmediate(resolve));
        t.mock.timers.tick(100);
      }
      const { plan, queries, search } = await pending;
      sameArrival(plan, airport, saved);
      if (mode !== "disabled")
        assert.deepEqual(
          queries,
          [...new Set([group, "SZK", "NLP", "HDS"])].slice(0, 3),
        );
      assert.ok(queries.length <= 3);
      if (mode === "matching" || mode === "changed") {
        assert.equal(matchingFlight(plan)?.destinationAirport, airport);
        assert.equal(
          matchingFlight(plan)?.price.amount.cents,
          mode === "changed" ? 35000 : 20000,
        );
      } else {
        assert.equal(matchingFlight(plan), undefined);
        assert.equal(plan.budget, undefined);
        assert.notEqual(plan.pricingCompleteness, "complete");
        assert.ok(!plan.costs.some((c) => c.category === "transport"));
        assert.equal(
          plan.flightPricing?.kind,
          mode === "reference" ? "reference" : "unavailable",
        );
        if (mode === "reference")
          assert.equal(referenceFlight(plan)?.destinationAirport, airport);
      }
      assert.equal(
        search.diagnostics?.some((d) => d.code === "provider-failed") ?? false,
        mode === "failure" || mode === "timeout",
      );
    });
}

test("audit reproduction: the identical generated MQP URL cannot switch to current SZK evidence", async () => {
  const { path } = await discoverLink("MQP");
  const before = await restore(path, [row("MQP")]);
  const after = await restore(path, [row("SZK")]);
  assert.equal(matchingFlight(before.plan)?.destinationAirport, "MQP");
  assert.equal(matchingFlight(after.plan), undefined);
  assert.equal(flightHandoff(after.plan)?.destinationCode, "MQP");
  assert.equal(after.plan.budget, undefined);
  assert.equal(after.plan.arrival?.onwardTransfer.status, "unpriced");
  assert.equal(link(after.plan), path);
});

for (const { airport } of krugerRoutes)
  for (const mode of ["flexible", "weekend"] as const)
    test(`${airport} ${mode} generated link retains actual dates when the fare disappears`, async () => {
      const r: TripRequest = {
        ...request,
        dates:
          mode === "flexible"
            ? { ...request.dates, flexibleDays: 3 }
            : { ...request.dates, mode: "weekends", month: "2026-11" },
      };
      const fare = {
        ...row(airport),
        departure_at: "2026-11-21",
        return_at: "2026-11-23",
      };
      const { path, plan } = await discoverLink(airport, r, fare);
      assert.equal(plan.request.dates.startDate, "2026-11-21");
      assert.equal(plan.request.dates.endDate, "2026-11-23");
      const after = await restore(path, [
        row(airport === "SZK" ? "MQP" : "SZK"),
      ]);
      sameArrival(after.plan, airport, readLink(path).request);
      assert.equal(after.plan.budget, undefined);
    });

for (const hint of [
  { destinationId: kruger, code: "XXX" },
  { destinationId: "place:Q34600", code: "MQP" },
])
  test(`invalid saved arrival ${hint.destinationId}/${hint.code} cannot select an endpoint`, async () => {
    const r = { ...request, arrivalEntry: hint };
    const s = await setup([row("SZK")]);
    const search = await getTripTemplates(r, s.providers, kruger);
    const access = s.providers.destinationAccess!.get(kruger)!;
    assert.equal(reviewedDetailArrival(kruger, r, access), undefined);
    const base = selectTripDetailTemplate(search.templates, r, kruger, access)!;
    assert.ok(base);
    assert.equal(flightHandoff(pricePlan(base, r))?.destinationCode, "SZK");
    assert.deepEqual(s.queries, ["SZK", "NLP", "HDS"]);
  });

test("an ambiguous group hint cannot lock an airport or attach group-only evidence to MQP", async () => {
  const store = makeStore();
  const synthetic = structuredClone(store.get(kruger)!);
  // Synthetic ambiguity only; never change reviewed production access records.
  synthetic.gateways.push({ ...synthetic.gateways[0], airportCode: "AAA" });
  const ambiguous = {
    ...store,
    get: (id: string) => (id === kruger ? synthetic : store.get(id)),
  };
  const r = {
    ...request,
    arrivalEntry: { destinationId: kruger, code: "NLP" },
  };
  const s = await setup([row("SZK")], "normal", ambiguous);
  const search = await getTripTemplates(r, s.providers, kruger);
  assert.equal(reviewedDetailArrival(kruger, r, synthetic), undefined);
  assert.equal(
    flightHandoff(
      pricePlan(
        selectTripDetailTemplate(search.templates, r, kruger, synthetic)!,
        r,
      ),
    )?.destinationCode,
    "SZK",
  );
  const { path } = await discoverLink("MQP");
  const groupOnly = {
    ...row("MQP"),
    destination_airport: undefined,
  } as unknown as FareRow;
  const after = await restore(path, [groupOnly, row("SZK")]);
  assert.equal(matchingFlight(after.plan), undefined);
  assert.equal(flightHandoff(after.plan)?.destinationCode, "MQP");
});

for (const mode of ["missing", "expired", "draft"] as const)
  test(`${mode} reviewed access cannot be revived by a saved arrival URL`, async () => {
    const { path } = await discoverLink("MQP");
    const saved = readLink(path);
    const data = structuredClone(destinationAccessData);
    const profile = data.records.find((r) => r.destinationSubject === kruger)!;
    if (mode === "draft") {
      profile.reviewStatus = "draft";
      profile.reviewedAt = null;
    }
    const store = createDestinationAccessStore(
      data,
      placeRegistryData.records,
      () => (mode === "expired" ? Date.parse("2027-01-11T00:00:00Z") : +now),
    );
    const s = await setup([row("MQP"), row("SZK")], "normal", store);
    if (mode === "missing") s.providers.destinationAccess = undefined;
    const search = await getTripTemplates(saved.request, s.providers, kruger);
    assert.equal(search.templates.length, 0);
    assert.equal(s.queries.length, 0);
    assert.equal(
      selectTripDetailTemplate(
        search.templates,
        saved.request,
        kruger,
        s.providers.destinationAccess?.get(kruger),
      ),
      undefined,
    );
  });

test("detail selection rejects another arrival even when global discovery ranks it first", async () => {
  const { path } = await discoverLink("MQP");
  const saved = readLink(path).request;
  const broad = await setup(krugerRoutes.map((r) => row(r.airport)));
  // Ordinary discovery must ignore a restoration hint and retain competition.
  const search = await getTripTemplates(saved, broad.providers);
  const templates = search.templates.filter((t) => t.id === kruger);
  assert.equal(templates.length, 4);
  assert.equal(
    flightHandoff(
      curate(
        templates.map((t) => pricePlan(t, saved)),
        saved,
      ).cards[0],
    )?.destinationCode,
    "SZK",
  );
  const selected = selectTripDetailTemplate(
    templates,
    saved,
    kruger,
    makeStore().get(kruger),
  )!;
  assert.equal(
    flightHandoff(pricePlan(selected, saved))?.destinationCode,
    "MQP",
  );
  assert.equal(
    selectTripDetailTemplate(
      templates.filter((t) => !t.transport.arrival),
      saved,
      kruger,
      makeStore().get(kruger),
    ),
    undefined,
  );
  assert.equal(
    selectTripDetailTemplate(
      templates,
      { ...saved, departureAirport: "LHR" },
      kruger,
      makeStore().get(kruger),
    ),
    undefined,
  );
});

test("legacy no-arrival link retains the existing best approach selection", async () => {
  const s = await setup([row("SZK"), row("MQP")]);
  const search = await getTripTemplates(request, s.providers, kruger);
  const base = selectTripDetailTemplate(
    search.templates,
    request,
    kruger,
    makeStore().get(kruger),
  )!;
  assert.equal(flightHandoff(pricePlan(base, request))?.destinationCode, "SZK");
});

for (const { id, group, airport, competitor } of [
  { id: "place:Q60", group: "NYC", airport: "EWR", competitor: "JFK" },
  { id: "place:Q1490", group: "TYO", airport: "HND", competitor: "NRT" },
  { id: "place:Q34600", group: "OSA", airport: "KIX", competitor: "ITM" },
  { id: "place:Q3593416", group: "BWT", airport: "BWT", competitor: "HBA" },
])
  for (const mode of ["matching", "competing", "legacy"] as const)
    test(`${id} ${mode}: non-mixed arrival restoration preserves its model`, async () => {
      const hint = { destinationId: id, code: airport };
      const r = {
        ...request,
        arrivalEntry: mode === "legacy" ? undefined : hint,
      };
      const rows = [
        row(competitor, id === "place:Q3593416" ? "HBA" : group, 10),
      ];
      if (mode === "matching") rows.push(row(airport, group, 200));
      const s = await setup(rows);
      const search = await getTripTemplates(r, s.providers, id);
      const base = selectTripDetailTemplate(
        search.templates,
        r,
        id,
        makeStore().get(id),
      )!;
      assert.ok(base);
      const plan = pricePlan(base, r);
      assert.equal(
        flightHandoff(plan)?.destinationCode,
        mode === "legacy" ? competitor : airport,
      );
      if (mode === "competing") {
        assert.equal(matchingFlight(plan), undefined);
        assert.equal(plan.budget, undefined);
      } else assert.ok(matchingFlight(plan));
      assert.equal(!!plan.arrival, id === "place:Q34600");
      assert.ok(s.queries.length <= 3);
    });

test("forged URL prices and provider evidence are ignored", async () => {
  const { path } = await discoverLink("MQP");
  const forged =
    path +
    "&price=1&flightPrice=1&confidence=recent&destinationAirport=SZK&fare=" +
    encodeURIComponent(JSON.stringify(row("SZK")));
  const { plan } = await restore(forged, []);
  assert.equal(matchingFlight(plan), undefined);
  assert.equal(plan.budget, undefined);
  assert.equal(flightHandoff(plan)?.destinationCode, "MQP");
});

test("conflicting explicit airport selection and ambiguous direct city groups cannot pin an arrival", async () => {
  const id = "place:Q1490";
  const access = makeStore().get(id)!;
  for (const code of ["TYO", "HND"]) {
    const r: TripRequest = {
      ...request,
      arrivalEntry: { destinationId: id, code },
      ...(code === "HND"
        ? {
            destination: {
              id: "airport:NRT",
              type: "airport" as const,
              airportIata: "NRT",
              cityCode: "TYO",
              iataCodes: ["NRT", "TYO"],
              name: "Narita",
              countryCode: "JP",
              countryName: { en: "Japan", sq: "Japonia" },
            },
          }
        : {}),
    };
    assert.equal(reviewedDetailArrival(id, r, access), undefined);
    const s = await setup([row("NRT", "TYO")]);
    const search = await getTripTemplates(r, s.providers, id);
    const base = selectTripDetailTemplate(search.templates, r, id, access)!;
    assert.ok(base);
    assert.equal(flightHandoff(pricePlan(base, r))?.destinationCode, "NRT");
  }
});

for (const pin of ["DXB", "DWC"])
  for (const evidence of ["group", "DXB", "DWC", "reference", "stale"] as const)
    test(`Dubai pin ${pin}: ${evidence} evidence must establish its operational airport`, async () => {
      const id = "place:Q612";
      const r = { ...request, arrivalEntry: { destinationId: id, code: pin } };
      const fare: FareRow = {
        ...row("DXB", "DXB"),
        destination_airport: undefined,
      };
      if (evidence === "DXB" || evidence === "DWC")
        fare.destination_airport = evidence;
      if (evidence === "reference") {
        fare.departure_at = "2026-11-18";
        fare.return_at = "2026-11-20";
      }
      if (evidence === "stale") fare.found_at = "2026-09-01T00:00:00Z";
      const s = await setup([fare]);
      const search = await getTripTemplates(r, s.providers, id);
      const base = selectTripDetailTemplate(
        search.templates,
        r,
        id,
        makeStore().get(id),
      )!;
      assert.ok(base);
      const plan = pricePlan(base, r);
      assert.equal(plan.directArrival?.airportCode, pin);
      assert.equal(flightHandoff(plan)?.destinationCode, pin);
      assert.equal(
        plan.flightPricing?.kind,
        evidence === pin ? "priced" : "unavailable",
      );
      if (evidence === pin)
        assert.equal(matchingFlight(plan)?.destinationAirport, pin);
      else {
        assert.equal(plan.budget, undefined);
        assert.equal(plan.pricingCompleteness, "flight-unpriced");
        assert.ok(!plan.costs.some((c) => c.category === "transport"));
      }
    });

for (const { id, airport } of [
  { id: kruger, airport: "SZK" },
  { id: "place:Q2656389", airport: "MRU" },
])
  for (const evidence of ["current", "reference", "stale"] as const)
    test(`${airport} unambiguous group-only ${evidence}: preserve existing evidence semantics`, async () => {
      const r = {
        ...request,
        arrivalEntry: { destinationId: id, code: airport },
      };
      const fare: FareRow = {
        ...row(airport, airport),
        destination_airport: undefined,
      };
      if (evidence === "reference") {
        fare.departure_at = "2026-11-18";
        fare.return_at = "2026-11-20";
      }
      if (evidence === "stale") fare.found_at = "2026-09-01T00:00:00Z";
      const s = await setup([fare]);
      const search = await getTripTemplates(r, s.providers, id);
      const base = selectTripDetailTemplate(
        search.templates,
        r,
        id,
        makeStore().get(id),
      )!;
      assert.ok(base);
      const plan = pricePlan(base, r);
      assert.equal(flightHandoff(plan)?.destinationCode, airport);
      assert.equal(
        plan.flightPricing?.kind,
        evidence === "current"
          ? "priced"
          : evidence === "reference"
            ? "reference"
            : "unavailable",
      );
      if (evidence !== "current") assert.equal(plan.budget, undefined);
    });

test("ambiguous Dubai city fares remain usable for ordinary group-level discovery", async () => {
  const s = await setup([
    { ...row("DXB", "DXB"), destination_airport: undefined },
  ]);
  const search = await getTripTemplates(request, s.providers);
  const base = search.templates.find((t) => t.id === "place:Q612")!;
  assert.ok(base);
  const plan = pricePlan(base, request);
  assert.equal(plan.flightPricing?.kind, "priced");
  assert.equal(plan.directArrival, undefined);
  assert.equal(matchingFlight(plan)?.destinationAirport, undefined);
});

const nearbyRequest: TripRequest = {
  ...request,
  originId: "prishtina",
  destination: {
    id: "country:ZA",
    type: "country",
    name: "South Africa",
    countryCode: "ZA",
    countryName: { en: "South Africa", sq: "Afrika e Jugut" },
  },
  preferences: { ...request.preferences, nearbyAirports: true },
};
async function nearbyLink() {
  const fare = { ...row("MQP"), origin: "SKP", origin_airport: "SKP" };
  const s = await setup([fare], "normal", makeStore(), nearbyRequest);
  const search = await getTripTemplates(nearbyRequest, s.providers);
  const plan = curate(
    search.templates.map((t) => pricePlan(t, nearbyRequest)),
    nearbyRequest,
  ).cards.find((p) => p.id === kruger)!;
  assert.ok(plan);
  assert.equal(flightHandoff(plan)?.originCode, "SKP");
  const saved = readLink(link(plan));
  assert.equal(saved.request.departureAirport, "SKP");
  assert.deepEqual(saved.request.dates, nearbyRequest.dates);
  assert.deepEqual(saved.request.party, nearbyRequest.party);
  assert.equal(saved.request.nights, nearbyRequest.nights);
  assert.deepEqual(saved.request.arrivalEntry, {
    destinationId: kruger,
    code: "MQP",
  });
  return saved;
}
function assertNearbyPlan(plan: TripPlan, saved: TripRequest, priced = false) {
  assert.deepEqual(flightHandoff(plan), {
    originCode: "SKP",
    destinationCode: "MQP",
    departureDate: saved.dates.startDate,
    returnDate: saved.dates.endDate,
    party: saved.party,
  });
  assert.equal(plan.departure?.code, "SKP");
  assert.equal(plan.arrival?.airportCode, "MQP");
  assert.equal(plan.arrival?.onwardTransfer.required, true);
  assert.equal(plan.arrival?.onwardTransfer.status, "unpriced");
  assert.equal(plan.budget, undefined);
  assert.equal(plan.pricingCompleteness, "required-transfer-unpriced");
  if (priced) assert.equal(matchingFlight(plan)?.originAirport, "SKP");
  else {
    assert.equal(matchingFlight(plan), undefined);
    assert.equal(plan.flightPricing?.kind, "unavailable");
    assert.ok(!plan.costs.some((c) => c.category === "transport"));
  }
}
for (const mode of [
  "current",
  "empty",
  "primary-only",
  "failure",
  "timeout",
  "disabled",
] as const)
  test(`generated nearby SKP→MQP link restores ${mode} without a departure substitution`, async (t) => {
    const saved = await nearbyLink();
    const rows =
      mode === "current"
        ? [{ ...row("MQP"), origin: "SKP", origin_airport: "SKP" }]
        : mode === "primary-only"
          ? [{ ...row("MQP"), origin: "PRN", origin_airport: "PRN" }]
          : [];
    const s = await setup(
      rows,
      mode === "current" || mode === "empty" || mode === "primary-only"
        ? "normal"
        : mode,
      makeStore(),
      saved.request,
    );
    if (mode === "timeout") t.mock.timers.enable({ apis: ["setTimeout"] });
    const pending = getTripTemplates(saved.request, s.providers, saved.id);
    if (mode === "timeout") {
      await new Promise<void>((resolve) => setImmediate(resolve));
      t.mock.timers.tick(4500);
    }
    const search = await pending;
    const base = selectTripDetailTemplate(
      search.templates,
      saved.request,
      saved.id,
      makeStore().get(saved.id),
    );
    assert.ok(
      base,
      "Saved trusted nearby departure must survive absent discovery evidence",
    );
    assertNearbyPlan(
      pricePlan(base, saved.request),
      saved.request,
      mode === "current",
    );
    assert.ok(s.queries.length <= 9);
    if (mode === "disabled") assert.equal(s.queries.length, 0);
    assert.equal(
      search.diagnostics?.some((d) => d.code === "provider-failed") ?? false,
      mode === "failure" || mode === "timeout",
    );
  });

for (const change of [
  "unsupported",
  "nearby-off",
  "nearby-unavailable",
] as const)
  test(`saved nearby departure fails closed when ${change}`, async () => {
    const saved = await nearbyLink();
    const r = { ...saved.request };
    if (change === "unsupported") r.departureAirport = "XXX";
    if (change === "nearby-off")
      r.preferences = { ...r.preferences, nearbyAirports: false };
    const s = await setup([], "disabled", makeStore(), r);
    if (change === "nearby-unavailable") s.providers.nearbyAirports = undefined;
    const search = await getTripTemplates(r, s.providers, saved.id);
    assert.equal(
      selectTripDetailTemplate(
        search.templates,
        r,
        saved.id,
        makeStore().get(saved.id),
      ),
      undefined,
    );
    assert.equal(s.queries.length, 0);
  });

test("production rate-limit fallback keeps archived SKP→Kruger unavailable with zero flight calls", async (t) => {
  const saved = await nearbyLink();
  const env = {
    VERCEL: "1",
    VERCEL_ENV: "production",
    NODE_ENV: "production",
    RATE_LIMIT_REDIS_REST_URL: "https://synthetic-arrival-quota.upstash.io",
    RATE_LIMIT_REDIS_REST_TOKEN: "synthetic-arrival-quota",
    TRAVELPAYOUTS_API_TOKEN: "synthetic-unused-flight-token",
    GOEKSPLO_LOG_LEVEL: "off",
  };
  const previous = new Map(
    Object.keys(env).map((key) => [key, process.env[key]]),
  );
  Object.assign(process.env, env);
  t.after(() => {
    for (const [key, value] of previous)
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
  });
  t.mock.method(Date, "now", () => +now);
  const calls: string[] = [];
  t.mock.method(
    globalThis,
    "fetch",
    async (input: string | URL | Request, options?: RequestInit) => {
      const url = new URL(String(input));
      calls.push(url.hostname);
      assert.equal(
        url.hostname,
        "synthetic-arrival-quota.upstash.io",
        "No live provider, metadata, imagery or AI calls",
      );
      assert.ok(JSON.parse(String(options?.body))[3].endsWith(":limit:search"));
      return Response.json({ result: 0 });
    },
  );
  const search = await getAppTripTemplates(saved.request, saved.id);
  assert.deepEqual(calls, ["synthetic-arrival-quota.upstash.io"]);
  assert.ok(
    search.issues.some(
      (i) =>
        i.source.status === "unavailable" && i.source.reason === "rate-limit",
    ),
  );
  assert.deepEqual(
    search.templates,
    [],
    "Archived Kruger cannot return through the production fallback",
  );
});
