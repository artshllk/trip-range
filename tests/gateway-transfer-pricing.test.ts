// Historical record/access regression. Live archive exclusion is tested in destination-archive.test.ts.
import { test } from "node:test";
import assert from "node:assert/strict";
import { fxData } from "./fixtures/fx-frozen";
import { destinationAccessData } from "./fixtures/archived-destination-data";
import { placeRegistryData } from "../content/places/records";
import {
  convertObservedAmount,
  validateFxData,
  type FxSnapshot,
  type ObservedForeignAmount,
} from "../src/domain/money/fx";
import {
  supportedCurrencies,
  money,
  type CurrencyCode,
} from "../src/domain/money/currency";
import { resolveGatewayTransferPricing } from "../src/domain/destination-access/transfer-pricing";
import { validateDestinationAccess } from "../src/domain/destination-access/validation";
import { createDestinationAccessStore } from "../src/travel/runtime/access-store";
import { createTravelProviders } from "../src/providers/server/composition";
import { getTripTemplates } from "../src/services/travel";
import { defaultRequest } from "../src/domain/request";
import { pricePlan } from "../src/domain/pricing";
import { maxAffordableFlight, safetyBufferFor } from "../src/domain/budget";
import { flightHandoff } from "../src/domain/affiliate";
import type { FlightDiscoveryFare, TravelerParty } from "../src/domain/types";
const now = Date.parse("2026-10-14T12:00:00Z");
const snapshot = fxData.records[0];
const gatewayData = () => ({
  schemaVersion: 1 as const,
  records: structuredClone(
    destinationAccessData.records
      .filter((p) => p.gateways !== undefined)
      .filter((p) => p.destinationSubject === "place:Q34600"),
  ),
});
const policy = gatewayData().records[0].gateways[0].onwardTransfer.pricing;
if (policy.kind !== "observed") throw Error("expected reviewed observation");
const observation = policy.observation;
const expected = { EUR: 3166, GBP: 2674, USD: 3542, CHF: 2948 };
for (const currency of supportedCurrencies)
  test(`exact JPY return conversion to ${currency}, reproducible minor-unit ceiling`, () => {
    const result = convertObservedAmount(
      observation,
      currency,
      snapshot,
      now,
      2,
    );
    assert.equal(result.status, "estimate");
    if (result.status !== "estimate") throw Error();
    assert.deepEqual(result.amount, money(expected[currency], currency));
    assert.deepEqual(
      convertObservedAmount(observation, currency, snapshot, now, 2),
      result,
    );
  });
test("rational conversion rounds only after the two-way native allowance", () => {
  const fx = structuredClone(snapshot);
  fx.rates.find((r) => r.currency === "JPY")!.perEuro = "3";
  const result = convertObservedAmount(
    { ...observation, minorAmount: 1 },
    "EUR",
    fx,
    now,
    2,
  );
  assert.equal(result.status, "estimate");
  if (result.status !== "estimate") throw Error();
  assert.deepEqual(result.amount, money(67));
});
for (const [name, mutate] of Object.entries<(s: FxSnapshot) => void>({
  zero: (s) => (s.rates[1].perEuro = "0"),
  negative: (s) => (s.rates[1].perEuro = "-1"),
  exponent: (s) => (s.rates[1].perEuro = "1e3"),
  infinity: (s) => (s.rates[1].perEuro = "Infinity"),
  nan: (s) => (s.rates[1].perEuro = "NaN"),
  float: (s) => ((s.rates[1] as unknown as { perEuro: number }).perEuro = 0.84),
  duplicate: (s) => (s.rates[1].currency = "EUR"),
  missing: (s) => s.rates.pop(),
  unsupported: (s) => (s.rates[1].currency = "XYZ" as "EUR"),
  base: (s) => (s.baseCurrency = "USD" as "EUR"),
  http: (s) => (s.sourceUrl = s.sourceUrl.replace("https", "http")),
  host: (s) => (s.sourceUrl = "https://example.com/stats/rates"),
  authority: (s) => (s.source = "other" as "ecb"),
  date: (s) => (s.sourceDate = "2026-02-30"),
  backwards: (s) => (s.reviewAfter = "2026-10-01T00:00:00Z"),
  // Longer than FX_VALID_DAYS (30) after the ECB date.
  longWindow: (s) => (s.reviewAfter = "2026-11-13T00:00:00Z"),
  unchecked: (s) => (s.checkedAt = "2026-10-12T00:00:00Z"),
  unknown: (s) => Object.assign(s, { extra: true }),
}))
  test(`FX rejects ${name} and conversion fails closed`, () => {
    const s = structuredClone(snapshot);
    mutate(s);
    assert.throws(
      () => validateFxData({ schemaVersion: 1, records: [s] }),
      /invalid-fx/,
    );
    assert.equal(
      convertObservedAmount(observation, "EUR", s, now).status,
      "unpriced",
    );
  });
