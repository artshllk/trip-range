import { approvedMediaSubjects } from "./fixtures/approved-media";
import assert from "node:assert/strict";
import { test } from "node:test";
import { readFileSync } from "node:fs";
import { placeRegistryData } from "../content/places/records";
import { createPlaceRegistry } from "../src/places/runtime/store";
import {
  identityValid,
  validatePlaceRegistry,
} from "../src/domain/places/validation";
import { contentTestIdentity } from "./fixtures/destination-content";
import { destinationContentValidationContext } from "../src/content/runtime/approved";
import {
  validateMediaRegistry,
  validateMediaChanges,
} from "../src/domain/media/validation";
import { validateHistoricalMedia } from "../scripts/lib/media-history";
import fixture from "./fixtures/media/approved.synthetic.json";
import type { PlaceMediaData } from "../src/domain/media/types";
import { approvedPlaceMedia } from "../src/media/runtime/approved";

for (const placeKind of ["city", "island", "region", "nature-area"] as const)
  test(`neutral registry accepts ${placeKind} with unchanged identity model`, () => {
    assert.equal(
      validatePlaceRegistry({
        schemaVersion: 1,
        records: [{ ...contentTestIdentity, placeKind }],
      }).ok,
      true,
    );
  });
test("ambiguous names and provider aliases never merge distinct canonical places", () => {
  const a = { ...contentTestIdentity, aliases: ["Pristina", "Prishtinë"] };
  const b = {
    ...a,
    subject: "other:example",
    external: { authority: "wikidata", id: "Q900000002" },
  };
  const registry = createPlaceRegistry({ schemaVersion: 1, records: [a, b] });
  assert.equal(registry.size, 2);
  assert.equal(registry.get("Pristina"), undefined);
  assert.deepEqual(registry.get(a.subject)?.aliases, a.aliases);
  assert.equal(registry.byWikidata(b.external.id)?.subject, b.subject);
});
for (const [label, patch] of [
  ["subject", { subject: "../secret" }],
  ["country", { countryCode: "ZZ" }],
  ["coordinates", { coordinates: { latitude: 91, longitude: 0 } }],
  [
    "coordinate fields",
    { coordinates: { latitude: 0, longitude: 0, url: "https://example.org" } },
  ],
  ["IATA", { iataCodes: ["prn"] }],
  ["duplicate IATA", { iataCodes: ["PRN", "PRN"] }],
  ["city code", { cityCode: "../" }],
  ["external id", { external: { authority: "wikidata", id: "Q0" } }],
  [
    "external keys",
    { external: { authority: "wikidata", id: "Q123", url: "unexpected" } },
  ],
  ["kind", { placeKind: "attraction" }],
  ["confidence", { confidence: "high" }],
  ["resolution", { resolutionMethod: "automatic" }],
  ["aliases", { aliases: ["<html>"] }],
  ["duplicate aliases", { aliases: ["Pristina", "pristina"] }],
  ["unknown field", { approved: true }],
  ["name", { name: "unsafe\nname" }],
] as const)
  test(`place validation rejects unsafe ${label}`, () => {
    assert.equal(identityValid({ ...contentTestIdentity, ...patch }), false);
  });
