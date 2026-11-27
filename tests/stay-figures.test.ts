import { test } from "node:test";
import assert from "node:assert/strict";
import { buildSync } from "esbuild";
import {
  deriveRoomPanel,
  roomPanelBandPercent,
  validateRoomPanelFigure,
} from "../src/domain/costs/room-panel";
import {
  nearestByPriceLevel,
  priceLevelFactor,
  stayCoverage,
  validateEurostatSeries,
} from "../src/domain/costs/eurostat";
import {
  resolveStayFigure,
  scalingAnchor,
  SCALED_BAND_PLACEHOLDER,
  validateStayData,
} from "../src/domain/costs/stay-figures";
import {
  describeHoldout,
  runHoldout,
  validateHoldout,
} from "../src/domain/costs/holdout";
import { reviewedStayData } from "../src/domain/costs/reviewed-stay-data";
import { pricePlan } from "../src/domain/pricing";
import { completePlan } from "../src/domain/flight-pricing";
import { flightRoom } from "../src/domain/flight-room";
import {
  maxAffordableFlight,
  money,
  safetyBufferFor,
} from "../src/domain/budget";
import type { Destination, TripPlan } from "../src/domain/types";
import { costTrip } from "./cost-profile-fixtures";
import { stayNow } from "./accommodation-fixtures";
import { renderInChild, CHILD_INPUT } from "./child-render";
import en from "../src/i18n/en.json";
import {
  fixtureRound,
  reviewedFigure,
  reviewedHoldout,
  REVIEW_AFTER,
  stayData,
  syntheticSeries,
  type FixtureCity,
} from "./stay-figure-fixtures";

const TODAY = "2027-01-20";
const ctx = (data = stayData()) => ({
  today: TODAY,
  now: stayNow,
  profiles: [],
  stayData: data,
});
const dest = (code: string, country: string, id = `city:${code}`) =>
  ({
    id,
    cityCode: code,
    iataCodes: [code],
    countryCode: country,
    name: { en: code, sq: code },
    country: { en: country, sq: country },
    styles: [],
  }) as unknown as Destination;

// ---------- 1. Transform ----------

test("transform reproduces the research medians and the sample-size bands for every ready fixture", () => {
  const expected: Record<string, [number, number, number]> = {
    vienna: [8, 8, 25],
    london: [6, 6, 35], // six stays per type is London's full panel; the band is for a sample of six
    milan: [7, 7, 30],
    barcelona: [8, 8, 25],
  };
  for (const [city, [weekday, weekend, band]] of Object.entries(expected)) {
    const { round, report } = fixtureRound(city as FixtureCity);
    const r = deriveRoomPanel(round, report, { reviewAfter: REVIEW_AFTER });
    assert.ok(r.ok, city);
    const f = r.figure;
    const research = report.panel_for_review!;
    assert.equal(
      f.weekday.medianTwoNightCents,
      research.weekday_two_night_median_minor,
    );
    assert.equal(
      f.weekend.medianTwoNightCents,
      research.weekend_two_night_median_minor,
    );
    assert.equal(f.roomNightCents, research.standard_room_night_minor);
    assert.deepEqual(
      [f.weekday.contributing, f.weekend.contributing, f.bandPercent],
      [weekday, weekend, band],
    );
    assert.equal(
      f.bandPercent,
      (report.coverage as { band_percent: number }).band_percent,
    );
    assert.equal(
      f.contributors.length + f.excluded.length,
      round.samples.length,
    );
    assert.equal(f.review.status, "pending");
  }
});

test("exclusions stay recorded, embedded charges leave the median, fallbacks are counted", () => {
  const milan = reviewedFigure("milan");
  assert.deepEqual(
    milan.excluded.map((e) => [e.stayType, e.outcome]),
    [
      ["weekday", "unavailable"],
      ["weekend", "ineligible"],
    ],
  );
  assert.deepEqual(milan.fallbacks, { breakfastIncluded: 1, nonRefundable: 1 });
  assert.deepEqual(reviewedFigure("vienna").fallbacks, {
    breakfastIncluded: 0,
    nonRefundable: 0,
  });
  const { round } = fixtureRound("barcelona");
  const charged = round.samples.find(
    (s) => s.conditional_charge_treatment === "embedded_itemized",
  )!;
  const contributor = reviewedFigure("barcelona").contributors.find(
    (c) =>
      c.propertyId === charged.property_id && c.stayType === charged.stay_type,
  )!;
  assert.equal(
    contributor.twoNightCents,
    Math.round(Number(charged.displayed_total) * 100) -
      Math.round(Number(charged.conditional_charge_amount) * 100),
  );
  assert.throws(() =>
    validateRoomPanelFigure({
      ...milan,
      fallbacks: { breakfastIncluded: 0, nonRefundable: 1 },
    }),
  );
});

