import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  costProfile,
  costTrip,
  candidateCostFixtures,
} from "./cost-profile-fixtures";
import {
  validateCostProfiles,
  activeCostProfile,
  completeCostProfile,
  deriveCostIntegrity,
} from "../src/domain/costs/policy";
import { destinationCostProfiles } from "../src/domain/costs/profiles";
import { destinationCostId } from "../src/domain/costs/identity";
import { pricePlan } from "../src/domain/pricing";
import { safetyBufferFor } from "../src/domain/budget";
import { completePlan } from "../src/domain/flight-pricing";
import { comparePlans } from "../src/domain/airport-comparison";
import { costBasisText, costIntegrityText } from "../src/i18n/cost-provenance";
import {
  readCandidateEvidence,
  type CandidateObservation,
} from "../src/seo/candidates/evidence";
import {
  candidateCostCoverage,
  collectCostCoverage,
} from "../src/seo/candidates/cost-coverage";
import { evaluateCandidatePublicationReadiness } from "../src/seo/candidates/readiness";
import { seoCandidateRegistry } from "../src/seo/candidates/registry";
import { flightDestinations } from "../src/catalogue/flight-destinations";
import type { DestinationCostProfile } from "../src/domain/costs/types";
import type { TripPlan } from "../src/domain/types";
import { checkCostProfiles } from "../scripts/check-cost-profiles";
const today = "2026-10-08",
  context = { today, profiles: [costProfile()] };
const amount = (plan: TripPlan, category: string) =>
  plan.costs.find((c) => c.category === category)!.amount.cents;
