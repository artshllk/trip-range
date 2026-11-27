import { test } from "node:test";
import assert from "node:assert/strict";
import {
  maxAffordableFlight,
  safetyBufferFor,
  money,
} from "../src/domain/budget";
import { planningCostPolicy } from "../src/domain/money/planning-rates";
import { pricePlan } from "../src/domain/pricing";
import { curate, MAX_UNPRICED_CARDS } from "../src/domain/ranking";
import { flightRoom } from "../src/domain/flight-room";
import {
  completePlan,
  resolveFlightPricing,
} from "../src/domain/flight-pricing";
import { createTravelProviders } from "../src/providers/server/composition";
import { getTripTemplates } from "../src/services/travel";
import { pricingDiagnosticRequest } from "../scripts/check-pricing";
import { curatedNearbyAirports } from "../src/providers/nearby-airports";
import {
  explanationFacts,
  readExplanations,
} from "../src/domain/ai/explanations";
import { flightAffordabilityText } from "../src/i18n/flight-affordability";
import { safeDiagnosticEvent } from "../src/server/observability/diagnostic";
import { seoLandingRegistry } from "../src/seo/registry";
import { landingModel, seoSitemap } from "../src/seo/publication";
import { createFixtureTravelProviders } from "./provider-fixtures";
import type {
  TripPlan,
  TripRequest,
  TripTemplate,
  FlightDiscoveryFare,
} from "../src/domain/types";

const request = { ...pricingDiagnosticRequest, budget: money(60000) };
async function template(r = request) {
  const providers = await createTravelProviders(
    {},
    async () => Response.json([]),
    false,
    r,
  );
  const result = await getTripTemplates(r, providers);
  return result.templates[0];
}
function ceiling(plan: TripPlan) {
  assert.equal(plan.pricingCompleteness, "flight-unpriced");
  assert.equal(plan.flightAffordability?.status, "calculated");
  return plan.flightAffordability!.ceiling!.cents;
}
function priced(base: TripTemplate, r: TripRequest) {
  const fare: FlightDiscoveryFare = {
    originCode: "PRN",
    destinationCode: "WAW",
    retrievedAt: null,
    scope: {
      dates: r.dates,
      unit: "per-traveller",
      journey: "return",
      fees: "provider-unspecified",
    },
    price: {
      amount: money(5000, r.budget.currency),
      confidence: "recent",
      providerId: "travelpayouts-aviasales-data",
      source: { status: "available" },
      demo: false,
      observedAt: "2026-10-06T08:00:00Z",
    },
  };
  return pricePlan(
    {
      ...base,
      transport: {
        mode: "flight",
        flightPricing: resolveFlightPricing(fare, r),
      },
    },
    r,
  );
}

