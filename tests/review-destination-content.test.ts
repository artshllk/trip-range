import { test } from "node:test";
import assert from "node:assert/strict";
import {
  buildDestinationContentReview,
  contentFreshnessLabel,
  renderDestinationContentReviewHtml,
  renderDestinationContentReviewText,
} from "../scripts/lib/destination-content-review";
import { parseContentReviewArguments } from "../scripts/review-destination-content";
import { createReviewedDestinationContentStore } from "../src/content/runtime/store";
import {
  contentFixtureContext,
  contentTestIdentity,
  contentTestNow,
  destinationContentFixture,
} from "./fixtures/destination-content";

function draftFixture() {
  const data = destinationContentFixture();
  const record = data.records[0];
  const items = [
    record,
    record.overview!,
    ...record.highlights!,
    ...record.attractions!,
    ...record.areas!,
    ...record.dayTemplates!,
    ...record.transport!,
    ...record.practicalNotes!,
  ];
  for (const item of items) {
    item.reviewStatus = "draft";
    item.reviewedAt = null;
  }
  return data;
}
const review = () =>
  buildDestinationContentReview(
    draftFixture(),
    contentFixtureContext(),
    contentTestIdentity.subject,
    contentTestNow,
  );

test("offline review includes English sections, identity, sources, freshness and unresolved questions without promotion", async (t) => {
  let calls = 0;
  t.mock.method(globalThis, "fetch", async () => {
    calls++;
    throw Error("network forbidden");
  });
  const data = draftFixture();
  const before = structuredClone(data);
  const report = buildDestinationContentReview(
    data,
    contentFixtureContext(),
    contentTestIdentity.subject,
    contentTestNow,
  );
  const text = renderDestinationContentReviewText(report);
  for (const required of [
    "DRAFT — NOT PUBLISHED",
    "IDENTITY",
    "OVERVIEW",
    "HIGHLIGHTS",
    "ATTRACTIONS",
    "AREAS",
    "DAY TEMPLATES",
    "TRANSPORT",
    "PRACTICAL NOTES",
    "SOURCES",
    "WARNINGS",
    "UNRESOLVED HUMAN REVIEW QUESTIONS",
    "EN:",
    "source:synthetic:official",
    "Q900000001",
    "Stable",
    "Periodically reviewed",
    "Volatile",
    "valid until",
    "reference only; never a budget input",
  ])
    assert.ok(text.includes(required), required);
  assert.equal(report.counts.attractions, 1);
  assert.equal(report.counts.volatileItems, 1);
  assert.equal(report.counts.periodicItems, 1);
  const stopName = report.sections
    .find((section) => section.title === "Day templates")
    ?.items[0].fields.find((field) => field.label === "Stop 1 name")?.value;
  assert.ok(stopName && typeof stopName !== "string");
  assert.equal(stopName.en, "Test landmark");
  assert.deepEqual(data, before);
  assert.deepEqual(
    await createReviewedDestinationContentStore(
      data,
      contentFixtureContext(),
      () => contentTestNow,
    ).get(contentTestIdentity.subject),
    { status: "none", reason: "not-reviewed" },
  );
  assert.equal(calls, 0);
});

test("draft review still rejects invalid locales, references, duplicate entities and freshness", () => {
  const mutations = [
    (data: ReturnType<typeof draftFixture>) => {
      delete data.records[0].overview!.text.en;
    },
    (data: ReturnType<typeof draftFixture>) => {
      data.records[0].attractions![0].sourceIds = ["unknown"];
    },
    (data: ReturnType<typeof draftFixture>) => {
      const duplicate = structuredClone(data.records[0].attractions![0]);
      duplicate.id = "attraction:other";
      data.records[0].attractions!.push(duplicate);
    },
    (data: ReturnType<typeof draftFixture>) => {
      data.records[0].practicalNotes![0].freshness = { kind: "stable" };
    },
    (data: ReturnType<typeof draftFixture>) => {
      data.records[0].sources[1].url = "javascript:alert(1)";
    },
  ];
  for (const mutate of mutations) {
    const data = draftFixture();
    mutate(data);
    assert.throws(
      () =>
        buildDestinationContentReview(
          data,
          contentFixtureContext(),
          contentTestIdentity.subject,
          contentTestNow,
        ),
      /invalid-destination-content/,
    );
  }
  const data = draftFixture();
  const unrelatedInvalid = structuredClone(data.records[0]);
  unrelatedInvalid.destinationId = "missing-identity";
  data.records.push(unrelatedInvalid);
  assert.throws(
    () =>
      buildDestinationContentReview(
        data,
        contentFixtureContext(),
        contentTestIdentity.subject,
        contentTestNow,
      ),
    /invalid-destination-content/,
  );
});

