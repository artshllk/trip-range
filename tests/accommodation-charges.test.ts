import { test } from "node:test";
import assert from "node:assert/strict";
import { buildSync } from "esbuild";
import { pricePlan } from "../src/domain/pricing";
import { completePlan } from "../src/domain/flight-pricing";
import { flightRoom } from "../src/domain/flight-room";
import { safetyBufferFor } from "../src/domain/budget";
import { curate } from "../src/domain/ranking";
import { explanationFacts } from "../src/domain/ai/explanations";
import { summarizePlans } from "../src/seo/summary";
import {
  ACCOMMODATION_ALLOWANCE_DEFINITION,
  allowanceChargeCoverage,
} from "../src/domain/accommodation-charges";
import { costTrip } from "./cost-profile-fixtures";
import { stayQuote, stayNow } from "./accommodation-fixtures";
import { renderInChild, CHILD_INPUT } from "./child-render";
import type { TripPlan } from "../src/domain/types";
import en from "../src/i18n/en.json";
import sq from "../src/i18n/sq.json";

const ctx = { today: "2026-11-02", now: stayNow, profiles: [] };

test("inclusive accommodation never receives any statutory tax addition", () => {
  assert.equal(ACCOMMODATION_ALLOWANCE_DEFINITION.addStatutoryTax, false);
  for (const [code, country] of [
    ["VIE", "AT"],
    ["BER", "DE"],
    ["HAM", "DE"],
    ["IST", "TR"],
    ["BSL", "CH"],
    ["DUS", "DE"],
    ["FRA", "DE"],
    ["MUC", "DE"],
    ["CPH", "DK"],
  ]) {
    for (const level of ["simple", "standard", "comfort"] as const) {
      const { base, request } = costTrip("EUR", code, country);
      request.preferences = { ...request.preferences, stayLevel: level };
      const p = pricePlan(base, request, "none", undefined, ctx);
      assert.ok(completePlan(p), code);
      const expectedStay =
        Math.round(
          ((base.stay.amount.cents / 2) *
            { simple: 70, standard: 100, comfort: 150 }[level]) /
            100,
        ) * request.nights;
      assert.equal(p.accommodation!.quote!.amount.cents, expectedStay, code);
      assert.deepEqual(
        p.costs.map((c) => c.category),
        ["transport", "stay", "local", "food", "activities"],
      );
      // Independently specified basket: any tax hidden in another line also fails.
      assert.equal(
        p.budget.estimatedSpend.cents,
        expectedStay + 4000 + 4000 + 7200 + 2000,
        code,
      );
    }
  }
});

const conditionalCities = [
  ["ZRH", "CH"],
  ["MAN", "GB"],
  ["STR", "DE"],
];
for (const [code, country] of conditionalCities)
  test(`${code}: property-dependent estimate has no budget fit, flight ceiling, SEO total or AI claim`, () => {
    const { base, request } = costTrip("EUR", code, country);
    const p = pricePlan(base, request, "none", undefined, ctx);
    assert.equal(p.pricingCompleteness, "property-charges-conditional");
    if (p.pricingCompleteness !== "property-charges-conditional") throw Error();
    assert.equal(
      p.conditionalTotal.cents,
      p.knownCosts.cents + safetyBufferFor(p.knownCosts).cents,
    );
    assert.equal(p.budget, undefined);
    assert.equal(
      p.flightAffordability.status,
      "accommodation-charges-unpriced",
    );
    assert.equal(flightRoom(p), undefined);
    assert.equal(curate([p], request).fitCount, 0);
    assert.equal(
      summarizePlans([p], request, "2026-11-02T12:00:00Z").cheapestBudgetNeeded,
      null,
    );
    assert.deepEqual(explanationFacts([p], "en"), []);
    base.transport = {
      mode: "flight",
      flightPricing: { kind: "unavailable", reason: "no-matching-fare" },
    };
    const missingFlight = pricePlan(base, request, "none", undefined, ctx);
    assert.equal(
      missingFlight.pricingCompleteness,
      "accommodation-charges-unpriced",
    );
    assert.equal("conditionalTotal" in missingFlight, false);
    assert.equal(flightRoom(missingFlight), undefined);
  });

