// Historical record/access regression. Live archive exclusion is tested in destination-archive.test.ts.
import { publishedDestinationIds } from "./fixtures/published-destinations";
import { test } from "node:test";
import assert from "node:assert/strict";
import type { DestinationContentData } from "../src/domain/destination-content/types";
import {
  safeContentSourceUrl,
  validateDestinationContentData,
} from "../src/domain/destination-content/validation";
import { createReviewedDestinationContentStore } from "../src/content/runtime/store";
import { approvedDestinationContent } from "./fixtures/archived-destination-data";
import { destinationContentData } from "./fixtures/archived-destination-data";
import {
  contentFixtureContext,
  contentTestIdentity,
  contentTestNow,
  destinationContentFixture,
} from "./fixtures/destination-content";

const validate = (data: unknown) =>
  validateDestinationContentData(data, contentFixtureContext());
const storeFor = (data: unknown, clock = () => contentTestNow) =>
  createReviewedDestinationContentStore(data, contentFixtureContext(), clock);
const destinationId = contentTestIdentity.subject;

test("content store validates and returns reviewed localized partial content without researching", async (t) => {
  let calls = 0;
  t.mock.method(globalThis, "fetch", async () => {
    calls++;
    throw Error("unexpected external request");
  });
  const data = destinationContentFixture();
  assert.equal(validate(data).ok, true);
  const store = storeFor(data);
  const result = await store.get(destinationId);
  assert.equal(result.status, "reviewed");
  if (result.status !== "reviewed") throw Error("fixture");
  assert.equal(result.content.attractions?.[0].kind, "landmark");
  assert.equal(
    result.content.practicalNotes?.[0].observedPrice?.currency,
    "EUR",
  );
  assert.deepEqual(
    result.content.dayTemplates?.[0].stops.map((s) => s.attractionId),
    ["attraction:synthetic:one"],
  );
  assert.equal(result.content.attractions?.[0].media, undefined);
  assert.deepEqual(await store.get("unknown-city"), {
    status: "none",
    reason: "missing-record",
  });
  assert.equal(calls, 0);
});

test("historical publication snapshot retains approved records and keeps every draft hidden", async (t) => {
  let calls = 0;
  t.mock.method(globalThis, "fetch", async () => {
    calls++;
    throw Error("must not fetch");
  });
  assert.deepEqual(
    destinationContentData.records
      .filter((r) => r.reviewStatus === "reviewed")
      .map((r) => r.destinationId),
    publishedDestinationIds,
  );
  for (const record of destinationContentData.records) {
    const result = await approvedDestinationContent.get(record.destinationId);
    if (publishedDestinationIds.includes(record.destinationId)) {
      assert.equal(result.status, "reviewed");
      continue;
    }
    assert.equal(record.reviewStatus, "draft");
    assert.equal(record.reviewedAt, null);
    assert.equal(record.publication, undefined);
    assert.deepEqual(result, { status: "none", reason: "not-reviewed" });
  }
  assert.deepEqual(await approvedDestinationContent.get(destinationId), {
    status: "none",
    reason: "missing-record",
  });
  assert.equal(calls, 0);
});

