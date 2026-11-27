import { test } from "node:test";
import assert from "node:assert/strict";
import {
  roomEvidence,
  tripCostVerdict,
  validatePublishedRooms,
  type PublishedRoom,
} from "../src/domain/room-evidence";
import { publishedRooms } from "../src/domain/costs/published-rooms";
import { reviewedStayData } from "../src/domain/costs/reviewed-stay-data";
import { reviewedFigure } from "./stay-figure-fixtures";
import { monthPlace } from "../src/domain/month-places";
import screen from "../content/fares/tirana-screen-2026-11-16.json";
import publicFigures from "../public/data/room-market-context/figures.json";
import { CHILD_INPUT, renderInChild } from "./child-render";
import type { TripCostCard } from "../src/components/travel/TripCostCard";

const input = {
  flightCents: 12000,
  budgetCents: 60000,
  checkIn: "2026-12-15",
  checkOut: "2026-12-17",
  adults: 2,
  rooms: 1,
  otherCosts: {
    foodCents: 12000,
    transportCents: 4000,
    chargesCents: 2000,
    reserveCents: 3000,
  },
};
test("all launch audit destinations have a city and country for room search", () => {
  for (const row of screen.fares)
    assert.ok(monthPlace(row.destination), row.destination);
});
test("published figures carry exact amount, period and reusable source; review expiry withdraws them", () => {
  assert.deepEqual(
    publicFigures,
    publishedRooms.filter((f) => f.countryCode !== "ES"),
  );
  assert.deepEqual(
    publishedRooms
      .filter((f) => f.countryCode === "DE")
      .map((f) => [f.cityCode, f.roomNightCents, f.period.label]),
    [
      ["BER", 12682, "2024 annual average"],
      ["FRA", 11559, "2025 annual average"],
    ],
  );
  validatePublishedRooms(publishedRooms);
  assert.throws(() =>
    validatePublishedRooms([{ ...publishedRooms[0], roomNightCents: NaN }]),
  );
  assert.equal(
    roomEvidence("BER", "DE", "2026-11-19", publishedRooms, reviewedStayData)
      .kind,
    "published",
  );
  assert.equal(
    roomEvidence("BER", "AT", "2026-11-19", publishedRooms, reviewedStayData)
      .kind,
    "unavailable",
  );
  assert.equal(
    roomEvidence("BER", "DE", "2027-02-20", publishedRooms, reviewedStayData)
      .kind,
    "unavailable",
  );
});

function renderCard(props: Parameters<typeof TripCostCard>[0]) {
  return renderInChild(
    `
    const { createElement } = require('react');
    const { renderToStaticMarkup } = require('react-dom/server');
    const { TripCostCard } = require('./.test-build/src/components/travel/TripCostCard.js');
    process.stdout.write(renderToStaticMarkup(createElement(TripCostCard, ${CHILD_INPUT})));
  `,
    props,
  );
}
test("measured card exposes the actual quote spread, dates, scope and firm margin only with a complete basket", () => {
  // Synthetic Vienna fixture, never imported by the application.
  const evidence = {
    kind: "measured" as const,
    figure: reviewedFigure("vienna"),
  };
  const props = {
    city: "Vienna",
    country: "Austria",
    evidence,
    costs: { ...input, budgetCents: 100000 },
  };
  const html = renderCard(props);
  assert.match(html, /Measured · three-star room panel/);
  assert.match(html, /Three-star rooms we checked/);
  assert.match(html, /2026-12-15/);
  assert.match(html, /Across the rooms checked/);
  assert.match(html, /data-verdict="measured"/);
  assert.match(html, /not a measured confidence interval/);
  assert.match(html, /booking.com\/searchresults/);
  const incomplete = renderCard({
    ...props,
    costs: { ...input, otherCosts: undefined },
  });
  assert.doesNotMatch(incomplete, /Not yet priced|not yet known|Trip total/);
  assert.match(incomplete, /Check room prices for 15–17 December/);
  assert.doesNotMatch(incomplete, /Across the rooms checked/);
});
test("published and unavailable cards render visibly different scope and verdicts", () => {
  const props = { city: "Berlin", country: "Germany", costs: input };
  const pooled = renderCard({ ...props, evidence: publishedRooms[0] });
  assert.match(pooled, /€126\.82/);
  assert.match(pooled, /Published · all hotel classes/);
  assert.match(pooled, /2024 annual average/);
  assert.match(
    pooled,
    /Citywide average; individual rooms and your dates will vary/,
  );
  assert.doesNotMatch(
    pooled,
    /under your budget|data-verdict="published-class"/,
  );
  const classified = renderCard({
    ...props,
    evidence: {
      ...publishedRooms[0],
      scope: "three-star",
      roomNightCents: 12100,
    },
  });
  assert.match(classified, /roughly €28 under your budget/);
  assert.match(classified, /Individual rooms vary/);
  const missing = renderCard({ ...props, evidence: { kind: "unavailable" } });
  assert.match(missing, /Check room prices for 15–17 December/);
  assert.doesNotMatch(
    missing,
    /Not yet priced|not yet known|Not yet known|Trip total/,
  );
});
test("pooled context never enters a total, fit verdict or synthetic budget band", () => {
  for (const budgetCents of [10000, 60000, 120000]) {
    const v = tripCostVerdict(publishedRooms[0], { ...input, budgetCents });
    assert.equal(v.basis, "incomplete");
    assert.equal(v.low, undefined);
    assert.equal(v.high, undefined);
    assert.match(v.text, /market context only/i);
  }
});
test("no city is marked measured before accepted panel observations exist", () => {
  assert.equal(reviewedStayData.figures.length, 0);
  assert.deepEqual(
    roomEvidence("MIL", "IT", "2026-11-19", publishedRooms, reviewedStayData),
    { kind: "unavailable" },
  );
});
test("a reviewed panel takes precedence only in its own city and within its review window", () => {
  const figure = reviewedFigure("vienna");
  assert.equal(
    roomEvidence("VIE", "AT", "2026-11-19", [], { figures: [figure] }).kind,
    "measured",
  );
  assert.equal(
    roomEvidence("BER", "DE", "2026-11-19", publishedRooms, {
      figures: [figure],
    }).kind,
    "published",
  );
  assert.equal(
    roomEvidence("VIE", "AT", "2027-02-16", [], { figures: [figure] }).kind,
    "unavailable",
  );
  assert.equal(
    roomEvidence("VIE", "AT", "2026-11-19", [], {
      figures: [{ ...figure, review: { status: "pending" } }],
    }).kind,
    "unavailable",
  );
});
test("measured margin uses the exact contributing quote spread, not the provisional percentage", () => {
  const figure = reviewedFigure("vienna");
  const room = { kind: "measured" as const, figure };
  const prices = figure.contributors
    .filter((c) => c.stayType === "weekday")
    .map((c) => c.twoNightCents);
  const v = tripCostVerdict(room, input);
  const base = 33000;
  assert.equal(v.low, base + Math.min(...prices));
  assert.equal(v.high, base + Math.max(...prices));
  assert.equal(v.basis, "measured");
  assert.match(v.text, /Some checked rooms/);
  assert.match(
    tripCostVerdict(room, { ...input, budgetCents: 100000 }).text,
    /Across the rooms checked/,
  );
  assert.equal(
    tripCostVerdict(room, { ...input, checkIn: "2026-12-16" }).basis,
    "incomplete",
  );
  assert.equal(
    tripCostVerdict(room, { ...input, otherCosts: undefined }).basis,
    "incomplete",
  );
  assert.equal(
    tripCostVerdict(room, { ...input, flightCents: undefined }).basis,
    "incomplete",
  );
  assert.equal(
    tripCostVerdict(room, { ...input, adults: 3 }).basis,
    "incomplete",
  );
  assert.match(
    tripCostVerdict(room, { ...input, budgetCents: 1 }).text,
    /Every contributing room/,
  );
  assert.match(
    tripCostVerdict(room, { ...input, budgetCents: v.low! }).text,
    /Some checked rooms/,
  );
});
test("published class headroom is approximate and says individual rooms vary", () => {
  const room: PublishedRoom = {
    ...publishedRooms[0],
    scope: "three-star",
    roomNightCents: 12100,
  };
  const v = tripCostVerdict(room, input);
  assert.equal(v.low, 57200);
  assert.match(v.text, /roughly €28 under/);
  assert.match(v.text, /Individual rooms vary/);
  assert.equal(
    tripCostVerdict(room, { ...input, otherCosts: undefined }).basis,
    "incomplete",
  );
});

