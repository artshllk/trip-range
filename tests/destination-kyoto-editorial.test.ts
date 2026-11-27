// Historical record/access regression. Live archive exclusion is tested in destination-archive.test.ts.
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

function workspace() {
  return loadEditorialWorkspace(
    process.cwd(),
    loadContentOperations(),
    // Read the current registry after the owner-approved English pilot publication.
    Date.parse("2026-10-26T16:00:00Z"),
  );
}

test("Kyoto v4 retains specific official evidence for the temple, shrine, pagoda, local rules and separate southern outing", () => {
  const { record, research } = workspace().inputs.get("place:Q34600")!;
  const urls = (ids: string[]) =>
    ids.map((id) => record.sources.find((source) => source.id === id)!.url);
  assert.deepEqual(
    urls(record.attractions![1].sourceIds).sort(),
    [
      "https://kyoto.travel/en/areas/gion-kiyomizu/",
      "https://www.japan.travel/en/spot/78/",
    ].sort(),
  );
  assert.match(record.attractions![0].shortDescription.en, /hillside temple/);
  assert.match(record.attractions![1].shortDescription.en, /shrine.*Gion/);
  assert.match(record.attractions![2].shortDescription.en, /exterior view/);
  assert.match(
    record.attractions![4].shortDescription.en,
    /separate southern-Kyoto outing/,
  );
  assert.deepEqual(urls(record.attractions![4].sourceIds), [
    "https://www.japan.travel/en/spot/1128/",
  ]);
  const alternative = record.practicalNotes!.find((note) =>
    note.id.endsWith("batch2-visitor-alternatives"),
  )!;
  assert.ok(
    urls(alternative.sourceIds).includes(
      "https://kyoto.travel/en/responsible-travel/gion-manner-message-from-southern-gionmachi/",
    ),
  );
  assert.match(alternative.text.en, /private lanes and worshippers/);
  assert.equal(research!.sourceCount, record.sources.length);
  assert.equal(record.sources.length, 10);
  assert.equal(new Set(record.sources.map((source) => source.url)).size, 10);
});

test("Kyoto v4 groups the eastern stops, keeps Fushimi Inari separate and retains operational recheck deadlines", () => {
  const { record, identity } = workspace().inputs.get("place:Q34600")!;
  assert.equal(identity.subject, "place:Q34600");
  assert.equal(identity.placeKind, "city");
  assert.equal(identity.countryCode, "JP");
  assert.deepEqual(
    record.attractions!.map((attraction) => attraction.id),
    [
      "attraction:place:Q34600:kiyomizu",
      "attraction:place:Q34600:yasaka",
      "attraction:place:Q34600:hokanji",
      "attraction:place:Q34600:maruyama",
      "attraction:place:Q34600:expansion01-5",
    ],
  );
  assert.equal(record.areas!.length, 2);
  assert.equal(record.transport!.length, 2);
  assert.equal(record.practicalNotes!.length, 3);
  assert.equal(record.dayTemplates!.length, 2);
  const two = record.dayTemplates![0],
    three = record.dayTemplates![1];
  assert.deepEqual(two.suitableNights, [2]);
  assert.deepEqual(three.suitableNights, [3]);
  assert.deepEqual(
    two.stops.map((stop) => [stop.attractionId.split(":").pop(), stop.day]),
    [
      ["yasaka", 1],
      ["kiyomizu", 2],
      ["hokanji", 2],
      ["maruyama", 3],
    ],
  );
  assert.deepEqual(
    three.stops.map((stop) => [stop.attractionId.split(":").pop(), stop.day]),
    [
      ["yasaka", 1],
      ["kiyomizu", 2],
      ["hokanji", 2],
      ["expansion01-5", 3],
      ["maruyama", 4],
    ],
  );
  assert.match(record.transport![0].guidance.en, /Neither airport is in Kyoto/);
  for (const item of [...record.transport!, two, three])
    assert.deepEqual(item.freshness, {
      kind: "periodically-reviewed",
      reviewBy: "2026-11-06T00:00:00Z",
    });
});

