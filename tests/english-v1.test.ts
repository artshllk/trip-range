import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import nextConfig from "../next.config";
import { isLocale, locales } from "../src/i18n/config";
import { pageMetadata } from "../src/services/seo";
import { seoSitemap } from "../src/seo/publication";
import { siteUrl } from "../src/seo/registry";
import { contentItems } from "../src/content/integrity";
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
  buildDestinationContentReview,
  renderDestinationContentReviewHtml,
} from "../scripts/lib/destination-content-review";
import { validateDestinationContentData } from "../src/domain/destination-content/validation";
import { validateMediaData } from "../src/domain/media/validation";
import { createReviewedMediaStore } from "../src/media/runtime/store";
import { displayImageAsset } from "../src/media/runtime/display";
import { parseIntentRequest } from "../src/services/ai/intent-request";
import { emptyIntent } from "../src/domain/ai/intent";
import { defaultRequest, requestQuery } from "../src/domain/request";
import {
  contentFixtureContext,
  contentTestIdentity,
  contentTestNow,
  destinationContentFixture,
} from "./fixtures/destination-content";

function englishOnly<T>(input: T): T {
  return JSON.parse(
    JSON.stringify(input, (key, value) => (key === "sq" ? undefined : value)),
  );
}

test("V1 serves and indexes only English, retaining query-safe legacy redirects", async () => {
  assert.deepEqual(locales, ["en"]);
  for (const locale of ["sq", "de", "fr", "EN", "en-US", "../en"])
    assert.equal(isLocale(locale), false);
  assert.equal(isLocale("en"), true);
  const redirects = await nextConfig.redirects!();
  // `/` is the homepage itself: no redirect away from the root.
  assert.ok(!redirects.some((r) => r.source === "/"));
  assert.deepEqual(redirects, [
    {
      source: "/sq/nga/prishtina/fundjava/nen-300",
      destination: "/plan?origin=prishtina&when=weekend&budget=300",
      permanent: true,
    },
    // English prefix redirects run in the proxy before internal rewrites;
    // locale-routing.test.ts verifies their permanent, query-safe responses.
    // Temporary until Albanian launches; browsers cache permanent redirects.
    { source: "/sq", destination: "/", permanent: false },
    { source: "/sq/:path*", destination: "/:path*", permanent: false },
  ]);
  assert.deepEqual(
    seoSitemap().map((entry) => entry.url),
    // Hubs are recorded noindex (acquisition gate not met).
    ["https://www.trip-range.com"],
  );
  assert.ok(seoSitemap().every((entry) => !("alternates" in entry)));
  const metadata = pageMetadata("en", "Test", "English", { en: "/" });
  assert.equal(metadata.title, "Test — Trip Range");
  assert.equal(metadata.openGraph?.siteName, "Trip Range");
  assert.equal(siteUrl, "https://www.trip-range.com");
  assert.equal(metadata.alternates!.canonical, siteUrl);
  // English is both the en and x-default hreflang target; no other locale.
  assert.deepEqual(metadata.alternates!.languages, {
    en: siteUrl,
    "x-default": siteUrl,
  });
  assert.equal((metadata.openGraph as { locale: string }).locale, "en_GB");
  assert.ok(!JSON.stringify(metadata).includes("sq_AL"));
});

