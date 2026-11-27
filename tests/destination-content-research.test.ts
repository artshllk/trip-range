import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { createHash } from "node:crypto";
import { join } from "node:path";
import type { PlaceIdentity } from "../src/domain/media/types";
import { MEDIA_POLICY_VERSION } from "../src/domain/media/policy";
import {
  createMediaApi,
  MEDIA_REQUEST_LIMITS,
} from "../src/media/adapters/api";
import { researchDestinationContent } from "../src/content/operator/research";
import { parseContentResearchArguments } from "../src/content/operator/arguments";
import {
  attractionSearchQuery,
  CONTENT_RESEARCH_LIMITS,
  researchWikidataAttractions,
} from "../src/content/adapters/wikidata";
import { disabledOsmContentEnrichment } from "../src/content/adapters/osm";
import { runContentResearchCommand } from "../scripts/research-destination-content";

// All entities are synthetic. These records are never added to production data.
const destination: PlaceIdentity = {
  subject: "synthetic-content-city",
  name: "Synthetic City",
  countryCode: "CH",
  placeKind: "city",
  coordinates: { latitude: 10, longitude: 20 },
  external: { authority: "wikidata", id: "Q900000001" },
  confidence: "reviewed",
  resolutionMethod: "reviewed",
  resolvedAt: "2026-10-10T10:00:00Z",
  unresolvedReason: null,
  policyVersion: MEDIA_POLICY_VERSION,
};
const retrievedAt = "2026-10-10T12:00:00Z";
const claim = (value: unknown) => ({
  rank: "normal",
  mainsnak: { snaktype: "value", datavalue: { value } },
});
const entityId = (id: string) => claim({ id });
const point = (latitude = 10.01, longitude = 20.01) =>
  claim({ latitude, longitude, globe: "http://www.wikidata.org/entity/Q2" });
function attraction(id = "Q900000002", claims: Record<string, unknown> = {}) {
  return {
    id,
    type: "item",
    labels: { en: { value: "Synthetic Museum" } },
    descriptions: {
      en: { value: "Never copy this provider description into a candidate" },
    },
    claims: {
      P31: [entityId("Q33506")],
      P17: [entityId("Q900000003")],
      P131: [entityId(destination.external!.id)],
      P625: [point()],
      P856: [claim("https://museum.example.org/visit")],
      ...claims,
    },
  };
}
function fixture(
  roots = [attraction()],
  extra: Array<Record<string, unknown>> = [],
) {
  const records: Array<Record<string, unknown>> = [
    ...roots,
    { id: "Q900000003", type: "item", claims: { P297: [claim("CH")] } },
    { id: "Q33506", type: "item" },
    ...extra,
  ];
  const requests: URL[] = [];
  const options: RequestInit[] = [];
  const fetcher = (async (input, init) => {
    const url = new URL(String(input));
    requests.push(url);
    options.push(init ?? {});
    assert.equal(
      url.href.startsWith("https://www.wikidata.org/w/api.php?"),
      true,
    );
    const payload =
      url.searchParams.get("action") === "query"
        ? { query: { search: roots.map((root) => ({ title: root.id })) } }
        : {
            entities: Object.fromEntries(
              (url.searchParams.get("ids") ?? "").split("|").flatMap((id) => {
                const row = records.find((item) => item.id === id);
                return row ? [[id, row]] : [];
              }),
            ),
          };
    return new Response(JSON.stringify(payload));
  }) as typeof fetch;
  return { requests, options, fetcher };
}

test("content research defaults offline, even with reviewed identity, and optional OSM has no network path", async () => {
  let calls = 0;
  const neverFetch = (async () => {
    calls++;
    throw Error("unexpected network");
  }) as typeof fetch;
  const report = await researchDestinationContent(
    destination,
    { reviewed: destination },
    neverFetch,
  );
  assert.equal(report.status, "offline");
  assert.equal(report.automaticPublication, false);
  assert.deepEqual(report.candidates, []);
  assert.deepEqual(report.requests, { wikidata: 0, commons: 0 });
  assert.equal(
    (await disabledOsmContentEnrichment.enrich(destination)).status,
    "disabled",
  );
  assert.equal(calls, 0);
});

test("research arguments require a stable destination and explicit live opt-in; arbitrary files, endpoints and repeat flags fail", () => {
  assert.deepEqual(parseContentResearchArguments(["--destination", "sample"]), {
    destination: "sample",
    live: false,
  });
  assert.equal(
    parseContentResearchArguments(["--live", "--destination", "sample"]).live,
    true,
  );
  for (const args of [
    [],
    ["--destination"],
    ["--destination", "../../private"],
    ["--destination", "sample", "--output", "content/destinations/x.json"],
    ["--destination", "sample", "--url", "https://private.test"],
    ["--destination", "sample", "--live", "--live"],
    ["--destination", "sample", "--destination", "other"],
  ])
    assert.throws(() => parseContentResearchArguments(args));
});