test("transform refuses rounds the research check did not pass, mismatched pairs and tampering", () => {
  const ist = fixtureRound("istanbul");
  assert.equal(
    deriveRoomPanel(ist.round, ist.report, { reviewAfter: REVIEW_AFTER }).ok,
    false,
  );
  const vie = fixtureRound("vienna");
  const mil = fixtureRound("milan");
  assert.equal(
    deriveRoomPanel(vie.round, mil.report, { reviewAfter: REVIEW_AFTER }).ok,
    false,
  );
  const clone = () => JSON.parse(JSON.stringify(vie.round)) as typeof vie.round;
  const outcome = clone();
  outcome.samples[0].outcome = "unavailable";
  assert.equal(
    deriveRoomPanel(outcome, vie.report, { reviewAfter: REVIEW_AFTER }).ok,
    false,
  );
  const amount = clone();
  amount.samples[0].displayed_total = "999.00";
  const moved = deriveRoomPanel(amount, vie.report, {
    reviewAfter: REVIEW_AFTER,
  });
  assert.ok(!moved.ok && /disagree/.test(moved.errors.join(" ")));
  const meal = clone();
  meal.samples[0].meal_basis = "";
  assert.equal(
    deriveRoomPanel(meal, vie.report, { reviewAfter: REVIEW_AFTER }).ok,
    false,
  );
  const method = clone();
  method.method_version = "room-panel-v7-kosovo";
  assert.equal(
    deriveRoomPanel(method, vie.report, { reviewAfter: REVIEW_AFTER }).ok,
    false,
  );
  for (const reviewAfter of ["2026-11-17", "2027-03-18", "not-a-date"])
    assert.equal(
      deriveRoomPanel(vie.round, vie.report, { reviewAfter }).ok,
      false,
      reviewAfter,
    );
  assert.equal(
    deriveRoomPanel({ ...vie.round, city: "paris" }, vie.report, {
      reviewAfter: REVIEW_AFTER,
    }).ok,
    false,
  );
});

test("provisional band by sample size of the thinner stay type", () => {
  for (const [n, band] of [
    [8, 25],
    [7, 30],
    [6, 35],
    [5, 40],
    [4, 45],
  ])
    assert.equal(roomPanelBandPercent(n, n), band);
  assert.equal(roomPanelBandPercent(7, 8), 30);
  assert.equal(roomPanelBandPercent(3, 8), undefined);
  assert.equal(roomPanelBandPercent(9, 8), undefined);
});

test("only reviewed, internally consistent inputs enter the registry; production is empty", () => {
  const { round, report } = fixtureRound("vienna");
  const pending = deriveRoomPanel(round, report, { reviewAfter: REVIEW_AFTER });
  assert.ok(pending.ok);
  assert.throws(() => validateRoomPanelFigure(pending.figure));
  validateRoomPanelFigure(reviewedFigure("vienna"));
  assert.throws(() =>
    validateRoomPanelFigure({ ...reviewedFigure("vienna"), bandPercent: 20 }),
  );
  assert.throws(() =>
    validateRoomPanelFigure({ ...reviewedFigure("vienna"), roomNightCents: 1 }),
  );
  assert.deepEqual(reviewedStayData, {
    figures: [],
    series: undefined,
    holdout: undefined,
  });
  const holdout = reviewedHoldout({
    7: { percent: 18, heldOutAnchors: 3, predictions: 9 },
  });
  validateStayData({ ...stayData(), holdout });
  assert.throws(() =>
    validateHoldout({ ...holdout, review: { status: "pending" } }),
  );
  assert.throws(() =>
    validateHoldout(
      reviewedHoldout({
        7: { percent: 18, heldOutAnchors: 2, predictions: 4 },
      }),
    ),
  );
});

// ---------- 2. Price levels and anchor assignment ----------