test("unknown or unresolved conditional provider charges cannot disappear through a fallback", () => {
  for (const kind of ["unknown", "conditional"] as const) {
    const { base, request } = costTrip("EUR", "VIE", "AT");
    const q = stayQuote(base, request);
    q.charges.unknownMandatory = kind === "unknown";
    q.charges.conditional = kind === "conditional";
    base.accommodationEvidence = { status: "available", quotes: [q] };
    const p = pricePlan(base, request, "none", undefined, ctx);
    assert.equal(p.pricingCompleteness, "accommodation-charges-unpriced");
    assert.equal(p.accommodation?.charges.status, "unresolved");
    assert.equal(p.budget, undefined);
    assert.equal(p.safetyBuffer, undefined);
    assert.equal(curate([p], request).fitCount, 0);
    assert.equal(flightRoom(p), undefined);
  }
});

test("unknown charges survive other rejected candidates regardless of order", () => {
  for (const unknownFirst of [true, false]) {
    const { base, request } = costTrip("EUR", "VIE", "AT");
    const unknown = stayQuote(base, request);
    unknown.charges.unknownMandatory = true;
    const wrongScope = stayQuote(base, request);
    wrongScope.location.destinationId = "city:BER";
    base.accommodationEvidence = {
      status: "available",
      quotes: unknownFirst ? [unknown, wrongScope] : [wrongScope, unknown],
    };
    const p = pricePlan(base, request, "none", undefined, ctx);
    assert.equal(p.pricingCompleteness, "accommodation-charges-unpriced");
    assert.equal(p.accommodation?.rejection, "charges-unknown");
    assert.equal(p.budget, undefined);
  }
});

test("provider-level unknown-charge failures remain unresolved after fallback", () => {
  const { base, request } = costTrip("EUR", "VIE", "AT");
  base.accommodationEvidence = {
    status: "unavailable",
    reason: "charges-unknown",
  };
  const p = pricePlan(base, request, "none", undefined, ctx);
  assert.equal(p.pricingCompleteness, "accommodation-charges-unpriced");
  assert.equal(p.accommodation?.charges.status, "unresolved");
  assert.equal(p.budget, undefined);
});

test("complete scoped provider total resolves property-charge coverage once; gateway identity does not inherit a city levy", () => {
  const { base, request } = costTrip("EUR", "ZRH", "CH");
  const q = stayQuote(base, request);
  base.accommodationEvidence = { status: "available", quotes: [q] };
  const p = pricePlan(base, request, "none", undefined, ctx);
  assert.ok(completePlan(p));
  assert.equal(
    p.costs.find((c) => c.category === "stay")?.amount.cents,
    q.charges.total!.cents,
  );
  assert.equal(
    allowanceChargeCoverage({ ...base.destination, id: "place:Q999999" })
      .status,
    "included",
  );
});

