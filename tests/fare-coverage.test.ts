import { test } from "node:test";
import assert from "node:assert/strict";
import {
  createTravelpayoutsDiscovery,
  FLIGHT_RESPONSE_LIMIT,
} from "./flight-provider-fixture";
import { providerCurrency } from "../src/providers/server/travelpayouts-policy";
import { createTravelProviders } from "../src/providers/server/composition";
import { getTripTemplates } from "../src/services/travel";
import { defaultRequest } from "../src/domain/request";
import { locations } from "../src/catalogue/locations";
import { resolveFlightPricing } from "../src/domain/flight-pricing";
import type { DiagnosticEvent } from "../src/server/observability/diagnostic";
import type { TripRequest } from "../src/domain/types";
const origin = locations.find((l) => l.id === "prishtina")!;
const request: TripRequest = {
  ...defaultRequest,
  origin,
  originId: origin.id,
  budget: { cents: 100000, currency: "CHF" },
  dates: { startDate: "2026-11-20", endDate: "2026-11-22", flexibleDays: 0 },
  nights: 2,
};
const clock = () => new Date("2026-10-21T12:00:00Z");
// prices_for_dates documented shape: currency echo and found_at are absent.
// Synthetic route/date/amount values: not evidence of live inventory.
const documented = (destination = "VIE", airport = "VIE") => ({
  origin: "PRN",
  origin_airport: "PRN",
  destination,
  destination_airport: airport,
  price: 99.25,
  airline: "QA",
  flight_number: "1234",
  departure_at: "2026-11-20T07:00:00+02:00",
  return_at: "2026-11-22T14:30:00+02:00",
  transfers: 0,
  return_transfers: 0,
  duration: 165,
  duration_to: 80,
  duration_back: 85,
  link: "/search/ignored-untrusted-provider-link",
});
async function run(data: unknown, r = request, status = 200) {
  const events: DiagnosticEvent[] = [];
  let calls = 0;
  const result = await createTravelpayoutsDiscovery(
    "synthetic-secret-never-logged",
    async (input, init) => {
      calls++;
      const url = new URL(input);
      assert.equal(url.searchParams.get("origin"), "PRN");
      assert.equal(
        url.searchParams.get("currency"),
        r.budget.currency.toLowerCase(),
      );
      assert.equal(url.searchParams.get("market"), "us");
      assert.equal(url.searchParams.get("limit"), "100");
      assert.equal(url.searchParams.get("departure_at"), "2026-11");
      assert.equal(url.searchParams.get("return_at"), "2026-11");
      assert.equal(url.searchParams.get("page"), "1");
      assert.equal(url.searchParams.get("one_way"), "false");
      assert.equal(
        new Headers(init.headers).get("X-Access-Token"),
        "synthetic-secret-never-logged",
      );
      assert.equal(url.searchParams.has("token"), false);
      assert.equal(init.next, undefined);
      return Response.json(data, {
        status,
        headers: { Date: clock().toUTCString() },
      });
    },
    clock,
    4000,
    (e) => events.push(e),
  ).discover(r, origin);
  assert.equal(calls, 1);
  const serialized = JSON.stringify(events);
  assert.doesNotMatch(
    serialized,
    /synthetic-secret|ignored-untrusted|2026-|X-Access|token|budget|party|https?:/i,
  );
  assert.ok(events.length <= 11);
  return { result, events, codes: events.map((e) => e.evidence) };
}
for (const [city, airport] of [
  ["VIE", "VIE"],
  ["LON", "STN"],
])
  // Policy (2026-10-27): a real-shape row with no joinable found_at still prices; it
  // never gains an invented observation time.
  test(`documented PRN–${city} row uses explicit CHF contract, prices, and never invents an observation`, async () => {
    const { result, codes } = await run({
      success: true,
      data: [documented(city, airport)],
    });
    assert.equal(result.status, "available");
    if (result.status !== "available") return;
    const fare = result.value.fares[0];
    assert.deepEqual(fare.price.amount, { cents: 9925, currency: "CHF" });
    assert.equal(fare.price.observedAt, null);
    assert.equal(fare.retrievedAt, clock().toISOString());
    assert.equal(fare.originAirport, "PRN");
    assert.equal(fare.destinationCode, city);
    assert.equal(fare.destinationAirport, airport);
    assert.equal(fare.price.providerId, "travelpayouts-aviasales-data");
    assert.deepEqual(fare.scope, {
      unit: "per-traveller",
      journey: "return",
      dates: {
        startDate: "2026-11-20",
        endDate: "2026-11-22",
        flexibleDays: 0,
      },
      fees: "provider-unspecified",
    });
    assert.equal(resolveFlightPricing(fare, request).kind, "priced");
    assert.ok(codes.includes("currency-from-request"));
    assert.ok(!codes.includes("observation-unconfirmed"));
    assert.ok(!codes.includes("provider-empty"));
  });
