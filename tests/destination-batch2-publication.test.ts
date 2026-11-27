// Historical record/access regression. Live archive exclusion is tested in destination-archive.test.ts.
import assert from "node:assert/strict";
import { test } from "node:test";
import { readFileSync } from "node:fs";
import batch from "../content/operations/batches/phase5e-batch2-cities.json";
import preparation from "../content/operations/preparation/phase5e-batch2-cities.json";
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
import { destinationContentValidationContext } from "./fixtures/archived-destination-data";
import { destinationContentData } from "./fixtures/archived-destination-data";
import { createPinnedDestinationContentStore } from "../src/content/runtime/publication";
import { validateDestinationContentData } from "../src/domain/destination-content/validation";
import { destinationContentDeadlines } from "../scripts/lib/destination-expiry-audit";

const now = Date.parse("2026-10-26T16:00:00Z");
// Historical publication integrity uses one clock for metadata and runtime.
// Live expiry is checked separately below and by the daily operational audit.
const approvedAtReviewTime = createPinnedDestinationContentStore(
  destinationContentData,
  destinationContentValidationContext,
  () => now,
);
const authorized = [
  [
    "prishtina",
    "71d63b216c0917f42fff6002009053dd76a0226364f72582122066b8dda88e4a",
  ],
  [
    "place:Q1489",
    "e0b34a4854d38918864222cd0255c38a48354ce13d9dc15c5bfe6584930e7b1d",
  ],
  [
    "place:Q8678",
    "195561a2abe6f8eb296e6b5858c5207d747986ba7ebffad5a6192ad65889bce2",
  ],
  [
    "place:Q1486",
    "c16750e18795e75445e45d88f394472a4b43e5482c320c1c2057af65a450ef34",
  ],
  [
    "place:Q5465",
    "575e307944cd931442dddac18d907ec0e3fd534cd0b4ecd7b5fa590597d3cf34",
  ],
  [
    "place:Q101625",
    "46d0181933beb42addf5da83e80241c69ec85ca5bb81d8c3945023360918a743",
  ],
  [
    "place:Q612",
    "c625fc45fe2c8b359e7a65d385dc1964fab0017a864684311b515e9697de6fad",
  ],
  [
    "istanbul",
    "38c5b7cba0da08071cec15914efa70554251336666d23a05948d7d67d14e6106",
  ],
  [
    "place:Q3130",
    "6b92a80ff5a503738b27cccfb3c2e5676bbd0d75ccb674ff17b3465c22603e28",
  ],
] as const;

for (const [id, digest] of authorized) {
  test(`${id}: exact authorized current revision, review provenance and receipt persist and serve offline`, async (t) => {
    t.mock.method(globalThis, "fetch", async () =>
      assert.fail("No editorial runtime research"),
    );
    const workspace = loadEditorialWorkspace(undefined, undefined, now);
    const input = workspace.inputs.get(id)!;
    const record = input.record,
      review = workspace.reviews.get(id)!;
    const batch3 = [
      "place:Q5465",
      "place:Q8678",
      "place:Q3130",
      "place:Q612",
    ].includes(id);
    const revised =
      batch3 || ["istanbul", "place:Q1489", "place:Q101625"].includes(id);
    assert.equal(
      record.contentVersion,
      id === "place:Q3130"
        ? 5
        : batch3 || id === "place:Q101625"
          ? 4
          : revised
            ? 3
            : 2,
    );
    assert.equal(contentDigest(record), digest);
    assert.equal(publicationReceiptMatches(record, input.identity), true);
    assert.equal(
      review.current.reviewer,
      id === "place:Q3130"
        ? "Codex - authorized transport refresh"
        : revised
          ? "GoEksplo Owner"
          : "art",
    );
    if (!revised) assert.equal(review.history.length, 7);
    if (!revised)
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
      Array(revised ? 5 : 6).fill("approved"),
    );
    assert.deepEqual(
      review.current.warningsAcknowledged.map((a) => a.id),
      id === "place:Q3130"
        ? ["evidence-review", "presentation:55fc10dd88ad3256c19c"]
        : ["evidence-review"],
    );
    assert.match(
      review.current.warningsAcknowledged[0].reason,
      id === "place:Q3130"
        ? /User-authorized WSI-only source refresh verified by Codex/
        : revised
          ? /GoEksplo Owner explicitly approved/
          : /v2 .*reviewed and accepted for publication/,
    );
    for (const item of [
      record,
      ...contentItems(record).map(({ item }) => item),
    ]) {
      assert.equal(item.reviewStatus, "reviewed");
      assert.equal(item.reviewedAt, record.publication!.approvedAt);
    }
    for (const { item } of contentItems(record))
      if (!revised && item.freshness.kind === "periodically-reviewed")
        assert.equal(item.freshness.reviewBy, "2027-01-10T00:00:00Z");
    const runtime = await approvedAtReviewTime.get(id);
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
    assert.equal((await approvedAtReviewTime.get(id)).status, "reviewed");
  });
}

