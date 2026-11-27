import assert from "node:assert/strict";
import { test } from "node:test";
import { createTravelProviders } from "./fixtures/archived-destination-data";
import { createTravelpayoutsDiscovery } from "./flight-provider-fixture";
import { defaultRequest } from "./fixtures/prishtina-request";
import { getTripTemplates } from "../src/services/travel";
import {
  selectTripDetailTemplate,
  sharedResultTemplate,
} from "../src/services/trip-detail-selection";
import { pricePlan } from "../src/domain/pricing";
import { matchingFlight, referenceFlight } from "../src/domain/flight-pricing";
import { curate, MAX_UNPRICED_CARDS } from "../src/domain/ranking";
import type { TripRequest, TripTemplate } from "../src/domain/types";

const now = new Date("2026-10-27T15:00:00Z");
// Searched 12–15 Dec from Prishtina; every fare below is synthetic.
const request: TripRequest = {
  ...defaultRequest,
  budget: { cents: 90000, currency: "EUR" },
  when: "custom",
  dates: { startDate: "2026-12-12", endDate: "2026-12-15", flexibleDays: 0 },
  nights: 3,
};
// Shaped like the live PRN→Basel row: metro code EAP, airport BSL.
const row = (price: number, departure: string, ret: string) => ({
  origin: "PRN",
  origin_airport: "PRN",
  destination: "EAP",
  destination_airport: "BSL",
  price,
  departure_at: `${departure}T20:55:00+01:00`,
  return_at: `${ret}T11:10:00+01:00`,
  transfers: 0,
  airline: "U2",
  link: `/search/PRN${departure.slice(8, 10)}12BSL${ret.slice(8, 10)}121`,
  found_at: "2026-10-24T17:06:55Z",
});
type Row = ReturnType<typeof row>;

async function providers(broad: Row[], targeted: Row[], queries: string[]) {
  const p = await createTravelProviders(
    {},
    async () => assert.fail("No external metadata"),
    false,
    request,
  );
  p.discovery = createTravelpayoutsDiscovery(
    "synthetic-trip-detail-continuity",
    async (url) => {
      const target = new URL(url).searchParams.get("destination");
      queries.push(target ?? "BROAD");
      return Response.json({
        success: true,
        currency: "EUR",
        data: target ? targeted : broad,
      });
    },
    () => now,
    100,
  );
  return p;
}
const fareOf = (template: TripTemplate | undefined) => {
  assert.ok(template);
  const plan = pricePlan(template, request);
  const fare = matchingFlight(plan) ?? referenceFlight(plan);
  return fare && `${fare.price.amount.cents}:${fare.scope.dates.startDate}`;
};

test("a targeted Basel search keeps a fare filed under the EAP metro code", async () => {
  const queries: string[] = [];
  const p = await providers([], [row(50, "2026-12-25", "2026-12-31")], queries);
  const search = await getTripTemplates(request, p, "basel");
  assert.ok(queries.includes("BSL"));
  assert.equal(
    fareOf(selectTripDetailTemplate(search.templates, request, "basel")),
    "5000:2026-12-25",
  );
});

test("a card's fare is its trip page's fare, even when a targeted search would pick another", async () => {
  const shown = row(146, "2026-12-20", "2026-12-29");
  const closer = row(174, "2026-12-12", "2026-12-20");
  const queries: string[] = [];
  const p = await providers([shown], [shown, closer], queries);

  const results = await getTripTemplates(request, p);
  // As the results page curates it.
  const card = curate(
    results.templates.map((t) => pricePlan(t, request)),
    request,
    { unpricedCards: MAX_UNPRICED_CARDS },
  ).cards.find((plan) => plan.id === "basel");
  assert.ok(card);
  assert.equal(referenceFlight(card)?.price.amount.cents, 14600);

  // Trip page: the results search's template wins.
  const shared = sharedResultTemplate(results.templates, request, "basel");
  assert.equal(fareOf(shared), "14600:2026-12-20");

  // Control: the targeted search alone would have shown a different fare.
  const targeted = await getTripTemplates(request, p, "basel");
  assert.equal(
    fareOf(selectTripDetailTemplate(targeted.templates, request, "basel")),
    "17400:2026-12-12",
  );
});

test("a card without a fare falls back to the targeted search", async () => {
  const p = await providers([], [], []);
  const results = await getTripTemplates(request, p);
  assert.equal(
    sharedResultTemplate(results.templates, request, "basel"),
    undefined,
  );
});
