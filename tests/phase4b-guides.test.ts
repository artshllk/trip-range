// Historical record/access regression. Live archive exclusion is tested in destination-archive.test.ts.
import assert from "node:assert/strict";
import { readFileSync, readdirSync, existsSync } from "node:fs";
import { test } from "node:test";
import {
  contentItems,
  editorialContent,
  contentDigest,
  digest,
  publicationReceiptMatches,
} from "../src/content/integrity";
import { loadEditorialWorkspace } from "./fixtures/archived-destination-data";
import { loadContentOperations } from "./fixtures/archived-destination-data";
import type { DestinationContent } from "../src/domain/destination-content/types";
import type { PlaceIdentity } from "../src/domain/places/types";
import { validateDestinationContentData } from "../src/domain/destination-content/validation";
import { createPinnedDestinationContentStore } from "../src/content/runtime/publication";
import {
  assessEditorialReview,
  reviewPins,
} from "../scripts/lib/editorial-review";
import { draftContentPreview } from "./fixtures/destination-content-draft-preview";

const directory = "docs/research/destination-content/phase4b-guides";
const cities = ["vienna", "london", "paris", "place-Q60"];
const now = Date.parse("2026-10-26T16:00:00Z");
const read = <T>(path: string): T =>
  JSON.parse(
    readFileSync(
      existsSync(path)
        ? path
        : path.replace("content/", "content/archive/cost-scope-2026-11-02/"),
      "utf8",
    ),
  );
const candidate = (id: string) =>
  read<DestinationContent>(`${directory}/${id}.json`);
const original = (id: string) =>
  read<DestinationContent>(`${directory}/prior-published/${id}.json`);
const identity = (id: string) =>
  read<PlaceIdentity>(`content/places/${id}.json`);
const context = (id: string) => ({
  identities: [identity(id)],
  mediaSubjects: [identity(id).subject],
});
const notes = (record: DestinationContent) =>
  record.practicalNotes!.filter((note) => note.id.startsWith("note:phase4b:"));

test("Phase 4B revisions remain fully draft and cannot inherit published receipts", async () => {
  for (const id of cities) {
    const record = candidate(id);
    const data = { schemaVersion: 1, records: [record] };
    assert.equal(validateDestinationContentData(data, context(id)).ok, true);
    assert.equal(record.contentVersion, original(id).contentVersion + 1);
    assert.equal(record.publication, undefined);
    for (const item of [
      record,
      ...contentItems(record).map(({ item }) => item),
    ]) {
      assert.equal(item.reviewStatus, "draft");
      assert.equal(item.reviewedAt, null);
    }
    assert.deepEqual(
      await createPinnedDestinationContentStore(
        data,
        context(id),
        () => now,
      ).get(record.destinationId),
      { status: "none", reason: "not-reviewed" },
    );
    const assessment = assessEditorialReview({
      record,
      identity: identity(id),
      evidence: "available",
      evidenceText: readFileSync(
        "docs/research/phase4b-cost-evidence-2026-10-22/cost-assumptions-review.md",
        "utf8",
      ),
      findings: [],
      now,
    });
    assert.deepEqual(assessment.blocking, []);
    assert.equal(assessment.eligible, false);
    assert.equal(assessment.decision, "pending");
    assert.ok(
      Object.values(assessment.checks).every((check) => check === "pending"),
    );
  }
});