test("review HTML escapes copy and provides safe source links in a standalone noindex artifact", () => {
  const report = review();
  report.sections[0].items[0].fields[0].value = {
    en: 'Source <script> & "quoted"',
    sq: "Shqip & tekst",
  };
  const html = renderDestinationContentReviewHtml(report);
  assert.match(html, /lang="en"/);
  assert.doesNotMatch(html, /lang="sq"/);
  assert.match(html, /Source &lt;script&gt; &amp; &quot;quoted&quot;/);
  assert.match(html, /name="robots" content="noindex,nofollow"/);
  assert.match(html, /default-src 'none'/);
  assert.match(
    html,
    /href="https:\/\/example.org\/synthetic-fare" rel="noreferrer noopener"/,
  );
  assert.match(html, /href="#source-source:synthetic:official"/);
  assert.match(html, /id="source-source:synthetic:official"/);
  assert.doesNotMatch(html, /<script|<img|<iframe|<form|onload=/i);
  report.record.sources[1].url = "javascript:alert(1)";
  const unsafe = renderDestinationContentReviewHtml(report);
  assert.doesNotMatch(unsafe, /href="javascript:/);
  assert.match(unsafe, /Unsafe source URL omitted/);
});

test("review warnings preserve expired content for inspection while identifying runtime exclusion", () => {
  const report = buildDestinationContentReview(
    draftFixture(),
    contentFixtureContext(),
    contentTestIdentity.subject,
    Date.parse("2026-11-01T00:00:00Z"),
  );
  assert.ok(
    report.warnings.some((warning) =>
      warning.includes("periodic review is due"),
    ),
  );
  assert.ok(
    report.warnings.some((warning) =>
      warning.includes("volatile fact is expired"),
    ),
  );
  assert.equal(report.counts.practicalNotes, 1);
  assert.equal(report.counts.transportGuides, 1);
  assert.equal(contentFreshnessLabel({ kind: "stable" }), "Stable");
});

test("partial island review shows omissions and generic island questions without city-specific branches", () => {
  const data = draftFixture();
  const context = contentFixtureContext();
  context.identities[0].placeKind = "island";
  context.identities[0].iataCodes = ["AAA", "BBB"];
  delete data.records[0].areas;
  delete data.records[0].dayTemplates;
  const report = buildDestinationContentReview(
    data,
    context,
    contentTestIdentity.subject,
    contentTestNow,
  );
  assert.equal(report.identity.placeKind, "island");
  assert.ok(
    report.warnings.some((warning) => warning.includes("Areas: omitted")),
  );
  assert.ok(
    report.questions.some((question) =>
      question.includes("airport equivalence"),
    ),
  );
  assert.match(
    renderDestinationContentReviewText(report),
    /IATA codes: AAA, BBB/,
  );
});

test("review command accepts exact stable IDs and rejects network, promotion, batch and output flags", () => {
  assert.deepEqual(parseContentReviewArguments(["--destination", "city:BCN"]), {
    destination: "city:BCN",
    format: "text",
  });
  assert.deepEqual(
    parseContentReviewArguments([
      "--format",
      "html",
      "--destination",
      "island-sample",
    ]),
    { destination: "island-sample", format: "html" },
  );
  for (const args of [
    [],
    ["--destination"],
    ["--destination", "../records"],
    ["--destination", "one", "--destination", "two"],
    ["--destination", "one", "--format", "json"],
    ...["--live", "--approve", "--publish", "--all", "--output"].map((flag) => [
      "--destination",
      "one",
      flag,
      "true",
    ]),
  ])
    assert.throws(() => parseContentReviewArguments(args), /invalid-arguments/);
  assert.throws(
    () =>
      buildDestinationContentReview(
        draftFixture(),
        contentFixtureContext(),
        "missing",
        contentTestNow,
      ),
    /destination-not-in-manifest/,
  );
});