test("duplicate subjects, external identities and conflicting transport mappings fail closed", () => {
  const a = { ...contentTestIdentity, iataCodes: ["XYZ"], cityCode: "XYZ" };
  for (const b of [
    a,
    { ...a, subject: "other" },
    { ...a, subject: "other", external: { authority: "wikidata", id: "Q222" } },
  ])
    assert.equal(
      validatePlaceRegistry({ schemaVersion: 1, records: [a, b] }).ok,
      false,
    );
});
test("unresolved candidate is explicit and cannot claim resolved evidence", () => {
  const unresolved = {
    ...contentTestIdentity,
    external: null,
    resolutionMethod: "unresolved",
    confidence: "unresolved",
    resolvedAt: null,
    unresolvedReason: "ambiguous-identity",
  };
  assert.equal(identityValid(unresolved), true);
  assert.equal(
    identityValid({ ...unresolved, external: contentTestIdentity.external }),
    false,
  );
});
test("12000 synthetic worldwide identities validate and use indexed defensive lookups", () => {
  const records = Array.from({ length: 12000 }, (_, i) => ({
    ...contentTestIdentity,
    subject: `synthetic:${i}`,
    name: `Place ${i}`,
    placeKind: (["city", "island", "region", "nature-area"] as const)[i % 4],
    external: { authority: "wikidata", id: `Q${1000000 + i}` },
  }));
  const registry = createPlaceRegistry({ schemaVersion: 1, records });
  assert.equal(registry.size, 12000);
  for (let i = 0; i < records.length; i++)
    assert.equal(
      registry.get(records[i].subject)?.external?.id,
      records[i].external.id,
    );
  records[0].name = "mutation";
  const found = registry.get("synthetic:0")!;
  found.name = "mutation";
  assert.equal(registry.get("synthetic:0")?.name, "Place 0");
  assert.equal(
    validateMediaRegistry(
      { schemaVersion: 2, assets: [], selections: [], rejections: [] },
      registry.list(),
    ).ok,
    true,
  );
});
test("migration preserves all three identities byte-for-field including original confidence", () => {
  const expected = [
    ["city:BCN", "Q1492", "city", "ES", 41.3825, 2.1769444444, ["BCN"], "BCN"],
    [
      "crete",
      "Q34374",
      "island",
      "GR",
      35.3097222222,
      24.8933333333,
      ["HER", "CHQ"],
      undefined,
    ],
    [
      "prishtina",
      "Q25270",
      "city",
      "XK",
      42.6666666667,
      21.1666666667,
      ["PRN"],
      "PRN",
    ],
  ];
  assert.equal(
    placeRegistryData.records.filter((place) =>
      expected.some(([id]) => id === place.subject),
    ).length,
    3,
  );
  for (const [subject, id, kind, country, lat, lon, codes, city] of expected) {
    const p = placeRegistryData.records.find((p) => p.subject === subject)!;
    assert.deepEqual(p.external, { authority: "wikidata", id });
    assert.equal(p.placeKind, kind);
    assert.equal(p.countryCode, country);
    assert.deepEqual(p.coordinates, { latitude: lat, longitude: lon });
    assert.deepEqual(p.iataCodes, codes);
    assert.equal(p.cityCode, city);
    assert.equal(p.confidence, "high");
    assert.equal(p.resolutionMethod, "constrained-name");
    assert.equal(p.resolvedAt, "2026-10-12T00:00:00Z");
    assert.equal(p.policyVersion, "destination-media-v1");
    assert.equal(p.unresolvedReason, null);
  }
  assert.deepEqual(
    destinationContentValidationContext.identities,
    placeRegistryData.records,
  );
});
test("media v2 consumes shared identities, rejects media-owned identity and orphan references", async () => {
  const persisted = JSON.parse(
    readFileSync("content/media/approved.json", "utf8"),
  );
  assert.equal("places" in persisted, false);
  assert.equal(
    validateMediaRegistry(
      { ...persisted, places: [] },
      placeRegistryData.records,
    ).ok,
    false,
  );
  assert.equal(
    validateMediaRegistry({ ...fixture, schemaVersion: 2 }, []).ok,
    false,
  );
  const { places, ...media } = fixture;
  assert.equal(
    validateMediaRegistry(
      { ...media, schemaVersion: 2 },
      places as typeof placeRegistryData.records,
    ).ok,
    true,
  );
  assert.equal(
    validateMediaRegistry({ ...media, schemaVersion: 2 }, []).ok,
    false,
  );
  for (const p of placeRegistryData.records)
    assert.equal(
      (await approvedPlaceMedia.get(p.subject, "destination.hero")).status,
      (approvedMediaSubjects as readonly string[]).includes(p.subject)
        ? "approved"
        : "none",
    );
});
test("historical migration preserves nonempty media approvals, identity revisions and rejections", () => {
  const before = structuredClone(fixture) as PlaceMediaData;
  const { places, ...media } = before;
  const old = validateHistoricalMedia(before),
    migrated = validateHistoricalMedia({ ...media, schemaVersion: 2 }, places);
  assert.equal(old.ok, true);
  assert.equal(migrated.ok, true);
  if (!old.ok || !migrated.ok) throw Error("fixture");
  assert.deepEqual(validateMediaChanges(migrated.data, old.data), []);
  const changed = structuredClone(migrated.data);
  changed.places[0].name = "Changed";
  assert.ok(
    validateMediaChanges(changed, old.data).includes(
      "selection-change-requires-next-review-revision",
    ),
  );
  const rejected = {
    ...old.data,
    rejections: [
      {
        subject: places[0].subject,
        assetId: "commons:99999",
        reason: "human rejected",
        reviewedAt: "2026-10-10T00:00:00Z",
      },
    ],
  };
  assert.ok(
    validateMediaChanges(migrated.data, rejected).includes(
      "reviewed-rejection-removal-forbidden",
    ),
  );
  assert.equal(
    validateHistoricalMedia({ ...media, schemaVersion: 2 }).ok,
    false,
  );
});
