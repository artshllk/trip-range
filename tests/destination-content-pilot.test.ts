import { destinationContentData as liveContentData } from "../content/destinations/records";
import { placeIdentities } from "../src/places/runtime/registry";
import { validateMediaRegistry } from "../src/domain/media/validation";
import assert from "node:assert/strict";
import { test } from "node:test";
import { destinationContentData } from "./fixtures/archived-destination-data";
import { checkDestinationContentFiles } from "../scripts/lib/destination-content-files";
import {
  approvedDestinationContent,
  destinationContentValidationContext,
} from "./fixtures/archived-destination-data";
import { createReviewedDestinationContentStore } from "../src/content/runtime/store";
import { selectDestinationContent } from "../src/content/presentation";
import type {
  DestinationContent,
  DestinationContentData,
  SourcedContent,
} from "../src/domain/destination-content/types";
import {
  safeContentSourceUrl,
  validateDestinationContentData,
} from "../src/domain/destination-content/validation";
import { identityValid } from "../src/domain/media/validation";
import { createReviewedMediaStore } from "../src/media/runtime/store";
import {
  AUTOMATIC_MEDIA_APPROVAL,
  AUTOMATIC_MEDIA_INGESTION,
} from "../src/domain/media/policy";
import { disabledOsmContentEnrichment } from "../src/content/adapters/osm";
import { dynamicDestination } from "../src/domain/dynamic-destinations";
import {
  existingAirportCodes,
  flightDestinations,
} from "../src/catalogue/flight-destinations";
import { defaultRequest } from "./fixtures/prishtina-request";
import { pricePlan } from "../src/domain/pricing";
import { demoProviders } from "../src/providers/demo";
import { getTripTemplates } from "../src/services/travel";
import { seoSitemap } from "../src/seo/publication";
import { approvedLandingKeys } from "../src/seo/approved-keys";

const records = destinationContentData.records.filter((record) =>
  ["city:BCN", "crete", "prishtina"].includes(record.destinationId),
);
const validate = (data: unknown) =>
  validateDestinationContentData(data, destinationContentValidationContext);
const copy = (): DestinationContentData =>
  structuredClone(destinationContentData);
const facts = (record: DestinationContent): SourcedContent[] => [
  ...(record.overview ? [record.overview] : []),
  ...(record.highlights ?? []),
  ...(record.attractions ?? []),
  ...(record.areas ?? []),
  ...(record.transport ?? []),
  ...(record.practicalNotes ?? []),
  ...(record.dayTemplates ?? []),
];

test("pilot records validate; explicitly published Barcelona, Crete and Prishtina are reviewed", () => {
  assert.equal(records.length, 3);
  const checked = validate(destinationContentData);
  assert.deepEqual(checked.errors, []);
  assert.deepEqual(
    checkDestinationContentFiles(
      "content/destinations",
      liveContentData.records,
    ),
    {
      ok: true,
      files: liveContentData.records.length,
    },
  );
  for (const record of records) {
    assert.ok(
      ["city:BCN", "crete", "prishtina"].includes(record.destinationId),
    );
    assert.equal(record.identitySubject, record.destinationId);
    const status = "reviewed";
    const reviewedAt = record.publication!.approvedAt;
    assert.equal(record.reviewStatus, status);
    assert.equal(record.reviewedAt, reviewedAt);
    assert.ok(record.overview && record.attractions?.length);
    for (const fact of facts(record)) {
      assert.equal(fact.reviewStatus, status);
      assert.equal(fact.reviewedAt, reviewedAt);
    }
  }
});

