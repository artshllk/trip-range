// Historical record/access regression. Live archive exclusion is tested in destination-archive.test.ts.
import { test } from "node:test";
import assert from "node:assert/strict";
import { createTravelpayoutsDiscovery } from "./flight-provider-fixture";
import { createTravelProviders } from "./fixtures/archived-destination-data";
import { destinationMetadata } from "../src/providers/server/destination-resolver";
import {
  resolveFlightPricing,
  matchingFlight,
} from "../src/domain/flight-pricing";
import { sortDiscoveryFares } from "../src/domain/discovery";
import { flightQueryPlan } from "../src/domain/flight-query";
import {
  flightDestinations,
  existingAirportCodes,
} from "../src/catalogue/flight-destinations";
import { defaultRequest } from "../src/domain/request";
import { locations } from "../src/catalogue/locations";
import { getTripTemplates } from "../src/services/travel";
import { searchFlightPlan } from "../src/services/flight-search";
import { pricePlan } from "../src/domain/pricing";
import { flightHandoff } from "../src/domain/affiliate";
import { selectedDeparture } from "../src/domain/airports";
import { destinationAccess } from "./fixtures/archived-destination-data";
import type {
  TripRequest,
  FlightDiscovery,
  FlightDiscoveryFare,
} from "../src/domain/types";
import type { ProviderResult } from "../src/providers/contracts";
import type { ProviderFetch } from "../src/providers/server/http";
const origin = locations.find((l) => l.id === "zurich")!;
const request: TripRequest = {
  ...defaultRequest,
  origin,
  originId: origin.id,
  budget: { cents: 300000, currency: "EUR" },
  dates: { startDate: "2026-11-20", endDate: "2026-11-22", flexibleDays: 0 },
  nights: 2,
};
const clock = () => new Date("2026-10-13T18:00:00Z");
const row = (overrides: Record<string, unknown> = {}) => ({
  origin: "ZRH",
  origin_airport: "ZRH",
  destination: "PAR",
  destination_airport: "CDG",
  price: 100,
  currency: "EUR",
  departure_at: request.dates.startDate,
  return_at: request.dates.endDate,
  found_at: "2026-10-13T17:00:00Z",
  ...overrides,
});
const response = (data: unknown[], headers: Record<string, string> = {}) =>
  Response.json({ success: true, currency: "EUR", data }, { headers });
async function discover(
  rows: unknown[],
  r = request,
  headers: Record<string, string> = {},
) {
  return createTravelpayoutsDiscovery(
    "synthetic-secret",
    async () => response(rows, headers),
    clock,
  ).discover(r, origin);
}
async function fares(rows: unknown[], r = request) {
  const result = await discover(rows, r);
  assert.equal(result.status, "available");
  return result.value.fares;
}
for (const [name, first, second, flexibleDays] of [
  [
    "fresh exact before stale exact",
    row({ price: 1, found_at: "2026-10-01T17:00:00Z" }),
    row(),
    0,
  ],
  [
    "fresh flexible before stale exact",
    row({ price: 1, found_at: "2026-10-01T17:00:00Z" }),
    row({ departure_at: "2026-11-21", return_at: "2026-11-23" }),
    3,
  ],
  [
    "fresh reference before stale reference",
    row({
      price: 1,
      departure_at: "2026-11-21",
      return_at: "2026-11-23",
      found_at: "2026-10-01T17:00:00Z",
    }),
    row({ departure_at: "2026-11-24", return_at: "2026-11-26" }),
    0,
  ],
  ["equal quality chooses cheaper", row({ price: 105 }), row(), 0],
] as const)
  test(name, async () => {
    const r = { ...request, dates: { ...request.dates, flexibleDays } };
    const found = await fares([first, second], r);
    assert.equal(sortDiscoveryFares(found, r)[0], found[1]);
    assert.deepEqual(
      sortDiscoveryFares([...found].reverse(), r),
      sortDiscoveryFares(found, r),
    );
  });
