import { test } from "node:test";
import assert from "node:assert/strict";
import registry from "../content/media/approved.json";
import approval from "../docs/research/destination-media/worldwide-v1/owner-approval.json";
import { placeIdentities } from "../src/places/runtime/registry";
import { approvedPlaceMedia } from "../src/media/runtime/approved";
import { createReviewedMediaStore } from "../src/media/runtime/store";
import { localMediaFileErrors } from "../scripts/lib/media-local-files";
import {
  localDeliveryValid,
  validateMediaRegistry,
  validateMediaData,
  validateMediaChanges,
} from "../src/domain/media/validation";

function snapshot() {
  const checked = validateMediaRegistry(registry, placeIdentities);
  assert.equal(checked.ok, true, checked.errors.join(","));
  if (!checked.ok) throw Error("registry");
  return structuredClone(checked.data);
}
function paris(data: ReturnType<typeof snapshot>) {
  return data.assets.find((a) => a.id === "commons:4213147")!;
}
function pin(data: ReturnType<typeof snapshot>) {
  const asset = paris(data);
  for (const s of data.selections.filter((s) => s.assetId === asset.id))
    s.reviewedLocalDelivery = structuredClone(asset.localDelivery);
}

test("owner-approved Paris/New York crops publish both roles while preserving source evidence", async () => {
  const data = snapshot();
  assert.equal(approval.reviewer, "GoEksplo Owner");
  assert.equal(approval.localIntegration.reviewer, "GoEksplo Owner");
  assert.deepEqual(localMediaFileErrors(data.assets), []);
  for (const row of approval.assets) {
    const asset = data.assets.find((a) => a.id === row.assetId)!;
    assert.equal(asset.width, row.originalDimensions.width);
    assert.equal(asset.height, row.originalDimensions.height);
    assert.deepEqual(asset.checksum, row.originalChecksum);
    assert.equal(asset.sourcePage, row.sourcePage);
    assert.equal(asset.license!.url, row.licence.url);
    assert.ok(asset.width / asset.height > 2.5);
    assert.ok(
      asset.localDelivery!.crop!.width / asset.localDelivery!.crop!.height <=
        2.5,
    );
    assert.deepEqual(
      asset.localDelivery!.variants.map((v) => [v.width, v.height]),
      [
        ...(row.subject === "paris" ? [[320, 128]] : []),
        [640, 256],
        ...(row.subject === "paris" ? [[800, 320]] : []),
        [1200, 480],
        [1920, 768],
      ],
    );
    assert.match(asset.attribution, /cropped and resized to WebP/);
    for (const role of ["destination.hero", "destination.card"] as const) {
      const image = await approvedPlaceMedia.get(row.subject, role);
      assert.equal(image.status, "approved");
      if (image.status !== "approved") throw Error("image");
      assert.equal(image.image.subject, row.subject);
      assert.deepEqual(image.image.focalPoint, row.approvedFocalPoint);
    }
  }
  for (const subject of ["brezovica", "mavrovo", "mirusha", "rugova"])
    for (const role of ["destination.hero", "destination.card"] as const)
      assert.equal(
        (await approvedPlaceMedia.get(subject, role)).status,
        "none",
      );
});

test("crop boundaries and exact shape are enforced even when every selection is repinned", () => {
  const valid = paris(snapshot());
  const crop = valid.localDelivery!.crop!;
  for (const bad of [
    { ...crop, left: -1 },
    { ...crop, top: -1 },
    { ...crop, width: 0 },
    { ...crop, height: 0 },
    { ...crop, left: valid.width },
    { ...crop, top: 1 },
    { ...crop, width: valid.width },
    { ...crop, left: 0.5 },
    { ...crop, height: NaN },
    { ...crop, extra: 1 },
    null,
  ]) {
    assert.equal(
      localDeliveryValid(
        { ...valid.localDelivery, crop: bad },
        valid.width,
        valid.height,
      ),
      false,
    );
  }
  const data = snapshot();
  paris(data).localDelivery!.crop!.left = -1;
  pin(data);
  assert.equal(validateMediaData(data).ok, false);
});

