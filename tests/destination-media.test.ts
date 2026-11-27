import { placeIdentities } from "../src/places/runtime/registry";
import { validateMediaRegistry } from "../src/domain/media/validation";
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import approvedFixture from "./fixtures/media/approved.synthetic.json";
import type {
  MediaAsset,
  PlaceMediaData,
  MediaSelection,
  MediaEvidence,
} from "../src/domain/media/types";
import {
  validateMediaData,
  safeMediaUrl,
} from "../src/domain/media/validation";
import { createReviewedMediaStore } from "../src/media/runtime/store";
import { displayImageAsset } from "../src/media/runtime/display";
import { createDestinationImages } from "../src/providers/server/images";
import { trustedDestinationImage } from "../src/domain/destination-images";
import { demoProviders } from "../src/providers/demo";
import {
  evaluateCandidate,
  DESTINATION_VETO_TAGS,
  depictionTags,
} from "../src/media/operator/evaluate";
import {
  AUTOMATIC_MEDIA_APPROVAL,
  AUTOMATIC_MEDIA_INGESTION,
} from "../src/domain/media/policy";
import { discoverDestinationMedia } from "../src/media/operator/discover";

export const mediaFixture = () =>
  structuredClone(approvedFixture) as PlaceMediaData;
const identity = mediaFixture().places[0];
const evidence: MediaEvidence = {
  entity: identity.external!,
  exactEntityImage: true,
  exactDepicts: true,
  depictionTags: ["cityscape"],
  articleUsage: true,
  recognizedQuality: true,
  withinBounds: true,
};
test("source-controlled approved card/hero are stable, localized, focal and compatible with Phase 2.2", async () => {
  const data = mediaFixture(),
    store = createReviewedMediaStore(data);
  assert.equal(validateMediaData(data).ok, true);
  const first = await store.get(identity.subject, "destination.card");
  assert.equal(first.status, "approved");
  if (first.status !== "approved") throw Error("fixture");
  assert.equal(
    trustedDestinationImage(displayImageAsset(first.image), identity.subject),
    true,
  );
  assert.deepEqual(
    await store.get(identity.subject, "destination.card"),
    first,
  );
  const hero = await store.get(identity.subject, "destination.hero");
  assert.equal(hero.status, "approved");
  if (hero.status === "approved") {
    assert.equal(hero.image.assetId, first.image.assetId);
    assert.notDeepEqual(hero.image.focalPoint, first.image.focalPoint);
  }
  data.assets[0].originalUrl = "https://evil.test/changed.jpg";
  first.image.alt.en = "modified by caller";
  const again = await store.get(identity.subject, "destination.card");
  assert.equal(again.status, "approved");
  if (again.status === "approved")
    assert.notEqual(again.image.alt.en, first.image.alt.en);
  const d = (await demoProviders.destinations.list())[0];
  const provider = createDestinationImages(
    [{ ...d, id: identity.subject }],
    store,
  );
  assert.equal(
    (await provider.forDestination(identity.subject))?.verification,
    "verified",
  );
  assert.deepEqual(
    (await provider.forDestination(identity.subject, "destination.hero"))
      ?.localizedAlt,
    approvedFixture.selections[0].alt,
  );
});
test("no approved selection, explicit none, rejected and corrupted records fail closed without fetch", async (t) => {
  let calls = 0;
  t.mock.method(globalThis, "fetch", async () => {
    calls++;
    throw Error("must not fetch");
  });
  assert.deepEqual(
    await createReviewedMediaStore(mediaFixture()).get(
      "unknown:anywhere",
      "destination.card",
    ),
    { status: "none", reason: "missing-selection" },
  );
  const data = mediaFixture();
  data.rejections.push({
    subject: identity.subject,
    assetId: data.assets[0].id,
    reason: "wrong main subject",
    reviewedAt: "2026-10-10T13:00:00Z",
  });
  assert.deepEqual(
    await createReviewedMediaStore(data).get(
      identity.subject,
      "destination.card",
    ),
    { status: "none", reason: "invalid-record" },
  );
  for (const bad of [null, {}, { ...data, assets: "wrong" }])
    assert.equal(
      (
        await createReviewedMediaStore(bad).get(
          identity.subject,
          "destination.card",
        )
      ).status,
      "none",
    );
  const none = mediaFixture();
  none.selections = [
    {
      ...none.selections[0],
      status: "none",
      assetId: null,
      method: "policy",
      reviewedAt: null,
      noneReason: "awaiting-review",
      alt: null,
      focalPoint: null,
      reviewedChecksum: null,
    },
  ];
  assert.deepEqual(
    await createReviewedMediaStore(none).get(
      identity.subject,
      "destination.card",
    ),
    { status: "none", reason: "awaiting-review" },
  );
  assert.equal(calls, 0);
});
const mutations: Array<[string, (d: PlaceMediaData) => void]> = [
  ["duplicate subject-role", (d) => d.selections.push(d.selections[0])],
  ["duplicate asset ID", (d) => d.assets.push(d.assets[0])],
  ["duplicate place", (d) => d.places.push(d.places[0])],
  ["malformed Wikidata", (d) => (d.places[0].external!.id = "Q1 OR unsafe")],
  ["unknown destination", (d) => (d.selections[0].subject = "not-registered")],
  [
    "HTTP asset",
    (d) =>
      (d.assets[0].originalUrl = d.assets[0].originalUrl!.replace(
        "https:",
        "http:",
      )),
  ],
  [
    "unexpected host",
    (d) => (d.assets[0].originalUrl = "https://example.com/file.jpg"),
  ],
  [
    "custom port",
    (d) =>
      (d.assets[0].originalUrl =
        "https://upload.wikimedia.org:443/wikipedia/commons/a.jpg"),
  ],
  [
    "URL credentials",
    (d) =>
      (d.assets[0].sourcePage =
        "https://user@commons.wikimedia.org/wiki/File:A.jpg"),
  ],
  [
    "query redirect",
    (d) => (d.assets[0].originalUrl += "?url=https://evil.test"),
  ],
  [
    "encoded path separator",
    (d) =>
      (d.assets[0].originalUrl =
        "https://upload.wikimedia.org/wikipedia/commons/%2funsafe.jpg"),
  ],
  ["SVG", (d) => (d.assets[0].mimeType = "image/svg+xml")],
  ["MIME mismatch", (d) => (d.assets[0].mimeType = "image/png")],
  ["missing attribution", (d) => (d.assets[0].attribution = "")],
  ["raw HTML", (d) => (d.assets[0].author = "<script>private</script>")],
  ["overlong metadata", (d) => (d.assets[0].author = "x".repeat(501))],
  ["missing licence", (d) => (d.assets[0].license = null)],
  [
    "unsafe licence",
    (d) =>
      (d.assets[0].license!.url =
        "https://creativecommons.org/licenses/by-nc/4.0/"),
  ],
  [
    "invalid licence date",
    (d) => (d.assets[0].license!.verifiedAt = "2026-02-31T00:00:00Z"),
  ],
  ["missing SQ alt", (d) => (d.selections[0].alt!.sq = "")],
  ["invalid focal", (d) => (d.selections[0].focalPoint!.x = 2)],
  ["checksum", (d) => (d.assets[0].checksum!.value = "wrong")],
  ["changed checksum", (d) => (d.assets[0].checksum!.value = "b".repeat(40))],
  [
    "unavailable asset",
    (d) =>
      (d.assets[0].health = {
        status: "unavailable",
        checkedAt: "2026-10-10T12:00:00Z",
      }),
  ],
  ["unreviewed approval", (d) => (d.selections[0].method = "policy")],
  ["unlocked approval", (d) => (d.selections[0].locked = false)],
  ["missing revision history", (d) => (d.selections[0].revision = 2)],
  [
    "reserved attraction role",
    (d) =>
      (d.selections[0].role = "attraction.primary" as MediaSelection["role"]),
  ],
];
for (const [name, mutate] of mutations)
  test(`approved media validation rejects ${name}`, async () => {
    const data = mediaFixture();
    mutate(data);
    assert.equal(validateMediaData(data).ok, false);
    assert.equal(
      (
        await createReviewedMediaStore(data).get(
          identity.subject,
          "destination.card",
        )
      ).status,
      "none",
    );
  });
