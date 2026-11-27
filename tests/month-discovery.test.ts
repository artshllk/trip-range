import {
  completePlan,
  matchingFlight,
  referenceFlight,
} from "../src/domain/flight-pricing";
import { test } from "node:test";
import assert from "node:assert/strict";
import { createTravelpayoutsDiscovery } from "./flight-provider-fixture";
import { createFixtureTravelProviders as createTravelProviders } from "./provider-fixtures";
import { defaultRequest } from "./fixtures/prishtina-request";
import { fareDateMatch, shortlistFlights } from "../src/domain/discovery";
import { flightDestinations } from "../src/catalogue/flight-destinations";
import { locations } from "../src/catalogue/locations";
import { getTripTemplates } from "../src/services/travel";
import { pricePlan } from "../src/domain/pricing";
import { curate } from "../src/domain/ranking";
import { money } from "../src/domain/budget";
import type { TripRequest } from "../src/domain/types";
const request: TripRequest = {
  ...defaultRequest,
  budget: money(200000),
  dates: { startDate: "2026-10-10", endDate: "2026-10-12", flexibleDays: 0 },
};
const origin = locations.find((l) => l.id === "prishtina")!;
const row = (
  start = "2026-10-10",
  end = "2026-10-12",
  price = 120,
  destination = "VIE",
) => ({
  origin: "PRN",
  destination,
  departure_at: start,
  return_at: end,
  price,
  found_at: "2026-10-06T08:00:00Z",
});
const response = (data: unknown[]) =>
  Response.json({ success: true, currency: "EUR", data });
