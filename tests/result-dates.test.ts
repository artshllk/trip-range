import { test } from "node:test";
import assert from "node:assert/strict";
import {
  resultDateLabels,
  resultMonth,
  resultDateRange,
} from "../src/i18n/result-dates";

test("results dates use explicit EN/SQ month labels without browser ICU", () => {
  assert.deepEqual(resultDateLabels("2026-11-14", "2026-11-16", "en", "2026"), {
    start: "14",
    end: "16 Nov",
  });
  assert.deepEqual(resultDateLabels("2026-11-14", "2026-11-16", "sq", "2026"), {
    start: "14",
    end: "16 nën",
  });
  assert.equal(resultMonth("2026-10", "sq"), "tet 2026");
  assert.equal(resultMonth("2026-10", "en"), "Oct 2026");
});
test("results dates preserve month and year boundaries and future-year context", () => {
  assert.deepEqual(resultDateLabels("2026-10-30", "2026-11-02", "en", "2026"), {
    start: "30 Oct",
    end: "2 Nov",
  });
  assert.deepEqual(resultDateLabels("2026-12-30", "2027-01-02", "en", "2026"), {
    start: "30 Dec 2026",
    end: "2 Jan 2027",
  });
  assert.deepEqual(resultDateLabels("2027-11-14", "2027-11-16", "en", "2026"), {
    start: "14",
    end: "16 Nov 2027",
  });
  assert.deepEqual(resultDateLabels("2026-11-14", "2026-11-14", "sq", "2026"), {
    start: "14 nën",
    end: undefined,
  });
});
test("invalid dates pass through rather than producing misleading dates", () => {
  assert.deepEqual(resultDateLabels("2026-02-30", "2026-03-01", "en", "2026"), {
    start: "2026-02-30",
    end: "2026-03-01",
  });
  assert.equal(resultMonth("2026-13", "en"), "2026-13");
});

// These labels use calendar strings, never the browser's local timezone.
test("compact search dates cover same-month, cross-month, cross-year and leap-day ranges", () => {
  for (const [start, end, expected] of [
    ["2026-10-24", "2026-10-26", "24–26 Oct"],
    ["2026-10-30", "2026-11-02", "30 Oct–2 Nov"],
    ["2026-12-30", "2027-01-02", "30 Dec 2026–2 Jan 2027"],
    ["2028-02-28", "2028-03-01", "28 Feb 2028–1 Mar 2028"],
    ["2027-10-24", "2027-10-26", "24–26 Oct 2027"],
  ])
    assert.equal(resultDateRange(start, end, "en", "2026"), expected);
  assert.equal(
    resultDateRange("2026-10-24", "2026-10-26", "sq", "2026"),
    "24–26 tet",
  );
  assert.equal(resultDateRange("", "", "en", "2026"), "");
});
