import { test } from "node:test";
import { CHILD_INPUT, renderInChild } from "./child-render";
import assert from "node:assert/strict";
import {
  readFileSync,
  mkdtempSync,
  mkdirSync,
  writeFileSync,
  rmSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  validateMediaRegistry,
  validateMediaData,
  validateMediaChanges,
} from "../src/domain/media/validation";
import { createReviewedMediaStore } from "../src/media/runtime/store";
import { displayImageAsset } from "../src/media/runtime/display";
import { trustedDestinationImage } from "../src/domain/destination-images";
import { placeIdentities } from "../src/places/runtime/registry";
import { currentContentAtApproval as approvedDestinationContent } from "./fixtures/current-editorial-data";
import { approvedDestinationContent as historicalContent } from "./fixtures/archived-destination-data";
import { approvedPlaceMedia } from "../src/media/runtime/approved";
import { localMediaFileErrors } from "../scripts/lib/media-local-files";
import { contentDigest } from "../src/content/integrity";
import { destinationContentData } from "../content/destinations/records";
import proposal from "../docs/research/destination-content/phase2-publication/approval-proposal.json";
import phase4bProposal from "../docs/research/destination-content/phase4b-guides/approval-proposal.json";
import registry from "../content/media/approved.json";

function snapshot() {
  const checked = validateMediaRegistry(registry, placeIdentities);
  assert.equal(checked.ok, true, checked.errors.join(","));
  if (!checked.ok) throw Error("registry");
  return structuredClone(checked.data);
}

test("Phase 4B owner receipts preserve the exact earlier English pilot and its approval history", async () => {
  for (const row of proposal.records) {
    const raw = destinationContentData.records.find(
      (r) => r.destinationId === row.destinationId,
    )!;
    const earlier = JSON.parse(
      readFileSync(
        `docs/research/destination-content/phase4b-guides/prior-published/${row.destinationId}.json`,
        "utf8",
      ),
    );
    assert.equal(contentDigest(earlier), row.contentDigest);
    const currentPin = phase4bProposal.candidates.find(
      (candidate) => candidate.destinationId === row.destinationId,
    )!;

    const live = await approvedDestinationContent.get(row.destinationId);
    assert.equal(live.status, "reviewed");
    const review = JSON.parse(
      readFileSync(
        `content/operations/reviews/${row.destinationId}.json`,
        "utf8",
      ),
    );
    assert.equal(review.current.decision, "approved");
    assert.equal(review.current.identityDigest, row.identityDigest);
    const priorApproval = review.history.find(
      (entry: { review: { decision: string; contentDigest: string } }) =>
        entry.review.decision === "approved" &&
        entry.review.contentDigest === row.contentDigest,
    );
    assert.ok(priorApproval, "The approved pilot remains in review history");
    assert.equal(priorApproval.review.evidenceDigest, row.evidenceDigest);
    assert.equal(contentDigest(raw), review.current.contentDigest);
    assert.equal(raw.contentVersion, review.current.contentVersion);
    const phase4bReview = [
      review.current,
      ...review.history.map((entry: { review: unknown }) => entry.review),
    ].find(
      (entry: {
        contentDigest: string;
        contentVersion: number;
        decision: string;
      }) =>
        entry.contentDigest === currentPin.contentDigest &&
        entry.contentVersion === currentPin.contentVersion &&
        entry.decision === "approved",
    );
    assert.ok(
      phase4bReview,
      "The Phase 4B approval survives later content reviews",
    );
    assert.equal(phase4bReview.reviewer, "GoEksplo Owner");
    assert.deepEqual(
      Object.values(review.current.checks),
      Array(5).fill("approved"),
    );
    if (row.destinationId === "london") {
      assert.ok(
        review.history.some(
          (entry: { review: { contentVersion: number; decision: string } }) =>
            entry.review.contentVersion === 2 &&
            entry.review.decision === "approved",
        ),
      );
      assert.ok(
        phase4bReview.warningsAcknowledged.some(
          (ack: { id: string; reason: string }) =>
            ack.id === "presentation:8023965be1154c073696" &&
            ack.reason.includes("GoEksplo Owner"),
        ),
      );
    }
  }
});

test("production hero/card authority resolves approved responsive bytes and Commons credits", async () => {
  const data = snapshot();
  assert.deepEqual(localMediaFileErrors(data.assets), []);
  for (const city of ["vienna", "london"])
    for (const role of ["destination.hero", "destination.card"] as const) {
      const result = await approvedPlaceMedia.get(city, role);
      assert.equal(result.status, "approved");
      if (result.status !== "approved") throw Error("media");
      const image = displayImageAsset(result.image);
      assert.equal(image.src, `/destinations/${city}-1200.webp`);
      assert.deepEqual(
        image.localVariants?.map((v) => v.width),
        [320, 640, 800, 1200, 1920],
      );
      assert.equal(trustedDestinationImage(image, city), true);
      assert.match(
        image.photoUrl!,
        /^https:\/\/commons.wikimedia.org\/wiki\/File:/,
      );
      assert.match(image.license!, /licenses\/by-sa\/[34]\.0\/$/);
      assert.match(image.attribution, /resized to WebP; cropped for display/);
    }
});