test("in-memory pilot drafts stay absent at the store and presentation boundary, without network access", async (t) => {
  let calls = 0;
  t.mock.method(globalThis, "fetch", async () => {
    calls++;
    throw Error("Runtime destination research is forbidden");
  });
  const before = JSON.stringify(destinationContentData);
  const drafts = copy();
  for (const record of drafts.records) {
    for (const item of [record, ...facts(record)]) {
      item.reviewStatus = "draft";
      item.reviewedAt = null;
    }
    delete record.publication;
  }
  const draftStore = createReviewedDestinationContentStore(
    drafts,
    destinationContentValidationContext,
  );
  for (const record of drafts.records.filter(
    (r) => r.destinationId === "crete",
  )) {
    assert.equal(
      (await approvedDestinationContent.get(record.destinationId)).status,
      "reviewed",
    );
    const result = await draftStore.get(record.destinationId);
    assert.deepEqual(result, { status: "none", reason: "not-reviewed" });
    assert.equal(
      selectDestinationContent(result, record.destinationId),
      undefined,
    );
    assert.equal(
      selectDestinationContent(
        { status: "reviewed", content: record },
        record.destinationId,
      ),
      undefined,
      "A forged reviewed envelope cannot publish a draft record",
    );
  }
  for (const instant of ["2026-10-10T00:00:00Z", "2036-10-10T00:00:00Z"]) {
    const store = createReviewedDestinationContentStore(
      drafts,
      destinationContentValidationContext,
      () => Date.parse(instant),
    );
    for (const record of records.filter((r) => r.destinationId === "crete"))
      assert.deepEqual(await store.get(record.destinationId), {
        status: "none",
        reason: "not-reviewed",
      });
  }
  assert.equal(JSON.stringify(destinationContentData), before);
  assert.equal(calls, 0);
});

test("pilot identities agree with existing generic destination IDs and preserve the island entity", async () => {
  const byId = new Map(
    destinationContentValidationContext.identities.map((identity) => [
      identity.subject,
      identity,
    ]),
  );
  for (const record of records) {
    const identity = byId.get(record.destinationId);
    assert.ok(identity && identityValid(identity));
    assert.notEqual(identity.confidence, "unresolved");
    assert.equal(identity.external?.authority, "wikidata");
    assert.ok(identity.coordinates);
  }
  const barcelona = byId.get("city:BCN");
  if (barcelona) {
    assert.equal(barcelona.placeKind, "city");
    assert.equal(barcelona.countryCode, "ES");
    assert.equal(barcelona.cityCode, "BCN");
    assert.deepEqual(barcelona.external, {
      authority: "wikidata",
      id: "Q1492",
    });
    assert.equal(
      dynamicDestination({
        id: "city:BCN",
        type: "city",
        cityCode: "BCN",
        name: "Barcelona",
        countryCode: "ES",
        countryName: { en: "Spain", sq: "Spanja" },
      }).id,
      barcelona.subject,
    );
  }
  const crete = byId.get("crete");
  if (crete) {
    assert.equal(crete.placeKind, "island");
    assert.equal(crete.countryCode, "GR");
    assert.equal(
      crete.cityCode,
      undefined,
      "The island must not impersonate one airport city",
    );
    assert.deepEqual(crete.external, { authority: "wikidata", id: "Q34374" });
    assert.deepEqual(
      [...(crete.iataCodes ?? [])].sort(),
      [...existingAirportCodes.crete].sort(),
    );
    assert.ok(
      (await demoProviders.destinations.list()).some(
        (destination) => destination.id === crete.subject,
      ),
    );
  }
  const prishtina = byId.get("prishtina");
  if (prishtina) {
    assert.equal(prishtina.placeKind, "city");
    assert.equal(prishtina.countryCode, "XK");
    assert.deepEqual(prishtina.external, {
      authority: "wikidata",
      id: "Q25270",
    });
    assert.deepEqual(prishtina.iataCodes, ["PRN"]);
    assert.ok(
      flightDestinations.some(
        (destination) => destination.id === prishtina.subject,
      ),
    );
  }
});

