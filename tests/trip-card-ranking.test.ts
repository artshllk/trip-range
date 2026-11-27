import assert from "node:assert/strict";
import { test } from "node:test";
import { curateTripCards } from "../src/domain/trip-card-ranking";
import { pricePlan } from "../src/domain/pricing";
import { costTrip, costProfile } from "./cost-profile-fixtures";
import { buildSync } from "esbuild";
import { CHILD_INPUT, renderInChild } from "./child-render";
import en from "../src/i18n/en.json";

buildSync({
  entryPoints: ["src/components/travel/TripCard.tsx"],
  outfile: ".test-build/evidence-trip-card.cjs",
  bundle: true,
  platform: "node",
  format: "cjs",
  packages: "external",
});

test("legacy flight allowances never become card fit/over groups or hide a destination", () => {
  const fixture = costTrip("EUR");
  for (const cents of [100, 1000000]) {
    const request = {
      ...fixture.request,
      budget: { currency: "EUR" as const, cents },
    };
    const plan = pricePlan(fixture.base, request, "none", undefined, {
      today: "2026-10-08",
      profiles: [costProfile("city:VIE", "EUR")],
    });
    assert.equal(plan.transportMode, "flight");
    const result = curateTripCards([plan], request);
    assert.equal(result.cards.length, 1);
    assert.equal(result.fits.length, 0);
    assert.equal(result.slightlyOver.length, 0);
    assert.equal(result.fitCount, 0);
    assert.equal(result.cheapest, undefined);
    assert.equal(result.pricingState, "insufficient-pricing");
    const html = renderInChild(
      `
      const {createElement} = require('react');
      const {renderToStaticMarkup} = require('react-dom/server');
      const {TripCard} = require('./.test-build/evidence-trip-card.cjs');
      process.stdout.write(renderToStaticMarkup(createElement(TripCard, ${CHILD_INPUT})));
    `,
      { plan, locale: "en", t: en },
    );
    assert.doesNotMatch(html, /Trip total|Not yet known|Not yet priced/);
    assert.match(html, /booking.com\/searchresults/);
    assert.doesNotMatch(
      html,
      /class="fit |class="total"|left after safety reserve/,
    );
  }
});