buildSync({
  entryPoints: [
    "src/components/travel/ResultCard.tsx",
    "src/components/travel/TripUnpricedSummary.tsx",
  ],
  outdir: ".test-build/charge-ui",
  bundle: true,
  platform: "node",
  packages: "external",
  format: "cjs",
});
function render(p: TripPlan, locale: "en" | "sq") {
  return renderInChild(
    `const React=require('react');const {renderToStaticMarkup}=require('react-dom/server');const {ResultCard}=require('./.test-build/charge-ui/ResultCard.js');const {TripUnpricedSummary}=require('./.test-build/charge-ui/TripUnpricedSummary.js');const props=${CHILD_INPUT};process.stdout.write(renderToStaticMarkup(React.createElement(React.Fragment,null,React.createElement(ResultCard,props),React.createElement(TripUnpricedSummary,props))));`,
    {
      plan: p,
      locale,
      t: locale === "en" ? en : sq,
      index: 0,
      currentYear: "2026",
    },
  );
}
test("cards and detail show conditional totals with their exclusion, and unresolved charges without a total", () => {
  for (const locale of ["en", "sq"] as const) {
    const { base, request } = costTrip("EUR", "MAN", "GB");
    const conditional = render(
      pricePlan(base, request, "none", undefined, ctx),
      locale,
    );
    assert.match(conditional, /result-price-conditional/);
    assert.match(conditional, /BID/);
    assert.match(
      conditional,
      locale === "en" ? /outside this estimate/ : /jashtë këtij vlerësimi/,
    );
    assert.doesNotMatch(
      conditional,
      /Fits your budget|result-status-fits|left after safety|flight-budget-disclosure/,
    );
    const q = stayQuote(base, request);
    q.charges.unknownMandatory = true;
    base.accommodationEvidence = { status: "available", quotes: [q] };
    const unresolved = render(
      pricePlan(base, request, "none", undefined, ctx),
      locale,
    );
    assert.match(unresolved, /accommodation-charges-unpriced/);
    assert.doesNotMatch(
      unresolved,
      /result-price-complete|result-price-conditional|class="total"|Fits your budget|flight-budget-disclosure/,
    );
  }
});

test("reviewed room observations: separate possible tax, upper-bound fit and flight ceiling", () => {
  const { base, request } = costTrip("EUR", "VIE", "AT");
  const data = {
    method: "room-panel-v8-displayed-rate" as const,
    destinationId: base.destination.id,
    countryCode: "AT",
    sourceId: "synthetic-reviewed-panel",
    checkedDate: "2026-11-01",
    reviewAfter: "2026-12-01",
    weekday: 4,
    weekend: 7,
    included: 3,
    extra: 3,
    silent: 5,
  };
  base.stay.roomPanel = data;
  const rich = pricePlan(base, request, "none", undefined, ctx);
  assert.ok(completePlan(rich));
  const tax = rich.lodgingTax!;
  assert.equal(tax.treatment, "possible");
  assert.ok(tax.amount!.cents > 0);
  assert.equal(tax.bandPercent, 45);
  assert.ok(tax.upperAllowance!.cents >= tax.amount!.cents);
  assert.equal(
    rich.costs.some((c) => c.category === "lodgingTax"),
    false,
  );
  // The fit test holds the possible tax and the high end of the ±45% stay band.
  const headline = rich.budget.budgetNeeded.cents,
    hold = rich.budget.upperBoundNeeded!.cents - headline;
  assert.ok(hold > tax.upperAllowance!.cents);
  request.budget.cents = headline + hold;
  const exact = pricePlan(base, request, "none", undefined, ctx);
  assert.ok(completePlan(exact));
  assert.equal(exact.budget.budgetNeeded.cents, headline);
  assert.equal(exact.budget.remainingAfterReserve.cents, 0);
  request.budget.cents--;
  const misses = pricePlan(base, request, "none", undefined, ctx);
  assert.equal(misses.pricingCompleteness, "fit-unconfirmed");
  assert.equal(curate([misses], request).fitCount, 0);
  const html = render(misses, "en");
  assert.doesNotMatch(html, /Fits your budget/);
  assert.match(html, /extra charges/);
  assert.doesNotMatch(html, /Trip total|Not yet known|Not yet priced/);
  assert.doesNotMatch(html, /Measured · three-star room panel/);
  base.transport = {
    mode: "flight",
    flightPricing: { kind: "unavailable", reason: "no-matching-fare" },
  };
  // Leaves-for-flights uses the high end of the ±45% stay band: give it headroom.
  request.budget = { ...request.budget, cents: request.budget.cents + 100000 };
  const silent = pricePlan(base, request, "none", undefined, ctx);
  assert.equal(silent.pricingCompleteness, "flight-unpriced");
  const ceiling = flightRoom(silent);
  assert.equal(ceiling?.status, "room");
  base.stay.roomPanel = { ...data, included: 11, extra: 0, silent: 0 };
  const included = pricePlan(base, request, "none", undefined, ctx);
  const other = flightRoom(included);
  assert.ok(
    ceiling?.status === "room" &&
      other?.status === "room" &&
      ceiling.ceiling.cents < other.ceiling.cents,
  );
});

