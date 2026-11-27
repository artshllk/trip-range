import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";
import manifest from "./fixtures/editorial-baseline-2026-11-02/manifest.json";
import {
  historicalEditorialRoot,
  loadEditorialWorkspace as historicalWorkspace,
  approvedDestinationContent as historicalContent,
} from "./fixtures/archived-destination-data";
import { currentEditorialNow } from "./fixtures/current-editorial-data";
import { loadEditorialWorkspace } from "../scripts/lib/editorial-workspace";
import { loadContentOperations } from "../scripts/lib/content-operations";
import { checkDestinationReviews } from "../scripts/check-destination-reviews";
import {
  contentItems,
  contentDigest,
  digest,
  publicationReceiptMatches,
} from "../src/content/integrity";
import {
  isEditorialReview,
  editorialChecks,
} from "../src/content/operator/editorial";
import { createPinnedDestinationContentStore } from "../src/content/runtime/publication";
import {
  newReview,
  reviewContext,
  reviewPins,
  assessEditorialReview,
} from "../scripts/lib/editorial-review";
import {
  contentTestIdentity,
  destinationContentFixture,
} from "./fixtures/destination-content";

test("historical editorial data and evidence are immutable, separately pinned test fixtures", () => {
  for (const { file, sha256 } of manifest.files)
    assert.equal(
      createHash("sha256")
        .update(readFileSync(join(historicalEditorialRoot, file)))
        .digest("hex"),
      sha256,
      file,
    );
  assert.equal(historicalWorkspace().inputs.size, manifest.records);
});

for (const wallClock of ["2000-01-01T00:00:00Z", "2100-01-01T00:00:00Z"]) {
  test(`historical approvals ignore the host clock at ${wallClock}`, async (t) => {
    t.mock.timers.enable({ apis: ["Date"], now: Date.parse(wallClock) });
    const workspace = historicalWorkspace();
    assert.equal((await checkDestinationReviews(workspace)).status, "passed");
    for (const id of workspace.inputs.keys())
      assert.equal((await historicalContent.get(id)).status, "reviewed", id);
  });

  test(`current approvals and expiry boundaries ignore the host clock at ${wallClock}`, async (t) => {
    t.mock.timers.enable({ apis: ["Date"], now: Date.parse(wallClock) });
    const operations = loadContentOperations();
    const workspace = loadEditorialWorkspace(
      undefined,
      operations,
      currentEditorialNow(),
    );
    assert.equal((await checkDestinationReviews(workspace)).status, "passed");
    for (const [id, input] of workspace.inputs) {
      const { record, identity } = input;
      if (record.reviewStatus !== "reviewed") continue;
      const review = workspace.reviews.get(id)!;
      const at = Date.parse(record.publication!.approvedAt);
      const actionAt = Date.parse(review.current.updatedAt);
      assert.equal(isEditorialReview(review, actionAt), true, id);
      assert.equal(
        isEditorialReview(review, actionAt - 1),
        false,
        `${id}: future reviews still fail`,
      );
      for (const [key, value] of Object.entries(reviewPins(input)))
        assert.equal(
          review.current[key as keyof typeof review.current],
          value,
          `${id}: ${key}`,
        );
      assert.equal(publicationReceiptMatches(record, identity), true, id);
      const storeAt = (clock: number) =>
        createPinnedDestinationContentStore(
          { schemaVersion: 1, records: [record] },
          reviewContext(identity),
          () => clock,
        ).get(id);
      assert.deepEqual(
        await storeAt(at - 1),
        { status: "none", reason: "not-reviewed" },
        id,
      );
      const published = await storeAt(at);
      assert.equal(published.status, "reviewed", id);
      if (published.status !== "reviewed")
        throw Error("Expected approved content");
      assert.deepEqual(
        contentItems(published.content).map((r) => r.id),
        contentItems(record).map((r) => r.id),
        id,
      );
      for (const { id: itemId, item } of contentItems(record)) {
        if (item.freshness.kind === "stable") continue;
        const cutoff = Date.parse(
          item.freshness.kind === "volatile"
            ? item.freshness.validUntil
            : item.freshness.reviewBy,
        );
        // Templates can legitimately disappear earlier when a linked attraction
        // expires; their dependency behaviour has its own synthetic tests.
        if (!record.dayTemplates?.some((d) => d.id === itemId)) {
          const before = await storeAt(cutoff - 1);
          assert.ok(
            before.status === "reviewed" &&
              contentItems(before.content).some((r) => r.id === itemId),
            `${id}/${itemId} before expiry`,
          );
        }
        const expired = await storeAt(cutoff);
        assert.ok(
          expired.status === "none" ||
            !contentItems(expired.content).some((r) => r.id === itemId),
          `${id}/${itemId} at expiry`,
        );
      }
    }
    // Natural expiry remains maintenance, never corruption of an owner approval.
    const afterExpiry = loadEditorialWorkspace(
      undefined,
      operations,
      Date.parse("2100-01-01T00:00:00Z"),
    );
    assert.equal((await checkDestinationReviews(afterExpiry)).status, "passed");
  });
}