const invalidCases: [string, (data: DestinationContentData) => void][] = [
  [
    "duplicate destination IDs",
    (d) => {
      d.records.push(structuredClone(d.records[0]));
    },
  ],
  [
    "unknown destination references",
    (d) => {
      d.records[0].destinationId = "unknown";
      d.records[0].identitySubject = "unknown";
    },
  ],
  [
    "mismatched identity references",
    (d) => {
      d.records[0].identitySubject = "other";
    },
  ],
  [
    "duplicate attraction IDs",
    (d) => {
      d.records[0].attractions!.push(
        structuredClone(d.records[0].attractions![0]),
      );
    },
  ],
  [
    "same attraction entity with another internal ID",
    (d) => {
      const a = structuredClone(d.records[0].attractions![0]);
      a.id = "attraction:synthetic:two";
      d.records[0].attractions!.push(a);
    },
  ],
  [
    "attraction destination mismatch",
    (d) => {
      d.records[0].attractions![0].destinationId = "another";
    },
  ],
  [
    "broken day-template stop reference",
    (d) => {
      d.records[0].dayTemplates![0].stops[0].attractionId = "unknown";
    },
  ],
  [
    "duplicate day-template stop references",
    (d) => {
      d.records[0].dayTemplates![0].stops.push({
        attractionId: "attraction:synthetic:one",
      });
    },
  ],
  [
    "empty day template",
    (d) => {
      d.records[0].dayTemplates![0].stops = [];
    },
  ],
  [
    "invalid suitable nights",
    (d) => {
      d.records[0].dayTemplates![0].suitableNights = [0];
    },
  ],
  [
    "duplicate source IDs",
    (d) => {
      d.records[0].sources.push(structuredClone(d.records[0].sources[0]));
    },
  ],
  [
    "missing root provenance",
    (d) => {
      d.records[0].sourceIds = [];
    },
  ],
  [
    "missing attraction provenance",
    (d) => {
      d.records[0].attractions![0].sourceIds = [];
    },
  ],
  [
    "unknown source reference",
    (d) => {
      d.records[0].overview!.sourceIds = ["source:unknown"];
    },
  ],
  [
    "invalid timestamp",
    (d) => {
      d.records[0].reviewedAt = "2026-02-30T00:00:00Z";
    },
  ],
  [
    "reviewed record without review timestamp",
    (d) => {
      d.records[0].reviewedAt = null;
    },
  ],
  [
    "draft with claimed review timestamp",
    (d) => {
      d.records[0].reviewStatus = "draft";
    },
  ],
  [
    "unsupported review state",
    (d) => {
      Object.assign(d.records[0], { reviewStatus: "approved" });
    },
  ],
  [
    "unsupported attraction type",
    (d) => {
      Object.assign(d.records[0].attractions![0], { kind: "best-place" });
    },
  ],
  [
    "invalid coordinates",
    (d) => {
      d.records[0].attractions![0].coordinates = { latitude: 91, longitude: 0 };
    },
  ],
  [
    "reversed visit duration",
    (d) => {
      d.records[0].attractions![0].typicalVisitMinutes = {
        minimum: 60,
        maximum: 30,
      };
    },
  ],
  [
    "invalid area bounds",
    (d) => {
      d.records[0].areas![0].bounds!.north = -90;
    },
  ],
  [
    "missing EN overview",
    (d) => {
      delete d.records[0].overview!.text.en;
    },
  ],
  [
    "missing EN attraction name",
    (d) => {
      delete d.records[0].attractions![0].name.en;
    },
  ],
  [
    "missing EN day stop note",
    (d) => {
      delete d.records[0].dayTemplates![0].stops[0].notes!.en;
    },
  ],
  [
    "empty translated value",
    (d) => {
      d.records[0].areas![0].summary.sq = "  ";
    },
  ],
  [
    "HTML source text",
    (d) => {
      d.records[0].overview!.text.en = "<script>alert(1)</script>";
    },
  ],
  [
    "oversized source text",
    (d) => {
      d.records[0].overview!.text.en = "x".repeat(1201);
    },
  ],
  [
    "unknown stored fields",
    (d) => {
      Object.assign(d.records[0], { rawHTML: "unreviewed payload" });
    },
  ],
  [
    "unknown coordinate metadata",
    (d) => {
      Object.assign(d.records[0].attractions![0].coordinates!, {
        rawHTML: "unreviewed metadata",
      });
    },
  ],
  [
    "unknown nested stored fields",
    (d) => {
      Object.assign(d.records[0].attractions![0], {
        privateToken: "not-a-real-token",
      });
    },
  ],
  [
    "unknown source fields",
    (d) => {
      Object.assign(d.records[0].sources[0], { rawHTML: "copied response" });
    },
  ],
  [
    "unsafe source URL",
    (d) => {
      d.records[0].sources[1].url = "http://example.org/source";
    },
  ],
  [
    "missing official source URL",
    (d) => {
      delete d.records[0].sources[1].url;
    },
  ],
  [
    "source observation after retrieval",
    (d) => {
      d.records[0].sources[1].retrievedAt = "2026-10-08T00:00:00Z";
    },
  ],
  [
    "volatile missing observation",
    (d) => {
      Object.assign(d.records[0].practicalNotes![0].freshness, {
        observedAt: undefined,
      });
    },
  ],
  [
    "volatile missing expiry",
    (d) => {
      Object.assign(d.records[0].practicalNotes![0].freshness, {
        validUntil: undefined,
      });
    },
  ],
  [
    "volatile excessive lifetime",
    (d) => {
      Object.assign(d.records[0].practicalNotes![0].freshness, {
        validUntil: "2027-10-09T00:00:00Z",
      });
    },
  ],
  [
    "volatile without official provenance",
    (d) => {
      d.records[0].sources[1].type = "internal-reviewed";
    },
  ],
  [
    "volatile mismatched source observation",
    (d) => {
      d.records[0].sources[1].observedAt = "2026-10-08T00:00:00Z";
    },
  ],
  [
    "price without currency",
    (d) => {
      Object.assign(d.records[0].practicalNotes![0].observedPrice!, {
        currency: undefined,
      });
    },
  ],
  [
    "negative observed price",
    (d) => {
      d.records[0].practicalNotes![0].observedPrice!.amount = -1;
    },
  ],
  [
    "price without matching observation",
    (d) => {
      d.records[0].practicalNotes![0].observedPrice!.observedAt =
        "2026-10-08T00:00:00Z";
    },
  ],
  [
    "price with stable freshness",
    (d) => {
      d.records[0].practicalNotes![0].freshness = { kind: "stable" };
    },
  ],
  [
    "price older than its thirty-day policy",
    (d) => {
      Object.assign(d.records[0].practicalNotes![0].freshness, {
        validUntil: "2026-11-10T00:00:00Z",
      });
    },
  ],
  [
    "stable entry requirement",
    (d) => {
      d.records[0].practicalNotes![0].kind = "entry";
      d.records[0].practicalNotes![0].freshness = { kind: "stable" };
      delete d.records[0].practicalNotes![0].observedPrice;
    },
  ],
  [
    "stable seasonal claim",
    (d) => {
      d.records[0].practicalNotes![0].kind = "seasonal";
      d.records[0].practicalNotes![0].freshness = { kind: "stable" };
      delete d.records[0].practicalNotes![0].observedPrice;
    },
  ],
  [
    "unknown media reference",
    (d) => {
      d.records[0].attractions![0].media = {
        subject: "attraction:synthetic:one",
        role: "attraction.primary",
      };
    },
  ],
];
for (const [label, mutate] of invalidCases) {
  test(`destination content rejects ${label} and fails closed at runtime`, async () => {
    const data = destinationContentFixture();
    mutate(data);
    const result = validate(data);
    assert.equal(result.ok, false, label);
    assert.deepEqual(await storeFor(data).get(destinationId), {
      status: "none",
      reason: "invalid-record",
    });
  });
}