test("changed source, derivative, review, health or rejection fails closed instead of falling back", async () => {
  const mutations = [
    (d: ReturnType<typeof snapshot>) => {
      d.assets[0].checksum!.value = "0".repeat(40);
    },
    (d: ReturnType<typeof snapshot>) => {
      d.assets[0].localDelivery!.variants[0].sha256 = "0".repeat(64);
    },
    (d: ReturnType<typeof snapshot>) => {
      delete d.selections[0].reviewedLocalDelivery;
    },
    (d: ReturnType<typeof snapshot>) => {
      d.assets[0].health.status = "withdrawn";
    },
    (d: ReturnType<typeof snapshot>) => {
      d.rejections.push({
        subject: "vienna",
        assetId: d.assets[0].id,
        reason: "withdrawn",
        reviewedAt: d.selections[0].reviewedAt!,
      });
    },
    (d: ReturnType<typeof snapshot>) => {
      d.assets[0].localDelivery!.variants[0].src =
        "/destinations/../london-640.webp";
    },
    (d: ReturnType<typeof snapshot>) => {
      d.assets[0].localDelivery!.variants[0].height = 1;
    },
  ];
  for (const mutate of mutations) {
    const data = snapshot();
    mutate(data);
    assert.equal(validateMediaData(data).ok, false);
    assert.equal(
      (await createReviewedMediaStore(data).get("vienna", "destination.hero"))
        .status,
      "none",
    );
  }
  const data = snapshot(),
    previous = snapshot();
  data.assets[0].localDelivery!.variants[0].sha256 = "0".repeat(64);
  for (const s of data.selections.filter((s) => s.subject === "vienna"))
    s.reviewedLocalDelivery = structuredClone(data.assets[0].localDelivery);
  assert.equal(validateMediaData(data).ok, true);
  assert.ok(
    validateMediaChanges(data, previous).length > 0,
    "updating a delivery pin still requires a new human-reviewed revision",
  );
});

test("offline byte check rejects missing, modified or falsely dimensioned public derivatives", () => {
  const data = snapshot(),
    root = mkdtempSync(join(tmpdir(), "goeksplo-media-integrity-"));
  try {
    mkdirSync(join(root, "destinations"));
    assert.equal(localMediaFileErrors(data.assets, root).length, 79);
    for (const asset of data.assets)
      for (const v of asset.localDelivery!.variants)
        writeFileSync(join(root, v.src), readFileSync(join("public", v.src)));
    assert.deepEqual(localMediaFileErrors(data.assets, root), []);
    writeFileSync(
      join(root, data.assets[0].localDelivery!.variants[0].src),
      "corrupt",
    );
    assert.equal(localMediaFileErrors(data.assets, root).length, 1);
    data.assets[1].localDelivery!.variants[0].height += 1;
    assert.equal(localMediaFileErrors(data.assets, root).length, 2);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("historical approved English content and photos render corrected guidance and responsive credits together", async () => {
  for (const city of ["vienna", "london"]) {
    const content = await historicalContent.get(city);
    const photo = await approvedPlaceMedia.get(city, "destination.hero");
    assert.equal(photo.status, "approved");
    if (photo.status !== "approved") throw Error("media");
    const image = displayImageAsset(photo.image);
    const html = renderInChild(
      `
      const {createElement:h}=require('react');
      const {renderToStaticMarkup}=require('react-dom/server');
      const {ImageAssetBoundary,DestinationImage}=require('./.test-build/src/components/travel/DestinationImage.js');
      const {ImageAttribution}=require('./.test-build/src/components/travel/Provenance.js');
      const {renderTripContentSections}=require('./.test-build/src/components/travel/TripContent.js');
      const t=require('./.test-build/src/i18n/en.json');
      const {city,image,content}=${CHILD_INPUT};
      globalThis.fetch=async()=>{throw Error('Unexpected network request');};
      const sections=renderTripContentSections({result:content,destinationId:city,nights:3,locale:'en',fallbackItinerary:[]});
      process.stdout.write(renderToStaticMarkup(h('main',null,
        h(ImageAssetBoundary,{destination:{id:city,name:{en:city}},locale:'en',image},
          h(DestinationImage,{fallbackAlt:'Photo',width:1200,height:city==='vienna'?800:675,sizes:'(max-width:759px) 90vw, 1080px'}),h(ImageAttribution,{t})),
        ...Object.values(sections))));
    `,
      { city, image, content },
    );
    assert.match(
      html,
      new RegExp(
        `/destinations/${city}-320.webp 320w, /destinations/${city}-640.webp 640w, /destinations/${city}-800.webp 800w, /destinations/${city}-1200.webp 1200w, /destinations/${city}-1920.webp 1920w`,
      ),
    );
    assert.match(html, /Wikimedia Commons/);
    assert.match(html, /creativecommons.org\/licenses\/by-sa/);
    assert.doesNotMatch(html, /review-media|DRAFT|awaits human approval/);
    if (city === "vienna") {
      assert.match(html, /Visit Upper Belvedere/);
      assert.match(html, /Lower Belvedere is a separate visit/);
    } else {
      assert.match(html, /Sundays are for worship, not sightseeing/);
      assert.match(html, /More transport details/);
      assert.match(html, /Luton/);
      assert.match(html, /Southend/);
    }
  }
});
