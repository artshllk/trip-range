import { beforeGuideResize, guideWidths } from "./fixtures/guide-resize";
// Historical record/access regression. Live archive exclusion is tested in destination-archive.test.ts.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import owner from "../docs/research/destination-content/worldwide-expansion-01-2026-10-23/batch-01-publication/owner-approval.json";
import proposal from "../docs/research/destination-content/worldwide-expansion-01-2026-10-23/batch-01-final-review/approval-proposal.json";
import candidates from "../docs/research/destination-content/worldwide-expansion-01-2026-10-23/batch-01-review/media/registry-candidates.json";
import media from "../content/media/approved.json";
import {
  contentDigest,
  digest,
  publicationReceiptMatches,
} from "../src/content/integrity";
import { loadEditorialWorkspace } from "./fixtures/archived-destination-data";
import { assessEditorialReview } from "../scripts/lib/editorial-review";
import { approvedDestinationContent } from "./fixtures/archived-destination-data";
import { approvedPlaceMedia } from "../src/media/runtime/approved";
import { createReviewedMediaStore } from "../src/media/runtime/store";
import { validateMediaRegistry } from "../src/domain/media/validation";
import { placeIdentities } from "../src/places/runtime/registry";
import {
  loadDestinationGuide,
  getDestinationGuides,
} from "./fixtures/archived-destination-data";

const base =
  "docs/research/destination-content/worldwide-expansion-01-2026-10-23/";
const sha = (file: string) =>
  createHash("sha256").update(readFileSync(file)).digest("hex");
const expected = ["istanbul", "city:BCN", "place:Q334", "place:Q1489"];

test("Batch 1 historical owner approval publishes the four pinned revisions through frozen receipts", async (t) => {
  t.mock.method(globalThis, "fetch", async () =>
    assert.fail("Editorial integration is offline"),
  );
  assert.equal(owner.reviewer, "GoEksplo Owner");
  assert.equal(owner.packetId, "worldwide-batch1-final-review-v1");
  assert.deepEqual(
    owner.content.map((c) => c.destinationId),
    expected,
  );
  const workspace = loadEditorialWorkspace();
  for (const row of owner.content) {
    const input = workspace.inputs.get(row.destinationId)!;
    const pin = proposal.candidates.find((p) => p.slug === row.slug)!;
    const review = workspace.reviews.get(row.destinationId)!;
    assert.equal(input.record.contentVersion, pin.contentVersion);
    assert.equal(contentDigest(input.record), pin.contentDigest);
    assert.equal(digest(input.identity), pin.identityDigest);
    assert.equal(publicationReceiptMatches(input.record, input.identity), true);
    assert.equal(review.current.reviewer, "GoEksplo Owner");
    assert.equal(assessEditorialReview(input, review).eligible, true);
    assert.ok(
      Object.values(review.current.checks).every((c) => c === "approved"),
    );
    assert.ok(
      review.history.some(
        (h) =>
          h.review.contentVersion === 2 && h.review.decision === "approved",
      ),
    );
    assert.equal(sha(row.operationalEvidence), row.evidenceSha256);
    assert.deepEqual(
      readFileSync(row.operationalEvidence),
      readFileSync(base + "batch-01-final-review/" + pin.evidenceFile),
    );
    assert.equal(
      sha(base + "batch-01-final-review/" + pin.candidateFile),
      pin.fileSha256,
    );
    assert.equal(
      pin.decision,
      "pending",
      "Historical unsigned proposal is never rewritten as approval",
    );
    const result = await approvedDestinationContent.get(row.destinationId);
    assert.equal(result.status, "reviewed");
    if (result.status !== "reviewed") throw Error("Reviewed content required");
    assert.deepEqual(result.content.dayTemplates, input.record.dayTemplates);
  }
});