test("same-name attractions use separate stable IDs without name-based resolution", () => {
  const data = destinationContentFixture(),
    attraction = structuredClone(data.records[0].attractions![0]);
  attraction.id = "attraction:synthetic:other-same-name";
  delete attraction.externalIdentities;
  data.records[0].attractions!.push(attraction);
  assert.equal(validate(data).ok, true);
});

test("additional reviewed locales are preserved without implicit translation or fallback", async () => {
  const data = destinationContentFixture();
  data.records[0].overview!.text.de = "Synthetischer Testtext.";
  data.records[0].overview!.text["pt-BR"] = "Texto sintético de teste.";
  assert.equal(validate(data).ok, true);
  const result = await storeFor(data).get(destinationId);
  assert.equal(result.status, "reviewed");
  if (result.status === "reviewed")
    assert.equal(
      result.content.overview?.text["pt-BR"],
      "Texto sintético de teste.",
    );
});

test("draft and withdrawn records never publish", async () => {
  for (const reviewStatus of ["draft", "withdrawn"] as const) {
    const data = destinationContentFixture();
    data.records[0].reviewStatus = reviewStatus;
    if (reviewStatus === "draft") data.records[0].reviewedAt = null;
    assert.equal(validate(data).ok, true);
    assert.deepEqual(await storeFor(data).get(destinationId), {
      status: "none",
      reason: "not-reviewed",
    });
  }
});