test("English-only cost baskets validate and price identically to legacy bilingual profiles", () => {
  const bilingual = costProfile();
  const english = structuredClone(bilingual);
  for (const c of Object.values(english.costs)) delete c.basket.sq;
  validateCostProfiles([bilingual]);
  validateCostProfiles([english]);
  const { base, request } = costTrip();
  const first = pricePlan(base, request, "none", undefined, {
    today,
    profiles: [bilingual],
  });
  const second = pricePlan(base, request, "none", undefined, {
    today,
    profiles: [english],
  });
  assert.deepEqual(
    second.costs.map((c) => c.amount),
    first.costs.map((c) => c.amount),
  );
  assert.equal(second.pricingCompleteness, first.pricingCompleteness);
  assert.deepEqual(second.budget, first.budget);
});
test("optional Albanian never permits absent English, invalid text, money, evidence or review metadata", () => {
  for (const basket of [
    {},
    { sq: "Legacy Albanian text only is insufficient." },
    { en: "short" },
    { en: " ".repeat(30) },
    { en: 123 },
    { en: "English evidence is sufficiently described.", sq: null },
    { en: "English evidence is sufficiently described.", sq: "short" },
  ]) {
    const p = costProfile();
    p.costs.stay!.basket = basket as NonNullable<
      DestinationCostProfile["costs"]["stay"]
    >["basket"];
    assert.throws(() => validateCostProfiles([p]));
  }
  for (const change of [
    (p: DestinationCostProfile) => {
      p.costs.stay!.sourceIds = [];
    },
    (p: DestinationCostProfile) => {
      p.costs.stay!.amount.cents = -1;
    },
    (p: DestinationCostProfile) => {
      p.costs.stay!.amount.currency = "XXX" as "GBP";
    },
    (p: DestinationCostProfile) => {
      p.sourceReferences = [];
    },
    (p: DestinationCostProfile) => {
      p.reviewedAt = "";
    },
  ]) {
    const p = costProfile();
    for (const c of Object.values(p.costs)) delete c.basket.sq;
    change(p);
    assert.throws(() => validateCostProfiles([p]));
  }
});
test("runtime profiles remain partial; Belfast has four reviewed components and Brussels two", () => {
  validateCostProfiles(destinationCostProfiles);
  assert.equal(destinationCostProfiles.length, 3);
  assert.equal(destinationCostProfiles.filter(completeCostProfile).length, 0);
  assert.deepEqual(
    destinationCostProfiles.map((p) => Object.keys(p.costs).length),
    [4, 1, 2],
  );
  for (const profile of destinationCostProfiles) {
    assert.equal(profile.reviewAfter, "2026-12-07");
  }
});
test("runtime reviewed amounts and source dates match the separate structured research decisions", () => {
  const research = JSON.parse(
    readFileSync(
      "docs/seo/evidence/costs/tier-a-baskets-2026-10-08-v2.json",
      "utf8",
    ),
  ) as {
    reviewedDestinationCurrencyPairs: number;
    records: {
      destinationId: string;
      currency: string;
      reviewedAt: string;
      reviewAfter: string;
      components: {
        component: string;
        status: string;
        normalized: { amount: unknown; unit: string } | null;
        sources: { id: string; checkedAt: string; url: string }[];
      }[];
    }[];
  };
  assert.equal(
    research.reviewedDestinationCurrencyPairs,
    research.records.length,
  );
  assert.equal(research.records.length, 14);
  for (const profile of destinationCostProfiles) {
    const record = research.records.find(
      (r) =>
        r.destinationId === profile.destinationId &&
        r.currency === profile.currency,
    )!;
    assert.equal(record.reviewedAt, profile.reviewedAt);
    assert.equal(record.reviewAfter, profile.reviewAfter);
    for (const [component, cost] of Object.entries(profile.costs)) {
      const accepted = record.components.find(
        (c) => c.component === component,
      )!;
      assert.equal(accepted.status, "reviewed");
      assert.deepEqual(accepted.normalized, {
        amount: cost.amount,
        unit: cost.unit,
      });
      for (const source of profile.sourceReferences.filter((source) =>
        cost.sourceIds.includes(source.id),
      ))
        assert.ok(
          accepted.sources.some(
            (s) =>
              s.id === source.id &&
              s.url === source.url &&
              s.checkedAt === source.checkedAt,
          ),
        );
    }
  }
});
test("profile validation rejects duplicate identity/currency, wrong currency and non-integer/negative/impossible zero units", () => {
  const p = costProfile();
  assert.throws(() => validateCostProfiles([p, { ...p, id: "different" }]));
  for (const cents of [-1, 0, 1.1, NaN, Infinity, 1000001])
    assert.throws(() =>
      validateCostProfiles([
        {
          ...p,
          costs: {
            stay: { ...p.costs.stay!, amount: { currency: "GBP", cents } },
          },
        },
      ]),
    );
  for (const change of [
    { currency: "EUR" as const },
    { unit: "person-day" as const },
    { sourceIds: ["unknown"] },
  ]) {
    const assumption = {
      ...p.costs.stay!,
      ...change,
      ...(change.currency
        ? { amount: { cents: 1, currency: change.currency } }
        : {}),
    };
    assert.throws(() =>
      validateCostProfiles([{ ...p, costs: { stay: assumption } }]),
    );
  }
});
test("invalid dates, long review periods, unknown sources and source checks after review are rejected", () => {
  const p = costProfile();
  for (const change of [
    { reviewedAt: "2026-02-30" },
    { reviewAfter: "2026-10-01" },
    { reviewAfter: "2027-01-01" },
    { revision: "2026-10-02" },
    { maxNights: 0 },
  ])
    assert.throws(() => validateCostProfiles([{ ...p, ...change }]));
  for (const change of [
    { checkedAt: "2026-10-02" },
    { checkedAt: "2024-10-01" },
    { url: "http://example.com" },
    { url: "https://user:password@example.com" },
  ])
    assert.throws(() =>
      validateCostProfiles([
        { ...p, sourceReferences: [{ ...p.sourceReferences[0], ...change }] },
      ]),
    );
});
test("resolver needs exact normalized identity and matching country/currency; display names never authorize a profile", () => {
  const { request, base } = costTrip();
  assert.equal(destinationCostId(base.destination), "city:VIE");
  assert.equal(
    destinationCostId({ ...base.destination, id: "vienna-looking-name" }),
    undefined,
  );
  assert.equal(
    destinationCostId({
      ...base.destination,
      cityCode: "BER",
      iataCodes: ["BER"],
    }),
    undefined,
  );
  const curated = flightDestinations.find((d) => d.id === "milan")!;
  assert.equal(destinationCostId(curated), "city:MIL");
  for (const destination of [
    { ...base.destination, countryCode: "DE" },
    { ...base.destination, id: "same-name" },
  ])
    assert.equal(
      pricePlan({ ...base, destination }, request, "none", undefined, context)
        .costIntegrity?.status,
      "generic",
    );
});
test("no FX fallback; EUR GBP USD CHF preserve their independent generic baselines", () => {
  for (const [currency, expected] of [
    ["EUR", 31200],
    ["GBP", 33700],
    ["USD", 50100],
    ["CHF", 50600],
  ] as const) {
    const { base, request } = costTrip(currency);
    const p = pricePlan(
      {
        ...base,
        transport: {
          mode: "flight",
          flightPricing: { kind: "unavailable", reason: "no-matching-fare" },
        },
      },
      request,
      "none",
      undefined,
      {
        today,
        profiles: [costProfile("city:VIE", currency === "EUR" ? "GBP" : "EUR")],
      },
    );
    assert.equal(p.pricingCompleteness, "flight-unpriced");
    if (p.pricingCompleteness === "flight-unpriced")
      assert.equal(p.knownNonFlightCosts.cents, expected);
    assert.equal(p.costIntegrity?.status, "generic");
    assert.ok(
      p.costs.every(
        (c) =>
          c.amount.currency === currency && c.source.status === "available",
      ),
    );
  }
});
test("stale, future, draft and over-duration profiles fall back without changing provider health", () => {
  const { request, base } = costTrip();
  assert.ok(
    activeCostProfile("city:VIE", "GBP", "2026-11-30", context.profiles),
  );
  assert.equal(
    activeCostProfile("city:VIE", "GBP", "2026-12-01", context.profiles),
    undefined,
  );
  assert.equal(
    activeCostProfile("city:VIE", "GBP", "not-a-date", context.profiles),
    undefined,
  );
  for (const ctx of [
    { ...context, today: "2026-12-01" },
    { ...context, today: "2026-09-30" },
    { today, profiles: [{ ...costProfile(), reviewStatus: "draft" as const }] },
    { today, profiles: [{ ...costProfile(), maxNights: 1 }] },
  ]) {
    const plan = pricePlan(base, request, "none", undefined, ctx);
    assert.equal(plan.costIntegrity?.status, "generic");
    assert.ok(plan.costs.every((c) => c.source.status === "available"));
  }
});
test("reviewed per-unit costs change stay, food, local, arrival and activities while preserving estimate semantics", () => {
  const { request, base } = costTrip();
  const plan = pricePlan(base, request, "none", undefined, context);
  assert.deepEqual(
    [
      amount(plan, "stay"),
      amount(plan, "food"),
      amount(plan, "local"),
      amount(plan, "activities"),
    ],
    [14000, 12000, 6500, 2400],
  );
  assert.equal(plan.costIntegrity?.status, "reviewed");
  assert.deepEqual(plan.costIntegrity?.generalComponents, []);
  assert.equal(plan.costIntegrity?.reviewedComponents.length, 5);
  assert.ok(
    plan.costs
      .filter((c) => c.category !== "transport")
      .every((c) => c.confidence === "estimate" && c.observedAt === null),
  );
  assert.equal(plan.costs[0].confidence, "recent");
  assert.ok(completePlan(plan));
  assert.equal(plan.budget.estimatedSpend.cents, 38900);
  assert.equal(plan.safetyBuffer.cents, 3890);
  assert.equal(plan.budget.budgetNeeded.cents, 42790);
});
test("party and planning tiers scale reviewed room/night units; family preference never discounts nights", () => {
  const { request, base } = costTrip();
  const updated = {
    ...request,
    nights: 3,
    party: { adults: 2, children: 1 },
    dates: { ...request.dates, endDate: "2026-11-10" },
  };
  for (const [stayLevel, familyStay, expected] of [
    ["simple", false, 29400],
    ["standard", false, 42000],
    ["comfort", false, 63000],
    ["standard", true, 42000],
  ] as const) {
    const plan = pricePlan(
      base,
      {
        ...updated,
        preferences: { ...updated.preferences, stayLevel, familyStay },
      },
      "none",
      undefined,
      context,
    );
    assert.equal(amount(plan, "stay"), expected);
    assert.equal(plan.accommodation!.rooms, 2);
    assert.equal(amount(plan, "food"), 24000);
    assert.equal(amount(plan, "local"), 8000);
    assert.equal(amount(plan, "activities"), 5400);
  }
});
test("per-day transport and per-person arrival scale independently; optional baggage/car remain general estimates", () => {
  const { request, base } = costTrip();
  const profile = costProfile();
  profile.costs.localTransport = {
    ...profile.costs.localTransport!,
    unit: "person-day",
  };
  profile.costs.arrivalTransport = {
    ...profile.costs.arrivalTransport!,
    unit: "person-trip",
  };
  let plan = pricePlan(base, request, "none", undefined, {
    today,
    profiles: [profile],
  });
  assert.equal(amount(plan, "local"), 16000);
  plan = pricePlan(
    base,
    {
      ...request,
      preferences: { ...request.preferences, car: true, luggage: true },
    },
    "none",
    undefined,
    context,
  );
  assert.equal(plan.costIntegrity?.status, "mixed");
  assert.equal(amount(plan, "baggage"), 5000);
  assert.equal(
    plan.costs.find((c) => c.category === "baggage")!.planning![0].basis,
    "generic-currency",
  );
});
test("expanded partial baskets preserve official local fares and keep every missing component generic", () => {
  for (const [
    code,
    currency,
    country,
    localDelta,
    spendDelta,
    reviewedCount,
  ] of [
    ["BFS", "GBP", "GB", 1200, 36200, 4],
    ["MIL", "EUR", "IT", 2100, 2100, 1],
    ["BRU", "EUR", "BE", 4100, 5100, 2],
  ] as const) {
    const { base, request } = costTrip(currency, code, country);
    const old = pricePlan(base, request),
      next = pricePlan({ ...base, costReferenceDate: today }, request);
    assert.ok(completePlan(old) && completePlan(next));
    assert.equal(amount(next, "local") - amount(old, "local"), localDelta);
    assert.equal(
      next.budget.estimatedSpend.cents - old.budget.estimatedSpend.cents,
      spendDelta,
    );
    assert.equal(next.costIntegrity?.status, "mixed");
    assert.equal(next.costIntegrity?.reviewedComponents.length, reviewedCount);
    assert.equal(
      next.costIntegrity?.generalComponents.length,
      5 - reviewedCount,
    );
    assert.ok(
      next.costIntegrity?.generalComponents.includes("arrivalTransport"),
    );
    assert.equal(collectCostCoverage([next])?.reviewedCosts.length, 0);
  }
});
test("Milan EUR review never leaks into Milan GBP or an airport/wrong-city identity", () => {
  const { base, request } = costTrip("EUR", "MIL", "IT");
  assert.equal(
    pricePlan(base, request, "none", undefined, { today }).costIntegrity
      ?.status,
    "mixed",
  );
  const gbp = costTrip("GBP", "MIL", "IT");
  assert.equal(
    pricePlan(gbp.base, gbp.request, "none", undefined, { today }).costIntegrity
      ?.status,
    "generic",
  );
  for (const destination of [
    { ...base.destination, id: "airport:MXP", iataCodes: ["MXP"] },
    {
      ...base.destination,
      id: "city:ROM",
      cityCode: "ROM",
      iataCodes: ["FCO"],
    },
    { ...base.destination, id: "Milan" },
  ])
    assert.equal(
      pricePlan({ ...base, destination }, request, "none", undefined, { today })
        .costIntegrity?.status,
      "generic",
    );
});
test("previous reviewed transport evidence and historical observation counts are preserved", () => {
  const old = JSON.parse(
    readFileSync("docs/seo/evidence/costs/review-2026-10-08.json", "utf8"),
  );
  for (const p of destinationCostProfiles) {
    const prior = old.records.find(
      (r: { destinationId: string; currency: string }) =>
        r.destinationId === p.destinationId && r.currency === p.currency,
    );
    const local = prior.components.find(
      (c: { component: string }) => c.component === "localTransport",
    );
    assert.deepEqual(local.normalized, {
      amount: p.costs.localTransport!.amount,
      unit: p.costs.localTransport!.unit,
    });
    assert.deepEqual(
      local.sources.map(
        ({
          id,
          url,
          type,
          checkedAt,
        }: {
          id: string;
          url: string;
          type: string;
          checkedAt: string;
        }) => ({ id, url, type, checkedAt }),
      ),
      p.sourceReferences.filter((s) =>
        p.costs.localTransport!.sourceIds.includes(s.id),
      ),
    );
  }
  assert.deepEqual(
    ["london", "manchester", "dublin", "chicago"].map(
      (origin) =>
        historical.observations.find((o) => o.origin === origin)!.budgetFits,
    ),
    [4, 2, 3, 3],
  );
  assert.equal(
    new Set(historical.observations.map((o) => o.observedAt.slice(0, 10))).size,
    1,
  );
  assert.ok(
    historical.observations.every((o) => o.destinationCoverage === null),
  );
});
test("missing/reference flights stay unpriced with reviewed costs, no total/fit/reserve, and inverse ceilings remain exact to one cent", () => {
  const { request, base } = costTrip();
  const unavailable = {
    ...base,
    transport: {
      mode: "flight" as const,
      flightPricing: {
        kind: "unavailable" as const,
        reason: "no-matching-fare" as const,
      },
    },
  };
  const generic = pricePlan(unavailable, request);
  assert.equal(generic.pricingCompleteness, "flight-unpriced");
  for (const room of [1000, 20000]) {
    const profile = costProfile();
    profile.costs.stay!.amount.cents = room;
    const plan = pricePlan(unavailable, request, "none", undefined, {
      today,
      profiles: [profile],
    });
    assert.equal(plan.costIntegrity?.status, "reviewed");
    assert.ok(
      plan.pricingCompleteness === "flight-unpriced" &&
        generic.pricingCompleteness === "flight-unpriced",
    );
    assert.ok(
      plan.flightAffordability.status === "calculated" &&
        generic.flightAffordability.status === "calculated",
    );
    const ceiling = plan.flightAffordability.ceiling.cents;
    assert.equal(
      ceiling > generic.flightAffordability.ceiling.cents,
      room === 1000,
    );
    for (const extra of [0, 1]) {
      const spend: { cents: number; currency: "GBP" } = {
        cents: plan.knownNonFlightCosts.cents + ceiling + extra,
        currency: "GBP" as const,
      };
      assert.equal(
        spend.cents + safetyBufferFor(spend).cents <= request.budget.cents,
        extra === 0,
      );
    }
    assert.equal("budget" in plan, false);
    assert.equal("safetyBuffer" in plan, false);
    assert.equal(
      plan.costs.some((c) => c.category === "transport"),
      false,
    );
  }
  const reference = pricePlan(
    base,
    {
      ...request,
      dates: {
        ...request.dates,
        startDate: "2026-11-14",
        endDate: "2026-11-16",
      },
    },
    "none",
    undefined,
    context,
  );
  assert.equal(reference.flightPricing?.kind, "reference");
  assert.equal(reference.pricingCompleteness, "flight-unpriced");
  assert.deepEqual(
    collectCostCoverage([reference])?.completeDestinationIds,
    [],
  );
});
test("cost trust breaks close price bands, never complete-flight or fit status boundaries", () => {
  const { base, request } = costTrip();
  const generic = pricePlan(base, request),
    reviewed = pricePlan(base, request, "none", undefined, context);
  assert.ok(completePlan(generic) && completePlan(reviewed));
  const a = {
    ...generic,
    budget: {
      ...generic.budget,
      budgetNeeded: { cents: 41000, currency: "GBP" as const },
    },
  };
  const b = {
    ...reviewed,
    budget: {
      ...reviewed.budget,
      budgetNeeded: { cents: 42000, currency: "GBP" as const },
    },
  };
  const partial = costProfile();
  partial.costs = { localTransport: partial.costs.localTransport };
  const mixed = pricePlan(base, request, "none", undefined, {
    today,
    profiles: [partial],
  });
  assert.ok(completePlan(mixed));
  const middle = {
    ...mixed,
    budget: {
      ...mixed.budget,
      budgetNeeded: { cents: 41500, currency: "GBP" as const },
    },
  };
  assert.equal(middle.costIntegrity?.status, "mixed");
  assert.ok(comparePlans(b, middle) < 0);
  assert.ok(comparePlans(middle, a) < 0);
  assert.ok(comparePlans(b, a) < 0);
  assert.ok(
    comparePlans(
      {
        ...b,
        budget: {
          ...b.budget,
          budgetNeeded: { cents: 46000, currency: "GBP" as const },
        },
      },
      a,
    ) > 0,
  );
  assert.ok(
    comparePlans({ ...b, budget: { ...b.budget, fit: "over" as const } }, a) >
      0,
  );
  const idea = pricePlan(
    {
      ...base,
      transport: {
        mode: "flight",
        flightPricing: { kind: "unavailable", reason: "no-matching-fare" },
      },
    },
    request,
    "none",
    undefined,
    context,
  );
  assert.ok(comparePlans(idea, a) > 0);
});
test("better-sourced costs may remove a fit; rates and reserve are never adjusted to preserve fit counts", () => {
  const { base, request } = costTrip();
  const old = pricePlan(base, request);
  assert.ok(completePlan(old));
  const tight = { ...request, budget: old.budget.budgetNeeded };
  const before = pricePlan(base, tight),
    after = pricePlan(base, tight, "none", undefined, context);
  assert.ok(completePlan(before) && completePlan(after));
  assert.notEqual(before.budget.fit, "over");
  assert.equal(after.budget.fit, "over");
  assert.equal(
    after.safetyBuffer.cents,
    safetyBufferFor(after.budget.estimatedSpend).cents,
  );
});
test("EN/SQ provenance distinguishes reviewed estimates, mixed and general assumptions without using fare language", () => {
  const { base, request } = costTrip();
  for (const locale of ["en", "sq"] as const) {
    for (const plan of [
      pricePlan(base, request),
      pricePlan(base, request, "none", undefined, context),
    ]) {
      const copy = costIntegrityText(plan.costIntegrity, locale);
      assert.ok(copy.length > 50);
      assert.doesNotMatch(copy, /live|recent fare|current hotel price/i);
    }
    assert.ok(costBasisText("reviewed-destination", locale).length);
  }
  assert.equal(deriveCostIntegrity([]).status, "generic");
});
test("review month remains identical for server and browsers without Albanian ICU data", (t) => {
  t.mock.method(Intl, "DateTimeFormat", () => {
    throw new Error("Locale data unavailable");
  });
  const integrity = {
    status: "mixed" as const,
    reviewedComponents: [],
    generalComponents: [],
    profile: costProfile(),
  };
  assert.match(
    costIntegrityText(integrity, "en"),
    /checked|reviewed in Oct 2026/,
  );
  assert.match(costIntegrityText(integrity, "sq"), /rishikuar në tet 2026/);
});
const historical = readCandidateEvidence(
  JSON.parse(
    readFileSync("docs/seo/evidence/candidates/2026-10-08.json", "utf8"),
  ),
);
function costHistory(profiles = candidateCostFixtures): CandidateObservation[] {
  return ["08", "11", "14"].map((day) => ({
    ...historical.observations.find((o) => o.origin === "london")!,
    observedAt: `2026-10-${day}T12:00:00.000Z`,
    source: "candidate-live",
    sourceFile: null,
    destinationCoverage: {
      completeDestinationIds: candidateCostFixtures.map((p) => p.destinationId),
      fitDestinationIds: candidateCostFixtures.map((p) => p.destinationId),
      reviewedCosts: profiles.map((p) => ({
        destinationId: p.destinationId,
        profileId: p.id,
        revision: p.revision,
      })),
    },
  }));
}
const page = {
  ...seoCandidateRegistry.find(
    (p) => p.key.originId === "london" && p.type === "budget",
  )!,
  reviews: {
    dateContract: "reviewed" as const,
    costAssumptions: "reviewed" as const,
  },
};
function readiness(
  rows = costHistory(),
  profiles: readonly DestinationCostProfile[] = candidateCostFixtures,
) {
  return evaluateCandidatePublicationReadiness(
    page,
    seoCandidateRegistry.map((p) => (p.id === page.id ? page : p)),
    { version: 2, observations: rows },
    "2026-10-14",
    profiles,
  );
}
test("v1 migration preserves flight history and unavailable destination-cost coverage; v2 does not invent historical IDs", () => {
  const legacy = historical.observations.map(
    ({ destinationCoverage, ...rest }) => {
      assert.equal(destinationCoverage, null);
      return rest;
    },
  );
  assert.deepEqual(
    readCandidateEvidence({ version: 1, observations: legacy }),
    historical,
  );
  assert.equal(historical.version, 2);
  for (const o of historical.observations)
    assert.equal(candidateCostCoverage(o, today).available, false);
  assert.equal(readiness(historical.observations).status, "not-ready");
  assert.throws(() =>
    readCandidateEvidence({ version: "1", observations: legacy }),
  );
  assert.throws(() =>
    readCandidateEvidence({
      version: 1,
      observations: historical.observations,
    }),
  );
  assert.throws(() =>
    readCandidateEvidence({
      version: 2,
      observations: [
        {
          ...historical.observations[0],
          destinationCoverage: costHistory()[0].destinationCoverage,
        },
      ],
    }),
  );
});
test("v2 validates exact unique identities, fit subsets, revision stamps and safe fields", () => {
  const row = costHistory()[0],
    c = row.destinationCoverage!;
  for (const destinationCoverage of [
    { ...c, completeDestinationIds: ["city:VIE"] },
    { ...c, fitDestinationIds: ["city:ZZZ", ...c.fitDestinationIds.slice(1)] },
    {
      ...c,
      completeDestinationIds: ["VIE", ...c.completeDestinationIds.slice(1)],
    },
    { ...c, reviewedCosts: [...c.reviewedCosts, c.reviewedCosts[0]] },
    { ...c, token: "forbidden" },
  ])
    assert.throws(() =>
      readCandidateEvidence({
        version: 2,
        observations: [{ ...row, destinationCoverage }],
      }),
    );
  assert.equal(
    readCandidateEvidence({ version: 2, observations: [row] }).observations
      .length,
    1,
  );
});
test("three valid observation days plus manual reviews cannot bypass generic/partial or one-destination cost coverage", () => {
  for (const profiles of [
    [],
    candidateCostFixtures.slice(0, 1),
    candidateCostFixtures.slice(0, 2),
  ]) {
    const result = readiness(costHistory(profiles));
    assert.equal(result.observationDays.length, 3);
    assert.equal(result.spanDays, 6);
    assert.equal(result.status, "not-ready");
    assert.equal(result.minimumReviewedComplete, profiles.length);
  }
  const partial = candidateCostFixtures.map((p) => ({
    ...p,
    costs: { localTransport: p.costs.localTransport },
  }));
  assert.equal(readiness(costHistory(), partial).minimumReviewedComplete, 0);
});
test("enough reviewed complete destinations and reviewed fits pass only the cost gate, without changing public authority", () => {
  const result = readiness();
  assert.equal(result.minimumReviewedComplete, 4);
  assert.equal(result.minimumReviewedFits, 4);
  assert.equal(result.status, "eligible-for-review");
  const rows = costHistory().map((o) => ({
    ...o,
    budgetFits: 2,
    destinationCoverage: {
      ...o.destinationCoverage!,
      fitDestinationIds: ["city:VIE", "city:BUD"],
      reviewedCosts: o.destinationCoverage!.reviewedCosts.slice(0, 3),
    },
  }));
  assert.equal(readiness(rows).minimumReviewedComplete, 3);
  assert.equal(readiness(rows).minimumReviewedFits, 1);
  assert.equal(readiness(rows).status, "not-ready");
  const twoFit = rows.map((o) => ({
    ...o,
    destinationCoverage: {
      ...o.destinationCoverage!,
      fitDestinationIds: ["city:VIE", "city:ROM"],
    },
  }));
  assert.equal(readiness(twoFit).minimumReviewedFits, 2);
  assert.equal(readiness(twoFit).status, "eligible-for-review");
});
test("expired, wrong-currency, revised or later-added profiles cannot retroactively qualify historic generic fits", () => {
  for (const profiles of [
    candidateCostFixtures.map((p) => ({ ...p, reviewAfter: "2026-10-14" })),
    candidateCostFixtures.map((p) =>
      costProfile(p.destinationId, "EUR", p.countryCode),
    ),
    candidateCostFixtures.map((p) => ({
      ...p,
      revision: "2026-10-10",
      reviewedAt: "2026-10-10",
    })),
  ])
    assert.equal(readiness(costHistory(), profiles).status, "not-ready");
  assert.equal(readiness(costHistory([])).minimumReviewedComplete, 0);
  assert.equal(
    readiness(costHistory().map((o) => ({ ...o, destinationCoverage: null })))
      .minimumReviewedFits,
    0,
  );
});
test("offline diagnostic distinguishes partial profiles, missing historical identities and zero full cost coverage safely", async () => {
  const original = globalThis.fetch;
  globalThis.fetch = async () => {
    throw Error("Cost diagnostic must not use network");
  };
  try {
    const result = await checkCostProfiles(today);
    assert.equal(result.selectedPairCount, 14);
    assert.equal(result.activeReviewedProfileCount, 3);
    assert.deepEqual(
      result.candidates.map((c) => c.researchSelectionOnly.partialProfiles),
      [1, 0, 2, 0],
    );
    assert.deepEqual(
      result.candidates.map((c) => c.researchSelectionOnly.genericPairs),
      [3, 3, 1, 4],
    );
    assert.ok(
      result.candidates.every((c) =>
        c.researchSelectionOnly.destinations.every(
          (d) =>
            d.currency === c.currency &&
            d.blockers.length > 0 &&
            d.missingComponents.length > 0,
        ),
      ),
    );
    assert.deepEqual(
      (await checkCostProfiles("2026-12-07")).candidates.map(
        (c) => c.researchSelectionOnly.staleProfiles,
      ),
      [1, 0, 2, 0],
    );
    assert.equal(result.fullReviewedProfileCount, 0);
    assert.equal(result.staleProfileCount, 0);
    assert.deepEqual(result.currencies, ["EUR", "GBP"]);
    assert.deepEqual(
      result.candidates.map(
        (c) => c.researchSelectionOnly.completeDestinations,
      ),
      [4, 3, 3, 4],
    );
    assert.ok(
      result.candidates.every(
        (c) =>
          c.latestReviewedFits === null &&
          c.researchSelectionOnly.fullReviewedComplete === 0,
      ),
    );
    assert.doesNotMatch(
      JSON.stringify(result),
      /token|headers|affiliate|https?:|marker|secret/i,
    );
    assert.equal((await checkCostProfiles("2026-12-07")).staleProfileCount, 3);
  } finally {
    globalThis.fetch = original;
  }
});

