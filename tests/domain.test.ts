import { locations } from "../src/catalogue/locations";
import { test } from "node:test";
import assert from "node:assert/strict";
import { calculateBudget, money } from "../src/domain/budget";
import {
  parseRequest,
  requestQuery,
  parseDemoSentence,
} from "../src/domain/request";
import { defaultRequest } from "./fixtures/prishtina-request";
import { priceComplete as pricePlan } from "./pricing-helpers";
import { curate } from "../src/domain/ranking";
import type {
  CostItem,
  TripPlan,
  TripTemplate,
  MoneyAmount,
} from "../src/domain/types";
const cost = (
  cents: number,
  category: CostItem["category"] = "stay",
): CostItem => ({
  category,
  amount: money(cents),
  confidence: "estimate",
  source: { status: "available" },
  providerId: "test",
  observedAt: null,
  demo: true,
});
function template(id: string): TripTemplate {
  const price = {
    amount: money(3000),
    confidence: "estimate" as const,
    source: { status: "available" as const },
    providerId: "test",
    observedAt: null,
    demo: true,
  };
  const road = { mode: "road" as const, price };
  return {
    id,
    destination: {
      id,
      name: { en: id, sq: id },
      country: { en: "Kosovo", sq: "Kosova" },
      styles: ["nature"],
      countryCode: "XK",
      requiresFlight: false,
      travelHours: 1,
      image: {
        src: "/demo/canyon.png",
        source: "local",
        sourceId: "test",
        author: null,
        attribution: "test",
        license: null,
        destinationId: id,
        verification: "illustrative",
      },
      why: { en: "test", sq: "test" },
    },
    origin: locations.find((l) => l.id === "prishtina")!,
    transport: road,
    stay: { ...price, amount: money(10000) },
    itinerary: [],
  };
}
function plan(id: string, budgetNeeded: number): TripPlan {
  return {
    ...pricePlan(template(id), defaultRequest),
    budget: calculateBudget(
      money(50000),
      [cost(budgetNeeded - 2000)],
      money(2000),
    ),
  };
}
test("reserve is included once; remaining is genuinely available", () => {
  const b = calculateBudget(money(50000), [cost(30000)], money(5000));
  assert.equal(b.estimatedSpend.cents, 30000);
  assert.equal(b.budgetNeeded.cents, 35000);
  assert.equal(b.remainingAfterReserve.cents, 15000);
  assert.equal(b.utilization, 0.7);
  assert.equal(b.fit, "comfortable");
});
test("fit thresholds include exact 90% and 100%", () => {
  assert.equal(
    calculateBudget(money(10000), [cost(8000)], money(1000)).fit,
    "comfortable",
  );
  assert.equal(
    calculateBudget(money(10000), [cost(8001)], money(1000)).fit,
    "close",
  );
  const exact = calculateBudget(money(10000), [cost(9000)], money(1000));
  assert.equal(exact.fit, "close");
  assert.equal(exact.remainingAfterReserve.cents, 0);
  assert.equal(
    calculateBudget(money(10000), [cost(9001)], money(1000)).fit,
    "over",
  );
});
test("buffer alone can push a trip over; excess remains visible", () => {
  const b = calculateBudget(money(10000), [cost(9900)], money(1000));
  assert.equal(b.overBudget.cents, 900);
  assert.equal(b.remainingAfterReserve.cents, 0);
  assert.equal(b.fit, "over");
});
test("price delta supports increases and decreases excluding reserve", () => {
  assert.equal(
    calculateBudget(money(50000), [cost(30000)], money(3000), money(28000))
      .priceChangeSpendDelta.cents,
    2000,
  );
  assert.equal(
    calculateBudget(money(50000), [cost(30000)], money(3000), money(32000))
      .priceChangeSpendDelta.cents,
    -2000,
  );
});
test("invalid money and zero budgets are rejected", () => {
  for (const n of [-1, NaN, Infinity, 1.1, Number.MAX_SAFE_INTEGER + 1])
    assert.throws(() => money(n));
  assert.throws(() => calculateBudget(money(0), [], money(0)));
});
test("currency mismatches cannot enter the total", () => {
  const other = { cents: 100, currency: "USD" } as unknown as MoneyAmount;
  assert.throws(() => calculateBudget(money(500), [cost(100)], other));
});
test("unsafe sums are rejected", () => {
  assert.throws(() =>
    calculateBudget(
      money(500),
      [cost(Number.MAX_SAFE_INTEGER), cost(1)],
      money(0),
    ),
  );
});
test("empty costs still reserve money", () => {
  const b = calculateBudget(money(10000), [], money(2000));
  assert.equal(b.budgetNeeded.cents, 2000);
  assert.equal(b.remainingAfterReserve.cents, 8000);
});
test("strict results do not include over-budget plans and are limited to three", () => {
  const x = curate(
    [
      plan("d", 49000),
      plan("c", 48000),
      plan("b", 40000),
      plan("a", 30000),
      plan("over", 55000),
    ],
    defaultRequest,
  );
  assert.equal(x.fitCount, 4);
  assert.deepEqual(
    x.fits.map((p) => p.id),
    ["a", "b", "c"],
  );
  assert.equal(x.slightlyOver.length, 1);
});
test("15 percent ceiling is inclusive, never rounded upward", () => {
  const x = curate(
    [plan("boundary", 57500), plan("beyond", 57501)],
    defaultRequest,
  );
  assert.equal(x.fits.length, 0);
  assert.deepEqual(
    x.slightlyOver.map((p) => p.id),
    ["boundary"],
  );
});
test("style filters are hard constraints, not a reason to silently show anything", () => {
  const x = curate([plan("nature", 10000)], {
    ...defaultRequest,
    styles: ["beach"],
  });
  assert.equal(x.fits.length, 0);
  assert.equal(x.cheapest, undefined);
});
test("ranking ties are deterministic and do not mutate caller array", () => {
  const plans = [plan("z", 30000), plan("a", 30000)];
  assert.deepEqual(
    curate(plans, defaultRequest).fits.map((p) => p.id),
    ["a", "z"],
  );
  assert.equal(plans[0].id, "z");
});
test("query input is bounded and unknown values use safe defaults", () => {
  const r = parseRequest({
    budget: "NaN",
    adults: "0",
    children: "-1",
    nights: "999",
    from: "Unknown",
    stay: "luxury",
    styles: "beach,anything",
  });
  assert.equal(r.budget.cents, 50000);
  assert.equal(r.party.adults, 2);
  assert.equal(r.party.children, 0);
  assert.equal(r.nights, 2);
  assert.equal(r.originId, "tirana");
  assert.deepEqual(r.styles, ["beach"]);
});
test("validated requests round trip through shareable URLs", () => {
  const r = parseRequest({
    budget: "250",
    adults: "3",
    children: "2",
    from: "Zurich",
    when: "summer",
    nights: "7",
    flex: "1",
    styles: "beach,quiet",
    car: "1",
    luggage: "1",
    airports: "1",
    family: "1",
    stay: "simple",
  });
  assert.deepEqual(
    parseRequest(Object.fromEntries(new URLSearchParams(requestQuery(r)))),
    r,
  );
});
test("demo parser reads supported values and preserves unsupported intent", () => {
  const r = parseDemoSentence("€300, 4 people, from Zurich", defaultRequest);
  assert.equal(r.budget.cents, 30000);
  assert.equal(r.party.adults, 4);
  assert.equal(r.originId, "zurich");
  assert.deepEqual(
    parseDemoSentence("a mystery island", defaultRequest),
    defaultRequest,
  );
});
test("accommodation changes reprice spend, reserve, remainder and fit", () => {
  const base = template("rugova");
  const regular = pricePlan(base, defaultRequest);
  const simple = pricePlan(base, {
    ...defaultRequest,
    preferences: { ...defaultRequest.preferences, stayLevel: "simple" },
  });
  assert.ok(
    simple.budget.budgetNeeded.cents < regular.budget.budgetNeeded.cents,
  );
  assert.ok(
    simple.budget.remainingAfterReserve.cents >
      regular.budget.remainingAfterReserve.cents,
  );
  assert.equal(
    simple.costs.find((c) => c.category === "stay")!.amount.cents,
    7000,
  );
});
test("children and trip length increase realistic food and lodging costs", () => {
  const base = template("rugova");
  const a = pricePlan(base, defaultRequest);
  const b = pricePlan(base, {
    ...defaultRequest,
    party: { adults: 2, children: 2 },
    nights: 5,
  });
  assert.ok(b.budget.budgetNeeded.cents > a.budget.budgetNeeded.cents);
  assert.equal(b.costs.find((c) => c.category === "food")!.amount.cents, 28800);
});
test("price change uses snapshot and can change budget fit", () => {
  const base = template("rugova");
  const r = { ...defaultRequest, budget: money(30000) };
  const normal = pricePlan(base, r);
  const changed = pricePlan(
    base,
    r,
    "price-change",
    normal.budget.estimatedSpend,
  );
  assert.equal(normal.budget.fit, "comfortable");
  assert.equal(changed.budget.fit, "over");
  assert.equal(changed.budget.priceChangeSpendDelta.cents, 8000);
});
test("provider unavailable quote is visibly an estimate", () => {
  const p = pricePlan(template("crete"), defaultRequest, "unavailable");
  assert.equal(p.costs[0].confidence, "estimate");
});
test("optional preferences have deterministic cost effects", () => {
  const base = template("rugova");
  const normal = pricePlan(base, defaultRequest);
  const car = pricePlan(base, {
    ...defaultRequest,
    preferences: { ...defaultRequest.preferences, car: true },
  });
  assert.ok(car.budget.budgetNeeded.cents > normal.budget.budgetNeeded.cents);
  const flex = pricePlan(base, { ...defaultRequest, flexible: true });
  assert.equal(
    flex.budget.budgetNeeded.cents,
    normal.budget.budgetNeeded.cents,
  );
});

