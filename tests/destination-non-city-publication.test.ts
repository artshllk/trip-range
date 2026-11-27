// Historical record/access regression. Live archive exclusion is tested in destination-archive.test.ts.
import assert from "node:assert/strict";
import { test } from "node:test";
import { readFileSync } from "node:fs";
import batch from "../content/operations/batches/phase5g-non-city-proofs.json";
import preparation from "../content/operations/preparation/phase5g-non-city-proofs.json";
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
import { destinationAccessData } from "./fixtures/archived-destination-data";
import { placeRegistryData } from "../content/places/records";
import { createDestinationAccessStore } from "../src/travel/runtime/access-store";
import { selectDestinationContent } from "../src/content/presentation";
import { validateDestinationContentData } from "../src/domain/destination-content/validation";

const now = Date.parse("2026-10-26T16:00:00Z");
const authorized = [
  ["crete", "6eda6a3d68c8330d155d530b0c3e0086eed87aee136d6474e3001aff298879cb"],
  [
    "place:Q1490",
    "281b25051b5d223809b908e5a85d753473195e31fa5e1b8b78e008f540a113d2",
  ],
  [
    "place:Q1273",
    "8f7a6fb49f12e107fd70c13fd4871e8f8ff0ef0835d687cb616a00112bae32a4",
  ],
  [
    "place:Q180402",
    "72c14e25b3763591fd966082d909a0d173334b46b173ae65eb533867b0181202",
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
    const revised = id === "place:Q1490";
    assert.equal(record.contentVersion, revised ? 4 : 2);
    assert.equal(contentDigest(record), digest);
    assert.equal(publicationReceiptMatches(record, input.identity), true);
    assert.equal(review.current.reviewer, revised ? "GoEksplo Owner" : "art");
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
      revised
        ? ["evidence-review", "presentation:b5fdcc388f262654c071"]
        : ["evidence-review"],
    );
    assert.match(
      review.current.warningsAcknowledged[0].reason,
      revised
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

test("read-only preparation report never reopens or auto-approves the four persisted non-city publications", () => {
  const workspace = loadEditorialWorkspace(undefined, undefined, now);
  const before = new Map(workspace.watched);
  assert.ok(isDestinationPopulationBatch(batch));
  assert.ok(isBatchPreparation(preparation, now));
  const report = reviewDestinationBatch(batch, preparation, workspace, now);
  assert.equal(report.ready, 0); // Already published, no longer pending preparation candidates.
  assert.equal(report.total, 4);
  assert.equal(report.writes, 0);
  assert.equal(report.externalCalls, 0);
  assert.equal(report.editorialApprovals, 0);
  for (const row of report.rows) {
    assert.equal(row.contentStatus, "reviewed");
    assert.equal(row.decision, "approved");
    assert.equal(row.receipt, "present");
    assert.deepEqual(
      row.blockers,
      row.destinationId === "place:Q1490"
        ? ["preparation-stale", "not-pending-unpublished-draft"]
        : ["not-pending-unpublished-draft"],
    );
  }
  for (const [file, raw] of before)
    if (raw !== null) assert.equal(readFileSync(file, "utf8"), raw);
});

test("an in-memory Kruger draft stays hidden despite reviewed access; existing access is unchanged", async (t) => {
  t.mock.method(globalThis, "fetch", async () =>
    assert.fail("No runtime research"),
  );
  const workspace = loadEditorialWorkspace(undefined, undefined, now);
  const remaining = ["place:Q24451"];
  assert.equal(
    [...workspace.inputs.values()].filter(
      (i) => i.record.reviewStatus === "draft",
    ).length,
    0,
  );
  const accessBefore = JSON.stringify(destinationAccessData);
  const access = createDestinationAccessStore(
    destinationAccessData,
    placeRegistryData.records,
    () => now,
  );
  for (const id of remaining) {
    const input = workspace.inputs.get(id)!;
    const record = structuredClone(input.record);
    for (const item of [
      record,
      ...contentItems(record).map(({ item }) => item),
    ]) {
      item.reviewStatus = "draft";
      item.reviewedAt = null;
    }
    delete record.publication;
    assert.equal(access.get(id)!.directEntries![0].providerCityCode, "SZK");
    assert.deepEqual(
      access.get(id)!.gateways.map((g) => g.airportCode),
      ["MQP", "HDS", "PHW"],
    );
    assert.deepEqual(
      await createPinnedDestinationContentStore(
        { schemaVersion: 1, records: [record] },
        reviewContext(input.identity),
        () => now,
      ).get(id),
      {
        status: "none",
        reason: "not-reviewed",
      },
    );
    assert.equal(
      selectDestinationContent({ status: "reviewed", content: record }, id),
      undefined,
    );
  }
  assert.equal(access.get("crete"), undefined, "Legacy Crete was not migrated");
  assert.deepEqual(
    access.get("place:Q1490")!.directEntries!.map((e) => e.providerCityCode),
    ["TYO"],
  );
  assert.deepEqual(
    access.get("place:Q1273")!.directEntries!.map((e) => e.providerCityCode),
    ["FLR", "PSA"],
  );
  assert.equal(access.get("place:Q180402")!.directEntries, undefined);
  assert.deepEqual(
    access.get("place:Q180402")!.gateways.map((g) => g.airportCode),
    ["FAT"],
  );
  assert.equal(JSON.stringify(destinationAccessData), accessBefore);
});
