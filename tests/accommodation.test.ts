// Historical record/access regression. Live archive exclusion is tested in destination-archive.test.ts.
import { test } from "node:test";
import assert from "node:assert/strict";
import { estimateAccommodation } from "../src/domain/accommodation";
import {
  accommodationQuoteRejection,
  selectAccommodationQuote,
  type AccommodationEvidence,
} from "../src/domain/accommodation-evidence";
import { pricePlan } from "../src/domain/pricing";
import { completePlan } from "../src/domain/flight-pricing";
import { addDays } from "../src/domain/dates";
import { destinationCostId } from "../src/domain/costs/identity";
import { validateCostProfiles } from "../src/domain/costs/policy";
import { comparePlans } from "../src/domain/airport-comparison";
import { validateEnvironment } from "../src/config/environment";
import { requestAccommodationEvidence } from "../src/providers/server/accommodation";
import { createDestinationAccessStore } from "../src/travel/runtime/access-store";
import { destinationAccessData } from "./fixtures/archived-destination-data";
import { placeRegistryData } from "../content/places/records";
import { fxData } from "./fixtures/fx-frozen";
import { arrivalAccess } from "../src/domain/destination-access/arrival";
import { flightHandoff } from "../src/domain/affiliate";
import { costTrip, costProfile } from "./cost-profile-fixtures";
import { stayNow, stayQuote } from "./accommodation-fixtures";
const context = { today: "2026-10-13", now: stayNow };
for (const [adults, children, nights] of [
  [1, 0, 2],
  [2, 0, 2],
  [3, 0, 2],
  [4, 0, 2],
  [2, 2, 2],
  [1, 0, 1],
  [2, 2, 14],
])
  test(`planning allocation ${adults} adults, ${children} children, ${nights} nights never discounts family nights`, () => {
    const { base, request } = costTrip();
    for (const familyStay of [false, true]) {
      const r = {
        ...request,
        party: { adults, children },
        nights,
        preferences: { ...request.preferences, familyStay },
      };
      const stay = estimateAccommodation(base.stay, r);
      assert.equal(stay.paidNights, nights);
      assert.equal(stay.rooms, Math.ceil((adults + children) / 2));
      assert.equal(stay.quote?.amount.cents, 8000 * nights * stay.rooms);
      assert.equal(stay.kind, "generic-estimate");
    }
  });
for (const level of ["simple", "standard", "comfort"] as const)
  test(`${level}: real inventory never receives planning multiplier`, () => {
    const { base, request } = costTrip();
    request.preferences = { ...request.preferences, stayLevel: level };
    const q = stayQuote(base, request);
    base.accommodationEvidence = { status: "available", quotes: [q] };
    const p = pricePlan(base, request, "none", undefined, context);
    assert.equal(p.accommodation?.kind, "provider-priced");
    assert.equal(p.accommodation.quote?.amount.cents, 19500);
    const fallback = estimateAccommodation(base.stay, request);
    assert.equal(
      fallback.quote?.amount.cents,
      { simple: 11200, standard: 16000, comfort: 24000 }[level],
    );
    const wrong = structuredClone(q);
    wrong.level = level === "simple" ? "standard" : "simple";
    assert.equal(
      accommodationQuoteRejection(wrong, base.destination, request, stayNow),
      "scope-mismatch",
    );
  });
const mutations = {
  dates: (q: ReturnType<typeof stayQuote>) => {
    q.checkin = "2026-11-08";
  },
  guests: (q: ReturnType<typeof stayQuote>) => {
    q.adults = 4;
  },
  destination: (q: ReturnType<typeof stayQuote>) => {
    q.location.destinationId = "city:OTHER";
  },
  currency: (q: ReturnType<typeof stayQuote>) => {
    q.charges.total!.currency = "USD";
  },
  total: (q: ReturnType<typeof stayQuote>) => {
    q.charges.total = null;
  },
  incalculable: (q: ReturnType<typeof stayQuote>) => {
    q.charges.unknownMandatory = true;
  },
  omittedTax: (q: ReturnType<typeof stayQuote>) => {
    q.charges.total!.cents = 18000;
  },
  stale: (q: ReturnType<typeof stayQuote>) => {
    q.observedAt = "2026-10-13T11:54:59Z";
  },
  future: (q: ReturnType<typeof stayQuote>) => {
    q.observedAt = "2026-10-14T12:00:00Z";
  },
  badTimestamp: (q: ReturnType<typeof stayQuote>) => {
    q.observedAt = "2026-02-30T12:00:00Z";
  },
  unsafeIdentity: (q: ReturnType<typeof stayQuote>) => {
    q.productId = "https://example.com/?secret=x";
  },
  lowQuality: (q: ReturnType<typeof stayQuote>) => {
    q.reviewScore = 2;
  },
  allocation: (q: ReturnType<typeof stayQuote>) => {
    q.allocation.adults = 1;
  },
};
for (const [name, change] of Object.entries(mutations))
  test(`${name} inventory evidence rejected; planning fallback survives`, () => {
    const { base, request } = costTrip();
    const q = stayQuote(base, request);
    change(q);
    assert.ok(
      accommodationQuoteRejection(q, base.destination, request, stayNow),
    );
    base.accommodationEvidence = { status: "available", quotes: [q] };
    const p = pricePlan(base, request, "none", undefined, context);
    assert.equal(p.accommodation?.kind, "generic-estimate");
    assert.equal(
      completePlan(p),
      !["total", "incalculable", "omittedTax"].includes(name),
    );
    assert.equal(p.accommodation.quote?.amount.cents, 16000);
  });