test("currency inference is endpoint-specific, supported and never overrides an explicit declaration", () => {
  assert.equal(providerCurrency("EUR", []).status, "unconfirmed");
  assert.equal(providerCurrency("CHF", [], "EUR").status, "unconfirmed");
  assert.equal(providerCurrency("CHF", [], "CHF").status, "match");
  for (const currency of [null, "", "JPY", "EUR", 1, {}, " CHF "])
    assert.equal(providerCurrency("CHF", [currency], "CHF").status, "mismatch");
});
for (const currency of [null, "EUR", "", 42])
  test(`bad currency declaration ${JSON.stringify(currency)} cannot be repaired by the request`, async () => {
    for (const body of [
      { success: true, currency, data: [documented()] },
      { success: true, data: [{ ...documented(), currency }] },
    ]) {
      const { result, codes } = await run(body);
      assert.equal(result.status, "unavailable");
      assert.ok(codes.includes("currency-rejected"));
    }
  });
for (const [name, data, expected] of [
  ["empty cache", { success: true, data: [] }, "provider-empty"],
  ["invalid envelope", { success: true, data: {} }, "schema-invalid"],
  [
    "missing price",
    { success: true, data: [{ ...documented(), price: undefined }] },
    "schema-invalid",
  ],
  [
    "invalid date",
    { success: true, data: [{ ...documented(), return_at: "2026-02-30" }] },
    "schema-invalid",
  ],
  [
    "stale observation",
    {
      success: true,
      // Beyond the provider's 7-day retention.
      data: [{ ...documented(), found_at: "2026-10-10T12:00:00Z" }],
    },
    "stale-fare",
  ],
  [
    "unmatched month sample",
    {
      success: true,
      data: [
        {
          ...documented(),
          departure_at: "2026-11-24",
          return_at: "2026-11-27",
        },
      ],
    },
    "date-unmatched",
  ],
] as const)
  test(`coverage diagnosis separates ${name}`, async () => {
    const { result, codes } = await run(data);
    assert.ok(codes.includes(expected));
    assert.ok(!codes.includes("provider-failed"));
    if (result.status === "available")
      for (const fare of result.value.fares)
        assert.notEqual(resolveFlightPricing(fare, request).kind, "priced");
  });
test("provider-declared failure is distinct from malformed data and never logs the provider error", async () => {
  const { result, codes } = await run({
    success: false,
    data: {},
    error: "synthetic-secret-never-logged",
  });
  assert.deepEqual(result, { status: "unavailable", reason: "unavailable" });
  assert.deepEqual(codes, ["provider-failed"]);
});
test("outage is a provider failure, never an empty cache or schema rejection", async () => {
  const { result, codes } = await run(
    { ignored: "no raw payload" },
    request,
    503,
  );
  assert.deepEqual(result, { status: "unavailable", reason: "unavailable" });
  assert.deepEqual(codes, ["provider-failed"]);
});
test("same bounded sample keeps exact/reference distinction when real observation is supplied", async () => {
  const { result } = await run({
    success: true,
    data: [
      { ...documented(), found_at: "2026-10-21T11:00:00Z" },
      {
        ...documented("LON", "STN"),
        found_at: "2026-10-21T11:00:00Z",
        departure_at: "2026-11-24",
        return_at: "2026-11-27",
      },
    ],
  });
  assert.equal(result.status, "available");
  if (result.status !== "available") return;
  assert.equal(
    resolveFlightPricing(result.value.fares[0], request).kind,
    "priced",
  );
  assert.equal(
    resolveFlightPricing(result.value.fares[1], request).kind,
    "reference",
  );
});
test("sample ceiling is reported without fetching another page or claiming upstream absence", async () => {
  const { result, events } = await run({
    success: true,
    data: Array.from({ length: FLIGHT_RESPONSE_LIMIT + 1 }, () => documented()),
  });
  assert.equal(result.status, "available");
  if (result.status !== "available") return;
  assert.equal(result.value.fares.length, 100);
  assert.ok(
    events.some((e) => e.evidence === "sample-limit-reached" && e.count === 1),
  );
  assert.ok(events.every((e) => (e.count ?? 0) <= 100));
});

for (const [body, code] of [
  [{ success: true, data: {} }, "schema-invalid"],
  [
    { success: true, currency: "EUR", data: [documented()] },
    "currency-rejected",
  ],
] as const)
  test(`search composition does not relabel ${code} as an upstream outage`, async () => {
    const r = { ...request, scope: "anywhere" as const };
    const providers = await createTravelProviders(
      {},
      async () => Response.json([]),
      false,
      r,
    );
    providers.discovery = createTravelpayoutsDiscovery(
      "synthetic",
      async () => Response.json(body),
      clock,
    );
    const search = await getTripTemplates(r, providers, "vienna");
    assert.ok(search.diagnostics?.some((d) => d.code === code));
    assert.ok(!search.diagnostics?.some((d) => d.code === "provider-failed"));
    assert.ok(
      search.templates.length > 0,
      "selected destination remains an unpriced option",
    );
  });
