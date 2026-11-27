import { completePlan, referenceFlight } from "../src/domain/flight-pricing";
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  launchAirports,
  curatedNearbyAirports,
} from "../src/providers/nearby-airports";
import { boundedDepartures } from "../src/domain/airports";
import { locations } from "../src/catalogue/locations";
import { flightDestinations } from "../src/catalogue/flight-destinations";
import { parseRequest, requestQuery } from "../src/domain/request";
import { defaultRequest } from "./fixtures/prishtina-request";
import { pricePlan } from "../src/domain/pricing";
import { curate } from "../src/domain/ranking";
import {
  withAirportComparison,
  minimumAirportSaving,
} from "../src/domain/airport-comparison";
import { flightHandoff } from "../src/domain/affiliate";
import { money } from "../src/domain/budget";
import { getTripTemplates } from "../src/services/travel";
import { createTravelProviders } from "./flight-provider-fixture";
import {
  createAviasalesAffiliate,
  aviasalesSearchUrl,
} from "../src/providers/server/aviasales-affiliate";
import type { TripRequest, TravelLocation } from "../src/domain/types";
import type { ProviderFetch } from "../src/providers/server/http";
import { readFileSync } from "node:fs";
const en = JSON.parse(readFileSync("src/i18n/en.json", "utf8"));
const sq = JSON.parse(readFileSync("src/i18n/sq.json", "utf8"));
const request: TripRequest = {
  ...defaultRequest,
  when: "custom",
  dates: { startDate: "2026-11-07", endDate: "2026-11-09", flexibleDays: 0 },
  budget: money(100000),
  preferences: { ...defaultRequest.preferences, nearbyAirports: true },
};
const vienna = flightDestinations.find((d) => d.id === "vienna")!;
const code = (origin: TravelLocation) =>
  origin.airportIata ?? origin.cityCode ?? origin.iataCodes?.[0];