test("ties are deterministic across row order; price follows date relevance", async () => {
  const found = await fares([row({ airline: "ZZ" }), row({ airline: "AA" })]);
  assert.equal(sortDiscoveryFares(found, request)[0].airline, "AA");
  assert.deepEqual(
    sortDiscoveryFares(found, request),
    sortDiscoveryFares([...found].reverse(), request),
  );
  const refs = await fares([
    row({ departure_at: "2026-11-26", return_at: "2026-11-28", price: 1 }),
    row({ departure_at: "2026-11-21", return_at: "2026-11-23" }),
  ]);
  assert.equal(sortDiscoveryFares(refs, request)[0].price.amount.cents, 10000);
});
// Policy (2026-10-27): found_at comes from get_latest_prices. A missing or unusable
// found_at still prices (labelled "last checked"); only an observation older than
// the provider's 7-day retention, or in the future, is refused.
for (const [observation, state] of [
  ["2026-10-13T17:00:00Z", "priced"],
  ["2026-10-10T17:00:00Z", "priced"],
  ["2026-10-01T17:00:00Z", "unavailable"],
  [undefined, "priced"],
  ["bad-date", "priced"],
  ["2026-02-30T17:00:00Z", "priced"],
  ["2026-10-14T17:00:00Z", "unavailable"],
] as const)
  test(`observation ${observation ?? "missing"} drives pricing, never fresh HTTP Date`, async () => {
    const result = await discover([row({ found_at: observation })], request, {
      date: clock().toUTCString(),
    });
    assert.equal(result.status, "available");
    const fare = result.value.fares[0];
    assert.equal(resolveFlightPricing(fare, request).kind, state);
    if (state !== "priced") assert.notEqual(fare.price.confidence, "recent");
    // Never invented: an unusable found_at leaves observedAt empty.
    if (!observation || !/^2026-10-1[0-4]T/.test(observation))
      assert.equal(
        fare.price.observedAt,
        observation === "2026-10-01T17:00:00Z"
          ? "2026-10-01T17:00:00.000Z"
          : null,
      );
    assert.equal(fare.retrievedAt, clock().toISOString());
  });
test("cache read rechecks genuine observation; old HTTP Date cannot stale valid evidence", async () => {
  const result = await discover([row()], request, {
    date: "Mon, 12 Oct 2026 17:00:00 GMT",
  });
  assert.equal(result.status, "available");
  assert.equal(
    resolveFlightPricing(result.value.fares[0], request).kind,
    "priced",
  );
  const expired = await createTravelpayoutsDiscovery(
    "synthetic",
    async () => response([row()]),
    () => new Date("2026-10-21T18:00:00Z"),
  ).discover(request, origin);
  assert.equal(expired.status, "available");
  assert.equal(
    resolveFlightPricing(expired.value.fares[0], request).kind,
    "unavailable",
  );
});
test("partial malformed data preserves good rows; all malformed is not successful empty", async () => {
  const badRows = [
    row({ return_at: "2026-02-30" }),
    row({ price: -1 }),
    row({ destination_airport: "<bad>" }),
    row({ origin: "AAA", origin_airport: "BBB" }),
    row({ airline: "<bad>" }),
    row({ transfers: 200 }),
    row({ departure_at: "2026-11-20evil" }),
    row({ return_at: undefined }),
  ];
  for (const bad of badRows)
    assert.deepEqual(await discover([bad]), {
      status: "unavailable",
      reason: "malformed-response",
    });
  const partial = await discover([...badRows, row()]);
  assert.equal(partial.status, "available");
  assert.equal(partial.value.fares.length, 1);
  assert.ok(partial.value.diagnostics.some((d) => d.code === "malformed-row"));
  const empty = await discover([]);
  assert.equal(empty.status, "available");
  assert.deepEqual(empty.value.diagnostics, [
    { code: "provider-empty", count: 1 },
  ]);
});
for (const [status, reason] of [
  [401, "authentication"],
  [403, "authentication"],
  [429, "rate-limit"],
  [500, "unavailable"],
  [503, "unavailable"],
] as const)
  test(`HTTP ${status} remains ${reason}`, async () => {
    const result = await createTravelpayoutsDiscovery(
      "synthetic",
      async () => new Response(null, { status }),
      clock,
    ).discover(request, origin);
    assert.deepEqual(result, { status: "unavailable", reason });
  });
