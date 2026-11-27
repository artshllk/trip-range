// Historical record/access regression. Live archive exclusion is tested in destination-archive.test.ts.
import assert from "node:assert/strict";
import { test } from "node:test";
import { CHILD_INPUT, renderInChild } from "./child-render";
import { buildSync } from "esbuild";
import {
  resultsState,
  incompleteCostsExceedBudget,
  nearbyRecoveryAvailable,
  missingPriceKinds,
} from "../src/components/travel/results-state";
import { costTrip, costProfile } from "./cost-profile-fixtures";
import { pricePlan } from "../src/domain/pricing";
import { curate } from "../src/domain/ranking";
import { defaultRequest } from "../src/domain/request";
import { createTravelProviders } from "./flight-provider-fixture";
import { getTripTemplates } from "../src/services/travel";
import type { TripPlan, TripRequest, TripTemplate } from "../src/domain/types";
import en from "../src/i18n/en.json";
import sq from "../src/i18n/sq.json";
import { resultsCopy } from "../src/i18n/results";
import { destinationAccessData } from "./fixtures/archived-destination-data";
import { placeRegistryData } from "../content/places/records";
import { createDestinationAccessStore } from "../src/travel/runtime/access-store";

// Synthetic amounts only. Exercise production pricing/ranking; never fabricate fit totals.
const fixture = costTrip("EUR");
const request = {
  ...fixture.request,
  budget: { cents: 5000, currency: "EUR" as const },
};
const context = {
  today: "2026-10-08",
  profiles: [costProfile("city:VIE", "EUR")],
};
const price = (r = request, base = fixture.base) =>
  pricePlan(base, r, "none", undefined, context);
const unpriced: TripTemplate = {
  ...fixture.base,
  id: "synthetic-unpriced",
  transport: {
    mode: "flight",
    flightPricing: { kind: "unavailable", reason: "no-matching-fare" },
  },
};

// Bundle the actual card (including its price, warning and cost rows), resolving
// application aliases without stubbing components. Render in normal React, outside
// the suite's react-server condition. No effects, providers or browser requests run.
buildSync({
  entryPoints: ["src/components/travel/ResultCard.tsx"],
  outfile: ".test-build/results-recovery-card.cjs",
  bundle: true,
  platform: "node",
  format: "cjs",
  packages: "external",
});
function renderCard(plan: TripPlan, locale: "en" | "sq") {
  return renderInChild(
    `
      const {createElement} = require('react');
      const {renderToStaticMarkup} = require('react-dom/server');
      const {ResultCard} = require('./.test-build/results-recovery-card.cjs');
      const props = ${CHILD_INPUT};
      process.stdout.write(renderToStaticMarkup(createElement(ResultCard, props)));
    `,
    {
      plan,
      locale,
      t: locale === "en" ? en : sq,
      index: 0,
      currentYear: "2026",
    },
  );
}
function assertIncompleteCard(html: string, plan: TripPlan) {
  assert.match(html, new RegExp(`data-pricing="${plan.pricingCompleteness}"`));
  assert.doesNotMatch(
    html,
    /result-price-complete|result-balance|result-fits|result-over|class="total"/,
  );
  assert.doesNotMatch(
    html,
    /Estimated whole trip|Kosto e vlerësuar e udhëtimit|left after safety reserve|mbeten pas rezervës/,
  );
  assert.equal(plan.budget, undefined);
  assert.equal(plan.safetyBuffer, undefined);
}

for (const locale of ["en", "sq"] as const) {
  for (const [label, delta] of [
    ["below", 1],
    ["equal", 0],
    ["above", -1],
  ] as const) {
    test(`${locale}: rendered incomplete known costs ${label} budget never become a complete price or fit`, () => {
      const original = price(request, unpriced);
      assert.equal(original.pricingCompleteness, "flight-unpriced");
      if (original.pricingCompleteness !== "flight-unpriced") return;
      const r = {
        ...request,
        budget: {
          ...request.budget,
          cents: original.knownNonFlightCosts.cents + delta,
        },
      };
      const plan = price(r, unpriced);
      const html = renderCard(plan, locale);
      assertIncompleteCard(html, plan);
      // Flights unpriced: "no room" replaces the generic over-budget note.
      assert.equal(html.includes(resultsCopy[locale].knownOver), false);
      assert.match(html, /Check room prices for/);
      assert.doesNotMatch(html, /Trip total|Not yet known|Not yet priced/);
      assert.equal(
        plan.costs.some((c) => c.category === "transport"),
        false,
      );
      assert.doesNotMatch(html, /€0(?:[<\s]|\.00)/);
    });
  }
  test(`${locale}: rendered unavailable stay remains unpriced, including simultaneous missing flight`, () => {
    // Deliberately unsafe stay duration exercises production's fail-closed branch.
    for (const base of [fixture.base, unpriced]) {
      const plan = price({ ...request, nights: 0 }, base);
      assert.equal(plan.pricingCompleteness, "stay-unpriced");
      const html = renderCard(plan, locale);
      assertIncompleteCard(html, plan);
      assert.match(html, /Check room prices for/);
      assert.match(html, /Allow separately for meals/);
      assert.equal(
        plan.costs.some((c) => c.category === "stay"),
        false,
      );
      assert.equal(missingPriceKinds([plan]).stay, true);
      assert.equal(missingPriceKinds([plan]).flight, base === unpriced);
    }
  });
}
test("legacy complete calculation cannot authorize a new evidence-card verdict", () => {
  const plan = price({
    ...request,
    budget: { ...request.budget, cents: 500000 },
  });
  const html = renderCard(plan, "en");
  assert.match(html, /data-pricing="complete"/);
  assert.doesNotMatch(html, /Trip total|Not yet known|Not yet priced/);
  assert.doesNotMatch(
    html,
    /result-price-complete|result-fits|left after safety reserve/,
  );
});