test("price-level factor: latest common year, GR→EL, provenance, withdrawal of an old release", () => {
  const pli = syntheticSeries.priceLevels;
  const de = priceLevelFactor(pli, "AT", "DE", TODAY)!;
  assert.deepEqual(
    [de.year, de.anchorGeo, de.geo, de.ratio],
    [2025, "AT", "DE", 108.4 / 116.8],
  );
  assert.deepEqual([de.updated, de.retrievedAt], ["2026-07-09", "2026-10-28"]);
  const gr = priceLevelFactor(pli, "ES", "GR", TODAY)!;
  assert.deepEqual([gr.geo, gr.provisional], ["EL", true]);
  assert.ok(priceLevelFactor(pli, "AT", "DE", "2027-10-31"));
  assert.equal(priceLevelFactor(pli, "AT", "DE", "2027-11-01"), undefined); // >15 months
  assert.equal(priceLevelFactor(pli, "AT", "DE", "2026-07-08"), undefined); // not yet released
  assert.equal(priceLevelFactor(pli, "AT", "XK", TODAY), undefined);
  assert.equal(priceLevelFactor(pli, "AT", "BA", TODAY), undefined);
  assert.throws(() =>
    validateEurostatSeries({
      priceLevels: {
        ...pli,
        values: [...pli.values, { geo: "UK", year: 2025, value: 150 }],
      },
    }),
  );
  assert.throws(() =>
    validateEurostatSeries({
      priceLevels: { ...pli, reviewStatus: "pending" },
    }),
  );
  assert.deepEqual(
    [
      stayCoverage("DE", "city:BER"),
      stayCoverage("XK", "city:PRN"),
      stayCoverage("XK", "city:PEJ"),
      stayCoverage("GB", "city:LON"),
      stayCoverage("GB", "city:BFS"),
      stayCoverage("US", "city:NYC"),
    ],
    ["full", "anchor-only", "outside", "anchor-only", "outside", "outside"],
  );
});

test("undecided countries go to the anchor with the nearest price level; decided groups stand", () => {
  const pli = syntheticSeries.priceLevels;
  const near = (c: string) => scalingAnchor(c, syntheticSeries, TODAY);
  // France 116.0: Austria 116.8 is nearest.
  assert.deepEqual(near("FR"), {
    anchor: "vienna",
    assignment: { method: "nearest-price-level", year: 2025 },
  });
  // Greece 86.1: Spain 85.4, not the Milan guess from the first pass.
  assert.equal(near("GR")?.anchor, "barcelona");
  // Germany is nearer Italy's level (110.8) than Austria's, but its group was decided.
  assert.equal(
    nearestByPriceLevel(pli, "DE", ["AT", "IT"], TODAY)?.anchorGeo,
    "IT",
  );
  assert.deepEqual(near("DE"), {
    anchor: "vienna",
    assignment: { method: "decided" },
  });
  // No snapshot, no computed assignment.
  assert.equal(scalingAnchor("FR", undefined, TODAY), undefined);
  assert.equal(
    near("PT"),
    undefined,
    "no Portuguese price level in this snapshot",
  );
});

// ---------- 3. Resolver ----------

test("anchors use their observed figure unchanged until the next round; no roll-forward", () => {
  const data = stayData();
  const vienna = resolveStayFigure(dest("VIE", "AT"), "EUR", TODAY, data)!;
  assert.deepEqual(
    [vienna.kind, vienna.roomNight.cents, vienna.bandPercent, vienna.band],
    [
      "observed",
      reviewedFigure("vienna").roomNightCents,
      25,
      "editorial-placeholder",
    ],
  );
  const london = resolveStayFigure(dest("LON", "GB"), "EUR", TODAY, data)!;
  assert.deepEqual(
    [london.roomNight.cents, london.bandPercent],
    [reviewedFigure("london").roomNightCents, 35],
  );
  const late = resolveStayFigure(dest("VIE", "AT"), "EUR", REVIEW_AFTER, data)!;
  assert.equal(
    late.roomNight.cents,
    vienna.roomNight.cents,
    "same figure on its last valid day",
  );
  assert.equal(
    resolveStayFigure(dest("VIE", "AT"), "EUR", "2027-02-16", data),
    undefined,
    "replaced, not aged",
  );
});

