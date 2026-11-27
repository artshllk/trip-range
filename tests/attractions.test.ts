import assert from "node:assert/strict";
import test from "node:test";
import { attractionsForStay, validAttraction } from "../src/domain/attractions";
import {
  airportTransferRecords,
  attractionRecords,
  cityTaxRecords,
} from "../src/domain/city-cost-records";
import { budgetLeft, validAirportTransfer } from "../src/domain/budget-left";

const now = Date.parse("2026-11-25T12:00:00Z");
const stay = (checkIn: string, checkOut: string) =>
  attractionsForStay({
    records: attractionRecords,
    city: "ROM",
    checkIn,
    checkOut,
    now,
  });

test("committed sight records are valid, Rome only, each listed on an official basis", () => {
  assert.ok(attractionRecords.length > 0);
  for (const r of attractionRecords) {
    assert.ok(validAttraction(r), r.id);
    assert.equal(r.city, "ROM");
    assert.ok(r.selection.source.quote.length > 8, r.id);
  }
  assert.deepEqual(
    stay("2026-12-15", "2026-12-17").map((a) => a.id),
    ["colosseo", "pantheon", "trevi"],
  );
  assert.deepEqual(
    attractionsForStay({
      records: attractionRecords,
      city: "PAR",
      checkIn: "2026-12-15",
      checkOut: "2026-12-17",
      now,
    }),
    [],
  );
});

test("sights are priced for two, with closures and free first Sundays inside the stay", () => {
  const a = stay("2026-12-15", "2026-12-17");
  assert.equal(a.find((x) => x.id === "colosseo")?.partyCents, 3600);
  assert.equal(a.find((x) => x.id === "pantheon")?.partyCents, 1400);
  assert.equal(a.find((x) => x.id === "trevi")?.partyCents, 400);
  const newYear = stay("2026-12-31", "2027-01-02");
  assert.deepEqual(newYear.find((x) => x.id === "colosseo")?.closedOn, [
    "2027-01-01",
  ]);
  const firstSunday = stay("2026-12-05", "2026-12-07");
  assert.deepEqual(firstSunday.find((x) => x.id === "pantheon")?.freeOn, [
    "2026-12-06",
  ]);
  assert.deepEqual(firstSunday.find((x) => x.id === "trevi")?.freeOn, []);
  // Past its review date, a price is unknown, never shown as a figure.
  const late = attractionsForStay({
    records: attractionRecords,
    city: "ROM",
    checkIn: "2027-03-10",
    checkOut: "2027-03-12",
    now: Date.parse("2027-03-05T00:00:00Z"),
  });
  assert.ok(
    late.every((x) => x.status === "unknown" && x.partyCents === undefined),
  );
});

test("Rome's transfers are subtracted on the card, Ciampino flagged as read by hand, Fiumicino with its caveat", () => {
  for (const r of airportTransferRecords)
    assert.ok(validAirportTransfer(r), r.airport);
  const base = {
    budgetCents: 60000,
    flightPartyCents: 9800,
    flightObservedAt: "2026-11-23T10:00:00Z",
    city: "ROM",
    checkIn: "2026-12-15",
    checkOut: "2026-12-17",
    hotelClass: "3" as const,
    cityTaxes: cityTaxRecords,
    transfers: airportTransferRecords,
    fx: undefined,
    now,
  };
  const cia = budgetLeft({ ...base, arrivalAirport: "CIA" }).known.find(
    (k) => k.id === "airport-transfer",
  )!;
  assert.equal(cia.cents, 150 * 4);
  assert.equal(cia.source?.manualCheckedOn, "2026-11-25");
  const fco = budgetLeft({ ...base, arrivalAirport: "FCO" }).known.find(
    (k) => k.id === "airport-transfer",
  )!;
  assert.equal(fco.cents, 800 * 4);
  assert.match(fco.note ?? "", /overstate/);
});