test("Barcelona has a dated room search even without room evidence", () => {
  assert.deepEqual(monthPlace("BCN"), {
    name: "Barcelona",
    country: "Spain",
    countryCode: "ES",
  });
  const html = renderCard({
    city: "Barcelona",
    country: "Spain",
    costs: { ...input, otherCosts: undefined },
    evidence: { kind: "unavailable" },
  });
  assert.match(html, /ss=Barcelona%2C\+Spain/);
  assert.match(html, /checkin=2026-12-15/);
  assert.match(html, /group_adults=2/);
  assert.match(html, /no_rooms=1/);
});
test("a measured headline only uses quotes for the selected stay; otherwise it is a dated benchmark", () => {
  const figure = reviewedFigure("vienna");
  const evidence = { kind: "measured" as const, figure };
  const weekday = figure.contributors.filter((c) => c.stayType === "weekday");
  const html = renderCard({
    city: "Vienna",
    country: "Austria",
    evidence,
    costs: { ...input, otherCosts: undefined },
  });
  assert.match(html, /Quotes for your selected stay dates/);
  assert.ok(weekday.length >= 4);
  const otherDates = renderCard({
    city: "Vienna",
    country: "Austria",
    evidence,
    costs: { ...input, checkIn: "2027-01-19", checkOut: "2027-01-21" },
  });
  assert.match(otherDates, /Measured room benchmark/);
  assert.doesNotMatch(
    otherDates,
    /Quotes for your selected stay dates|data-verdict/,
  );
});

test("Amsterdam headlines the three-star average beside the same-period pooled comparison", () => {
  const evidence = roomEvidence(
    "AMS",
    "NL",
    "2026-11-20",
    publishedRooms,
    reviewedStayData,
  );
  assert.equal(evidence.kind, "published");
  const html = renderCard({
    city: "Amsterdam",
    country: "Netherlands",
    evidence,
    costs: {
      ...input,
      flightCents: 42400,
      checkIn: "2026-12-25",
      checkOut: "2026-12-27",
      otherCosts: undefined,
    },
  });
  assert.match(html, /Three-star hotels.*averaged €138 per room\/night/);
  assert.match(html, /All hotel classes: €170 per room\/night/);
  assert.match(html, /2025 annual average/);
  assert.match(html, /tourist tax extra/);
  assert.match(html, /Check room prices for 25–27 December/);
  assert.doesNotMatch(
    html,
    /data-verdict|Trip total|Not yet known|under your budget/,
  );
});