test("covered cities scale from their anchor; nothing else borrows a figure", () => {
  const data = stayData();
  const vienna = reviewedFigure("vienna");
  const berlin = resolveStayFigure(dest("BER", "DE"), "EUR", TODAY, data)!;
  assert.equal(berlin.kind, "scaled");
  assert.equal(
    berlin.roomNight.cents,
    Math.round(vienna.roomNightCents * (108.4 / 116.8)),
  );
  assert.equal(berlin.bandPercent, 25 + SCALED_BAND_PLACEHOLDER);
  const paris = resolveStayFigure(dest("PAR", "FR"), "EUR", TODAY, data)!;
  assert.deepEqual(
    [paris.anchor.city, paris.assignment?.method],
    ["vienna", "nearest-price-level"],
  );
  assert.equal(
    paris.roomNight.cents,
    Math.round(vienna.roomNightCents * (116.0 / 116.8)),
  );
  assert.equal(
    resolveStayFigure(dest("ATH", "GR"), "EUR", TODAY, data)!.anchor.city,
    "barcelona",
  );
  assert.equal(
    resolveStayFigure(dest("ROM", "IT"), "EUR", TODAY, data)!.bandPercent,
    30 + SCALED_BAND_PLACEHOLDER,
  );
  for (const [d, why] of [
    [dest("SKP", "MK"), "Tirana has no panel; no fallback anchor"],
    [dest("BFS", "GB"), "UK outside London"],
    [dest("PRN", "XK"), "Prishtina has no first-round panel"],
    [dest("IST", "TR"), "Istanbul's round was insufficient"],
    [dest("NYC", "US"), "outside Europe"],
    [dest("BER", "DE", "place:Q64"), "non-city places are not scaled"],
  ] as const)
    assert.equal(resolveStayFigure(d, "EUR", TODAY, data), undefined, why);
  assert.equal(
    resolveStayFigure(dest("VIE", "AT"), "GBP", TODAY, data),
    undefined,
    "no FX on observed prices",
  );
  assert.equal(
    resolveStayFigure(
      dest("BER", "DE"),
      "EUR",
      TODAY,
      stayData(["vienna"], null),
    ),
    undefined,
  );
  // Without Vienna's figure, France does not drift to Milan.
  assert.equal(
    resolveStayFigure(
      dest("PAR", "FR"),
      "EUR",
      TODAY,
      stayData(["milan", "barcelona"]),
    ),
    undefined,
  );
});

// ---------- 4. Holdout ----------

test("holdout predicts each anchor from its price-level neighbour and measures widths by donor sample size", () => {
  const figures = (["vienna", "milan", "barcelona", "london"] as const).map(
    reviewedFigure,
  );
  const h = runHoldout(figures, syntheticSeries.priceLevels, "2026-11-18");
  assert.equal(h.review.status, "pending");
  assert.deepEqual(
    h.figureIds,
    figures.slice(0, 3).map((f) => f.id),
    "London has no price level",
  );
  assert.deepEqual(
    h.pairs.map((p) => [p.heldOut.split("-")[0], p.donor.split("-")[0]]),
    [
      ["vienna", "milan"],
      ["milan", "vienna"],
      ["barcelona", "milan"],
    ],
  );
  const [vie] = h.pairs;
  const milan = reviewedFigure("milan"),
    vienna = reviewedFigure("vienna");
  assert.equal(
    vie.roomNight.predictedCents,
    Math.round(milan.roomNightCents * (116.8 / 110.8)),
  );
  assert.equal(
    vie.roomNight.error,
    (milan.roomNightCents * (116.8 / 110.8) - vienna.roomNightCents) /
      vienna.roomNightCents,
  );
  // Only Vienna is a full-eight donor, and only for Milan: one held-out error is not a measurement.
  assert.deepEqual(h.unsupported, [8]);
  assert.deepEqual(
    h.bands.map((b) => [b.sampleSize, b.n, b.observed.source]),
    [
      [4, 3, "measured"],
      [5, 3, "measured"],
      [6, 3, "measured"],
      [7, 3, "measured"],
      [8, 1, "editorial-placeholder"],
    ],
  );
  assert.deepEqual(h.bands[4].observed, {
    percent: 25,
    source: "editorial-placeholder",
  });
  assert.deepEqual(h.bands[4].scaled, {
    percent: 50,
    source: "editorial-placeholder",
  });
  const lines = describeHoldout(h);
  assert.match(
    lines[4],
    /^8 stays per type: NOT REPLACED \(n=1, fewer than 3\)\. Keeps the editorial placeholder: ±25% observed, ±50% scaled\.$/,
  );
  assert.match(
    lines[3],
    new RegExp(
      `^7 stays per type: REPLACED\\. Measured ±${h.widths[7].percent}% \\(n=3 held-out anchors\\)`,
    ),
  );
  // A band labelled measured on fewer than three errors is rejected outright.
  const reviewed = {
    ...h,
    review: {
      status: "reviewed" as const,
      reviewer: "t",
      reviewedAt: "2026-11-19",
    },
  };
  validateHoldout(reviewed);
  assert.throws(() =>
    validateHoldout({
      ...reviewed,
      bands: reviewed.bands.map((b) =>
        b.sampleSize === 8
          ? { ...b, observed: { percent: 12, source: "measured" as const } }
          : b,
      ),
    }),
  );
  assert.deepEqual(Object.keys(h.widths), ["4", "5", "6", "7"]);
  for (const w of Object.values(h.widths)) {
    assert.equal(w.heldOutAnchors, 3);
    assert.ok(Number.isSafeInteger(w.percent) && w.percent >= 1);
  }
});