test("every pilot claim has traceable safe source references and no imported OSM content", async () => {
  const externalAttractions = new Set<string>();
  for (const record of records) {
    const sourceIds = new Set(record.sources.map((source) => source.id));
    assert.equal(sourceIds.size, record.sources.length);
    for (const fact of [record, ...facts(record)]) {
      assert.ok(fact.sourceIds.length);
      for (const id of fact.sourceIds) assert.ok(sourceIds.has(id), id);
    }
    for (const source of record.sources) {
      assert.ok(safeContentSourceUrl(source.url), source.id);
      assert.ok(source.title.trim() && source.publisher.trim());
      assert.ok(source.retrievedAt || source.observedAt, source.id);
      assert.notEqual(source.type, "openstreetmap");
      assert.doesNotMatch(
        source.url!,
        /(?:example\.(?:org|com)|tripadvisor\.|google\.[^/]+\/maps|booking\.com)/i,
      );
    }
    for (const template of record.dayTemplates ?? []) {
      const selected = new Set(
        record.attractions?.map((attraction) => attraction.id),
      );
      for (const stop of template.stops)
        assert.ok(selected.has(stop.attractionId));
    }
    for (const locale of (record.destinationId === "city:BCN"
      ? ["en"]
      : ["en", "sq"]) as readonly ("en" | "sq")[]) {
      const names = (record.attractions ?? []).map((attraction) =>
        attraction.name[locale].normalize("NFC").trim().toLowerCase(),
      );
      assert.equal(
        new Set(names).size,
        names.length,
        `${record.destinationId}: ${locale} names must not duplicate a selected attraction`,
      );
    }
    for (const attraction of record.attractions ?? [])
      for (const external of attraction.externalIdentities ?? []) {
        const key = `${external.authority}:${external.id}`;
        assert.equal(
          externalAttractions.has(key),
          false,
          `${key} cannot represent attractions in two disjoint pilot destinations`,
        );
        externalAttractions.add(key);
      }
  }
  assert.deepEqual(
    await disabledOsmContentEnrichment.enrich(
      destinationContentValidationContext.identities[0],
    ),
    {
      status: "disabled",
      facts: [],
      reason: "licensing-and-attribution-review-required",
    },
  );
});

test("draft status cannot bypass source integrity, locale, relationship or day-template validation", () => {
  const mutations: [string, (record: DestinationContent) => void][] = [
    [
      "unsafe source URL",
      (record) => {
        record.sources[0].url = "javascript:alert(1)";
      },
    ],
    [
      "untraceable source",
      (record) => {
        record.overview!.sourceIds = ["source:missing"];
      },
    ],
    [
      "missing EN",
      (record) => {
        delete record.overview!.text.en;
      },
    ],
    [
      "missing SQ",
      (record) => {
        delete record.attractions![0].shortDescription.en;
      },
    ],
    [
      "wrong destination",
      (record) => {
        record.attractions![0].destinationId = "unrelated-destination";
      },
    ],
    [
      "broken reusable stop",
      (record) => {
        record.dayTemplates = [
          {
            id: "template:invalid",
            destinationId: record.destinationId,
            reviewStatus: "draft",
            reviewedAt: null,
            sourceIds: record.sourceIds,
            freshness: { kind: "stable" },
            title: {
              en: "Invalid test stop",
              sq: "Ndalesë e pavlefshme testimi",
            },
            suitableNights: [2],
            stops: [{ attractionId: "attraction:missing" }],
          },
        ];
      },
    ],
    [
      "injected image",
      (record) => {
        record.attractions![0].media = {
          subject: record.attractions![0].id,
          role: "attraction.primary",
        };
      },
    ],
  ];
  for (const [name, mutate] of mutations) {
    const data = copy();
    mutate(data.records[0]);
    assert.equal(validate(data).ok, false, name);
  }
});

test("real pilot attractions cannot duplicate an external entity under a new ID or translation", () => {
  const data = copy();
  const record = data.records[0];
  const attraction = record.attractions![0];
  attraction.externalIdentities ??= [
    { authority: "wikidata", id: "Q900000001" },
  ];
  const duplicate = structuredClone(attraction);
  duplicate.id = "attraction:duplicate-test";
  duplicate.name = {
    en: "Different translated title",
    sq: "Titull tjetër i përkthyer",
  };
  record.attractions!.push(duplicate);
  const result = validate(data);
  assert.equal(result.ok, false);
  assert.ok(
    result.errors.some((reason) =>
      reason.endsWith(":duplicate-attraction-entity"),
    ),
  );
});

