import { sampleMarket } from "./flight-provider-fixture";
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { researchMarkets, researchCurrency } from "../scripts/research/markets";
import {
  createResearchNetwork,
  sampleRequests,
  safeRawMetrics,
  readResearchArgs,
  MAX_FARE_REQUESTS,
  MAX_METADATA_REQUESTS,
} from "../scripts/research-markets";
import { seoLandingRegistry, approvedLanding } from "../src/seo/registry";
import { approvedLandingKeys } from "../src/seo/approved-keys";
import { isEnglishLandingPath } from "../src/seo/paths";
import { seoSitemap } from "../src/seo/publication";
import { seoQuality } from "../src/seo/policy";

const dublin = researchMarkets.find((m) => m.id === "dublin")!;
const clock = () => new Date("2026-10-08T12:00:00Z");
const row = {
  origin: "DUB",
  destination: "VIE",
  price: 40,
  departure_at: "2026-11-07",
  return_at: "2026-11-09",
  found_at: "2026-10-08T11:00:00Z",
};
test("research has exactly 30 reviewed origins across four regions, independent of publication", () => {
  assert.equal(researchMarkets.length, 30);
  assert.equal(new Set(researchMarkets.map((m) => m.id)).size, 30);
  assert.equal(new Set(researchMarkets.map((m) => m.region)).size, 4);
  for (const m of researchMarkets) {
    assert.match(m.code, /^[A-Z]{3}$/);
    assert.ok(m.budgetBands.every((n) => Number.isInteger(n) && n > 0));
    assert.equal(sampleRequests(m, "2026-11").length, 5);
  }
});
test("offline default, reviewed origin selection and valid months reject arbitrary inputs", () => {
  assert.equal(readResearchArgs([]).live, false);
  assert.deepEqual(
    readResearchArgs([
      "--live",
      "--origins=dublin,london",
      "--month=2026-11",
    ]).markets.map((m) => m.id),
    ["london", "dublin"],
  );
  for (const args of [
    ["--origins=unknown"],
    ["--origins=dublin,dublin"],
    ["--month=2026-13"],
    ["--url=https://private.example"],
    ["--token=private"],
  ])
    assert.throws(() => readResearchArgs(args));
});
test("missing native currencies are explicit USD route probes with no native budget evaluation", async () => {
  const market = researchMarkets.find((m) => m.id === "singapore")!;
  assert.deepEqual(researchCurrency(market), {
    currency: "USD",
    nativeReady: false,
  });
  const network = createResearchNetwork(
    async () =>
      Response.json({
        success: true,
        currency: "usd",
        data: [{ ...row, origin: "SIN" }],
      }),
    0,
  );
  const samples = await sampleMarket(
    market,
    "2026-11",
    "synthetic",
    network,
    clock,
  );
  assert.ok(
    samples.every(
      (s) =>
        s.nativeCurrency === "SGD" &&
        s.queryCurrency === "USD" &&
        !s.nativePlanningReady,
    ),
  );
  assert.ok(
    samples.every(
      (s) => s.completeFlightCandidates === null && s.budgetBands.length === 0,
    ),
  );
});
test("five date scenarios and three budget bands reuse exactly three production month requests", async () => {
  let calls = 0;
  const network = createResearchNetwork(async (url, options) => {
    calls++;
    const u = new URL(url);
    assert.equal(u.hostname, "api.travelpayouts.com");
    assert.match(u.searchParams.get("departure_at")!, /^2026-(11|12)$/);
    assert.equal(u.searchParams.get("market"), "us");
    assert.equal(u.searchParams.get("token"), null);
    assert.equal(
      new Headers(options.headers).get("X-Access-Token"),
      "synthetic",
    );
    return Response.json({ success: true, currency: "EUR", data: [row] });
  }, 0);
  const samples = await sampleMarket(
    dublin,
    "2026-11",
    "synthetic",
    network,
    clock,
  );
  assert.equal(calls, 3);
  assert.equal(network.counts.fares, 3);
  assert.equal(samples.length, 5);
  assert.equal(samples[0].completeFlightCandidates, 1);
  assert.equal(samples[1].matchingFares, 0);
  assert.equal(samples[1].referenceFares, 1);
  assert.equal(samples[3].matchingFares, 1);
  assert.equal(samples[0].budgetBands.length, 3);
  assert.equal(samples[0].budgetBands[0].completeFlightFits, 0);
  assert.equal(samples[0].budgetBands[1].completeFlightFits, 1);
  assert.equal(samples[1].budgetBands[2].completeFlightFits, 0);
});
test("documented missing currency echo permits usable evidence only with an actual observation", async () => {
  const market = researchMarkets.find((m) => m.id === "london")!;
  const network = createResearchNetwork(
    async () =>
      Response.json({ success: true, data: [{ ...row, origin: "LON" }] }),
    0,
  );
  const samples = await sampleMarket(
    market,
    "2026-11",
    "synthetic",
    network,
    clock,
  );
  assert.equal(samples[0].providerSuccess, true);
  assert.equal(samples[0].rawFares, 1);
  assert.equal(samples[0].failure, null);
  assert.equal(samples[0].completeFlightCandidates, 1);
});
test("research network caps requests, deduplicates metadata, excludes images/AI/affiliate endpoints", async () => {
  let calls = 0;
  const network = createResearchNetwork(async () => {
    calls++;
    return Response.json({ success: true, data: [] });
  }, 0);
  for (let i = 0; i < MAX_FARE_REQUESTS + 1; i++)
    await network.fetch(
      `https://api.travelpayouts.com/aviasales/v3/prices_for_dates?page=${i}`,
      {},
    );
  assert.equal(calls, MAX_FARE_REQUESTS);
  for (let i = 0; i < 2; i++)
    await network.fetch(
      "https://autocomplete.travelpayouts.com/places2?term=VIE",
      {},
    );
  assert.equal(network.counts.metadata, 1);
  for (const url of [
    "https://api.openai.com/v1/responses",
    "https://api.travelpayouts.com/links/v1/create",
    "https://commons.wikimedia.org/w/api.php",
    "https://api.travelpayouts.com/aviasales/v3/prices_for_dates?token=private",
  ])
    await assert.rejects(network.fetch(url, {}));
});
test("streamed responses are cancelled above 2 MB without buffering the remainder or logging private content", async (t) => {
  const logs = ["log", "info", "warn", "error", "debug"] as const;
  const spies = logs.map((method) => t.mock.method(console, method, () => {}));
  const privateText = "synthetic-private-response-content";
  const firstChunk = new Uint8Array(1_000_000);
  firstChunk.set(new TextEncoder().encode(privateText));
  let chunksRead = 0;
  let cancelled = false;
  const stream = new ReadableStream<Uint8Array>(
    {
      pull(controller) {
        chunksRead++;
        if (chunksRead === 3) {
          controller.enqueue(new TextEncoder().encode("unneeded-remainder"));
          controller.close();
          return;
        }
        controller.enqueue(
          chunksRead === 1 ? firstChunk : new Uint8Array(1_000_001),
        );
      },
      cancel() {
        cancelled = true;
      },
    },
    { highWaterMark: 0 },
  );
  const network = createResearchNetwork(async () => new Response(stream), 0);
  await assert.rejects(
    network.fetch(
      "https://api.travelpayouts.com/aviasales/v3/prices_for_dates?origin=DUB",
      {},
    ),
    (error: unknown) => {
      assert.ok(error instanceof Error);
      assert.equal(error.message, "oversized-response");
      assert.equal(String(error).includes(privateText), false);
      return true;
    },
  );
  assert.equal(cancelled, true);
  assert.equal(chunksRead, 2);
  assert.equal(network.metrics.size, 0);
  assert.equal(network.counts.fares, 1);
  for (const spy of spies) assert.equal(spy.mock.callCount(), 0);
});
for (const status of [401, 429])
  test(`queued requests after HTTP ${status} are not counted as physical fetches`, async () => {
    let finishFirst!: (response: Response) => void;
    const firstResponse = new Promise<Response>((resolve) => {
      finishFirst = resolve;
    });
    let calls = 0;
    const network = createResearchNetwork(async () => {
      calls++;
      return firstResponse;
    }, 0);
    const pending = [
      network.fetch(
        "https://api.travelpayouts.com/aviasales/v3/prices_for_dates?origin=DUB",
        {},
      ),
      network.fetch(
        "https://api.travelpayouts.com/aviasales/v3/prices_for_dates?origin=LON",
        {},
      ),
      network.fetch(
        "https://autocomplete.travelpayouts.com/places2?term=VIE",
        {},
      ),
    ];
    finishFirst(Response.json({ success: false }, { status }));
    const responses = await Promise.all(pending);
    assert.ok(responses.every((response) => response.status === status));
    assert.equal(calls, 1);
    assert.equal(network.counts.fares, 1);
    assert.equal(network.counts.metadata, 0);
    assert.equal(
      network.stopped(),
      status === 401 ? "authentication" : "rate-limit",
    );
  });