test("maximum flight is a total party budget ceiling with the future reserve included", () => {
  const budget = money(60000),
    known = money(28600);
  assert.deepEqual(maxAffordableFlight(budget, known), money(25945));
  assert.notEqual(
    maxAffordableFlight(budget, known)?.cents,
    budget.cents - known.cents,
  );
  assert.equal(28600 + 25945 + safetyBufferFor(money(54545)).cents, 60000);
});
for (const currency of ["EUR", "GBP", "USD", "CHF"] as const) {
  test(`${currency}: minimum reserve and percentage reserve have exact one-cent boundaries`, () => {
    const minimum = planningCostPolicy[currency].minimumReserve;
    for (const [budgetCents, knownCents, expected] of [
      [minimum * 2, 100, minimum - 100],
      [60000, 28600, 25945],
      [60001, 28600, 25946],
    ]) {
      const value = maxAffordableFlight(
        money(budgetCents, currency),
        money(knownCents, currency),
      )!;
      assert.deepEqual(value, money(expected, currency));
      const spend = money(knownCents + value.cents, currency);
      assert.ok(spend.cents + safetyBufferFor(spend).cents <= budgetCents);
      const above = money(spend.cents + 1, currency);
      assert.ok(above.cents + safetyBufferFor(above).cents > budgetCents);
    }
  });
  test(`${currency}: reserve-consumed, zero and negative room never produce a useful ceiling`, () => {
    const minimum = planningCostPolicy[currency].minimumReserve;
    for (const [budget, known] of [
      [0, 0],
      [minimum, 0],
      [minimum + 100, 100],
      [100, 101],
      [60000, 54545],
    ])
      assert.equal(
        maxAffordableFlight(money(budget, currency), money(known, currency)),
        undefined,
      );
  });
}
test("affordability rejects mixed currencies and invalid integer money", () => {
  assert.throws(
    () => maxAffordableFlight(money(60000), money(28600, "GBP")),
    /Currency mismatch/,
  );
  for (const cents of [-1, 0.5, NaN, Infinity, Number.MAX_SAFE_INTEGER + 1])
    assert.throws(
      () => maxAffordableFlight({ cents, currency: "EUR" }, money(0)),
      /Invalid/,
    );
  assert.throws(
    () => maxAffordableFlight(money(60000), { cents: 0.1, currency: "EUR" }),
    /Invalid/,
  );
});
test("inverse arithmetic remains exact at the largest supported integer amount", () => {
  const b = Number.MAX_SAFE_INTEGER;
  const result = maxAffordableFlight(money(b), money(1))!;
  const s = BigInt(result.cents) + BigInt(1);
  assert.ok(s + (s + BigInt(9)) / BigInt(10) <= BigInt(b));
  assert.ok(s + BigInt(1) + (s + BigInt(10)) / BigInt(10) > BigInt(b));
});
test("Warsaw ceiling uses its known costs while preserving absent total and buffer", async () => {
  const p = pricePlan(await template(), request);
  assert.equal(p.knownNonFlightCosts?.cents, 43600);
  assert.equal(ceiling(p), 10945);
  assert.equal(p.budget, undefined);
  assert.equal(p.safetyBuffer, undefined);
  assert.equal(p.flightPricing?.kind, "unavailable");
});
test("baggage reduces the total flight ceiling by the exact party baggage allowance", async () => {
  const r = { ...request, budget: money(200000) },
    base = await template(r);
  const normal = pricePlan(base, r);
  const baggage = pricePlan(base, {
    ...r,
    preferences: { ...r.preferences, luggage: true },
  });
  assert.equal(
    ceiling(normal) - ceiling(baggage),
    planningCostPolicy.EUR.baggage * 2,
  );
});
test("each nearby departure uses its own actual transfer when calculating the ceiling", async () => {
  const r = {
    ...request,
    budget: money(200000),
    preferences: { ...request.preferences, nearbyAirports: true },
  };
  const base = await template(r);
  assert.equal(base.transport.mode, "flight");
  if (base.transport.mode !== "flight") throw Error();
  const direct = pricePlan(base, r);
  const departures = curatedNearbyAirports.candidates(r, r.origin!);
  for (const departure of departures.filter((d) => !d.selected)) {
    const p = pricePlan(
      { ...base, transport: { ...base.transport, departure } },
      r,
    );
    assert.equal(p.departure?.code, departure.code);
    assert.equal(
      ceiling(direct) - ceiling(p),
      departure.transfer!.amount.cents,
    );
  }
});
test("party, stay level and actual date length each recalculate known costs and ceiling", async () => {
  const r = { ...request, budget: money(200000) },
    base = await template(r);
  const normal = pricePlan(base, r);
  for (const variant of [
    { ...r, party: { adults: 3, children: 1 } },
    { ...r, preferences: { ...r.preferences, stayLevel: "comfort" as const } },
    { ...r, nights: 4, dates: { ...r.dates, endDate: "2026-11-24" } },
  ]) {
    const p = pricePlan(base, variant);
    assert.ok(p.knownNonFlightCosts!.cents > normal.knownNonFlightCosts!.cents);
    assert.equal(
      ceiling(normal) - ceiling(p),
      p.knownNonFlightCosts!.cents - normal.knownNonFlightCosts!.cents,
    );
    assert.deepEqual(p.request.dates, variant.dates);
  }
});
for (const [count, state] of [
  [1, "priced-results"],
  [0, "insufficient-pricing"],
  [3, "priced-results"],
] as const)
  test(`${count} complete fits: only remaining slots become ideas, never counted as priced`, async () => {
    const r = { ...request, destination: undefined, budget: money(200000) },
      base = await template();
    const ideas = [0, 1, 2].map((i) => ({
      ...pricePlan(base, r),
      id: `idea-${i}`,
    }));
    const fits = Array.from({ length: count }, (_, i) => ({
      ...priced(base, r),
      id: `priced-${i}`,
    }));
    const result = curate([...ideas, ...fits], r);
    assert.equal(result.pricingState, state);
    assert.equal(result.cards.length, 3);
    assert.equal(result.fits.length, count);
    assert.equal(result.ideas.length, 3 - count);
    assert.ok(result.fits.every(completePlan));
    assert.ok(result.ideas.every((p) => !completePlan(p) && ceiling(p) > 0));
    assert.equal(result.fitCount, count);
  });