test("origin and weekend candidates need three repeatedly full-profile destinations even with strong flights and manual reviews", () => {
  for (const type of ["origin", "weekend"] as const) {
    const candidate = {
      ...seoCandidateRegistry.find(
        (p) => p.key.originId === "london" && p.type === type,
      )!,
      reviews: page.reviews,
    };
    const registry = seoCandidateRegistry.map((p) =>
      p.id === candidate.id ? candidate : p,
    );
    for (const count of [2, 3]) {
      const result = evaluateCandidatePublicationReadiness(
        candidate,
        registry,
        {
          version: 2,
          observations: costHistory(candidateCostFixtures.slice(0, count)),
        },
        "2026-10-14",
        candidateCostFixtures,
      );
      assert.equal(result.observationDays.length, 3);
      assert.equal(result.spanDays, 6);
      assert.equal(result.minimumReviewedComplete, count);
      assert.equal(
        result.status,
        count === 3 ? "eligible-for-review" : "not-ready",
      );
    }
  }
});

test("basket revisions reprice non-flight costs and the existing ceiling without changing missing-flight semantics", () => {
  for (const [
    code,
    currency,
    country,
    beforeCents,
    afterCents,
    beforeCeiling,
    afterCeiling,
  ] of [
    ["BFS", "GBP", "GB", 34900, 69900, 10554, null],
    ["BRU", "EUR", "BE", 35300, 36300, 10154, 9154],
  ] as const) {
    const { base, request } = costTrip(currency, code, country);
    const current = destinationCostProfiles.find(
      (p) => p.destinationId === `city:${code}`,
    )!;
    const prior = {
      ...current,
      id: `prior-${code.toLowerCase()}`,
      costs: { localTransport: current.costs.localTransport },
    };
    const trip = {
      ...base,
      transport: {
        mode: "flight" as const,
        flightPricing: {
          kind: "unavailable" as const,
          reason: "no-matching-fare" as const,
        },
      },
    };
    const plans = [prior, current].map((profile) =>
      pricePlan(
        trip,
        { ...request, budget: { cents: 50000, currency } },
        "none",
        undefined,
        { today, profiles: [profile] },
      ),
    );
    for (const [index, p] of plans.entries()) {
      assert.ok(p.pricingCompleteness === "flight-unpriced");
      assert.equal(
        p.knownNonFlightCosts.cents,
        index ? afterCents : beforeCents,
      );
      const expectedCeiling = index ? afterCeiling : beforeCeiling;
      if (expectedCeiling === null)
        assert.equal(p.flightAffordability.status, "no-room-in-budget");
      else {
        assert.equal(p.flightAffordability.status, "calculated");
        if (p.flightAffordability.status === "calculated")
          assert.equal(p.flightAffordability.ceiling.cents, expectedCeiling);
      }
      assert.equal("budget" in p, false);
    }
  }
});