test("real drafts retain freshness validation and cannot disguise observed prices as stable facts", () => {
  const invalidPeriod = copy();
  invalidPeriod.records[0].overview!.freshness = {
    kind: "periodically-reviewed",
    reviewBy: "not-a-date",
  };
  assert.equal(validate(invalidPeriod).ok, false);
  const invalidVolatile = copy();
  invalidVolatile.records[0].overview!.freshness = {
    kind: "volatile",
    observedAt: "2026-10-10T00:00:00Z",
    validUntil: "2027-10-10T00:00:00Z",
  };
  assert.equal(
    validate(invalidVolatile).ok,
    false,
    "Drafts retain the maximum volatile validity window",
  );
  const invalidPrice = copy();
  const record = invalidPrice.records[0];
  record.transport = [
    {
      id: "transport:invalid-price",
      destinationId: record.destinationId,
      reviewStatus: "draft",
      reviewedAt: null,
      sourceIds: record.sourceIds,
      freshness: { kind: "stable" },
      title: { en: "Test price", sq: "Çmim testimi" },
      guidance: { en: "Test only", sq: "Vetëm test" },
      observedPrice: {
        amount: 3,
        currency: "EUR",
        sourceId: record.sourceIds[0],
        observedAt: "2026-10-10T00:00:00Z",
      },
    },
  ];
  assert.equal(
    validate(invalidPrice).ok,
    false,
    "Observed prices always need official provenance and short expiry",
  );
});

test("place identity additions authorize no media assets or selections", async (t) => {
  let calls = 0;
  t.mock.method(globalThis, "fetch", async () => {
    calls++;
    throw Error("No media discovery");
  });
  const media = validateMediaRegistry(
    { schemaVersion: 2, assets: [], selections: [], rejections: [] },
    placeIdentities,
  );
  assert.equal(media.ok, true);
  if (!media.ok) throw Error("Invalid media store");
  assert.deepEqual(media.data.assets, []);
  assert.deepEqual(media.data.selections, []);
  assert.deepEqual(media.data.rejections, []);
  assert.equal(AUTOMATIC_MEDIA_APPROVAL, false);
  assert.equal(AUTOMATIC_MEDIA_INGESTION, false);
  const store = createReviewedMediaStore(media.data);
  for (const record of records) {
    for (const role of ["destination.card", "destination.hero"] as const)
      assert.deepEqual(await store.get(record.destinationId, role), {
        status: "none",
        reason: "missing-selection",
      });
    assert.ok(
      record.attractions?.every((attraction) => attraction.media === undefined),
    );
  }
  assert.equal(calls, 0);
});

test("reading real pilot content does not change trip calculations or authorize SEO publication", async () => {
  const search = await getTripTemplates(defaultRequest, demoProviders);
  const selectedFlight = await getTripTemplates(
    defaultRequest,
    demoProviders,
    "crete",
  );
  search.templates.push(...selectedFlight.templates);
  const before = search.templates.map((template) =>
    pricePlan(template, defaultRequest),
  );
  assert.ok(before.some((plan) => plan.transportMode === "road"));
  assert.ok(
    before.some((plan) => plan.pricingCompleteness === "flight-unpriced"),
  );
  for (const record of records)
    await approvedDestinationContent.get(record.destinationId);
  assert.deepEqual(
    search.templates.map((template) => pricePlan(template, defaultRequest)),
    before,
  );
  // Content never authorizes publication: only stored decisions do.
  assert.deepEqual(
    seoSitemap().map((entry) => entry.url),
    // Hubs are recorded noindex (acquisition gate not met).
    ["https://www.trip-range.com"],
  );
  assert.equal(approvedLandingKeys.length, 4);
});