async function fixture(
  r = request,
  fares: Record<string, number | "fail" | "empty"> = {
    PRN: 180,
    SKP: 80,
    TIA: 100,
  },
  dates: Record<string, [string, string]> = {},
) {
  const calls: string[] = [];
  let active = 0,
    peak = 0;
  const fetcher: ProviderFetch = async (url, options) => {
    const u = new URL(url);
    if (u.hostname !== "api.travelpayouts.com")
      return Response.json({ query: { pages: [] } });
    const origin = u.searchParams.get("origin")!;
    calls.push(origin);
    active++;
    peak = Math.max(active, peak);
    assert.equal(u.searchParams.get("departure_at"), "2026-11");
    assert.equal(options.cache, "no-store");
    assert.equal(options.next, undefined);
    await Promise.resolve();
    active--;
    const price = fares[origin];
    if (price === "fail") throw Error("fixture-provider-error");
    return Response.json({
      success: true,
      currency: "EUR",
      data:
        typeof price === "number"
          ? [
              {
                origin,
                destination: "VIE",
                price,
                departure_at: dates[origin]?.[0] ?? "2026-11-07",
                return_at: dates[origin]?.[1] ?? "2026-11-09",
                found_at: new Date().toISOString(),
              },
            ]
          : [],
    });
  };
  const providers = await createTravelProviders(
    { TRAVELPAYOUTS_API_TOKEN: "synthetic-test-token" },
    fetcher,
    false,
    r,
  );
  providers.images = {
    async forDestination(id) {
      return { ...vienna.image!, destinationId: id };
    },
  };
  return {
    providers,
    calls,
    peak: () => peak,
    async search(preferred?: string) {
      return getTripTemplates(r, providers, preferred);
    },
  };
}
test("curated PRN/SKP/TIA expansion puts selected city or airport first and defaults to no expansion", () => {
  for (const origin of [
    locations.find((l) => l.id === "prishtina")!,
    ...Object.values(launchAirports),
  ]) {
    const all = curatedNearbyAirports.candidates(request, origin);
    assert.equal(all.length, 3);
    assert.equal(all[0].code, code(origin));
    assert.ok(all[0].selected);
    assert.equal(all[0].transfer, undefined);
    assert.deepEqual(
      new Set(all.map((c) => c.code)),
      new Set(["PRN", "SKP", "TIA"]),
    );
    assert.equal(
      curatedNearbyAirports.candidates(defaultRequest, origin).length,
      1,
    );
  }
});
test("orchestration deduplicates and caps even an oversized provider, rejects missing transfer estimates", async () => {
  const f = await fixture();
  const candidates = curatedNearbyAirports.candidates(
    request,
    locations.find((l) => l.id === "prishtina")!,
  );
  f.providers.nearbyAirports = {
    candidates: () => [
      ...candidates,
      ...candidates,
      {
        ...candidates[1],
        code: "ZRH",
        airport: locations.find((l) => l.id === "zurich")!,
      },
    ],
  };
  const result = await f.search();
  assert.deepEqual(f.calls, ["PRN", "SKP", "TIA"]);
  assert.ok(f.peak() <= 3);
  assert.equal(result.templates.filter((t) => t.id === "vienna").length, 3);
  assert.equal(
    boundedDepartures(locations.find((l) => l.id === "prishtina")!, [
      { ...candidates[1], transfer: undefined },
    ]).length,
    1,
  );
});
test("nearby off makes one request and domestic road/no-flight makes none", async () => {
  for (const r of [
    { ...request, preferences: defaultRequest.preferences },
    { ...request, scope: "domestic" as const },
    { ...request, noFlight: true },
  ]) {
    const f = await fixture(r);
    await f.search();
    assert.deepEqual(
      f.calls,
      r.noFlight || r.scope === "domestic" ? [] : ["PRN"],
    );
  }
});
test("unmapped global origins remain usable without invented airports", async () => {
  for (const [cityCode, name, countryCode] of [
    ["NBO", "Nairobi", "KE"],
    ["TYO", "Tokyo", "JP"],
    ["CPT", "Cape Town", "ZA"],
  ]) {
    const origin: TravelLocation = {
      id: `city:${cityCode}`,
      type: "city",
      name,
      countryCode,
      countryName: { en: name, sq: name },
      cityCode,
      iataCodes: [cityCode],
    };
    const r = { ...request, origin, originId: origin.id };
    const f = await fixture(r, { [cityCode]: 100 });
    const result = await f.search();
    assert.deepEqual(f.calls, [cityCode]);
    assert.ok(result.templates.some((t) => t.id === "vienna"));
    assert.equal(curatedNearbyAirports.candidates(r, origin).length, 1);
  }
});
test("door-to-door costs include transfer once, separate baggage, and unchanged reserve arithmetic", async () => {
  const r = {
    ...request,
    preferences: { ...request.preferences, luggage: true },
  };
  const f = await fixture(r);
  const { templates } = await f.search();
  const plan = pricePlan(
    templates.find(
      (t) => t.id === "vienna" && t.transport.departure?.code === "SKP",
    )!,
    r,
  );
  assert.ok(completePlan(plan));
  const cost = (category: string) =>
    plan.costs.find((c) => c.category === category)!;
  assert.equal(cost("transport").amount.cents, 16000);
  assert.equal(cost("transport").confidence, "recent");
  assert.equal(cost("airportTransfer").amount.cents, 8000);
  assert.equal(
    plan.costs.filter((c) => c.category === "airportTransfer").length,
    1,
  );
  assert.equal(cost("local").amount.cents, 4000);
  assert.equal(cost("baggage").amount.cents, 6000);
  assert.equal(cost("baggage").confidence, "estimate");
  for (const c of plan.costs.filter((c) => c.category !== "transport"))
    assert.equal(c.confidence, "estimate");
  const sum = plan.costs.reduce((n, c) => n + c.amount.cents, 0);
  assert.equal(plan.budget.estimatedSpend.cents, sum);
  assert.equal(plan.safetyBuffer.cents, Math.max(2000, Math.ceil(sum / 10)));
  assert.equal(plan.budget.budgetNeeded.cents, sum + plan.safetyBuffer.cents);
  assert.equal(
    plan.budget.remainingAfterReserve.cents,
    r.budget.cents - sum - plan.safetyBuffer.cents,
  );
  const noBag = pricePlan(
    templates.find(
      (t) => t.id === "vienna" && t.transport.departure?.code === "SKP",
    )!,
    request,
  );
  assert.ok(completePlan(noBag));
  assert.equal(
    noBag.costs.some((c) => c.category === "baggage"),
    false,
  );
  assert.equal(
    plan.budget.estimatedSpend.cents - noBag.budget.estimatedSpend.cents,
    6000,
  );
});
test("savings use complete spend, require meaningful threshold and cannot advertise an airfare-only saving", async () => {
  for (const [skp, expectedSaving] of [
    [80, 12000],
    [150, 0],
    [135, 0],
    [120, 0],
  ]) {
    const f = await fixture(request, { PRN: 180, SKP: skp, TIA: "empty" });
    const { templates } = await f.search();
    const plans = templates
      .filter((t) => t.id === "vienna")
      .map((t) => pricePlan(t, request));
    const alt = withAirportComparison(
      plans.find((p) => p.departure?.code === "SKP")!,
      plans,
    );
    assert.equal(alt.airportSavingCents ?? 0, expectedSaving);
    const winner = curate(plans, request).cheapest;
    assert.equal(winner.departure?.code, expectedSaving ? "SKP" : "PRN");
    assert.equal(curate(plans, request).fitCount, 1);
  }
  assert.equal(minimumAirportSaving(50000, 90), 5000);
  assert.equal(minimumAirportSaving(30000, 300), 10000);
});
test("each airport retains its exact/flexible/weekend dates; references never price the actual trip", async () => {
  for (const [r, actual] of [
    [request, false],
    [
      {
        ...request,
        dates: { ...request.dates, flexibleDays: 3 },
        flexible: true,
      },
      true,
    ],
    [
      {
        ...request,
        dates: {
          ...request.dates,
          mode: "weekends" as const,
          month: "2026-11",
        },
      },
      true,
    ],
  ] as const) {
    const nearbyDates: [string, string] =
      r.dates.mode === "weekends"
        ? ["2026-11-14", "2026-11-16"]
        : ["2026-11-08", "2026-11-10"];
    const f = await fixture(
      r,
      { PRN: 180, SKP: 80, TIA: "empty" },
      { SKP: nearbyDates },
    );
    const result = await f.search();
    const plans = result.templates
      .filter((t) => t.id === "vienna")
      .map((t) => pricePlan(t, r));
    const alt = plans.find((p) => p.departure?.code === "SKP")!;
    assert.equal(alt.costs[0].confidence, actual ? "recent" : "estimate");
    assert.equal(
      alt.request.dates.startDate,
      actual ? nearbyDates[0] : r.dates.startDate,
    );
    assert.equal(
      alt.request.dates.endDate,
      actual ? nearbyDates[1] : r.dates.endDate,
    );
    assert.equal(
      alt.costs.find((c) => c.category === "transport")?.amount.cents,
      actual ? 16000 : undefined,
    );
    assert.equal(!!referenceFlight(alt), !actual);
    assert.equal(
      withAirportComparison(alt, plans).airportSavingCents,
      undefined,
    );
    assert.equal(flightHandoff(alt)?.originCode, "SKP");
  }
});
test("accommodation scales by destination/night/room/level with honest estimates, including a family", async () => {
  const f = await fixture();
  const base = (await f.search()).templates.find((t) => t.id === "vienna")!;
  for (const [party, nights, stayLevel, expected] of [
    [{ adults: 1, children: 0 }, 2, "standard", 18000],
    [{ adults: 2, children: 2 }, 3, "standard", 54000],
    [{ adults: 2, children: 2 }, 3, "simple", 37800],
    [{ adults: 2, children: 2 }, 3, "comfort", 81000],
  ] as const) {
    const r = {
      ...request,
      party,
      nights,
      preferences: { ...request.preferences, stayLevel },
    };
    const plan = pricePlan(
      {
        ...base,
        transport: {
          mode: "flight",
          flightPricing: { kind: "unavailable", reason: "no-matching-fare" },
        },
      },
      r,
    );
    assert.equal(
      plan.costs.find((c) => c.category === "stay")?.amount.cents,
      expected,
    );
    assert.equal(
      plan.costs.find((c) => c.category === "stay")?.confidence,
      "estimate",
    );
  }
  const r = {
    ...request,
    nights: 3,
    preferences: { ...request.preferences, familyStay: true },
  };
  assert.equal(
    pricePlan(
      {
        ...base,
        transport: {
          mode: "flight",
          flightPricing: { kind: "unavailable", reason: "no-matching-fare" },
        },
      },
      r,
    ).accommodation?.paidNights,
    3,
  );
});
test("one failing airport cannot discard successful discovery or create global provider warning", async () => {
  for (const fares of [
    { PRN: "fail", SKP: 80, TIA: "empty" },
    { PRN: 180, SKP: "fail", TIA: 100 },
  ] as const) {
    const f = await fixture(request, fares);
    const result = await f.search();
    assert.ok(result.templates.some((t) => t.id === "vienna"));
    assert.equal(result.issues.length, 0);
  }
});
test("shareable alternative departure retains original origin, actual dates and party through detail and affiliate tracking", async () => {
  const f = await fixture();
  const result = await f.search();
  const winner = curate(
    result.templates
      .filter((t) => t.id === "vienna")
      .map((t) => pricePlan(t, request)),
    request,
  ).cheapest;
  const restored = parseRequest(
    Object.fromEntries(new URLSearchParams(requestQuery(winner.request))),
  );
  assert.equal(restored.originId, "prishtina");
  assert.equal(restored.departureAirport, "SKP");
  const again = await fixture(restored);
  const detail = await again.search("vienna");
  const base = detail.templates.find(
    (t) => t.transport.departure?.code === restored.departureAirport,
  )!;
  const handoff = flightHandoff(pricePlan(base, restored))!;
  assert.equal(handoff.originCode, "SKP");
  assert.equal(handoff.departureDate, "2026-11-07");
  assert.deepEqual(handoff.party, request.party);
  assert.equal(
    aviasalesSearchUrl(handoff, "2026-10-07"),
    "https://www.aviasales.com/search/SKP0711VIE09112",
  );
  const partner = createAviasalesAffiliate(
    {
      TRAVELPAYOUTS_API_TOKEN: "synthetic-token",
      TRAVELPAYOUTS_PROJECT_ID: "123456",
      TRAVELPAYOUTS_MARKER: "654321",
    },
    async (_url, options) => {
      const body = JSON.parse(String(options.body));
      assert.equal(body.links[0].sub_id, "trip_flight");
      assert.ok(body.links[0].url.includes("SKP0711VIE09112"));
      return Response.json({
        code: "success",
        status: 200,
        result: {
          links: [
            {
              code: "success",
              url: body.links[0].url,
              partner_url: "https://aviasales.tpo.lu/TestLink",
            },
          ],
        },
      });
    },
    () => "2026-10-07",
  );
  assert.equal((await partner.createLink(handoff, "trip")).status, "available");
  const empty = await fixture(restored, {
    PRN: "empty",
    SKP: "empty",
    TIA: "empty",
  });
  const retained = (await empty.search("vienna")).templates.find(
    (t) => t.transport.departure?.code === "SKP",
  )!;
  assert.ok(retained);
  assert.equal(pricePlan(retained, restored).costs[0].confidence, "estimate");
});
test("EN/SQ airport, transfer, room and baggage copy is complete and shares the same keys", () => {
  assert.deepEqual(Object.keys(en).sort(), Object.keys(sq).sort());
  for (const key of [
    "nearbyAirports",
    "nearbyExplanation",
    "departureAirport",
    "airportTransfer",
    "baggage",
    "afterTransfer",
    "transferAssumption",
    "roomAssumption",
  ] as const) {
    assert.ok(en[key]);
    assert.ok(sq[key]);
    assert.notEqual(en[key], sq[key]);
  }
});