test("FX rejects duplicate snapshots", () =>
  assert.throws(() =>
    validateFxData({ schemaVersion: 1, records: [snapshot, snapshot] }),
  ));
test("stale, future and draft snapshots do not convert", () => {
  assert.deepEqual(
    convertObservedAmount(
      observation,
      "EUR",
      snapshot,
      Date.parse(snapshot.reviewAfter),
    ),
    { status: "unpriced", reason: "stale-fx" },
  );
  for (const [s, date] of [
    [snapshot, Date.parse("2026-10-13T16:00:00Z") - 3600000],
    [{ ...snapshot, reviewStatus: "draft" as const }, now],
  ] as const)
    assert.equal(
      convertObservedAmount(observation, "EUR", s, date).status,
      "unpriced",
    );
});
test("unsupported source/target, wrong minor units and overflow are unpriced", () => {
  assert.equal(
    convertObservedAmount(
      {
        ...observation,
        currencyCode: "CAD",
      } as unknown as ObservedForeignAmount,
      "EUR",
      snapshot,
      now,
    ).status,
    "unpriced",
  );
  assert.equal(
    convertObservedAmount(observation, "JPY", snapshot, now).status,
    "unpriced",
  );
  assert.equal(
    convertObservedAmount(
      { ...observation, minorUnits: 2 },
      "EUR",
      snapshot,
      now,
    ).status,
    "unpriced",
  );
  assert.deepEqual(
    convertObservedAmount(
      { ...observation, minorAmount: Number.MAX_SAFE_INTEGER },
      "USD",
      snapshot,
      now,
      9,
    ),
    { status: "unpriced", reason: "overflow" },
  );
  assert.deepEqual(supportedCurrencies, ["EUR", "GBP", "USD", "CHF"]);
});
test("unconfirmed airport never selects an individually priced gateway", () => {
  assert.deepEqual(
    resolveGatewayTransferPricing({
      policy,
      currency: "EUR",
      airportConfirmed: false,
      snapshot,
      now,
      accessReviewAfter: "2027-01-10T00:00:00Z",
    }),
    { status: "unpriced", required: true, reason: "airport-unconfirmed" },
  );
});
test("observations require an explicit two-way basis, real source and separate price freshness", () => {
  for (const mutation of [
    { sameFareBothDirections: false },
    { unit: "party-return" },
    { reviewAfter: "2027-01-10T00:00:00Z" },
    {
      observation: {
        ...observation,
        source: { ...observation.source, url: "http://localhost/fare" },
      },
    },
    { observation: { ...observation, currencyCode: "XYZ" } },
    { surprise: true },
  ]) {
    const data = gatewayData();
    Object.assign(data.records[0].gateways[0].onwardTransfer.pricing, mutation);
    assert.throws(() =>
      validateDestinationAccess(data, placeRegistryData.records),
    );
  }
});

