// Historical record/access regression. Live archive exclusion is tested in destination-archive.test.ts.
import assert from "node:assert/strict";
import { test } from "node:test";
import { loadEditorialWorkspace } from "./fixtures/archived-destination-data";
import { assessEditorialReview } from "../scripts/lib/editorial-review";
import {
  contentItems,
  contentDigest,
  publicationReceiptMatches,
} from "../src/content/integrity";
import { createPinnedDestinationContentStore } from "../src/content/runtime/publication";
import { reviewContext } from "../scripts/lib/editorial-review";
import { destinationAccessData } from "./fixtures/archived-destination-data";
import { placeRegistryData } from "../content/places/records";
import { createDestinationAccessStore } from "../src/travel/runtime/access-store";
const now = Date.parse("2026-10-26T16:00:00Z");
test("Kruger independent access cannot publish an in-memory preparation; 29 other receipts remain current", async () => {
  // Preserve preparation coverage without withdrawing the real publication.
  const w = structuredClone(loadEditorialWorkspace(undefined, undefined, now));
  const input = w.inputs.get("place:Q24451")!;
  for (const item of [
    input.record,
    ...contentItems(input.record).map(({ item }) => item),
  ]) {
    item.reviewStatus = "draft";
    item.reviewedAt = null;
  }
  delete input.record.publication;
  w.reviews.delete(input.record.destinationId);
  const r = assessEditorialReview(
    input,
    w.reviews.get(input.record.destinationId),
  );
  assert.equal(input.record.contentVersion, 2);
  assert.equal(input.record.sources.length, 9);
  assert.equal(
    contentDigest(input.record),
    "e71040998e395bd8fb9f101f3130c5573d7d288888696da1e3d1b99a787ba6f3",
  );
  assert.equal(input.record.attractions?.length, 4);
  assert.equal(input.record.publication, undefined);
  assert.equal(w.reviews.get(input.record.destinationId), undefined);
  assert.deepEqual(r.blocking, []);
  assert.equal(r.advisory.length, 1);
  assert.equal(r.advisory[0].id, "evidence-review");
  assert.equal(r.unacknowledged.length, 1);
  for (const item of [
    input.record,
    ...contentItems(input.record).map((i) => i.item),
  ]) {
    assert.equal(item.reviewStatus, "draft");
    assert.equal(item.reviewedAt, null);
  }
  assert.equal(r.decision, "pending");
  assert.ok(Object.values(r.checks).every((v) => v === "pending"));
  const all = [...w.inputs.values()];
  assert.equal(
    all.filter((i) => i.record.reviewStatus === "reviewed").length,
    29,
  );
  assert.deepEqual(
    all
      .filter((i) => i.record.reviewStatus === "draft")
      .map((i) => i.record.destinationId),
    ["place:Q24451"],
  );
  for (const i of all.filter((i) => i.record.reviewStatus === "reviewed"))
    assert.ok(publicationReceiptMatches(i.record, i.identity));
  assert.equal(
    createDestinationAccessStore(
      destinationAccessData,
      placeRegistryData.records,
      () => now,
    ).get(input.record.destinationId)?.gateways.length,
    3,
  );
  assert.deepEqual(
    await createPinnedDestinationContentStore(
      { schemaVersion: 1, records: [input.record] },
      reviewContext(input.identity),
      () => now,
    ).get(input.record.destinationId),
    { status: "none", reason: "not-reviewed" },
  );
});
