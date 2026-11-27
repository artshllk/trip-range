import { test } from "node:test";
import assert from "node:assert/strict";
import fixture from "./fixtures/media/approved.synthetic.json";
import type {
  PlaceInput,
  PlaceIdentity,
  PlaceKind,
} from "../src/domain/media/types";
import {
  resolvePlaceEvidence,
  unresolvedIdentity,
  type PlaceEvidence,
} from "../src/places/operator/identity";
import { createWikidataIdentityResolver } from "../src/places/adapters/wikidata";
import type { MediaApi } from "../src/media/adapters/api";
const now = "2026-10-10T12:00:00Z";
const evidence = (
  id: number,
  name: string,
  countryCode: string,
  latitude: number,
  longitude: number,
  placeKind: PlaceKind = "city",
): PlaceEvidence => ({
  external: { authority: "wikidata", id: `Q${id}` },
  names: [name],
  countryCode,
  placeKind,
  coordinates: { latitude, longitude },
  transportCodes: ["AAA"],
});
const input = (e: PlaceEvidence): PlaceInput => ({
  subject: `destination:${e.external.id}`,
  name: e.names[0],
  countryCode: e.countryCode,
  coordinates: e.coordinates,
  placeKind: e.placeKind,
});
const ambiguous: Array<[string, PlaceEvidence, PlaceEvidence]> = [
  [
    "Cambridge",
    evidence(101, "Cambridge", "GB", 52.2, 0.12),
    evidence(102, "Cambridge", "US", 42.37, -71.1),
  ],
  [
    "Victoria",
    evidence(103, "Victoria", "CA", 48.43, -123.37),
    evidence(104, "Victoria", "AU", -37, 145, "region"),
  ],
  [
    "Granada",
    evidence(105, "Granada", "ES", 37.18, -3.6),
    evidence(106, "Granada", "NI", 11.93, -85.95),
  ],
  [
    "San José",
    evidence(107, "San José", "CR", 9.93, -84.08),
    evidence(108, "San Jose", "US", 37.34, -121.9),
  ],
  [
    "Panama",
    evidence(109, "Panama", "PA", 9, -79.5),
    evidence(110, "Panama", "PA", 8.5, -80, "unknown"),
  ],
  [
    "Georgia",
    evidence(111, "Georgia", "US", 32.16, -82.9, "region"),
    evidence(112, "Georgia", "GE", 42, 43, "unknown"),
  ],
  [
    "Washington",
    evidence(113, "Washington", "US", 38.9, -77),
    evidence(114, "Washington", "US", 47.4, -120.7, "region"),
  ],
];
for (const [name, expected, other] of ambiguous)
  test(`${name}: country, coordinates and geographic kind disambiguate; never first-result wins`, () => {
    for (const candidates of [
      [other, expected],
      [expected, other],
    ])
      assert.deepEqual(
        resolvePlaceEvidence(
          input(expected),
          candidates,
          "constrained-name",
          now,
        ).external,
        expected.external,
      );
    assert.equal(
      resolvePlaceEvidence(
        { ...input(expected), countryCode: "ZZ" },
        [expected, other],
        "constrained-name",
        now,
      ).external,
      null,
    );
  });
test("same-name same-country nearby entities remain unresolved; absent coordinates are not guessed", () => {
  const a = evidence(101, "Cambridge", "GB", 52.2, 0.12),
    b = evidence(102, "Cambridge", "GB", 52.21, 0.13);
  assert.equal(
    resolvePlaceEvidence(input(a), [a, b], "constrained-name", now)
      .unresolvedReason,
    "ambiguous-identity",
  );
  assert.equal(
    resolvePlaceEvidence(
      { ...input(a), coordinates: undefined },
      [a],
      "constrained-name",
      now,
    ).external,
    null,
  );
  assert.equal(
    resolvePlaceEvidence(
      input(a),
      [{ ...a, placeKind: "unknown" }],
      "constrained-name",
      now,
    ).external,
    null,
  );
});
const claim = (value: unknown) => [
  { rank: "normal", mainsnak: { snaktype: "value", datavalue: { value } } },
];
const item = (id: string, name: string, claims: Record<string, unknown>) => ({
  id,
  type: "item",
  labels: { en: { value: name } },
  claims,
});
const countryId = "Q900000090";
function apiFixture(
  places: ReturnType<typeof item>[],
  country: string,
  codeSearch = false,
): MediaApi {
  const map = new Map(
    [
      ...places,
      item(countryId, "Country fixture", { P297: claim(country) }),
      item("Q515", "city", {}),
      item("Q23442", "island", {}),
      item("Q1248784", "airport", {}),
    ].map((e) => [e.id, e]),
  );
  return {
    async get(service, params) {
      assert.equal(service, "wikidata");
      if (params.action === "wbgetentities")
        return {
          success: 1,
          entities: Object.fromEntries(
            params.ids
              .split("|")
              .filter((id) => map.has(id))
              .map((id) => [id, map.get(id)]),
          ),
        };
      if (params.action === "wbsearchentities")
        return {
          success: 1,
          search: places
            .filter((e) => e.labels.en.value === params.search)
            .map((e) => ({ id: e.id })),
        };
      assert.equal(codeSearch, true);
      assert.match(
        params.srsearch,
        /^haswbstatement:P238=[A-Z]{3}( OR haswbstatement:P238=[A-Z]{3})*$/,
      );
      return {
        query: {
          search: places
            .filter((e) => "P238" in e.claims)
            .map((e) => ({ title: e.id })),
        },
      };
    },
  };
}
function city(
  id: string,
  name: string,
  latitude: number,
  longitude: number,
  kind = "Q515",
) {
  return item(id, name, {
    P31: claim({ id: kind }),
    P17: claim({ id: countryId }),
    P625: claim({
      latitude,
      longitude,
      globe: "http://www.wikidata.org/entity/Q2",
    }),
  });
}
for (const [region, name, country, lat, lon] of [
  ["Europe", "Lisbon", "PT", 38.72, -9.14],
  ["Asia", "Kyoto", "JP", 35.01, 135.77],
  ["North America", "Montréal", "CA", 45.5, -73.57],
  ["South America", "Lima", "PE", -12.05, -77.04],
  ["Africa", "Nairobi", "KE", -1.28, 36.82],
  ["Oceania", "Auckland", "NZ", -36.85, 174.76],
] as const)
  test(`${region}: adapter resolves a synthetic entity using identical worldwide rules`, async () => {
    const entity = city("Q900000001", name, lat, lon);
    const resolver = createWikidataIdentityResolver(
      apiFixture([entity], country),
      () => now,
    );
    const result = await resolver.resolve({
      subject: `test:${region.replace(/ /g, "-")}`,
      name,
      countryCode: country,
      placeKind: "city",
      coordinates: { latitude: lat, longitude: lon },
    });
    assert.equal(result.external?.id, entity.id);
    assert.equal(result.resolutionMethod, "constrained-name");
  });