test("a reviewed holdout replaces both provisional margins, and withdraws scaling when too wide", () => {
  const holdout = reviewedHoldout({
    6: { percent: 22, heldOutAnchors: 3, predictions: 9 },
    7: { percent: 19, heldOutAnchors: 3, predictions: 9 },
    8: { percent: 16, heldOutAnchors: 3, predictions: 3 },
  });
  const data = { ...stayData(), holdout };
  const vienna = resolveStayFigure(dest("VIE", "AT"), "EUR", TODAY, data)!;
  assert.deepEqual(
    [vienna.bandPercent, vienna.band, vienna.bandN],
    [16, "measured", 3],
  );
  // London: no special case. The same n ≥ 3 rule decides.
  assert.equal(
    resolveStayFigure(dest("LON", "GB"), "EUR", TODAY, data)!.bandPercent,
    22,
  );
  const londonThin = {
    ...stayData(),
    holdout: reviewedHoldout({
      8: { percent: 16, heldOutAnchors: 3, predictions: 3 },
    }),
  };
  const london = resolveStayFigure(
    dest("LON", "GB"),
    "EUR",
    TODAY,
    londonThin,
  )!;
  assert.deepEqual(
    [london.bandPercent, london.band, london.bandN],
    [35, "editorial-placeholder", undefined],
  );
  const berlin = resolveStayFigure(dest("BER", "DE"), "EUR", TODAY, data)!;
  assert.deepEqual(
    [berlin.bandPercent, berlin.band],
    [16, "measured"],
    "no +25 once measured",
  );
  assert.equal(
    resolveStayFigure(dest("ROM", "IT"), "EUR", TODAY, data)!.bandPercent,
    19,
  );
  // Unsupported sample size keeps the provisional rule.
  const partial = {
    ...stayData(),
    holdout: reviewedHoldout(
      { 7: { percent: 19, heldOutAnchors: 3, predictions: 9 } },
      [8],
    ),
  };
  assert.equal(
    resolveStayFigure(dest("VIE", "AT"), "EUR", TODAY, partial)!.bandPercent,
    25,
  );
  // Spec: measured scaled error over ±35% leaves stay anchor-only.
  const wide = {
    ...stayData(),
    holdout: reviewedHoldout({
      8: { percent: 41, heldOutAnchors: 3, predictions: 3 },
    }),
  };
  assert.equal(
    resolveStayFigure(dest("BER", "DE"), "EUR", TODAY, wide),
    undefined,
  );
  assert.equal(
    resolveStayFigure(dest("VIE", "AT"), "EUR", TODAY, wide)!.bandPercent,
    41,
  );
});

// ---------- 5. Pricing: ranges, upper-bound fit, tax ----------

function trip(code: string, country: string, unpriced = false) {
  const t = costTrip("EUR", code, country);
  if (unpriced)
    t.base.transport = {
      mode: "flight",
      flightPricing: { kind: "unavailable", reason: "no-matching-fare" },
    };
  return t;
}

