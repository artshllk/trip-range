import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { draftContentPreview } from "./fixtures/destination-content-draft-preview";
import { createReviewedDestinationContentStore } from "../src/content/runtime/store";
import {
  destinationContentFixture,
  contentFixtureContext,
  contentTestNow,
} from "./fixtures/destination-content";
import type { ContentReview } from "../src/domain/destination-content/types";

function draftFixture() {
  const data = destinationContentFixture();
  const record = data.records[0];
  const parts: ContentReview[] = [
    record,
    record.overview!,
    ...record.highlights!,
    ...record.attractions!,
    ...record.areas!,
    ...record.transport!,
    ...record.practicalNotes!,
    ...record.dayTemplates!,
  ];
  for (const part of parts) {
    part.reviewStatus = "draft";
    part.reviewedAt = null;
  }
  return data;
}

test("isolated draft projection renders valid content without approving or mutating originals", async () => {
  const data = draftFixture();
  const original = structuredClone(data);
  const context = contentFixtureContext();
  const id = data.records[0].destinationId;
  const preview = await draftContentPreview(data, context, id, contentTestNow);
  assert.equal(preview.status, "reviewed");
  if (preview.status !== "reviewed") return;
  assert.equal(preview.content.attractions?.length, 1);
  assert.equal(
    preview.content.attractions?.[0].name.sq,
    original.records[0].attractions?.[0].name.sq,
  );
  assert.deepEqual(data, original);
  assert.deepEqual(
    await createReviewedDestinationContentStore(
      data,
      context,
      () => contentTestNow,
    ).get(id),
    { status: "none", reason: "not-reviewed" },
  );
  preview.content.attractions![0].name.en = "Preview-local mutation";
  assert.deepEqual(data, original, "Preview owns its cloned content");
});

test("draft preview cannot bypass source, EN/SQ or day-reference validation", async () => {
  for (const invalid of ["source", "translation", "reference"] as const) {
    const data = draftFixture();
    const record = data.records[0];
    if (invalid === "source") record.sources[1].url = "javascript:alert(1)";
    if (invalid === "translation") delete record.attractions![0].name.en;
    if (invalid === "reference")
      record.dayTemplates![0].stops[0].attractionId = "unknown-attraction";
    await assert.rejects(
      draftContentPreview(
        data,
        contentFixtureContext(),
        record.destinationId,
        contentTestNow,
      ),
      /invalid-draft-data/,
    );
  }
});

test("preview rejects unknown destinations and mixed reviewed/draft content", async () => {
  const data = draftFixture();
  await assert.rejects(
    draftContentPreview(
      data,
      contentFixtureContext(),
      "unknown",
      contentTestNow,
    ),
    /draft-not-found/,
  );
  data.records[0].attractions![0].reviewStatus = "reviewed";
  data.records[0].attractions![0].reviewedAt = "2026-10-10T00:00:00Z";
  await assert.rejects(
    draftContentPreview(
      data,
      contentFixtureContext(),
      data.records[0].destinationId,
      contentTestNow,
    ),
    /preview-requires-all-draft-record/,
  );
});

test("draft preview preserves real expiry filtering for stale facts", async () => {
  const data = draftFixture();
  const result = await draftContentPreview(
    data,
    contentFixtureContext(),
    data.records[0].destinationId,
    Date.parse("2026-11-01T12:00:00Z"),
  );
  assert.equal(result.status, "reviewed");
  if (result.status !== "reviewed") return;
  assert.equal(
    result.content.transport?.length,
    0,
    "Expired periodic transport is omitted",
  );
  assert.equal(
    result.content.practicalNotes?.length,
    0,
    "Expired volatile fare is omitted",
  );
  assert.equal(result.content.attractions?.length, 1, "Stable content remains");
});

test("draft preview performs no runtime research or external URL requests", async () => {
  const originalFetch = globalThis.fetch;
  let calls = 0;
  globalThis.fetch = async () => {
    calls++;
    throw Error("network-forbidden");
  };
  try {
    const data = draftFixture();
    await draftContentPreview(
      data,
      contentFixtureContext(),
      data.records[0].destinationId,
      contentTestNow,
    );
    assert.equal(calls, 0);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("draft preview helpers never enter application or production content imports", () => {
  for (const directory of ["src", "content"]) {
    for (const path of readdirSync(directory, { recursive: true })) {
      if (typeof path !== "string" || !/\.tsx?$/.test(path)) continue;
      assert.doesNotMatch(
        readFileSync(join(directory, path), "utf8"),
        /destination-content-draft-preview|destination-content-pilot-browser|draftContentPreview|PILOT_DRAFT_PREVIEW/,
      );
    }
  }
  const harness = readFileSync(
    "scripts/verify-destination-content-pilot-browser.mjs",
    "utf8",
  );
  assert.match(harness, /server\.listen\(0, "127\.0\.0\.1"\)/);
  assert.match(harness, /DRAFT — NOT PUBLISHED/);
  assert.match(harness, /noindex, nofollow/);
  const fixture = readFileSync(
    "tests/fixtures/destination-content-pilot-browser.tsx",
    "utf8",
  );
  assert.doesNotMatch(fixture, /\bfetch\(|\bwriteFile(?:Sync)?\b/);
});
