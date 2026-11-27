// Historical record/access regression. Live archive exclusion is tested in destination-archive.test.ts.
import { publishedDestinationIds } from "./fixtures/published-destinations";
import assert from "node:assert/strict";
import { test } from "node:test";
import { readFileSync } from "node:fs";
import batch from "../content/operations/batches/phase5c-batch1.json";
import preparation from "../content/operations/preparation/phase5c-batch1.json";
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
    "city:BCN",
    "81303d9603faae3707650453a6a903d0f4d51f1503de323b81d5b0d57000ff6a",
  ],
  [
    "london",
    "9a4661fc37eca579016cc44cd9c50b8cebb6dd66a210d9bf504df2474ea62acf",
  ],
  [
    "place:Q334",
    "cd209fe93a253ea425d5a9bf0f29dbbe54c779d72e4bea7ed59232c8c770109b",
  ],
  [
    "place:Q1861",
    "77e36dd1b2f2e4a8897900327bda24b23479ea478daf1cbca07371e5091f6fee",
  ],
  [
    "place:Q24639",
    "1928424ad50b927eb365e36a4a123f63ee55f69878001a3252a8e1384a6bbf27",
  ],
] as const;

for (const [id, digest] of authorized) {
  test(`${id}: exact authorized current revision, human review and receipt persist and serve offline`, async (t) => {
    t.mock.method(globalThis, "fetch", async () =>
      assert.fail("No editorial runtime research"),
    );
    const workspace = loadEditorialWorkspace(undefined, undefined, now);
    const input = workspace.inputs.get(id)!;
    const record = input.record,
      review = workspace.reviews.get(id)!;
    assert.equal(
      record.contentVersion,
      ["london", "place:Q1861"].includes(id)
        ? 4
        : ["city:BCN", "place:Q334"].includes(id)
          ? 3
          : 2,
    );
    assert.equal(contentDigest(record), digest);
    assert.equal(publicationReceiptMatches(record, input.identity), true);
    assert.equal(
      review.current.reviewer,
      ["london", "city:BCN", "place:Q334", "place:Q1861"].includes(id)
        ? "GoEksplo Owner"
        : "art",
    );
    if (!["london", "city:BCN", "place:Q334", "place:Q1861"].includes(id))
      assert.equal(review.history.length, 7);
    if (!["london", "city:BCN", "place:Q334", "place:Q1861"].includes(id))
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
      Array(
        ["london", "city:BCN", "place:Q334", "place:Q1861"].includes(id)
          ? 5
          : 6,
      ).fill("approved"),
    );
    assert.deepEqual(
      review.current.warningsAcknowledged.map((a) => a.id),
      id === "london"
        ? ["phase2-source-review", "presentation:8023965be1154c073696"]
        : id === "place:Q1861"
          ? ["evidence-review", "presentation:f42aa1b5f04464353e65"]
          : ["evidence-review"],
    );
    assert.match(
      review.current.warningsAcknowledged[0].reason,
      ["london", "city:BCN", "place:Q334", "place:Q1861"].includes(id)
        ? /GoEksplo Owner explicitly approved/
        : /v2 identity.*reviewed and accepted for publication/,
    );
    for (const item of [
      record,
      ...contentItems(record).map(({ item }) => item),
    ]) {
      assert.equal(item.reviewStatus, "reviewed");
      assert.equal(item.reviewedAt, record.publication!.approvedAt);
    }
    for (const { item } of contentItems(record))
      if (
        !["london", "city:BCN", "place:Q334", "place:Q1861"].includes(id) &&
        item.freshness.kind === "periodically-reviewed"
      )
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

test("publication leaves exactly thirty reviewed records and no drafts", async (t) => {
  t.mock.method(globalThis, "fetch", async () =>
    assert.fail("No runtime research"),
  );
  const workspace = loadEditorialWorkspace(undefined, undefined, now);
  assert.deepEqual(
    [...workspace.inputs.values()]
      .filter((i) => i.record.reviewStatus === "reviewed")
      .map((i) => i.record.destinationId)
      .sort(),
    [...publishedDestinationIds].sort(),
  );
  assert.equal(
    [...workspace.inputs.values()].filter(
      (i) => i.record.reviewStatus === "draft",
    ).length,
    0,
  );
  assert.equal(
    (await approvedDestinationContent.get("place:Q24451")).status,
    "reviewed",
  );
});

test("read-only preparation report never reopens or auto-approves the five persisted publications", () => {
  const workspace = loadEditorialWorkspace(undefined, undefined, now);
  const before = new Map(workspace.watched);
  assert.ok(isDestinationPopulationBatch(batch));
  assert.ok(isBatchPreparation(preparation, now));
  const report = reviewDestinationBatch(batch, preparation, workspace, now);
  assert.equal(report.ready, 0); // Already published, no longer pending preparation candidates.
  assert.equal(report.total, 5);
  assert.equal(report.writes, 0);
  assert.equal(report.externalCalls, 0);
  assert.equal(report.editorialApprovals, 0);
  for (const row of report.rows) {
    assert.equal(row.contentStatus, "reviewed");
    assert.equal(row.decision, "approved");
    assert.equal(row.receipt, "present");
    assert.deepEqual(
      row.blockers,
      ["london", "city:BCN", "place:Q334", "place:Q1861"].includes(
        row.destinationId,
      )
        ? ["preparation-stale", "not-pending-unpublished-draft"]
        : ["not-pending-unpublished-draft"],
    );
  }
  for (const [file, raw] of before)
    if (raw !== null) assert.equal(readFileSync(file, "utf8"), raw);
});