test("English-only content is valid but publication still requires explicit human checks and exact pins", () => {
  const data = englishOnly(destinationContentFixture());
  const record = data.records[0];
  for (const item of [
    record,
    ...contentItems(record).map(({ item }) => item),
  ]) {
    item.reviewStatus = "draft";
    item.reviewedAt = null;
  }
  const input: ReviewInputs = {
    record,
    identity: contentTestIdentity,
    evidence: "available",
    evidenceText: "Synthetic English-only test evidence",
    findings: [],
    now: contentTestNow,
  };
  assert.equal(
    validateDestinationContentData(data, contentFixtureContext()).ok,
    true,
  );
  const report = buildDestinationContentReview(
    data,
    contentFixtureContext(),
    record.destinationId,
    contentTestNow,
  );
  const html = renderDestinationContentReviewHtml(report);
  assert.match(html, /lang="en"/);
  assert.doesNotMatch(html, /lang="sq"|undefined|English and Albanian/);
  assert.equal(assessEditorialReview(input).eligible, false);
  const review = newReview(input, "synthetic-test-reviewer");
  assert.deepEqual(
    Object.keys(review.current.checks).sort(),
    [...editorialChecks].sort(),
  );
  assert.equal(review.current.checks.albanianCopy, undefined);
  assert.equal(assessEditorialReview(input, review).eligible, false);
  for (const check of editorialChecks)
    review.current.checks[check] = "approved";
  review.current.decision = "approved";
  review.current.reviewedAt = review.current.updatedAt;
  assert.equal(isEditorialReview(review, contentTestNow), true);
  assert.equal(assessEditorialReview(input, review).eligible, true);
  record.overview!.text.en += " Changed after review.";
  assert.equal(assessEditorialReview(input, review).eligible, false);
  delete record.overview!.text.en;
  assert.equal(
    validateDestinationContentData(data, contentFixtureContext()).ok,
    false,
  );
});

test("English-only approved media alt remains usable with full licence and identity gates", async () => {
  const media = JSON.parse(
    readFileSync("tests/fixtures/media/approved.synthetic.json", "utf8"),
  );
  for (const selection of media.selections)
    if (selection.alt) delete selection.alt.sq;
  const validated = validateMediaData(media);
  assert.equal(validated.ok, true);
  const approved = media.selections.find(
    (selection: { status: string }) => selection.status === "approved",
  );
  const result = await createReviewedMediaStore(media).get(
    approved.subject,
    approved.role,
  );
  assert.equal(result.status, "approved");
  if (result.status !== "approved") throw Error("Synthetic media fixture");
  const asset = displayImageAsset(result.image);
  assert.equal(asset.localizedAlt!.en, approved.alt.en);
  assert.equal(asset.destinationId, approved.subject);
  assert.ok(asset.license && asset.photoUrl);
  delete approved.alt.en;
  assert.equal(validateMediaData(media).ok, false);
});

test("AI boundary accepts English and rejects an inactive locale before contacting the provider", async () => {
  let calls = 0;
  const provider = {
    async parse() {
      calls++;
      return { status: "available" as const, intent: emptyIntent };
    },
  };
  const locations = {
    async search() {
      return { status: "available" as const, locations: [] };
    },
  };
  const body = {
    text: "A weekend trip",
    draft: Object.fromEntries(
      new URLSearchParams(requestQuery(defaultRequest)),
    ),
    locale: "sq",
  };
  assert.deepEqual(
    await parseIntentRequest(body, "2026-10-21", provider, locations),
    { status: "unavailable" },
  );
  assert.equal(calls, 0);
  await parseIntentRequest(
    { ...body, locale: "en" },
    "2026-10-21",
    provider,
    locations,
  );
  assert.equal(calls, 1);
});

test("inactive translation length does not block English, while source findings still require acknowledgement", () => {
  const record = destinationContentFixture().records[0];
  for (const item of [
    record,
    ...contentItems(record).map(({ item }) => item),
  ]) {
    item.reviewStatus = "draft";
    item.reviewedAt = null;
  }
  record.overview!.text.sq = "Retained translation. ".repeat(25);
  const input: ReviewInputs = {
    record,
    identity: contentTestIdentity,
    evidence: "available",
    evidenceText: "Synthetic evidence",
    findings: [],
    now: contentTestNow,
  };
  const makeApproved = () => {
    const review = newReview(input, "synthetic-test-reviewer");
    for (const check of editorialChecks)
      review.current.checks[check] = "approved";
    review.current.decision = "approved";
    review.current.reviewedAt = review.current.updatedAt;
    return review;
  };
  assert.equal(assessEditorialReview(input, makeApproved()).eligible, true);
  input.findings = [
    {
      id: "source-check",
      message:
        "Source claim (sq) too long for the default presentation; source still needs review.",
    },
  ];
  const assessment = assessEditorialReview(input, makeApproved());
  assert.equal(assessment.eligible, false);
  assert.ok(
    assessment.unacknowledged.some((finding) => finding.id === "source-check"),
  );
});