test("complete over-budget trips remain no-fit even beside ideas with a ceiling", async () => {
  const base = await template();
  const r = { ...request, destination: undefined, budget: money(50000) };
  const p = priced(base, r),
    idea = { ...pricePlan(base, r), id: "idea" };
  assert.ok(completePlan(p) && p.budget.fit === "over");
  assert.ok(ceiling(idea) > 0);
  const result = curate([p, idea], r);
  assert.equal(result.pricingState, "no-fit");
  assert.equal(result.fits.length, 0);
  assert.equal(result.ideas.length, 1);
});
test("positive flight ceilings do not improve SEO completeness, evidence, fits or publication", async () => {
  const page = seoLandingRegistry[2];
  const base = await template();
  const templates = [0, 1, 2, 3].map((i) => ({
    ...base,
    origin: page.origin,
    id: `idea-${i}`,
  }));
  const model = landingModel(
    page,
    { state: "ready", search: { templates, issues: [] } },
    "2026-10-07",
    "2026-10-07T12:00:00Z",
  );
  assert.equal(model.cards.length, 3);
  assert.ok(model.cards.every((p) => ceiling(p) > 0));
  for (const key of [
    "fitsCount",
    "completeCalculationCount",
    "providerSupportedCount",
    "providerSupportedFitsCount",
  ] as const)
    assert.equal(model.summary[key], 0);
  assert.equal(model.summary.cheapestBudgetNeeded, null);
  assert.equal(model.quality.indexable, false);
  assert.ok(!seoSitemap().some((e) => e.url.endsWith(page.path)));
});
test("EN/SQ reviewed AI options share ceiling wording, reject inferred fares, and expose no fake totals", async () => {
  const base = await template();
  for (const locale of ["en", "sq"] as const) {
    for (const budget of [60000, 10000]) {
      const p = pricePlan(base, { ...request, budget: money(budget) });
      assert.equal(p.pricingCompleteness, "flight-unpriced");
      const facts = explanationFacts([p], locale),
        f = facts[0];
      assert.equal(f.pricingCompleteness, "flight-unpriced");
      if (f.pricingCompleteness !== "flight-unpriced") throw Error();
      assert.equal(f.knownNonFlightCostsCents, p.knownNonFlightCosts!.cents);
      assert.equal(
        f.flightAffordabilityMeaning,
        "budget-ceiling-not-fare-estimate",
      );
      const text = flightAffordabilityText(
        p.flightAffordability!,
        p.request.budget,
        locale,
      );
      assert.ok(f.options.includes(text));
      assert.ok(
        readExplanations({ explanations: [{ tripId: p.id, text }] }, facts),
      );
      if (budget === 60000)
        assert.match(
          text,
          locale === "en"
            ? /budget ceiling, not a fare estimate/
            : /kufi buxheti, jo vlerësim/,
        );
      else assert.doesNotMatch(text, /€0|€-/);
      assert.equal(
        readExplanations(
          {
            explanations: [
              { tripId: p.id, text: "The flight should cost around €109.45." },
            ],
          },
          facts,
        ),
        undefined,
      );
      for (const key of ["spendCents", "remainingCents", "reserveCents"])
        assert.equal(key in f, false);
    }
  }
});
test("affordability diagnostics preserve only state and currency, stripping private amounts and inputs", () => {
  for (const status of ["calculated", "no-room-in-budget"] as const) {
    const event = {
      level: "debug" as const,
      component: "money" as const,
      operation: "flight-affordability" as const,
      status,
      currency: "EUR" as const,
    };
    assert.deepEqual(
      safeDiagnosticEvent({
        ...event,
        ...{
          budgetCents: 60000,
          ceiling: money(10945),
          token: "private",
          query: "free text",
          url: "https://private.example",
          headers: { Authorization: "private" },
        },
      }),
      event,
    );
  }
});
test("composed legacy fare fixtures stay recent even when the machine clock moves years ahead", async (t) => {
  t.mock.timers.enable({
    apis: ["Date"],
    now: new Date("2035-01-01T00:00:00Z"),
  });
  const providers = await createFixtureTravelProviders(
    { TRAVELPAYOUTS_API_TOKEN: "synthetic" },
    async () =>
      Response.json({
        success: true,
        currency: "EUR",
        data: [
          {
            origin: "PRN",
            destination: "WAW",
            departure_at: request.dates.startDate,
            return_at: request.dates.endDate,
            found_at: "2026-10-06T08:00:00Z",
            price: 92,
          },
        ],
      }),
  );
  const result = await providers.discovery!.discover(request, request.origin!);
  assert.equal(result.status, "available");
  assert.equal(result.value.fares[0].price.source.status, "available");
});

