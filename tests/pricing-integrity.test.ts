import { test } from "node:test";
import { createFlightHttp } from "../src/providers/server/flight-http";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  completePlan,
  resolveFlightPricing,
} from "../src/domain/flight-pricing";
import { pricePlan } from "../src/domain/pricing";
import { curate } from "../src/domain/ranking";
import {
  comparePlans,
  withAirportComparison,
} from "../src/domain/airport-comparison";
import { money } from "../src/domain/budget";
import { requestQuery, parseRequest } from "../src/domain/request";
import { createTravelProviders } from "../src/providers/server/composition";
import { getTripTemplates } from "../src/services/travel";
import { flightHandoff, flightConfidence } from "../src/domain/affiliate";
import {
  explanationFacts,
  readExplanations,
} from "../src/domain/ai/explanations";
import { summarizePlans, seoRequest } from "../src/seo/summary";
import { seoQuality } from "../src/seo/policy";
import { seoLandingRegistry } from "../src/seo/registry";
import { landingModel, seoSitemap } from "../src/seo/publication";
import { safeDiagnosticEvent } from "../src/server/observability/diagnostic";
import {
  checkPricing,
  pricingDiagnosticRequest as request,
} from "../scripts/check-pricing";
import type {
  FlightDiscoveryFare,
  TripRequest,
  TripTemplate,
} from "../src/domain/types";

async function template(r = request) {
  const providers = await createTravelProviders(
    {},
    async () => {
      throw Error("no external calls");
    },
    false,
    r,
  );
  const search = await getTripTemplates(r, providers);
  assert.equal(search.templates.length, 1);
  return search.templates[0];
}
function fare(
  r = request,
  start = r.dates.startDate,
  end = r.dates.endDate,
): FlightDiscoveryFare {
  return {
    originCode: "PRN",
    destinationCode: "WAW",
    retrievedAt: null,
    price: {
      amount: money(9200, r.budget.currency),
      confidence: "recent",
      providerId: "travelpayouts-aviasales-data",
      source: { status: "available" },
      observedAt: "2026-10-06T08:00:00Z",
      demo: false,
    },
    scope: {
      dates: { startDate: start, endDate: end, flexibleDays: 0 },
      unit: "per-traveller",
      journey: "return",
      fees: "provider-unspecified",
    },
  };
}
function withFare(
  base: TripTemplate,
  f: FlightDiscoveryFare,
  r = request,
): TripTemplate {
  return {
    ...base,
    transport: { mode: "flight", flightPricing: resolveFlightPricing(f, r) },
  };
}
for (const currency of ["EUR", "GBP", "USD", "CHF"] as const) {
  test(`${currency}: Warsaw with no fare retains other costs but no total, fit, remaining budget or safety buffer`, async () => {
    const r = { ...request, budget: money(50000, currency) };
    const plan = pricePlan(await template(r), r);
    assert.equal(plan.id, "city:WAW");
    assert.equal(plan.pricingCompleteness, "flight-unpriced");
    assert.equal(plan.flightPricing?.kind, "unavailable");
    assert.equal(plan.budget, undefined);
    assert.equal(plan.safetyBuffer, undefined);
    assert.equal("budget" in plan, false);
    assert.equal("safetyBuffer" in plan, false);
    assert.ok(plan.knownNonFlightCosts && plan.knownNonFlightCosts.cents > 0);
    assert.equal(plan.knownNonFlightCosts?.currency, currency);
    assert.ok(
      plan.costs.every(
        (c) => c.category !== "transport" && c.amount.currency === currency,
      ),
    );
    assert.equal(
      plan.knownNonFlightCosts?.cents,
      plan.costs.reduce((sum, c) => sum + c.amount.cents, 0),
    );
    const result = curate([plan], r);
    assert.equal(result.fitCount, 0);
    assert.equal(result.pricingState, "insufficient-pricing");
    assert.equal(result.cheapest, undefined);
    assert.deepEqual(
      result.cards.map((p) => p.id),
      ["city:WAW"],
    );
    assert.equal(flightConfidence(plan), "unavailable");
    assert.deepEqual(flightHandoff(plan), {
      originCode: "PRN",
      destinationCode: "WAW",
      departureDate: "2026-11-20",
      returnDate: "2026-11-23",
      party: { adults: 2, children: 0 },
    });
  });
}
test("exact matching evidence authorizes a complete total and per-traveller multiplication", async () => {
  const plan = pricePlan(withFare(await template(), fare()), request);
  assert.ok(completePlan(plan));
  assert.equal(plan.flightPricing?.kind, "priced");
  assert.equal(
    plan.costs.find((c) => c.category === "transport")?.amount.cents,
    18400,
  );
  assert.equal(
    plan.budget.estimatedSpend.cents,
    plan.costs.reduce((sum, c) => sum + c.amount.cents, 0),
  );
  assert.equal(
    plan.budget.budgetNeeded.cents,
    plan.budget.estimatedSpend.cents + plan.safetyBuffer.cents,
  );
  assert.equal(flightConfidence(plan), "recent");
});
test("reference evidence keeps its dates and amount without entering actual total or handoff", async () => {
  const plan = pricePlan(
    withFare(await template(), fare(request, "2026-11-12", "2026-11-15")),
    request,
  );
  assert.equal(plan.flightPricing?.kind, "reference");
  assert.equal(plan.pricingCompleteness, "flight-unpriced");
  assert.equal(plan.budget, undefined);
  assert.equal(
    plan.costs.some((c) => c.category === "transport"),
    false,
  );
  assert.equal(flightHandoff(plan)?.departureDate, "2026-11-20");
  if (plan.flightPricing?.kind === "reference")
    assert.equal(
      plan.flightPricing.referenceFare.scope.dates.startDate,
      "2026-11-12",
    );
});
for (const mode of ["flexible", "weekends"] as const)
  test(`${mode}: accepted fare uses actual dates for total and affiliate search`, async () => {
    const r: TripRequest = {
      ...request,
      dates: {
        ...request.dates,
        ...(mode === "weekends"
          ? { mode: "weekends", month: "2026-11" }
          : { flexibleDays: 3 }),
      },
    };
    const plan = pricePlan(
      withFare(await template(r), fare(r, "2026-11-21", "2026-11-23"), r),
      r,
    );
    assert.ok(completePlan(plan));
    assert.equal(plan.request.dates.startDate, "2026-11-21");
    assert.equal(plan.request.nights, 2);
    assert.equal(flightHandoff(plan)?.departureDate, "2026-11-21");
    assert.deepEqual(plan.requestedDates, r.dates);
  });
