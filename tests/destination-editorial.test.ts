// Historical record/access regression. Live archive exclusion is tested in destination-archive.test.ts.
import { publishedDestinationIds } from "./fixtures/published-destinations";
import assert from "node:assert/strict";
import { test } from "node:test";
import {
  mkdtempSync,
  mkdirSync,
  readFileSync,
  writeFileSync,
  rmSync,
  readdirSync,
  statSync,
  chmodSync,
  symlinkSync,
  unlinkSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  canonicalJson,
  contentDigest,
  contentItems,
  digest,
  editorialContent,
} from "../src/content/integrity";
import {
  editorialChecks,
  isEditorialReview,
} from "../src/content/operator/editorial";
import {
  assessEditorialReview,
  newReview,
  type ReviewInputs,
} from "../scripts/lib/editorial-review";
import {
  loadEditorialWorkspace,
  type EditorialWorkspace,
} from "./fixtures/archived-destination-data";
import {
  approveDestinationContent,
  editorialArguments,
  setDestinationReview,
} from "../scripts/lib/editorial-commands";
import {
  editorialMaintenance,
  editorialOverview,
} from "../scripts/lib/editorial-maintenance";
import { checkDestinationReviews } from "../scripts/check-destination-reviews";
import { loadContentOperations } from "./fixtures/archived-destination-data";
import { createPinnedDestinationContentStore } from "../src/content/runtime/publication";
import { validateDestinationContentData } from "../src/domain/destination-content/validation";
import {
  buildDestinationContentReview,
  renderDestinationContentReviewHtml,
  renderDestinationContentReviewText,
} from "../scripts/lib/destination-content-review";
import {
  contentFixtureContext,
  contentTestIdentity,
  contentTestNow,
  destinationContentFixture,
} from "./fixtures/destination-content";