async function planned({
  currency = "EUR",
  party = { adults: 2, children: 0 },
  airport = "KIX",
  reference = false,
  oneWay = false,
  access = destinationAccessData,
  fx = fxData,
  at = now,
}: {
  currency?: CurrencyCode;
  party?: TravelerParty;
  airport?: string;
  reference?: boolean;
  oneWay?: boolean;
  access?: typeof destinationAccessData;
  fx?: typeof fxData;
  at?: number;
} = {}) {
  const request = {
    ...defaultRequest,
    originId: "zurich",
    budget: money(200000, currency),
    party,
    when: "custom" as const,
    nights: 2,
    dates: {
      startDate: "2026-11-20",
      endDate: "2026-11-22",
      flexibleDays: 0 as const,
    },
  };
  const fare: FlightDiscoveryFare = {
    originCode: "ZRH",
    destinationCode: "OSA",
    destinationAirport: airport === "OSA" ? undefined : airport,
    price: {
      amount: money(20000, currency),
      confidence: "recent",
      source: { status: "available" },
      providerId: "travelpayouts",
      observedAt: "2026-10-14T10:00:00Z",
      demo: false,
    },
    retrievedAt: "2026-10-14T12:00:00Z",
    scope: {
      journey: oneWay ? "one-way" : "return",
      unit: "per-traveller",
      fees: "provider-unspecified",
      dates: reference
        ? { startDate: "2026-11-12", endDate: "2026-11-14", flexibleDays: 0 }
        : request.dates,
    },
  };
  const providers = await createTravelProviders(
    {},
    async () => {
      throw Error("unexpected network");
    },
    false,
    request,
  );
  providers.destinationAccess = createDestinationAccessStore(
    access,
    placeRegistryData.records,
    () => at,
    fx,
  );
  providers.discovery = {
    async discover() {
      return { status: "available", value: { fares: [fare], diagnostics: [] } };
    },
  };
  providers.destinationResolver = {
    async resolve() {
      return [];
    },
  };
  const result = await getTripTemplates(request, providers, "place:Q34600");
  const template = result.templates.find(
    (t) => t.destination.id === "place:Q34600",
  )!;
  const plan = pricePlan(template, request, "none", undefined, {
    today: new Date(at).toISOString().slice(0, 10),
  });
  return { plan, template, request, fare };
}
for (const currency of supportedCurrencies)
  for (const party of [
    { adults: 1, children: 0 },
    { adults: 2, children: 0 },
    { adults: 2, children: 2 },
  ])
    test(`KIX ${currency} ${party.adults}+${party.children}: complete, transfer/party/reserve/affiliate intact`, async () => {
      const { plan, fare } = await planned({ currency, party });
      assert.equal(plan.pricingCompleteness, "complete");
      if (plan.pricingCompleteness !== "complete") throw Error();
      const transfer = plan.costs.find(
        (c) => c.category === "gatewayTransfer",
      )!;
      assert.deepEqual(
        transfer.amount,
        money(expected[currency] * (party.adults + party.children), currency),
      );
      assert.equal(transfer.confidence, "estimate");
      assert.equal(
        transfer.planning?.[0].transfer?.observation.minorAmount,
        2800,
      );
      assert.equal(transfer.planning?.[0].transfer?.fx.id, snapshot.id);
      assert.equal(
        plan.costs
          .flatMap((c) => c.planning ?? [])
          .some((p) => p.component === "arrivalTransport"),
        false,
      );
      assert.ok(
        plan.costs
          .flatMap((c) => c.planning ?? [])
          .some((p) => p.component === "localTransport"),
      );
      const spend = plan.costs.reduce((sum, c) => sum + c.amount.cents, 0);
      assert.deepEqual(plan.budget.estimatedSpend, money(spend, currency));
      assert.deepEqual(
        plan.safetyBuffer,
        safetyBufferFor(money(spend, currency)),
      );
      assert.equal(
        plan.budget.budgetNeeded.cents,
        spend + plan.safetyBuffer.cents,
      );
      assert.equal(
        plan.budget.fit,
        party.children === 2 && ["USD", "CHF"].includes(currency)
          ? "over"
          : "comfortable",
      );
      assert.equal(flightHandoff(plan)?.destinationCode, "KIX");
      assert.equal(flightHandoff(plan)?.departureDate, "2026-11-20");
      assert.deepEqual(
        plan.flightPricing?.kind === "priced" && plan.flightPricing.fare,
        fare,
      );
    });
test("ITM uses its own fare, not KIX or cheapest automatic substitution", async () => {
  const { plan } = await planned({ airport: "ITM" });
  assert.equal(plan.pricingCompleteness, "complete");
  assert.equal(
    plan.costs.find((c) => c.category === "gatewayTransfer")?.amount.cents,
    1696 * 2,
  );
  assert.equal(flightHandoff(plan)?.destinationCode, "ITM");
});
for (const state of [
  "group",
  "unpriced",
  "stale-price",
  "stale-fx",
  "missing-fx",
  "bad-fx",
  "draft-price",
  "wrong-fx",
  "future-price",
])
  test(`${state} cannot establish total, fit, remainder or flight ceiling`, async () => {
    const access = gatewayData(),
      fx = structuredClone(fxData);
    const p = access.records[0].gateways[0].onwardTransfer.pricing;
    if (p.kind !== "observed") throw Error();
    if (state === "unpriced")
      access.records[0].gateways[0].onwardTransfer.pricing = {
        kind: "unpriced",
      };
    if (state === "stale-price") p.reviewAfter = "2026-10-14T00:00:00Z";
    if (state === "draft-price") p.reviewStatus = "draft";
    if (state === "future-price")
      p.observation.observedAt = "2026-10-15T00:00:00Z";
    if (state === "wrong-fx") p.fxSnapshotId = "ecb-other";
    if (state === "missing-fx") fx.records = [];
    if (state === "bad-fx") fx.records[0].rates[1].perEuro = "0";
    const { plan } = await planned({
      access,
      fx,
      airport: state === "group" ? "OSA" : "KIX",
      at: state === "stale-fx" ? Date.parse(snapshot.reviewAfter) : now,
    });
    assert.equal(plan.pricingCompleteness, "required-transfer-unpriced");
    assert.equal(plan.budget, undefined);
    assert.equal(plan.safetyBuffer, undefined);
    assert.equal("ceiling" in plan.flightAffordability, false);
    assert.equal(
      plan.costs.some((c) => c.category === "gatewayTransfer"),
      false,
    );
  });
