// Historical record/access regression. Live archive exclusion is tested in destination-archive.test.ts.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import owner from "../docs/research/destination-content/worldwide-expansion-01-2026-10-23/batch-02-publication/owner-approval.json";
import proposal from "../docs/research/destination-content/worldwide-expansion-01-2026-10-23/batch-02-final-review/approval-proposal.json";
import candidates from "../docs/research/destination-content/worldwide-expansion-01-2026-10-23/batch-02-final-review/media/registry-candidates.json";
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
import {
  destinationMetadata,
  destinationSitemap,
} from "../src/seo/destinations";

const packet =
  "docs/research/destination-content/worldwide-expansion-01-2026-10-23/batch-02-final-review/";
const sha = (file: string) =>
  createHash("sha256").update(readFileSync(file)).digest("hex");

test("Batch 2 owner approval publishes exactly the pinned English v4 copy and preserves prior editorial history", async (t) => {
  t.mock.method(globalThis, "fetch", async () =>
    assert.fail("Editorial integration is offline"),
  );
  assert.equal(owner.reviewer, "GoEksplo Owner");
  assert.equal(owner.packetId, "worldwide-batch2-final-review-v1");
  assert.deepEqual(
    owner.content.map((row) => row.destinationId),
    ["place:Q1490", "place:Q34600", "place:Q1861", "place:Q101625"],
  );
  const workspace = loadEditorialWorkspace();
  for (const row of owner.content) {
    const pin = proposal.candidates.find((p) => p.slug === row.slug)!;
    const input = workspace.inputs.get(row.destinationId)!;
    const review = workspace.reviews.get(row.destinationId)!;
    assert.equal(input.record.contentVersion, 4);
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
    assert.equal(sha(packet + pin.candidateFile), pin.fileSha256);
    assert.equal(sha(row.operationalEvidence), pin.evidenceFileSha256);
    assert.deepEqual(
      readFileSync(row.operationalEvidence),
      readFileSync(packet + pin.evidenceFile),
    );
    assert.equal(pin.decision, "pending", "Original proposal remains unsigned");
    const result = await approvedDestinationContent.get(row.destinationId);
    assert.equal(result.status, "reviewed");
    if (result.status !== "reviewed") throw Error("Reviewed content required");
    assert.deepEqual(result.content.dayTemplates, input.record.dayTemplates);
    assert.ok(
      result.content.dayTemplates?.some((day) =>
        day.suitableNights.includes(2),
      ),
    );
    assert.ok(
      result.content.dayTemplates?.some((day) =>
        day.suitableNights.includes(3),
      ),
    );
  }
});

test("Batch 2 media keeps exact approved assets, both focal crops and all twelve pinned public derivatives", async () => {
  assert.deepEqual(
    owner.media.map((row) => row.assetId),
    [
      "commons:80694116",
      "commons:53593907",
      "commons:82660408",
      "commons:72262779",
    ],
  );
  const checked = validateMediaRegistry(candidates, placeIdentities);
  assert.equal(checked.ok, true);
  if (!checked.ok) throw Error("Candidate registry invalid");
  const pending = createReviewedMediaStore(checked.data);
  for (const row of owner.media) {
    const asset = media.assets.find((a) => a.id === row.assetId)!;
    assert.deepEqual(
      asset,
      candidates.assets.find((a) => a.id === row.assetId),
    );
    assert.equal(row.reviewer, "GoEksplo Owner");
    assert.equal(asset.license.name, "CC BY-SA 4.0");
    assert.match(asset.attribution, /resized to WebP; cropped for display/);
    for (const role of row.roles) {
      const selection = media.selections.find(
        (s) => s.subject === row.subject && s.role === role.role,
      )!;
      assert.equal(selection.method, "human-review");
      assert.equal(selection.reviewedAt, owner.reviewedAt);
      assert.equal(selection.locked, true);
      assert.deepEqual(selection.focalPoint, role.focalPoint);
      assert.deepEqual(selection.alt, role.alt);
      assert.deepEqual(selection.reviewedChecksum, asset.checksum);
      assert.deepEqual(selection.reviewedLocalDelivery, asset.localDelivery);
      const mediaRole = role.role as "destination.hero" | "destination.card";
      assert.equal(
        (await approvedPlaceMedia.get(row.subject, mediaRole)).status,
        "approved",
      );
      assert.equal((await pending.get(row.subject, mediaRole)).status, "none");
    }
    assert.deepEqual(
      asset.localDelivery!.variants.map((v) => v.width),
      [640, 1200, 1920],
    );
    for (const variant of asset.localDelivery!.variants) {
      assert.equal(sha("public" + variant.src), variant.sha256);
      assert.equal(
        readFileSync("public" + variant.src).byteLength,
        variant.bytes,
      );
    }
  }
});

test("only the four approved Batch 2 guides join shared discovery and English SEO without provider requests", async (t) => {
  t.mock.method(globalThis, "fetch", async () =>
    assert.fail("Guide loading must not contact providers"),
  );
  const guides = await getDestinationGuides();
  assert.equal(guides.length, 16);
  for (const row of owner.content) {
    const guide = await loadDestinationGuide(row.slug);
    assert.ok(guide?.heroImage && guide.card.image && guide.target);
    assert.equal(guide.card.subject, row.destinationId);
    assert.equal(guide.heroImage.destinationId, row.destinationId);
    assert.equal(guide.card.image.destinationId, row.destinationId);
    if (["tokyo", "kyoto"].includes(row.slug))
      assert.equal(guide.target.id, row.destinationId);
    const metadata = destinationMetadata(guide.card);
    assert.equal(
      metadata.alternates?.canonical,
      `https://www.trip-range.com/destinations/${row.slug}`,
    );
    assert.deepEqual(metadata.robots, { index: false, follow: true });
    assert.deepEqual(destinationSitemap([{ card: guide.card }]), []);
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