function draftInput(): ReviewInputs {
  const record = destinationContentFixture().records[0];
  for (const item of [
    record,
    ...contentItems(record).map(({ item }) => item),
  ]) {
    item.reviewStatus = "draft";
    item.reviewedAt = null;
  }
  return {
    record,
    identity: structuredClone(contentTestIdentity),
    research: {
      destinationId: record.destinationId,
      status: "available",
      report: "synthetic.md",
      researchedAt: "2026-10-10T00:00:00Z",
      sourceCount: 2,
      unresolvedIssues: [],
    },
    evidence: "available",
    evidenceText: "Synthetic source relationship evidence.",
    findings: [],
    now: contentTestNow,
  };
}
function approvedReview(input: ReviewInputs) {
  const review = newReview(input, "test-editor");
  for (const check of editorialChecks)
    review.current.checks[check] = "approved";
  review.current.decision = "approved";
  review.current.reviewedAt = new Date(input.now).toISOString();
  review.current.warningsAcknowledged = assessEditorialReview(
    input,
  ).advisory.map((w) => ({
    id: w.id,
    reason: "Synthetic advisory inspected by test fixture",
  }));
  return review;
}
function fixture(t: { after(fn: () => void): void }, input = draftInput()) {
  const root = mkdtempSync(join(tmpdir(), "goeksplo-editorial-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const put = (path: string, value: unknown) => {
    const target = join(root, path);
    mkdirSync(join(target, ".."), { recursive: true });
    writeFileSync(
      target,
      typeof value === "string" ? value : JSON.stringify(value, null, 2) + "\n",
    );
  };
  put("content/destinations/synthetic.json", input.record);
  put("content/destinations/records.ts", "// synthetic manifest\n");
  put("content/places/synthetic.json", input.identity);
  put("content/research/destinations/synthetic.json", input.research);
  put("content/operations/queue/synthetic.json", {
    destinationId: input.record.destinationId,
  });
  put("docs/research/destination-content/synthetic.md", input.evidenceText);
  put("content/operations/editorial-findings.json", {
    schemaVersion: 1,
    records: [
      { destinationId: input.record.destinationId, findings: input.findings },
    ],
  });
  put("content/operations/reviews/README.md", "No approval implied.");
  put("content/media/approved.json", "unchanged-media");
  put("src/seo/approved-keys.ts", "unchanged-seo");
  const operations = loadContentOperations();
  const load = (now = input.now) => {
    const record = JSON.parse(
      readFileSync(join(root, "content/destinations/synthetic.json"), "utf8"),
    );
    return loadEditorialWorkspace(
      root,
      {
        ...operations,
        context: { identities: [input.identity], mediaSubjects: [] },
        data: { schemaVersion: 1, records: [record] },
        research: [input.research!],
        evidence: new Map([[record.destinationId, input.evidence]]),
      },
      now,
    );
  };
  const set = (...action: string[]) =>
    setDestinationReview(
      [
        "--destination",
        input.record.destinationId,
        "--reviewer",
        "test-editor",
        "--digest",
        contentDigest(load().inputs.get(input.record.destinationId)!.record),
        ...action,
      ],
      load(),
    );
  const ready = () => {
    for (const check of editorialChecks)
      set("--check", check, "--status", "approved");
    for (const warning of assessEditorialReview(input).advisory)
      set(
        "--ack",
        warning.id,
        "--reason",
        "Synthetic explicit review acknowledgement",
      );
    set("--decision", "approved");
  };
  return {
    root,
    put,
    load,
    set,
    ready,
    id: input.record.destinationId,
    input,
    contentPath: join(root, "content/destinations/synthetic.json"),
    reviewPath: join(root, "content/operations/reviews/synthetic.json"),
  };
}

test("canonical digest ignores JSON formatting/key order but includes all factual data and array order", () => {
  const input = draftInput(),
    record = input.record;
  const reordered = JSON.parse(JSON.stringify(record, null, 7));
  assert.equal(contentDigest(record), contentDigest(reordered));
  assert.equal(
    digest({ z: 2, a: { y: true, b: [1, 2] } }),
    digest({ a: { b: [1, 2], y: true }, z: 2 }),
  );
  for (const change of [
    (r: typeof record) => {
      r.overview!.text.en += " changed";
    },
    (r: typeof record) => {
      r.overview!.text.sq += " changed";
    },
    (r: typeof record) => {
      r.sources[0].title += " changed";
    },
    (r: typeof record) => {
      r.sources.reverse();
    },
    (r: typeof record) => {
      r.transport![0].freshness = { kind: "stable" };
    },
    (r: typeof record) => {
      r.contentVersion++;
    },
    (r: typeof record) => {
      r.overview!.text.reviewStatus = "a locale value is editorial data";
    },
  ]) {
    const copy = structuredClone(record);
    change(copy);
    assert.notEqual(contentDigest(copy), contentDigest(record));
  }
  const copy = structuredClone(record);
  for (const item of [copy, ...contentItems(copy).map(({ item }) => item)]) {
    item.reviewStatus = "reviewed";
    item.reviewedAt = new Date(input.now).toISOString();
  }
  assert.equal(contentDigest(copy), contentDigest(record));
  for (const value of [undefined, NaN, Infinity, new Date(), { a: undefined }])
    assert.throws(() => canonicalJson(value));
  const cyclic: { self?: unknown } = {};
  cyclic.self = cyclic;
  assert.throws(() => canonicalJson(cyclic));
});

test("review schema requires explicit checks, plain reviewer, bounded acknowledgements and valid past timestamps", () => {
  const input = draftInput(),
    pending = newReview(input, "test-editor");
  assert.equal(isEditorialReview(pending, input.now), true);
  assert.equal(assessEditorialReview(input).decision, "pending");
  assert.equal(
    assessEditorialReview(input, approvedReview(input)).eligible,
    true,
  );
  const bad = [
    { ...pending, extra: true },
    {
      ...pending,
      current: {
        ...pending.current,
        decision: "approved",
        reviewedAt: pending.current.updatedAt,
      },
    },
    { ...pending, current: { ...pending.current, reviewer: "" } },
    {
      ...pending,
      current: { ...pending.current, reviewer: "person@example.com" },
    },
    { ...pending, current: { ...pending.current, reviewer: "<script>" } },
    {
      ...pending,
      current: {
        ...pending.current,
        checks: { ...pending.current.checks, automatic: "approved" },
      },
    },
    {
      ...pending,
      current: { ...pending.current, updatedAt: "2099-01-01T00:00:00Z" },
    },
    {
      ...pending,
      current: { ...pending.current, updatedAt: "2026-02-30T00:00:00Z" },
    },
    { ...pending, current: { ...pending.current, contentDigest: "bad" } },
    {
      ...pending,
      current: {
        ...pending.current,
        warningsAcknowledged: [{ id: "a", reason: "" }],
      },
    },
    {
      ...approvedReview(input),
      current: { ...approvedReview(input).current, reviewedAt: null },
    },
  ];
  for (const value of bad)
    assert.equal(isEditorialReview(value, input.now), false);
});

test("changed copy/source/version/identity/evidence invalidates the exact old review", () => {
  const input = draftInput(),
    review = approvedReview(input);
  for (const change of [
    (i: ReviewInputs) => {
      i.record.overview!.text.en += " changed";
    },
    (i: ReviewInputs) => {
      i.record.sources[0].publisher += " changed";
    },
    (i: ReviewInputs) => {
      i.record.contentVersion++;
    },
    (i: ReviewInputs) => {
      i.identity.coordinates!.latitude++;
    },
    (i: ReviewInputs) => {
      i.evidenceText += " New concern.";
    },
  ]) {
    const next = structuredClone(input);
    change(next);
    const state = assessEditorialReview(next, review);
    assert.equal(state.stale, true);
    assert.equal(state.eligible, false);
    assert.equal(state.decision, "stale");
  }
});

test("known advisories require reasons; blocking issues cannot be acknowledged away", () => {
  const input = draftInput();
  input.findings = [
    {
      id: "source-recheck",
      message: "Human must verify the cited source-to-claim correspondence.",
    },
  ];
  const review = approvedReview(input);
  review.current.warningsAcknowledged = [];
  assert.equal(assessEditorialReview(input, review).eligible, false);
  review.current.warningsAcknowledged = [
    {
      id: "source-recheck",
      reason: "Synthetic source inspected; copy correspondence checked",
    },
  ];
  assert.equal(assessEditorialReview(input, review).eligible, true);
  input.record.transport![0].freshness = {
    kind: "periodically-reviewed",
    reviewBy: "2026-10-01T00:00:00Z",
  };
  const stale = approvedReview(input);
  assert.equal(assessEditorialReview(input, stale).eligible, false);
  stale.current.warningsAcknowledged.push({
    id: "overdue:transport:synthetic:one",
    reason: "Ignore expiry",
  });
  assert.ok(
    assessEditorialReview(input, stale).blocking.includes(
      "unknown-advisory-acknowledgement",
    ),
  );
});

test("metadata mutation updates only one review file, requires English without a fabricated Albanian review and retains history", (t) => {
  const f = fixture(t),
    original = readFileSync(f.contentPath, "utf8");
  assert.throws(() => f.set("--decision", "approved"));
  assert.equal(
    readdirSync(join(f.root, "content/operations/reviews")).length,
    1,
  );
  f.set("--check", "englishCopy", "--status", "approved");
  let review = f.load().reviews.get(f.id)!;
  assert.equal(review.current.checks.englishCopy, "approved");
  assert.equal(review.current.checks.albanianCopy, undefined);
  f.set("--check", "sources", "--status", "changes-required");
  review = f.load().reviews.get(f.id)!;
  assert.equal(review.current.decision, "changes-required");
  assert.equal(review.history.length, 1);
  f.ready();
  review = f.load().reviews.get(f.id)!;
  assert.equal(review.current.decision, "approved");
  assert.ok(review.history.length >= 6);
  assert.equal(readFileSync(f.contentPath, "utf8"), original);
  assert.equal(
    readFileSync(join(f.root, "content/media/approved.json"), "utf8"),
    "unchanged-media",
  );
  assert.equal(
    readFileSync(join(f.root, "src/seo/approved-keys.ts"), "utf8"),
    "unchanged-seo",
  );
});

test("approval defaults to zero writes, rejects absent/wrong confirmations, and atomically changes only publication metadata", async (t) => {
  const f = fixture(t);
  f.ready();
  chmodSync(f.contentPath, 0o640);
  const original = readFileSync(f.contentPath, "utf8"),
    reviewFile = readFileSync(f.reviewPath, "utf8");
  const dry = await approveDestinationContent(
    ["--destination", f.id],
    f.load(),
  );
  assert.equal(dry.dryRun, true);
  assert.equal(dry.writes, 0);
  assert.equal(readFileSync(f.contentPath, "utf8"), original);
  for (const args of [
    ["--apply"],
    ["--apply", "--confirm-reviewed=other"],
    ["--yes"],
    ["--confirm-reviewed=" + f.id],
  ])
    await assert.rejects(
      approveDestinationContent(["--destination", f.id, ...args], f.load()),
    );
  assert.equal(readFileSync(f.contentPath, "utf8"), original);
  const applied = await approveDestinationContent(
    ["--destination", f.id, "--apply", "--confirm-reviewed=" + f.id],
    f.load(),
  );
  assert.equal(applied.writes, 1);
  assert.equal(statSync(f.contentPath).mode & 0o777, 0o640);
  const current = f.load().inputs.get(f.id)!.record;
  assert.deepEqual(
    editorialContent(current),
    editorialContent(JSON.parse(original)),
  );
  assert.equal(current.contentVersion, 1);
  for (const item of [
    current,
    ...contentItems(current).map(({ item }) => item),
  ]) {
    assert.equal(item.reviewStatus, "reviewed");
    assert.equal(item.reviewedAt, applied.approvalTimestamp);
  }
  assert.equal(
    validateDestinationContentData(
      { schemaVersion: 1, records: [current] },
      contentFixtureContext(),
    ).ok,
    true,
  );
  const runtime = await createPinnedDestinationContentStore(
    { schemaVersion: 1, records: [current] },
    contentFixtureContext(),
    () => contentTestNow,
  ).get(f.id);
  assert.equal(runtime.status, "reviewed");
  if (runtime.status === "reviewed")
    assert.equal(runtime.content.publication, undefined);
  assert.equal(readFileSync(f.reviewPath, "utf8"), reviewFile);
  assert.equal(
    readFileSync(join(f.root, "content/media/approved.json"), "utf8"),
    "unchanged-media",
  );
  assert.equal(
    readFileSync(join(f.root, "src/seo/approved-keys.ts"), "utf8"),
    "unchanged-seo",
  );
  assert.equal((await checkDestinationReviews(f.load())).status, "passed");
});

test("approval rejects missing review, missing evidence, invalid languages/references and immediately expired sections", async (t) => {
  const empty = fixture(t);
  await assert.rejects(
    approveDestinationContent(["--destination", empty.id], empty.load()),
  );
  for (const change of [
    (i: ReviewInputs) => {
      i.evidence = "missing";
    },
    (i: ReviewInputs) => {
      delete i.record.overview!.text.en;
    },
    (i: ReviewInputs) => {
      i.record.dayTemplates![0].stops[0].attractionId = "not-present";
    },
    (i: ReviewInputs) => {
      i.record.practicalNotes![0].freshness = {
        kind: "volatile",
        observedAt: "2026-10-01T00:00:00Z",
        validUntil: "2026-10-02T00:00:00Z",
      };
    },
  ]) {
    const input = draftInput();
    change(input);
    const f = fixture(t, input);
    f.put("content/operations/reviews/synthetic.json", approvedReview(input));
    const before = readFileSync(f.contentPath, "utf8");
    await assert.rejects(
      approveDestinationContent(
        ["--destination", f.id, "--apply", "--confirm-reviewed=" + f.id],
        f.load(),
      ),
    );
    assert.equal(readFileSync(f.contentPath, "utf8"), before);
  }
});

test("runtime receipt fails closed after copy or identity edits; withdrawal hides but preserves content", async (t) => {
  const f = fixture(t);
  f.ready();
  await approveDestinationContent(
    ["--destination", f.id, "--apply", "--confirm-reviewed=" + f.id],
    f.load(),
  );
  const record = f.load().inputs.get(f.id)!.record;
  const changed = structuredClone(record);
  changed.overview!.text.en += " unreviewed";
  assert.equal(
    (
      await createPinnedDestinationContentStore(
        { schemaVersion: 1, records: [changed] },
        contentFixtureContext(),
        () => contentTestNow,
      ).get(f.id)
    ).status,
    "none",
  );
  const context = contentFixtureContext();
  context.identities[0].name += " changed";
  assert.equal(
    (
      await createPinnedDestinationContentStore(
        { schemaVersion: 1, records: [record] },
        context,
        () => contentTestNow,
      ).get(f.id)
    ).status,
    "none",
  );
  delete changed.publication;
  assert.equal(
    (
      await createPinnedDestinationContentStore(
        { schemaVersion: 1, records: [changed] },
        contentFixtureContext(),
        () => contentTestNow,
      ).get(f.id)
    ).status,
    "none",
  );
  const withdrawn = structuredClone(record);
  for (const item of [
    withdrawn,
    ...contentItems(withdrawn).map(({ item }) => item),
  ])
    item.reviewStatus = "withdrawn";
  assert.deepEqual(editorialContent(withdrawn), editorialContent(record));
  assert.equal(
    (
      await createPinnedDestinationContentStore(
        { schemaVersion: 1, records: [withdrawn] },
        contentFixtureContext(),
        () => contentTestNow,
      ).get(f.id)
    ).status,
    "none",
  );
});

test("stale review reset preserves previous digest and decision, and clears every check", async (t) => {
  const f = fixture(t);
  f.ready();
  const previous = f.load().reviews.get(f.id)!;
  const record = f.load().inputs.get(f.id)!.record;
  record.overview!.text.en += " new revision";
  record.contentVersion++;
  f.put("content/destinations/synthetic.json", record);
  assert.equal((await checkDestinationReviews(f.load())).status, "failed");
  assert.throws(
    () => f.set("--check", "englishCopy", "--status", "approved"),
    /stale/,
  );
  f.set(
    "--reset",
    "--reason",
    "Copy changed in editorial revision 2; repeat all review areas",
  );
  const reset = f.load().reviews.get(f.id)!;
  assert.equal(reset.current.decision, "pending");
  assert.ok(Object.values(reset.current.checks).every((v) => v === "pending"));
  assert.equal(
    reset.history[reset.history.length - 1].review.contentDigest,
    previous.current.contentDigest,
  );
  assert.equal(
    reset.history[reset.history.length - 1].review.decision,
    "approved",
  );
  assert.equal(reset.current.contentVersion, 2);
});

test("mutation refuses traversal, unknown IDs, linked paths, file races and duplicate/orphan reviews", (t) => {
  const f = fixture(t);
  for (const args of [
    ["--destination", "../a"],
    ["--destination", "unknown"],
    ["--destination", f.id, "--approve-everything"],
    ["--destination", f.id, "--destination", f.id],
  ])
    assert.throws(() => setDestinationReview(args, f.load()));
  assert.throws(() =>
    editorialArguments(["--reviewer", "x\ny"], ["--reviewer"]),
  );
  const workspace = f.load();
  f.put(
    "docs/research/destination-content/synthetic.md",
    "Changed source report",
  );
  assert.throws(
    () =>
      setDestinationReview(
        [
          "--destination",
          f.id,
          "--reviewer",
          "test",
          "--digest",
          contentDigest(f.input.record),
          "--check",
          "identity",
          "--status",
          "approved",
        ],
        workspace,
      ),
    /concurrent/,
  );
  f.put(
    "content/operations/reviews/synthetic.json",
    newReview(f.input, "test"),
  );
  f.put(
    "content/operations/reviews/duplicate.json",
    newReview(f.input, "test"),
  );
  assert.throws(() => f.load());
  rmSync(join(f.root, "content/operations/reviews/duplicate.json"));
  const orphan = newReview(f.input, "test");
  orphan.destinationId = "unknown";
  f.put("content/operations/reviews/synthetic.json", orphan);
  assert.throws(() => f.load());
  rmSync(f.reviewPath);
  symlinkSync(f.contentPath, f.reviewPath);
  assert.throws(() => f.load());
  unlinkSync(f.reviewPath);
});

test("maintenance reports due dates, expired sections, stale reviews, withdrawal and empty reviewed sets offline", async (t) => {
  const f = fixture(t);
  assert.equal(editorialMaintenance(f.load()).summary.reviewedDestinations, 0);
  f.ready();
  await approveDestinationContent(
    ["--destination", f.id, "--apply", "--confirm-reviewed=" + f.id],
    f.load(),
  );
  const report = editorialMaintenance(f.load(), 30);
  assert.equal(report.summary.reviewedDestinations, 1);
  assert.equal(report.summary.reReviewDueSoon, 1);
  assert.equal(report.rows.length, 2);
  assert.ok(report.rows.some((r) => r.kind === "volatile"));
  assert.ok(report.rows.some((r) => r.kind === "periodically-reviewed"));
  assert.equal(editorialMaintenance(f.load(), 1).rows.length, 0);
  const expired = f.load(Date.parse("2026-11-01T00:00:00Z"));
  assert.equal(editorialMaintenance(expired).summary.expiredSections, 2);
  assert.equal(
    (await checkDestinationReviews(expired)).status,
    "passed",
    "Natural expiry remains a maintenance condition",
  );
  const row = expired.inputs.get(f.id)!;
  row.record.overview!.text.en += " changed";
  assert.equal(editorialMaintenance(expired).summary.staleEditorialReviews, 1);
  row.record.reviewStatus = "withdrawn";
  assert.equal(editorialMaintenance(expired).summary.withdrawnDestinations, 1);
  assert.equal(editorialMaintenance(expired).rows.length, 0);
  assert.throws(() => editorialMaintenance(expired, 366));
});

test("all thirty destinations have valid approvals at the recorded review clock, including Kruger", (t) => {
  t.mock.method(globalThis, "fetch", async () => {
    throw Error("No network in review tooling");
  });
  const workspace = loadEditorialWorkspace(
    undefined,
    undefined,
    Date.parse("2026-10-26T16:00:00Z"),
  );
  const rows = editorialOverview(workspace);
  assert.equal(rows.length, 30);
  assert.deepEqual([...workspace.reviews.keys()], publishedDestinationIds);
  for (const id of publishedDestinationIds) {
    const approved = rows.find((r) => r.destinationId === id)!;
    assert.equal(approved.decision, "approved");
    assert.equal(approved.eligible, true);
    assert.equal(approved.publicationPinned, true);
    assert.equal(approved.stale, false);
    assert.deepEqual(approved.blocking, []);
    assert.deepEqual(approved.unacknowledged, []);
  }
  assert.ok(
    rows
      .filter((r) => !publishedDestinationIds.includes(r.destinationId))
      .every(
        (r) =>
          r.decision === "pending" &&
          !r.eligible &&
          r.publicationStatus === "draft",
      ),
  );
  assert.match(
    rows
      .find((r) => r.destinationId === "city:BCN")!
      .advisory.map((r) => r.message)
      .join(" "),
    /Picasso/,
  );
  // Phase 5H acknowledges this advisory without removing its review context.
  assert.deepEqual(
    rows.find((r) => r.destinationId === "crete")!.advisory.map((r) => r.id),
    ["evidence-review"],
  );
  assert.match(
    rows
      .find((r) => r.destinationId === "prishtina")!
      .advisory.map((r) => r.message)
      .join(" "),
    /smaller coverage/,
  );
  assert.match(
    rows
      .find((r) => r.destinationId === "place:Q24451")!
      .advisory.map((r) => r.message)
      .join(" "),
    /Letaba|access|review/,
  );
  assert.equal(
    editorialMaintenance(workspace).summary.reviewedDestinations,
    30,
  );
});

test("review report places explicit checklist/digest before details and static HTML has no scripts or images", () => {
  const input = draftInput(),
    report = buildDestinationContentReview(
      { schemaVersion: 1, records: [input.record] },
      contentFixtureContext(),
      input.record.destinationId,
      input.now,
    );
  report.editorial = assessEditorialReview(input);
  const text = renderDestinationContentReviewText(report),
    html = renderDestinationContentReviewHtml(report);
  for (const key of editorialChecks)
    assert.ok(text.indexOf(`${key}: pending`) < text.indexOf("\nIDENTITY"));
  assert.ok(text.includes(contentDigest(input.record)));
  assert.match(html, /DRAFT — NOT PUBLISHED/);
  assert.match(html, /Editorial review/);
  assert.equal((html.match(/<h1>/g) ?? []).length, 1);
  assert.doesNotMatch(html, /<script|<img|<iframe/);
});

test("indexed review overview handles 2500 lightweight synthetic records without per-row global scans", () => {
  const input = draftInput(),
    base = loadEditorialWorkspace();
  const workspace: EditorialWorkspace = {
    ...base,
    inputs: new Map(),
    reviews: new Map(),
  };
  for (let index = 0; index < 2500; index++) {
    const id = `synthetic:${index}`,
      record = structuredClone(input.record);
    record.destinationId = id;
    record.identitySubject = id;
    for (const { item } of contentItems(record))
      if ("destinationId" in item) item.destinationId = id;
    workspace.inputs.set(id, {
      ...input,
      record,
      identity: { ...input.identity, subject: id },
    });
  }
  const before = performance.now();
  const rows = editorialOverview(workspace);
  assert.equal(rows.length, 2500);
  assert.ok(rows.every((row) => row.blocking.length === 0));
  assert.ok(
    performance.now() - before < 8000,
    "Bounded single-pass indexing/report work",
  );
});

test("synthetic content approval cannot alter trip pricing/ranking, affiliate state, media or SEO publication", async (t) => {
  const { getTripTemplates } = await import("../src/services/travel");
  const { demoProviders } = await import("../src/providers/demo");
  const { defaultRequest } = await import("../src/domain/request");
  const { pricePlan } = await import("../src/domain/pricing");
  const { seoSitemap } = await import("../src/seo/publication");
  const search = await getTripTemplates(defaultRequest, demoProviders);
  const templates = structuredClone(search.templates);
  const pricing = search.templates.map((template) =>
    pricePlan(template, defaultRequest),
  );
  const sitemap = seoSitemap();
  const media = readFileSync("content/media/approved.json", "utf8");
  const realReviewsBefore = readFileSync(
    "content/operations/reviews/paris.json",
    "utf8",
  );
  const f = fixture(t);
  f.ready();
  await approveDestinationContent(
    ["--destination", f.id, "--apply", "--confirm-reviewed=" + f.id],
    f.load(),
  );
  assert.deepEqual(search.templates, templates);
  assert.deepEqual(
    search.templates.map((template) => pricePlan(template, defaultRequest)),
    pricing,
  );
  assert.deepEqual(seoSitemap(), sitemap);
  assert.equal(readFileSync("content/media/approved.json", "utf8"), media);
  assert.deepEqual(
    [...loadEditorialWorkspace().reviews.keys()],
    publishedDestinationIds,
  );
  assert.equal(
    readFileSync("content/operations/reviews/paris.json", "utf8"),
    realReviewsBefore,
  );
});