test("timeouts abort; invalid JSON and excessive bodies fail closed", async () => {
  let aborted = false;
  const slow: ProviderFetch = async (_url, options) => {
    options.signal?.addEventListener("abort", () => {
      aborted = true;
    });
    return new Promise(() => {});
  };
  assert.deepEqual(
    await createTravelpayoutsDiscovery("synthetic", slow, clock, 5).discover(
      request,
      origin,
    ),
    { status: "unavailable", reason: "timeout" },
  );
  assert.ok(aborted);
  for (const body of ["{", "x".repeat(2_000_001)])
    assert.deepEqual(
      await createTravelpayoutsDiscovery(
        "synthetic",
        async () => new Response(body),
        clock,
      ).discover(request, origin),
      { status: "unavailable", reason: "malformed-response" },
    );
});
test("malformed and conflicting currencies never use FX or implicit EUR", async () => {
  for (const body of [
    { success: true, data: [row({ currency: null })] },
    { success: true, currency: "USD", data: [row()] },
  ]) {
    const result = await createTravelpayoutsDiscovery(
      "synthetic",
      async () => Response.json(body),
      clock,
    ).discover(request, origin);
    assert.equal(result.status, "unavailable");
  }
});
test("single city, city group, two-airport island and reviewed gateway query plans", () => {
  const vienna = flightDestinations.find((d) => d.id === "vienna")!;
  const paris = flightDestinations.find((d) => d.id === "paris")!;
  assert.deepEqual(
    flightQueryPlan(vienna).targets.map((t) => t?.cityCode),
    ["VIE"],
  );
  assert.deepEqual(
    flightQueryPlan(paris).targets.map((t) => t?.cityCode),
    ["PAR"],
  );
  assert.deepEqual(
    flightQueryPlan({
      ...vienna,
      cityCode: undefined,
      iataCodes: existingAirportCodes.crete,
    }).targets.map((t) => t?.airportIata),
    ["HER", "CHQ"],
  );
  const access = destinationAccess.get("place:Q34600")!;
  assert.deepEqual(
    flightQueryPlan(access.destination, undefined, access).targets.map(
      (t) => t?.cityCode,
    ),
    ["OSA"],
  );
  assert.deepEqual(flightQueryPlan().targets, [undefined]);
});
async function setup(
  mode: "normal" | "empty" | "failure" = "normal",
  airport = "CDG",
) {
  const queries: string[] = [],
    metadata: string[] = [];
  const fetcher: ProviderFetch = async (url) => {
    const u = new URL(url);
    if (u.hostname === "autocomplete.travelpayouts.com") {
      const code = u.searchParams.get("term")!;
      metadata.push(code);
      return Response.json(
        code === "ABC"
          ? [
              {
                code,
                type: "city",
                name: "Synthetic City",
                country_code: "FR",
                country_name: "France",
              },
            ]
          : [],
      );
    }
    assert.equal(u.hostname, "api.travelpayouts.com");
    const target = u.searchParams.get("destination") ?? "broad";
    queries.push(target);
    if (mode === "failure") return new Response(null, { status: 503 });
    if (
      mode === "empty" ||
      target === "broad" ||
      ((target === "HER" || target === "CHQ") && airport !== target)
    )
      return response([]);
    return response([
      row({
        destination: target,
        destination_airport:
          target === "PAR" ? airport : target === "OSA" ? "KIX" : target,
      }),
    ]);
  };
  const providers = await createTravelProviders(
    { TRAVELPAYOUTS_API_TOKEN: "synthetic" },
    fetcher,
    false,
    request,
  );
  providers.discovery = createTravelpayoutsDiscovery(
    "synthetic",
    fetcher,
    clock,
  );
  return { providers, queries, metadata };
}
test("Paris absent from broad top 100 restores with PAR on a fresh composition", async () => {
  const broad = await setup();
  assert.ok(
    !(await getTripTemplates(request, broad.providers)).templates.some(
      (t) => t.id === "paris",
    ),
  );
  const detail = await setup();
  const result = await getTripTemplates(request, detail.providers, "paris");
  assert.deepEqual(detail.queries, ["PAR"]);
  assert.deepEqual(detail.metadata, []);
  assert.equal(result.templates.length, 1);
  assert.equal(
    matchingFlight(pricePlan(result.templates[0], request))?.destinationAirport,
    "CDG",
  );
});
for (const id of ["paris", "crete", "place:Q34600", "city:ABC"])
  for (const mode of ["empty", "failure"] as const)
    test(`${id} retains trusted identity when fare ${mode}`, async () => {
      const fixture = await setup(mode);
      const result = await getTripTemplates(request, fixture.providers, id);
      assert.equal(result.templates.length, 1);
      assert.notEqual(
        pricePlan(result.templates[0], request).pricingCompleteness,
        "complete",
      );
      assert.equal(
        result.issues.some((i) => i.destinationId === "flight-discovery"),
        mode === "failure",
      );
      assert.ok(!fixture.queries.includes("broad"));
      if (id === "place:Q34600")
        assert.equal(
          result.templates[0].transport.arrival?.onwardTransfer.status,
          "unpriced",
        );
    });
