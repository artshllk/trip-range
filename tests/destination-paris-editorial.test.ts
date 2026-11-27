import assert from "node:assert/strict";
import { test } from "node:test";
import { loadEditorialWorkspace } from "./fixtures/archived-destination-data";
import { assessEditorialReview } from "../scripts/lib/editorial-review";
import { loadContentOperations } from "./fixtures/archived-destination-data";
import {
  contentDigest,
  contentItems,
  publicationReceiptMatches,
} from "../src/content/integrity";
import { approvedDestinationContent } from "./fixtures/archived-destination-data";
import { createPinnedDestinationContentStore } from "../src/content/runtime/publication";
import { validateDestinationContentData } from "../src/domain/destination-content/validation";

function parisWorkspace() {
  return loadEditorialWorkspace(
    process.cwd(),
    loadContentOperations(),
    // Fixed clock after the owner-approved Phase 4B integration, before note expiry.
    Date.parse("2026-10-26T16:00:00Z"),
  );
}

test("Paris palace and cathedral descriptions cite specific official evidence; booking stays periodic", () => {
  const { record, research } = parisWorkspace().inputs.get("paris")!;
  const sourceFor = (id: string) => record.sources.find((s) => s.id === id)!;
  const louvre = record.attractions!.find((a) => a.id.endsWith(":louvre"))!;
  assert.deepEqual(louvre.sourceIds, ["source:worldwide:paris:louvre-history"]);
  assert.equal(
    sourceFor(louvre.sourceIds[0]).url,
    "https://presse.louvre.fr/le-musee-du-louvre-en-bref-1063000220316/?lang=en",
  );
  const cathedral = record.attractions!.find((a) =>
    a.id.endsWith(":notre-dame"),
  )!;
  assert.deepEqual(cathedral.sourceIds, ["source:worldwide:paris:notre-dame"]);
  assert.equal(
    sourceFor(cathedral.sourceIds[0]).url,
    "https://www.notredamedeparis.fr/en/visit/practical-information/access/",
  );
  const note = record.practicalNotes![0];
  assert.deepEqual(note.sourceIds, ["source:worldwide:paris:louvre"]);
  assert.equal(
    sourceFor(note.sourceIds[0]).url,
    "https://www.louvre.fr/en/visit",
  );
  assert.equal(note.freshness.kind, "periodically-reviewed");
  assert.match(note.text.en, /Time-slot booking is recommended/);
  assert.match(note.text.sq, /Rekomandohet rezervimi i një orari/);
  assert.equal(research!.sourceCount, record.sources.length);
  assert.equal(
    new Set(record.sources.map((s) => s.url)).size,
    record.sources.length,
  );
});

test("Paris SQ uses natural Eiffel forms without expanding the selection or adding an itinerary", () => {
  const { record } = parisWorkspace().inputs.get("paris")!;
  assert.deepEqual(
    record.attractions!.map((a) => a.id),
    [
      "attraction:paris:eiffel-tower",
      "attraction:paris:louvre",
      "attraction:paris:notre-dame",
      "attraction:paris:montmartre",
    ],
  );
  assert.deepEqual(
    record.attractions!.map((a) => a.name.sq),
    ["Kulla Eiffel", "Musée du Louvre", "Notre-Dame de Paris", "Montmartre"],
  );
  assert.deepEqual(
    record.areas!.map((area) => area.id),
    ["area:paris:montmartre"],
  );
  assert.match(record.areas![0].tradeoffs[0].sq, /Kullën Eiffel/);
  assert.match(record.transport![0].title.sq, /Kullën Eiffel/);
  assert.match(record.transport![0].guidance.sq, /Kullës Eiffel/);
  const sq: string[] = [];
  JSON.stringify(record, (key, value) => {
    if (key === "sq" && typeof value === "string") sq.push(value);
    return value;
  });
  assert.ok(sq.length > 10);
  assert.ok(sq.every((text) => !text.includes("Eiffel Tower")));
  assert.deepEqual(record.dayTemplates, []);
});

