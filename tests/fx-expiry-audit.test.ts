import { test } from "node:test";
import assert from "node:assert/strict";
import { fxData } from "./fixtures/fx-frozen";
import { auditFxExpiry, FX_ALERT_HOURS } from "../scripts/lib/fx-expiry-audit";

function fridaySnapshot() {
  const data = structuredClone(fxData);
  // Synthetic clocks isolate scheduler behavior; fixture rates are not live quotes.
  Object.assign(data.records[0], {
    sourceDate: "2026-10-30",
    checkedAt: "2026-10-30T16:30:00Z",
    reviewAfter: "2026-11-29T00:00:00Z",
  });
  return data;
}

test("Friday TRY warns on Sunday and Monday even if Monday refresh never ran", () => {
  for (const date of ["2026-11-01T06:17:00Z", "2026-11-02T06:17:00Z"]) {
    const rows = auditFxExpiry(fridaySnapshot(), Date.parse(date));
    const alerts = rows.filter((r) => r.status !== "ok");
    assert.deepEqual(
      alerts.map((r) => r.currency),
      ["TRY"],
    );
    assert.equal(alerts[0].status, "approaching-expiry");
    assert.equal(alerts[0].sourceDate, "2026-10-30");
    assert.equal(alerts[0].validityDays, 4);
    assert.equal(alerts[0].validUntil, "2026-11-03T00:00:00.000Z");
    assert.ok(
      alerts[0].remainingHours > 0 && alerts[0].remainingHours < FX_ALERT_HOURS,
    );
  }
});

test("FX advance alert and hard expiry have exact boundaries", () => {
  const data = fridaySnapshot();
  const rowAt = (date: number) =>
    auditFxExpiry(data, date).find((r) => r.currency === "TRY")!;
  const cutoff = Date.parse("2026-11-03T00:00:00Z");
  assert.equal(rowAt(cutoff - 48 * 3_600_000 - 1).status, "ok");
  assert.equal(rowAt(cutoff - 48 * 3_600_000).status, "approaching-expiry");
  assert.equal(rowAt(cutoff - 1).status, "approaching-expiry");
  assert.equal(rowAt(cutoff).status, "expired");
  assert.equal(
    auditFxExpiry(data, cutoff).find((r) => r.currency === "DKK")!.status,
    "ok",
  );
});

test("audit respects earlier snapshot cutoff and refuses invalid evidence", () => {
  assert.throws(
    () => auditFxExpiry({ schemaVersion: 1, records: [] }, Date.now()),
    /missing-fx/,
  );
  const data = fridaySnapshot();
  data.records[0].reviewAfter = "2026-11-01T00:00:00Z";
  assert.ok(
    auditFxExpiry(data, Date.parse("2026-10-31T00:00:00Z")).every(
      (r) => r.status === "approaching-expiry",
    ),
  );
  data.records[0].reviewStatus = "draft";
  assert.ok(
    auditFxExpiry(data, Date.parse("2026-10-31T00:00:00Z")).every(
      (r) => r.status === "unusable",
    ),
  );
  assert.throws(
    () => auditFxExpiry({ schemaVersion: 1, records: [{}] }, Date.now()),
    /invalid-fx/,
  );
});