for (const airport of ["HER", "CHQ", "NONE"])
  test(`Crete queries both airports and survives ${airport} coverage`, async () => {
    const fixture = await setup("normal", airport);
    const result = await getTripTemplates(request, fixture.providers, "crete");
    assert.deepEqual(fixture.queries, ["HER", "CHQ"]);
    assert.equal(result.templates.length, 1);
    const plan = pricePlan(result.templates[0], request);
    assert.equal(
      plan.flightPricing?.kind,
      airport === "NONE" ? "unavailable" : "priced",
    );
    assert.equal(
      matchingFlight(plan)?.destinationAirport,
      airport === "NONE" ? undefined : airport,
    );
  });
test("dynamic restoration requires exact metadata, never syntax or URL snapshot alone", async () => {
  const fixture = await setup();
  const valid = await getTripTemplates(request, fixture.providers, "city:ABC");
  assert.equal(valid.templates[0].id, "city:ABC");
  assert.deepEqual(fixture.queries, ["ABC"]);
  const unknown = await setup();
  assert.equal(
    (await getTripTemplates(request, unknown.providers, "city:XYZ")).templates
      .length,
    0,
  );
  assert.deepEqual(unknown.queries, []);
});
test("metadata conflicts fail closed and airport coordinates never become city coordinates", () => {
  const city = {
    code: "ABC",
    type: "city",
    name: "Synthetic City",
    country_code: "FR",
    country_name: "France",
    coordinates: { lat: 1, lon: 2 },
  };
  const airport = {
    ...city,
    type: "airport",
    city_code: "ABC",
    city_name: "Synthetic City",
    coordinates: { lat: 3, lon: 4 },
  };
  assert.equal(destinationMetadata([airport], "ABC")?.coordinates, undefined);
  assert.deepEqual(
    destinationMetadata([airport, city], "ABC"),
    destinationMetadata([city, airport], "ABC"),
  );
  assert.equal(
    destinationMetadata(
      [city, { ...city, coordinates: { lat: 4, lon: 5 } }],
      "ABC",
    ),
    undefined,
  );
  assert.equal(
    destinationMetadata([city, { ...city, country_code: "GB" }], "ABC"),
    undefined,
  );
});
test("query deadline bounds slow providers; concurrency at most three, at most nine queries", async () => {
  let active = 0,
    peak = 0,
    calls = 0;
  const departure = selectedDeparture(origin)!;
  const start = Date.now();
  const result = await searchFlightPlan(
    {
      async discover() {
        calls++;
        peak = Math.max(peak, ++active);
        await new Promise(() => {});
        return { status: "available", value: { fares: [], diagnostics: [] } };
      },
    },
    request,
    [departure, departure, departure],
    { kind: "targeted", targets: [origin, origin, origin] },
    20,
  );
  assert.ok(Date.now() - start < 500);
  assert.ok(calls <= 3);
  assert.ok(peak <= 3);
  assert.equal(result.length, 9);
  assert.ok(result.every((r) => r.result.status === "unavailable"));
});
test("shared deadline stays expired when its timer fires before the wall clock catches up", async (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  let now = 1000;
  t.mock.method(Date, "now", () => now);
  let calls = 0,
    active = 0,
    peak = 0;
  const departure = selectedDeparture(origin)!;
  const search = searchFlightPlan(
    {
      async discover() {
        calls++;
        peak = Math.max(peak, ++active);
        return new Promise(() => {});
      },
    },
    request,
    [departure, departure, departure],
    { kind: "targeted", targets: [origin, origin, origin] },
    20,
  );
  assert.equal(calls, 3);
  // Model the timer boundary independently of Date.now(), without real sleeps.
  now = 1019;
  t.mock.timers.tick(20);
  await new Promise<void>((resolve) => setImmediate(resolve));
  assert.equal(calls, 3);
  assert.equal(peak, 3);
  const results = await search;
  assert.equal(results.length, 9);
  assert.ok(
    results.every(
      ({ result }) =>
        result.status === "unavailable" && result.reason === "timeout",
    ),
  );
});
test("fast providers execute all nine tasks with at most three active calls", async (t) => {
  t.mock.timers.enable({ apis: ["setTimeout", "Date"], now: 1000 });
  const scheduleTimeout = t.mock.method(globalThis, "setTimeout");
  const cancelTimeout = t.mock.method(globalThis, "clearTimeout");
  let calls = 0,
    active = 0,
    peak = 0;
  const departure = selectedDeparture(origin)!;
  const results = await searchFlightPlan(
    {
      async discover() {
        const count = ++calls;
        peak = Math.max(peak, ++active);
        await Promise.resolve();
        active--;
        return {
          status: "available",
          value: {
            fares: [],
            diagnostics: [{ code: "provider-empty", count }],
          },
        };
      },
    },
    request,
    [departure, departure, departure],
    { kind: "targeted", targets: [origin, origin, origin] },
    100,
  );
  assert.equal(calls, 9);
  assert.equal(peak, 3);
  assert.equal(active, 0);
  assert.equal(scheduleTimeout.mock.callCount(), 1);
  assert.equal(cancelTimeout.mock.callCount(), 1);
  assert.equal(
    cancelTimeout.mock.calls[0].arguments[0],
    scheduleTimeout.mock.calls[0].result,
  );
  assert.deepEqual(
    results.map(({ result }) =>
      result.status === "available" ? result.value.diagnostics[0].count : null,
    ),
    [1, 2, 3, 4, 5, 6, 7, 8, 9],
  );
});
test("mixed providers refill before the deadline, preserve order and ignore late completion", async (t) => {
  t.mock.timers.enable({ apis: ["setTimeout", "Date"], now: 1000 });
  const pending: {
    resolve: (result: ProviderResult<FlightDiscovery>) => void;
    reject: (error: Error) => void;
  }[] = [];
  const budgets: number[] = [];
  let active = 0,
    peak = 0;
  const departure = selectedDeparture(origin)!;
  const departures = ["ZRH", "BSL", "GVA"].map((code) => ({
    ...departure,
    code,
  }));
  const available = (count: number): ProviderResult<FlightDiscovery> => ({
    status: "available",
    value: { fares: [], diagnostics: [{ code: "provider-empty", count }] },
  });
  const search = searchFlightPlan(
    {
      async discover(_request, _origin, options) {
        budgets.push(options!.timeoutMs);
        peak = Math.max(peak, ++active);
        try {
          return await new Promise<ProviderResult<FlightDiscovery>>(
            (resolve, reject) => pending.push({ resolve, reject }),
          );
        } finally {
          active--;
        }
      },
    },
    request,
    departures,
    { kind: "targeted", targets: [origin, origin, origin] },
    100,
  );
  assert.equal(pending.length, 3);
  t.mock.timers.tick(40);
  pending[1].resolve(available(2));
  await new Promise<void>((resolve) => setImmediate(resolve));
  assert.equal(pending.length, 4);
  t.mock.timers.tick(40);
  pending[0].resolve(available(1));
  await new Promise<void>((resolve) => setImmediate(resolve));
  assert.equal(pending.length, 5);
  assert.deepEqual(budgets, [100, 100, 100, 60, 20]);
  t.mock.timers.tick(20);
  const results = await search;
  assert.equal(peak, 3);
  assert.equal(pending.length, 5);
  assert.equal(results.length, 9);
  assert.deepEqual(
    results.map(({ departure }) => departure.code),
    ["ZRH", "ZRH", "ZRH", "BSL", "BSL", "BSL", "GVA", "GVA", "GVA"],
  );
  assert.deepEqual(
    results.slice(0, 2).map(({ result }) => result),
    [available(1), available(2)],
  );
  assert.ok(
    results
      .slice(2)
      .every(
        ({ result }) =>
          result.status === "unavailable" && result.reason === "timeout",
      ),
  );
  // In-flight work may settle after return; it must not refill or alter results.
  const snapshot = structuredClone(results);
  pending[2].reject(new Error("synthetic late provider error"));
  pending[3].resolve(available(4));
  pending[4].resolve(available(5));
  t.mock.timers.tick(100);
  await new Promise<void>((resolve) => setImmediate(resolve));
  assert.equal(active, 0);
  assert.equal(pending.length, 5);
  assert.deepEqual(results, snapshot);
});
test("synchronous throws and rejected provider calls preserve bounded task execution", async (t) => {
  t.mock.timers.enable({ apis: ["setTimeout", "Date"], now: 1000 });
  let calls = 0,
    active = 0,
    peak = 0;
  const departure = selectedDeparture(origin)!;
  const results = await searchFlightPlan(
    {
      discover() {
        calls++;
        peak = Math.max(peak, ++active);
        if (calls % 2) {
          active--;
          throw new Error("synthetic synchronous provider error");
        }
        return Promise.resolve().then(() => {
          active--;
          throw new Error("synthetic asynchronous provider error");
        });
      },
    },
    request,
    [departure, departure, departure, departure],
    { kind: "targeted", targets: [origin, origin, origin, origin] },
    100,
  );
  assert.equal(calls, 9);
  assert.ok(peak <= 3);
  assert.equal(active, 0);
  assert.equal(results.length, 9);
  assert.ok(
    results.every(
      ({ result }) =>
        result.status === "unavailable" && result.reason === "provider-error",
    ),
  );
});
for (const budget of [0, -20])
  test(`shared deadline with budget ${budget} never invokes a provider`, async (t) => {
    t.mock.timers.enable({ apis: ["setTimeout", "Date"], now: 1000 });
    const scheduleTimeout = t.mock.method(globalThis, "setTimeout");
    let calls = 0;
    const departure = selectedDeparture(origin)!;
    const results = await searchFlightPlan(
      {
        async discover() {
          calls++;
          return { status: "available", value: { fares: [], diagnostics: [] } };
        },
      },
      request,
      [departure, departure, departure],
      { kind: "targeted", targets: [origin, origin, origin] },
      budget,
    );
    assert.equal(calls, 0);
    assert.equal(scheduleTimeout.mock.callCount(), 0);
    assert.equal(results.length, 9);
    assert.ok(
      results.every(
        ({ result }) =>
          result.status === "unavailable" && result.reason === "timeout",
      ),
    );
  });
