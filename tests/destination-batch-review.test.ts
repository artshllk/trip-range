// Historical record/access regression. Live archive exclusion is tested in destination-archive.test.ts.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import batch from "../content/operations/batches/phase5c-batch1.json";
import preparation from "../content/operations/preparation/phase5c-batch1.json";
import { isDestinationPopulationBatch } from "../src/content/operator/batch";
import {
  isBatchPreparation,
  reviewDestinationBatch,
} from "./fixtures/archived-destination-data";
import { parseBatchReviewArguments } from "../scripts/review-destination-batch";
import { loadEditorialWorkspace } from "./fixtures/archived-destination-data";
import { reviewPins } from "../scripts/lib/editorial-review";
import { contentItems } from "../src/content/integrity";
import { createPinnedDestinationContentStore } from "../src/content/runtime/publication";
import { reviewContext } from "../scripts/lib/editorial-review";
const now = Date.parse("2026-10-26T16:00:00Z");
function setup() {
  const p = structuredClone(preparation),
    b = structuredClone(batch),
    w = loadEditorialWorkspace(undefined, undefined, now);
  assert.ok(isDestinationPopulationBatch(b));
  assert.ok(isBatchPreparation(p, now));
  // In-memory preparation fixture: real Phase 5D publications are tested separately.
  for (const entry of b.entries) {
    const input = w.inputs.get(entry.destinationId)!;
    input.record = structuredClone(input.record);
    for (const item of [
      input.record,
      ...contentItems(input.record).map(({ item }) => item),
    ]) {
      item.reviewStatus = "draft";
      item.reviewedAt = null;
    }
    delete input.record.publication;
    w.reviews.delete(entry.destinationId);
    // Re-pin only this in-memory draft to its later owner-approved revision.
    // The persisted v2 preparation stays historical and is tested as stale separately.
    if (
      [
        "london",
        "city:BCN",
        "place:Q334",
        "istanbul",
        "place:Q1489",
        "place:Q1861",
        "place:Q101625",
        "place:Q5465",
        "place:Q8678",
        "place:Q3130",
        "place:Q612",
      ].includes(entry.destinationId)
    )
      p.entries.find((e) => e.destinationId === entry.destinationId)!.pins =
        reviewPins(input);
  }
  return { p, b, w };
}
test("five prepared drafts report readiness without editorial approval, network or source mutation", async (t) => {
  t.mock.method(globalThis, "fetch", async () => {
    throw Error("network forbidden");
  });
  const { p, b, w } = setup();
  const before = new Map([...w.watched].filter(([, raw]) => raw !== null));
  const result = reviewDestinationBatch(b, p, w, now);
  assert.equal(result.ready, 5);
  assert.equal(result.total, 5);
  assert.equal(result.writes, 0);
  assert.equal(result.externalCalls, 0);
  for (const row of result.rows) {
    assert.equal(row.contentStatus, "draft");
    assert.equal(row.decision, "pending");
    assert.equal(row.receipt, "absent");
    assert.deepEqual(
      row.advisories,
      row.destinationId === "london"
        ? ["phase2-source-review", "presentation:8023965be1154c073696"]
        : row.destinationId === "place:Q1861"
          ? ["evidence-review", "presentation:f42aa1b5f04464353e65"]
          : row.destinationId === "place:Q3130"
            ? ["evidence-review", "presentation:55fc10dd88ad3256c19c"]
            : ["evidence-review"],
    );
    assert.ok(Object.values(row.checks).every((v) => v === "pending"));
    assert.equal(
      (
        await createPinnedDestinationContentStore(
          {
            schemaVersion: 1,
            records: [w.inputs.get(row.destinationId)!.record],
          },
          reviewContext(w.inputs.get(row.destinationId)!.identity),
          () => now,
        ).get(row.destinationId)
      ).status,
      "none",
    );
    assert.equal(w.reviews.has(row.destinationId), false);
  }
  for (const [file, raw] of before)
    assert.equal(readFileSync(file, "utf8"), raw);
});
for (const pin of [
  "contentDigest",
  "identityDigest",
  "evidenceDigest",
] as const)
  test(`changed ${pin} invalidates preparation for only that destination`, () => {
    const { p, b, w } = setup();
    p.entries[0].pins[pin] = "0".repeat(64);
    const r = reviewDestinationBatch(b, p, w, now);
    assert.equal(r.ready, 4);
    assert.ok(r.rows[0].blockers.includes("preparation-stale"));
  });