test("metadata cap reports denied lookups without counting network calls or discarding cached metadata", async () => {
  let calls = 0;
  const network = createResearchNetwork(async () => {
    calls++;
    return Response.json([]);
  }, 0);
  for (let i = 0; i < MAX_METADATA_REQUESTS; i++) {
    const response = await network.fetch(
      `https://autocomplete.travelpayouts.com/places2?term=VIE&sample=${i}`,
      {},
    );
    assert.equal(response.status, 200);
  }
  assert.equal(network.counts.metadataLimitReached, false);
  assert.equal(network.counts.metadataDenied, 0);
  for (const term of ["WAW", "BUD"]) {
    const response = await network.fetch(
      `https://autocomplete.travelpayouts.com/places2?term=${term}`,
      {},
    );
    assert.equal(response.status, 503);
  }
  assert.equal(calls, MAX_METADATA_REQUESTS);
  assert.equal(network.counts.metadata, MAX_METADATA_REQUESTS);
  assert.equal(network.counts.metadataLimitReached, true);
  assert.equal(network.counts.metadataDenied, 2);
  const cached = await network.fetch(
    "https://autocomplete.travelpayouts.com/places2?term=VIE&sample=0",
    {},
  );
  assert.equal(cached.status, 200);
  assert.deepEqual(await cached.json(), []);
  assert.equal(calls, MAX_METADATA_REQUESTS);
  assert.equal(network.counts.cacheHits, 1);
  assert.equal(network.counts.metadataDenied, 2);
});
for (const status of [401, 429])
  test(`HTTP ${status} stops additional research requests and exposes no raw error`, async () => {
    let calls = 0;
    const network = createResearchNetwork(async () => {
      calls++;
      return Response.json({ error: "synthetic-private" }, { status });
    }, 0);
    const samples = await sampleMarket(
      dublin,
      "2026-11",
      "synthetic-private",
      network,
      clock,
    );
    assert.equal(calls, 1);
    assert.equal(samples.length, 1);
    assert.equal(samples[0].httpStatus, status);
    assert.equal(JSON.stringify(samples).includes("synthetic-private"), false);
    assert.equal(
      network.stopped(),
      status === 401 ? "authentication" : "rate-limit",
    );
  });
