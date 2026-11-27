import { userInput as formatOnly } from "../src/domain/money/provenance";
import { test } from "node:test";
import assert from "node:assert/strict";
import { CHILD_INPUT, renderInChild } from "./child-render";
import { buildSync } from "esbuild";
import { budgetMediaFixture } from "./fixtures/budget-media";
import { resultsCopy } from "../src/i18n/results";
import { formatMoney } from "../src/i18n/config";
import { flightHandoff } from "../src/domain/affiliate";
import { locations } from "../src/catalogue/locations";
import en from "../src/i18n/en.json";
import sq from "../src/i18n/sq.json";
buildSync({
  entryPoints: ["src/components/travel/TripUnpricedSummary.tsx"],
  outfile: ".test-build/incomplete-price-summary.cjs",
  bundle: true,
  platform: "node",
  format: "cjs",
  packages: "external",
});
for (const locale of ["en", "sq"] as const)
  for (const state of [
    "reference",
    "unpriced",
    "transfer",
    "stay",
    "provider-failure",
  ] as const)
    test(`${locale}/${state}: real shared summary makes incomplete total primary and preserves engine amounts`, () => {
      const { plan } = budgetMediaFixture(state);
      const before = structuredClone(plan);
      const html = renderInChild(
        `const {createElement}=require('react');const {renderToStaticMarkup}=require('react-dom/server');const {TripUnpricedSummary}=require('./.test-build/incomplete-price-summary.cjs');process.stdout.write(renderToStaticMarkup(createElement(TripUnpricedSummary,${CHILD_INPUT})));`,
        { plan, locale, t: locale === "en" ? en : sq },
      );
      assert.ok(html.includes(resultsCopy[locale].incomplete));
      assert.doesNotMatch(
        html,
        /class="total"|result-budget-equation|result-balance|budget-bar/,
      );
      assert.equal(plan.budget, undefined);
      if (plan.pricingCompleteness === "flight-unpriced") {
        assert.ok(
          html.includes(
            formatMoney(formatOnly(plan.knownNonFlightCosts), locale),
          ),
        );
        assert.ok(html.includes(resultsCopy[locale].otherCosts));
      }
      if (plan.flightAffordability.status === "calculated") {
        const disclosure = html.match(
          /<details class="flight-budget-disclosure small">[\s\S]*?<\/details>/,
        )?.[0];
        assert.ok(disclosure, "airfare ceiling belongs in a closed disclosure");
        assert.ok(
          disclosure.includes(
            formatMoney(formatOnly(plan.flightAffordability.ceiling), locale),
          ),
        );
        assert.ok(disclosure.includes(resultsCopy[locale].ceilingNote));
        assert.ok(
          !html
            .replace(disclosure, "")
            .includes(
              formatMoney(formatOnly(plan.flightAffordability.ceiling), locale),
            ),
        );
      }
      if (state === "transfer" || state === "stay") {
        assert.doesNotMatch(html, /flight-budget-disclosure/);
        assert.doesNotMatch(html, /(?:€|CHF|USD)\s*0(?:[,.]00)?(?:\s|<)/);
      }
      assert.deepEqual(plan, before);
    });
for (const party of [
  { adults: 9, children: 0 },
  { adults: 2, children: 7 },
  { adults: 10, children: 0 },
  { adults: 2, children: 8 },
])
  test(`${party.adults}+${party.children}: incomplete-price presentation retains affiliate group boundary`, () => {
    const { plan } = budgetMediaFixture("unpriced", "EUR", party);
    plan.origin = locations.find((l) => l.id === "prishtina")!;
    const handoff = flightHandoff(plan);
    if (party.adults + party.children <= 9) {
      assert.ok(handoff);
      assert.deepEqual(handoff.party, party);
    } else assert.equal(handoff, undefined);
    assert.deepEqual(plan.request.party, party);
    assert.equal(plan.budget, undefined);
  });
