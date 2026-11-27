import { curate } from "../src/domain/ranking";
import assert from "node:assert/strict";
import { test } from "node:test";
import { CHILD_INPUT, renderInChild } from "./child-render";
import { buildSync } from "esbuild";
import {
  budgetMediaFixture,
  budgetMediaDetailFixture,
  budgetStates,
} from "./fixtures/budget-media";
import { trustedImageFixture } from "./destination-image-fixtures";
import { supportedCurrencies } from "../src/domain/money/currency";
import type { TripPlan } from "../src/domain/types";
import en from "../src/i18n/en.json";
import sq from "../src/i18n/sq.json";

buildSync({
  entryPoints: ["src/components/travel/ResultCard.tsx"],
  outfile: ".test-build/budget-media-card.cjs",
  bundle: true,
  platform: "node",
  format: "cjs",
  packages: "external",
});
function render(plan: TripPlan, locale: "en" | "sq", index = 0) {
  return renderInChild(
    `
    const {createElement}=require('react');
    const {renderToStaticMarkup}=require('react-dom/server');
    const {ResultCard}=require('./.test-build/budget-media-card.cjs');
    process.stdout.write(renderToStaticMarkup(createElement(ResultCard,${CHILD_INPUT})));
  `,
    {
      plan,
      locale,
      t: locale === "en" ? en : sq,
      index,
      currentYear: "2026",
    },
  );
}
const primary = (html: string) =>
  html.split('<details class="result-details"')[0];

for (const locale of ["en", "sq"] as const) {
  for (const state of budgetStates)
    test(`${locale}: ${state} card with no published room evidence cannot inherit a legacy budget verdict`, () => {
      const { plan } = budgetMediaFixture(state);
      const html = primary(render(plan, locale));
      assert.doesNotMatch(html, /Trip total|Not yet known|Not yet priced/);
      assert.match(html, /Check room prices for/);
      assert.doesNotMatch(
        html,
        /result-price-complete|result-balance|result-fits|result-over|left after safety reserve/,
      );
      if (state === "reference") {
        assert.doesNotMatch(html, /2026-11-12|2026-11-14/);
        assert.match(html, /Check return flights/);
      }
      if (state === "transfer") assert.match(html, /gateway-summary/);
    });
  for (const currency of supportedCurrencies)
    for (const party of [
      { adults: 1, children: 0 },
      { adults: 2, children: 2 },
    ])
      test(`${locale}/${currency}: room handoff preserves party and never invents a whole-trip total`, () => {
        const { plan } = budgetMediaFixture("affordable", currency, party);
        const html = render(plan, locale);
        assert.doesNotMatch(html, /Trip total|Not yet known|Not yet priced/);
        assert.ok(html.includes(`group_adults=${party.adults}`));
        assert.ok(html.includes(`group_children=${party.children}`));
        assert.doesNotMatch(html, /result-fits|result-over|result-balance/);
      });
}
test("reserve-sensitive example is exactly 452 + 45.20 = 497.20 against 470, 27.20 over", () => {
  const { plan } = budgetMediaFixture("reserve-over");
  assert.equal(plan.pricingCompleteness, "complete");
  if (plan.pricingCompleteness !== "complete") return;
  assert.deepEqual(
    [
      plan.budget.estimatedSpend.cents,
      plan.safetyBuffer.cents,
      plan.budget.budgetNeeded.cents,
      plan.request.budget.cents,
      plan.budget.overBudget.cents,
    ],
    [45200, 4520, 49720, 47000, 2720],
  );
});
for (const currency of supportedCurrencies)
  test(`${currency}: FullTrip fixture is over budget only because of its engine reserve`, () => {
    const { plan, request } = budgetMediaDetailFixture(
      "reserve-over",
      currency,
    );
    assert.equal(plan.pricingCompleteness, "complete");
    if (plan.pricingCompleteness !== "complete") return;
    assert.equal(plan.budget.fit, "over");
    assert.ok(plan.budget.estimatedSpend.cents < request.budget.cents);
    assert.ok(request.budget.cents < plan.budget.budgetNeeded.cents);
    assert.equal(
      plan.budget.budgetNeeded.cents,
      plan.budget.estimatedSpend.cents + plan.safetyBuffer.cents,
    );
    assert.equal(
      plan.budget.overBudget.cents,
      plan.budget.budgetNeeded.cents - request.budget.cents,
    );
    for (const locale of ["en", "sq"] as const) {
      const html = primary(render(plan, locale));
      assert.doesNotMatch(html, /Trip total|Not yet known|Not yet priced/);
      assert.doesNotMatch(html, /result-over|result-fits|result-balance/);
    }
  });
for (const media of [
  "missing",
  "unverified",
  "wrong-destination",
  "approved",
  "fallback",
] as const)
  test(`${media}: actual card uses trusted image state without changing price/ranking`, () => {
    const { plan, request } = budgetMediaFixture();
    const baseline = structuredClone(plan);
    const asset = {
      ...trustedImageFixture,
      destinationId: plan.destination.id,
    };
    plan.destination.image =
      media === "missing" || media === "fallback"
        ? undefined
        : media === "unverified"
          ? { ...asset, verification: "unverified" }
          : media === "wrong-destination"
            ? trustedImageFixture
            : asset;
    if (media === "fallback") plan.destination.fallbackImage = asset;
    const html = render(plan, "en");
    const approved = media === "approved" || media === "fallback";
    assert.equal(html.includes("result-card-no-photo"), !approved);
    assert.equal(html.includes('class="result-visual"'), approved);
    assert.equal(html.includes("result-photo-credit"), approved);
    assert.equal(html.includes("Synthetic fixture photographer"), approved);
    assert.doesNotMatch(
      html,
      /destination-no-image|Destination photo unavailable/,
    );
    if (approved) {
      assert.match(html, /loading="eager"/);
      assert.match(html, /fetchPriority="high"/);
      assert.match(render(plan, "en", 1), /loading="lazy"/);
    }
    assert.deepEqual(plan.costs, baseline.costs);
    assert.deepEqual(plan.budget, baseline.budget);
    assert.deepEqual(
      curate([plan], request).cards.map((p) => p.id),
      curate([baseline], request).cards.map((p) => p.id),
    );
  });
