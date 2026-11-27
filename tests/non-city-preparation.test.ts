// Historical record/access regression. Live archive exclusion is tested in destination-archive.test.ts.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { loadEditorialWorkspace } from "./fixtures/archived-destination-data";
import {
  isBatchPreparation,
  reviewDestinationBatch,
} from "./fixtures/archived-destination-data";
import { isDestinationPopulationBatch } from "../src/content/operator/batch";
import { reviewPins } from "../scripts/lib/editorial-review";
import { contentItems } from "../src/content/integrity";
const now = Date.parse("2026-10-26T16:00:00Z");
const ids = ["crete", "place:Q1490", "place:Q1273", "place:Q180402"];
// Reconstruct preparation only in memory; real source files remain published.
function draftWorkspace() {
  const workspace = structuredClone(
    loadEditorialWorkspace(undefined, undefined, now),
  );
  for (const id of ids) {
    const record = workspace.inputs.get(id)!.record;
    for (const item of [
      record,
      ...contentItems(record).map(({ item }) => item),
    ]) {
      item.reviewStatus = "draft";
      item.reviewedAt = null;
    }
    delete record.publication;
    workspace.reviews.delete(id);
  }
  return workspace;
}
const read = (p: string) => JSON.parse(readFileSync(p, "utf8"));
test("Phase 5G in-memory preparation has four pending unpublished proofs with current pins", () => {
  const path = "content/operations/batches/phase5g-non-city-proofs.json";
  const before = readFileSync(path, "utf8");
  const batch = JSON.parse(before),
    prep = read("content/operations/preparation/phase5g-non-city-proofs.json");
  assert.ok(isDestinationPopulationBatch(batch));
  assert.ok(isBatchPreparation(prep, now));
  assert.deepEqual(
    batch.entries.map((e) => e.destinationId),
    ids,
  );
  const w = draftWorkspace();
  prep.entries.find(
    (e: { destinationId: string }) => e.destinationId === "place:Q1490",
  )!.pins = reviewPins(w.inputs.get("place:Q1490")!);
  const result = reviewDestinationBatch(batch, prep, w, now);
  assert.equal(result.ready, 4);
  assert.equal(result.writes, 0);
  assert.equal(result.editorialApprovals, 0);
  for (const id of ids) {
    const r = w.inputs.get(id)!.record;
    assert.equal(r.contentVersion, id === "place:Q1490" ? 4 : 2);
    assert.equal(r.reviewStatus, "draft");
    assert.equal(r.reviewedAt, null);
    assert.equal(r.publication, undefined);
    assert.equal(w.reviews.get(id), undefined);
    for (const { item } of contentItems(r)) {
      assert.equal(item.reviewStatus, "draft");
      assert.equal(item.reviewedAt, null);
    }
  }
  for (const row of result.rows) {
    assert.deepEqual(row.blockers, []);
    assert.equal(row.decision, "pending");
    assert.deepEqual(
      row.advisories,
      row.destinationId === "place:Q1490"
        ? ["evidence-review", "presentation:b5fdcc388f262654c071"]
        : ["evidence-review"],
    );
    assert.ok(Object.values(row.checks).every((v) => v === "pending"));
  }
  assert.equal(readFileSync(path, "utf8"), before);
  assert.equal(
    [...w.inputs.values()].filter((x) => x.record.reviewStatus === "reviewed")
      .length,
    26,
  );
  assert.equal(
    [...w.inputs.values()].filter((x) => x.record.reviewStatus === "draft")
      .length,
    4,
  );
});
test("multi-group batch preparation rejects excess groups and mismatched operational proof", () => {
  const batch = read("content/operations/batches/phase5g-non-city-proofs.json");
  const prep = read(
    "content/operations/preparation/phase5g-non-city-proofs.json",
  );
  const invalid = structuredClone(prep);
  invalid.entries[2].travel.groups.push(
    { cityCode: "AAA", airports: ["AAA"] },
    { cityCode: "BBB", airports: ["BBB"] },
  );
  assert.equal(isBatchPreparation(invalid, now), false);
  const mismatch = structuredClone(prep);
  mismatch.entries[2].travel.groups[0].airports = ["BLQ"];
  assert.ok(isBatchPreparation(mismatch, now));
  const w = draftWorkspace();
  mismatch.entries.find(
    (e: { destinationId: string }) => e.destinationId === "place:Q1490",
  )!.pins = reviewPins(w.inputs.get("place:Q1490")!);
  const result = reviewDestinationBatch(batch, mismatch, w, now);
  assert.equal(result.ready, 3);
  assert.ok(
    result.rows[2].blockers.includes("travel-identity-blocked-or-stale"),
  );
});
