// Historical record/access regression. Live archive exclusion is tested in destination-archive.test.ts.
import assert from "node:assert/strict";
import { test } from "node:test";
import { buildSync } from "esbuild";
import { CHILD_INPUT, renderInChild } from "./child-render";
import { createTravelpayoutsDiscovery } from "./flight-provider-fixture";
import { createOfflineTravelProviders as createTravelProviders } from "./fixtures/archived-destination-data";
import { normalizeLocation } from "../src/providers/server/location-search";
import { getTripTemplates } from "../src/services/travel";
import { loadDestinationGuide } from "./fixtures/archived-destination-data";
import { selectTripDetailTemplate } from "../src/services/trip-detail-selection";
import { destinationAccess } from "./fixtures/archived-destination-data";
import { parseRequest, requestQuery } from "../src/domain/request";
import { pricePlan } from "../src/domain/pricing";
import { curate } from "../src/domain/ranking";
import { flightHandoff } from "../src/domain/affiliate";
import {
  selfAirportFare,
  classifyFareEvidence,
} from "../src/domain/fare-evidence";
import { discoveryHref } from "../src/domain/destination-discovery";
import { flightDiscoveryUnavailable } from "../src/components/travel/results-state";
import { costEstimateLabel } from "../src/i18n/cost-provenance";
import type { TripRequest, TripPlan } from "../src/domain/types";
import en from "../src/i18n/en.json";
import { defaultRequest } from "../src/domain/request";

const now = Date.parse("2026-10-24T10:00:00Z");
const origins = [
  ["ZRH", "CH"],
  ["JFK", "US"],
  ["GRU", "BR"],
  ["SIN", "SG"],
  ["DXB", "AE"],
  ["JNB", "ZA"],
  ["SYD", "AU"],
] as const;
const routes = [
  ["VIE", "VIE"],
  ["LON", "LHR"],
  ["PAR", "CDG"],
  ["NYC", "JFK"],
  ["IST", "IST"],
  ["BCN", "BCN"],
  ["SIN", "SIN"],
  ["MEX", "MEX"],
  ["TYO", "HND"],
  ["OSA", "KIX"],
  ["BKK", "BKK"],
  ["RAK", "RAK"],
  ["CPT", "CPT"],
  ["RIO", "GIG"],
  ["SYD", "SYD"],
  ["DXB", "DXB"],
];
async function requestFor(
  code = "ZRH",
  guide?: string,
  query: Record<string, string> = {},
) {
  const country = origins.find((o) => o[0] === code)![1];
  const origin = normalizeLocation({
    type: "airport",
    code,
    name: code,
    country_code: country,
    country_name: country,
  });
  const target = guide
    ? (await loadDestinationGuide(guide))?.target
    : undefined;
  if (guide) assert.ok(target);
  return parseRequest(
    {
      originPlace: JSON.stringify(origin),
      budget: "2000",
      currency: "USD",
      adults: "2",
      children: "0",
      when: "custom",
      start: "2026-11-20",
      end: "2026-11-22",
      ...(target ? { toPlace: JSON.stringify(target) } : {}),
      ...query,
    },
    undefined,
    "2026-10-24",
  );
}
type Row = [city: string, airport: string, price?: number];
async function search(
  request: TripRequest,
  rows: Row[],
  status = 200,
  preferredId?: string,
) {
  const calls: string[] = [],
    media: string[] = [];
  const fetcher = async (url: string) => {
    const u = new URL(url);
    calls.push(u.hostname);
    if (u.hostname === "autocomplete.travelpayouts.com")
      return Response.json(
        u.searchParams.get("term") === "BCN"
          ? [
              {
                type: "city",
                code: "BCN",
                name: "Barcelona",
                country_code: "ES",
                country_name: "Spain",
              },
            ]
          : [],
      );
    assert.equal(
      u.hostname,
      "api.travelpayouts.com",
      "No other provider I/O is permitted",
    );
    if (status !== 200) return new Response(null, { status });
    return Response.json({
      success: true,
      currency: request.budget.currency,
      data: rows.map(([city, airport, price = 195]) => ({
        origin: request.origin!.airportIata,
        origin_airport: request.origin!.airportIata,
        destination: city,
        destination_airport: airport,
        price,
        currency: request.budget.currency,
        departure_at: request.dates.startDate,
        return_at: request.dates.endDate,
        found_at: "2026-10-24T09:00:00Z",
      })),
    });
  };
  const providers = await createTravelProviders(
    { TRAVELPAYOUTS_API_TOKEN: "synthetic-only" },
    fetcher,
    false,
    request,
  );
  providers.discovery = createTravelpayoutsDiscovery(
    "synthetic-only",
    fetcher,
    () => new Date(now),
  );
  providers.images = {
    async forDestination(id) {
      media.push(id);
      return undefined;
    },
  };
  const result = await getTripTemplates(request, providers, preferredId);
  const plans = result.templates.map((t) => pricePlan(t, request));
  return { ...result, plans, ranked: curate(plans, request), calls, media };
}

