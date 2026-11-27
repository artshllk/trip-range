import { test } from "node:test";
import assert from "node:assert/strict";
import { fareFreshness, ageParts } from "../src/domain/money/freshness";
import {
  quoteMoney,
  derived,
  planningEstimate,
  includesEstimate,
} from "../src/domain/money/provenance";
import { money } from "../src/domain/money/currency";

const now = Date.parse("2026-10-26T12:00:00Z");
const aviasales = (
  fetchedAt: string | null,
  observedAt: string | null,
  confidence: "recent" | "estimate" = "estimate",
) =>
  quoteMoney({
    amount: money(13800, "EUR"),
    confidence,
    providerId: "travelpayouts-aviasales-data",
    observedAt,
    fetchedAt,
    demo: false,
  });

test("without a provider observation time the label is fetch-based, never fare age", () => {
  const f = fareFreshness(aviasales("2026-10-26T09:00:00Z", null), now);
  assert.equal(f?.basis, "fetched");
  assert.equal(f?.at, "2026-10-26T09:00:00Z");
  assert.equal(f?.fareObservedAt, null);
});

test("a provider observation time wins over our fetch time", () => {
  const f = fareFreshness(
    aviasales("2026-10-26T09:00:00Z", "2026-10-23T09:00:00Z"),
    now,
  );
  assert.equal(f?.basis, "fare-observed");
  assert.equal(f?.tier, "old");
});

test("tiers (provisional): green under 12 h, grey 12–72 h, amber over 72 h", () => {
  const tier = (iso: string) => fareFreshness(aviasales(iso, null), now)?.tier;
  assert.equal(tier("2026-10-26T01:00:00Z"), "fresh");
  assert.equal(
    tier("2026-10-24T11:00:00Z"),
    "aging",
    "49 h is no longer amber",
  );
  assert.equal(tier("2026-10-23T12:00:00Z"), "aging", "exactly 72 h");
  assert.equal(tier("2026-10-23T11:00:00Z"), "old");
});

test("no label when nothing truthful can be said", () => {
  assert.equal(fareFreshness(aviasales(null, null), now), undefined);
  assert.equal(
    fareFreshness(aviasales("2026-10-27T12:00:00Z", null), now),
    undefined,
    "future timestamps are rejected",
  );
  assert.equal(
    fareFreshness(planningEstimate(money(100, "EUR")), now),
    undefined,
  );
});

test("an Aviasales fare stays an observed fare even when its confidence is lowered", () => {
  assert.equal(aviasales(null, null).provenance.kind, "observed_fare");
  const estimate = quoteMoney({
    amount: money(5000, "EUR"),
    confidence: "estimate",
    providerId: "goeksplo-cost-estimate",
    observedAt: null,
    demo: false,
  });
  assert.equal(estimate.provenance.kind, "planning_estimate");
  const total = derived(money(18800, "EUR"), [aviasales(null, null), estimate]);
  assert.ok(includesEstimate(total));
});

test("age parts use whole units", () => {
  assert.deepEqual(ageParts(30 * 60_000), { value: 30, unit: "min" });
  assert.deepEqual(ageParts(3 * 3600_000 + 59 * 60_000), {
    value: 3,
    unit: "h",
  });
  assert.deepEqual(ageParts(3 * 86400_000), { value: 3, unit: "day" });
});
