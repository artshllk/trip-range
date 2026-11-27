// Historical record/access regression. Live archive exclusion is tested in destination-archive.test.ts.
import assert from "node:assert/strict";
import { test } from "node:test";
import { readFileSync } from "node:fs";
import batch from "../content/operations/batches/phase5k-tasmania.json";
import prep from "../content/operations/preparation/phase5k-tasmania.json";
import { loadEditorialWorkspace } from "./fixtures/archived-destination-data";
import {
  reviewDestinationBatch,
  isBatchPreparation,
} from "./fixtures/archived-destination-data";
import { isDestinationPopulationBatch } from "../src/content/operator/batch";
import {
  contentItems,
  publicationReceiptMatches,
} from "../src/content/integrity";
const now = Date.parse("2026-10-26T16:00:00Z");
test("Tasmania preparation is pinned and pending; all 29 other publications remain valid", () => {
  // Reconstruct the Phase 5K preparation in memory; never mutate persisted publication.
  const w = structuredClone(loadEditorialWorkspace(undefined, undefined, now));
  const draft = w.inputs.get("place:Q3593416")!.record;
  for (const item of [draft, ...contentItems(draft).map(({ item }) => item)]) {
    item.reviewStatus = "draft";
    item.reviewedAt = null;
  }
  delete draft.publication;
  w.reviews.delete(draft.destinationId);
  assert.ok(isDestinationPopulationBatch(batch));
  assert.ok(isBatchPreparation(prep, now));
  const result = reviewDestinationBatch(batch, prep, w, now);
  assert.equal(result.total, 1);
  assert.equal(result.ready, 1);
  assert.equal(result.writes, 0);
  const r = result.rows[0];
  assert.equal(r.version, 2);
  assert.equal(r.sources, 8);
  assert.deepEqual(r.advisories, ["evidence-review"]);
  assert.deepEqual(r.blockers, []);
  assert.equal(r.decision, "pending");
  assert.equal(r.receipt, "absent");
  assert.ok(Object.values(r.checks).every((v) => v === "pending"));
  const input = w.inputs.get("place:Q3593416")!;
  assert.equal(input.record.attractions!.length, 4);
  assert.equal(w.reviews.get(input.record.destinationId), undefined);
  for (const item of [
    input.record,
    ...contentItems(input.record).map((i) => i.item),
  ]) {
    assert.equal(item.reviewStatus, "draft");
    assert.equal(item.reviewedAt, null);
  }
  const all = [...w.inputs.values()];
  assert.equal(
    all.filter((i) => i.record.reviewStatus === "reviewed").length,
    29,
  );
  assert.equal(all.filter((i) => i.record.reviewStatus === "draft").length, 1);
  for (const i of all.filter((i) => i.record.reviewStatus === "reviewed"))
    assert.ok(publicationReceiptMatches(i.record, i.identity));
  assert.equal(w.inputs.get("place:Q24451")!.record.contentVersion, 2);
  for (const [file, raw] of w.watched)
    if (raw !== null) assert.equal(readFileSync(file, "utf8"), raw);
});
test("operator preparation pins restoration policy without weakening other grouped limits", () => {
  assert.ok(isDestinationPopulationBatch(batch));
  assert.ok(isBatchPreparation(prep, now));
  for (const change of [
    { restorationGroups: ["HBA", "LST", "DPO", "BWT"] },
    { restorationGroups: [] },
    { restorationGroups: ["FLS"] },
    { restorationGroups: undefined },
    { kind: "external-gateway" },
  ]) {
    const wrong: typeof prep = structuredClone(prep);
    Object.assign(wrong.entries[0].travel, change);
    assert.equal(isBatchPreparation(wrong, now), false);
  }
  const wrong: typeof prep = structuredClone(prep);
  wrong.entries[0].travel.restorationGroups = ["LST", "HBA"];
  const report = reviewDestinationBatch(
    batch,
    wrong,
    loadEditorialWorkspace(undefined, undefined, now),
    now,
  );
  assert.equal(report.ready, 0);
  assert.ok(
    report.rows[0].blockers.includes("travel-identity-blocked-or-stale"),
  );
});