test("missing preparation cannot infer copy readiness from syntactic validation", () => {
  const { b, w } = setup();
  const r = reviewDestinationBatch(b, undefined, w, now);
  assert.equal(r.ready, 0);
  assert.ok(
    r.rows.every((x) => x.blockers.includes("preparation-not-recorded")),
  );
});
test("incomplete English, source and selection preparation are independent gates", () => {
  for (const check of [
    "sources",
    "englishCopy",
    "selectionAndOrder",
  ] as const) {
    const { p, b, w } = setup();
    p.entries[2].prepared[check] = false;
    const r = reviewDestinationBatch(b, p, w, now);
    assert.equal(r.ready, 4);
    assert.ok(r.rows[2].blockers.includes(`preparation-incomplete:${check}`));
  }
});
test("unresolved travel or expired metadata preserves editorial readiness but not full readiness", () => {
  for (const mode of ["blocked", "expired", "wrong-airport"]) {
    const { p, b, w } = setup();
    if (mode === "blocked") p.entries[3].travel.kind = "blocked";
    if (mode === "expired")
      p.entries[3].travel.reviewAfter = "2026-10-14T00:00:00Z";
    if (mode === "wrong-airport") p.entries[3].travel.airports = ["XXX"];
    const r = reviewDestinationBatch(b, p, w, now);
    assert.equal(r.ready, 4);
    assert.equal(
      r.rows[3].readiness,
      "EDITORIAL READY / TRAVEL IDENTITY BLOCKED",
    );
  }
});
test("expired content remains a blocker even with a newly pinned preparation record", () => {
  const { p, b, w } = setup();
  const input = w.inputs.get("london")!;
  input.record = structuredClone(input.record);
  input.record.transport![0].freshness = {
    kind: "periodically-reviewed",
    reviewBy: "2026-10-14T00:00:00Z",
  };
  p.entries[1].pins = reviewPins(input);
  const r = reviewDestinationBatch(b, p, w, now);
  assert.equal(r.ready, 4);
  assert.ok(r.rows[1].blockers.some((x) => x.startsWith("overdue:")));
});
test("invalid pins, future observations, extra approval fields and duplicate records fail closed", () => {
  const entry = preparation.entries[0];
  for (const invalid of [
    { ...entry, prepared: { ...entry.prepared, englishCopy: "approved" } },
    { ...entry, reviewer: "art" },
    { ...entry, pins: { ...entry.pins, contentDigest: "invalid" } },
    {
      ...entry,
      travel: { ...entry.travel, checkedAt: "2030-01-01T00:00:00Z" },
    },
  ]) {
    const p = {
      ...preparation,
      entries: [invalid, ...preparation.entries.slice(1)],
    };
    assert.equal(isBatchPreparation(p, now), false);
  }
  assert.equal(
    isBatchPreparation(
      { ...preparation, entries: [...preparation.entries, entry] },
      now,
    ),
    false,
  );
});
test("batch CLI refuses mutation flags, traversal, unexpected and duplicate arguments", () => {
  for (const args of [
    ["--batch", "../phase5c"],
    ["--batch", "phase5c-batch1", "--apply"],
    ["--apply-all", "phase5c-batch1"],
    ["--batch", "phase5c-batch1", "--batch", "phase5c-batch1"],
  ])
    assert.throws(() => parseBatchReviewArguments(args));
  assert.equal(
    parseBatchReviewArguments(["--batch", "phase5c-batch1"]),
    "phase5c-batch1",
  );
});

