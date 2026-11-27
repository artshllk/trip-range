import assert from "node:assert/strict";
import test from "node:test";
import {
  DEFAULT_NIGHTS,
  nightsAdjective,
  planNights,
} from "../src/domain/stay-length";
import { originNights, collectorOrigins } from "../src/domain/fare-refresh";
import {
  isMonthDiscovery,
  monthDestinations,
  type MonthFare,
} from "../src/domain/month-discovery";
import { planOrigins } from "../src/domain/plan-origins";

test("lengths per origin: two and three everywhere, seven from London and Warsaw, three by default", () => {
  assert.equal(DEFAULT_NIGHTS, 3);
  assert.deepEqual(originNights("TIA"), [2, 3]);
  assert.deepEqual(originNights("BCN"), [2, 3]);
  assert.deepEqual(originNights("LON"), [2, 3, 7]);
  assert.deepEqual(originNights("WAW"), [2, 3, 7]);
  // Five and six are never collected (owner decision, 27 November 2026).
  for (const o of collectorOrigins)
    assert.ok(!originNights(o).some((n) => n === 5 || n === 6), o);
  for (const o of planOrigins) assert.ok(originNights(o.code).includes(3));
});

test("the URL length: default, offered, and an honest not-collected state", () => {
  assert.deepEqual(planNights("TIA", undefined), {
    nights: 3,
    offered: [2, 3],
  });
  assert.equal(planNights("TIA", "2").nights, 2);
  assert.equal(planNights("LON", "7").nights, 7);
  // Seven nights from Tirana is not collected: say so, never show a substitute as if asked.
  assert.deepEqual(planNights("TIA", "7"), {
    nights: 3,
    offered: [2, 3],
    notCollected: 7,
  });
  for (const raw of ["", "abc", "3.5", "-2", "999", ["3"], 3])
    assert.equal(planNights("WAW", raw).notCollected, undefined, String(raw));
  assert.equal(nightsAdjective(3), "three-night");
  assert.equal(nightsAdjective(7), "seven-night");
  assert.ok(
    isMonthDiscovery({ depart: "london", nights: "7", month: "2026-12" }),
  );
});

test("a view shows only fares of its own length", () => {
  const base: MonthFare = {
    destination: "MIL",
    airport: "MXP",
    departure: "2026-12-10",
    returning: "2026-12-12",
    observedAt: "2026-12-09T12:00:00Z",
    partyCents: 10000,
  };
  const rows: MonthFare[] = [
    base,
    { ...base, destination: "ROM", airport: "FCO", returning: "2026-12-13" },
    { ...base, destination: "VIE", airport: "VIE", returning: "2026-12-17" },
  ];
  const pick = (nights: number) =>
    monthDestinations(
      rows,
      "2026-12",
      "2026-12-08",
      Date.parse("2026-12-09T13:00:00Z"),
      600,
      nights,
    ).map((c) => c.destination);
  assert.deepEqual(pick(2), ["MIL"]);
  assert.deepEqual(pick(3), ["ROM"]);
  assert.deepEqual(pick(7), ["VIE"]);
  // The collector's two-night default is unchanged.
  assert.deepEqual(
    monthDestinations(
      rows,
      "2026-12",
      "2026-12-08",
      Date.parse("2026-12-09T13:00:00Z"),
      600,
    ).map((c) => c.destination),
    ["MIL"],
  );
});

test("storage options A and B: only collected lengths, only fares that can fit the highest budget", async () => {
  const { storableRow } = await import("../src/domain/fare-refresh");
  const { flightCeilings } = await import("../src/domain/month-discovery");
  const { money, safetyBufferFor } = await import("../src/domain/budget");
  const row = (
    returnDate: string | null,
    priceMinor = 10000,
    currency = "EUR",
  ) => ({
    departureDate: "2026-12-10",
    returnDate,
    priceMinor,
    currency,
  });
  // A: lengths this origin collects.
  assert.equal(storableRow(row("2026-12-12"), "TIA"), true);
  assert.equal(storableRow(row("2026-12-13"), "TIA"), true);
  assert.equal(storableRow(row("2026-12-17"), "TIA"), false); // 7 nights: not from Tirana
  assert.equal(storableRow(row("2026-12-17"), "WAW"), true);
  assert.equal(storableRow(row("2026-12-15"), "WAW"), false); // 5 nights: never
  assert.equal(storableRow(row(null), "WAW"), false); // one-way
  assert.equal(storableRow(row("2026-12-12", 10000, "USD"), "WAW"), false);
  // B: the fare for two with its reserve must fit the top ceiling, exactly at the edge.
  const top = Math.max(...flightCeilings) * 100;
  let edge = 1;
  while (edge * 2 + safetyBufferFor(money(edge * 2, "EUR")).cents <= top)
    edge++;
  assert.equal(storableRow(row("2026-12-12", edge - 1), "LON"), true);
  assert.equal(storableRow(row("2026-12-12", edge), "LON"), false);
});