test("crop support cannot admit unrelated originals, undersized frames or unsuitable ratios", () => {
  const data = snapshot(),
    asset = paris(data);
  const local = asset.localDelivery!;
  // Existing non-panoramic Vienna data cannot acquire this exception.
  assert.equal(
    localDeliveryValid(
      {
        ...data.assets[0].localDelivery,
        crop: { left: 0, top: 0, width: 5000, height: 3000 },
      },
      5184,
      3456,
    ),
    false,
  );
  for (const frame of [
    { left: 0, top: 0, width: 1000, height: 400 },
    { left: 0, top: 0, width: 6000, height: 2000 },
  ]) {
    const d = snapshot(),
      a = paris(d);
    a.localDelivery!.crop = frame;
    a.localDelivery!.variants = [640, 800].map((width) => ({
      src: `/destinations/paris-${width}.webp`,
      width,
      height: Math.round((width * frame.height) / frame.width),
      bytes: 100,
      sha256: "0".repeat(64),
    }));
    a.localDelivery!.src = "/destinations/paris-640.webp";
    pin(d);
    assert.ok(
      validateMediaData(d).errors.some((e) =>
        e.includes("unsuitable-dimensions"),
      ),
    );
  }
  assert.equal(
    localDeliveryValid(
      { ...local, crop: undefined },
      asset.width,
      asset.height,
    ),
    false,
  );
});

test("panoramas cannot bypass explicit human review, delivery pins or the remote-source gate", async () => {
  for (const mutate of [
    (d: ReturnType<typeof snapshot>) => {
      d.selections.find((s) => s.subject === "paris")!.method = "policy";
    },
    (d: ReturnType<typeof snapshot>) => {
      d.selections.find((s) => s.subject === "paris")!.reviewedAt = null;
    },
    (d: ReturnType<typeof snapshot>) => {
      delete d.selections.find((s) => s.subject === "paris")!
        .reviewedLocalDelivery;
    },
    (d: ReturnType<typeof snapshot>) => {
      paris(d).localDelivery!.crop!.left++;
    },
    (d: ReturnType<typeof snapshot>) => {
      delete paris(d).localDelivery;
      for (const s of d.selections.filter((s) => s.subject === "paris"))
        delete s.reviewedLocalDelivery;
    },
  ]) {
    const d = snapshot();
    mutate(d);
    assert.equal(validateMediaData(d).ok, false);
    assert.equal(
      (await createReviewedMediaStore(d).get("paris", "destination.hero"))
        .status,
      "none",
    );
  }
});

test("crop or hash repinning still requires a new review revision and altered public bytes fail integrity checks", () => {
  const previous = snapshot(),
    changed = snapshot();
  paris(changed).localDelivery!.crop!.left++;
  pin(changed);
  assert.equal(validateMediaData(changed).ok, true);
  assert.ok(
    validateMediaChanges(changed, previous).includes(
      "selection-change-requires-next-review-revision",
    ),
  );
  const hashes = snapshot();
  paris(hashes).localDelivery!.variants[0].sha256 = "0".repeat(64);
  pin(hashes);
  assert.equal(validateMediaData(hashes).ok, true);
  assert.ok(
    localMediaFileErrors(hashes.assets).some((e) =>
      e.includes("paris-320.webp"),
    ),
  );
  assert.ok(validateMediaChanges(hashes, previous).length > 0);
  const dimensions = snapshot();
  paris(dimensions).localDelivery!.variants[0].height++;
  pin(dimensions);
  assert.ok(
    localMediaFileErrors(dimensions.assets).some((e) =>
      e.includes("paris-320.webp"),
    ),
  );
  const output = snapshot();
  paris(output).localDelivery!.variants[0].height = 10;
  pin(output);
  assert.equal(validateMediaData(output).ok, false);
});