test("only the two exact reviewed English paragraphs and their official sources are added", () => {
  const review = readFileSync(
    "docs/research/phase4b-cost-evidence-2026-10-22/cost-assumptions-review.md",
    "utf8",
  );
  for (const [id, heading] of cities.map((id, index) => [
    id,
    ["Vienna", "London", "Paris", "New York"][index],
  ])) {
    const before = original(id),
      after = candidate(id);
    const expected = review
      .split(`### ${heading}\n\n`)[1]
      .split("\n\nLinks beside")[0]
      .slice(1, -1)
      .split("\n\n");
    assert.deepEqual(
      ["transport", "other"].map((kind) => ({
        en: notes(after)
          .filter((note) => note.kind === kind)
          .map((note) => note.text.en)
          .join(" "),
      })),
      expected.map((en) => ({ en })),
    );
    assert.ok(
      after.practicalNotes!.length <= 5,
      "All notes remain initially visible",
    );
    assert.ok(
      notes(after).every(
        (note) =>
          Object.keys(note.text).join() === "en" && note.text.en.length <= 240,
      ),
      "Exact reviewed sentences stay visible without a new disclosure",
    );
    assert.ok(
      notes(after).every((note) => note.observedPrice === undefined),
      "Mixed ticket choices, caps and calculated menu examples are prose, never a single price observation or runtime allowance",
    );
    const restored = structuredClone(after);
    restored.contentVersion = before.contentVersion;
    restored.practicalNotes = restored.practicalNotes!.filter(
      (note) => !note.id.startsWith("note:phase4b:"),
    );
    restored.sources = restored.sources.filter(
      (source) => !source.id.startsWith("source:phase4b:"),
    );
    assert.deepEqual(
      editorialContent(restored),
      editorialContent(before),
      "Existing identity, airport guidance, attractions, itineraries and order remain exact",
    );
    for (const note of notes(after)) {
      assert.equal(note.freshness.kind, "volatile");
      for (const sourceId of note.sourceIds.filter((source) =>
        source.startsWith("source:phase4b:"),
      )) {
        const source = after.sources.find((source) => source.id === sourceId)!;
        assert.equal(source.type, "official");
        assert.match(source.url!, /^https:\/\//);
        assert.equal(source.observedAt, "2026-10-22T19:33:31Z");
      }
    }
  }
});

test("draft preview retains all notes now and independently expires menus and transport", async () => {
  for (const id of cities) {
    const record = candidate(id),
      snapshot = structuredClone(record);
    for (const [at, expected] of [
      [now, notes(record).length],
      [
        Date.parse("2026-11-05T00:00:00Z"),
        notes(record).filter((note) => note.kind === "transport").length,
      ],
      [Date.parse("2026-11-21T00:00:00Z"), 0],
    ]) {
      const result = await draftContentPreview(
        { schemaVersion: 1, records: [record] },
        context(id),
        record.destinationId,
        at,
      );
      assert.equal(result.status, "reviewed");
      if (result.status === "reviewed")
        assert.equal(notes(result.content).length, expected);
    }
    assert.deepEqual(record, snapshot);
  }
});

test("missing official evidence and malformed freshness remain rejected", () => {
  for (const id of cities) {
    const record = candidate(id);
    const note = notes(record)[0];
    note.sourceIds = ["source:missing"];
    assert.equal(
      validateDestinationContentData(
        { schemaVersion: 1, records: [record] },
        context(id),
      ).ok,
      false,
    );
    const expired = candidate(id);
    notes(expired)[0].freshness = {
      kind: "volatile",
      observedAt: "2026-10-22T19:33:31Z",
      validUntil: "2026-10-21T00:00:00Z",
    };
    assert.equal(
      validateDestinationContentData(
        { schemaVersion: 1, records: [expired] },
        context(id),
      ).ok,
      false,
    );
  }
});

test("drafts and previews do not enter production imports or cost profiles", () => {
  for (const root of ["src", "content"]) {
    for (const path of readdirSync(root, { recursive: true })) {
      if (typeof path !== "string" || !/\.(?:tsx?|json)$/.test(path)) continue;
      assert.doesNotMatch(
        readFileSync(`${root}/${path}`, "utf8"),
        /phase4b-guides/,
      );
    }
  }
});

test("unsigned owner proposals pin the exact new revisions and research without recording approval", () => {
  const proposal = read<{
    evidencePath: string;
    candidates: Array<{
      candidateFile: string;
      destinationId: string;
      research: Parameters<typeof reviewPins>[0]["research"];
      reviewer: null;
      reviewedAt: null;
      decision: string;
      publicationEligible: boolean;
      checks: Record<string, string>;
      contentVersion: number;
      contentDigest: string;
      identityDigest: string;
      evidenceDigest: string;
    }>;
  }>(`${directory}/approval-proposal.json`);
  assert.equal(proposal.candidates.length, 4);
  for (const entry of proposal.candidates) {
    const record = read<DestinationContent>(entry.candidateFile);
    const file =
      record.destinationId === "place:Q60" ? "place-Q60" : record.destinationId;
    const pins = reviewPins({
      record,
      identity: identity(file),
      research: entry.research,
      evidence: "available",
      evidenceText: readFileSync(proposal.evidencePath, "utf8"),
      findings: [],
      now,
    });
    for (const key of [
      "contentVersion",
      "contentDigest",
      "identityDigest",
      "evidenceDigest",
    ] as const)
      assert.equal(entry[key], pins[key]);
    assert.equal(entry.reviewer, null);
    assert.equal(entry.reviewedAt, null);
    assert.equal(entry.decision, "pending");
    assert.equal(entry.publicationEligible, false);
    assert.ok(
      Object.values(entry.checks).every((value) => value === "pending"),
    );
  }
});

test("owner-approved runtime revisions match the pinned candidates and retain previous review history", async () => {
  const proposal = read<{
    candidates: Array<{
      destinationId: string;
      priorApprovedReviewDigest: string;
    }>;
  }>(`${directory}/approval-proposal.json`);
  const workspace = loadEditorialWorkspace(
    process.cwd(),
    loadContentOperations(),
    now,
  );
  for (const file of cities) {
    const draft = candidate(file);
    const input = workspace.inputs.get(draft.destinationId)!;
    const record = input.record;
    assert.deepEqual(editorialContent(record), editorialContent(draft));
    assert.equal(publicationReceiptMatches(record, input.identity), true);
    for (const item of [
      record,
      ...contentItems(record).map(({ item }) => item),
    ]) {
      assert.equal(item.reviewStatus, "reviewed");
      assert.equal(item.reviewedAt, record.publication!.approvedAt);
    }
    const review = workspace.reviews.get(record.destinationId)!;
    assert.equal(review.current.reviewer, "GoEksplo Owner");
    assert.equal(review.current.decision, "approved");
    assert.deepEqual(review.current.checks, {
      identity: "approved",
      sources: "approved",
      englishCopy: "approved",
      selectionAndOrder: "approved",
      freshness: "approved",
    });
    const assessment = assessEditorialReview(input, review);
    assert.deepEqual(assessment.blocking, []);
    assert.deepEqual(assessment.unacknowledged, []);
    assert.equal(assessment.eligible, true);
    const priorDigest = proposal.candidates.find(
      (entry) => entry.destinationId === record.destinationId,
    )!.priorApprovedReviewDigest;
    assert.ok(
      review.history.some(
        (snapshot, index) =>
          digest({
            schemaVersion: 1,
            destinationId: record.destinationId,
            current: snapshot.review,
            history: review.history.slice(0, index),
          }) === priorDigest,
      ),
      "The exact previous review and its history remain reconstructable",
    );
    const result = await createPinnedDestinationContentStore(
      { schemaVersion: 1, records: [record] },
      context(file),
      () => now,
    ).get(record.destinationId);
    assert.equal(result.status, "reviewed");
    if (result.status === "reviewed")
      assert.equal(notes(result.content).length, notes(draft).length);
  }
});

test("published notes expire in the actual pinned store without extending the approved evidence dates", async () => {
  for (const file of cities) {
    const record = read<DestinationContent>(
      `content/destinations/${file}.json`,
    );
    const storeAt = (at: number) =>
      createPinnedDestinationContentStore(
        { schemaVersion: 1, records: [record] },
        context(file),
        () => at,
      ).get(record.destinationId);
    // Current deadlines may change at every approved review. Check each note's
    // actual boundary, rather than assuming the original November menu cutoff.
    for (const note of notes(record)) {
      assert.equal(note.freshness.kind, "volatile");
      if (note.freshness.kind !== "volatile")
        throw Error("Expected volatile note");
      const deadline = Date.parse(note.freshness.validUntil);
      for (const [at, visible] of [
        [deadline - 1, true],
        [deadline, false],
      ] as const) {
        const result = await storeAt(at);
        assert.equal(result.status, "reviewed");
        if (result.status === "reviewed")
          assert.equal(
            notes(result.content).some((n) => n.id === note.id),
            visible,
            note.id,
          );
      }
    }
    const altered = structuredClone(record);
    notes(altered)[0].text.en += " Unapproved edit.";
    assert.deepEqual(
      await createPinnedDestinationContentStore(
        { schemaVersion: 1, records: [altered] },
        context(file),
        () => now,
      ).get(record.destinationId),
      { status: "none", reason: "not-reviewed" },
    );
  }
});

test("workflow evidence registers the exact accepted research bytes and complete guide source counts", () => {
  const accepted = readFileSync(
    "docs/research/phase4b-cost-evidence-2026-10-22/cost-assumptions-review.md",
    "utf8",
  );
  assert.equal(
    readFileSync(
      "docs/research/destination-content/phase4b-guide-cost-assumptions.md",
      "utf8",
    ),
    accepted,
  );
  const workspace = loadEditorialWorkspace(
    process.cwd(),
    loadContentOperations(),
    now,
  );
  for (const file of cities) {
    const record = candidate(file);
    const input = workspace.inputs.get(record.destinationId)!;
    assert.equal(input.evidence, "available");
    assert.equal(input.evidenceText, accepted);
    assert.equal(input.research!.report, "phase4b-guide-cost-assumptions.md");
    assert.equal(input.research!.sourceCount, record.sources.length);
    const review = workspace.reviews.get(record.destinationId)!;
    assert.equal(review.current.contentDigest, contentDigest(record));
    assert.equal(
      review.current.evidenceDigest,
      reviewPins(input).evidenceDigest,
    );
  }
});
