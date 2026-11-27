import assert from "node:assert/strict";
import test from "node:test";
import {
  discoveryMonths,
  isMonthDiscovery,
  monthDestinations,
  type MonthFare,
} from "../src/domain/month-discovery";
import { launchOriginCodes } from "../src/domain/market/primary-origin";
import { launchHubIds } from "../src/seo/registry";
import screen from "../content/fares/tirana-screen-2026-11-16.json";

test("Tirana month discovery is the default, including December rollover; explicit trips survive", () => {
  assert.deepEqual(launchOriginCodes, ["TIA"]);
  assert.deepEqual(launchHubIds, ["en-tirana-origin"]);
  assert.deepEqual(discoveryMonths("2026-12-31"), ["2026-12", "2027-01"]);
  assert.deepEqual(discoveryMonths("2026-12-31", "2027-02"), ["2027-02"]);
  assert.deepEqual(discoveryMonths("2026-12-31", "2026-00"), [
    "2026-12",
    "2027-01",
  ]);
  assert.ok(isMonthDiscovery({ month: "2027-02", ceiling: "800" }));
  assert.ok(isMonthDiscovery({ utm_source: "newsletter" }));
  assert.equal(isMonthDiscovery({ month: "2027-02", when: "weekends" }), false);
  assert.equal(isMonthDiscovery({ origin: "skopje" }), false);
});
test("one cheapest eligible return per departure, with a seven-day provider timestamp and a party reserve", () => {
  const fare: MonthFare = {
    destination: "MIL",
    airport: "MXP",
    departure: "2026-12-31",
    returning: "2027-01-02",
    observedAt: "2026-12-21T12:00:00Z",
    partyCents: 10000,
  };
  const rows = [
    fare,
    { ...fare, airport: "BGY", partyCents: 9500 },
    { ...fare, airport: "", partyCents: 2000 },
    { ...fare, partyCents: 2000, observedAt: "2026-12-21T11:59:59Z" },
    { ...fare, partyCents: 2000, observedAt: "2026-12-28T12:00:01Z" },
    { ...fare, destination: "BER", partyCents: 55000 },
    { ...fare, destination: "VIE", returning: "2027-01-03" },
    {
      ...fare,
      destination: "ROM",
      departure: "2026-12-27",
      returning: "2026-12-29",
    },
  ];
  const found = monthDestinations(
    rows,
    "2026-12",
    "2026-12-28",
    Date.parse("2026-12-28T12:00:00Z"),
    600,
  );
  assert.deepEqual(
    found.map((c) => [
      c.destination,
      c.minimum,
      c.options.length,
      c.options[0].airport,
    ]),
    [["MIL", 9500, 1, "BGY"]],
  );
});
test("a fare departing today is never offered; tomorrow is the first eligible day", () => {
  const base: MonthFare = {
    destination: "MIL",
    airport: "MXP",
    departure: "2026-12-10",
    returning: "2026-12-12",
    observedAt: "2026-12-09T12:00:00Z",
    partyCents: 10000,
  };
  const pick = (departure: string) =>
    monthDestinations(
      [{ ...base, departure, returning: addTwoDays(departure) }],
      "2026-12",
      "2026-12-10",
      Date.parse("2026-12-10T08:00:00Z"),
      600,
    ).length;
  assert.equal(pick("2026-12-09"), 0);
  assert.equal(pick("2026-12-10"), 0);
  assert.equal(pick("2026-12-11"), 1);
});
function addTwoDays(date: string) {
  const d = new Date(date + "T00:00:00Z");
  d.setUTCDate(d.getUTCDate() + 2);
  return d.toISOString().slice(0, 10);
}

test("the launch screen reproduces all three audited months at the measurement clock and expires", () => {
  const cutoff = Date.parse(screen.capturedAt);
  for (const [month, count, multiple] of [
    ["2026-12", 21, 8],
    ["2027-01", 10, 4],
    ["2027-02", 2, 0],
  ] as const) {
    const cities = monthDestinations(
      screen.fares,
      month,
      "2026-11-16",
      cutoff,
      600,
    );
    assert.equal(cities.length, count);
    assert.equal(cities.filter((c) => c.options.length > 1).length, multiple);
    assert.deepEqual(
      monthDestinations(
        screen.fares,
        month,
        "2026-11-24",
        cutoff + 8 * 86400000,
        600,
      ),
      [],
    );
  }
});
