// Historical record/access regression. Live archive exclusion is tested in destination-archive.test.ts.
import assert from "node:assert/strict";
import { test } from "node:test";
import oldRecord from "../docs/verification/sydney-transport-refresh/record-v4.json";
import type { DestinationContent } from "../src/domain/destination-content/types";
import { contentDigest, editorialContent } from "../src/content/integrity";
import { loadEditorialWorkspace } from "./fixtures/archived-destination-data";
import {
  assessEditorialReview,
  reviewContext,
} from "../scripts/lib/editorial-review";
import { createPinnedDestinationContentStore } from "../src/content/runtime/publication";

const checkedAt = Date.parse("2026-10-26T16:00:00Z");
const itemId = "transport:place:Q3130:expansion01-2";

test("Sydney refresh changes only WSI guidance and sources; original owner approval survives", () => {
  const w = loadEditorialWorkspace(undefined, undefined, checkedAt);
  const input = w.inputs.get("place:Q3130")!;
  const review = w.reviews.get(input.record.destinationId)!;
  assert.equal(input.record.contentVersion, 5);
  assert.equal(
    contentDigest(input.record),
    "6b92a80ff5a503738b27cccfb3c2e5676bbd0d75ccb674ff17b3465c22603e28",
  );
  assert.equal(
    contentDigest(oldRecord as DestinationContent),
    "2f4cfd353729d6ba08e76a192d626fce2ca2ac262e184f2c3349fa62631ec2ff",
  );
  assert.ok(
    review.history.some(
      ({ review: r }) =>
        r.contentDigest === contentDigest(oldRecord as DestinationContent) &&
        r.reviewer === "GoEksplo Owner" &&
        r.decision === "approved",
    ),
  );
  assert.equal(review.current.reviewer, "Codex - authorized transport refresh");
  assert.equal(assessEditorialReview(input, review).eligible, true);
  const current = editorialContent(input.record) as DestinationContent;
  const previous = editorialContent(
    oldRecord as DestinationContent,
  ) as DestinationContent;
  const wsi = current.transport!.find((t) => t.id === itemId)!;
  assert.match(wsi.guidance.en, /WSI is separate from SYD/);
  assert.match(
    wsi.guidance.en,
    /Official guidance lists WSI Link buses via St Marys/,
  );
  assert.match(wsi.guidance.en, /metro is under construction/);
  assert.match(
    wsi.guidance.en,
    /Check airport notices and the journey planner for your dates/,
  );
  assert.doesNotMatch(
    wsi.guidance.en,
    /\d|free|opened|operating|direct train|\$/i,
  );
  assert.equal(wsi.sourceIds.length, 3);
  assert.equal(
    current.sources[current.sources.length - 1].url,
    "https://www.wsiairport.com.au/how-get-wsi",
  );
  assert.equal(
    current.sources[current.sources.length - 1].retrievedAt,
    "2026-10-26T15:23:23Z",
  );
  // Restore only the explicitly allowed fact changes; everything else must
  // equal the immutable v4, including SYD and the historical source credits.
  current.contentVersion = previous.contentVersion;
  current.transport = current.transport!.map((t) =>
    t.id === itemId ? previous.transport!.find((p) => p.id === itemId)! : t,
  );
  current.sources.pop();
  for (const s of current.sources) {
    if (
      [
        "source:expansion01:sydney:wsi",
        "source:expansion01:sydney:opening",
      ].includes(s.id)
    ) {
      assert.equal(s.retrievedAt, "2026-10-26T15:23:23Z");
      Object.assign(
        s,
        previous.sources.find((p) => p.id === s.id),
      );
    }
  }
  assert.deepEqual(current, previous);
});

test("refreshed WSI expires exactly at the short recheck deadline without hiding SYD or treating transfers as free", async () => {
  const w = loadEditorialWorkspace(undefined, undefined, checkedAt);
  const input = w.inputs.get("place:Q3130")!;
  const review = w.reviews.get(input.record.destinationId)!;
  const wsi = input.record.transport!.find((t) => t.id === itemId)!;
  assert.deepEqual(wsi.freshness, {
    kind: "periodically-reviewed",
    reviewBy: "2026-11-02T00:00:00Z",
  });
  const deadline = Date.parse("2026-11-02T00:00:00Z");
  for (const now of [checkedAt, deadline - 1, deadline]) {
    const result = await createPinnedDestinationContentStore(
      { schemaVersion: 1, records: [input.record] },
      reviewContext(input.identity),
      () => now,
    ).get(input.record.destinationId);
    assert.equal(result.status, "reviewed");
    if (result.status !== "reviewed") throw Error("Reviewed city required");
    assert.equal(
      result.content.transport!.some((t) => t.id === itemId),
      now < deadline,
    );
    assert.ok(
      result.content.transport!.some(
        (t) => t.title.en === "Sydney Airport (SYD)",
      ),
    );
    const assessment = assessEditorialReview({ ...input, now }, review);
    assert.equal(assessment.eligible, now < deadline);
    assert.deepEqual(
      assessment.blocking,
      now < deadline ? [] : [`overdue:${itemId}`],
    );
  }
});
