// Historical record/access regression. Live archive exclusion is tested in destination-archive.test.ts.
import assert from "node:assert/strict";
import { test } from "node:test";
import { readFileSync } from "node:fs";
import preparation from "../content/operations/preparation/phase5k-tasmania.json";
import batch from "../content/operations/batches/phase5k-tasmania.json";
import { loadEditorialWorkspace } from "./fixtures/archived-destination-data";
import {
  assessEditorialReview,
  reviewContext,
  reviewPins,
} from "../scripts/lib/editorial-review";
import {
  isBatchPreparation,
  reviewDestinationBatch,
} from "./fixtures/archived-destination-data";
import { isDestinationPopulationBatch } from "../src/content/operator/batch";
import {
  contentDigest,
  contentItems,
  publicationReceiptMatches,
} from "../src/content/integrity";
import { approvedDestinationContent } from "./fixtures/archived-destination-data";
import { createPinnedDestinationContentStore } from "../src/content/runtime/publication";
import { validateDestinationContentData } from "../src/domain/destination-content/validation";

const id = "place:Q3593416";
const now = Date.parse("2026-10-26T16:00:00Z");
const digest =
  "55fbc2ff7f9b2a721600bfb537a3d82265f338a25175bfd0c7a18616c4f15c5f";

test("Tasmania exact authorized v2 publication is persisted, current and visible without operator metadata", async (t) => {
  t.mock.method(globalThis, "fetch", async () =>
    assert.fail("No runtime research"),
  );
  const workspace = loadEditorialWorkspace(undefined, undefined, now);
  const input = workspace.inputs.get(id)!;
  const record = input.record;
  const review = workspace.reviews.get(id)!;
  assert.equal(record.contentVersion, 2);
  assert.equal(contentDigest(record), digest);
  assert.ok(publicationReceiptMatches(record, input.identity));
  assert.deepEqual(reviewPins(input), preparation.entries[0].pins);
  assert.equal(review.current.reviewer, "art");
  assert.equal(review.history.length, 7);
  const assessment = assessEditorialReview(input, review);
  assert.equal(assessment.decision, "approved");
  assert.equal(assessment.stale, false);
  assert.equal(assessment.eligible, true);
  assert.deepEqual(assessment.blocking, []);
  assert.deepEqual(assessment.unacknowledged, []);
  assert.deepEqual(Object.values(assessment.checks), Array(6).fill("approved"));
  assert.deepEqual(
    review.current.warningsAcknowledged.map((a) => a.id),
    ["evidence-review"],
  );
  assert.match(
    review.current.warningsAcknowledged[0].reason,
    /HBA\/LST\/DPO\/BWT/,
  );
  assert.match(
    review.current.warningsAcknowledged[0].reason,
    /Regional journeys remain separate/,
  );
  for (const item of [
    record,
    ...contentItems(record).map(({ item }) => item),
  ]) {
    assert.equal(item.reviewStatus, "reviewed");
    assert.equal(item.reviewedAt, "2026-10-15T11:51:14.135Z");
  }
  const runtime = await approvedDestinationContent.get(id);
  if (runtime.status !== "reviewed")
    assert.fail("Real reviewed runtime required");
  assert.deepEqual(runtime.content.overview, record.overview);
  assert.deepEqual(runtime.content.attractions, record.attractions);
  assert.deepEqual(runtime.content.areas, record.areas);
  assert.deepEqual(runtime.content.transport, record.transport);
  assert.deepEqual(runtime.content.practicalNotes, record.practicalNotes);
  assert.equal(runtime.content.publication, undefined);
  assert.doesNotMatch(
    JSON.stringify(runtime),
    /"(?:contentDigest|identityDigest|evidenceDigest|warningsAcknowledged|reviewer|history)"\s*:/,
  );
});

test("Tasmania old receipt cannot authorize changed facts, sources or order; draft copy stays hidden", async (t) => {
  t.mock.method(globalThis, "fetch", async () =>
    assert.fail("No tamper repair"),
  );
  const { record, identity } = loadEditorialWorkspace(
    undefined,
    undefined,
    now,
  ).inputs.get(id)!;
  const before = JSON.stringify(record);
  const context = reviewContext(identity);
  for (const mutation of ["english", "albanian", "source", "order", "draft"]) {
    const changed = structuredClone(record);
    if (mutation === "english") changed.overview!.text.en += " Altered fact.";
    if (mutation === "albanian")
      changed.overview!.text.sq += " Fakt i ndryshuar.";
    if (mutation === "source") changed.sources[1].title += " Changed evidence";
    if (mutation === "order") changed.attractions!.reverse();
    if (mutation === "draft") {
      for (const item of [
        changed,
        ...contentItems(changed).map(({ item }) => item),
      ]) {
        item.reviewStatus = "draft";
        item.reviewedAt = null;
      }
      delete changed.publication;
    }
    const data = { schemaVersion: 1 as const, records: [changed] };
    assert.equal(
      validateDestinationContentData(data, context).ok,
      true,
      mutation,
    );
    assert.deepEqual(
      await createPinnedDestinationContentStore(data, context, () => now).get(
        id,
      ),
      { status: "none", reason: "not-reviewed" },
      mutation,
    );
  }
  assert.equal(JSON.stringify(record), before);
  assert.equal((await approvedDestinationContent.get(id)).status, "reviewed");
});

test("Tasmania preparation report cannot reopen the published revision or mutate the published Kruger revision", () => {
  const workspace = loadEditorialWorkspace(undefined, undefined, now);
  assert.ok(isDestinationPopulationBatch(batch));
  assert.ok(isBatchPreparation(preparation, now));
  const result = reviewDestinationBatch(batch, preparation, workspace, now);
  assert.equal(result.ready, 0);
  assert.equal(result.total, 1);
  assert.equal(result.writes, 0);
  assert.equal(result.externalCalls, 0);
  assert.equal(result.editorialApprovals, 0);
  assert.equal(result.rows[0].receipt, "present");
  assert.equal(result.rows[0].decision, "approved");
  assert.deepEqual(result.rows[0].blockers, ["not-pending-unpublished-draft"]);
  const kruger = workspace.inputs.get("place:Q24451")!.record;
  assert.equal(kruger.reviewStatus, "reviewed");
  assert.equal(kruger.contentVersion, 2);
  assert.ok(
    publicationReceiptMatches(
      kruger,
      workspace.inputs.get(kruger.destinationId)!.identity,
    ),
  );
  assert.equal(
    workspace.reviews.get(kruger.destinationId)!.current.decision,
    "approved",
  );
  for (const [file, raw] of workspace.watched)
    if (raw !== null) assert.equal(readFileSync(file, "utf8"), raw);
});
