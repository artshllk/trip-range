import { test } from "node:test";
import assert from "node:assert/strict";
import en from "../src/i18n/en.json";
import sq from "../src/i18n/sq.json";
import { CHILD_INPUT, renderInChild } from "./child-render";
import type { ResultPrice } from "../src/components/travel/ResultPrice";
import { createTravelProviders } from "../src/providers/server/composition";
import { getTripTemplates } from "../src/services/travel";
import { pricingDiagnosticRequest } from "../scripts/check-pricing";
import { pricePlan } from "../src/domain/pricing";
import { resolveFlightPricing } from "../src/domain/flight-pricing";
import { money } from "../src/domain/budget";
import type {
  TripPlan,
  TripRequest,
  TripTemplate,
  FlightDiscoveryFare,
} from "../src/domain/types";

// Type import also compiles the real, isolated presentation component for the child renderer.
function render(plan: TripPlan, locale: "en" | "sq" = "en") {
  const props: Parameters<typeof ResultPrice>[0] = {
    plan,
    locale,
    t: locale === "en" ? en : sq,
  };
  return renderInChild(
    `
    const { createElement } = require('react');
    const { renderToStaticMarkup } = require('react-dom/server');
    const { ResultPrice } = require('./.test-build/src/components/travel/ResultPrice.js');
    const props = ${CHILD_INPUT};
    process.stdout.write(renderToStaticMarkup(createElement(ResultPrice, props)));
  `,
    props,
  );
}
async function base(request: TripRequest) {
  const providers = await createTravelProviders(
    {},
    async () => Response.json([]),
    false,
    request,
  );
  return (await getTripTemplates(request, providers)).templates[0];
}
function withFare(
  template: TripTemplate,
  request: TripRequest,
  reference = false,
) {
  const fare: FlightDiscoveryFare = {
    originCode: "PRN",
    destinationCode: "WAW",
    retrievedAt: null,
    scope: {
      dates: reference
        ? { startDate: "2026-11-12", endDate: "2026-11-15", flexibleDays: 0 }
        : request.dates,
      unit: "per-traveller",
      journey: "return",
      fees: "provider-unspecified",
    },
    price: {
      amount: money(5000, request.budget.currency),
      confidence: "recent",
      providerId: "travelpayouts-aviasales-data",
      source: { status: "available" },
      demo: false,
      observedAt: "2026-10-06T08:00:00Z",
    },
  };
  return pricePlan(
    {
      ...template,
      transport: {
        mode: "flight",
        flightPricing: resolveFlightPricing(fare, request),
      },
    },
    request,
  );
}
for (const currency of ["EUR", "GBP", "USD", "CHF"] as const) {
  test(`${currency}: absent flights and rooms remain unpriced, never a manufactured flight allowance`, async () => {
    const request = {
      ...pricingDiagnosticRequest,
      budget: money(60000, currency),
    };
    const plan = pricePlan(await base(request), request);
    const html = render(plan);
    assert.match(html, /Check return flights/);
    assert.match(html, /Check room prices for/);
    assert.doesNotMatch(html, /Trip total|Not yet known|Not yet priced/);
    assert.doesNotMatch(
      html,
      /Find return flights under|left after safety reserve|Fits your budget|class="total"/,
    );
  });
}
test("reference fares from other dates never become the price of this trip", async () => {
  const request = { ...pricingDiagnosticRequest, budget: money(60000) };
  const html = render(withFare(await base(request), request, true));
  assert.doesNotMatch(html, /€50|2026-11-12/);
  assert.match(html, /Check return flights/);
});
test("real return fare is displayed but legacy estimated spend cannot become a total or headroom", async () => {
  for (const cents of [45000, 55000, 60000]) {
    const request = { ...pricingDiagnosticRequest, budget: money(cents) };
    const html = render(withFare(await base(request), request));
    assert.match(html, /Flights €100 return/);
    assert.doesNotMatch(html, /Trip total|Not yet known|Not yet priced/);
    assert.doesNotMatch(
      html,
      /€589.60|€10.40|€39.60|left after safety reserve|Fits your budget|Over budget/,
    );
    assert.match(html, /booking.com\/searchresults/);
  }
});
test("price details never show a reference fare from other dates", async () => {
  const request = { ...pricingDiagnosticRequest, budget: money(60000) };
  const plan = withFare(await base(request), request, true);
  const html = renderInChild(
    `
    const { createElement } = require('react');
    const { renderToStaticMarkup } = require('react-dom/server');
    const { TripProvenance } = require('./.test-build/src/components/travel/Provenance.js');
    process.stdout.write(renderToStaticMarkup(createElement(TripProvenance, ${CHILD_INPUT})));
  `,
    { plan, locale: "en", t: en },
  );
  assert.doesNotMatch(html, /€50|per traveller|2026-11-12|Recent fare/);
});
