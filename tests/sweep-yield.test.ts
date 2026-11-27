import { test } from "node:test";
import assert from "node:assert/strict";
import { sweepYield } from "../src/domain/sweep-yield";
import type { MonthFare } from "../src/domain/month-discovery";

const fare = (overrides: Partial<MonthFare> = {}): MonthFare => ({
  destination: "MIL",
  airport: "MXP",
  departure: "2026-12-05",
  returning: "2026-12-07",
  partyCents: 6400,
  observedAt: "2026-11-17T08:00:00Z",
  ...overrides,
});

test("new prices and observation timestamps are not new destinations or dates", () => {
  const old = fare();
  const renewed = fare({
    partyCents: 6200,
    observedAt: "2026-11-18T07:00:00Z",
  });
  const result = sweepYield([old], [renewed], "2026-11-17T09:00:00Z");
  assert.deepEqual(result.addedDestinations, []);
  assert.deepEqual(result.addedDates, []);
  assert.equal(result.newerProviderTimestampOptions, 1);
  assert.equal(result.identicalQuotes, 0);
});
test("new city and new departure within a city are distinct gains; removed options remain visible", () => {
  const old = [fare(), fare({ destination: "BER", airport: "BER" })];
  const current = [
    fare(),
    fare({ departure: "2026-12-08", returning: "2026-12-10" }),
    fare({
      destination: "PAR",
      airport: "ORY",
      observedAt: "2026-11-18T07:00:00Z",
    }),
  ];
  const result = sweepYield(old, current, "2026-11-17T09:00:00Z");
  assert.deepEqual(result.addedDestinations, ["PAR"]);
  assert.equal(result.addedDates.length, 2);
  assert.equal(result.addedDatesWithNewerProviderTimestamp, 1);
  assert.deepEqual(result.removedDestinations, ["BER"]);
  assert.equal(result.removedDates.length, 1);
  assert.equal(result.identicalQuotes, 1);
});
test("rediscovery after an empty sweep is not incremental to a store that already holds it", () => {
  const current = [fare()];
  assert.equal(
    sweepYield([], current, "2026-11-17T09:00:00Z").addedDates.length,
    1,
  );
  assert.equal(
    sweepYield(current, current, "2026-11-17T09:00:00Z").addedDates.length,
    0,
  );
});
