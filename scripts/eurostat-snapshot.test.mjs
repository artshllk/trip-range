import { test } from "node:test";
import assert from "node:assert/strict";
import { decodeJsonStat, priceLevelSnapshot } from "./eurostat-snapshot.mjs";

// Synthetic values in the exact JSON-stat 2.0 structure the live API returned on
// 2026-11-04 (dimension names, ordering, sparse value object, "p" status flags).
const dataset = (dims, value, status) => ({
  version: "2.0",
  class: "dataset",
  label: "synthetic",
  source: "ESTAT",
  updated: "2026-07-09T23:00:00+0200",
  id: dims.map(([name]) => name),
  size: dims.map(([, codes]) => codes.length),
  dimension: Object.fromEntries(
    dims.map(([name, codes]) => [
      name,
      {
        category: {
          index: Object.fromEntries(codes.map((c, i) => [c, i])),
          label: {},
        },
      },
    ]),
  ),
  value,
  ...(status ? { status } : {}),
});

test("JSON-stat cells decode row-major with missing cells skipped", () => {
  const d = dataset(
    [
      ["geo", ["AT", "EL"]],
      ["time", ["2024", "2025"]],
    ],
    { 0: 1, 1: 2, 3: 4 },
    { 3: "p" },
  );
  assert.deepEqual(decodeJsonStat(d), [
    { geo: "AT", time: "2024", value: 1, status: null },
    { geo: "AT", time: "2025", value: 2, status: null },
    { geo: "EL", time: "2025", value: 4, status: "p" },
  ]);
  assert.throws(() => decodeJsonStat({ ...d, version: "1.0" }));
  assert.throws(() => decodeJsonStat({ ...d, size: [2, 3] }));
});

test("price levels keep only PLI × A0111, flag provisional values and drop OECD-computed rows", () => {
  const d = dataset(
    [
      ["freq", ["A"]],
      ["indic_ppp", ["PPP_EU27_2020", "PLI_EU27_2020"]],
      ["ppp_cat18", ["GDP", "A0111"]],
      ["geo", ["AT", "UK"]],
      ["time", ["2024", "2025"]],
    ],
    // index = ((indic*2 + cat)*2 + geo)*2 + time
    { 0: 9, 12: 101, 13: 102, 14: 150, 15: 151 },
    { 13: "p" },
  );
  const s = priceLevelSnapshot(d, { retrievedAt: "2026-11-04" });
  assert.equal(s.updated, "2026-07-09");
  assert.equal(s.reviewStatus, "pending");
  assert.deepEqual(s.values, [
    { geo: "AT", year: 2024, value: 101 },
    { geo: "AT", year: 2025, value: 102, provisional: true },
  ]);
  assert.throws(() =>
    priceLevelSnapshot(
      { ...d, id: d.id.map((n) => (n === "indic_ppp" ? "x" : n)) },
      {},
    ),
  );
});
