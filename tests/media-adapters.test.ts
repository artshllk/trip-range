import { test } from "node:test";
import assert from "node:assert/strict";
import approved from "./fixtures/media/approved.synthetic.json";
import type { PlaceIdentity, MediaRejection } from "../src/domain/media/types";
import {
  createCommonsMediaDiscovery,
  plainMetadata,
} from "../src/media/adapters/commons";
import {
  createMediaApi,
  MEDIA_REQUEST_LIMITS,
} from "../src/media/adapters/api";
import { discoverDestinationMedia } from "../src/media/operator/discover";
const identity = approved.places[0] as PlaceIdentity;
const claim = (value: unknown) => [
  { rank: "normal", mainsnak: { snaktype: "value", datavalue: { value } } },
];
function file(id: number, name: string) {
  return {
    pageid: id,
    ns: 6,
    title: `File:${name}.jpg`,
    imageinfo: [
      {
        url: `https://upload.wikimedia.org/wikipedia/commons/a/ab/${name}.jpg`,
        descriptionurl: `https://commons.wikimedia.org/wiki/File:${name}.jpg`,
        width: 2400,
        height: 1600,
        size: 30000,
        sha1: "a".repeat(40),
        mime: "image/jpeg",
        mediatype: "BITMAP",
        extmetadata: {
          Artist: {
            value:
              '<a href="https://evil.test">Synthetic author</a><script>unsafe()</script>',
          },
          Credit: { value: "Own work" },
          LicenseShortName: { value: "CC BY-SA 4.0" },
          LicenseUrl: {
            value: "https://creativecommons.org/licenses/by-sa/4.0/",
          },
          ImageDescription: { value: "Destination cityscape" },
        },
      },
    ],
  };
}
function fixture({
  mismatch = false,
  hostile = false,
  rejection = false,
} = {}) {
  const requests: { service: string; params: Record<string, string> }[] = [];
  const transport = createMediaApi(async (input, options) => {
    const url = new URL(String(input)),
      params = Object.fromEntries(url.searchParams),
      service = url.hostname;
    requests.push({ service, params });
    assert.equal(options?.redirect, "error");
    assert.match(
      String((options?.headers as Record<string, string>)["User-Agent"]),
      /^TripRangeMediaReview\/1\.0 \(https:\/\/www\.trip-range\.com; hello@trip-range\.com;/,
    );
    assert.equal(url.pathname, "/w/api.php");
    if (service === "www.wikidata.org") {
      return Response.json({
        success: 1,
        entities: {
          [identity.external!.id]: {
            id: identity.external!.id,
            type: "item",
            claims: { P18: claim("Destination_cityscape.jpg") },
          },
        },
      });
    }
    assert.equal(service, "commons.wikimedia.org");
    if (params.action === "wbgetentities")
      return Response.json({
        success: 1,
        entities: Object.fromEntries(
          params.ids.split("|").map((id) => [
            id,
            {
              id,
              type: "mediainfo",
              statements: {
                P180: claim({
                  id: mismatch ? "Q999" : identity.external!.id,
                }),
              },
            },
          ]),
        ),
      });
    if (params.generator) {
      assert.equal(
        params.gsrsearch,
        `haswbstatement:P180=${identity.external!.id}`,
      );
      return Response.json({
        query: { pages: [file(900002, "Destination_panorama")] },
      });
    }
    const page = file(900001, "Destination_cityscape");
    if (hostile) {
      page.imageinfo[0].url = "https://evil.test/tracking.svg";
      page.imageinfo[0].mime = "image/svg+xml";
      page.imageinfo[0].extmetadata.LicenseUrl.value =
        "https://evil.test/license";
    }
    if (rejection)
      page.imageinfo[0].extmetadata.ImageDescription.value =
        "A pigeon on a flower in a cityscape";
    return Response.json({ query: { pages: [page] } });
  });
  return { ...transport, requests };
}
test("T1 entity images and T2 confirmed depicts become bounded pending candidates with safe reviewer metadata", async () => {
  const f = fixture();
  const candidates = await createCommonsMediaDiscovery(
    f.api,
    () => "2026-10-10T12:00:00Z",
  ).discover(identity, "destination.card", []);
  assert.equal(candidates.length, 2);
  assert.deepEqual(
    candidates.map((c) => c.sourceTier),
    ["T1", "T2"],
  );
  assert.ok(candidates.every((c) => c.decision === "pending-review"));
  const c = candidates[0];
  assert.equal(c.asset.id, "commons:900001");
  assert.equal(c.asset.author, "Synthetic author");
  assert.equal(c.asset.checksum?.value, "a".repeat(40));
  assert.equal(c.asset.license?.verifiedAt, "2026-10-10T12:00:00Z");
  assert.doesNotMatch(
    JSON.stringify(candidates),
    /<script>|<a |evil.test|unsafe\(\)/,
  );
  assert.deepEqual(f.counts, { wikidata: 1, commons: 3 });
  assert.ok(
    f.requests.every(
      (r) =>
        !r.params.ggscoord &&
        !r.params.gsrradius &&
        !r.params.gsrsearch?.includes("Destination"),
    ),
  );
});
test("a stale depicts search result without exact P180 is rejected, never promoted by title or score", async () => {
  const f = fixture({ mismatch: true });
  const candidates = await createCommonsMediaDiscovery(f.api).discover(
    identity,
    "destination.card",
    [],
  );
  const t2 = candidates.find((c) => c.sourceTier === "T2")!;
  assert.equal(t2.decision, "rejected");
  assert.equal(t2.evaluation.identity.status, "fail");
});
test("hostile URLs/licences never cause arbitrary fetches and remain rejected metadata", async () => {
  const f = fixture({ hostile: true });
  const result = await createCommonsMediaDiscovery(f.api).discover(
    identity,
    "destination.card",
    [],
  );
  assert.equal(
    result.find((c) => c.asset.id === "commons:900001")!.decision,
    "rejected",
  );
  assert.equal(
    result.find((c) => c.asset.id === "commons:900001")!.asset.originalUrl,
    null,
  );
  assert.ok(
    f.requests.every((r) =>
      ["www.wikidata.org", "commons.wikimedia.org"].includes(r.service),
    ),
  );
});
test("hard metadata vetoes override exact entity and depicts associations", async () => {
  const f = fixture({ rejection: true });
  const result = await createCommonsMediaDiscovery(f.api).discover(
    identity,
    "destination.hero",
    [],
  );
  const first = result.find((c) => c.asset.id === "commons:900001")!;
  assert.equal(first.decision, "rejected");
  assert.ok(first.evaluation.vetoReasons.includes("depiction:animal"));
});
test("persistent human rejections suppress exact file IDs even after filename changes", async () => {
  const f = fixture();
  const rejections: MediaRejection[] = [
    {
      subject: identity.subject,
      assetId: "commons:900001",
      reason: "Wrong main subject",
      reviewedAt: "2026-10-10T12:00:00Z",
    },
  ];
  const result = await createCommonsMediaDiscovery(f.api).discover(
    identity,
    "destination.card",
    rejections,
  );
  assert.ok(result.every((c) => c.asset.id !== "commons:900001"));
});
test("unresolved identity cannot start Commons discovery", async () => {
  const f = fixture();
  assert.deepEqual(
    await createCommonsMediaDiscovery(f.api).discover(
      {
        ...identity,
        external: null,
        resolutionMethod: "unresolved",
        confidence: "unresolved",
        resolvedAt: null,
        unresolvedReason: "unknown",
      },
      "destination.card",
      [],
    ),
    [],
  );
  assert.equal(f.requests.length, 0);
});
test("transport enforces timeout, response size, redirects, rate limits and safe failure reasons", async () => {
  for (const fetcher of [
    async () => new Response(null, { status: 429 }),
    async () => new Response(null, { status: 503 }),
    async () => Response.json({ error: { info: "private unsafe details" } }),
    async () => new Response("malformed private text"),
    async () =>
      new Response("{}", { headers: { "content-length": "2000001" } }),
    async () => new Response("x".repeat(2_000_001)),
    async () => {
      throw Error("private token value");
    },
    () => new Promise<Response>(() => {}),
  ]) {
    const { api } = createMediaApi(fetcher, 10);
    await assert.rejects(
      api.get("wikidata", { action: "wbgetentities", ids: "Q1" }),
      /^Error: media-metadata-unavailable$/,
    );
  }
});
test("hard request caps prevent pagination, retries and unbounded entity metadata", async () => {
  const f = createMediaApi(async () => Response.json({ success: 1 }));
  for (let i = 0; i < MEDIA_REQUEST_LIMITS.wikidata; i++)
    await f.api.get("wikidata", { action: "wbgetentities", ids: "Q1" });
  await assert.rejects(
    f.api.get("wikidata", { action: "wbgetentities", ids: "Q1" }),
  );
  for (let i = 0; i < MEDIA_REQUEST_LIMITS.commons; i++)
    await f.api.get("commons", { action: "query" });
  await assert.rejects(f.api.get("commons", { action: "query" }));
  assert.equal(f.counts.wikidata + f.counts.commons, 14);
});
test("live orchestration fails safely with no publication or AI side effects", async () => {
  const r = await discoverDestinationMedia(
    identity,
    {
      live: true,
      role: "destination.card",
      reviewed: identity,
      rejections: [],
    },
    async (input) => {
      assert.match(String(input), /^https:\/\/www.wikidata.org\/w\/api.php\?/);
      return new Response(null, { status: 503 });
    },
  );
  assert.equal(r.status, "unavailable");
  assert.equal(r.automaticApproval, false);
  assert.deepEqual(r.candidates, []);
});
test("metadata sanitization removes raw HTML and controls, with fixed length bounds", () => {
  assert.equal(
    plainMetadata("<script>bad()</script><b>Author</b>&amp; &lt;tag&gt;\u0000"),
    "Author & tag",
  );
  assert.equal(plainMetadata("x".repeat(11000)), "");
  assert.equal(plainMetadata("x".repeat(3000), 500).length, 500);
});