test("fractional budget survives URL round trip without raising the limit", () => {
  const r = parseRequest({ budget: "300.25" });
  assert.equal(r.budget.cents, 30025);
  assert.deepEqual(
    parseRequest(Object.fromEntries(new URLSearchParams(requestQuery(r)))),
    r,
  );
});

test("demo parser preserves decimal euro limits", () => {
  assert.equal(
    parseDemoSentence("€300.25 for 2 people", defaultRequest).budget.cents,
    30025,
  );
  assert.equal(
    parseDemoSentence("300,25 euro për 2 persona", defaultRequest).budget.cents,
    30025,
  );
});

test("estimated spend excludes reserve; needed budget includes it exactly once", () => {
  const b = calculateBudget(money(200000), [cost(125000)], money(25000));
  assert.equal(b.estimatedSpend.cents, 125000);
  assert.equal(b.budgetNeeded.cents, 150000);
  assert.equal(b.remainingAfterReserve.cents, 50000);
  const over = calculateBudget(money(140000), [cost(125000)], money(25000));
  assert.equal(over.fit, "over");
  assert.equal(over.overBudget.cents, 10000);
});
test("buffer changes never become the displayed spend price change", () => {
  const current = calculateBudget(
    money(200000),
    [cost(171200)],
    money(18000),
    money(164000),
  );
  assert.equal(current.priceChangeSpendDelta.cents, 7200);
  assert.equal(current.budgetNeeded.cents, 189200);
  assert.notEqual(current.fit, "over");
  const onlyBuffer = calculateBudget(
    money(200000),
    [cost(164000)],
    money(30000),
    money(164000),
  );
  assert.equal(onlyBuffer.priceChangeSpendDelta.cents, 0);
  assert.equal(onlyBuffer.budgetNeeded.cents, 194000);
});
test("domestic scope and experience styles are independent and origin-relative", () => {
  const local = plan("local", 20000);
  const abroad = {
    ...plan("abroad", 20000),
    destination: {
      ...template("abroad").destination,
      countryCode: "MK",
      styles: ["city" as const],
    },
  };
  assert.equal(
    curate([local, abroad], {
      ...defaultRequest,
      originId: "prishtina",
      scope: "domestic",
    }).fitCount,
    1,
  );
  assert.equal(
    curate([local, abroad], {
      ...defaultRequest,
      originId: "prishtina",
      scope: "domestic",
      styles: ["city"],
    }).fitCount,
    0,
  );
  assert.equal(
    curate([local, abroad], {
      ...defaultRequest,
      originId: "prishtina",
      styles: ["city"],
    }).fitCount,
    1,
  );
  const skopje = {
    ...abroad,
    origin: locations.find((l) => l.id === "skopje")!,
  };
  assert.equal(
    curate([skopje], {
      ...defaultRequest,
      originId: "skopje",
      scope: "domestic",
      styles: ["city"],
    }).fitCount,
    1,
  );
});
test("origin IDs round trip; legacy display-name URLs and Kosovo style migrate", () => {
  for (const location of locations) {
    const request = parseRequest({
      from: location.name,
      styles: "kosovo,nature",
    });
    assert.equal(request.originId, location.id);
    assert.equal(request.scope, "domestic");
    assert.deepEqual(request.styles, ["nature"]);
    const query = new URLSearchParams(requestQuery(request));
    assert.equal(query.get("origin"), location.id);
    assert.equal(query.has("from"), false);
    assert.deepEqual(parseRequest(Object.fromEntries(query)), request);
  }
  assert.equal(
    parseRequest({ origin: "skopje", from: "Zurich" }).originId,
    "skopje",
  );
});
test("new origins are catalogue data, not a core-domain union", () => {
  const paris = {
    id: "paris",
    name: "Paris",
    countryCode: "FR",
    countryName: { en: "France", sq: "Francë" },
    type: "city" as const,
  };
  const catalogue = [...locations, paris];
  const request = parseRequest({ origin: paris.id }, catalogue);
  assert.equal(request.originId, "paris");
  assert.deepEqual(
    parseRequest(
      Object.fromEntries(new URLSearchParams(requestQuery(request))),
      catalogue,
    ),
    request,
  );
});
test("a quote for a different origin cannot be reused silently", () => {
  assert.throws(
    () =>
      pricePlan(template("rugova"), { ...defaultRequest, originId: "zurich" }),
    /origin/,
  );
});
