import { test } from "node:test";
import assert from "node:assert/strict";
import {
  readFileSync,
  mkdtempSync,
  mkdirSync,
  symlinkSync,
  readdirSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import datasetJson from "../docs/research/destination-media/dataset.json";
import approved from "./fixtures/media/approved.synthetic.json";
import {
  validateDataset,
  selectCases,
  parseCalibrationArgs,
} from "../src/media/operator/calibration/dataset";
import {
  calibrateDestinationMedia,
  failureCategories,
} from "../src/media/operator/calibration/runner";
import { calibrationMetrics } from "../src/media/operator/calibration/metrics";
import { validateCalibrationReport } from "../src/media/operator/calibration/validation";
import { reviewHtml } from "../src/media/operator/calibration/report";
import { calibrationFiles } from "../scripts/lib/media-calibration-files";
import { createReviewedMediaStore } from "../src/media/runtime/store";
import { displayImageAsset } from "../src/media/runtime/display";
import { createMediaApi } from "../src/media/adapters/api";
import { evaluateCandidate } from "../src/media/operator/evaluate";
import type { MediaAsset } from "../src/domain/media/types";
import type { CalibrationReport } from "../src/media/operator/calibration/types";
const dataset = validateDataset(datasetJson);
const now = () => "2026-10-10T12:00:00Z";
const offline = () =>
  calibrateDestinationMedia(
    dataset,
    { live: false, start: 0, limit: 10 },
    {
      now,
      fetcher: async () => {
        throw Error("offline made fetch");
      },
    },
  );
async function labeledReport(): Promise<CalibrationReport> {
  const report = await offline();
  report.mode = "live";
  report.rows = report.rows.slice(0, 2);
  for (const [index, row] of report.rows.entries()) {
    const c = dataset.cases[index];
    row.status = "complete";
    row.requests = { wikidata: 4, commons: 3 };
    row.identity = {
      ...row.identity,
      external: { authority: "wikidata", id: c.expected.wikidataId! },
      resolutionMethod: "transport-code",
      confidence: "high",
      resolvedAt: now(),
      unresolvedReason: null,
    };
    row.identityReview = {
      identityCorrect: index === 0 ? "yes" : "no",
      reviewedAt: now(),
      reviewerNotes: "Synthetic test label, not live review.",
    };
    const candidate = evaluateCandidate(
      row.identity,
      "destination.card",
      approved.assets[0] as MediaAsset,
      "T1",
      {
        entity: row.identity.external!,
        exactEntityImage: true,
        exactDepicts: true,
        depictionTags: index === 0 ? ["cityscape"] : ["landscape"],
        articleUsage: false,
        recognizedQuality: false,
        withinBounds: false,
      },
    );
    row.candidates = [
      {
        candidate,
        sourceProperties: ["P18"],
        review: {
          imageRelevant: index === 0 ? "yes" : "no",
          roleFit: index === 0 ? "yes" : "no",
          method: "visual",
          reviewedAt: now(),
          reviewerNotes: "Synthetic label to test denominators only.",
        },
      },
    ];
  }
  return report;
}
test("calibration dataset is research-only, covers 36 destinations, six regions, five kinds and ambiguous names", () => {
  assert.equal(dataset.cases.length, 36);
  assert.equal(new Set(dataset.cases.map((c) => c.continent)).size, 6);
  assert.equal(new Set(dataset.cases.map((c) => c.input.placeKind)).size, 5);
  for (const name of [
    "Cambridge",
    "Victoria",
    "Granada",
    "San José",
    "Panama",
    "Washington",
    "Georgia",
  ])
    assert.ok(dataset.cases.some((c) => c.input.name === name));
  assert.ok(
    dataset.cases.slice(0, 10).some((c) => c.input.subject === "crete"),
  );
  for (const mutate of [
    (v: typeof dataset) => v.cases.push(v.cases[0]),
    (v: typeof dataset) => (v.cases[0].expected.countryCode = "XX"),
    (v: typeof dataset) => (v.cases[0].expected.wikidataId = "Qbad"),
    (v: typeof dataset) => (v.cases[0].input.coordinates!.latitude = 500),
  ]) {
    const bad = structuredClone(dataset);
    mutate(bad);
    assert.throws(() => validateDataset(bad));
  }
});
test("batch options require explicit live flag and named run; bounds, selection and resume skip completed IDs", () => {
  assert.equal(parseCalibrationArgs([]).live, false);
  for (const args of [
    ["--live"],
    ["--limit", "13"],
    ["--start", "-1"],
    ["--limit", "0"],
    ["--run", "../../content/media/approved"],
    ["--live", "--live"],
    ["--destination", "london", "--start", "2"],
    ["--report-only", "--live", "--run", "a"],
  ])
    assert.throws(() => parseCalibrationArgs(args));
  assert.equal(
    selectCases(dataset, { live: true, start: 10, limit: 2 })[0].input.subject,
    "barcelona",
  );
  assert.equal(
    selectCases(dataset, { live: true, start: 0, limit: 1 }, ["london"])[0]
      .input.subject,
    "crete",
  );
  assert.equal(
    selectCases(dataset, {
      live: true,
      start: 0,
      limit: 10,
      destination: "sydney",
    }).length,
    1,
  );
  assert.throws(() =>
    selectCases(dataset, { live: false, start: 36, limit: 1 }),
  );
});
test("offline calibration makes zero provider calls and cannot approve; resume preserves labels", async () => {
  const report = await offline();
  assert.equal(report.automaticApproval, false);
  assert.equal(report.automaticIngestion, false);
  assert.ok(
    report.rows.every(
      (r) =>
        r.status === "offline" &&
        r.requests.wikidata === 0 &&
        !r.candidates.length,
    ),
  );
  const continued = await calibrateDestinationMedia(
    dataset,
    { live: false, start: 0, limit: 2 },
    { previous: report, now },
  );
  assert.equal(continued.rows.length, 12);
  assert.deepEqual(continued.rows.slice(0, 10), report.rows);
  assert.deepEqual(validateCalibrationReport(continued, dataset), continued);
});
test("live rate limit stops remaining destination and follow-up metadata requests", async () => {
  let calls = 0;
  const report = await calibrateDestinationMedia(
    dataset,
    { live: true, start: 0, limit: 10 },
    {
      now,
      pause: async () => {},
      fetcher: async () => {
        calls++;
        return new Response("", { status: 429 });
      },
    },
  );
  assert.equal(calls, 1);
  assert.equal(report.rows.length, 1);
  assert.equal(report.stopReason, "rate-limit");
  assert.equal(report.rows[0].failures[0].httpStatus, 429);
  assert.deepEqual(report.rows[0].failureCategories, ["provider-unavailable"]);
  assert.equal(
    calibrationMetrics(report, dataset).expectedResolutionOutcome.value,
    null,
  );
  assert.equal(
    calibrationMetrics(report, dataset).candidateCoverageSuccessfulDiscoveryOnly
      .value,
    null,
  );
  await assert.rejects(
    calibrateDestinationMedia(
      dataset,
      { live: true, start: 0, limit: 1 },
      { previous: report, now },
    ),
  );
  const transport = createMediaApi(async () =>
    Response.json({ error: { code: "maxlag", info: "private raw detail" } }),
  );
  await assert.rejects(transport.api.get("commons", { action: "query" }));
  await assert.rejects(transport.api.get("wikidata", { action: "query" }));
  assert.deepEqual(transport.counts, { wikidata: 0, commons: 1 });
  assert.equal(
    JSON.stringify(transport.failures).includes("private raw detail"),
    false,
  );
});
test("repeated technical failures and total deadline stop without aggressive retries", async () => {
  let calls = 0;
  const report = await calibrateDestinationMedia(
    dataset,
    { live: true, start: 0, limit: 12 },
    {
      now,
      pause: async () => {},
      fetcher: async () => {
        calls++;
        throw Error("secret network text");
      },
    },
  );
  assert.equal(calls, 2);
  assert.equal(report.stopReason, "provider-failures");
  assert.equal(JSON.stringify(report).includes("secret network text"), false);
  let clock = 0;
  const expired = await calibrateDestinationMedia(
    dataset,
    { live: true, start: 0, limit: 12 },
    {
      now,
      clock: () => (clock += 360001),
      fetcher: async () => {
        throw Error("must not fetch");
      },
    },
  );
  assert.equal(expired.rows.length, 0);
  assert.equal(expired.stopReason, "deadline");
});
test("provider-neutral display retains providerFileId without parsing asset ID; Commons compatibility remains", async () => {
  const result = await createReviewedMediaStore(approved).get(
    "city:LON",
    "destination.card",
  );
  assert.equal(result.status, "approved");
  if (result.status !== "approved") return;
  assert.equal(result.image.providerFileId, "900001");
  assert.equal(
    displayImageAsset(result.image).sourceId,
    "wikimedia-commons:900001",
  );
  const alternate = displayImageAsset({
    ...result.image,
    provider: "future-provider",
    providerFileId: "opaque:file:7",
    assetId: "asset-with-no-colon",
  });
  assert.equal(alternate.sourceId, "future-provider:opaque:file:7");
  assert.equal(alternate.author, result.image.author);
  assert.deepEqual(alternate.focalPoint, result.image.focalPoint);
});
test("metrics separate expected identity agreement, human labels, wrong images and place kinds", async () => {
  const report = await labeledReport();
  const m = calibrationMetrics(report, dataset);
  assert.equal(m.expectedIdAgreement.value, 1);
  assert.equal(m.identityPrecision.value, 0.5);
  assert.equal(m.candidateRelevancePrecision.value, 0.5);
  assert.equal(m.wrongImageRate.value, 0.5);
  assert.equal(m.falsePositiveCount, 1);
  assert.equal(m.falseNegativeCount, 0);
  assert.equal(m.byPlaceKind.city.wrongImageRate.value, 0);
  assert.equal(m.byPlaceKind.island.wrongImageRate.value, 1);
  assert.equal(m.byPlaceKind.unknown.wrongImageRate.value, null);
  assert.equal(m.usefulCandidateCoverageReviewedOnly.value, 0.5);
  const pending = await offline();
  const empty = calibrationMetrics(pending, dataset);
  assert.equal(empty.identityPrecision.value, null);
  assert.equal(empty.wrongImageRate.value, null);
});
test("a visually useful rejected candidate is counted as a false negative, never silently approved", async () => {
  const report = await labeledReport();
  const row = report.rows[0],
    entry = row.candidates[0];
  entry.candidate = evaluateCandidate(
    row.identity,
    "destination.card",
    entry.candidate.asset,
    "T1",
    {
      ...entry.candidate.evidence,
      depictionTags: ["landscape", "flora-closeup"],
    },
  );
  assert.equal(calibrationMetrics(report, dataset).falseNegativeCount, 1);
  assert.equal(entry.candidate.decision, "rejected");
});
test("failure categories use actual evidence and do not invent a coordinate cause", async () => {
  const row = (await offline()).rows[0];
  row.status = "unresolved";
  row.identity.unresolvedReason = "ambiguous-name";
  assert.deepEqual(failureCategories(row, dataset.cases[0]), ["ambiguous"]);
  row.identity.unresolvedReason = "insufficient-identity-evidence";
  row.identityEvidence = [
    {
      stage: "constrained-name",
      excluded: ["unsupported-class"],
      evidence: [
        {
          external: { authority: "wikidata", id: "Q84" },
          names: ["London"],
          countryCode: "GB",
          placeKind: "city",
          coordinates: { latitude: 0, longitude: 0 },
          transportCodes: [],
        },
      ],
    },
  ];
  assert.deepEqual(failureCategories(row, dataset.cases[0]), [
    "unsupported-class",
    "coordinate-mismatch",
  ]);
});
test("corrupted research output cannot resume, influence metrics or become HTML", async () => {
  const report = await labeledReport();
  assert.doesNotThrow(() => validateCalibrationReport(report, dataset));
  for (const mutate of [
    (v: CalibrationReport) =>
      (v.rows[0].candidates[0].candidate.evaluation.score = 999),
    (v: CalibrationReport) =>
      (v.rows[0].candidates[0].candidate.asset.originalUrl =
        "https://evil.test/a.jpg"),
    (v: CalibrationReport) =>
      (v.rows[0].candidates[0].review.reviewerNotes = "<script>evil</script>"),
    (v: CalibrationReport) =>
      (v.rows[0].candidates[0].review.method = "pending"),
    (v: CalibrationReport) => (v.rows[0].requests.wikidata = 11),
    (v: CalibrationReport) => (v.datasetHash = "wrong"),
  ]) {
    const bad = structuredClone(report);
    mutate(bad);
    assert.throws(() => validateCalibrationReport(bad, dataset));
  }
  const html = reviewHtml(report, dataset);
  assert.ok(html.includes("Human visual review pending"));
  assert.ok(html.includes("Content-Security-Policy"));
  assert.ok(!html.includes("<script"));
});
test("research persistence has no production-store write path and rejects traversal and symlinks", async () => {
  const before = readFileSync("content/media/approved.json", "utf8");
  const root = mkdtempSync(join(tmpdir(), "media-calibration-"));
  const files = calibrationFiles("fixture", dataset, root);
  const report = await offline();
  files.write(report);
  assert.deepEqual(files.read(), report);
  assert.equal(
    readdirSync(join(root, "docs/research/destination-media/runs")).length,
    3,
  );
  assert.equal(readFileSync("content/media/approved.json", "utf8"), before);
  assert.throws(() => calibrationFiles("../../approved", dataset, root));
  const other = mkdtempSync(join(tmpdir(), "media-calibration-link-"));
  mkdirSync(join(other, "target"));
  symlinkSync(join(other, "target"), join(other, "docs"));
  assert.throws(() => calibrationFiles("fixture", dataset, other));
});

test("synthetic end-to-end calibration records T1 properties and T2 gates without injecting expected IDs", async () => {
  const claim = (value: unknown) => [
    { rank: "normal", mainsnak: { snaktype: "value", datavalue: { value } } },
  ];
  const requests: string[] = [];
  const input = dataset.cases[0].input;
  const report = await calibrateDestinationMedia(
    dataset,
    { live: true, start: 0, limit: 1 },
    {
      now,
      pause: async () => {},
      fetcher: async (request) => {
        const url = new URL(String(request));
        requests.push(url.hostname);
        const p = url.searchParams;
        if (url.hostname === "www.wikidata.org") {
          if (p.get("action") === "query")
            return Response.json({ query: { search: [{ title: "Q84" }] } });
          const values: Record<string, unknown> = {
            Q84: {
              id: "Q84",
              type: "item",
              labels: { en: { value: "London" } },
              claims: {
                P238: claim("LHR"),
                P31: claim({ id: "Q515" }),
                P17: claim({ id: "Q145" }),
                P625: claim({
                  ...input.coordinates,
                  globe: "http://www.wikidata.org/entity/Q2",
                }),
                P18: claim("Synthetic_London_skyline.jpg"),
              },
            },
            Q515: { id: "Q515", type: "item", claims: {} },
            Q145: { id: "Q145", type: "item", claims: { P297: claim("GB") } },
          };
          return Response.json({
            entities: Object.fromEntries(
              p
                .get("ids")!
                .split("|")
                .map((id) => [id, values[id]]),
            ),
          });
        }
        assert.equal(url.hostname, "commons.wikimedia.org");
        if (p.get("action") === "wbgetentities")
          return Response.json({
            entities: {
              M900001: {
                id: "M900001",
                type: "mediainfo",
                statements: { P180: claim({ id: "Q84" }) },
              },
            },
          });
        const a = approved.assets[0];
        return Response.json({
          query: {
            pages: [
              {
                pageid: 900001,
                ns: 6,
                title: "File:Synthetic_London_skyline.jpg",
                imageinfo: [
                  {
                    url: a.originalUrl,
                    descriptionurl: a.sourcePage,
                    width: a.width,
                    height: a.height,
                    size: 10000,
                    sha1: a.checksum.value,
                    mime: a.mimeType,
                    mediatype: "BITMAP",
                    extmetadata: {
                      Artist: { value: a.author },
                      LicenseShortName: { value: a.license.name },
                      LicenseUrl: { value: a.license.url },
                      ImageDescription: { value: "Synthetic cityscape" },
                    },
                  },
                ],
              },
            ],
          },
        });
      },
    },
  );
  assert.equal(report.rows[0].identity.external?.id, "Q84");
  assert.equal(report.rows[0].identity.resolutionMethod, "transport-code");
  assert.equal(report.rows[0].candidates.length, 1);
  assert.deepEqual(report.rows[0].candidates[0].sourceProperties, ["P18"]);
  assert.equal(report.rows[0].candidates[0].review.method, "pending");
  assert.equal(
    report.rows[0].candidates[0].candidate.decision,
    "pending-review",
  );
  assert.deepEqual(report.rows[0].requests, { wikidata: 4, commons: 3 });
  assert.equal(requests.length, 7);
  assert.doesNotThrow(() => validateCalibrationReport(report, dataset));
  assert.equal(calibrationMetrics(report, dataset).wrongImageRate.value, null);
});