test("reference airport evidence retains transfer and correct flight ceiling, never actual airfare", async () => {
  const { plan, request } = await planned({ reference: true });
  assert.equal(plan.pricingCompleteness, "flight-unpriced");
  if (plan.pricingCompleteness !== "flight-unpriced") throw Error();
  assert.equal(
    plan.costs.some((c) => c.category === "transport"),
    false,
  );
  assert.equal(
    plan.costs.find((c) => c.category === "gatewayTransfer")?.amount.cents,
    6332,
  );
  assert.equal(
    plan.knownNonFlightCosts.cents,
    plan.costs.reduce((sum, c) => sum + c.amount.cents, 0),
  );
  assert.deepEqual(
    plan.flightAffordability.ceiling,
    maxAffordableFlight(request.budget, plan.knownNonFlightCosts),
  );
  assert.equal(flightHandoff(plan)?.departureDate, request.dates.startDate);
});
test("return-only planner never turns one-way flight evidence into a complete trip", async () => {
  const { plan } = await planned({ oneWay: true });
  assert.notEqual(plan.pricingCompleteness, "complete");
  assert.equal(
    plan.costs.some((c) => c.category === "transport"),
    false,
  );
});
test("cached template rechecks FX expiry even if its older cost reference date remains", async () => {
  const { template, request } = await planned();
  template.costReferenceDate = "2026-10-14";
  assert.equal(
    pricePlan(template, request, "none", undefined, { today: "2026-10-20" })
      .pricingCompleteness,
    "required-transfer-unpriced",
  );
});

test("observed pricing is generic across places, gateways and native minor-unit scales", () => {
  const access = gatewayData();
  const places = structuredClone(placeRegistryData.records);
  const place = structuredClone(
    places.find((p) => p.subject === "place:Q34600")!,
  );
  place.subject = "test:transfer-island";
  place.name = "Synthetic island";
  place.placeKind = "island";
  places.push(place);
  const profile = access.records[0];
  profile.destinationSubject = place.subject;
  profile.gateways = [profile.gateways[0]];
  profile.gateways[0].airportCode = "ABC";
  profile.gateways[0].providerCityCode = "XYZ";
  const p = profile.gateways[0].onwardTransfer.pricing;
  if (p.kind !== "observed") throw Error();
  p.mode = "rail";
  p.observation = {
    ...p.observation,
    currencyCode: "EUR",
    minorUnits: 2,
    minorAmount: 1250,
  };
  const result = createDestinationAccessStore(
    access,
    places,
    () => now,
    fxData,
  ).get(place.subject)!;
  const transfer = result.transferPrices.ABC.USD!;
  assert.equal(transfer.status, "estimate");
  if (transfer.status !== "estimate") throw Error();
  assert.deepEqual(transfer.perPersonReturn, money(2797, "USD"));
  assert.equal(transfer.provenance?.mode, "rail");
});

test("budget rechecks the current clock at expiry rather than freezing template freshness", async (t) => {
  const { template, request } = await planned();
  template.costReferenceDate = "2026-10-14";
  const expires = Date.parse(snapshot.reviewAfter);
  t.mock.timers.enable({ apis: ["Date"], now: expires - 1 });
  assert.equal(pricePlan(template, request).pricingCompleteness, "complete");
  t.mock.timers.tick(1);
  assert.equal(
    pricePlan(template, request).pricingCompleteness,
    "required-transfer-unpriced",
  );
});

