// Historical record/access regression. Live archive exclusion is tested in destination-archive.test.ts.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import owner from "../docs/research/destination-content/worldwide-expansion-01-2026-10-23/batch-03-publication/owner-approval.json";
import proposal from "../docs/research/destination-content/worldwide-expansion-01-2026-10-23/batch-03-review/approval-proposal.json";
import candidates from "../docs/research/destination-content/worldwide-expansion-01-2026-10-23/batch-03-review/media/registry-candidates.json";
import sydneyV4 from "../docs/verification/sydney-transport-refresh/record-v4.json";
import type { DestinationContent } from "../src/domain/destination-content/types";
import media from "../content/media/approved.json";
import {
  contentDigest,
  digest,
  publicationReceiptMatches,
} from "../src/content/integrity";
import { loadEditorialWorkspace } from "./fixtures/archived-destination-data";
import { assessEditorialReview } from "../scripts/lib/editorial-review";
import { approvedDestinationContent } from "./fixtures/archived-destination-data";
import { createPinnedDestinationContentStore } from "../src/content/runtime/publication";
import { reviewContext } from "../scripts/lib/editorial-review";
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
  "docs/research/destination-content/worldwide-expansion-01-2026-10-23/batch-03-review/";
const sha = (file: string) =>
  createHash("sha256").update(readFileSync(file)).digest("hex");

test("Batch 3 owner approval publishes exactly the pinned English v4 copy and preserves prior editorial history", async (t) => {
  t.mock.method(globalThis, "fetch", async () =>
    assert.fail("Editorial integration is offline"),
  );
  assert.equal(owner.reviewer, "GoEksplo Owner");
  assert.equal(owner.packetId, "worldwide-batch3-review-v1");
  assert.deepEqual(
    owner.content.map((row) => row.destinationId),
    ["place:Q5465", "place:Q8678", "place:Q3130", "place:Q612"],
  );
  const workspace = loadEditorialWorkspace();
  for (const row of owner.content) {
    const pin = proposal.candidates.find((p) => p.slug === row.slug)!;
    const current = workspace.inputs.get(row.destinationId)!;
    const currentReview = workspace.reviews.get(row.destinationId)!;
    // The immutable owner-approved v4 remains provable after the authorized
    // WSI-only v5 refresh. Do not rewrite the original approval packet.
    const refreshed = row.destinationId === "place:Q3130";
    const input = refreshed
      ? {
          ...current,
          record: sydneyV4 as DestinationContent,
          now: Date.parse("2026-10-25T00:00:00Z"),
        }
      : current;
    const review = refreshed
      ? {
          ...currentReview,
          current: currentReview.history.find(
            (h) =>
              h.review.contentVersion === 4 && h.review.decision === "approved",
          )!.review,
          history: currentReview.history.filter(
            (h) =>
              Date.parse(h.supersededAt) < Date.parse("2026-10-26T00:00:00Z"),
          ),
        }
      : currentReview;
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
    assert.deepEqual(result.content.dayTemplates, current.record.dayTemplates);
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

test("Batch 3 media keeps exact approved assets, both focal crops and all twelve pinned public derivatives", async () => {
  assert.deepEqual(
    owner.media.map((row) => row.assetId),
    [
      "commons:126494271",
      "commons:133796307",
      "commons:73107560",
      "commons:68665373",
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
    assert.equal(
      asset.license.name,
      row.subject === "place:Q8678" ? "CC0" : "CC BY-SA 4.0",
    );
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

test("only the four approved Batch 3 guides join shared discovery and English SEO without provider requests", async (t) => {
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
    assert.equal(guide.target.id, `city:${guide.target.cityCode}`);
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

test("Batch 3 preserves scoped airport limitations and expires WSI guidance at its pinned recheck deadline", async () => {
  const w = loadEditorialWorkspace();
  const capetown = w.inputs.get("place:Q5465")!.record;
  const rio = w.inputs.get("place:Q8678")!.record;
  const sydney = {
    ...w.inputs.get("place:Q3130")!,
    record: sydneyV4 as DestinationContent,
  };
  const dubai = w.inputs.get("place:Q612")!.record;
  assert.match(capetown.transport![0].guidance.en, /airport bus suspended/);
  assert.match(
    rio.transport![1].guidance.en,
    /RRJ.*ground route is unverified/,
  );
  assert.match(rio.transport![1].guidance.en, /Arrange and price that leg/);
  assert.match(dubai.transport![0].guidance.en, /Terminal 1 and Terminal 3/);
  assert.match(
    dubai.transport![1].guidance.en,
    /DWC has no direct metro station/,
  );
  const wsi = sydney.record.transport!.find((t) => t.title.en.includes("WSI"))!;
  assert.equal(wsi.freshness.kind, "periodically-reviewed");
  if (wsi.freshness.kind !== "periodically-reviewed")
    throw Error("Pinned recheck required");
  assert.equal(wsi.freshness.reviewBy, "2026-10-26T00:00:00Z");
  const at = async (iso: string) =>
    createPinnedDestinationContentStore(
      { schemaVersion: 1, records: [sydney.record] },
      reviewContext(sydney.identity),
      () => Date.parse(iso),
    ).get(sydney.record.destinationId);
  const before = await at("2026-10-25T23:59:59Z");
  const due = await at("2026-10-26T00:00:00Z");
  assert.equal(before.status, "reviewed");
  assert.equal(due.status, "reviewed");
  if (before.status !== "reviewed" || due.status !== "reviewed")
    throw Error("Reviewed city content required");
  assert.ok(before.content.transport!.some((t) => t.id === wsi.id));
  assert.equal(
    due.content.transport!.some((t) => t.id === wsi.id),
    false,
  );
  assert.ok(
    due.content.transport!.some((t) => t.title.en === "Sydney Airport (SYD)"),
  );
});
