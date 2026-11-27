// Historical record/access regression. Live archive exclusion is tested in destination-archive.test.ts.
import { approvedMediaSubjects } from "./fixtures/approved-media";
import { publishedDestinationIds } from "./fixtures/published-destinations";
import assert from "node:assert/strict";
import { test } from "node:test";
import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import batch from "../content/operations/batches/phase3f-worldwide.json";
import { destinationQueueData } from "../content/operations/queue/records";
import { destinationResearchData } from "../content/research/destinations/records";
import { destinationContentData } from "./fixtures/archived-destination-data";
import { placeRegistryData } from "../content/places/records";
import {
  isDestinationPopulationBatch,
  validatePopulationBatchAssociations,
} from "../src/content/operator/batch";
import {
  validateQueueData,
  validateResearchData,
} from "../src/content/operator/operations";
import { loadContentOperations } from "./fixtures/archived-destination-data";
import {
  destinationCoverage,
  destinationCoverageSummary,
} from "../scripts/lib/destination-coverage";
import {
  readCoverageBatch,
  runCoverageCommand,
} from "../scripts/coverage-destinations";
import { approvedDestinationContent } from "./fixtures/archived-destination-data";
import { approvedPlaceMedia } from "../src/media/runtime/approved";
import { selectDestinationContent } from "../src/content/presentation";
import { buildDestinationContentReview } from "../scripts/lib/destination-content-review";

const pilotIds = new Set([
  "city:BCN",
  "crete",
  "prishtina",
  "vienna",
  "london",
  "place:Q1490",
  "place:Q34600",
  "place:Q1861",
  "place:Q101625",
  "place:Q5465",
  "place:Q8678",
  "place:Q3130",
  "place:Q612",
]);

test("bounded operational batch validates identity/queue associations and worldwide distribution", () => {
  assert.ok(isDestinationPopulationBatch(batch));
  assert.deepEqual(
    validatePopulationBatchAssociations(
      batch,
      destinationQueueData.records,
      placeRegistryData.records,
    ),
    [],
  );
  assert.equal(batch.entries.length, 30);
  assert.equal(new Set(batch.entries.map((entry) => entry.region)).size, 7);
  assert.deepEqual(
    [...new Set(batch.entries.map((entry) => entry.placeKind))].sort(),
    ["city", "island", "nature-area", "region"],
  );
  for (const group of new Set(batch.entries.map((entry) => entry.group)))
    assert.ok(
      batch.entries.filter((entry) => entry.group === group).length <= 5,
    );
  assert.deepEqual(
    readCoverageBatch("content/operations/batches/phase3f-worldwide.json"),
    batch.entries.map((entry) => entry.destinationId),
  );
  for (const bad of [
    { ...batch, publish: true },
    { ...batch, entries: [] },
    { ...batch, entries: [...batch.entries, batch.entries[0]] },
    { ...batch, entries: [{ ...batch.entries[0], destinationId: "../bad" }] },
    { ...batch, entries: [{ ...batch.entries[0], region: "<script>" }] },
    { ...batch, entries: [{ ...batch.entries[0], placeKind: "airport" }] },
    {
      ...batch,
      entries: Array.from({ length: 101 }, (_, i) => ({
        ...batch.entries[0],
        destinationId: `new:${i}`,
      })),
    },
  ])
    assert.equal(isDestinationPopulationBatch(bad), false);
  assert.ok(
    validatePopulationBatchAssociations(batch, [], placeRegistryData.records)
      .length,
  );
  assert.ok(
    validatePopulationBatchAssociations(
      { ...batch, entries: [{ ...batch.entries[0], placeKind: "island" }] },
      destinationQueueData.records,
      placeRegistryData.records,
    ).length,
  );
});

