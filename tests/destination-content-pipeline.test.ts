import { test } from "node:test";
import assert from "node:assert/strict";
import {
  mkdtempSync,
  writeFileSync,
  rmSync,
  symlinkSync,
  readFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  evaluateDestinationPipeline,
  inspectDestinationEvidence,
} from "../scripts/lib/destination-content-pipeline";
import { parseContentPipelineArguments } from "../scripts/pipeline-destination-content";
import { buildDestinationContentReview } from "../scripts/lib/destination-content-review";
import { fixtureReceipt } from "./fixtures/editorial-receipt";
import {
  destinationContentFixture,
  contentFixtureContext,
  contentTestNow,
} from "./fixtures/destination-content";

function input() {
  const data = destinationContentFixture();
  const record = data.records[0];
  for (const part of [
    record,
    record.overview!,
    ...record.highlights!,
    ...record.attractions!,
    ...record.areas!,
    ...record.transport!,
    ...record.practicalNotes!,
    ...record.dayTemplates!,
  ]) {
    part.reviewStatus = "draft";
    part.reviewedAt = null;
  }
  return {
    destinationId: record.destinationId,
    data,
    context: contentFixtureContext(),
    evidence: "available" as const,
    filesValid: true,
    now: contentTestNow,
  };
}

test("pipeline reports validated draft and pending human review with no promotion, mutation or external calls", async (t) => {
  let calls = 0;
  t.mock.method(globalThis, "fetch", async () => {
    calls++;
    throw Error("network");
  });
  const data = input(),
    original = structuredClone(data);
  const report = await evaluateDestinationPipeline(data);
  assert.equal(report.identity, "available");
  assert.equal(report.research, "available");
  assert.equal(report.draft, "exists");
  assert.equal(report.validation, "valid");
  assert.equal(report.review, "pending");
  assert.equal(report.publication, "not-approved");
  assert.equal(report.automaticApproval, false);
  assert.equal(report.writes, 0);
  assert.equal(calls, 0);
  assert.deepEqual(data, original);
});

test("pipeline reports missing identity, evidence and draft independently", async () => {
  const data = input();
  data.data.records = [];
  const noDraft = await evaluateDestinationPipeline({
    ...data,
    evidence: "missing",
  });
  assert.equal(noDraft.identity, "available");
  assert.equal(noDraft.research, "missing");
  assert.equal(noDraft.draft, "missing");
  assert.equal(noDraft.validation, "not-ready");
  assert.equal(noDraft.review, "not-ready");
  assert.equal(noDraft.publication, "not-approved");
  const unknown = await evaluateDestinationPipeline({
    ...data,
    destinationId: "new-region:anywhere",
  });
  assert.equal(unknown.identity, "missing");
  assert.equal(unknown.draft, "missing");
});

test("existing research never creates unsourced copy or a scaffold automatically", async () => {
  const data = input();
  data.data.records = [];
  const report = await evaluateDestinationPipeline(data);
  assert.match(report.next, /No scaffold was written/);
  assert.equal(report.writes, 0);
  assert.deepEqual(data.data.records, []);
});

test("invalid sources, translations and manifest agreement block the pipeline", async () => {
  for (const kind of ["source", "locale", "files"] as const) {
    const data = input();
    if (kind === "source")
      data.data.records[0].sources[0].url = "javascript:bad";
    if (kind === "locale") delete data.data.records[0].attractions![0].name.en;
    if (kind === "files") data.filesValid = false;
    const report = await evaluateDestinationPipeline(data);
    assert.equal(report.validation, "invalid");
    assert.equal(report.publication, "blocked");
  }
});