test("transfer allowance scales for solo and family parties, never appears on the selected airport", async () => {
  for (const party of [
    { adults: 1, children: 0 },
    { adults: 2, children: 2 },
  ]) {
    const r = { ...request, party };
    const f = await fixture(r);
    const result = await f.search();
    for (const base of result.templates.filter((t) => t.id === "vienna")) {
      const plan = pricePlan(base, r);
      const transfer = plan.costs.find((c) => c.category === "airportTransfer");
      if (plan.departure?.selected) assert.equal(transfer, undefined);
      else
        assert.equal(
          transfer?.amount.cents,
          (party.adults + party.children) *
            (plan.departure?.code === "SKP" ? 4000 : 6000),
        );
    }
  }
});
test("no-reference savings and recent preference remain deterministic within comparable total bands", async () => {
  const f = await fixture();
  const bases = (await f.search()).templates.filter((t) => t.id === "vienna");
  const plans = bases.map((t) => pricePlan(t, request));
  const selected = plans.find((p) => p.departure?.selected)!;
  const alternative = plans.find((p) => p.departure?.code === "SKP")!;
  const estimated = pricePlan(
    {
      ...bases.find((t) => t.transport.departure?.selected)!,
      transport: {
        mode: "flight",
        departure: selected.departure,
        flightPricing: { kind: "unavailable", reason: "no-matching-fare" },
      },
    },
    request,
  );
  assert.equal(
    withAirportComparison(alternative, [estimated, alternative])
      .airportSavingCents,
    undefined,
  );
  assert.equal(
    curate([{ ...estimated, id: "estimated" }, alternative], request).cheapest
      .id,
    alternative.id,
  );
});

test("nearby opt-in alone never discounts fallback airfare or presents a fixture estimate as recent/live", async () => {
  const f = await fixture(request, {
    PRN: "empty",
    SKP: "empty",
    TIA: "empty",
  });
  const search = await f.search();
  // Any template: its transport is replaced below (no demo road trips since 2026-10-27).
  const base = search.templates[0]!;
  const flightBase = {
    ...base,
    transport: {
      mode: "flight" as const,
      flightPricing: {
        kind: "unavailable" as const,
        reason: "no-matching-fare" as const,
      },
    },
  };
  const enabled = pricePlan(flightBase, request);
  const disabled = pricePlan(flightBase, {
    ...request,
    preferences: { ...request.preferences, nearbyAirports: false },
  });
  assert.equal(enabled.costs[0].confidence, "estimate");
  assert.equal(enabled.costs[0].amount.cents, disabled.costs[0].amount.cents);
  assert.equal(
    enabled.knownNonFlightCosts?.cents,
    disabled.knownNonFlightCosts?.cents,
  );
});
