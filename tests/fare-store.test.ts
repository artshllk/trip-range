import { test } from "node:test";
import assert from "node:assert/strict";
import {
  linkSearchDate,
  parseFareFetch,
  warmRouteSlice,
  warmRoutes,
  warmSlice,
  type FareWarmConfig,
} from "../src/domain/fare-store";
import {
  isCompleteFetch,
  missingPlanned,
  pairKey,
  plannedIdentity,
  routeKey,
  runnerAdmission,
  selectStalest,
  stalenessPlan,
  warmHours,
  warmRequests,
  warmWriteStatus,
  type StoredFetch,
} from "../src/server/fare-warm";
import warmConfig from "./fixtures/legacy-fare-warm.json";

const url =
  "https://api.travelpayouts.com/aviasales/v3/prices_for_dates?origin=PRN&departure_at=2026-12&return_at=2026-12&destination=LIS&one_way=false&currency=eur&market=us";
// Field set observed from the live endpoint on 2026-10-26: no found_at / observed_at.
const row = {
  flight_number: "6448",
  link: "/search/PRN1212LIS15121?t=x&search_date=20102026&expected_price=138",
  origin_airport: "PRN",
  destination_airport: "LIS",
  departure_at: "2026-12-12T18:10:00+01:00",
  airline: "W4",
  destination: "LIS",
  return_at: "2026-12-15T06:45:00Z",
  origin: "PRN",
  price: 138,
  gate: "Mytrip.com",
  return_transfers: 1,
  duration: 1735,
  transfers: 1,
};

test("fetch time and fare observation time stay separate", () => {
  const parsed = parseFareFetch(
    url,
    { success: true, currency: "eur", data: [row] },
    "2026-10-26T21:44:20.718Z",
    "Mon, 26 Oct 2026 21:44:20 GMT",
  );
  assert.ok(parsed);
  const [o] = parsed.observations;
  assert.equal(o.fetchedAt, "2026-10-26T21:44:20.718Z");
  assert.equal(o.fareObservedAt, null, "never backfilled from fetch time");
  assert.equal(o.providerLinkSearchDate, "2026-10-20");
  assert.equal(o.priceMinor, 13800);
  assert.equal(o.currency, "EUR");
  assert.equal(o.travellers, 1);
  assert.equal(
    o.departureDate,
    "2026-12-12",
    "local date, not the UTC-shifted one",
  );
  assert.equal(o.cabin, null);
  assert.equal(parsed.fetch.destination, "LIS");
  assert.equal(parsed.fetch.departureMonth, "2026-12");
});

test("found_at is kept from get_latest_prices and ignored on prices_for_dates", () => {
  const latest = parseFareFetch(
    "https://api.travelpayouts.com/aviasales/v3/get_latest_prices?origin=PRN&destination=LIS&beginning_of_period=2026-12-01&currency=eur",
    {
      success: true,
      currency: "eur",
      data: [
        {
          origin: "PRN",
          destination: "LIS",
          depart_date: "2026-12-12T18:10:00+01:00",
          return_date: "2026-12-15T06:45:00Z",
          value: 138,
          found_at: "2026-10-20T20:52:12Z",
          actual: true,
          trip_class: 0,
        },
      ],
    },
    "2026-10-26T21:44:20.718Z",
    null,
  );
  assert.equal(
    latest?.observations[0].endpoint,
    "aviasales/v3/get_latest_prices",
  );
  assert.equal(
    latest?.observations[0].fareObservedAt,
    "2026-10-20T20:52:12.000Z",
  );
  assert.equal(latest?.observations[0].actual, true);
  // A found_at on a prices_for_dates row is not the API's shape; it is not trusted.
  const pfd = parseFareFetch(
    url,
    { currency: "eur", data: [{ ...row, found_at: "2026-10-24T08:00:00Z" }] },
    "2026-10-26T21:44:20.718Z",
    null,
  );
  assert.equal(pfd?.observations[0].fareObservedAt, null);
});

test("invalid rows are dropped, never repaired", () => {
  const parsed = parseFareFetch(
    url,
    {
      currency: "eur",
      data: [
        { ...row, price: 0 },
        { ...row, destination: "lisbon" },
        { ...row, departure_at: "soon" },
        row,
      ],
    },
    "2026-10-26T21:44:20.718Z",
    null,
  );
  assert.equal(parsed?.observations.length, 1);
  assert.equal(
    parseFareFetch(
      "https://example.com/other?origin=PRN",
      { data: [] },
      "x",
      null,
    ),
    undefined,
  );
});

test("search_date parsing rejects impossible dates", () => {
  assert.equal(linkSearchDate("/s?search_date=31022026"), null);
  assert.equal(linkSearchDate("/s?x=1"), null);
});