test("Sydney WSI expiry hides the item and makes editorial re-review due without invalidating approval history", async () => {
  const id = "place:Q3130";
  const itemId = "transport:place:Q3130:expansion01-2";
  const input = loadEditorialWorkspace(undefined, undefined, now).inputs.get(
    id,
  )!;
  const item = input.record.transport!.find((row) => row.id === itemId)!;
  assert.equal(item.freshness.kind, "periodically-reviewed");
  if (item.freshness.kind !== "periodically-reviewed") throw Error();
  const cutoff = Date.parse(item.freshness.reviewBy);
  assert.equal(
    destinationContentDeadlines(input.record).find((row) => row.id === itemId)
      ?.date,
    item.freshness.reviewBy,
  );
  const at = (time: number) =>
    createPinnedDestinationContentStore(
      { schemaVersion: 1, records: [input.record] },
      reviewContext(input.identity),
      () => time,
    ).get(id);
  const before = await at(cutoff - 1),
    after = await at(cutoff);
  assert.equal(before.status, "reviewed");
  assert.equal(after.status, "reviewed");
  if (before.status !== "reviewed" || after.status !== "reviewed")
    throw Error();
  assert.ok(before.content.transport?.some((row) => row.id === itemId));
  assert.ok(!after.content.transport?.some((row) => row.id === itemId));
  const due = loadEditorialWorkspace(undefined, undefined, cutoff);
  const assessment = assessEditorialReview(
    due.inputs.get(id)!,
    due.reviews.get(id),
  );
  assert.equal(assessment.decision, "approved");
  assert.equal(assessment.stale, false);
  assert.equal(assessment.eligible, false);
  assert.ok(assessment.blocking.includes(`overdue:${itemId}`));
  assert.equal(publicationReceiptMatches(input.record, input.identity), true);
});

test("read-only preparation report never reopens or auto-approves the nine persisted publications", () => {
  const workspace = loadEditorialWorkspace(undefined, undefined, now);
  const before = new Map(workspace.watched);
  assert.ok(isDestinationPopulationBatch(batch));
  assert.ok(isBatchPreparation(preparation, now));
  const report = reviewDestinationBatch(batch, preparation, workspace, now);
  assert.equal(report.ready, 0); // Already published, no longer pending preparation candidates.
  assert.equal(report.total, 9);
  assert.equal(report.writes, 0);
  assert.equal(report.externalCalls, 0);
  assert.equal(report.editorialApprovals, 0);
  for (const row of report.rows) {
    assert.equal(row.contentStatus, "reviewed");
    assert.equal(row.decision, "approved");
    assert.equal(row.receipt, "present");
    assert.deepEqual(
      row.blockers,
      [
        "istanbul",
        "place:Q1489",
        "place:Q101625",
        "place:Q5465",
        "place:Q8678",
        "place:Q3130",
        "place:Q612",
      ].includes(row.destinationId)
        ? ["preparation-stale", "not-pending-unpublished-draft"]
        : ["not-pending-unpublished-draft"],
    );
  }
  for (const [file, raw] of before)
    if (raw !== null) assert.equal(readFileSync(file, "utf8"), raw);
});