test("included and excluded mandatory charges counted once; food unchanged", () => {
  const { base, request } = costTrip();
  base.accommodationEvidence = {
    status: "available",
    quotes: [stayQuote(base, request)],
  };
  const p = pricePlan(base, request, "none", undefined, context);
  assert.ok(completePlan(p));
  assert.equal(p.accommodation?.kind, "provider-priced");
  assert.equal(p.costs.filter((c) => c.category === "stay").length, 1);
  assert.equal(p.budget.estimatedSpend.cents, 41200);
  assert.equal(p.budget.budgetNeeded.cents, 45320);
  assert.equal(p.safetyBuffer.cents, 4120);
  assert.equal(p.budget.remainingAfterReserve.cents, 54680);
  assert.equal(p.budget.fit, "comfortable");
  assert.equal(p.costs.find((c) => c.category === "food")?.amount.cents, 10800);
  assert.deepEqual(p.costIntegrity?.providerComponents, ["stay"]);
});
test("provider allocation retained, not ceil guests/2", () => {
  const { base, request } = costTrip();
  request.party = { adults: 3, children: 0 };
  const q = stayQuote(base, request);
  base.accommodationEvidence = { status: "available", quotes: [q] };
  const p = pricePlan(base, request, "none", undefined, context);
  assert.equal(p.accommodation?.rooms, 1);
  assert.equal(p.accommodation?.quote?.amount.cents, 19500);
});
test("hierarchy: provider, reviewed, generic; unavailable only with unsafe scope", () => {
  const { base, request } = costTrip();
  const ctx = { ...context, profiles: [costProfile()] };
  base.accommodationEvidence = {
    status: "available",
    quotes: [stayQuote(base, request)],
  };
  assert.equal(
    pricePlan(base, request, "none", undefined, ctx).accommodation?.kind,
    "provider-priced",
  );
  base.accommodationEvidence = { status: "unavailable", reason: "unavailable" };
  const reviewed = pricePlan(base, request, "none", undefined, ctx);
  assert.equal(reviewed.accommodation?.kind, "reviewed-estimate");
  assert.equal(reviewed.accommodation?.providerStatus, "unavailable");
  assert.equal(reviewed.accommodation?.quote?.amount.cents, 14000);
  assert.equal(
    pricePlan(base, request, "none", undefined, context).accommodation?.kind,
    "generic-estimate",
  );
  const invalid = pricePlan(
    base,
    { ...request, nights: 0 },
    "none",
    undefined,
    context,
  );
  assert.equal(invalid.pricingCompleteness, "stay-unpriced");
  assert.equal(invalid.budget, undefined);
  assert.equal(invalid.safetyBuffer, undefined);
  assert.equal(
    invalid.costs.some((c) => c.category === "stay"),
    false,
  );
});
test("expired, wrong-currency and over-duration cost profiles cannot supply a reviewed stay", () => {
  const { base, request } = costTrip();
  for (const profile of [
    { ...costProfile(), reviewAfter: "2026-10-12" },
    costProfile("city:VIE", "EUR"),
    { ...costProfile(), maxNights: 1 },
  ])
    assert.equal(
      pricePlan(base, request, "none", undefined, {
        ...context,
        profiles: [profile],
      }).accommodation?.kind,
      "generic-estimate",
    );
});
test("canonical place cost identity stays separate from gateway city; existing profiles remain valid", () => {
  const { base, request } = costTrip("EUR");
  base.destination = {
    ...base.destination,
    id: "place:Q34600",
    countryCode: "JP",
    cityCode: "OSA",
    iataCodes: ["OSA"],
  };
  assert.equal(destinationCostId(base.destination), "place:Q34600");
  const profile = costProfile("place:Q34600", "EUR", "JP");
  profile.id = "synthetic-kyoto-eur";
  validateCostProfiles([profile]);
  assert.equal(
    pricePlan(base, request, "none", undefined, {
      ...context,
      profiles: [profile],
    }).accommodation?.kind,
    "reviewed-estimate",
  );
  assert.equal(
    pricePlan(base, request, "none", undefined, {
      ...context,
      profiles: [costProfile("city:OSA", "EUR", "JP")],
    }).accommodation?.kind,
    "generic-estimate",
  );
});
test("partial malformed candidates do not mask eligible data; ordering deterministic and bounded", () => {
  const { base, request } = costTrip();
  const a = stayQuote(base, request),
    b = { ...a, productId: "aaa" };
  const result = (quotes: (typeof a)[]) =>
    selectAccommodationQuote(
      { status: "available", quotes },
      base.destination,
      request,
      stayNow,
    );
  assert.equal(
    result([null as unknown as typeof a, a, b]).quote?.productId,
    "aaa",
  );
  assert.equal(result([b, a]).quote?.productId, "aaa");
  assert.equal(result(Array(21).fill(a)).quote, undefined);
});
for (const reason of [
  "timeout",
  "authentication",
  "rate-limit",
  "unavailable",
  "malformed",
  "currency-mismatch",
] as const)
  test(`normalized provider ${reason} keeps a complete estimated plan`, () => {
    const { base, request } = costTrip();
    base.accommodationEvidence = { status: "unavailable", reason };
    const p = pricePlan(base, request, "none", undefined, context);
    assert.ok(completePlan(p));
    assert.equal(p.accommodation?.kind, "generic-estimate");
    assert.equal(p.costIntegrity?.status, "generic");
    assert.equal(p.accommodation?.providerStatus, "unavailable");
  });