test("warm slices cover every origin × month pair within one day", () => {
  const config = {
    monthsAhead: 6,
    pairsPerRun: 8,
    routesPerRun: 0,
    origins: ["PRN", "TIA", "SKP", "ZRH", "VIE"].map((code) => ({
      code,
      currency: "EUR",
    })),
  };
  const seen = new Set<string>();
  for (let hour = 0; hour < 24; hour++)
    for (const p of warmSlice(config, new Date(Date.UTC(2026, 9, 26, hour))))
      seen.add(`${p.origin}:${p.month}`);
  assert.equal(seen.size, 30);
  assert.ok(seen.has("PRN:2026-10") && seen.has("VIE:2027-03"));
});

test("routes cover every origin × destination, including cycles longer than a day", () => {
  const destinations = Array.from(
    { length: 60 },
    (_, i) =>
      `${String.fromCharCode(65 + Math.floor(i / 26))}${String.fromCharCode(65 + (i % 26))}Q`,
  );
  const config = {
    monthsAhead: 1,
    pairsPerRun: 0,
    routesPerRun: 5,
    origins: [],
    routes: {
      origins: ["PRN", "TIA", "SKP"],
      destinations: [...destinations, "PRN"],
      currency: "EUR",
    },
  };
  const all = warmRoutes(config);
  assert.equal(all.length, 3 * 60 + 2, "self-routes excluded (PRN→PRN)");
  // 182 routes / 5 per run = 37 runs: more than a day, every route still covered.
  const seen = new Set<string>();
  for (let hour = 0; hour < 37; hour++)
    for (const r of warmRouteSlice(
      config,
      new Date(Date.UTC(2026, 9, 26, hour)),
    ))
      seen.add(`${r.origin}-${r.destination}`);
  assert.equal(seen.size, all.length);
});

test("a successful empty response is an explicit zero-row record", () => {
  const parsed = parseFareFetch(
    "https://api.travelpayouts.com/aviasales/v3/get_latest_prices?origin=PRN&destination=VIE&period_type=year&currency=eur",
    { success: true, currency: "eur", data: [] },
    "2026-10-27T10:00:00.000Z",
    null,
  );
  assert.ok(parsed, "recorded, not dropped");
  assert.equal(parsed.observations.length, 0);
  assert.equal(parsed.fetch.destination, "VIE");
  assert.equal(parsed.fetch.endpoint, "aviasales/v3/get_latest_prices");
});

test("Actions windows of 3 hourly slots cover every pair and route exactly as hourly runs do", () => {
  const config = warmConfig as FareWarmConfig;
  const day = Date.parse("2026-11-02T00:00:00Z");
  const hourly = new Set<string>();
  const windowed = new Set<string>();
  // Two full days: each hourly slot once vs. 16 three-hour windows.
  for (let h = 0; h < 48; h++)
    for (const url of warmRequests(config, [new Date(day + h * 3_600_000)])
      .urls)
      hourly.add(url);
  for (let w = 0; w < 16; w++) {
    const slots = warmHours(new Date(day + (w * 3 + 2) * 3_600_000), 3);
    assert.equal(slots.length, 3);
    assert.equal(slots[0].getUTCHours() % 3, 0);
    for (const url of warmRequests(config, slots).urls) windowed.add(url);
  }
  assert.deepEqual([...windowed].sort(), [...hourly].sort());
  // A run 2h40m late still covers its own window, not the next one.
  assert.deepEqual(
    warmHours(new Date(day + 2 * 3_600_000 + 40 * 60_000), 3).map((d) =>
      d.getUTCHours(),
    ),
    [0, 1, 2],
  );
  // One hourly slot reproduces the route's previous call list (15 calls).
  assert.equal(warmRequests(config, warmHours(new Date(day))).urls.length, 15);
});

test("runner allowance admits exactly the calls a run needs, then refuses", async () => {
  const admit = runnerAdmission(3);
  const signal = new AbortController().signal;
  const results = [];
  for (let i = 0; i < 5; i++) results.push(await admit(signal, "https://api.travelpayouts.com/aviasales/v3/prices_for_dates"));
  assert.deepEqual(results, [
    "allowed",
    "allowed",
    "allowed",
    "quota",
    "quota",
  ]);
  const aborted = new AbortController();
  aborted.abort();
  assert.equal(await runnerAdmission(3)(aborted.signal, "https://api.travelpayouts.com/aviasales/v3/prices_for_dates"), "timeout");
});

test("missing-write detection matches planned calls by identity, not totals", () => {
  const config = warmConfig as FareWarmConfig;
  const { urls } = warmRequests(
    config,
    warmHours(new Date("2026-10-31T04:00:00Z"), 3),
  );
  const ids = urls.map((u, i) => ({
    ...plannedIdentity(u)!,
    id: String(i + 1),
    row_count: 3,
    stored_rows: 3,
    payload_present: true,
  }));
  assert.equal(ids.length, urls.length);
  assert.equal(
    new Set(ids.map((i) => JSON.stringify(i))).size,
    urls.length,
    "every planned call has a distinct identity",
  );
  // All stored: nothing missing (char(3) padding and case are tolerated).
  assert.deepEqual(
    missingPlanned(
      urls,
      ids.map((i) => ({ ...i, currency: i.currency.toLowerCase() + " " })),
    ),
    [],
  );
  // One planned write lost and one unplanned extra stored: totals match, the loss is found.
  const lost = ids.slice(1);
  const extra = { ...ids[0], origin: "XXX" };
  assert.equal(lost.length + 1, urls.length);
  assert.deepEqual(missingPlanned(urls, [...lost, extra]), [urls[0]]);
  // Duplicate rows for one call do not cover another.
  assert.deepEqual(missingPlanned(urls, [...lost, ids[1]]), [urls[0]]);
});

