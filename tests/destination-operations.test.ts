// Historical record/access regression. Live archive exclusion is tested in destination-archive.test.ts.
import { publishedDestinationIds } from "./fixtures/published-destinations";
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync, rmSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  validateQueueData,
  validateResearchData,
} from "../src/content/operator/operations";
import { destinationCoverage } from "../scripts/lib/destination-coverage";
import { loadContentOperations } from "./fixtures/archived-destination-data";
import {
  parseCoverageArguments,
  readCoverageBatch,
  runCoverageCommand,
} from "../scripts/coverage-destinations";
import {
  contentFixtureContext,
  destinationContentFixture,
  contentTestNow,
} from "./fixtures/destination-content";
import { placeRegistryData } from "../content/places/records";
import { destinationContentData } from "./fixtures/archived-destination-data";
import { destinationQueueData } from "../content/operations/queue/records";
import { destinationResearchData } from "../content/research/destinations/records";
import mediaFixture from "./fixtures/media/approved.synthetic.json";
import type { PlaceMediaData } from "../src/domain/media/types";
import { fixtureReceipt } from "./fixtures/editorial-receipt";

function coverageInput() {
  const context = contentFixtureContext();
  const data = destinationContentFixture();
  fixtureReceipt(data.records[0], context.identities[0]);
  return {
    destinationId: context.identities[0].subject,
    context,
    data,
    evidence: "available" as const,
    filesValid: true,
    media: {
      schemaVersion: 1,
      places: [...context.identities],
      assets: [],
      selections: [],
      rejections: [],
    } as PlaceMediaData,
    now: contentTestNow,
    seo: [],
  };
}
test("coverage reports identity missing, identity only and evidence without a draft", async () => {
  const input = coverageInput();
  input.data.records = [];
  const missing = await destinationCoverage({
    ...input,
    destinationId: "world:unknown",
    evidence: "missing",
  });
  assert.equal(missing.identity, "missing");
  assert.equal(missing.lifecycle, "identity-missing");
  const identity = await destinationCoverage({ ...input, evidence: "missing" });
  assert.equal(identity.lifecycle, "research-missing");
  assert.equal(identity.draft, "missing");
  const evidence = await destinationCoverage(input);
  assert.equal(evidence.lifecycle, "draft-missing");
  assert.equal(evidence.contentReviewed, false);
});
test("coverage distinguishes draft, reviewed, withdrawn and expired without transitions", async () => {
  const input = coverageInput();
  assert.equal(
    (await destinationCoverage(input)).lifecycle,
    "runtime-eligible",
  );
  input.data.records[0].reviewStatus = "draft";
  input.data.records[0].reviewedAt = null;
  assert.equal((await destinationCoverage(input)).lifecycle, "review-pending");
  input.data.records[0].reviewStatus = "withdrawn";
  // Withdrawn review metadata follows existing record policy.
  input.data.records[0].reviewedAt = "2026-10-10T00:00:00Z";
  assert.equal((await destinationCoverage(input)).lifecycle, "withdrawn");
  const expired = coverageInput(),
    record = expired.data.records[0];
  for (const item of [
    record.overview,
    ...(record.highlights ?? []),
    ...(record.attractions ?? []),
    ...(record.areas ?? []),
    ...(record.transport ?? []),
    ...(record.practicalNotes ?? []),
    ...(record.dayTemplates ?? []),
  ])
    if (item && item.freshness.kind !== "volatile")
      item.freshness = {
        kind: "periodically-reviewed",
        reviewBy: "2026-10-11T00:00:00Z",
      };
  fixtureReceipt(record, expired.context.identities[0]);
  const result = await destinationCoverage({
    ...expired,
    now: Date.parse("2027-10-12T00:00:00Z"),
  });
  assert.equal(result.lifecycle, "expired");
  assert.equal(result.contentReviewed, true);
  assert.equal(result.publication, "no-current-content");
});
test("media coverage observes approvals separately from content and SEO", async () => {
  const input = coverageInput(),
    media = structuredClone(mediaFixture) as PlaceMediaData;
  input.data.records = [];
  input.context.identities = media.places;
  const result = await destinationCoverage({
    ...input,
    media,
    destinationId: media.places[0].subject,
  });
  assert.equal(result.mediaDestination, "available");
  assert.equal(result.mediaAttractions, "unsupported");
  assert.equal(result.contentReviewed, false);
  assert.equal(result.seo.state, "not-registered");
});
test("operational records validate unknown fields, orphans, statuses and explicit unresolved queue candidates", () => {
  const identities = placeRegistryData.records;
  assert.deepEqual(
    validateResearchData(
      destinationResearchData,
      identities,
      destinationQueueData.records,
    ),
    [],
  );
  for (const patch of [
    { destinationId: "unknown" },
    { status: "published" },
    { report: "../secrets.md" },
    { sourceCount: -1 },
    { sourceCount: Infinity },
    { automaticApproval: true },
    { unresolvedIssues: ["<script>"] },
    { researchedAt: "today" },
  ])
    assert.ok(
      validateResearchData(
        {
          schemaVersion: 1,
          records: [
            {
              ...destinationResearchData.records.find(
                (record) => record.destinationId === "city:BCN",
              )!,
              ...patch,
            },
          ],
        },
        identities,
      ).length,
    );
  assert.ok(
    validateResearchData(
      {
        schemaVersion: 1,
        records: [
          destinationResearchData.records.find(
            (record) => record.destinationId === "city:BCN",
          )!,
          destinationResearchData.records.find(
            (record) => record.destinationId === "city:BCN",
          )!,
        ],
      },
      identities,
    ).length,
  );
  const task = {
    destinationId: "future:worldwide",
    identityState: "unresolved-candidate",
    priority: "normal",
    reason: "Future demand review",
    status: "queued",
  };
  assert.deepEqual(
    validateQueueData({ schemaVersion: 1, records: [task] }, identities),
    [],
  );
  assert.ok(
    validateQueueData(
      { schemaVersion: 1, records: [{ ...task, identityState: "registered" }] },
      identities,
    ).length,
  );
  assert.ok(
    validateQueueData(
      {
        schemaVersion: 1,
        records: [{ ...task, destinationId: identities[0].subject }],
      },
      identities,
    ).length,
  );
  assert.deepEqual(
    validateQueueData(
      {
        schemaVersion: 1,
        records: [
          {
            ...task,
            destinationId: identities[0].subject,
            identityState: "registered",
          },
        ],
      },
      identities,
    ),
    [],
  );
  assert.ok(
    validateQueueData({ schemaVersion: 1, records: [task, task] }, identities)
      .length,
  );
});
test("research metadata supports all operational states without implying publication", () => {
  for (const status of ["in-progress", "available", "needs-recheck", "blocked"])
    assert.deepEqual(
      validateResearchData(
        {
          schemaVersion: 1,
          records: [
            {
              ...destinationResearchData.records.find(
                (record) => record.destinationId === "city:BCN",
              )!,
              status,
            },
          ],
        },
        placeRegistryData.records,
      ),
      [],
    );
});
test("coverage inputs are bounded per batch and reject live/approval/global flags", () => {
  assert.equal(
    parseCoverageArguments(["--destination", "anywhere:future"]).destination,
    "anywhere:future",
  );
  assert.equal(
    parseCoverageArguments(["--limit", "100", "--offset", "12000"]).offset,
    12000,
  );
  for (const args of [
    ["--all-world", "yes"],
    ["--live", "true"],
    ["--approve", "yes"],
    ["--limit", "101"],
    ["--destination", "x", "--file", "file.json"],
    ["--destination", "../x"],
    ["--offset", "-1"],
    ["--limit", "NaN"],
  ])
    assert.throws(() => parseCoverageArguments(args));
  const dir = mkdtempSync(join(tmpdir(), "coverage-batch-")),
    file = join(dir, "batch.json");
  try {
    writeFileSync(file, JSON.stringify(["future:one", "another-region"]));
    assert.deepEqual(readCoverageBatch(file), ["future:one", "another-region"]);
    for (const value of [
      ["x", "x"],
      ["../x"],
      Array.from({ length: 101 }, (_, i) => `world:${i}`),
      { ids: ["x"] },
    ]) {
      writeFileSync(file, JSON.stringify(value));
      assert.throws(() => readCoverageBatch(file));
    }
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
test("ordinary operations are read-only, offline and never approve any pilot", async (t) => {
  let calls = 0;
  t.mock.method(globalThis, "fetch", async () => {
    calls++;
    throw Error("network forbidden");
  });
  t.mock.method(console, "log", () => {});
  const before = JSON.stringify(destinationContentData),
    media = readFileSync("content/media/approved.json", "utf8");
  const operations = loadContentOperations();
  assert.equal(operations.queue.length, destinationQueueData.records.length);
  assert.equal(await runCoverageCommand([]), 0);
  assert.equal(
    await runCoverageCommand(["--destination", "future:unknown"]),
    0,
  );
  assert.equal(calls, 0);
  assert.equal(JSON.stringify(destinationContentData), before);
  assert.equal(readFileSync("content/media/approved.json", "utf8"), media);
  assert.equal(
    destinationContentData.records.filter((record) =>
      ["city:BCN", "crete", "prishtina"].includes(record.destinationId),
    ).length,
    3,
  );
  for (const record of destinationContentData.records.filter(
    (r) => !publishedDestinationIds.includes(r.destinationId),
  )) {
    assert.equal(record.reviewStatus, "draft");
    assert.equal(record.reviewedAt, null);
  }
});