test("room for flights: ceiling, reserve and a per-person figure rounded down, never with children", async () => {
  const base = await template();
  const p = pricePlan(base, request);
  const room = flightRoom(p);
  assert.ok(room && room.status === "room");
  assert.equal(room.ceiling.cents, ceiling(p));
  assert.equal(
    room.known.cents + room.reserve.cents + room.ceiling.cents,
    request.budget.cents,
  );
  assert.equal(room.perPerson!.cents % 100, 0);
  assert.equal(room.upTo.cents % 100, 0);
  assert.ok(room.upTo.cents <= room.ceiling.cents);
  assert.ok(room.perPerson!.cents <= room.ceiling.cents / room.people);
  const family = {
    ...request,
    budget: money(200000),
    party: { adults: 2, children: 1 },
  };
  const withChild = flightRoom(pricePlan(base, family));
  assert.ok(withChild && withChild.status === "room");
  assert.equal(withChild.perPerson, undefined);
  assert.equal(flightRoom(priced(base, request)), undefined);
  const broke = flightRoom(
    pricePlan(base, { ...request, budget: money(10000) }),
  );
  assert.equal(broke?.status, "no-room");
});
test("unpriced cards rank by room per person; no-room last; six only where asked", async () => {
  const base = await template();
  const r = { ...request, destination: undefined };
  const at = (cents: number, id: string) => ({
    ...pricePlan(base, { ...r, budget: money(cents) }),
    id,
  });
  const plans = [
    at(10000, "no-room"),
    at(60000, "mid"),
    at(90000, "most"),
    at(45000, "least"),
    ...[0, 1, 2, 3].map((i) => at(50000, `extra-${i}`)),
  ];
  const results = curate(plans, r, { unpricedCards: MAX_UNPRICED_CARDS });
  assert.equal(results.cards.length, 6);
  assert.deepEqual(
    results.cards.slice(0, 2).map((p) => p.id),
    ["most", "mid"],
  );
  assert.ok(!results.cards.some((p) => p.id === "no-room"));
  const all = curate(plans, r, { unpricedCards: 20 }).cards;
  assert.equal(all[all.length - 1].id, "no-room");
  // Other surfaces keep three.
  assert.equal(curate(plans, r).cards.length, 3);
});