for (const airport of ["RRJ", "GIG", "SDU"]) {
  test(`Rio ${airport}: operational identity, cost completeness and handoff survive reload`, async (t) => {
    t.mock.method(Date, "now", () => now);
    const request = await requestFor("GRU", "rio-de-janeiro", {
      budget: "1000",
    });
    const result = await search(request, [["RIO", airport]]);
    assert.equal(result.plans.length, 1);
    const plan = result.plans[0];
    assert.equal(plan.id, "place:Q8678");
    const handoff = flightHandoff(plan)!;
    assert.deepEqual(handoff, {
      originCode: "GRU",
      destinationCode: airport,
      departureDate: "2026-11-20",
      returnDate: "2026-11-22",
      party: { adults: 2, children: 0 },
    });
    if (airport === "RRJ") {
      assert.equal(plan.pricingCompleteness, "required-transfer-unpriced");
      assert.equal(plan.budget, undefined);
      assert.equal(plan.safetyBuffer, undefined);
      assert.equal(plan.arrival?.airportCode, "RRJ");
      assert.equal(plan.arrival?.onwardTransfer.status, "unpriced");
      assert.equal(
        plan.costs.find((c) => c.category === "local")?.amount.cents,
        1800,
      );
      assert.equal(
        plan.costs.some((c) =>
          c.planning?.some((p) => p.component === "arrivalTransport"),
        ),
        false,
      );
      assert.equal(result.ranked.fits.length, 0);
    } else {
      assert.equal(plan.pricingCompleteness, "complete");
      assert.equal(plan.budget?.budgetNeeded.cents, 98010);
      assert.equal(
        plan.costs.find((c) => c.category === "local")?.amount.cents,
        6300,
      );
    }
    const restored = parseRequest(
      Object.fromEntries(new URLSearchParams(requestQuery(plan.request))),
      undefined,
      "2026-10-24",
    );
    const reloaded = await search(restored, [["RIO", airport]], 200, plan.id);
    const detail = selectTripDetailTemplate(
      reloaded.templates,
      restored,
      plan.id,
      destinationAccess.get(plan.id),
    );
    assert.ok(detail);
    const detailPlan = pricePlan(detail, restored);
    assert.equal(detailPlan.pricingCompleteness, plan.pricingCompleteness);
    assert.deepEqual(flightHandoff(detailPlan), handoff);
    if (airport === "RRJ") {
      const outage = await search(restored, [], 503, plan.id);
      assert.equal(
        outage.plans[0].pricingCompleteness,
        "required-transfer-unpriced",
      );
      assert.equal(outage.plans[0].arrival?.airportCode, "RRJ");
      assert.equal(outage.plans[0].budget, undefined);
    }
  });
}

test("RRJ unknown cost cannot displace a complete SDU arrival even with lower airfare", async (t) => {
  t.mock.method(Date, "now", () => now);
  const result = await search(await requestFor("GRU", "rio-de-janeiro"), [
    ["RIO", "RRJ", 1],
    ["RIO", "SDU", 195],
  ]);
  assert.equal(result.ranked.fits[0].flightPricing?.kind, "priced");
  assert.equal(flightHandoff(result.ranked.fits[0])?.destinationCode, "SDU");
});