test("blocked candidate retains evidence without inventing a registered identity or available research", () => {
  const candidate = destinationQueueData.records.find(
    (entry) => entry.identityState === "unresolved-candidate",
  )!;
  const record = destinationResearchData.records.find(
    (entry) => entry.destinationId === candidate.destinationId,
  )!;
  assert.equal(candidate.status, "blocked");
  assert.equal(record.failureCategory, "model-limitation");
  assert.equal(
    placeRegistryData.records.some(
      (place) => place.subject === candidate.destinationId,
    ),
    false,
  );
  assert.equal(
    destinationContentData.records.some(
      (content) => content.destinationId === candidate.destinationId,
    ),
    false,
  );
  assert.deepEqual(
    validateResearchData(
      { schemaVersion: 1, records: [record] },
      [],
      [candidate],
    ),
    [],
  );
  assert.ok(
    validateResearchData({ schemaVersion: 1, records: [record] }, []).length,
  );
  assert.ok(
    validateResearchData(
      { schemaVersion: 1, records: [{ ...record, status: "available" }] },
      [],
      [candidate],
    ).length,
  );
  assert.ok(
    validateResearchData(
      {
        schemaVersion: 1,
        records: [{ ...record, failureCategory: "made-up" }],
      },
      [],
      [candidate],
    ).length,
  );
  assert.ok(
    validateQueueData(
      { schemaVersion: 1, records: [{ ...candidate, status: "done" }] },
      [],
    ).length,
  );
  assert.ok(
    validateQueueData({ schemaVersion: 1, records: [candidate, candidate] }, [])
      .length,
  );
});

test("coverage is resumable and counts queue completion separately from human review", async (t) => {
  t.mock.method(globalThis, "fetch", async () => {
    throw Error("Offline operations only");
  });
  t.mock.method(console, "log", () => {});
  const operations = loadContentOperations(),
    before = JSON.stringify(operations);
  const ids = batch.entries.map((entry) => entry.destinationId);
  const summary = destinationCoverageSummary({ ...operations, ids });
  assert.equal(summary.totalQueued, 30);
  assert.equal(summary.identityReady, 29);
  assert.equal(summary.evidenceReady, 29);
  assert.equal(summary.draftReady, 0);
  assert.equal(summary.reviewPending, 0);
  assert.equal(summary.reviewed, 29);
  assert.equal(summary.blocked, 1);
  assert.equal(summary.failures["model-limitation"], 1);
  // The live command must refuse a historical batch containing archived entries.
  await assert.rejects(
    runCoverageCommand([
      "--file",
      "content/operations/batches/phase3f-worldwide.json",
      "--limit",
      "5",
      "--offset",
      "0",
    ]),
    /batch-association/,
  );
  const candidate = operations.queue.find(
    (entry) => entry.status === "blocked",
  )!;
  const report = await destinationCoverage({
    ...operations,
    destinationId: candidate.destinationId,
    evidence: operations.evidence.get(candidate.destinationId)!,
    filesValid: true,
    seo: [],
  });
  assert.equal(report.lifecycle, "blocked");
  assert.equal(report.publication, "not-approved");
  assert.equal(JSON.stringify(operations), before);
});