test("empty flight plans create neither provider calls nor deadline timers", async (t) => {
  t.mock.timers.enable({ apis: ["setTimeout", "Date"], now: 1000 });
  const scheduleTimeout = t.mock.method(globalThis, "setTimeout");
  const departure = selectedDeparture(origin)!;
  let calls = 0;
  for (const [departures, targets] of [
    [[], [origin]],
    [[departure], []],
  ] as const) {
    const results = await searchFlightPlan(
      {
        async discover() {
          calls++;
          return { status: "available", value: { fares: [], diagnostics: [] } };
        },
      },
      request,
      [...departures],
      { kind: "targeted", targets: [...targets] },
      100,
    );
    assert.deepEqual(results, []);
  }
  assert.equal(calls, 0);
  assert.equal(scheduleTimeout.mock.callCount(), 0);
});
test("actual departure airport and accepted flexible dates reach independent affiliate boundary", async () => {
  const fixture = await setup();
  const base = (await getTripTemplates(request, fixture.providers, "paris"))
    .templates[0];
  const r = { ...request, dates: { ...request.dates, flexibleDays: 3 } };
  const fare: FlightDiscoveryFare = (
    await fares(
      [
        row({
          origin_airport: "ZRH",
          departure_at: "2026-11-21",
          return_at: "2026-11-23",
          link: "//evil.example/private",
        }),
      ],
      r,
    )
  )[0];
  assert.equal("deepLink" in fare, false);
  base.transport = {
    departure: base.transport.departure,
    mode: "flight",
    flightPricing: resolveFlightPricing(fare, r),
  };
  const plan = pricePlan(base, r);
  assert.deepEqual(flightHandoff(plan), {
    originCode: "ZRH",
    destinationCode: "CDG",
    departureDate: "2026-11-21",
    returnDate: "2026-11-23",
    party: r.party,
  });
  assert.deepEqual(plan.requestedDates, r.dates);
});