test("explicit extra enters the total once; mismatched totals, city, dates or provider evidence never reuse it", () => {
  const { base, request } = costTrip("EUR", "VIE", "AT");
  const original = pricePlan(base, request, "none", undefined, ctx);
  assert.ok(completePlan(original));
  const stay = original.accommodation!.quote!.amount;
  base.stay.roomPanel = {
    method: "room-panel-v8-displayed-rate",
    destinationId: base.destination.id,
    countryCode: "AT",
    sourceId: "synthetic-reviewed-panel",
    checkedDate: "2026-11-01",
    reviewAfter: "2026-12-01",
    weekday: 8,
    weekend: 8,
    included: 0,
    extra: 16,
    silent: 0,
    statedExtra: {
      scope: "uniform-across-contributors",
      amount: { cents: 2400, currency: "EUR" },
      stayCents: stay.cents,
      adults: 2,
      children: 0,
      startDate: request.dates.startDate,
      endDate: request.dates.endDate,
      sourceUrl: "https://example.invalid/terms",
    },
  };
  const extra = pricePlan(base, request, "none", undefined, ctx);
  assert.ok(completePlan(extra));
  assert.equal(
    extra.budget.estimatedSpend.cents - original.budget.estimatedSpend.cents,
    2400,
  );
  assert.deepEqual(extra.accommodation!.quote!.amount, stay);
  assert.deepEqual(
    extra.costs
      .filter((c) => c.category === "lodgingTax")
      .map((c) => c.amount.cents),
    [2400],
  );
  base.stay.roomPanel.statedExtra!.endDate = "2026-11-30";
  assert.notEqual(
    pricePlan(base, request, "none", undefined, ctx).lodgingTax?.amount?.cents,
    2400,
  );
  base.stay.roomPanel.destinationId = "city:BER";
  assert.equal(
    completePlan(pricePlan(base, request, "none", undefined, ctx)),
    false,
  );
  base.accommodationEvidence = {
    status: "available",
    quotes: [stayQuote(base, request)],
  };
  const inventory = pricePlan(base, request, "none", undefined, ctx);
  assert.equal(inventory.accommodation?.kind, "provider-priced");
  assert.equal(inventory.lodgingTax, undefined);
  assert.equal(
    inventory.costs.some((c) => c.category === "lodgingTax"),
    false,
  );
});

test("statutory planning fallback is date-, currency- and jurisdiction-specific; London silence adds nothing", () => {
  for (const [code, country, expected] of [
    ["MIL", "IT", 2800],
    ["BCN", "ES", 3080],
    ["IST", "TR", 180],
    ["LON", "GB", 0],
  ] as const) {
    const { base, request } = costTrip("EUR", code, country);
    const size = code === "LON" ? 6 : 8;
    base.stay.roomPanel = {
      method: "room-panel-v8-displayed-rate",
      destinationId: base.destination.id,
      countryCode: country,
      sourceId: "synthetic",
      checkedDate: "2026-11-01",
      reviewAfter: "2026-12-01",
      weekday: size,
      weekend: size,
      included: 0,
      extra: 0,
      silent: 2 * size,
    };
    const plan = pricePlan(base, request, "none", undefined, ctx);
    assert.equal(plan.lodgingTax?.amount?.cents ?? 0, expected);
    assert.equal(plan.lodgingTax?.treatment, expected ? "possible" : "no-levy");
    assert.ok(completePlan(plan));
    assert.equal(
      plan.costs.some((c) => c.category === "lodgingTax"),
      false,
    );
    base.stay.roomPanel.weekend = 3;
    assert.equal(
      pricePlan(base, request, "none", undefined, ctx).pricingCompleteness,
      "stay-unpriced",
    );
  }
});
