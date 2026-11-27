// Historical record/access regression. Live archive exclusion is tested in destination-archive.test.ts.
import assert from "node:assert/strict";
import { test } from "node:test";
import { loadEditorialWorkspace } from "./fixtures/archived-destination-data";
import { loadContentOperations } from "./fixtures/archived-destination-data";
import { assessEditorialReview } from "../scripts/lib/editorial-review";
import {
  contentDigest,
  contentItems,
  publicationReceiptMatches,
} from "../src/content/integrity";
import { approvedDestinationContent } from "./fixtures/archived-destination-data";
import { createPinnedDestinationContentStore } from "../src/content/runtime/publication";
import { validateDestinationContentData } from "../src/domain/destination-content/validation";
import { destinationAccessData } from "./fixtures/archived-destination-data";
import { placeRegistryData } from "../content/places/records";
import { createDestinationAccessStore } from "../src/travel/runtime/access-store";

const id = "place:Q60";
// Snapshot follows the owner-approved Phase 4B revision and precedes note expiry.
const now = Date.parse("2026-10-26T16:00:00Z");
const workspace = () =>
  loadEditorialWorkspace(process.cwd(), loadContentOperations(), now);

test("New York's exact owner-approved v3 publishes thirteen items and preserves the earlier approval", async (t) => {
  t.mock.method(globalThis, "fetch", async () =>
    assert.fail("No runtime research"),
  );
  const state = workspace(),
    input = state.inputs.get(id)!,
    record = input.record;
  const review = state.reviews.get(id)!;
  assert.equal(record.contentVersion, 3);
  assert.equal(
    contentDigest(record),
    "3ee244c118cdb2a4b54e314134117fff0626eba08d4cf1bc6f1542be3e068f5f",
  );
  assert.equal(publicationReceiptMatches(record, input.identity), true);
  assert.equal(review.current.reviewer, "GoEksplo Owner");
  const earlierApproval = review.history.find(
    ({ review: earlier }) =>
      earlier.contentVersion === 2 &&
      earlier.decision === "approved" &&
      earlier.contentDigest ===
        "6ec2a15376cff5b542bce095c781912313eb4518a3820b73a02809ec14175b1b",
  );
  assert.ok(earlierApproval);
  assert.equal(earlierApproval.review.reviewer, "art");
  assert.equal(earlierApproval.review.checks.albanianCopy, "approved");
  const assessment = assessEditorialReview(input, review);
  assert.deepEqual(assessment.checks, {
    identity: "approved",
    sources: "approved",
    englishCopy: "approved",
    selectionAndOrder: "approved",
    freshness: "approved",
  });
  assert.deepEqual(assessment.blocking, []);
  assert.deepEqual(assessment.unacknowledged, []);
  assert.equal(assessment.stale, false);
  assert.equal(assessment.eligible, true);
  assert.equal(assessment.decision, "approved");
  assert.deepEqual(
    review.current.warningsAcknowledged.map((a) => a.id),
    ["evidence-review"],
  );
  assert.match(
    earlierApproval.review.warningsAcknowledged[0].reason,
    /intentionally focused.*does not claim citywide coverage/,
  );
  for (const item of [
    record,
    ...contentItems(record).map(({ item }) => item),
  ]) {
    assert.equal(item.reviewStatus, "reviewed");
    assert.equal(item.reviewedAt, record.publication!.approvedAt);
  }
  const runtime = await approvedDestinationContent.get(id);
  assert.equal(runtime.status, "reviewed");
  if (runtime.status !== "reviewed")
    assert.fail("Real reviewed runtime required");
  assert.equal(contentItems(runtime.content).length, 13);
  assert.deepEqual(runtime.content.attractions, record.attractions);
  assert.deepEqual(runtime.content.areas, record.areas);
  assert.deepEqual(runtime.content.transport, record.transport);
  assert.deepEqual(runtime.content.practicalNotes, record.practicalNotes);
  assert.equal(runtime.content.publication, undefined);
  assert.doesNotMatch(
    JSON.stringify(runtime),
    /contentDigest|identityDigest|evidenceDigest|warningsAcknowledged|reviewer|history/,
  );
});

test("New York copy/source tampering cannot inherit an old receipt or trigger automatic repair", async (t) => {
  t.mock.method(globalThis, "fetch", async () =>
    assert.fail("No tamper repair or research"),
  );
  const { record, identity } = workspace().inputs.get(id)!;
  const original = JSON.stringify(record),
    context = { identities: [identity], mediaSubjects: [id] };
  for (const kind of ["copy", "source", "missing-receipt"]) {
    const changed = structuredClone(record);
    if (kind === "copy") changed.overview!.text.en += " Changed fact.";
    if (kind === "source")
      changed.sources.find((s) => s.id.endsWith(":met"))!.url =
        "https://www.metmuseum.org/";
    if (kind === "missing-receipt") delete changed.publication;
    const data = { schemaVersion: 1 as const, records: [changed] };
    assert.equal(validateDestinationContentData(data, context).ok, true);
    assert.deepEqual(
      await createPinnedDestinationContentStore(data, context, () => now).get(
        id,
      ),
      { status: "none", reason: "not-reviewed" },
      kind,
    );
  }
  assert.equal(JSON.stringify(record), original);
  assert.equal((await approvedDestinationContent.get(id)).status, "reviewed");
});

test("direct-city identity is independent of publication and cannot expose an in-memory New York draft", async () => {
  const access = createDestinationAccessStore(
    destinationAccessData,
    placeRegistryData.records,
    () => now,
  );
  const before = access.get(id)!;
  assert.deepEqual(before.directCity?.airportCodes, ["JFK", "LGA", "EWR"]);
  const { record, identity } = workspace().inputs.get(id)!;
  const draft = structuredClone(record);
  for (const item of [draft, ...contentItems(draft).map(({ item }) => item)]) {
    item.reviewStatus = "draft";
    item.reviewedAt = null;
  }
  delete draft.publication;
  assert.deepEqual(
    await createPinnedDestinationContentStore(
      { schemaVersion: 1, records: [draft] },
      { identities: [identity], mediaSubjects: [id] },
      () => now,
    ).get(id),
    { status: "none", reason: "not-reviewed" },
  );
  assert.deepEqual(access.get(id), before);
  assert.equal(
    (await approvedDestinationContent.get("place:Q24451")).status,
    "reviewed",
  );
});

test("New York publication retains the focused selection and January operational deadlines", () => {
  const { record } = workspace().inputs.get(id)!;
  assert.deepEqual(
    record.attractions!.map((a) => a.id),
    [
      "attraction:place:Q60:met",
      "attraction:place:Q60:central-park",
      "attraction:place:Q60:brooklyn-bridge",
      "attraction:place:Q60:liberty",
    ],
  );
  assert.equal(record.sources.length, 7);
  assert.equal(record.areas!.length, 1);
  assert.equal(record.areas![0].name.en, "Upper East Side");
  assert.deepEqual(record.dayTemplates, []);
  const periodic = contentItems(record).filter(
    ({ item }) => item.freshness.kind === "periodically-reviewed",
  );
  assert.equal(periodic.length, 3);
  for (const { item } of periodic)
    assert.deepEqual(item.freshness, {
      kind: "periodically-reviewed",
      reviewBy: "2027-01-10T00:00:00Z",
    });
});
