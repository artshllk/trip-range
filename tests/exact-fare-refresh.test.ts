import { test } from "node:test";
import assert from "node:assert/strict";
import {
  catchUpDue,
  collectionDue,
  sweepDue,
  collectionStall,
  collectorOrigins,
  monthDays,
  originAirports,
  reassessment,
  refreshHealth,
  splitWrongOrigin,
  wrongOriginLimit,
} from "../src/domain/fare-refresh";
import { discoveryMonths } from "../src/domain/month-discovery";
import { addDays, nightsBetween } from "../src/domain/dates";

test("two-night departures span the remaining current month and every day of next month", () => {
  assert.deepEqual(discoveryMonths("2026-12-31"), ["2026-12", "2027-01"]);
  assert.deepEqual(monthDays("2026-12", "2026-12-31"), ["2026-12-31"]);
  const january = monthDays("2027-01", "2026-12-31");
  assert.equal(january.length, 31);
  assert.equal(addDays(january[30], 2), "2027-02-02");
});
test("a PRN cohort uses the same distinct weekends on both weekly checks within 3–8 weeks", () => {
  const a = reassessment("2026-12-14"),
    b = reassessment("2026-12-21");
  assert.deepEqual(a.dates, b.dates);
  assert.equal(new Set(a.dates).size, 4);
  for (const d of a.dates) {
    assert.ok(nightsBetween(b.week, d) >= 21 && nightsBetween(a.week, d) <= 56);
  }
  assert.ok(!reassessment("2026-11-16").dates.includes("2026-12-25"));
});
test("a completed empty month is healthy and a high-count month can still be failed or overdue", () => {
  const at = "2026-11-16T09:00:00Z",
    receipt = { outcome: "stored", attempted_at: at, run_id: "test" };
  assert.equal(
    refreshHealth(receipt, at, Date.parse(at) + 14 * 3600000),
    "current",
  );
  assert.equal(
    refreshHealth(receipt, at, Date.parse(at) + 14 * 3600000 + 1),
    "overdue",
  );
  assert.equal(
    refreshHealth({ ...receipt, outcome: "failed" }, at, Date.parse(at)),
    "failed",
  );
  assert.equal(refreshHealth(undefined, undefined, Date.parse(at)), "overdue");
});

test("catch-up uses successful completion age, including missing month and exact fourteen-hour boundary", () => {
  // Two sweeps a day: refreshHours 12 + graceHours 2.
  const now = Date.parse("2026-11-18T12:00:00Z");
  assert.equal(catchUpDue(undefined, now), true);
  assert.equal(catchUpDue(null, now), true);
  assert.equal(catchUpDue("invalid", now), true);
  assert.equal(catchUpDue("2026-11-17T22:00:00Z", now), false);
  assert.equal(catchUpDue("2026-11-17T21:59:59Z", now), true);
  assert.equal(catchUpDue("2026-11-18T11:59:59Z", now), false);
});

test("four origins collect, and only a market's own airports count as its origin", () => {
  assert.deepEqual(collectorOrigins, ["TIA", "LON", "BCN", "WAW"]);
  // Single-airport and unlisted markets keep the previous exact-code rule.
  assert.deepEqual(originAirports("TIA"), ["TIA"]);
  assert.deepEqual(originAirports("PRN"), ["PRN"]);
  assert.deepEqual(originAirports("VIE"), ["VIE"]);
  assert.ok(originAirports("LON").includes("LHR"));
  assert.ok(originAirports("WAW").includes("WMI"));
  assert.ok(!originAirports("MIL").includes("PMF"), "Parma is not Milan");
  assert.ok(!originAirports("LON").includes("LON"));
});

test("rows stating another origin are dropped before parsing and counted by airport", () => {
  const rows = [
    { origin: "MIL", destination: "LON", value: 50 },
    { origin: "PMF", destination: "LON", value: 40 },
    { origin: "PMF", origin_airport: "PMF", destination: "PMO", value: 70 },
    { origin: "PMF", destination: "PMO", value: 80 },
    { destination: "ROM", value: 60 }, // no stated origin: unchanged behaviour
    null,
  ];
  const { kept, wrong } = splitWrongOrigin(rows, "MIL");
  assert.deepEqual(kept, [rows[0], rows[4], rows[5]]);
  assert.deepEqual(wrong, { PMF: 2, "PMF/PMF": 1 });
  assert.deepEqual(splitWrongOrigin(rows.slice(0, 1), "MIL").wrong, {});
  // Milan's 4 isolated Parma rows pass; Dubai's 231 systematic Sharjah rows fail.
  assert.equal(wrongOriginLimit, 10);
  assert.ok(4 <= wrongOriginLimit && 231 > wrongOriginLimit);
});