test("Paris v3 publication pins owner-approved English changes while retaining the v2 review", async (t) => {
  t.mock.method(globalThis, "fetch", async () => {
    assert.fail("Editorial and production content reads stay offline");
  });
  const workspace = parisWorkspace();
  const input = workspace.inputs.get("paris")!;
  const { record } = input;
  assert.equal(record.contentVersion, 3);
  const review = workspace.reviews.get("paris")!;
  assert.equal(review.current.reviewer, "GoEksplo Owner");
  assert.equal(
    contentDigest(record),
    "5a968651f22920054786a53ac1083bd98a002f2b74bf8c61f784b6c3138a4e9b",
  );
  assert.equal(publicationReceiptMatches(record, input.identity), true);
  for (const item of [
    record,
    ...contentItems(record).map(({ item }) => item),
  ]) {
    assert.equal(item.reviewStatus, "reviewed");
    assert.equal(item.reviewedAt, record.publication!.approvedAt);
  }
  const assessment = assessEditorialReview(input, review);
  assert.equal(assessment.contentDigest, contentDigest(record));
  assert.deepEqual(assessment.blocking, []);
  assert.deepEqual(assessment.checks, {
    identity: "approved",
    sources: "approved",
    englishCopy: "approved",
    selectionAndOrder: "approved",
    freshness: "approved",
  });
  assert.equal(assessment.decision, "approved");
  assert.equal(assessment.eligible, true);
  assert.equal(assessment.publicationPinned, true);
  assert.equal(assessment.stale, false);
  assert.ok(
    review.history.some(
      ({ review: previous }) =>
        previous.contentVersion === 2 &&
        previous.contentDigest ===
          "06630ba7dfa8b915e5ce54288b979dd6fb67325ba110fc23d171646901471c09" &&
        previous.decision === "approved" &&
        previous.reviewer === "art" &&
        previous.checks.albanianCopy === "approved",
    ),
    "The historical bilingual approval remains in history, not in new English checks",
  );
  assert.deepEqual(assessment.unacknowledged, []);
  assert.deepEqual(
    review.current.warningsAcknowledged.map((a) => a.id),
    ["evidence-review"],
  );
  assert.match(
    review.current.warningsAcknowledged[0].reason,
    /Notre-Dame direct-fetch limitation/,
  );
  assert.match(assessment.advisory[0].message, /indexed page text.*403/);
  const runtime = await approvedDestinationContent.get("paris");
  assert.equal(runtime.status, "reviewed");
  if (runtime.status !== "reviewed")
    assert.fail("Paris must reach the production store");
  assert.equal(
    runtime.content.publication,
    undefined,
    "Receipt stays server-side",
  );
  assert.equal(runtime.content.attractions!.length, 4);
  assert.equal(runtime.content.attractions![0].name.sq, "Kulla Eiffel");
});

test("an in-memory Paris factual or source edit cannot reuse the approved receipt", async (t) => {
  t.mock.method(globalThis, "fetch", async () =>
    assert.fail("No repair or research on tamper"),
  );
  const input = parisWorkspace().inputs.get("paris")!;
  const context = { identities: [input.identity], mediaSubjects: ["paris"] };
  const original = JSON.stringify(input.record);
  for (const kind of ["copy", "source", "missing-receipt"] as const) {
    const record = structuredClone(input.record);
    if (kind === "copy") record.overview!.text.en += " Changed fact.";
    if (kind === "source")
      record.sources.find((s) => s.id.endsWith(":louvre"))!.url =
        "https://www.louvre.fr/en/visit/hours-admission";
    if (kind === "missing-receipt") delete record.publication;
    const data = { schemaVersion: 1 as const, records: [record] };
    assert.equal(
      validateDestinationContentData(data, context).ok,
      true,
      "Failure must be the receipt, not an invalid schema",
    );
    assert.deepEqual(
      await createPinnedDestinationContentStore(
        data,
        context,
        () => input.now,
      ).get("paris"),
      { status: "none", reason: "not-reviewed" },
      kind,
    );
  }
  assert.equal(JSON.stringify(input.record), original);
  assert.equal(
    (await approvedDestinationContent.get("paris")).status,
    "reviewed",
  );
});