test("€50 no-fit retains the engine's cheapest complete calculation and secondary incomplete shortlist", () => {
  const complete = price(),
    unknown = price(request, unpriced);
  const result = curate([unknown, complete], request);
  assert.equal(resultsState(result), "no-fit");
  assert.equal(result.cheapest.id, complete.id);
  assert.equal(
    result.cheapest.budget.budgetNeeded.cents,
    complete.budget?.budgetNeeded.cents,
  );
  assert.deepEqual(
    result.ideas.map((p) => p.id),
    [unknown.id],
  );
  assert.deepEqual(result.fits, []);
  assert.deepEqual(result.slightlyOver, []);
  assert.equal(incompleteCostsExceedBudget(unknown), true);
  assert.equal(unknown.budget, undefined);
  assert.equal(unknown.safetyBuffer, undefined);
});
test("no fare is insufficient pricing even when known costs alone exceed €50", () => {
  const plan = price(request, unpriced);
  assert.equal(resultsState(curate([plan], request)), "insufficient-pricing");
  assert.deepEqual(missingPriceKinds([plan]), {
    flight: true,
    transfer: false,
    stay: false,
  });
  assert.equal(incompleteCostsExceedBudget(plan), true);
});
test("complete affordable shortlist and order are untouched by presentation derivation", () => {
  const r = { ...request, budget: { ...request.budget, cents: 500000 } };
  const first = price(r),
    second = price(r, { ...fixture.base, id: "synthetic-second" });
  const result = curate([second, first, price(r, unpriced)], r);
  const before = structuredClone(result);
  assert.equal(resultsState(result), "priced-results");
  missingPriceKinds(result.ideas);
  assert.deepEqual(result, before);
  assert.deepEqual(
    result.fits.map((p) => p.id),
    [first.id, second.id],
  );
  assert.equal(incompleteCostsExceedBudget(first), false);
  assert.equal(incompleteCostsExceedBudget(price(r, unpriced)), false);
});
test("15% ceiling stays inclusive and excludes one cent below the minimum qualifying budget", () => {
  const plan = price();
  assert.equal(plan.pricingCompleteness, "complete");
  if (plan.pricingCompleteness !== "complete") return;
  const threshold = Math.ceil((plan.budget.budgetNeeded.cents * 100) / 115);
  for (const [cents, count] of [
    [threshold, 1],
    [threshold - 1, 0],
  ]) {
    const r = { ...request, budget: { ...request.budget, cents } };
    const result = curate([price(r)], r);
    assert.equal(resultsState(result), "no-fit");
    assert.equal(result.slightlyOver.length, count);
  }
});
test("genuinely empty is distinct from incomplete estimates", () => {
  assert.equal(resultsState(curate([], request)), "empty");
});
test("required transfer and missing flight are independently disclosed using production gateway plans", async () => {
  const r: TripRequest = {
    ...defaultRequest,
    originId: "zurich",
    budget: { cents: 5000, currency: "EUR" },
  };
  const providers = await createTravelProviders(
    {},
    async () => Response.json([]),
    false,
    r,
  );
  providers.destinationAccess = createDestinationAccessStore(
    destinationAccessData,
    placeRegistryData.records,
    () => Date.parse("2026-10-16T12:00:00Z"),
  );
  const search = await getTripTemplates(r, providers, "place:Q41858");
  const base = search.templates.find((t) =>
    t.destination.name.en.includes("Banff"),
  );
  assert.ok(base);
  const plan = pricePlan(base, r);
  assert.equal(plan.pricingCompleteness, "required-transfer-unpriced");
  assert.equal(resultsState(curate([plan], r)), "insufficient-pricing");
  assert.deepEqual(missingPriceKinds([plan]), {
    flight: true,
    transfer: true,
    stay: false,
  });
  assert.equal(incompleteCostsExceedBudget(plan), true);
  assert.equal(plan.budget, undefined);
  for (const locale of ["en", "sq"] as const) {
    const html = renderCard(plan, locale);
    assertIncompleteCard(html, plan);
    assert.match(html, /airport transfers, local transport/);
    assert.equal(
      plan.costs.some((c) => c.category === "gatewayTransfer"),
      false,
    );
  }
});
for (const mode of ["empty", "outage"] as const) {
  test(`${mode} provider response does not turn missing evidence into an unaffordability claim`, async () => {
    const r: TripRequest = {
      ...request,
      originId: "zurich",
      origin: undefined,
    };
    const providers = await createTravelProviders(
      { TRAVELPAYOUTS_API_TOKEN: "synthetic-test-only" },
      async () =>
        mode === "outage"
          ? new Response(null, { status: 503 })
          : Response.json({ success: true, currency: "EUR", data: [] }),
      false,
      r,
    );
    const search = await getTripTemplates(r, providers);
    const result = curate(
      search.templates.map((t) => pricePlan(t, r)),
      r,
    );
    assert.equal(resultsState(result), "empty");
    assert.equal(result.cheapest, undefined);
    assert.equal(
      search.issues.some((i) => i.destinationId === "flight-discovery"),
      mode === "outage",
    );
  });
}
test("nearby recovery uses existing currency, country and bounded departure coverage", () => {
  assert.equal(nearbyRecoveryAvailable(defaultRequest), true);
  for (const r of [
    { ...defaultRequest, originId: "zurich" },
    { ...defaultRequest, noFlight: true },
    { ...defaultRequest, scope: "domestic" as const },
    {
      ...defaultRequest,
      preferences: { ...defaultRequest.preferences, nearbyAirports: true },
    },
    { ...defaultRequest, budget: { cents: 5000, currency: "GBP" as const } },
  ])
    assert.equal(nearbyRecoveryAvailable(r), false);
});
// Policy (2026-10-27): no demo road trips, so these searches are honestly empty.
test("domestic and no-flight results make no flight calls and show the empty state", async () => {
  for (const r of [
    { ...defaultRequest, scope: "domestic" as const },
    { ...defaultRequest, noFlight: true },
  ]) {
    const providers = await createTravelProviders(
      { TRAVELPAYOUTS_API_TOKEN: "synthetic-test-only" },
      async () => assert.fail("No provider request expected"),
      false,
      r,
    );
    const search = await getTripTemplates(r, providers);
    const result = curate(
      search.templates.map((t) => pricePlan(t, r)),
      r,
    );
    assert.equal(resultsState(result), "empty");
    assert.equal(result.fits.length, 0);
    assert.equal(nearbyRecoveryAvailable(r), false);
  }
});
test("EN/SQ recovery copy distinguishes no-fit, unknown and empty without claiming no flights", () => {
  for (const copy of Object.values(resultsCopy)) {
    assert.equal(new Set([copy.noFit, copy.insufficient, copy.empty]).size, 3);
    assert.ok(copy.insufficientNote.includes("{budget}"));
    assert.ok(copy.missingFlight && copy.missingTransfer && copy.knownOver);
    assert.doesNotMatch(
      copy.empty + copy.emptyNote,
      /no flights|nuk ka fluturime/i,
    );
  }
});