async function discover(rows: unknown[], r = request) {
  const result = await createTravelpayoutsDiscovery(
    "private",
    async () => response(rows),
    () => new Date("2026-10-06T09:00:00Z"),
  ).discover(r, origin);
  assert.notEqual(result.status, "unavailable");
  if (result.status === "unavailable") throw Error();
  return result.value;
}
async function search(rows: unknown[], r = request) {
  const providers = await createTravelProviders(
    { TRAVELPAYOUTS_API_TOKEN: "private" },
    async (url) =>
      new URL(url).hostname === "api.travelpayouts.com"
        ? response(rows)
        : Response.json({ batchcomplete: true }),
  );
  return getTripTemplates(r, providers);
}
test("month query preserves returned destination dates, requests variants, and spans return months", async () => {
  let calls = 0;
  const result = await createTravelpayoutsDiscovery("private", async (url) => {
    calls++;
    const params = new URL(url).searchParams;
    assert.equal(params.get("departure_at"), "2026-10");
    assert.equal(params.get("return_at"), "2026-11");
    assert.equal(params.get("unique"), "false");
    return response([row("2026-10-28", "2026-11-03", 70, "SZG")]);
  }).discover(
    {
      ...request,
      dates: {
        startDate: "2026-10-31",
        endDate: "2026-11-02",
        flexibleDays: 0,
      },
    },
    origin,
  );
  assert.equal(calls, 1);
  assert.equal(result.status, "available");
  assert.equal(result.value.fares[0].scope.dates.startDate, "2026-10-28");
});
test("exact fare wins over cheaper flexible/reference fares; flexible wins over cheaper reference", async () => {
  const r = { ...request, dates: { ...request.dates, flexibleDays: 3 } };
  const found = await discover(
    [
      row("2026-10-20", "2026-10-22", 10),
      row("2026-10-12", "2026-10-14", 40),
      row(),
    ],
    r,
  );
  assert.equal(
    shortlistFlights(found.fares, flightDestinations, r).candidates[0].fare
      .price.amount.cents,
    12000,
  );
  assert.equal(
    shortlistFlights(found.fares.slice(0, 2), flightDestinations, r)
      .candidates[0].fare.price.amount.cents,
    4000,
  );
});
test("no exact fare and empty successful discovery are not provider failures", async () => {
  for (const rows of [[], [row("2026-10-20", "2026-10-22")]])
    assert.equal((await search(rows)).issues.length, 0);
});
test("flexible ±3-day candidate uses actual dates, nights and fare while preserving requested dates", async () => {
  const r = {
    ...request,
    flexible: true,
    dates: { ...request.dates, flexibleDays: 3 },
  };
  const result = await search([row("2026-10-13", "2026-10-14", 55)], r);
  const base = result.templates.find((t) => t.id === "vienna")!;
  const plan = pricePlan(base, r);
  assert.equal(plan.costs[0].amount.cents, 11000);
  assert.equal(matchingFlight(plan)?.scope.dates.startDate, "2026-10-13");
  assert.equal(plan.request.dates.startDate, "2026-10-13");
  assert.equal(plan.request.nights, 1);
  assert.equal(base.itinerary.length, 2);
  assert.deepEqual(plan.requestedDates, r.dates);
  assert.equal(r.dates.startDate, "2026-10-10");
});
test("outside flexibility stays informational and can never price the requested trip", async () => {
  for (const flexibleDays of [0, 3]) {
    const r = { ...request, dates: { ...request.dates, flexibleDays } };
    const result = await search([row("2026-10-14", "2026-10-16", 7)], r);
    const base = result.templates.find((t) => t.id === "vienna")!;
    const plan = pricePlan(base, r);
    assert.equal(matchingFlight(plan), undefined);
    assert.equal(referenceFlight(plan)?.price.amount.cents, 700);
    assert.equal(plan.pricingCompleteness, "flight-unpriced");
    assert.equal(plan.budget, undefined);
    assert.ok(plan.costs.every((c) => c.category !== "transport"));
    assert.deepEqual(plan.request.dates, r.dates);
    const reference = referenceFlight(plan)!;
    const forged = pricePlan(
      {
        ...base,
        transport: {
          mode: "flight",
          flightPricing: {
            kind: "priced",
            quote: reference.price,
            fare: reference,
          },
        },
      },
      r,
    );
    assert.equal(forged.pricingCompleteness, "flight-unpriced");
    assert.equal(forged.flightPricing?.kind, "reference");
  }
});
test("zero flexibility rejects even a one-day shift; nearest reference wins within a destination", async () => {
  const found = await discover([
    row("2026-10-20", "2026-10-22", 5),
    row("2026-10-11", "2026-10-13", 80),
  ]);
  const nearest = shortlistFlights(found.fares, flightDestinations, request)
    .candidates[0].fare;
  assert.equal(fareDateMatch(nearest, request), "reference");
  assert.equal(nearest.price.amount.cents, 8000);
});
// Policy (2026-10-27): no demo road trips in production, so there are no complete
// road fits to protect; reference fares must still surface only as ideas.
test("reference discovery remains available as ideas and never becomes a fit", async () => {
  const result = await search([
    row("2026-10-20", "2026-10-22", 60, "SZG"),
    row("2026-10-20", "2026-10-22", 70, "AYT"),
  ]);
  assert.ok(result.templates.some((t) => t.id === "salzburg"));
  const plans = result.templates.map((t) => pricePlan(t, request));
  const selected = curate(plans, request);
  assert.ok(selected.fits.every(completePlan));
  assert.ok(
    selected.fits.every((p) => !referenceFlight(p) || matchingFlight(p)),
  );
  const flightsOnly = plans.filter((p) => p.transportMode === "flight");
  assert.ok(curate(flightsOnly, request).ideas.some((p) => referenceFlight(p)));
  const tight = { ...request, budget: money(30000) };
  assert.ok(
    curate(
      result.templates.map((t) => pricePlan(t, tight)),
      tight,
    ).fits.every((p) => p.budget.fit !== "over"),
  );
});
test("domestic requests still make zero flight discovery calls", async () => {
  let flightCalls = 0;
  const providers = await createTravelProviders(
    { TRAVELPAYOUTS_API_TOKEN: "private" },
    async (url) => {
      if (new URL(url).hostname === "api.travelpayouts.com") flightCalls++;
      return response([]);
    },
  );
  const result = await getTripTemplates(
    { ...request, scope: "domestic" },
    providers,
  );
  assert.equal(flightCalls, 0);
  assert.equal(result.issues.length, 0);
  assert.ok(result.templates.every((t) => t.transport.mode === "road"));
});
