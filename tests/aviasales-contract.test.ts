import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
// The real adapter and HTTP layer, not the fixture wrapper: these bodies are the API's own.
import { createTravelpayoutsDiscovery } from "../src/providers/server/travelpayouts";
import { createFlightHttp } from "../src/providers/server/flight-http";
import { parseFareFetch, FARE_ENDPOINTS } from "../src/domain/fare-store";
import { parseNearbyFares } from "../src/domain/nearby-fares";
import { providerFoundAt } from "../src/domain/fare-evidence";
import { defaultRequest } from "../src/domain/request";
import { locations } from "../src/catalogue/locations";
import type { TripRequest } from "../src/domain/types";

// Real responses recorded from the live Aviasales Data API on 2026-10-27.
// If the provider changes shape, these tests should fail before production does.
const recorded = (name: string) =>
  JSON.parse(
    readFileSync(`tests/fixtures/aviasales-recorded/${name}.json`, "utf8"),
  );
const pricesForDates = recorded("prices_for_dates-PRN-LIS-2026-12");
const latestPrices = recorded("get_latest_prices-PRN-LIS-2026-12");
const nearestPlaces = recorded("nearest-places-matrix-PRN-LIS-2026-12-12");

test("prices_for_dates sends itineraries and links but no found_at", () => {
  assert.ok(pricesForDates.data.length > 0);
  for (const row of pricesForDates.data) {
    assert.equal(row.found_at, undefined);
    assert.equal(row.observed_at, undefined);
    assert.equal(typeof row.link, "string");
  }
});

test("get_latest_prices sends found_at with an offset, and actual", () => {
  assert.ok(latestPrices.data.length > 0);
  for (const row of latestPrices.data) {
    assert.match(row.found_at, /(Z|[+-]\d{2}:\d{2})$/);
    assert.equal(typeof row.actual, "boolean");
  }
});

test("offsetless found_at (v2/prices/latest) is UTC; explicit offsets are honoured", () => {
  assert.equal(
    providerFoundAt("2026-10-22T07:04:01"),
    providerFoundAt("2026-10-22T07:04:01Z"),
  );
  assert.equal(
    providerFoundAt("2026-10-22T11:04:01+04:00"),
    "2026-10-22T07:04:01.000Z",
  );
});

test("the adapter joins found_at and actual onto prices_for_dates itineraries", async () => {
  const origin = locations.find((l) => l.id === "prishtina")!;
  const request: TripRequest = {
    ...defaultRequest,
    origin,
    originId: origin.id,
    destination: {
      id: "LIS",
      type: "city",
      name: "Lisbon",
      cityCode: "LIS",
      iataCodes: ["LIS"],
    } as TripRequest["destination"],
    budget: { cents: 90000, currency: "EUR" },
    dates: { startDate: "2026-12-12", endDate: "2026-12-15", flexibleDays: 0 },
    nights: 3,
  };
  const fetcher = async (input: string | URL | Request) => {
    const url = new URL(String(input instanceof Request ? input.url : input));
    const body = url.pathname.endsWith("get_latest_prices")
      ? latestPrices
      : pricesForDates;
    return new Response(JSON.stringify(body), {
      headers: { "content-type": "application/json" },
    });
  };
  const clock = () => new Date("2026-10-27T10:00:00Z");
  const result = await createTravelpayoutsDiscovery(
    "synthetic",
    fetcher,
    clock,
    4000,
    () => {},
    createFlightHttp(
      "synthetic",
      fetcher,
      async () => "allowed",
      (load) => load,
      clock,
    ),
  ).discover(request, origin);
  assert.equal(result.status, "available");
  const fares = result.status === "available" ? result.value.fares : [];
  assert.ok(fares.length > 0);
  for (const fare of fares) {
    assert.ok(
      fare.price.observedAt,
      "every recorded itinerary joins a found_at",
    );
    assert.equal(fare.price.providerActual, true);
    assert.equal(fare.price.observationEndpoint, FARE_ENDPOINTS.latestPrices);
    assert.equal(fare.price.confidence, "recent");
    assert.equal(fare.price.source.status, "available");
  }
});

test("the store parses every recorded endpoint and keeps the source endpoint per row", () => {
  const fetchedAt = "2026-10-27T10:00:00.000Z";
  const base = "https://api.travelpayouts.com";
  const pfd = parseFareFetch(
    `${base}/aviasales/v3/prices_for_dates?origin=PRN&destination=LIS&departure_at=2026-12&currency=eur`,
    pricesForDates,
    fetchedAt,
    null,
  );
  const latest = parseFareFetch(
    `${base}/aviasales/v3/get_latest_prices?origin=PRN&destination=LIS&beginning_of_period=2026-12-01&currency=eur`,
    latestPrices,
    fetchedAt,
    null,
  );
  const nearest = parseFareFetch(
    `${base}/v2/prices/nearest-places-matrix?origin=PRN&destination=LIS&depart_date=2026-12-12&return_date=2026-12-15&currency=eur`,
    nearestPlaces,
    fetchedAt,
    null,
  );
  assert.ok(pfd && latest && nearest);
  assert.ok(pfd.observations.every((o) => o.fareObservedAt === null));
  assert.ok(
    pfd.observations.every((o) => o.endpoint === FARE_ENDPOINTS.pricesForDates),
  );
  assert.ok(
    latest.observations.every((o) => o.fareObservedAt && o.actual === true),
  );
  assert.ok(latest.observations.every((o) => o.cabin === "economy"));
  assert.ok(nearest.observations.length > 0);
  assert.ok(
    nearest.observations.every((o) => o.fareObservedAt && o.actual === null),
  );
});

test('an empty response (currency "") is recorded as an explicit empty fetch; rows still need a currency', () => {
  // Recorded live on 2026-10-28: TIA→NUE, period year, nothing cached.
  const empty = recorded("get_latest_prices-TIA-NUE-year-empty");
  const url =
    "https://api.travelpayouts.com/aviasales/v3/get_latest_prices?origin=TIA&destination=NUE&period_type=year&currency=eur";
  const parsed = parseFareFetch(url, empty, "2026-10-28T17:00:00.000Z", null);
  assert.ok(parsed, "an empty answer is still a recorded fetch");
  assert.equal(parsed.observations.length, 0);
  assert.equal(parsed.fetch.currency, "EUR");
  assert.equal(parsed.fetch.destination, "NUE");
  // A response with rows but no stated currency cannot be priced: rejected.
  assert.equal(
    parseFareFetch(
      url,
      { ...latestPrices, currency: "" },
      "2026-10-28T17:00:00.000Z",
      null,
    ),
    undefined,
  );
});

test("nearby fares exclude the traveller's own airport and claim no transfer", () => {
  const fares = parseNearbyFares(nearestPlaces, "EUR", "PRN", null);
  assert.ok(fares.every((f) => f.originCode !== "PRN"));
  assert.ok(fares.some((f) => f.originCode === "SKP"));
  for (const fare of fares) {
    assert.deepEqual(Object.keys(fare).sort(), [
      "departureDate",
      "destinationCode",
      "fetchedAt",
      "foundAt",
      "originCode",
      "price",
      "returnDate",
    ]);
  }
});