test("empty and stale responses remain distinct from generic confidence", () => {
  const { base, request } = costTrip();
  for (const status of ["empty", "stale"] as const) {
    base.accommodationEvidence = { status };
    const p = pricePlan(base, request, "none", undefined, context);
    assert.equal(p.accommodation?.providerStatus, status);
    assert.equal(p.accommodation?.kind, "generic-estimate");
  }
});
test("no ages invented: family searches never call the inventory provider", async () => {
  const { base, request } = costTrip();
  let calls = 0;
  const provider = {
    async search(): Promise<AccommodationEvidence> {
      calls++;
      throw Error("must not call");
    },
  };
  assert.equal(
    (
      await requestAccommodationEvidence(
        provider,
        { ...request, party: { adults: 2, children: 1 } },
        base.destination,
        { bookerCountry: "CH", platform: "desktop" },
      )
    ).status,
    "unavailable",
  );
  assert.equal(calls, 0);
  const q = stayQuote(base, request);
  assert.equal(
    accommodationQuoteRejection(
      q,
      base.destination,
      { ...request, party: { adults: 2, children: 1 } },
      stayNow,
    ),
    "scope-mismatch",
  );
});
test("reserved provider executor has deadline, abort and no retries; missing credentials/context remain disabled", async () => {
  const { base, request } = costTrip();
  let aborted = false,
    calls = 0;
  const evidence = await requestAccommodationEvidence(
    {
      async search(_r, _d, c) {
        calls++;
        c.signal.addEventListener("abort", () => {
          aborted = true;
        });
        return new Promise(() => {});
      },
    },
    request,
    base.destination,
    { bookerCountry: "CH", platform: "desktop" },
    5,
  );
  assert.deepEqual(evidence, { status: "unavailable", reason: "timeout" });
  assert.equal(calls, 1);
  assert.ok(aborted);
  assert.deepEqual(
    await requestAccommodationEvidence(
      undefined,
      request,
      base.destination,
      undefined,
    ),
    { status: "unavailable", reason: "disabled" },
  );
  assert.equal(
    validateEnvironment({}).capabilities.accommodationInventory,
    false,
  );
});
test("provider evidence improves existing budget-band preference without bypassing affordability", () => {
  const { base, request } = costTrip();
  const generic = pricePlan(base, request, "none", undefined, context);
  const q = stayQuote(base, request);
  q.charges = {
    ...q.charges,
    base: { cents: 13000, currency: "GBP" },
    total: { cents: 16500, currency: "GBP" },
  };
  const stronger = pricePlan(
    { ...base, accommodationEvidence: { status: "available", quotes: [q] } },
    request,
    "none",
    undefined,
    context,
  );
  assert.ok(comparePlans(stronger, generic) < 0);
});
test("accepted flexible dates must also match stay evidence, saved spend delta remains exact", () => {
  const { base, request } = costTrip();
  request.dates.flexibleDays = 3;
  if (
    base.transport.mode !== "flight" ||
    base.transport.flightPricing.kind !== "priced"
  )
    throw Error();
  base.transport.flightPricing.fare.scope.dates = {
    startDate: addDays(request.dates.startDate, 1),
    endDate: addDays(request.dates.endDate, 1),
    flexibleDays: 0,
  };
  base.accommodationEvidence = {
    status: "available",
    quotes: [stayQuote(base, request)],
  };
  const fallback = pricePlan(base, request, "none", undefined, context);
  assert.equal(fallback.accommodation?.kind, "generic-estimate");
  const actual = {
    ...request,
    dates: base.transport.flightPricing.fare.scope.dates,
  };
  base.accommodationEvidence = {
    status: "available",
    quotes: [stayQuote(base, actual)],
  };
  const plan = pricePlan(
    base,
    request,
    "none",
    { cents: 40000, currency: "GBP" },
    context,
  );
  assert.ok(completePlan(plan));
  assert.equal(plan.accommodation?.kind, "provider-priced");
  assert.equal(
    plan.budget.priceChangeSpendDelta.cents,
    plan.budget.estimatedSpend.cents - 40000,
  );
});
test("Kyoto KIX/ITM stay adds once, gateway transfer stays separate, handoff unchanged", () => {
  const access = createDestinationAccessStore(
    destinationAccessData,
    placeRegistryData.records,
    () => context.now,
    fxData,
  ).get("place:Q34600")!;
  for (const airport of ["KIX", "ITM"]) {
    const { base, request } = costTrip("EUR", "OSA", "JP");
    base.id = access.destination.id;
    base.destination = access.destination;
    if (
      base.transport.mode !== "flight" ||
      base.transport.flightPricing.kind !== "priced"
    )
      throw Error();
    const fare = base.transport.flightPricing.fare;
    fare.destinationAirport = airport;
    base.transport.arrival = arrivalAccess(access, fare, "EUR");
    const before = pricePlan(base, request, "none", undefined, context);
    const handoff = flightHandoff(before);
    base.accommodationEvidence = {
      status: "available",
      quotes: [stayQuote(base, request)],
    };
    const plan = pricePlan(base, request, "none", undefined, context);
    assert.ok(completePlan(plan));
    assert.equal(plan.costs.filter((c) => c.category === "stay").length, 1);
    assert.equal(
      plan.costs.filter((c) => c.category === "gatewayTransfer").length,
      1,
    );
    assert.deepEqual(flightHandoff(plan), handoff);
    assert.deepEqual(
      plan.costs.find((c) => c.category === "gatewayTransfer"),
      before.costs.find((c) => c.category === "gatewayTransfer"),
    );
    assert.equal(
      plan.budget.estimatedSpend.cents,
      4000 + 19500 + 7200 + 1000 + 2000 + (airport === "KIX" ? 6332 : 3392),
    );
  }
});