test("three owner-approved photographs retain exact source records, both crop roles and nine public derivative hashes", async () => {
  assert.deepEqual(
    owner.media.map((m) => m.assetId),
    ["commons:9050140", "commons:88145804", "commons:139259979"],
  );
  const checked = validateMediaRegistry(candidates, placeIdentities);
  assert.equal(checked.ok, true);
  if (!checked.ok) throw Error("Candidate registry");
  const pending = createReviewedMediaStore(checked.data);
  for (const row of owner.media) {
    const asset = media.assets.find((a) => a.id === row.assetId)!;
    assert.deepEqual(
      {
        ...asset,
        localDelivery: {
          ...asset.localDelivery,
          variants: beforeGuideResize(asset.localDelivery.variants),
        },
      },
      candidates.assets.find((a) => a.id === row.assetId),
    );
    assert.equal(row.reviewer, "GoEksplo Owner");
    for (const role of row.roles) {
      const selection = media.selections.find(
        (s) => s.subject === row.subject && s.role === role.role,
      )!;
      assert.equal(selection.method, "human-review");
      assert.equal(
        selection.history[0]?.reviewedAt ?? selection.reviewedAt,
        owner.reviewedAt,
      );
      assert.equal(selection.locked, true);
      assert.deepEqual(selection.focalPoint, role.focalPoint);
      assert.deepEqual(selection.alt, role.alt);
      assert.deepEqual(selection.reviewedChecksum, asset.checksum);
      assert.deepEqual(selection.reviewedLocalDelivery, asset.localDelivery);
      assert.equal(
        (
          await approvedPlaceMedia.get(
            row.subject,
            role.role as "destination.hero" | "destination.card",
          )
        ).status,
        "approved",
      );
      assert.equal(
        (
          await pending.get(
            row.subject,
            role.role as "destination.hero" | "destination.card",
          )
        ).status,
        "none",
        "Source evidence alone cannot approve an image",
      );
    }
    assert.deepEqual(
      asset.localDelivery!.variants.map((v) => v.width),
      row.subject === "city:BCN" ? guideWidths : [640, 1200, 1920],
    );
    for (const variant of asset.localDelivery!.variants) {
      assert.equal(sha("public" + variant.src), variant.sha256);
      assert.equal(
        readFileSync("public" + variant.src).byteLength,
        variant.bytes,
      );
    }
  }
  assert.deepEqual(
    media.assets
      .filter((a) => a.id === "commons:34203027")
      .map((a) => ({
        ...a,
        localDelivery: {
          ...a.localDelivery,
          variants: beforeGuideResize(a.localDelivery.variants),
        },
      })),
    owner.istanbulMediaPreserved.assets,
  );
  assert.deepEqual(
    media.selections
      .filter((s) => s.subject === "istanbul")
      .map((s) => ({
        ...s,
        ...s.history[0],
        history: [],
        reviewedLocalDelivery: {
          ...s.reviewedLocalDelivery,
          variants: beforeGuideResize(s.reviewedLocalDelivery.variants),
        },
      })),
    owner.istanbulMediaPreserved.selections,
  );
});

test("approved Batch 1 guides remain in discovery while unapproved geographic media and remaining expansion routes stay withheld", async (t) => {
  t.mock.method(globalThis, "fetch", async () =>
    assert.fail("Guide loading cannot contact providers"),
  );
  const guides = await getDestinationGuides();
  assert.equal(guides.length, 16);
  for (const slug of ["istanbul", "barcelona", "singapore", "mexico-city"]) {
    const guide = await loadDestinationGuide(slug);
    assert.ok(guide?.heroImage && guide.card.image);
    assert.equal(guide.heroImage.destinationId, guide.card.subject);
    assert.equal(guide.card.image.destinationId, guide.card.subject);
  }
  for (const slug of ["lisbon"])
    assert.equal(await loadDestinationGuide(slug), undefined);
  for (const subject of ["brezovica", "mavrovo", "mirusha", "rugova"])
    for (const role of ["destination.hero", "destination.card"] as const)
      assert.equal(
        (await approvedPlaceMedia.get(subject, role)).status,
        "none",
      );
});