test("an observed anchor prices the stay from its figure; the range is in whole €5, outward", () => {
  const { base, request } = trip("VIE", "AT");
  request.budget = money(300000, "EUR");
  const plan = pricePlan(base, request, "none", undefined, ctx());
  assert.ok(completePlan(plan));
  const roomNight = reviewedFigure("vienna").roomNightCents;
  const stay = roomNight * request.nights;
  assert.equal(plan.accommodation?.kind, "reviewed-estimate");
  assert.equal(plan.accommodation?.quote?.amount.cents, stay);
  assert.deepEqual(plan.accommodation?.quote?.planning?.[0].sourceIds, [
    reviewedFigure("vienna").id,
  ]);
  assert.equal(plan.stayFigure?.kind, "observed");
  assert.equal(
    plan.stayRange!.low.cents,
    Math.floor((stay * 0.75) / 500) * 500,
  );
  assert.equal(
    plan.stayRange!.high.cents,
    Math.ceil((stay * 1.25) / 500) * 500,
  );
  assert.equal(plan.stayRange!.low.cents % 500, 0);
  assert.equal(plan.lodgingTax?.treatment, "possible");
  assert.equal(
    plan.costs.some((c) => c.category === "lodgingTax"),
    false,
  );
});

test("the budget-fit test uses the upper bound: stay high end plus possible tax, each with its reserve", () => {
  const { base, request } = trip("VIE", "AT");
  request.budget = money(300000, "EUR");
  const roomy = pricePlan(base, request, "none", undefined, ctx());
  assert.ok(completePlan(roomy));
  const spend = roomy.budget.estimatedSpend.cents;
  const highSpend =
    spend +
    roomy.stayRange!.high.cents -
    roomy.accommodation!.quote!.amount.cents;
  const upper =
    highSpend +
    safetyBufferFor(money(highSpend, "EUR")).cents +
    roomy.lodgingTax!.upperAllowance!.cents;
  assert.equal(roomy.budget.upperBoundNeeded?.cents, upper);
  assert.equal(
    roomy.budget.remainingAfterReserve.cents,
    request.budget.cents - upper,
  );
  // Exactly the upper bound: fits, with nothing left.
  request.budget = money(upper, "EUR");
  const exact = pricePlan(base, request, "none", undefined, ctx());
  assert.ok(completePlan(exact));
  assert.equal(exact.budget.remainingAfterReserve.cents, 0);
  assert.notEqual(exact.budget.fit, "over");
  // One cent less: the central estimate fits, the upper bound does not. Never "fits".
  request.budget = money(upper - 1, "EUR");
  const short = pricePlan(base, request, "none", undefined, ctx());
  assert.equal(short.pricingCompleteness, "fit-unconfirmed");
  if (short.pricingCompleteness === "fit-unconfirmed") {
    assert.deepEqual(short.fitUnconfirmedBy, ["stay-range", "lodging-tax"]);
    assert.equal(short.upperBoundNeeded?.cents, upper);
    assert.equal(short.conditionalTotal.cents, roomy.budget.budgetNeeded.cents);
  }
  // Over even at the central estimate: a plain overage, measured at the central estimate.
  request.budget = money(roomy.budget.budgetNeeded.cents - 100, "EUR");
  const over = pricePlan(base, request, "none", undefined, ctx());
  assert.ok(completePlan(over));
  assert.equal(over.budget.fit, "over");
  assert.equal(over.budget.overBudget.cents, 100);
  // A scaled city with no tax term is unconfirmed for the stay range alone.
  const berlin = trip("BER", "DE");
  const b0 = pricePlan(
    berlin.base,
    { ...berlin.request, budget: money(300000, "EUR") },
    "none",
    undefined,
    ctx(),
  );
  assert.ok(completePlan(b0));
  const short2 = pricePlan(
    berlin.base,
    {
      ...berlin.request,
      budget: money(b0.budget.upperBoundNeeded!.cents - 1, "EUR"),
    },
    "none",
    undefined,
    ctx(),
  );
  assert.ok(
    short2.pricingCompleteness === "fit-unconfirmed" &&
      short2.fitUnconfirmedBy.join() === "stay-range",
  );
});