test("Kyoto exact v4 approval and receipt publish all current content offline while Paris remains current", async (t) => {
  t.mock.method(globalThis, "fetch", async () =>
    assert.fail("No runtime destination research"),
  );
  const state = workspace();
  const input = state.inputs.get("place:Q34600")!;
  const { record } = input;
  assert.equal(record.contentVersion, 4);
  const review = state.reviews.get("place:Q34600")!;
  assert.equal(review.current.reviewer, "GoEksplo Owner");
  assert.ok(
    review.history.some(
      (entry) =>
        entry.review.contentVersion === 2 &&
        entry.review.decision === "approved",
    ),
  );
  assert.equal(
    contentDigest(record),
    "06775e61bf75f37c23f367d8a822681d7676dd83549ae68246b2944ce3db378e",
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
  assert.deepEqual(
    assessment.unacknowledged.map((a) => a.id),
    [],
  );
  assert.match(assessment.advisory[0].message, /503.*JNTO/);
  assert.equal(assessment.stale, false);
  assert.deepEqual(
    review.current.warningsAcknowledged.map((a) => a.id),
    ["evidence-review", "presentation:8427a93362f3f69ee0a9"],
  );
  assert.match(
    review.current.warningsAcknowledged[0].reason,
    /GoEksplo Owner explicitly approved/,
  );
  const runtime = await approvedDestinationContent.get("place:Q34600");
  assert.equal(runtime.status, "reviewed");
  if (runtime.status !== "reviewed")
    assert.fail("Kyoto must reach the real runtime store");
  assert.equal(runtime.content.publication, undefined);
  assert.equal(contentItems(runtime.content).length, 15);
  assert.deepEqual(runtime.content.attractions, record.attractions);
  assert.deepEqual(runtime.content.dayTemplates, record.dayTemplates);
  const paris = state.inputs.get("paris")!;
  assert.equal(publicationReceiptMatches(paris.record, paris.identity), true);
  const parisReview = assessEditorialReview(paris, state.reviews.get("paris"));
  assert.equal(
    parisReview.contentDigest,
    "5a968651f22920054786a53ac1083bd98a002f2b74bf8c61f784b6c3138a4e9b",
  );
  assert.equal(parisReview.eligible, true);
  assert.equal(parisReview.stale, false);
  assert.equal(
    (await approvedDestinationContent.get("paris")).status,
    "reviewed",
  );
});

test("Kyoto factual/source edits cannot inherit the old receipt; the real record stays untouched", async (t) => {
  t.mock.method(globalThis, "fetch", async () =>
    assert.fail("No repair or research on tamper"),
  );
  const input = workspace().inputs.get("place:Q34600")!;
  const original = JSON.stringify(input.record);
  const context = {
    identities: [input.identity],
    mediaSubjects: [input.record.destinationId],
  };
  for (const kind of ["copy", "source", "missing-receipt"] as const) {
    const changed = structuredClone(input.record);
    if (kind === "copy") changed.overview!.text.en += " Changed fact.";
    if (kind === "source")
      changed.sources.find((s) => s.id.endsWith(":kiyomizu"))!.url =
        "https://www.kiyomizudera.or.jp/en/";
    if (kind === "missing-receipt") delete changed.publication;
    const data = { schemaVersion: 1 as const, records: [changed] };
    assert.equal(validateDestinationContentData(data, context).ok, true);
    assert.deepEqual(
      await createPinnedDestinationContentStore(
        data,
        context,
        () => input.now,
      ).get("place:Q34600"),
      { status: "none", reason: "not-reviewed" },
      kind,
    );
  }
  assert.equal(JSON.stringify(input.record), original);
  assert.equal(
    (await approvedDestinationContent.get("place:Q34600")).status,
    "reviewed",
  );
});