test("withdrawn/draft sections are filtered and dependent day templates cannot leak withdrawn attractions", async () => {
  const data = destinationContentFixture();
  data.records[0].attractions![0].reviewStatus = "withdrawn";
  data.records[0].highlights![0].reviewStatus = "draft";
  data.records[0].highlights![0].reviewedAt = null;
  const result = await storeFor(data).get(destinationId);
  assert.equal(result.status, "reviewed");
  if (result.status === "reviewed") {
    assert.deepEqual(result.content.attractions, []);
    assert.deepEqual(result.content.highlights, []);
    assert.deepEqual(result.content.dayTemplates, []);
    assert.ok(result.content.overview);
  }
});

test("volatile and periodic sections expire on each read even across a long-lived process", async () => {
  let now = contentTestNow;
  const store = storeFor(destinationContentFixture(), () => now);
  const before = await store.get(destinationId);
  assert.equal(
    before.status === "reviewed" && before.content.practicalNotes?.length,
    1,
  );
  now = Date.parse("2026-10-15T00:00:00Z");
  const expired = await store.get(destinationId);
  assert.equal(expired.status, "reviewed");
  if (expired.status === "reviewed") {
    assert.deepEqual(expired.content.practicalNotes, []);
    assert.equal(
      expired.content.sources.some((s) => s.id === "source:synthetic:official"),
      false,
    );
    assert.equal(expired.content.transport?.length, 1);
  }
  now = Date.parse("2026-10-31T00:00:00Z");
  const later = await store.get(destinationId);
  assert.equal(
    later.status === "reviewed" && later.content.transport?.length,
    0,
  );
});

test("stale-only content returns none while an incomplete but current overview remains useful", async () => {
  const data = destinationContentFixture();
  delete data.records[0].overview;
  delete data.records[0].highlights;
  delete data.records[0].attractions;
  delete data.records[0].areas;
  delete data.records[0].transport;
  delete data.records[0].dayTemplates;
  assert.deepEqual(
    await storeFor(data, () => Date.parse("2026-10-16T00:00:00Z")).get(
      destinationId,
    ),
    { status: "none", reason: "no-current-content" },
  );
  data.records[0].overview = destinationContentFixture().records[0].overview;
  assert.equal((await storeFor(data).get(destinationId)).status, "reviewed");
});

test("future review and source observation dates never appear as current", async () => {
  const data = destinationContentFixture();
  data.records[0].reviewedAt = "2026-10-11T00:00:00Z";
  assert.deepEqual(await storeFor(data).get(destinationId), {
    status: "none",
    reason: "not-reviewed",
  });
  data.records[0].reviewedAt = "2026-10-10T00:00:00Z";
  data.records[0].attractions![0].reviewedAt = "2026-10-11T00:00:00Z";
  data.records[0].sources[0].retrievedAt = "2026-10-11T00:00:00Z";
  assert.deepEqual(await storeFor(data).get(destinationId), {
    status: "none",
    reason: "not-reviewed",
  });
  delete data.records[0].sources[0].retrievedAt;
  const result = await storeFor(data).get(destinationId);
  assert.equal(
    result.status === "reviewed" && result.content.attractions?.length,
    0,
  );
});