test("missing credentials preserve curated identity; forged city snapshot still fails closed", async () => {
  const offline = await createTravelProviders(
    {},
    async () => Response.json([]),
    false,
    request,
  );
  const paris = await getTripTemplates(request, offline, "paris");
  assert.equal(paris.templates.length, 1);
  assert.equal(
    pricePlan(paris.templates[0], request).pricingCompleteness,
    "flight-unpriced",
  );
  const forged = {
    ...request,
    destination: {
      id: "city:XYZ",
      type: "city" as const,
      cityCode: "XYZ",
      name: "Not evidence",
      countryCode: "FR",
      countryName: { en: "France", sq: "France" },
    },
  };
  const providers = await createTravelProviders(
    {},
    async () => Response.json([]),
    false,
    forged,
  );
  assert.equal(
    (await getTripTemplates(forged, providers, "city:XYZ")).templates.length,
    0,
  );
});
test("city query preserves actual departure airport independently through handoff", async () => {
  const fixture = await setup();
  const base = (await getTripTemplates(request, fixture.providers, "paris"))
    .templates[0];
  const f = (await fares([row()]))[0];
  f.originCode = "LON";
  f.originAirport = "LHR";
  base.transport = {
    mode: "flight",
    departure: { ...selectedDeparture(origin)!, code: "LON" },
    flightPricing: resolveFlightPricing(f, request),
  };
  assert.equal(flightHandoff(pricePlan(base, request))?.originCode, "LHR");
});
test("cache partition includes origin, destination, both months, currency and market without credentials in URLs", async () => {
  const urls: URL[] = [];
  const provider = createTravelpayoutsDiscovery(
    "private-test",
    async (url, options) => {
      urls.push(new URL(url));
      assert.equal(url.includes("private-test"), false);
      assert.equal(
        new Headers(options.headers).get("X-Access-Token"),
        "private-test",
      );
      assert.equal(options.cache, "no-store");
      assert.equal(options.next, undefined);
      return Response.json({ success: true, data: [] });
    },
    clock,
  );
  const paris = flightQueryPlan(
    flightDestinations.find((d) => d.id === "paris")!,
  ).targets[0];
  await provider.discover(request, origin);
  await provider.discover({ ...request, destination: paris }, origin);
  await provider.discover(
    {
      ...request,
      destination: paris,
      dates: {
        startDate: "2026-11-30",
        endDate: "2026-12-02",
        flexibleDays: 0,
      },
    },
    origin,
  );
  await provider.discover(
    { ...request, budget: { cents: 300000, currency: "GBP" } },
    origin,
  );
  await provider.discover(request, { ...origin, cityCode: "LON" });
  assert.equal(new Set(urls.map((u) => u.href)).size, 5);
  assert.ok(
    urls.every(
      (u) =>
        u.searchParams.get("market") === "us" &&
        u.searchParams.get("limit") === "100" &&
        u.searchParams.get("page") === "1",
    ),
  );
});