test("a later quarterly approval needs new pins and moves only its own publication/expiry boundaries", async () => {
  const firstAt = Date.parse("2027-02-04T12:00:00Z");
  const quarter = 90 * 24 * 60 * 60 * 1000;
  const original = destinationContentFixture().records[0];
  const context = reviewContext(contentTestIdentity);
  let previous: typeof original | undefined;
  for (let round = 0; round < 3; round++) {
    const at = firstAt + round * quarter;
    const observedAt = new Date(at).toISOString();
    const deadline = new Date(at + 14 * 24 * 60 * 60 * 1000).toISOString();
    const record = structuredClone(original);
    record.contentVersion += round;
    record.overview!.text.en += ` Synthetic round ${round}.`;
    for (const source of record.sources)
      if (source.observedAt)
        source.observedAt = source.retrievedAt = observedAt;
    for (const { item } of contentItems(record)) {
      if (item.freshness.kind === "volatile")
        item.freshness = { kind: "volatile", observedAt, validUntil: deadline };
      if (item.freshness.kind === "periodically-reviewed")
        item.freshness.reviewBy = deadline;
      if ("observedPrice" in item && item.observedPrice)
        (item.observedPrice as { observedAt: string }).observedAt = observedAt;
    }
    for (const item of [record, ...contentItems(record).map((r) => r.item)]) {
      item.reviewedAt = observedAt;
      item.reviewStatus = "reviewed";
    }
    const input = {
      record,
      identity: contentTestIdentity,
      evidence: "available" as const,
      evidenceText: "Synthetic public evidence only.",
      findings: [],
      now: at,
    };
    const review = newReview(input, "synthetic-quarterly-editor");
    for (const key of editorialChecks) review.current.checks[key] = "approved";
    review.current.decision = "approved";
    review.current.reviewedAt = observedAt;
    review.current.warningsAcknowledged = assessEditorialReview(
      input,
    ).advisory.map((w) => ({ id: w.id, reason: "Synthetic review" }));
    assert.equal(assessEditorialReview(input, review).eligible, true);
    const get = (value: typeof record, now: number) =>
      createPinnedDestinationContentStore(
        { schemaVersion: 1, records: [value] },
        context,
        () => now,
      ).get(record.destinationId);
    if (previous) {
      record.publication = previous.publication;
      assert.deepEqual(await get(record, at), {
        status: "none",
        reason: "not-reviewed",
      });
    }
    record.publication = {
      contentDigest: contentDigest(record),
      identityDigest: digest(contentTestIdentity),
      approvedAt: observedAt,
    };
    assert.deepEqual(await get(record, at - 1), {
      status: "none",
      reason: "not-reviewed",
    });
    const current = await get(record, at);
    assert.ok(
      current.status === "reviewed" &&
        current.content.practicalNotes!.length === 1,
    );
    const expired = await get(record, Date.parse(deadline));
    assert.ok(
      expired.status === "reviewed" &&
        expired.content.practicalNotes!.length === 0,
    );
    previous = record;
  }
});