test("selection withdrawal requires explicit review and valid sequential history", () => {
  const d = mediaFixture(),
    s = d.selections[0];
  d.selections = [
    {
      ...s,
      history: [s],
      revision: 2,
      status: "none",
      assetId: null,
      noneReason: "withdrawn",
      alt: null,
      focalPoint: null,
      reviewedChecksum: null,
      selectedAt: "2026-10-11T12:00:00Z",
      reviewedAt: "2026-10-11T12:00:00Z",
    },
  ];
  assert.equal(validateMediaData(d).ok, true);
  d.selections[0].noneReason = "awaiting-review";
  assert.equal(validateMediaData(d).ok, false);
});
test("source approval store is valid and contains no synthetic production assets", () => {
  const data = validateMediaRegistry(
    JSON.parse(readFileSync("content/media/approved.json", "utf8")),
    placeIdentities,
  );
  assert.equal(data.ok, true);
  assert.doesNotMatch(
    readFileSync("content/media/approved.json", "utf8"),
    /Synthetic|900001/,
  );
});
for (const tag of DESTINATION_VETO_TAGS)
  test(`hard veto ${tag} wins over every positive scoring signal`, () => {
    const c = evaluateCandidate(
      identity,
      "destination.hero",
      mediaFixture().assets[0],
      "T1",
      { ...evidence, depictionTags: ["cityscape", tag] },
    );
    assert.equal(c.decision, "rejected");
    assert.equal(c.evaluation.depiction.status, "fail");
    assert.ok(c.evaluation.vetoReasons.includes(`depiction:${tag}`));
    assert.equal(c.evaluation.score, 100);
  });