test("changed dates downgrade cached matching templates instead of throwing or retaining a fare", async () => {
  const base = withFare(await template(), fare());
  const changed = {
    ...request,
    dates: { ...request.dates, startDate: "2026-11-28", endDate: "2026-11-30" },
    nights: 2,
  };
  const plan = pricePlan(base, changed);
  assert.equal(plan.flightPricing?.kind, "reference");
  assert.equal(plan.budget, undefined);
  assert.equal(flightHandoff(plan)?.departureDate, changed.dates.startDate);
});
test("missing, stale, demo, live-labelled, wrong-currency and malformed evidence never price a flight", () => {
  assert.equal(resolveFlightPricing(undefined, request).kind, "unavailable");
  const f = fare();
  for (const bad of [
    { ...f, price: { ...f.price, demo: true } },
    // "live" is no longer a valid tier; untrusted data carrying it must still be rejected.
    { ...f, price: { ...f.price, confidence: "live" as unknown as "recent" } },
    { ...f, price: { ...f.price, providerId: "goeksplo-flight-estimate" } },
    {
      ...f,
      price: {
        ...f.price,
        source: { status: "stale" as const, reason: "old" },
      },
    },
    { ...f, price: { ...f.price, amount: money(9200, "CHF") } },
    { ...f, price: { ...f.price, amount: money(0) } },
    { ...f, scope: { ...f.scope, journey: "one-way" as const } },
    {
      ...f,
      scope: {
        ...f.scope,
        dates: { ...f.scope.dates, startDate: "2026-02-30" },
      },
    },
    {
      ...f,
      scope: {
        ...f.scope,
        unit: "party" as const,
        party: { adults: 1, children: 0 },
      },
    },
  ])
    assert.equal(resolveFlightPricing(bad, request).kind, "unavailable");
});
test("ranking prioritizes complete plans and only fills remaining three slots with ideas", async () => {
  const r = { ...request, destination: undefined, budget: money(200000) };
  const base = await template();
  const priced = pricePlan(withFare(base, fare()), r);
  const idea = pricePlan(base, r);
  const complete = [0, 1, 2].map((i) => ({ ...priced, id: `priced-${i}` }));
  const ideas = [0, 1, 2].map((i) => ({ ...idea, id: `idea-${i}` }));
  assert.ok(comparePlans(priced, idea) < 0);
  assert.deepEqual(
    curate([...ideas, ...complete], r).cards.map((p) => p.id),
    complete.map((p) => p.id),
  );
  assert.deepEqual(
    curate([...ideas, complete[0]], r).cards.map((p) => p.id),
    ["priced-0", "idea-0", "idea-1"],
  );
  const tight = { ...r, budget: money(1000) };
  const over = pricePlan(withFare(base, fare()), tight);
  assert.equal(curate([over, ...ideas], tight).pricingState, "no-fit");
  assert.equal(curate(ideas, r).pricingState, "insufficient-pricing");
});
test("unpriced or reference departure cannot create an airport saving", async () => {
  const base = await template();
  const direct = pricePlan(base, request);
  const nearby = pricePlan(withFare(base, fare()), request);
  const transfer = {
    amount: money(8000),
    durationMinutes: 90,
    mode: "road" as const,
    confidence: "estimate" as const,
  };
  const alternative = {
    ...nearby,
    departure: { code: "SKP", name: "Skopje", selected: false, transfer },
  };
  // Preserve the actual contract from production departure policy.
  const { curatedNearbyAirports } =
    await import("../src/providers/nearby-airports");
  const departure = curatedNearbyAirports
    .candidates(
      {
        ...request,
        preferences: { ...request.preferences, nearbyAirports: true },
      },
      request.origin!,
    )
    .find((d) => d.code === "SKP")!;
  assert.equal(
    withAirportComparison({ ...alternative, departure }, [
      direct,
      { ...alternative, departure },
    ]).airportSavingCents,
    undefined,
  );
});
test("SEO reference/unavailable plans cannot satisfy fit, provider support, quality or sitemap policy", async () => {
  const page = seoLandingRegistry[2],
    r = seoRequest(page, "2026-10-07");
  const base = await template();
  const unpriced = { ...base, origin: page.origin };
  const templates = [0, 1, 2, 3].map((i) => ({ ...unpriced, id: `idea-${i}` }));
  const model = landingModel(
    page,
    { state: "ready", search: { templates, issues: [] } },
    "2026-10-07",
    "2026-10-07T12:00:00Z",
  );
  assert.equal(model.summary.fitsCount, 0);
  assert.equal(model.summary.completeCalculationCount, 0);
  assert.equal(model.summary.providerSupportedCount, 0);
  assert.equal(model.summary.cheapestBudgetNeeded, null);
  assert.equal(model.quality.indexable, false);
  assert.ok(!seoSitemap().some((e) => e.url.endsWith(page.path)));
  // Unpriced ideas still summarize honestly; indexing never reads them.
  assert.equal(
    summarizePlans(
      templates.map((t) => pricePlan(t, r)),
      r,
      "2026-10-07T12:00:00Z",
    ).providerSupportedCount,
    0,
  );
  assert.equal(seoQuality(page).indexable, false);
});
test("AI incomplete facts expose no fake total or buffer and allow only reviewed uncertainty copy", async () => {
  const plan = pricePlan(await template(), request);
  for (const locale of ["en", "sq"] as const) {
    const facts = explanationFacts([plan], locale);
    assert.equal(facts[0].pricingCompleteness, "flight-unpriced");
    for (const field of ["spendCents", "reserveCents", "remainingCents"])
      assert.equal(field in facts[0], false);
    assert.equal(facts[0].flightConfidence, "unavailable");
    assert.ok(
      readExplanations(
        { explanations: [{ tripId: plan.id, text: facts[0].options[0] }] },
        facts,
      ),
    );
    assert.equal(
      readExplanations(
        {
          explanations: [
            {
              tripId: plan.id,
              text: "The flight costs €440 and fits your budget.",
            },
          ],
        },
        facts,
      ),
      undefined,
    );
  }
});
test("shared URLs retain specific destination when a former fare disappears", async () => {
  const roundTrip = parseRequest(
    Object.fromEntries(new URLSearchParams(requestQuery(request))),
    undefined,
    "2026-10-07",
  );
  const plan = pricePlan(await template(roundTrip), roundTrip);
  assert.equal(plan.id, "city:WAW");
  assert.equal(plan.budget, undefined);
  assert.equal(flightHandoff(plan)?.destinationCode, "WAW");
});
test("pricing diagnostic is offline by default and live mode uses the two bounded production requests", async () => {
  let calls = 0;
  const fetcher = async () => {
    calls++;
    return Response.json({ success: true, currency: "eur", data: [] });
  };
  assert.equal(
    (await checkPricing(undefined, fetcher)).completeTripPricing,
    "no",
  );
  assert.equal(calls, 0);
  const report = await checkPricing(
    "private-diagnostic-token",
    fetcher,
    createFlightHttp(
      "private-diagnostic-token",
      fetcher,
      async () => "allowed",
      (load) => load,
    ),
  );
  // prices_for_dates + get_latest_prices, as in production.
  assert.equal(calls, 2);
  assert.equal(report.providerStatus, "success");
  assert.equal(report.state, "unavailable");
  assert.equal(report.matchingFareCount, 0);
  assert.equal(
    JSON.stringify(report).includes("private-diagnostic-token"),
    false,
  );
});
test("flight pricing observability reconstructs only safe typed fields", () => {
  const event = safeDiagnosticEvent({
    level: "debug",
    component: "search",
    operation: "flight-pricing",
    status: "unconfirmed",
    state: "reference-only",
    originCode: "PRN",
    destinationCode: "WAW",
    dateMode: "exact",
    provider: "travelpayouts",
    currency: "EUR",
    ...{ url: "https://private.example", token: "private", query: "free text" },
  });
  assert.equal(event.state, "reference-only");
  assert.equal(JSON.stringify(event).includes("private"), false);
  for (const file of [
    "src/domain/pricing.ts",
    "src/domain/money/planning-rates.ts",
    "src/providers/server/composition.ts",
    "src/services/travel.ts",
  ])
    assert.doesNotMatch(
      readFileSync(file, "utf8"),
      /22000|44000|goeksplo-flight-estimate|console\./,
    );
});