test("pipeline can observe existing reviewed/withdrawn state but cannot create it", async () => {
  const data = { ...input(), data: destinationContentFixture() };
  fixtureReceipt(data.data.records[0], data.context.identities[0]);
  assert.equal(
    (await evaluateDestinationPipeline(data)).publication,
    "runtime-eligible",
  );
  data.data.records[0].overview!.text.en += " unreviewed change";
  assert.equal((await evaluateDestinationPipeline(data)).lifecycle, "blocked");
  data.data.records[0].reviewStatus = "withdrawn";
  assert.equal(
    (await evaluateDestinationPipeline(data)).publication,
    "blocked",
  );
  for (const args of [
    ["--destination", "city:ZRH", "--approve", "yes"],
    ["--destination", "x", "--live", "true"],
    ["--all", "true"],
  ])
    assert.throws(() => parseContentPipelineArguments(args));
});

test("pipeline supports arbitrary stable identity and all place kinds without city-specific branches", async () => {
  for (const placeKind of [
    "city",
    "island",
    "region",
    "nature-area",
  ] as const) {
    const data = input();
    data.data.records = [];
    data.context.identities = [
      {
        ...data.context.identities[0],
        subject: `new-${placeKind}`,
        placeKind,
      },
    ];
    const report = await evaluateDestinationPipeline({
      ...data,
      destinationId: `new-${placeKind}`,
    });
    assert.equal(report.identity, "available");
    assert.equal(report.review, "not-ready");
  }
  assert.equal(
    parseContentPipelineArguments(["--destination", "world:future-123"]),
    "world:future-123",
  );
});

test("evidence lookup is explicit, bounded, read-only and rejects traversal/symlinks", () => {
  const dir = mkdtempSync(join(tmpdir(), "content-evidence-"));
  try {
    const record = {
      destinationId: "global:example",
      status: "available" as const,
      report: "evidence.md",
      researchedAt: "2026-10-12T00:00:00Z",
      sourceCount: 1,
      unresolvedIssues: [],
    };
    assert.equal(inspectDestinationEvidence(record, dir), "invalid");
    writeFileSync(
      join(dir, "evidence.md"),
      "Source-backed research awaiting editorial review.",
    );
    assert.equal(inspectDestinationEvidence(record, dir), "available");
    assert.equal(inspectDestinationEvidence(undefined, dir), "missing");
    record.report = "../evidence.md";
    assert.equal(inspectDestinationEvidence(record, dir), "invalid");
    record.report = "link.md";
    symlinkSync(join(dir, "evidence.md"), join(dir, "link.md"));
    assert.equal(inspectDestinationEvidence(record, dir), "invalid");
    record.report = "evidence.md";
    writeFileSync(join(dir, "evidence.md"), "");
    assert.equal(inspectDestinationEvidence(record, dir), "invalid");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("review warns about visible content lengths and counts without deleting prose", () => {
  const data = input();
  const record = data.data.records[0];
  record.overview!.text.en = "Long overview. ".repeat(40);
  record.attractions![0].shortDescription.sq = "Përshkrim i gjatë. ".repeat(20);
  record.practicalNotes = Array.from({ length: 7 }, (_, i) => ({
    ...structuredClone(record.practicalNotes![0]),
    id: `note:many:${i}`,
  }));
  record.transport = Array.from({ length: 5 }, (_, i) => ({
    ...structuredClone(record.transport![0]),
    id: `transport:many:${i}`,
  }));
  const before = structuredClone(record);
  const report = buildDestinationContentReview(
    data.data,
    data.context,
    data.destinationId,
    data.now,
  );
  assert.match(report.warnings.join("\n"), /Overview \(en\) too long/);
  assert.match(
    report.warnings.join("\n"),
    /Attraction description .* \(sq\) too long/,
  );
  assert.match(report.warnings.join("\n"), /Practical notes: 7 items/);
  assert.match(report.warnings.join("\n"), /Transport points: 5 items/);
  assert.deepEqual(record, before);
});

test("production code retains no operator pipeline or preview import", () => {
  for (const file of [
    "src/components/travel/FullTrip.tsx",
    "src/components/travel/TripContent.tsx",
    "src/content/runtime/approved.ts",
  ])
    assert.doesNotMatch(
      readFileSync(file, "utf8"),
      /pipeline-destination|preview-destination|evidence\.json|operator\//,
    );
});