test("London pigeon and Crete flower use generic metadata vetoes, never place-specific branches", () => {
  for (const [name, description] of [
    ["London", "pigeon in a cityscape"],
    ["Crete", "flower close-up on a landscape"],
  ]) {
    const c = evaluateCandidate(
      { ...identity, subject: name.toLowerCase(), name },
      "destination.card",
      mediaFixture().assets[0],
      "T1",
      { ...evidence, depictionTags: depictionTags(description) },
    );
    assert.equal(c.decision, "rejected");
  }
});
test("diagnostic score, four gates and T3 never become approval or alter a locked selection", async () => {
  assert.equal(AUTOMATIC_MEDIA_APPROVAL, false);
  assert.equal(AUTOMATIC_MEDIA_INGESTION, false);
  const store = createReviewedMediaStore(mediaFixture()),
    before = await store.get(identity.subject, "destination.hero");
  for (const tier of ["T1", "T2", "T3"] as const) {
    const c = evaluateCandidate(
      identity,
      "destination.hero",
      mediaFixture().assets[0],
      tier,
      evidence,
    );
    assert.equal(c.evaluation.score, 100);
    assert.equal(c.decision, "pending-review");
    assert.deepEqual(
      Object.keys(c.evaluation).sort(),
      [
        "admissibility",
        "identity",
        "depiction",
        "roleFit",
        "score",
        "vetoReasons",
      ].sort(),
    );
    if (tier === "T3") assert.equal(c.evaluation.roleFit.status, "review");
  }
  assert.deepEqual(
    await store.get(identity.subject, "destination.hero"),
    before,
  );
});
test("unsafe licensing, tiny/malformed files and mismatched destination fail independent gates", () => {
  for (const patch of [
    { license: null },
    { width: 100 },
    { height: 100 },
    { mimeType: "image/svg+xml" },
  ]) {
    const c = evaluateCandidate(
      identity,
      "destination.card",
      { ...mediaFixture().assets[0], ...patch } as MediaAsset,
      "T1",
      evidence,
    );
    assert.equal(c.decision, "rejected");
    assert.ok(c.evaluation.vetoReasons.length);
  }
  const c = evaluateCandidate(
    identity,
    "destination.card",
    mediaFixture().assets[0],
    "T2",
    { ...evidence, entity: { authority: "wikidata", id: "Q123" } },
  );
  assert.equal(c.evaluation.identity.status, "fail");
});
test("offline operator discovery is read-only and calls no media/AI provider even with reviewed identity", async () => {
  let calls = 0;
  const report = await discoverDestinationMedia(
    identity,
    {
      live: false,
      role: "destination.card",
      reviewed: identity,
      rejections: [],
    },
    async () => {
      calls++;
      throw Error("forbidden");
    },
  );
  assert.equal(report.status, "offline");
  assert.equal(calls, 0);
  assert.deepEqual(report.candidates, []);
  assert.deepEqual(report.requests, { wikidata: 0, commons: 0 });
});
test("URL validation rejects URL normalization tricks", () => {
  for (const url of [
    "https://upload.wikimedia.org.evil.test/wikipedia/commons/a.jpg",
    "https://upload.wikimedia.org:443/wikipedia/commons/a.jpg",
    "https://upload.wikimedia.org/wikipedia/commons/../../elsewhere.jpg",
    "https://upload.wikimedia.org/wikipedia/commons/a.jpg#x",
  ])
    assert.equal(
      safeMediaUrl(url, "upload.wikimedia.org", "/wikipedia/commons/", true),
      false,
    );
});

test("committed selections cannot be silently rotated, edited, deleted or have rejections forgotten", async () => {
  const { validateMediaChanges } =
    await import("../src/domain/media/validation");
  const previous = mediaFixture();
  assert.deepEqual(validateMediaChanges(mediaFixture(), previous), []);
  const changed = mediaFixture();
  changed.assets[0].originalUrl = changed.assets[0].originalUrl!.replace(
    "skyline",
    "panorama",
  );
  assert.ok(
    validateMediaChanges(changed, previous).includes(
      "selection-change-requires-next-review-revision",
    ),
  );
  changed.selections = [];
  assert.ok(
    validateMediaChanges(changed, previous).includes(
      "selection-removal-requires-reviewed-withdrawal",
    ),
  );
  previous.rejections.push({
    subject: identity.subject,
    assetId: "commons:9999",
    reason: "Wrong scene",
    reviewedAt: "2026-10-10T12:00:00Z",
  });
  assert.ok(
    validateMediaChanges(mediaFixture(), previous).includes(
      "reviewed-rejection-removal-forbidden",
    ),
  );
});