test("a header requires its payload and every normalized row, including valid empty responses", () => {
  const complete: StoredFetch = {
    ...plannedIdentity(url)!,
    id: "1",
    row_count: 2,
    stored_rows: 2,
    payload_present: true,
  };
  assert.equal(isCompleteFetch(complete), true);
  for (const broken of [
    { ...complete, payload_present: false },
    { ...complete, stored_rows: 0 },
    { ...complete, stored_rows: 1 },
    { ...complete, stored_rows: 3 },
    { ...complete, row_count: 0, stored_rows: 0, payload_present: false },
  ]) {
    assert.equal(isCompleteFetch(broken), false);
    assert.deepEqual(missingPlanned([url], [broken]), [url]);
  }
  const empty = { ...complete, row_count: 0, stored_rows: 0 };
  assert.equal(isCompleteFetch(empty), true);
  assert.deepEqual(missingPlanned([url], [empty]), []);
  // A valid receipt can cover an identity, but cannot make its incomplete twin
  // disappear from the run's integrity result.
  const receipts = [complete, { ...complete, id: "2", stored_rows: 0 }];
  const missing = missingPlanned([url], receipts);
  assert.deepEqual(missing, []);
  assert.match(
    warmWriteStatus(
      1,
      missing.length,
      receipts.filter((f) => !isCompleteFetch(f)).length,
      0,
      true,
    ),
    /^failed:/,
  );
});

test("warm success requires complete receipts and successful pruning", () => {
  assert.match(warmWriteStatus(45, 1, 0, 0, true), /^failed:/);
  assert.match(warmWriteStatus(45, 0, 1, 0, true), /^failed:/);
  assert.match(warmWriteStatus(45, 0, 0, 0, false), /^failed:.*pruning/);
  assert.match(warmWriteStatus(45, 0, 0, 0, true), /^ok:/);
  assert.match(warmWriteStatus(45, 0, 0, 1, true), /^ok:.*late response/);
});

test("staleness selection: never-seen first, then oldest; ties keep list order", () => {
  const items = ["a", "b", "c", "d"];
  const seen = new Map([
    ["a", 300],
    ["c", 100],
  ]);
  assert.deepEqual(
    selectStalest(items, (x) => x, seen, 3),
    ["b", "d", "c"],
  );
  assert.deepEqual(
    selectStalest(items, (x) => x, seen, 0),
    [],
  );
});

test("staleness plan covers every route and pair within a cycle, whichever runs GitHub drops, and a route that always fails never takes every run", () => {
  const config = warmConfig as FareWarmConfig;
  const seen = new Map<string, number>();
  const start = Date.parse("2026-11-02T00:00:00Z");
  const routeRuns = new Map<string, number>();
  const alwaysFails = "TIA|NUE|";
  let rng = 7;
  const random = () => (rng = (rng * 48271) % 2147483647) / 2147483647;
  let runs = 0;
  for (let window = 0; window < 40; window++) {
    if (random() < 0.5) continue; // GitHub drops about half the scheduled runs
    runs++;
    const now = new Date(start + window * 3 * 3_600_000);
    const plan = stalenessPlan(config, now, seen, 3);
    assert.equal(plan.routes.length, 21);
    assert.equal(plan.pairs.length, 12);
    // Every call is recorded as an attempt, failed or not.
    for (const r of plan.routes) {
      seen.set(routeKey(r), now.valueOf());
      routeRuns.set(routeKey(r), (routeRuns.get(routeKey(r)) ?? 0) + 1);
    }
    for (const p of plan.pairs) seen.set(pairKey(p), now.valueOf());
    if (runs === 8) {
      // ceil(150 / 21) = 8 runs reach every route; ceil(72 / 12) = 6 every pair.
      for (const r of [
        ...config.routes!.origins.flatMap((o) =>
          config
            .routes!.destinations.filter((d) => d !== o)
            .map((d) => routeKey({ origin: o, destination: d })),
        ),
      ])
        assert.ok(seen.has(r), `route ${r} covered after 8 runs`);
    }
  }
  assert.ok(runs >= 8, `simulation needs at least 8 landed runs (got ${runs})`);
  // The failing route is attempted about as often as any other, not every run.
  const counts = [...routeRuns.values()];
  assert.ok((routeRuns.get(alwaysFails) ?? 0) <= Math.max(...counts));
  assert.ok((routeRuns.get(alwaysFails) ?? 0) < runs);
});