test("bounded Wikidata research produces separate candidates with identity, source references and no copied descriptions", async () => {
  const f = fixture();
  const report = await researchDestinationContent(
    destination,
    { live: true, reviewed: destination },
    f.fetcher,
  );
  assert.equal(report.status, "complete");
  assert.equal(report.candidates.length, 1);
  const candidate = report.candidates[0];
  assert.equal(
    candidate.id,
    "attraction:synthetic-content-city:wikidata-Q900000002",
  );
  assert.equal(candidate.reviewStatus, "candidate");
  assert.equal(candidate.kind, "museum");
  assert.deepEqual(candidate.relationship.path, ["Q900000002", "Q900000001"]);
  assert.equal(
    candidate.officialWebsiteReference,
    "https://museum.example.org/visit",
  );
  assert.ok(
    candidate.sourceIds.every((sourceId) =>
      report.sources.some((source) => source.id === sourceId),
    ),
  );
  assert.equal(JSON.stringify(report).includes("Never copy"), false);
  assert.equal(f.requests.length, 3);
  assert.equal(
    f.requests[0].searchParams.get("srsearch"),
    attractionSearchQuery(destination.external!.id),
  );
  assert.equal(
    f.requests[0].searchParams.get("srlimit"),
    String(CONTENT_RESEARCH_LIMITS.candidates),
  );
  assert.ok(
    f.options.every(
      (request) => request.redirect === "error" && request.cache === "no-store",
    ),
  );
  assert.ok(
    f.options.every((request) =>
      new Headers(request.headers)
        .get("User-Agent")
        ?.startsWith(
          "TripRangeMediaReview/1.0 (https://www.trip-range.com; hello@trip-range.com;",
        ),
    ),
  );
  assert.equal(report.requests.commons, 0);
});

test("catalogue inputs without coordinates reuse the selected shared resolver evidence", async () => {
  const live = fixture();
  let resolutionCalls = 0;
  const fetcher = (async (input, init) => {
    const url = new URL(String(input));
    const ids = url.searchParams.get("ids")?.split("|") ?? [];
    if (url.searchParams.get("srsearch")?.includes("P238")) {
      resolutionCalls++;
      return new Response(
        JSON.stringify({
          query: { search: [{ title: destination.external!.id }] },
        }),
      );
    }
    if (ids.length === 1 && ids[0] === destination.external!.id) {
      resolutionCalls++;
      return new Response(
        JSON.stringify({
          entities: {
            [ids[0]]: {
              id: ids[0],
              type: "item",
              labels: { en: { value: destination.name } },
              claims: {
                P238: [claim("SYN")],
                P17: [entityId("Q900000003")],
                P31: [entityId("Q515")],
                P625: [point(10, 20)],
              },
            },
          },
        }),
      );
    }
    if (ids.includes("Q515")) {
      resolutionCalls++;
      return new Response(
        JSON.stringify({
          entities: {
            Q515: { id: "Q515", type: "item" },
            Q900000003: {
              id: "Q900000003",
              type: "item",
              claims: { P297: [claim("CH")] },
            },
          },
        }),
      );
    }
    return live.fetcher(input, init);
  }) as typeof fetch;
  const report = await researchDestinationContent(
    { ...destination, coordinates: undefined, iataCodes: ["SYN"] },
    { live: true },
    fetcher,
  );
  assert.equal(report.status, "complete");
  assert.equal(report.identity.resolutionMethod, "transport-code");
  assert.deepEqual(report.identity.coordinates, destination.coordinates);
  assert.equal(report.candidates.length, 1);
  assert.equal(resolutionCalls, 3);
  assert.equal(report.requests.wikidata, 6);
});

test("same-name attractions have distinct stable identities and cannot pass solely on name", async () => {
  const f = fixture([
    attraction("Q900000002"),
    attraction("Q900000004"),
    attraction("Q900000005", { P131: [entityId("Q900000099")] }),
  ]);
  const result = await researchWikidataAttractions(
    createMediaApi(f.fetcher).api,
    destination,
    retrievedAt,
  );
  assert.equal(result.candidates.length, 2);
  assert.notEqual(result.candidates[0].id, result.candidates[1].id);
  assert.equal(result.candidates[0].name.en, result.candidates[1].name.en);
  assert.deepEqual(result.exclusions, [
    { entityId: "Q900000005", reason: "unrelated-destination" },
  ]);
});