test("unpriced card offers flight and room searches without a fabricated cost ceiling", () => {
  const r = { ...request, budget: { ...request.budget, cents: 80000 } };
  // A partner route (PRN → VIE) so the card can hand off.
  const routed: TripTemplate = {
    ...unpriced,
    origin: { ...unpriced.origin, iataCodes: ["PRN"] },
    destination: { ...unpriced.destination, iataCodes: ["VIE"] },
  };
  const plan = price(r, routed);
  assert.equal(plan.flightAffordability?.status, "calculated");
  const html = renderCard(plan, "en");
  const face = html.split('<details class="result-details"')[0];
  const details = html.match(
    /<details class="result-details">[\s\S]*?<\/details>/,
  )?.[0];
  assert.match(face, /Check return flights/);
  assert.match(face, /Check room prices for/);
  assert.doesNotMatch(face, /Trip total|Not yet known|Not yet priced/);
  assert.doesNotMatch(face, /Find return flights under|result-balance|from €/);
  // One place for the ceiling: not repeated inside Price details.
  assert.ok(details);
  assert.doesNotMatch(details, /result-flight-limit|Maximum airfare/);
  // The handoff leads on the card, with its leaving context and disclosure.
  const actions = html.split('class="result-actions')[1] ?? "";
  assert.match(actions, /affiliate-leaving/);
  assert.match(actions, /affiliate-disclosure/);
  assert.match(actions, /class="button ember"/);
  assert.ok(
    actions.indexOf("affiliate-action") < actions.indexOf("button outline"),
  );
});

test("unpriced card without a partner route keeps Explore as its main action", () => {
  const r = { ...request, budget: { ...request.budget, cents: 80000 } };
  const html = renderCard(price(r, unpriced), "en");
  const actions = html.split('class="result-actions')[1] ?? "";
  assert.doesNotMatch(actions, /affiliate-action|result-actions-handoff/);
  assert.match(actions, /class="button ember"[^>]*>Explore trip/);
});
