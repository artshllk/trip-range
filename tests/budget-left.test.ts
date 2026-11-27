import assert from "node:assert/strict";
import test from "node:test";
import {
  budgetLeft,
  roomPerNight,
  validAirportTransfer,
  validCityTax,
  type AirportTransferRecord,
  type BudgetInput,
  type CityTaxRecord,
  TAX_NIGHTS_VERIFIED,
  stayNights,
  nightsLabel,
} from "../src/domain/budget-left";
import {
  airportTransferRecords,
  cityTaxRecords,
} from "../src/domain/city-cost-records";
import type { FxSnapshot } from "../src/domain/money/fx";
const plusTwo = (day: string) =>
  new Date(Date.parse(day + "T00:00:00Z") + 2 * 86400000)
    .toISOString()
    .slice(0, 10);
import { fxData as frozen } from "./fixtures/fx-frozen";

const source = {
  publisher: "City of Example",
  title: "Tourist tax ordinance 2026",
  url: "https://example.gov/tax",
  retrievedAt: "2026-11-24",
  quote: "The tax is EUR 2.50 per person per night.",
  language: "en",
};
const tax = (over: Partial<CityTaxRecord> = {}): CityTaxRecord => ({
  city: "AAA",
  name: "Example",
  status: "levied",
  basis: "per-person-night",
  currency: "EUR",
  value: 250,
  scope: "All paid accommodation",
  effectiveFrom: "2026-01-01",
  reviewBy: "2027-06-01",
  source,
  ...over,
});
const transfer = (
  over: Partial<AirportTransferRecord> = {},
): AirportTransferRecord => ({
  airport: "AAP",
  city: "AAA",
  route: "Airport bus line 1 to the central station",
  currency: "EUR",
  oneWayAdult: 450,
  effectiveFrom: "2026-01-01",
  reviewBy: "2027-06-01",
  source: { ...source, quote: "Single ticket airport–centre EUR 4.50" },
  ...over,
});
const fx: FxSnapshot = {
  id: "ecb-reference",
  source: "ecb",
  sourceUrl: "https://www.ecb.europa.eu/",
  sourceDate: "2026-11-23",
  checkedAt: "2026-11-23T16:00:00Z",
  reviewAfter: "2026-12-23T00:00:00Z",
  reviewStatus: "reviewed",
  baseCurrency: "EUR",
  rates: [
    { currency: "EUR", perEuro: "1" },
    { currency: "GBP", perEuro: "0.8" },
    { currency: "USD", perEuro: "1.1" },
    { currency: "CHF", perEuro: "0.9" },
    { currency: "JPY", perEuro: "170" },
    { currency: "DKK", perEuro: "7.46" },
    { currency: "TRY", perEuro: "50" },
    { currency: "CZK", perEuro: "25" },
    { currency: "HUF", perEuro: "400" },
    { currency: "SEK", perEuro: "11" },
    { currency: "PLN", perEuro: "4.25" },
  ],
};
const now = Date.parse("2026-11-24T12:00:00Z");
const base: BudgetInput = {
  budgetCents: 60000,
  flightPartyCents: 24000,
  flightObservedAt: "2026-11-22T10:00:00Z",
  city: "AAA",
  arrivalAirport: "AAP",
  checkIn: "2026-12-05",
  checkOut: "2026-12-07",
  hotelClass: "3",
  cityTaxes: [],
  transfers: [],
  fx,
  now,
};

test("with no records, flights and reserve are known, city tax is unknown and the transfer is not counted", () => {
  const r = budgetLeft(base);
  assert.deepEqual(
    r.known.map((k) => [k.id, k.cents]),
    [
      ["flights", 24000],
      ["reserve", 2400],
    ],
  );
  assert.deepEqual(
    r.unknown.map((u) => u.id),
    ["city-tax"],
  );
  assert.equal(r.transferNotCounted, true);
  assert.equal(r.leftCents, 60000 - 24000 - 2400);
  // No food given: no invented split and no room figure.
  assert.equal(r.food, undefined);
  assert.equal(r.roomPerNightCents, undefined);
});

test("fixed city taxes and the airport transfer are subtracted for two people, two nights, both ways", () => {
  const r = budgetLeft({
    ...base,
    cityTaxes: [tax()],
    transfers: [transfer()],
  });
  assert.equal(r.known.find((k) => k.id === "city-tax")?.cents, 250 * 4);
  assert.equal(
    r.known.find((k) => k.id === "airport-transfer")?.cents,
    450 * 4,
  );
  assert.deepEqual(r.unknown, []);
  assert.equal(r.leftCents, 60000 - 24000 - 2400 - 1000 - 1800);
  const room = budgetLeft({
    ...base,
    cityTaxes: [tax({ basis: "per-room-night", value: 300 })],
  });
  assert.equal(room.known.find((k) => k.id === "city-tax")?.cents, 600);
});