test("country, coordinates, broad type and sanitized label all corroborate destination relation", async () => {
  const roots = [
    attraction("Q900000010", { P17: [entityId("Q900000090")] }),
    attraction("Q900000011", { P625: [point(60, 60)] }),
    attraction("Q900000012", { P625: [] }),
    attraction("Q900000013", { P31: [entityId("Q900000091")] }),
    {
      ...attraction("Q900000014"),
      labels: { en: { value: "<script>bad</script>" } },
    },
    { ...attraction("Q900000015"), labels: { en: { value: "x".repeat(181) } } },
    attraction("Q900000016", {
      P625: [
        claim({
          latitude: 10,
          longitude: 20,
          globe: "http://www.wikidata.org/entity/Q111",
        }),
      ],
    }),
  ];
  const f = fixture(roots, [
    { id: "Q900000090", type: "item", claims: { P297: [claim("DE")] } },
  ]);
  const result = await researchWikidataAttractions(
    createMediaApi(f.fetcher).api,
    destination,
    retrievedAt,
  );
  assert.equal(result.candidates.length, 0);
  assert.deepEqual(
    result.exclusions.map((row) => row.reason),
    [
      "country-mismatch",
      "outside-destination",
      "missing-coordinates",
      "unsupported-type",
      "missing-label",
      "missing-label",
      "missing-coordinates",
    ],
  );
});

test("one administrative hop requires its own geography and country corroboration", async () => {
  const root = attraction("Q900000002", { P131: [entityId("Q900000080")] });
  const parent = {
    id: "Q900000080",
    type: "item",
    claims: {
      P131: [entityId(destination.external!.id)],
      P17: [entityId("Q900000003")],
      P625: [point()],
    },
  };
  const f = fixture([root], [parent]);
  const result = await researchWikidataAttractions(
    createMediaApi(f.fetcher).api,
    destination,
    retrievedAt,
  );
  assert.deepEqual(result.candidates[0].relationship.path, [
    root.id,
    parent.id,
    destination.external!.id,
  ]);
  assert.deepEqual(result.candidates[0].relationship.properties, [
    "P131",
    "P131",
  ]);
  const bad = fixture(
    [root],
    [{ ...parent, claims: { ...parent.claims, P625: [point(70, 70)] } }],
  );
  assert.equal(
    (
      await researchWikidataAttractions(
        createMediaApi(bad.fetcher).api,
        destination,
        retrievedAt,
      )
    ).candidates.length,
    0,
  );
});

test("official-site references reject unsafe/private/query URLs and are never fetched", async () => {
  for (const url of [
    "http://museum.example.org",
    "https://localhost/",
    "https://127.0.0.1/",
    "https://user:password@museum.example.org/",
    "https://museum.example.org/?token=private",
    "https://museum.example.org/#private",
    "https://museum.example.org:444/",
    "javascript:alert(1)",
  ]) {
    const f = fixture([attraction("Q900000002", { P856: [claim(url)] })]);
    const report = await researchDestinationContent(
      destination,
      { live: true, reviewed: destination },
      f.fetcher,
    );
    assert.equal(report.status, "complete");
    assert.equal(report.candidates[0].officialWebsiteReference, undefined, url);
    assert.ok(
      f.requests.every((request) => request.hostname === "www.wikidata.org"),
    );
    assert.equal(JSON.stringify(report).includes("token=private"), false);
  }
});

test("overlong candidate IDs and search injection are rejected before publication or query construction", async () => {
  assert.throws(() => attractionSearchQuery("Q1 OR secret"));
  const f = fixture();
  const longIdentity = { ...destination, subject: "a".repeat(120) };
  await assert.rejects(
    researchWikidataAttractions(
      createMediaApi(f.fetcher).api,
      longIdentity,
      retrievedAt,
    ),
    /candidate-id-bound/,
  );
});

test("search pagination is reported but never followed; empty valid data stays a successful empty candidate set", async () => {
  let calls = 0;
  const paged = (async () => {
    calls++;
    return new Response(
      JSON.stringify({ continue: { sroffset: 12 }, query: { search: [] } }),
    );
  }) as typeof fetch;
  const report = await researchDestinationContent(
    destination,
    { live: true, reviewed: destination },
    paged,
  );
  assert.equal(report.status, "complete");
  assert.equal(report.truncated, true);
  assert.equal(report.candidates.length, 0);
  assert.equal(calls, 1);
});