test("a sweep skips months that succeeded within ten hours, so duplicate or late triggers make no calls", () => {
  const now = Date.parse("2026-11-24T16:17:00Z");
  // The previous on-time sweep (04:17, finished ~04:30) is ~11h45m old: collect.
  assert.equal(sweepDue("2026-11-24T04:30:00Z", now), true);
  // A duplicate queued behind a sweep that just finished: skip.
  assert.equal(sweepDue("2026-11-24T16:05:00Z", now), false);
  // GitHub's fallback for 04:17 arriving 7 hours late, after QStash's 04:17 sweep: skip.
  assert.equal(
    sweepDue("2026-11-24T04:30:00Z", Date.parse("2026-11-24T11:20:00Z")),
    false,
  );
  // Exact ten-hour boundary.
  assert.equal(sweepDue("2026-11-24T06:17:00Z", now), false);
  assert.equal(sweepDue("2026-11-24T06:16:59Z", now), true);
  assert.equal(sweepDue(undefined, now), true);
  assert.equal(sweepDue("invalid", now), true);
});

test("collection modes: force always collects, sweep uses 10 h, catch-up uses 14 h", () => {
  const now = Date.parse("2026-11-24T12:00:00Z");
  const elevenHours = "2026-11-24T01:00:00Z";
  assert.equal(collectionDue("force", "2026-11-24T11:59:00Z", now), true);
  assert.equal(collectionDue("sweep", elevenHours, now), true);
  assert.equal(collectionDue("catch-up", elevenHours, now), false);
  assert.equal(collectionDue("catch-up", "2026-11-23T21:59:59Z", now), true);
});

test("the watchdog flags a stall when any origin-month has no success for 20 hours", () => {
  const now = Date.parse("2026-11-24T12:00:00Z");
  const months = ["2026-11", "2026-12"];
  const fresh = "2026-11-24T04:30:00Z"; // 7.5 h
  const all = (at: string) =>
    Object.fromEntries(
      ["TIA", "LON"].flatMap((o) => months.map((m) => [o + "|" + m, at])),
    );
  const ok = collectionStall(all(fresh), ["TIA", "LON"], months, now);
  assert.equal(ok.stale, false);
  assert.equal(ok.oldest.ageHours, 7.5);
  // Whole outage: last success 20 h 30 min ago.
  assert.equal(
    collectionStall(all("2026-11-23T15:30:00Z"), ["TIA", "LON"], months, now)
      .stale,
    true,
  );
  // Exact boundary is not yet stale.
  assert.equal(
    collectionStall(all("2026-11-23T16:00:00Z"), ["TIA", "LON"], months, now)
      .stale,
    false,
  );
  // One origin failing repeatedly while the others succeed.
  const one = { ...all(fresh), "LON|2026-12": "2026-11-23T10:00:00Z" };
  const r = collectionStall(one, ["TIA", "LON"], months, now);
  assert.equal(r.stale, true);
  assert.deepEqual(
    [r.oldest.origin, r.oldest.month, r.oldest.ageHours],
    ["LON", "2026-12", 26],
  );
  // An origin with no receipts at all is measured from the start of the current month.
  assert.equal(
    collectionStall(all(fresh), ["TIA", "LON", "BCN"], months, now).stale,
    true,
  );
});

test("a new month entering the window on the 1st is not a false alarm before the first sweep", () => {
  const months = ["2026-12", "2027-01"];
  const last = { "TIA|2026-12": "2026-11-30T16:30:00Z" }; // January never collected yet
  const early = collectionStall(
    last,
    ["TIA"],
    months,
    Date.parse("2026-12-01T03:00:00Z"),
  );
  assert.equal(early.stale, false);
  assert.equal(
    early.items.find((i) => i.month === "2027-01")?.lastSuccess,
    null,
  );
  // Still never collected 21 hours into the month: stale.
  assert.equal(
    collectionStall(last, ["TIA"], months, Date.parse("2026-12-01T21:00:00Z"))
      .stale,
    true,
  );
});