test("whole-trip evaluation keeps €353.10 Istanbul in a €380 broad search, with no extra fetch or image fan-out", async (t) => {
  t.mock.method(Date, "now", () => now);
  const request = await requestFor("ZRH", undefined, {
    currency: "EUR",
    budget: "380",
    adults: "1",
  });
  const result = await search(
    request,
    routes.map(([city, airport]) => [
      city,
      airport,
      city === "IST" ? 110 : 100,
    ]),
  );
  assert.equal(result.ranked.fits[0].destination.name.en, "Istanbul");
  assert.equal(result.ranked.fits[0].budget.budgetNeeded.cents, 35310);
  assert.ok(new Set(result.templates.map((p) => p.id)).size <= 10);
  assert.ok(new Set(result.media).size <= 10);
  assert.equal(
    result.calls.filter((h) => h === "api.travelpayouts.com").length,
    1,
  );
  assert.ok(
    result.calls.filter((h) => h === "autocomplete.travelpayouts.com").length <=
      10,
  );
  for (const plan of result.plans) {
    assert.deepEqual(plan.request.budget, request.budget);
    assert.deepEqual(plan.request.dates, request.dates);
    assert.deepEqual(plan.request.party, request.party);
    assert.equal(plan.origin.id, request.originId);
  }
});

test("Tokyo City search keeps its region identity; Kyoto gateway and stale FX remain incomplete", async (t) => {
  t.mock.method(Date, "now", () => now);
  const tokyo = await search(
    await requestFor("SYD", undefined, { styles: "city" }),
    [["TYO", "HND"]],
  );
  assert.equal(tokyo.ranked.fits[0].id, "place:Q1490");
  assert.deepEqual(tokyo.ranked.fits[0].destination.styles, ["city"]);
  for (const airport of ["KIX", "ITM"]) {
    const kyoto = await search(await requestFor("SIN", "kyoto"), [
      ["OSA", airport],
    ]);
    assert.equal(kyoto.plans[0].id, "place:Q34600");
    assert.equal(kyoto.plans[0].arrival?.airportCode, airport);
    assert.equal(
      kyoto.plans[0].pricingCompleteness,
      "required-transfer-unpriced",
    );
    assert.equal(kyoto.plans[0].budget, undefined);
    assert.equal(flightHandoff(kyoto.plans[0])?.destinationCode, airport);
  }
});

test("self-airport fares never create broad results and domain repricing rejects them", async (t) => {
  t.mock.method(Date, "now", () => now);
  const request = await requestFor("SYD");
  assert.equal((await search(request, [["SYD", "SYD"]])).templates.length, 0);
  const valid = (await search(request, [["TYO", "HND"]])).plans[0];
  assert.equal(valid.flightPricing?.kind, "priced");
  if (valid.flightPricing?.kind !== "priced") return;
  const fare = valid.flightPricing.fare;
  const invalid = { ...fare, destinationAirport: "SYD" };
  assert.equal(selfAirportFare(invalid), true);
  assert.equal(classifyFareEvidence(invalid, request), "invalid");
  assert.equal(
    selfAirportFare({ ...fare, originCode: "TYO", originAirport: "NRT" }),
    false,
    "Distinct operational airports must not be collapsed to a city group",
  );
});

for (const [origin] of origins) {
  test(`${origin} outage: no arbitrary regional fallback, preserved recovery context, one attempt`, async (t) => {
    t.mock.method(Date, "now", () => now);
    const request = await requestFor(origin, undefined, {
      budget: "1500",
      adults: "2",
      children: "1",
      styles: "city",
      flexDays: "3",
      stay: "simple",
    });
    const result = await search(request, [], 503);
    assert.equal(result.templates.length, 0);
    assert.equal(result.ranked.cheapest, undefined);
    assert.equal(flightDiscoveryUnavailable(result.issues), true);
    assert.equal(
      result.calls.filter((h) => h === "api.travelpayouts.com").length,
      1,
    );
    const href = discoveryHref(
      "/destinations",
      Object.fromEntries(new URLSearchParams(requestQuery(request))),
    );
    assert.deepEqual(
      parseRequest(
        Object.fromEntries(new URL(href, "https://example.test").searchParams),
        undefined,
        "2026-10-24",
      ),
      request,
    );
    const empty = await search(request, []);
    assert.equal(
      flightDiscoveryUnavailable(empty.issues),
      false,
      "An empty successful response is not an outage",
    );
  });
}
test("explicit valid destination remains an unpriced plan during an outage", async (t) => {
  t.mock.method(Date, "now", () => now);
  const request = await requestFor("SYD", "tokyo", { styles: "city" });
  const result = await search(request, [], 503);
  assert.deepEqual(
    result.templates.map((p) => p.id),
    ["place:Q1490"],
  );
  assert.equal(result.plans[0].pricingCompleteness, "flight-unpriced");
  assert.equal(result.plans[0].budget, undefined);
});