test("worldwide identities and evidence remain valid; only the thirty explicitly approved destinations can reach runtime", async (t) => {
  let requests = 0;
  t.mock.method(globalThis, "fetch", async () => {
    requests++;
    throw Error("No runtime research");
  });
  const operations = loadContentOperations();
  for (const record of destinationContentData.records) {
    const identity = placeRegistryData.records.find(
      (place) => place.subject === record.destinationId,
    )!;
    assert.ok(
      identity.coordinates && identity.external?.authority === "wikidata",
    );
    assert.equal(identity.confidence, "high");
    assert.equal(operations.evidence.get(record.destinationId), "available");
    const research = destinationResearchData.records.find(
      (entry) => entry.destinationId === record.destinationId,
    )!;
    if (!pilotIds.has(record.destinationId))
      assert.equal(research.sourceCount, record.sources.length);
    for (const item of [
      record,
      record.overview!,
      ...(record.highlights ?? []),
      ...(record.attractions ?? []),
      ...(record.areas ?? []),
      ...(record.transport ?? []),
      ...(record.practicalNotes ?? []),
      ...(record.dayTemplates ?? []),
    ]) {
      assert.equal(
        item.reviewStatus,
        publishedDestinationIds.includes(record.destinationId)
          ? "reviewed"
          : "draft",
      );
      assert.equal(
        item.reviewedAt,
        publishedDestinationIds.includes(record.destinationId)
          ? record.publication!.approvedAt
          : null,
      );
      assert.ok(item.sourceIds.length);
      assert.ok(
        item.sourceIds.every((id) =>
          record.sources.some((source) => source.id === id),
        ),
      );
    }
    if (!pilotIds.has(record.destinationId)) {
      for (const attraction of record.attractions ?? []) {
        assert.ok(attraction.shortDescription.en);
        // Names may have a natural localized form (e.g. Kulla Eiffel).
        assert.ok(attraction.name.en);
        if (
          !["istanbul", "place:Q334", "place:Q1489"].includes(
            record.destinationId,
          )
        ) {
          assert.ok(attraction.shortDescription.sq);
          assert.ok(attraction.name.sq);
        }
        assert.equal(attraction.media, undefined);
      }
      assert.equal(
        record.sources.some((source) => source.type === "openstreetmap"),
        false,
      );
      const review = buildDestinationContentReview(
        destinationContentData,
        operations.context,
        record.destinationId,
      );
      assert.deepEqual(
        review.warnings.filter((warning) =>
          /too long for the default presentation|only the first/.test(warning),
        ),
        record.destinationId === "place:Q2656389"
          ? [
              "Attraction description attraction:place:Q2656389:aapravasi (sq) too long for the default presentation: 206/180 characters. Full copy is retained behind a disclosure; consider concise editing.",
            ]
          : [],
        `${record.destinationId}: exact presentation warnings only`,
      );
    }
    const runtime = await approvedDestinationContent.get(record.destinationId);
    if (publishedDestinationIds.includes(record.destinationId)) {
      assert.equal(runtime.status, "reviewed");
      assert.ok(selectDestinationContent(runtime, record.destinationId));
    } else {
      assert.equal(record.publication, undefined);
      assert.deepEqual(runtime, { status: "none", reason: "not-reviewed" });
      assert.equal(
        selectDestinationContent(
          { status: "reviewed", content: record },
          record.destinationId,
        ),
        undefined,
        "A forged envelope must not publish an unapproved draft",
      );
    }
    assert.equal(
      (await approvedPlaceMedia.get(record.destinationId, "destination.hero"))
        .status,
      (approvedMediaSubjects as readonly string[]).includes(
        record.destinationId,
      )
        ? "approved"
        : "none",
    );
  }
  assert.equal(requests, 0);
});

test("historical pilot identities/content and independent SEO approvals stay unchanged", () => {
  const baseline = {
    "content/parked/launch-2026-11-02/destinations/crete.json":
      // Phase 5H lifecycle-only publication; exact editorial digest is tested separately.
      "4b3226ca48f93f24185ce409cd346a2889f96d70d6b3be11ac726af96d810ac3",
    "content/destinations/prishtina.json":
      // Phase 5F lifecycle-only publication; exact editorial digest is tested separately.
      "b23f4866a3a271a3d2632cd7aa214e1804b67fd104faca91fcb5b96cfe7a8988",
    "content/places/city-BCN.json":
      "7efd0db8ec11119a246d83232686a6da6c09d5346c1931fc2b4e666819345548",
    "content/places/crete.json":
      "6d3460b4a3a86ddaf2ca8cc2e7a3d5b1c1a1b838a5221bd6a42a9e53c8dc5936",
    "content/places/prishtina.json":
      "1bde1d53fd53ded123f2d4b271e6cae895dc97a45dc603764f0ef3805aa68487",
    // Owner approval, 16 November 2026: Tirana is the only launch hub.
    "src/seo/approved-keys.ts":
      "f0ad3a72f5aa560817f2c8d45c808d8905bd247d76e4abef8ac043a3e92edb57",
  };
  for (const [file, expected] of Object.entries(baseline))
    assert.equal(
      createHash("sha256").update(readFileSync(file)).digest("hex"),
      expected,
      file,
    );
});