test("a class-based tax uses the chosen class; a missing class is unknown, not zero", () => {
  const byClass = tax({ value: undefined, byClass: { "3": 170, "4": 330 } });
  assert.ok(validCityTax(byClass));
  assert.equal(
    budgetLeft({ ...base, cityTaxes: [byClass], hotelClass: "4" }).known.find(
      (k) => k.id === "city-tax",
    )?.cents,
    330 * 4,
  );
  const missing = budgetLeft({
    ...base,
    cityTaxes: [byClass],
    hotelClass: "5",
  });
  assert.equal(missing.unknown[0].id, "city-tax");
  assert.match(missing.unknown[0].reason, /5-star/);
});

test("a sourced 'no city tax' is known and subtracts nothing; absence of a record is unknown", () => {
  const none = tax({
    status: "none",
    basis: undefined,
    currency: undefined,
    value: undefined,
  });
  assert.ok(validCityTax(none));
  const r = budgetLeft({ ...base, cityTaxes: [none] });
  assert.ok(r.noCityTax);
  assert.ok(!r.unknown.some((u) => u.id === "city-tax"));
  assert.equal(r.leftCents, 60000 - 24000 - 2400);
});

test("a percentage tax is solved into the room figure, including a VAT-exclusive basis and a cap", () => {
  const pct = tax({
    basis: "percent-of-room",
    value: 12.5,
    percentOf: "price-including-vat",
  });
  const r = budgetLeft({ ...base, cityTaxes: [pct], foodPerDayCents: 0 });
  assert.ok(r.percentTax);
  assert.ok(!r.known.some((k) => k.id === "city-tax"));
  const forRoom = r.leftCents;
  // n·R·(1 + 12.5%) = money for the room
  assert.equal(
    r.roomPerNightCents,
    Math.floor(forRoom / 2 / 1.125 / 100) * 100,
  );
  const exVat = tax({
    basis: "percent-of-room",
    value: 12.5,
    percentOf: "price-excluding-vat",
    vatPercent: 9,
  });
  const v = budgetLeft({ ...base, cityTaxes: [exVat], foodPerDayCents: 0 });
  assert.ok(Math.abs(v.percentTax!.effectivePercent - 12.5 / 1.09) < 1e-9);
  assert.equal(v.percentTax!.onFullPrice, undefined);
  // VAT rate not stated by the source: counted on the full price, never less.
  const vatUnstated = tax({
    basis: "percent-of-room",
    value: 5,
    percentOf: "price-excluding-vat",
  });
  assert.ok(validCityTax(vatUnstated));
  const u = budgetLeft({
    ...base,
    cityTaxes: [vatUnstated],
    foodPerDayCents: 0,
  });
  assert.equal(u.percentTax!.effectivePercent, 5);
  assert.equal(u.percentTax!.onFullPrice, true);
  // A cap binds when the percentage would exceed it.
  assert.equal(
    roomPerNight(100000, 2, {
      percent: 10,
      percentOf: "price-including-vat",
      effectivePercent: 10,
      capCentsPerRoomNight: 500,
      source: {
        publisher: "x",
        url: "https://x",
        effectiveFrom: "2026-01-01",
        checkedAt: "2026-11-24",
      },
    }),
    49500,
  );
});

test("the traveller's food amount comes off first, then the room figure; going over is said plainly", () => {
  const r = budgetLeft({ ...base, foodPerDayCents: 6000 });
  assert.deepEqual(r.food, { perDayCents: 6000, days: 2, cents: 12000 });
  assert.equal(
    r.roomPerNightCents,
    Math.floor((r.leftCents - 12000) / 2 / 100) * 100,
  );
  const poor = budgetLeft({ ...base, foodPerDayCents: 20000 });
  assert.equal(poor.roomPerNightCents, undefined);
  // €1 left over two nights is under a euro a night: nothing, not "about €0".
  const crumbs = budgetLeft({
    ...base,
    foodPerDayCents: (r.leftCents - 100) / 2,
  });
  assert.equal(crumbs.roomPerNightCents, undefined);
  const over = budgetLeft({ ...base, budgetCents: 20000 });
  assert.ok(over.leftCents < 0);
});