test("leaves for flights uses the high end of the stay band and the tax upper bound", () => {
  const { base, request } = trip("VIE", "AT", true);
  request.budget = money(150000, "EUR");
  const plan = pricePlan(base, request, "none", undefined, ctx());
  assert.equal(plan.pricingCompleteness, "flight-unpriced");
  if (plan.pricingCompleteness !== "flight-unpriced") return;
  const stay = plan.accommodation!.quote!.amount.cents;
  const highExtra = plan.stayRange!.high.cents - stay;
  const expected = maxAffordableFlight(
    money(request.budget.cents - plan.lodgingTax!.upperAllowance!.cents, "EUR"),
    money(plan.knownNonFlightCosts.cents + highExtra, "EUR"),
  )!;
  assert.equal(plan.flightAffordability.status, "calculated");
  assert.deepEqual(plan.flightAffordability.ceiling, expected);
  const room = flightRoom(plan)!;
  assert.ok(room.status === "room");
  assert.equal(room.knownRange!.high.cents - room.known.cents, highExtra);
  assert.equal(
    room.knownRange!.high.cents +
      room.ceiling.cents +
      room.reserve.cents +
      plan.lodgingTax!.upperAllowance!.cents,
    request.budget.cents,
  );
});

test("a scaled city carries its anchor's tax treatment: no destination tax term", () => {
  const { base, request } = trip("BER", "DE");
  request.budget = money(300000, "EUR");
  const plan = pricePlan(base, request, "none", undefined, ctx());
  assert.ok(completePlan(plan));
  assert.equal(plan.lodgingTax?.treatment, "inherited");
  assert.equal(plan.lodgingTax?.bandPercent, 50);
  assert.equal(plan.lodgingTax?.upperAllowance, undefined);
  assert.equal(
    plan.costs.some((c) => c.category === "lodgingTax"),
    false,
  );
});

test("non-standard tiers and cities without a figure never inherit one", () => {
  const { base, request } = trip("VIE", "AT");
  request.preferences = { ...request.preferences, stayLevel: "comfort" };
  assert.equal(
    pricePlan(base, request, "none", undefined, ctx()).pricingCompleteness,
    "stay-unpriced",
  );
  const oslo = trip("OSL", "NO");
  const withData = pricePlan(oslo.base, oslo.request, "none", undefined, ctx());
  const without = pricePlan(
    oslo.base,
    oslo.request,
    "none",
    undefined,
    ctx({ figures: [] }),
  );
  assert.equal(withData.accommodation?.kind, "generic-estimate");
  assert.deepEqual(withData, without);
  const vie = trip("VIE", "AT");
  const live = pricePlan(vie.base, vie.request, "none", undefined, {
    today: TODAY,
    now: stayNow,
    profiles: [],
  });
  assert.equal(live.accommodation?.kind, "generic-estimate");
  assert.equal(live.stayFigure, undefined);
});

// ---------- 6. The card ----------

buildSync({
  entryPoints: ["src/components/travel/ResultCard.tsx"],
  outdir: ".test-build/stay-figure-ui",
  bundle: true,
  platform: "node",
  packages: "external",
  format: "cjs",
});
function render(plan: TripPlan) {
  return renderInChild(
    `const React=require('react');const {renderToStaticMarkup}=require('react-dom/server');const {ResultCard}=require('./.test-build/stay-figure-ui/ResultCard.js');process.stdout.write(renderToStaticMarkup(React.createElement(ResultCard,${CHILD_INPUT})));`,
    { plan, locale: "en", t: en, index: 0, currentYear: "2027" },
  );
}
const text = (html: string) =>
  html
    .replace(/<[^>]+>/g, " ")
    .replace(/&#x27;|&#39;/g, "'")
    .replace(/\s+/g, " ");
function card(
  code: string,
  country: string,
  data = stayData(),
  budget = 200000,
) {
  const { base, request } = trip(code, country, true);
  request.budget = money(budget, "EUR");
  const plan = pricePlan(base, request, "none", undefined, ctx(data));
  assert.equal(plan.pricingCompleteness, "flight-unpriced", code);
  return text(render(plan));
}

test("unapproved synthetic panels and country scaling do not enter the production card registry", () => {
  for (const [code, country] of [
    ["VIE", "AT"],
    ["MIL", "IT"],
    ["ROM", "IT"],
    ["LON", "GB"],
    ["OSL", "NO"],
  ]) {
    const html = card(code, country);
    assert.match(html, /Check room prices for/);
    assert.doesNotMatch(
      html,
      /Stay scaled from|Measured · three-star room panel|Eurostat/,
    );
  }
  const berlin = card("BER", "DE");
  assert.match(berlin, /126.82/);
  assert.match(berlin, /Published · all hotel classes/);
  assert.doesNotMatch(berlin, /scaled from Vienna|50% range/);
});
