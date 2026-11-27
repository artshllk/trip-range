// Historical record/access regression. Live archive exclusion is tested in destination-archive.test.ts.
import assert from "node:assert/strict";
import { test } from "node:test";
import { readFileSync } from "node:fs";
import batch from "../content/operations/batches/phase5i-standard-non-city.json";
import preparation from "../content/operations/preparation/phase5i-standard-non-city.json";
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

const now = Date.parse("2026-10-26T16:00:00Z");
const authorized = [
  [
    "place:Q4648",
    "53aa05cb45798f3d5b380357dbe4a0f3ec7e34b6c3331dc47be3806a8d8c750b",
  ],
  [
    "place:Q40846",
    "87dba068dabbb0dffc60688e5559de94ce0b562ad6eb818d202a4a6b0d341770",
  ],
  [
    "place:Q2656389",
    "2abc43ee34d25fffba3f34d7333632ffb38cec18691d1707bde5db04971f7ac2",
  ],
  [
    "place:Q131347",
    "c7586932690598e993dbed92ac2bbf38c37d0a8b9e11e8db8aea4f1e0e2a20f4",
  ],
  [
    "place:Q76516549",
    "c678b1653d427b83ea3310272621b67b96eee60ce3989d09dc73d2fe6518f92f",
  ],
  [
    "place:Q41858",
    "ec04c764311da74f90926d315aa8db595723de44104a5dd63ca72f27958888b1",
  ],
] as const;

for (const [id, digest] of authorized) {
  test(`${id}: exact authorized revision, human review and receipt persist and serve offline`, async (t) => {
    t.mock.method(globalThis, "fetch", async () =>
      assert.fail("No editorial runtime research"),
    );
    const workspace = loadEditorialWorkspace(undefined, undefined, now);
    const input = workspace.inputs.get(id)!;
    const record = input.record,
      review = workspace.reviews.get(id)!;
    assert.equal(record.contentVersion, id === "place:Q2656389" ? 3 : 2);
    assert.equal(contentDigest(record), digest);
    assert.equal(publicationReceiptMatches(record, input.identity), true);
    assert.equal(review.current.reviewer, "art");
    assert.equal(review.history.length, id === "place:Q2656389" ? 8 : 7);
    assert.deepEqual(
      reviewPins(input),
      preparation.entries.find((e) => e.destinationId === id)!.pins,
    );
    const assessment = assessEditorialReview(input, review);
    assert.equal(assessment.decision, "approved");
    assert.equal(assessment.stale, false);
    assert.equal(assessment.eligible, true);
    assert.deepEqual(assessment.blocking, []);
    assert.deepEqual(assessment.unacknowledged, []);
    assert.deepEqual(
      Object.values(assessment.checks),
      Array(6).fill("approved"),
    );
    assert.deepEqual(
      review.current.warningsAcknowledged.map((a) => a.id),
      id === "place:Q2656389"
        ? ["evidence-review", "presentation:7e2a291f9f24ff36b8f4"]
        : ["evidence-review"],
    );
    assert.match(
      review.current.warningsAcknowledged[0].reason,
      /v[23] .*reviewed and accepted for publication/,
    );
    for (const item of [
      record,
      ...contentItems(record).map(({ item }) => item),
    ]) {
      assert.equal(item.reviewStatus, "reviewed");
      assert.equal(item.reviewedAt, record.publication!.approvedAt);
    }
    for (const { item } of contentItems(record))
      if (item.freshness.kind === "periodically-reviewed")
        assert.equal(item.freshness.reviewBy, "2027-01-10T00:00:00Z");
    const runtime = await approvedDestinationContent.get(id);
    if (runtime.status !== "reviewed")
      assert.fail("Actual reviewed runtime required");
    assert.equal(
      contentItems(runtime.content).length,
      contentItems(record).length,
    );
    assert.deepEqual(runtime.content.attractions, record.attractions);
    assert.deepEqual(runtime.content.overview, record.overview);
    assert.deepEqual(runtime.content.transport, record.transport);
    assert.equal(runtime.content.publication, undefined);
    assert.doesNotMatch(
      JSON.stringify(runtime),
      /"(?:contentDigest|identityDigest|evidenceDigest|warningsAcknowledged|reviewer|history)"\s*:/,
    );
  });

  test(`${id}: changed facts or sources cannot reuse a receipt; draft fixtures stay hidden`, async (t) => {
    t.mock.method(globalThis, "fetch", async () =>
      assert.fail("No tamper repair"),
    );
    const { record, identity } = loadEditorialWorkspace(
      undefined,
      undefined,
      now,
    ).inputs.get(id)!;
    const before = JSON.stringify(record),
      context = reviewContext(identity);
    for (const mutation of [
      "english",
      "albanian",
      "source",
      "order",
      "draft",
    ]) {
      const changed = structuredClone(record);
      if (mutation === "english") changed.overview!.text.en += " Altered fact.";
      if (mutation === "albanian")
        changed.overview!.text.sq += " Fakt i ndryshuar.";
      if (mutation === "source")
        changed.sources[1].title += " Changed evidence";
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
}

test("read-only preparation report never reopens or auto-approves the six persisted standard non-city publications", () => {
  const workspace = loadEditorialWorkspace(undefined, undefined, now);
  const before = new Map(workspace.watched);
  assert.ok(isDestinationPopulationBatch(batch));
  assert.ok(isBatchPreparation(preparation, now));
  const report = reviewDestinationBatch(batch, preparation, workspace, now);
  assert.equal(report.ready, 0); // Already published, no longer pending preparation candidates.
  assert.equal(report.total, 6);
  assert.equal(report.writes, 0);
  assert.equal(report.externalCalls, 0);
  assert.equal(report.editorialApprovals, 0);
  for (const row of report.rows) {
    assert.equal(row.contentStatus, "reviewed");
    assert.equal(row.decision, "approved");
    assert.equal(row.receipt, "present");
    assert.deepEqual(row.blockers, ["not-pending-unpublished-draft"]);
  }
  for (const [file, raw] of before)
    if (raw !== null) assert.equal(readFileSync(file, "utf8"), raw);
});