test("reviewed mapping has priority and needs no resolution requests", async () => {
  const reviewed = fixture.places[0] as PlaceIdentity;
  const resolver = createWikidataIdentityResolver({
    async get() {
      throw Error("must not call");
    },
  });
  assert.deepEqual(await resolver.resolve(reviewed, reviewed), reviewed);
});
test("an island served by multiple airports resolves to the island, never an airport", async () => {
  const island = city("Q900000001", "Island fixture", 35.2, 25, "Q23442");
  const hubs = ["AAA", "BBB"].map((code, i) =>
    item(`Q90000000${i + 2}`, `Airport ${code}`, {
      P238: claim(code),
      P31: claim({ id: "Q1248784" }),
      P931: claim({ id: island.id }),
      P17: claim({ id: countryId }),
    }),
  );
  const result = await createWikidataIdentityResolver(
    apiFixture([island, ...hubs], "GR", true),
    () => now,
  ).resolve({
    subject: "island:example",
    name: "Island fixture",
    countryCode: "GR",
    placeKind: "island",
    iataCodes: ["AAA", "BBB"],
    coordinates: { latitude: 35.2, longitude: 25 },
  });
  assert.equal(result.external?.id, island.id);
  assert.equal(result.resolutionMethod, "transport-code");
});
test("airport serving multiple plausible cities remains unresolved", async () => {
  const cities = [
    city("Q900000001", "Springfield", 40, -80),
    city("Q900000002", "Springfield", 40.02, -80.02),
  ];
  const hub = item("Q900000003", "Airport", {
    P238: claim("AAA"),
    P31: claim({ id: "Q1248784" }),
    P931: cities.map((c) => claim({ id: c.id })[0]),
    P17: claim({ id: countryId }),
  });
  const result = await createWikidataIdentityResolver(
    apiFixture([...cities, hub], "US", true),
    () => now,
  ).resolve({
    subject: "test:shared-airport",
    name: "Springfield",
    countryCode: "US",
    placeKind: "city",
    iataCodes: ["AAA"],
    coordinates: { latitude: 40, longitude: -80 },
  });
  assert.equal(result.external, null);
  assert.equal(result.unresolvedReason, "ambiguous-identity");
});
test("an airport without a supported served destination cannot become a destination entity", async () => {
  const airport = city("Q900000001", "Airport fixture", 40, -80, "Q1248784");
  airport.claims.P238 = claim("AAA");
  const result = await createWikidataIdentityResolver(
    apiFixture([airport], "US", true),
  ).resolve({
    subject: "test:airport",
    name: "Airport fixture",
    countryCode: "US",
    placeKind: "unknown",
    iataCodes: ["AAA"],
  });
  assert.equal(result.external, null);
});
test("missing mapping/coordinates, truncation, malformed IDs and provider errors are unresolved", async () => {
  const seed: PlaceInput = {
    subject: "test:unresolved",
    name: "Place",
    countryCode: "US",
    placeKind: "unknown",
  };
  let calls = 0;
  const resolver = createWikidataIdentityResolver({
    async get() {
      calls++;
      throw Error("private server detail");
    },
  });
  assert.equal((await resolver.resolve(seed)).external, null);
  assert.equal(calls, 0);
  for (const response of [
    { search: [{ id: "Q1 OR unsafe" }] },
    { search: [{ id: "Q1" }], "search-continue": 7 },
  ]) {
    const r = createWikidataIdentityResolver({
      async get() {
        return response;
      },
    });
    assert.equal(
      (await r.resolve({ ...seed, coordinates: { latitude: 0, longitude: 0 } }))
        .external,
      null,
    );
  }
  assert.equal(
    (await resolver.resolve({ ...seed, iataCodes: ["AAA"] })).external,
    null,
  );
  assert.equal(unresolvedIdentity(seed, "missing").external, null);
});
