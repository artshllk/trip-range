// Historical record/access regression. Live archive exclusion is tested in destination-archive.test.ts.
import assert from "node:assert/strict";
import { test } from "node:test";
import { readFileSync } from "node:fs";
import batch from "../content/operations/batches/phase5i-standard-non-city.json";
import preparation from "../content/operations/preparation/phase5i-standard-non-city.json";
import { loadEditorialWorkspace } from "./fixtures/archived-destination-data";
import {
  isBatchPreparation,
  reviewDestinationBatch,
} from "./fixtures/archived-destination-data";
import { isDestinationPopulationBatch } from "../src/content/operator/batch";
import {
  contentItems,
  publicationReceiptMatches,
} from "../src/content/integrity";
import { reviewPins } from "../scripts/lib/editorial-review";
const now = Date.parse("2026-10-26T16:00:00Z");
const ids = [
  "place:Q4648",
  "place:Q40846",
  "place:Q2656389",
  "place:Q131347",
  "place:Q76516549",
  "place:Q41858",
];
// Reconstruct the six preparations in isolated memory; never edit real publications.
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
test("Phase 5I has exactly six pinned draft preparations, never editorial approvals", () => {
  const workspace = draftWorkspace();
  const before = new Map(workspace.watched);
  assert.ok(isDestinationPopulationBatch(batch));
  assert.ok(isBatchPreparation(preparation, now));
  assert.deepEqual(
    batch.entries.map((e) => e.destinationId),
    ids,
  );
  const report = reviewDestinationBatch(batch, preparation, workspace, now);
  assert.equal(report.ready, 6);
  assert.equal(report.total, 6);
  assert.equal(report.writes, 0);
  assert.equal(report.editorialApprovals, 0);
  assert.equal(report.externalCalls, 0);
  for (const id of ids) {
    const input = workspace.inputs.get(id)!;
    const r = input.record;
    assert.equal(r.contentVersion, id === "place:Q2656389" ? 3 : 2);
    assert.equal(r.publication, undefined);
    assert.equal(workspace.reviews.get(id), undefined);
    assert.deepEqual(
      preparation.entries.find((e) => e.destinationId === id)!.pins,
      reviewPins(input),
    );
    for (const item of [r, ...contentItems(r).map(({ item }) => item)]) {
      assert.equal(item.reviewStatus, "draft");
      assert.equal(item.reviewedAt, null);
    }
  }
  for (const row of report.rows) {
    assert.deepEqual(row.blockers, []);
    assert.deepEqual(
      row.advisories,
      row.destinationId === "place:Q2656389"
        ? ["evidence-review", "presentation:7e2a291f9f24ff36b8f4"]
        : ["evidence-review"],
    );
    assert.ok(Object.values(row.checks).every((v) => v === "pending"));
    assert.equal(row.decision, "pending");
    assert.equal(row.receipt, "absent");
  }
  const inputs = [...workspace.inputs.values()];
  assert.equal(
    inputs.filter((i) => i.record.reviewStatus === "reviewed").length,
    24,
  );
  assert.equal(
    inputs.filter((i) => i.record.reviewStatus === "draft").length,
    6,
  );
  for (const input of inputs.filter(
    (i) => i.record.reviewStatus === "reviewed",
  ))
    assert.equal(publicationReceiptMatches(input.record, input.identity), true);
  for (const [file, raw] of before)
    if (raw !== null) assert.equal(readFileSync(file, "utf8"), raw);
});
test("Phase 5I stale copy pins and mismatched airport membership fail readiness", () => {
  assert.ok(isDestinationPopulationBatch(batch));
  assert.ok(isBatchPreparation(preparation, now));
  const workspace = draftWorkspace();
  workspace.inputs.get(ids[0])!.record.overview!.text.en += " Changed.";
  const stale = reviewDestinationBatch(batch, preparation, workspace, now);
  assert.equal(stale.ready, 5);
  assert.ok(stale.rows[0].blockers.includes("preparation-stale"));
  const wrong = structuredClone(preparation);
  wrong.entries[1].travel.groups[0].airports = ["TFN"];
  const report = reviewDestinationBatch(batch, wrong, draftWorkspace(), now);
  assert.equal(report.ready, 5);
  assert.ok(
    report.rows[1].blockers.includes("travel-identity-blocked-or-stale"),
  );
});