test("malformed or oversized search output fails closed with safe constant reason", async () => {
  for (const payload of [
    null,
    { query: { search: "bad" } },
    { query: { search: [{ title: "Q1 OR bad" }] } },
    {
      query: {
        search: Array.from({ length: 13 }, (_, index) => ({
          title: `Q${index + 1}`,
        })),
      },
    },
    { query: { search: [{ title: "Q1" }, { title: "Q1" }] } },
  ]) {
    const report = await researchDestinationContent(
      destination,
      { live: true, reviewed: destination },
      (async () => new Response(JSON.stringify(payload))) as typeof fetch,
    );
    assert.equal(report.status, "unavailable");
    assert.equal(report.reason, "bounded-research-unavailable");
    assert.deepEqual(report.candidates, []);
    assert.equal(report.requests.wikidata, 1);
  }
});

test("related-entity fanout is bounded before a metadata request can expand the batch", async () => {
  const roots = Array.from({ length: 12 }, (_, index) =>
    attraction(`Q${910000000 + index}`, {
      P31: [entityId(`Q${920000000 + index}`)],
      P131: [entityId(`Q${930000000 + index}`)],
      P276: [entityId(`Q${940000000 + index}`)],
    }),
  );
  const f = fixture(roots);
  const report = await researchDestinationContent(
    destination,
    { live: true, reviewed: destination },
    f.fetcher,
  );
  assert.equal(report.status, "unavailable");
  assert.equal(report.requests.wikidata, 2);
  assert.deepEqual(report.candidates, []);
});

test("operator provider errors are sanitized and rate limits stop requests immediately", async () => {
  for (const status of [429, 401, 500]) {
    const report = await researchDestinationContent(
      destination,
      { live: true, reviewed: destination },
      (async () =>
        new Response("private credential failure", { status })) as typeof fetch,
    );
    assert.equal(report.status, "unavailable");
    assert.equal(report.requests.wikidata, 1);
    assert.equal(report.failures[0].httpStatus, status);
    assert.equal(JSON.stringify(report).includes("credential"), false);
  }
  const limited = createMediaApi(
    (async () =>
      new Response(
        JSON.stringify({ error: { code: "maxlag", info: "private error" } }),
      )) as typeof fetch,
  );
  await assert.rejects(limited.api.get("wikidata", { action: "query" }));
  await assert.rejects(limited.api.get("wikidata", { action: "query" }));
  assert.equal(limited.counts.wikidata, 1);
  assert.equal(limited.failures[0].reason, "rate-limit");
});

test("research uses inherited response-size, per-request timeout and batch-call bounds", async () => {
  const oversized = createMediaApi(
    (async () =>
      new Response("{}", {
        headers: { "Content-Length": String(MEDIA_REQUEST_LIMITS.bytes + 1) },
      })) as typeof fetch,
  );
  await assert.rejects(
    researchWikidataAttractions(oversized.api, destination, retrievedAt),
  );
  assert.equal(oversized.failures[0].reason, "oversized-response");
  const timeout = createMediaApi(
    (() => new Promise(() => {})) as typeof fetch,
    5,
  );
  await assert.rejects(
    researchWikidataAttractions(timeout.api, destination, retrievedAt),
  );
  assert.equal(timeout.failures[0].reason, "timeout");
  const bounded = createMediaApi(
    (async () => new Response("{}")) as typeof fetch,
  );
  for (let index = 0; index < MEDIA_REQUEST_LIMITS.wikidata; index++)
    await bounded.api.get("wikidata", { action: "query" });
  await assert.rejects(bounded.api.get("wikidata", { action: "query" }));
  assert.equal(bounded.counts.wikidata, MEDIA_REQUEST_LIMITS.wikidata);
  assert.equal(bounded.failures[0].reason, "request-budget-exhausted");
});

function contentSnapshot(directory: string): string {
  const rows = readdirSync(directory)
    .sort()
    .flatMap((name) => {
      const path = join(directory, name);
      return statSync(path).isDirectory()
        ? [name, contentSnapshot(path)]
        : [name, readFileSync(path).toString("base64")];
    });
  return createHash("sha256").update(JSON.stringify(rows)).digest("hex");
}

test("real operator command is offline by default and leaves all reviewed content unchanged", async (t) => {
  const before = contentSnapshot("content");
  const lines: string[] = [];
  let calls = 0;
  t.mock.method(console, "log", (line: string) => {
    lines.push(line);
  });
  t.mock.method(globalThis, "fetch", async () => {
    calls++;
    throw Error("network forbidden");
  });
  assert.equal(
    await runContentResearchCommand(["--destination", "prizren"]),
    0,
  );
  const report = JSON.parse(lines[0]);
  assert.equal(report.status, "offline");
  assert.equal(calls, 0);
  assert.equal(contentSnapshot("content"), before);
  assert.equal(
    await runContentResearchCommand(["--destination", "zurich", "--live"]),
    1,
  );
  assert.ok(calls > 0);
  assert.equal(contentSnapshot("content"), before);
});