// Render real production cards in normal React, outside node:test's react-server condition.
buildSync({
  entryPoints: ["src/components/travel/ResultCard.tsx"],
  outfile: ".test-build/worldwide-quality-card.cjs",
  bundle: true,
  platform: "node",
  format: "cjs",
  packages: "external",
});
function card(plan: TripPlan) {
  return renderInChild(
    `const React=require('react');const {renderToStaticMarkup}=require('react-dom/server');const {ResultCard}=require('./.test-build/worldwide-quality-card.cjs');const props=${CHILD_INPUT};process.stdout.write(renderToStaticMarkup(React.createElement(ResultCard,props)));`,
    {
      plan,
      locale: "en",
      t: en,
      index: 0,
      currentYear: "2026",
    },
  );
}
test("real cards disclose missing room costs and suppress unsupported totals, fit and remaining money", async (t) => {
  t.mock.method(Date, "now", () => now);
  const request = await requestFor("GRU", "rio-de-janeiro", { budget: "1000" });
  for (const airport of ["RRJ", "GIG"]) {
    const result = await search(request, [["RIO", airport]]);
    const html = card(result.plans[0]);
    assert.match(html, /Check room prices for/);
    if (airport === "RRJ") {
      assert.doesNotMatch(html, /Trip total|Not yet known|Not yet priced/);
      assert.doesNotMatch(
        html,
        /result-price-complete|result-balance|left after safety reserve|class="total"/,
      );
      assert.match(html, /airport transfers, local transport/);
    }
  }
  assert.equal(
    costEstimateLabel(
      {
        status: "reviewed",
        reviewedComponents: ["stay"],
        generalComponents: [],
      },
      "en",
    ),
    "Reviewed destination estimate",
  );
  assert.equal(
    costEstimateLabel(
      {
        status: "mixed",
        reviewedComponents: ["food"],
        generalComponents: ["stay"],
      },
      "en",
    ),
    "Includes general planning estimates",
  );
});

buildSync({
  entryPoints: ["src/components/travel/Results.tsx"],
  outfile: ".test-build/worldwide-quality-results.cjs",
  bundle: true,
  platform: "node",
  format: "cjs",
  packages: "external",
});
test("outage recovery is visible; no retry links or hidden-only explanation", async (t) => {
  t.mock.method(Date, "now", () => now);
  for (const request of [await requestFor("SYD"), defaultRequest]) {
    const providers = await createTravelProviders(
      {},
      async () => {
        throw Error("No network");
      },
      false,
      request,
    );
    providers.discovery = {
      async discover() {
        return { status: "unavailable", reason: "rate-limit" };
      },
    };
    const result = await getTripTemplates(request, providers);
    const html = renderInChild(
      `
      const React=require('react');const {renderToStaticMarkup}=require('react-dom/server');
      const {AppRouterContext}=require('next/dist/shared/lib/app-router-context.shared-runtime');
      const {Results}=require('./.test-build/worldwide-quality-results.cjs');
      const props=${CHILD_INPUT};
      process.stdout.write(renderToStaticMarkup(React.createElement(AppRouterContext.Provider,{value:{push(){},prefetch(){}}},React.createElement(Results,props))));
    `,
      {
        bases: result.templates,
        request,
        issues: result.issues,
        locale: "en",
        t: en,
        today: "2026-10-24",
      },
    );
    const visible = html.split('<details class="results-methodology">')[0];
    assert.match(visible, /Flight data is temporarily unavailable/);
    assert.match(visible, /Browse destination guides/);
    assert.doesNotMatch(
      visible,
      /No flights|Try flexible dates|Include nearby airports|retry/i,
    );
    assert.ok(
      visible.includes(
        discoveryHref(
          "/destinations",
          Object.fromEntries(new URLSearchParams(requestQuery(request))),
        ).replace(/&/g, "&amp;"),
      ),
    );
    // No demo road trips in production (2026-10-27): the outage notice stands alone.
    assert.ok(result.templates.every((base) => base.transport.mode !== "road"));
  }
});