test("unsafe planning input cannot overflow and invalid basis uses independent currency allowance", () => {
  const { base, request } = costTrip();
  for (const bad of [0, -1, NaN, Infinity, Number.MAX_SAFE_INTEGER]) {
    const result = estimateAccommodation(
      { ...base.stay, amount: { ...base.stay.amount, cents: bad } },
      request,
    );
    assert.equal(result.kind, "generic-estimate");
    assert.equal(result.quote?.amount.cents, 16000);
  }
  for (const adults of [-1, NaN, Infinity, Number.MAX_SAFE_INTEGER])
    assert.equal(
      estimateAccommodation(base.stay, {
        ...request,
        party: { adults, children: 0 },
      }).kind,
      "unavailable",
    );
});
test("diagnostic is deterministic and offline, inventory cannot activate from unrecognized env values", async () => {
  const { checkAccommodation } = await import("../scripts/check-accommodation");
  assert.deepEqual(checkAccommodation(), checkAccommodation());
  assert.equal(checkAccommodation().externalCalls, 0);
  assert.equal(
    validateEnvironment({
      BOOKING_DEMAND_API_KEY: "synthetic-only",
      BOOKING_AFFILIATE_ID: "synthetic-only",
    }).capabilities.accommodationInventory,
    false,
  );
});
test("provider executor sanitizes thrown failures and refuses guessed context without calling", async () => {
  const { base, request } = costTrip();
  let calls = 0;
  const p = {
    async search(): Promise<AccommodationEvidence> {
      calls++;
      throw Error("synthetic-private-upstream-detail");
    },
  };
  assert.deepEqual(
    await requestAccommodationEvidence(p, request, base.destination, undefined),
    { status: "unavailable", reason: "scope-mismatch" },
  );
  assert.equal(calls, 0);
  assert.deepEqual(
    await requestAccommodationEvidence(p, request, base.destination, {
      bookerCountry: "CH",
      platform: "desktop",
    }),
    { status: "unavailable", reason: "unavailable" },
  );
  assert.equal(calls, 1);
});
