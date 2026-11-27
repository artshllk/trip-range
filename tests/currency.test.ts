import { userInput as formatOnly } from "../src/domain/money/provenance";
import { sortDiscoveryFares } from "../src/domain/discovery";
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  money,
  parseMoney,
  parsePlanningBudget,
  formatMoney,
  isCurrency,
  supportedCurrencies,
} from "../src/domain/money/currency";
import { readMoneyIntent } from "../src/domain/money/intent";
import { planningCostPolicy } from "../src/domain/money/planning-rates";
import { planningCurrency, marketProfile } from "../src/domain/market/policy";
import { calculateBudget } from "../src/domain/budget";
import {
  parseRequest,
  requestQuery,
  requestWithOrigin,
  parseDemoSentence,
  defaultRequest,
} from "../src/domain/request";
import { boundedSearchQuery } from "../src/domain/request-limits";
import { createTravelProviders } from "../src/providers/server/composition";
import { createTravelpayoutsDiscovery } from "./flight-provider-fixture";
import { curatedNearbyAirports } from "../src/providers/nearby-airports";
import { boundedDepartures } from "../src/domain/airports";
import { getTripTemplates } from "../src/services/travel";
import { pricePlan } from "../src/domain/pricing";
import { locations } from "../src/catalogue/locations";
import { emptyIntent } from "../src/domain/ai/intent";
import { resolveTravelIntent } from "../src/services/ai/resolve-intent";
import type { TravelLocation } from "../src/domain/types";
const today = "2026-10-07";
const globalOrigin = (
  id: string,
  countryCode: string,
  cityCode: string,
): TravelLocation => ({
  id: locations.find((l) => l.id === id)?.id ?? `city:${cityCode}`,
  name: id,
  type: "city",
  countryCode,
  cityCode,
  iataCodes: [cityCode],
  countryName: { en: countryCode, sq: countryCode },
});
const origins = [
  globalOrigin("london", "GB", "LON"),
  globalOrigin("new-york", "US", "NYC"),
  locations.find((l) => l.id === "zurich")!,
  globalOrigin("tokyo", "JP", "TYO"),
  globalOrigin("dubai", "AE", "DXB"),
  globalOrigin("cape-town", "ZA", "CPT"),
];
const local = {
  async search() {
    return { locations: origins, status: "available" as const };
  },
};
test("four explicit currencies parse integer minor units and format identically on EN/SQ", () => {
  const expected = ["€500", "£500", "$500", "CHF 500"];
  supportedCurrencies.forEach((currency, i) => {
    assert.deepEqual(parseMoney("500.25", currency), money(50025, currency));
    assert.equal(
      formatMoney(formatOnly(money(50000, currency)), "en"),
      expected[i],
    );
    assert.equal(
      formatMoney(formatOnly(money(50025, currency)), "sq"),
      `500,25\u00a0${["€", "£", "$", "CHF"][i]}`,
    );
    assert.equal(
      formatMoney(formatOnly({ cents: -100, currency }), "en").startsWith("-"),
      true,
    );
    for (const invalid of [
      "-1",
      "NaN",
      "Infinity",
      "5e2",
      "1.001",
      "1,000",
      "9007199254740992",
    ])
      assert.equal(parseMoney(invalid, currency), undefined);
    assert.equal(parsePlanningBudget("100001", currency), undefined);
  });
  for (const invalid of ["CAD", "usd", "__proto__", undefined, 1])
    assert.equal(isCurrency(invalid), false);
  assert.throws(() => money(0.1));
});
test("budget arithmetic rejects mixed cost, reserve and saved-price currency", () => {
  assert.throws(
    () => calculateBudget(money(50000, "GBP"), [], money(1000, "EUR")),
    /Currency mismatch/,
  );
  assert.throws(
    () =>
      calculateBudget(
        money(50000, "GBP"),
        [],
        money(1000, "GBP"),
        money(1, "USD"),
      ),
    /Currency mismatch/,
  );
  const total = calculateBudget(money(50000, "USD"), [], money(1000, "USD"));
  assert.deepEqual(total.remainingAfterReserve, money(49000, "USD"));
});
test("origin policy is separate from searchability, SEO and nearby coverage", () => {
  assert.deepEqual(
    origins.map((o) => planningCurrency(o).currency),
    ["GBP", "USD", "CHF", "EUR", "EUR", "EUR"],
  );
  for (const origin of origins.slice(3)) {
    assert.equal(marketProfile(origin), undefined);
    assert.equal(planningCurrency(origin).source, "fallback");
    const request = parseRequest(
      { originPlace: JSON.stringify(origin) },
      undefined,
      today,
    );
    assert.equal(request.origin?.cityCode, origin.cityCode);
    assert.equal(request.budget.currency, "EUR");
  }
});
test("explicit URL currency survives round trips, same-origin edits and legacy URLs resolve deterministically", () => {
  for (const currency of supportedCurrencies) {
    const request = parseRequest(
      { origin: "zurich", budget: "500.25", currency },
      undefined,
      today,
    );
    const query = new URLSearchParams(requestQuery(request));
    assert.deepEqual(query.getAll("currency"), [currency]);
    assert.deepEqual(
      parseRequest(Object.fromEntries(query), undefined, today),
      request,
    );
    assert.deepEqual(
      requestWithOrigin(request, origins[2]).budget,
      request.budget,
    );
  }
  assert.equal(
    parseRequest({ origin: "zurich" }, undefined, today).budget.currency,
    "CHF",
  );
  assert.equal(parseRequest({}, undefined, today).budget.currency, "EUR");
  const changed = requestWithOrigin(
    { ...defaultRequest, budget: money(51234, "EUR") },
    origins[0],
  );
  assert.deepEqual(changed.budget, money(51234, "GBP"));
  assert.equal(boundedSearchQuery({ currency: ["EUR", "GBP"] }), false);
  assert.equal(boundedSearchQuery({ currency: "JPY" }), false);
});
test("shared text parsing supports explicit currency and rejects unsupported or ambiguous amounts", () => {
  for (const [text, currency] of [
    ["€500", "EUR"],
    ["£500", "GBP"],
    ["$500", "USD"],
    ["500 CHF", "CHF"],
  ] as const) {
    assert.deepEqual(readMoneyIntent(text), {
      status: "explicit",
      amount: money(50000, currency),
    });
    assert.equal(
      parseDemoSentence(text, defaultRequest).budget.currency,
      currency,
    );
  }
  for (const text of [
    "CAD 500",
    "AU$500",
    "500 JPY",
    "€500 or £500",
    "€500 and €700",
  ])
    assert.equal(readMoneyIntent(text).status, "ambiguous");
  assert.equal(
    parseDemoSentence("from Zurich", defaultRequest).budget.currency,
    "CHF",
  );
});
test("AI explicit currency is deterministic and conflicting currency asks for clarification without conversion", async () => {
  for (const [origin, text, currency] of [
    [origins[0], "£500", "GBP"],
    [origins[1], "$500", "USD"],
    [origins[2], "500 CHF", "CHF"],
  ] as const) {
    const r = requestWithOrigin(defaultRequest, origin);
    const result = await resolveTravelIntent(
      { ...emptyIntent, budgetAmount: 999 },
      Object.fromEntries(new URLSearchParams(requestQuery(r))),
      text,
      today,
      local,
    );
    assert.equal(result.status, "ready");
    assert.deepEqual(result.request.budget, money(50000, currency));
  }
  const draft = Object.fromEntries(
    new URLSearchParams(
      requestQuery(requestWithOrigin(defaultRequest, origins[0])),
    ),
  );
  const conflict = await resolveTravelIntent(
    emptyIntent,
    draft,
    "€500",
    today,
    local,
  );
  assert.equal(conflict.status, "clarification");
  assert.deepEqual(conflict.request.budget, money(50000, "EUR"));
  assert.ok(conflict.clarifications.some((c) => c.field === "currency"));
  const unsupported = await resolveTravelIntent(
    emptyIntent,
    draft,
    "CAD 500",
    today,
    local,
  );
  assert.ok(unsupported.clarifications.some((c) => c.field === "currency"));
});
test("Travelpayouts requests active currency with documented market and rejects conflicting evidence", async () => {
  const origin = origins[0];
  for (const currency of supportedCurrencies) {
    const request = {
      ...requestWithOrigin(defaultRequest, origin),
      budget: money(50000, currency),
    };
    const row = {
      origin: "LON",
      destination: "VIE",
      price: 99.25,
      departure_at: request.dates.startDate,
      return_at: request.dates.endDate,
    };
    const discovery = (body: unknown) =>
      createTravelpayoutsDiscovery("synthetic-token", async (url, options) => {
        const parsed = new URL(url);
        assert.equal(
          parsed.searchParams.get("currency"),
          currency.toLowerCase(),
        );
        assert.equal(parsed.searchParams.get("market"), "us");
        assert.equal(parsed.searchParams.has("token"), false);
        assert.equal(
          new Headers(options.headers).get("X-Access-Token"),
          "synthetic-token",
        );
        return Response.json(body);
      }).discover(request, origin);
    const good = await discovery({
      success: true,
      currency: currency.toLowerCase(),
      data: [row],
    });
    assert.equal(good.status, "available");
    if (good.status === "available") {
      const fare = good.value.fares[0];
      assert.deepEqual(fare.price.amount, money(9925, currency));
      const mismatch = {
        ...fare,
        price: {
          ...fare.price,
          amount: money(1, currency === "USD" ? "EUR" : "USD"),
        },
      };
      assert.deepEqual(sortDiscoveryFares([mismatch, fare], request), [fare]);
    }
    const bad = await discovery({
      success: true,
      currency: currency === "USD" ? "eur" : "usd",
      data: [row],
    });
    assert.equal(bad.status, "unavailable");
    const conflictingRow = await discovery({
      success: true,
      currency,
      data: [{ ...row, currency: "JPY" }],
    });
    assert.equal(conflictingRow.status, "unavailable");
    const absent = await discovery({ success: true, data: [row] });
    assert.equal(absent.status, "available");
    if (absent.status === "available") {
      assert.deepEqual(
        absent.value.fares[0].price.amount,
        money(9925, currency),
      );
      assert.equal(absent.value.fares[0].price.observedAt, null);
      // No found_at still prices (labelled "last checked"), policy 2026-10-27.
      assert.equal(absent.value.fares[0].price.source.status, "available");
    }
    assert.equal(
      (await discovery({ success: true, currency, data: [] })).status,
      "available",
    );
  }
});
test("single-currency complete estimates stay estimates and EUR transfer groups cannot enter other currencies", async () => {
  for (const currency of supportedCurrencies) {
    const request = {
      ...requestWithOrigin(defaultRequest, origins[0]),
      budget: money(200000, currency),
    };
    const providers = await createTravelProviders(
      {},
      async () => {
        throw Error("no external calls expected");
      },
      false,
      request,
    );
    const search = await getTripTemplates(request, providers, "vienna");
    assert.ok(search.templates.length > 0);
    for (const template of search.templates) {
      const plan = pricePlan(template, request);
      assert.ok(plan.costs.every((c) => c.amount.currency === currency));
      assert.equal(plan.costs[0].confidence, "estimate");
      assert.equal(plan.pricingCompleteness, "flight-unpriced");
      assert.equal(plan.knownNonFlightCosts?.currency, currency);
      assert.equal(plan.budget, undefined);
      assert.throws(
        () =>
          pricePlan(
            {
              ...template,
              stay: {
                ...template.stay,
                amount: money(100, currency === "EUR" ? "GBP" : "EUR"),
              },
            },
            request,
          ),
        /Currency mismatch/,
      );
    }
  }
  assert.notEqual(
    planningCostPolicy.GBP.baggage,
    planningCostPolicy.EUR.baggage,
  );
  const origin = locations.find((o) => o.id === "prishtina")!;
  const eur = {
    ...defaultRequest,
    preferences: { ...defaultRequest.preferences, nearbyAirports: true },
  };
  const candidates = curatedNearbyAirports.candidates(eur, origin);
  assert.equal(candidates.length, 3);
  assert.equal(boundedDepartures(origin, candidates, "GBP").length, 1);
  assert.equal(
    curatedNearbyAirports.candidates(
      { ...eur, budget: money(50000, "GBP") },
      origin,
    ).length,
    1,
  );
});