test("DKK and TRY convert to EUR with rates, conversion time and currency windows", () => {
  for (const [currencyCode, cents, validityDays, validUntil] of [
    ["DKK", 1338, 30, "2026-10-20T00:00:00.000Z"],
    ["TRY", 182, 4, "2026-10-17T00:00:00.000Z"],
  ] as const) {
    const result = convertObservedAmount(
      { ...observation, currencyCode, minorUnits: 2, minorAmount: 10000 },
      "EUR",
      snapshot,
      now,
    );
    assert.equal(result.status, "estimate");
    if (result.status !== "estimate") throw Error();
    assert.deepEqual(result.amount, money(cents));
    assert.equal(
      result.fx.from.perEuro,
      snapshot.rates.find((r) => r.currency === currencyCode)!.perEuro,
    );
    assert.equal(result.fx.from.validityDays, validityDays);
    assert.equal(result.fx.to.perEuro, "1");
    assert.equal(result.fx.appliedWindowDays, validityDays);
    assert.equal(result.fx.validUntil, validUntil);
    assert.equal(result.fx.convertedAt, "2026-10-14T12:00:00.000Z");
    assert.equal(result.fx.conversionDate, "2026-10-14");
    assert.equal(result.fx.ageMilliseconds, 36 * 60 * 60 * 1000);
    assert.equal(result.fx.sourceDate, "2026-10-13");
    assert.equal(result.fx.windowPolicy, "ecb-currency-windows-v1");
  }
});

test("TRY expires at four days even when the snapshot is rechecked; DKK stays usable", () => {
  const s = {
    ...snapshot,
    checkedAt: "2026-10-16T12:00:00Z",
    reviewAfter: "2026-11-12T00:00:00Z",
  };
  const expires = Date.parse("2026-10-17T00:00:00Z");
  const tryObservation = {
    ...observation,
    currencyCode: "TRY" as const,
    minorUnits: 2,
  };
  assert.equal(
    convertObservedAmount(tryObservation, "EUR", s, expires - 1).status,
    "estimate",
  );
  assert.deepEqual(convertObservedAmount(tryObservation, "EUR", s, expires), {
    status: "unpriced",
    reason: "stale-fx",
  });
  assert.equal(
    convertObservedAmount(
      { ...tryObservation, currencyCode: "DKK" },
      "EUR",
      s,
      expires,
    ).status,
    "estimate",
  );
  assert.equal(
    convertObservedAmount(
      { ...tryObservation, currencyCode: "CHF" },
      "EUR",
      s,
      expires,
    ).status,
    "estimate",
  );
  assert.equal(
    convertObservedAmount(
      { ...tryObservation, currencyCode: "DKK" },
      "EUR",
      s,
      Date.parse(s.reviewAfter),
    ).status,
    "unpriced",
  );
});

test("an earlier snapshot expiry overrides TRY's currency window", () => {
  const s = { ...snapshot, reviewAfter: "2026-10-15T00:00:00Z" };
  const obs = { ...observation, currencyCode: "TRY" as const, minorUnits: 2 };
  const result = convertObservedAmount(obs, "EUR", s, now);
  assert.equal(result.status, "estimate");
  if (result.status !== "estimate") throw Error();
  assert.equal(result.fx.validUntil, "2026-10-15T00:00:00.000Z");
  assert.equal(
    convertObservedAmount(obs, "EUR", s, Date.parse(s.reviewAfter)).status,
    "unpriced",
  );
});

test("cached TRY transfer carries its four-day expiry through to the budget", async (t) => {
  const access = gatewayData();
  const p = access.records[0].gateways[0].onwardTransfer.pricing;
  if (p.kind !== "observed") throw Error();
  p.observation = { ...p.observation, currencyCode: "TRY", minorUnits: 2 };
  const { template, request } = await planned({ access });
  template.costReferenceDate = "2026-10-14";
  const transfer = resolveGatewayTransferPricing({
    policy: p,
    currency: "EUR",
    airportConfirmed: true,
    snapshot,
    now,
    accessReviewAfter: "2027-01-10T00:00:00Z",
  });
  assert.equal(transfer.status, "estimate");
  if (transfer.status !== "estimate") throw Error();
  assert.equal(transfer.provenance?.fx.appliedWindowDays, 4);
  assert.equal(transfer.reviewAfter, "2026-10-17T00:00:00.000Z");
  t.mock.timers.enable({
    apis: ["Date"],
    now: Date.parse(transfer.reviewAfter) - 1,
  });
  assert.equal(pricePlan(template, request).pricingCompleteness, "complete");
  t.mock.timers.tick(1);
  assert.equal(
    pricePlan(template, request).pricingCompleteness,
    "required-transfer-unpriced",
  );
});