// In-memory preparation fixtures preserve the pre-publication checks; real publications have separate tests.
import batch2 from "../content/operations/batches/phase5e-batch2-cities.json";
import preparation2 from "../content/operations/preparation/phase5e-batch2-cities.json";
function setupBatch2() {
  const p = structuredClone(preparation2),
    b = structuredClone(batch2),
    w = loadEditorialWorkspace(undefined, undefined, now);
  assert.ok(isDestinationPopulationBatch(b));
  assert.ok(isBatchPreparation(p, now));
  // Reset only cloned in-memory records, never source-controlled publications.
  for (const entry of b.entries) {
    const input = w.inputs.get(entry.destinationId)!;
    input.record = structuredClone(input.record);
    for (const item of [
      input.record,
      ...contentItems(input.record).map(({ item }) => item),
    ]) {
      item.reviewStatus = "draft";
      item.reviewedAt = null;
    }
    delete input.record.publication;
    w.reviews.delete(entry.destinationId);
    // Re-pin only this in-memory draft to its later owner-approved revision.
    // The persisted v2 preparation stays historical and is tested as stale separately.
    if (
      [
        "london",
        "city:BCN",
        "place:Q334",
        "istanbul",
        "place:Q1489",
        "place:Q1861",
        "place:Q101625",
        "place:Q5465",
        "place:Q8678",
        "place:Q3130",
        "place:Q612",
      ].includes(entry.destinationId)
    )
      p.entries.find((e) => e.destinationId === entry.destinationId)!.pins =
        reviewPins(input);
  }
  return { p, b, w };
}
test("Batch 2 preparation fixture has exactly nine pinned pending drafts, with read-only preparation and no publication", async (t) => {
  t.mock.method(globalThis, "fetch", async () => {
    throw Error("network forbidden");
  });
  const { p, b, w } = setupBatch2();
  assert.deepEqual(
    b.entries.map((e) => e.destinationId),
    [
      "prishtina",
      "place:Q1489",
      "place:Q8678",
      "place:Q1486",
      "place:Q5465",
      "place:Q101625",
      "place:Q612",
      "istanbul",
      "place:Q3130",
    ],
  );
  const r = reviewDestinationBatch(b, p, w, now);
  assert.equal(r.ready, 9);
  assert.equal(r.total, 9);
  assert.equal(r.writes, 0);
  assert.equal(r.externalCalls, 0);
  assert.equal(r.editorialApprovals, 0);
  for (const row of r.rows) {
    assert.equal(row.contentStatus, "draft");
    assert.equal(row.decision, "pending");
    assert.equal(row.receipt, "absent");
    assert.deepEqual(row.blockers, []);
    assert.deepEqual(
      row.advisories,
      row.destinationId === "london"
        ? ["phase2-source-review", "presentation:8023965be1154c073696"]
        : row.destinationId === "place:Q1861"
          ? ["evidence-review", "presentation:f42aa1b5f04464353e65"]
          : row.destinationId === "place:Q3130"
            ? ["evidence-review", "presentation:55fc10dd88ad3256c19c"]
            : ["evidence-review"],
    );
    assert.ok(Object.values(row.checks).every((v) => v === "pending"));
    assert.equal(w.reviews.has(row.destinationId), false);
    const input = w.inputs.get(row.destinationId)!;
    assert.equal(
      (
        await createPinnedDestinationContentStore(
          { schemaVersion: 1, records: [input.record] },
          reviewContext(input.identity),
          () => now,
        ).get(row.destinationId)
      ).status,
      "none",
    );
  }
  for (const [file, raw] of w.watched)
    if (raw !== null) assert.equal(readFileSync(file, "utf8"), raw);
});
for (const id of ["prishtina", "istanbul"]) {
  test(`${id}: airport-equals-city legacy aliases validate without another direct-city record`, () => {
    const { p, b, w } = setupBatch2();
    const r = reviewDestinationBatch(b, p, w, now).rows.find(
      (x) => x.destinationId === id,
    )!;
    assert.equal(r.travelIdentity, "legacy-catalogue");
    assert.equal(r.readiness, "READY FOR HUMAN REVIEW");
    for (const airports of [
      ["XXX"],
      id === "istanbul" ? ["IST"] : ["PRN", "XXX"],
    ]) {
      const wrong = structuredClone(p);
      wrong.entries.find((e) => e.destinationId === id)!.travel.airports =
        airports;
      const row = reviewDestinationBatch(b, wrong, w, now).rows.find(
        (x) => x.destinationId === id,
      )!;
      assert.equal(row.readiness, "EDITORIAL READY / TRAVEL IDENTITY BLOCKED");
    }
  });
}