test("foreign-currency records convert at the ECB rate; a stale rate leaves the cost unknown", () => {
  // Frozen, reviewed ECB snapshot of 2026-10-13 (CZK 24.368 per euro), valid to 2026-10-20.
  const czk = tax({
    currency: "CZK",
    value: 5000, // CZK 50.00 per person per night
    source: { ...source, retrievedAt: "2026-10-14" },
  });
  const at = {
    ...base,
    fx: frozen.records[0],
    now: Date.parse("2026-10-15T12:00:00Z"),
    checkIn: "2026-10-17",
    checkOut: "2026-10-19",
  };
  const k = budgetLeft({ ...at, cityTaxes: [czk] }).known.find(
    (x) => x.id === "city-tax",
  )!;
  // 4 × CZK 50 = CZK 200 at 24.368 = €8.2075, rounded up to the cent.
  assert.equal(k.cents, 821);
  assert.equal(k.source?.fx?.from, "CZK");
  assert.equal(k.source?.fx?.sourceDate, "2026-10-13");
  const stale = budgetLeft({
    ...at,
    cityTaxes: [czk],
    now: Date.parse("2026-11-01T00:00:00Z"),
  });
  assert.ok(stale.unknown.some((u) => u.id === "city-tax"));
});

test("expired, not-yet-effective, conflicting and wrong-airport records never count", () => {
  for (const r of [
    tax({ reviewBy: "2026-11-01" }),
    tax({ effectiveFrom: "2027-01-01" }),
  ])
    assert.ok(
      budgetLeft({ ...base, cityTaxes: [r] }).unknown.some(
        (u) => u.id === "city-tax",
      ),
    );
  const conflict = budgetLeft({
    ...base,
    cityTaxes: [tax(), tax({ value: 300 })],
  });
  assert.equal(conflict.unknown[0].reason, "conflicting records");
  const elsewhere = budgetLeft({
    ...base,
    transfers: [transfer({ airport: "BBB" })],
  });
  // A fare for another airport never counts; this airport's transfer is not counted.
  assert.equal(elsewhere.transferNotCounted, true);
  assert.ok(!elsewhere.known.some((k) => k.id === "airport-transfer"));
  const twice = budgetLeft({
    ...base,
    transfers: [transfer(), transfer({ oneWayAdult: 500 })],
  });
  assert.equal(
    twice.unknown.find((u) => u.id === "airport-transfer")?.reason,
    "conflicting records",
  );
});

test("the record format rejects anything unsourced or ambiguous", () => {
  assert.equal(validCityTax(tax({ source: { ...source, quote: "" } })), false);
  assert.equal(
    validCityTax(tax({ source: { ...source, url: "http://example.gov" } })),
    false,
  );
  assert.equal(validCityTax(tax({ byClass: { "3": 100 } })), false); // value and byClass
  assert.equal(
    validCityTax(tax({ basis: "percent-of-room", value: 12.5 })),
    false,
  ); // no basis of percentage
  // A value derived from several sources needs every source and the arithmetic.
  const supporting = [{ ...source, quote: "Additional tax of 10% applies." }];
  assert.ok(
    validCityTax(
      tax({
        supportingSources: supporting,
        derivation: "Rate × 1.10 for the 10% additional tax.",
      }),
    ),
  );
  assert.equal(validCityTax(tax({ supportingSources: supporting })), false);
  assert.equal(
    validCityTax(
      tax({ derivation: "Rate × 1.10 for the 10% additional tax." }),
    ),
    false,
  );
  assert.equal(
    validCityTax(
      tax({
        supportingSources: [{ ...source, quote: "" }],
        derivation: "Rate × 1.10 for the 10% additional tax.",
      }),
    ),
    false,
  );
  assert.equal(
    validCityTax(
      tax({ effectiveFrom: "2027-01-01", effectiveTo: "2026-12-31" }),
    ),
    false,
  );
  // A manual check must be dated and explained.
  assert.ok(
    validCityTax(
      tax({
        source: {
          ...source,
          manualCheck: {
            checkedOn: "2026-11-24",
            note: "site refuses automated reads",
          },
        },
      }),
    ),
  );
  assert.equal(
    validCityTax(
      tax({
        source: { ...source, manualCheck: { checkedOn: "soon", note: "x" } },
      }),
    ),
    false,
  );
  assert.equal(validAirportTransfer(transfer({ oneWayAdult: 0 })), false);
  assert.equal(validAirportTransfer(transfer({ route: "" })), false);
});