test("validated input, identity context and returned records cannot mutate private runtime approval", async () => {
  const data = destinationContentFixture(),
    context = contentFixtureContext();
  const store = createReviewedDestinationContentStore(
    data,
    context,
    () => contentTestNow,
  );
  data.records[0].overview!.text.en = "mutated input";
  data.records[0].reviewStatus = "withdrawn";
  context.identities = [];
  const first = await store.get(destinationId);
  assert.equal(first.status, "reviewed");
  if (first.status !== "reviewed") throw Error("fixture");
  first.content.overview!.text.en = "mutated output";
  first.content.attractions!.length = 0;
  const second = await store.get(destinationId);
  assert.equal(second.status, "reviewed");
  if (second.status === "reviewed") {
    assert.equal(
      second.content.overview!.text.en,
      "A synthetic overview for acceptance testing.",
    );
    assert.equal(second.content.attractions?.length, 1);
  }
});

test("corrupt/circular stores and invalid clocks fail closed", async () => {
  const circular: Record<string, unknown> = {};
  circular.self = circular;
  for (const corrupt of [
    undefined,
    null,
    {},
    [],
    "not data",
    circular,
    { schemaVersion: 2, records: [] },
  ])
    assert.deepEqual(await storeFor(corrupt).get(destinationId), {
      status: "none",
      reason: "invalid-record",
    });
  for (const clock of [
    () => NaN,
    () => {
      throw Error("clock unavailable");
    },
  ])
    assert.deepEqual(
      await storeFor(destinationContentFixture(), clock).get(destinationId),
      { status: "none", reason: "invalid-record" },
    );
});

test("registered attraction media remains only a reserved reference, never an approved image", async () => {
  const data = destinationContentFixture(),
    context = contentFixtureContext();
  data.records[0].attractions![0].media = {
    subject: "attraction:synthetic:one",
    role: "attraction.primary",
  };
  context.mediaSubjects = ["attraction:synthetic:one"];
  assert.equal(validateDestinationContentData(data, context).ok, true);
  const result = await createReviewedDestinationContentStore(
    data,
    context,
    () => contentTestNow,
  ).get(destinationId);
  assert.equal(result.status, "reviewed");
  if (result.status === "reviewed")
    assert.deepEqual(result.content.attractions![0].media, {
      subject: "attraction:synthetic:one",
      role: "attraction.primary",
    });
  Object.assign(data.records[0].attractions![0].media!, {
    src: "https://example.org/image.jpg",
  });
  assert.equal(validateDestinationContentData(data, context).ok, false);
});

test("Wikidata and OSM provenance keep entity identity and licensing instead of copied descriptions", () => {
  const data = destinationContentFixture();
  data.records[0].sources.push({
    id: "source:synthetic:wikidata",
    type: "wikidata",
    title: "Synthetic entity source",
    publisher: "Wikidata",
    externalId: { authority: "wikidata", id: "Q900000002" },
    url: "https://www.wikidata.org/wiki/Q900000002",
  });
  data.records[0].sources.push({
    id: "source:synthetic:osm",
    type: "openstreetmap",
    title: "Synthetic OSM source",
    publisher: "OpenStreetMap",
    externalId: { authority: "openstreetmap", id: "node/900000002" },
    url: "https://www.openstreetmap.org/node/900000002",
    licensing: {
      identifier: "ODbL-1.0",
      url: "https://opendatacommons.org/licenses/odbl/1.0/",
      attribution: "© OpenStreetMap contributors",
    },
  });
  assert.equal(validate(data).ok, true);
  delete data.records[0].sources[3].licensing;
  assert.equal(validate(data).ok, false);
});

test("official source URL validation rejects unsafe references without any URL fetching", () => {
  assert.equal(
    safeContentSourceUrl("https://example.org/transport?language=en"),
    true,
  );
  for (const url of [
    "http://example.org/",
    "https://user:password@example.org/",
    "https://example.org:443/",
    "https://127.0.0.1/",
    "https://[::1]/",
    "https://localhost/",
    "https://service.internal/",
    "https://example.org/page#unsafe",
    "https://example.org/%0d%0a",
    "javascript:alert(1)",
  ])
    assert.equal(safeContentSourceUrl(url), false, url);
});