test("raw coverage metrics cannot leak links, headers, token, amounts or arbitrary provider strings", () => {
  const raw = safeRawMetrics({
    success: true,
    currency: "secret",
    data: [
      {
        destination: "VIE",
        price: 999,
        link: "https://tracked.example?marker=private",
        token: "private",
      },
      { destination: "private" },
    ],
    headers: { Authorization: "private" },
  });
  assert.deepEqual(raw, {
    providerSuccess: true,
    rawFares: 2,
    destinationCodes: ["VIE"],
    currencyEchoPresent: true,
    rowsWithCurrencyEcho: 0,
  });
});
test("research does not change the approved Zurich and launch-hub identities, paths or EUR publication intent", () => {
  assert.deepEqual(approvedLandingKeys, [
    { locale: "en", originId: "zurich", intent: "origin" },
    { locale: "en", originId: "zurich", intent: "weekend" },
    {
      locale: "en",
      originId: "zurich",
      intent: "budget",
      budget: { cents: 50000, currency: "EUR" },
    },
    // Owner approval, 5 November 2026: launch-market origin hubs only.
    { locale: "en", originId: "tirana", intent: "origin" },
  ]);
  assert.deepEqual(
    seoLandingRegistry.map((p) => p.path),
    [
      "/from/zurich",
      "/from/zurich/weekend-trips",
      "/from/zurich/weekend-trips-under-500",
      "/from/tirana",
    ],
  );
  assert.ok(seoLandingRegistry.every((p) => p.planningCurrency === "EUR"));
});
test("all research markets and research assets remain non-public without separate approval", () => {
  const launchHubs = new Set(["tirana"]);
  for (const m of researchMarkets.filter((m) => m.id !== "zurich"))
    for (const suffix of ["", "/weekend-trips", "/weekend-trips-under-500"]) {
      // The approved hub itself is public; its weekend/budget children are not.
      if (launchHubs.has(m.id) && suffix === "") continue;
      const path = `/from/${m.id}${suffix}`;
      assert.equal(approvedLanding(path), undefined);
      assert.equal(isEnglishLandingPath(path), false);
    }
  for (const path of [
    "/research",
    "/research/weekend-affordability",
    "/research/london-weekend-budget-snapshot",
    "/from/chicago/weekend-trips-under-1200",
    "/from/amsterdam/weekend-trips-under-700",
    "/from",
    "/sq/from/london",
  ])
    assert.equal(approvedLanding(path), undefined);
  const files = (dir: string): string[] =>
    readdirSync(dir, { withFileTypes: true }).flatMap((entry) =>
      entry.isDirectory()
        ? files(join(dir, entry.name))
        : [join(dir, entry.name)],
    );
  for (const file of files("src"))
    assert.doesNotMatch(
      readFileSync(file, "utf8"),
      /scripts\/research|research-markets|worldwide-market-scorecard|worldwide-keyword-map/,
    );
});
test("sitemap follows stored decisions; recommendations and thresholds do not authorize new indexing", () => {
  assert.deepEqual(
    seoSitemap([]).map((p) => p.url),
    ["https://www.trip-range.com"],
  );
  const draft = {
    ...seoLandingRegistry[0],
    id: "en-london-origin" as const,
    path: "/from/london" as const,
  };
  assert.equal(seoQuality(draft).indexable, false);
});
