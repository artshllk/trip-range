// Historical record/access regression. Live archive exclusion is tested in destination-archive.test.ts.
import assert from "node:assert/strict";
import { test } from "node:test";
import { readFileSync } from "node:fs";
import { loadEditorialWorkspace } from "./fixtures/archived-destination-data";
import {
  assessEditorialReview,
  reviewContext,
  reviewPins,
} from "../scripts/lib/editorial-review";
import { approveDestinationContent } from "../scripts/lib/editorial-commands";
import {
  contentDigest,
  contentItems,
  publicationReceiptMatches,
} from "../src/content/integrity";
import { approvedDestinationContent } from "./fixtures/archived-destination-data";
import { createPinnedDestinationContentStore } from "../src/content/runtime/publication";
import { validateDestinationContentData } from "../src/domain/destination-content/validation";
import { publishedDestinationIds } from "./fixtures/published-destinations";

const id = "place:Q24451";
const now = Date.parse("2026-10-26T16:00:00Z");
const digest =
  "e71040998e395bd8fb9f101f3130c5573d7d288888696da1e3d1b99a787ba6f3";

test("Kruger exact authorized v2 publication is persisted with current review, receipt and public content", async (t) => {
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
  assert.deepEqual(reviewPins(input), {
    contentVersion: 2,
    contentDigest: digest,
    identityDigest:
      "6fea346daaa3cf36875c6af0b719c7a45eb23671d53dfa1947d9ea7d15e1725c",
    evidenceDigest:
      "a4459455bac033f13cf188c0df16fd1a1972fe59d12150de168e2c79b41a75e8",
  });
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
    /SZK stays direct/,
  );
  assert.match(
    review.current.warningsAcknowledged[0].reason,
    /required unpriced onward travel/,
  );
  for (const item of [
    record,
    ...contentItems(record).map(({ item }) => item),
  ]) {
    assert.equal(item.reviewStatus, "reviewed");
    assert.equal(item.reviewedAt, "2026-10-15T15:52:05.912Z");
  }
  const runtime = await approvedDestinationContent.get(id);
  if (runtime.status !== "reviewed")
    assert.fail("Real reviewed runtime required");
  for (const field of [
    "overview",
    "attractions",
    "areas",
    "transport",
    "practicalNotes",
  ] as const)
    assert.deepEqual(runtime.content[field], record[field]);
  assert.equal(runtime.content.publication, undefined);
  assert.doesNotMatch(
    JSON.stringify(runtime),
    /"(?:contentDigest|identityDigest|evidenceDigest|warningsAcknowledged|reviewer|history)"\s*:/,
  );
});

test("Kruger factual/source tampering cannot reuse the old receipt; draft copies remain hidden", async (t) => {
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
  for (const mutation of [
    "english",
    "albanian",
    "source",
    "association",
    "order",
    "draft",
  ]) {
    const changed = structuredClone(record);
    if (mutation === "english") changed.overview!.text.en += " Altered fact.";
    if (mutation === "albanian")
      changed.overview!.text.sq += " Fakt i ndryshuar.";
    if (mutation === "source") changed.sources[1].title += " Changed evidence";
    if (mutation === "association")
      changed.attractions![0].sourceIds = [changed.sources[1].id];
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
    } else assert.deepEqual(changed.publication, record.publication);
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

test("Kruger cannot be reapplied; all 30 receipts stay current and Patagonia stays blocked", async () => {
  const workspace = loadEditorialWorkspace(undefined, undefined, now);
  await assert.rejects(
    approveDestinationContent(["--destination", id], workspace),
    /approval-prerequisites-not-met/,
  );
  assert.equal(workspace.inputs.size, 30);
  assert.deepEqual([...workspace.reviews.keys()], publishedDestinationIds);
  for (const input of workspace.inputs.values()) {
    const result = assessEditorialReview(
      input,
      workspace.reviews.get(input.record.destinationId),
    );
    assert.equal(input.record.reviewStatus, "reviewed");
    assert.ok(publicationReceiptMatches(input.record, input.identity));
    assert.equal(result.stale, false);
    assert.equal(result.eligible, true);
    assert.deepEqual(result.blocking, []);
  }
  const patagonia = JSON.parse(
    readFileSync(
      "content/operations/queue/candidate-phase3f-patagonia.json",
      "utf8",
    ),
  );
  assert.equal(patagonia.status, "blocked");
  for (const [file, raw] of workspace.watched)
    if (raw !== null) assert.equal(readFileSync(file, "utf8"), raw);
});
