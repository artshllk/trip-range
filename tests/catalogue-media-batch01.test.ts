import { beforeGuideResize, guideWidths } from "./fixtures/guide-resize";
// Historical record/access regression. Live archive exclusion is tested in destination-archive.test.ts.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { CHILD_INPUT, renderInChild } from "./child-render";
import approval from "../docs/research/destination-media/catalogue-batch-01/final-review/owner-approval.json";
import media from "../content/media/approved.json";
import { placeIdentities, placeRegistry } from "../src/places/runtime/registry";
import { approvedPlaceMedia } from "../src/media/runtime/approved";
import { displayImageAsset } from "../src/media/runtime/display";
import { trustedDestinationImage } from "../src/domain/destination-images";
import { validateMediaRegistry } from "../src/domain/media/validation";
import { localMediaFileErrors } from "../scripts/lib/media-local-files";
import { approvedDestinationContent } from "./fixtures/archived-destination-data";
import { approvedMediaSubjects } from "./fixtures/approved-media";

const subjects = [
  "crete",
  "istanbul",
  "prishtina",
  "prizren",
  "skopje",
  "thessaloniki",
  "ulcinj",
  "zurich",
];
const withheld = ["brezovica", "mavrovo", "mirusha", "rugova"];
const reviewRoot =
  "docs/research/destination-media/catalogue-batch-01/final-review/";

test("batch 01 integrates exactly the eight owner-approved photographs and both pinned crop roles", async (t) => {
  t.mock.method(globalThis, "fetch", async () =>
    assert.fail("No runtime media research"),
  );
  assert.equal(approval.reviewer, "GoEksplo Owner");
  assert.deepEqual(approval.scope, subjects);
  assert.deepEqual(approval.excludedSubjects, withheld);
  for (const [file, hash] of Object.entries(approval.reviewPacket.files))
    assert.equal(
      createHash("sha256")
        .update(readFileSync(reviewRoot + file))
        .digest("hex"),
      hash,
    );
  const checked = validateMediaRegistry(media, placeIdentities);
  assert.equal(checked.ok, true, checked.errors.join(","));
  if (!checked.ok) throw Error("registry");
  assert.deepEqual(localMediaFileErrors(checked.data.assets), []);
  assert.deepEqual(
    [...new Set(media.selections.map((s) => s.subject))].sort(),
    approvedMediaSubjects,
  );
  assert.equal(media.assets.length, approvedMediaSubjects.length);
  assert.equal(media.selections.length, approvedMediaSubjects.length * 2);
  for (const row of approval.assets) {
    const asset = media.assets.find((a) => a.id === row.assetId)!;
    assert.deepEqual(
      {
        ...asset,
        localDelivery: {
          ...asset.localDelivery,
          variants: beforeGuideResize(asset.localDelivery.variants),
        },
      },
      row.reviewedAsset,
    );
    for (const role of ["destination.hero", "destination.card"] as const) {
      const selected = media.selections.find(
        (s) => s.subject === row.subject && s.role === role,
      )!;
      assert.equal(selected.method, "human-review");
      assert.equal(
        selected.history[0]?.reviewedAt ?? selected.reviewedAt,
        approval.reviewedAt,
      );
      assert.equal(selected.locked, true);
      assert.deepEqual(
        {
          ...selected.reviewedLocalDelivery,
          variants: beforeGuideResize(selected.reviewedLocalDelivery.variants),
        },
        row.reviewedLocalDelivery,
      );
      const result = await approvedPlaceMedia.get(row.subject, role);
      assert.equal(result.status, "approved");
      if (result.status !== "approved") throw Error("media");
      assert.equal(result.image.assetId, row.assetId);
      assert.deepEqual(result.image.focalPoint, row.focalPoint);
      assert.deepEqual(
        result.image.localVariants?.map((v) => v.width),
        row.subject === "istanbul" ? guideWidths : [640, 1200, 1920],
      );
      assert.equal(
        trustedDestinationImage(displayImageAsset(result.image), row.subject),
        true,
      );
    }
  }
});

test("accepted identity mappings preserve historical identities and content gates", async () => {
  assert.equal(placeIdentities.length, 35);
  for (const row of approval.identityAcceptance) {
    assert.deepEqual(placeRegistry.get(row.subject), row.identity);
    assert.equal(
      createHash("sha256").update(JSON.stringify(row.identity)).digest("hex"),
      row.identitySha256,
    );
    assert.equal(
      row.identity.confidence,
      row.existingIdentityPreserved ? "high" : "reviewed",
    );
  }
  assert.deepEqual(placeRegistry.get("skopje")?.iataCodes, ["SKP"]);
  assert.deepEqual(placeRegistry.get("thessaloniki")?.iataCodes, ["SKG"]);
  assert.deepEqual(placeRegistry.get("zurich")?.iataCodes, ["ZRH"]);
  for (const subject of [
    "crete",
    "istanbul",
    "prishtina",
    "vienna",
    "london",
    "paris",
    "place:Q60",
  ])
    assert.equal(
      (await approvedDestinationContent.get(subject)).status,
      "reviewed",
    );
  for (const subject of [
    "prizren",
    "skopje",
    "thessaloniki",
    "ulcinj",
    "zurich",
  ])
    assert.equal(
      (await approvedDestinationContent.get(subject)).status,
      "none",
      "A photo must not publish new editorial content",
    );
});

test("four unresolved identities and superseded Prishtina photograph remain unpublished", async () => {
  for (const subject of withheld) {
    assert.equal(placeRegistry.get(subject), undefined);
    for (const role of ["destination.hero", "destination.card"] as const)
      assert.deepEqual(await approvedPlaceMedia.get(subject, role), {
        status: "none",
        reason: "missing-selection",
      });
  }
  assert.equal(
    media.assets.some((a) => a.id === approval.withheldPrishtinaAssetId),
    false,
  );
  assert.equal(
    media.assets.some((a) => a.id === "commons:148809793"),
    true,
  );
});

test("CC0 replacement renders source/licence anchors, crop disclosure and responsive variants through the real component", async () => {
  const result = await approvedPlaceMedia.get("prishtina", "destination.hero");
  if (result.status !== "approved") throw Error("media");
  const image = displayImageAsset(result.image);
  const html = renderInChild(
    `
    const {createElement:h}=require('react');const {renderToStaticMarkup}=require('react-dom/server');
    const {ImageAssetBoundary,DestinationImage}=require('./.test-build/src/components/travel/DestinationImage.js');
    const {ImageAttribution}=require('./.test-build/src/components/travel/Provenance.js');
    const image=${CHILD_INPUT};const t=require('./.test-build/src/i18n/en.json');
    globalThis.fetch=async()=>{throw Error('No runtime image research');};
    process.stdout.write(renderToStaticMarkup(h(ImageAssetBoundary,{image,destination:{id:'prishtina',name:{en:'Prishtina',sq:'Prishtina'}},locale:'en'},h(DestinationImage,{fallbackAlt:'Prishtina',width:1200,height:675}),h(ImageAttribution,{t}))));
  `,
    image,
  );
  assert.ok(html.includes(`href="${image.photoUrl}"`));
  assert.ok(
    html.includes('href="https://creativecommons.org/publicdomain/zero/1.0/"'),
  );
  assert.match(html, /Planeti/);
  assert.match(html, /CC0/);
  assert.doesNotMatch(html, /CC BY-SA|share-alike/);
  assert.match(html, /cropped/i);
  assert.match(
    html,
    /prishtina-2024-640.webp 640w, \/destinations\/prishtina-2024-1200.webp 1200w, \/destinations\/prishtina-2024-1920.webp 1920w/,
  );
});