test("consecutive records for one city apply by stay date, never both at once", () => {
  const y2026 = tax({ value: 250, effectiveTo: "2026-12-31" });
  const y2027 = tax({
    value: 300,
    effectiveFrom: "2027-01-01",
    effectiveTo: "2027-12-31",
  });
  const at = (checkIn: string) =>
    budgetLeft({
      ...base,
      checkIn,
      checkOut: plusTwo(checkIn),
      cityTaxes: [y2026, y2027],
    }).known.find((k) => k.id === "city-tax")?.cents;
  assert.equal(at("2026-12-30"), 250 * 4);
  assert.equal(at("2027-01-02"), 300 * 4);
  assert.ok(
    budgetLeft({
      ...base,
      checkIn: "2028-01-02",
      checkOut: "2028-01-04",
      cityTaxes: [y2026, y2027],
    }).unknown.some((u) => u.id === "city-tax"),
  );
});

test("every committed city cost record is valid, and a city's records never overlap", () => {
  for (const r of cityTaxRecords)
    assert.ok(validCityTax(r), `${r.city} city tax from ${r.effectiveFrom}`);
  for (const r of airportTransferRecords)
    assert.ok(validAirportTransfer(r), `${r.airport} transfer`);
  const byCity = new Map<string, CityTaxRecord[]>();
  for (const r of cityTaxRecords)
    byCity.set(r.city, [...(byCity.get(r.city) ?? []), r]);
  for (const [city, records] of byCity) {
    const sorted = [...records].sort((a, b) =>
      a.effectiveFrom.localeCompare(b.effectiveFrom),
    );
    for (let i = 1; i < sorted.length; i++)
      assert.ok(
        sorted[i - 1].effectiveTo !== undefined &&
          sorted[i - 1].effectiveTo! < sorted[i].effectiveFrom,
        `${city}: records overlap`,
      );
  }
  const airports = airportTransferRecords.map((r) => r.airport);
  assert.equal(
    new Set(airports).size,
    airports.length,
    "one transfer per airport",
  );
});

test("the stay length drives city tax, food days and the room figure; seven-night city tax is not known yet", () => {
  // Three nights: per-person-night tax for two people over three nights.
  const three = budgetLeft({
    ...base,
    checkOut: "2026-12-08",
    cityTaxes: [tax()],
    foodPerDayCents: 3000,
  });
  const t3 = three.known.find((k) => k.id === "city-tax")!;
  assert.equal(t3.cents, 250 * 2 * 3);
  assert.equal(t3.detail, "City tax for two people, three nights");
  // Food days equal nights, and the room figure divides by the nights.
  assert.deepEqual(three.food, { perDayCents: 3000, days: 3, cents: 9000 });
  assert.equal(
    three.roomPerNightCents,
    Math.floor((three.leftCents - 9000) / 3 / 100) * 100,
  );
  // Per-room-night tax also follows the length.
  const room = budgetLeft({
    ...base,
    checkOut: "2026-12-08",
    cityTaxes: [tax({ basis: "per-room-night" })],
  });
  assert.equal(room.known.find((k) => k.id === "city-tax")?.cents, 250 * 3);
  // Seven nights: caps are not sourced yet, so the tax is named as not known,
  // never multiplied; percentage taxes too.
  for (const record of [
    tax(),
    tax({
      basis: "percent-of-room",
      value: 5,
      percentOf: "price-including-vat",
    }),
  ]) {
    const seven = budgetLeft({
      ...base,
      checkOut: "2026-12-12",
      cityTaxes: [record],
      foodPerDayCents: 3000,
    });
    assert.equal(
      seven.known.find((k) => k.id === "city-tax"),
      undefined,
    );
    assert.equal(seven.percentTax, undefined);
    assert.match(
      seven.unknown.find((u) => u.id === "city-tax")?.reason ?? "",
      /seven nights/,
    );
    assert.equal(seven.food?.days, 7);
  }
  // A city with no tax has none whatever the length.
  const none = budgetLeft({
    ...base,
    checkOut: "2026-12-12",
    cityTaxes: [
      tax({
        status: "none",
        basis: undefined,
        value: undefined,
        currency: undefined,
      }),
    ],
  });
  assert.ok(none.noCityTax);
  // An unclear length never guesses.
  const unclear = budgetLeft({
    ...base,
    checkOut: "2026-12-05",
    cityTaxes: [tax()],
    foodPerDayCents: 3000,
  });
  assert.ok(unclear.unknown.some((u) => u.id === "city-tax"));
  assert.equal(unclear.food, undefined);
  assert.equal(TAX_NIGHTS_VERIFIED, 3);
  assert.equal(stayNights("2026-12-30", "2027-01-02"), 3);
  assert.equal(nightsLabel(1), "one night");
});
