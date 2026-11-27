import type {
  CalibrationDataset,
  CalibrationReport,
  CalibrationRow,
} from "./types";
import { PLACE_KINDS } from "../../../domain/media/policy";
function ratio(yes: number, total: number) {
  return {
    numerator: yes,
    denominator: total,
    value: total ? yes / total : null,
  };
}
function distribution(values: number[]) {
  const sorted = [...values].sort((a, b) => a - b);
  return {
    count: sorted.length,
    min: sorted[0] ?? null,
    max: sorted[sorted.length - 1] ?? null,
    median: sorted.length
      ? (sorted[Math.floor((sorted.length - 1) / 2)] +
          sorted[Math.ceil((sorted.length - 1) / 2)]) /
        2
      : null,
  };
}
function summarize(rows: CalibrationRow[], dataset: CalibrationDataset) {
  const live = rows.filter((r) => r.status !== "offline");
  const resolved = live.filter((r) => !!r.identity.external);
  const completedDiscovery = live.filter((r) => r.status === "complete");
  const measuredIdentities = live.filter((r) => r.status !== "unavailable");
  const expected = resolved.filter(
    (r) =>
      !!dataset.cases.find((c) => c.input.subject === r.input.subject)?.expected
        .wikidataId,
  );
  const expectedCorrect = expected.filter(
    (r) =>
      r.identity.external?.id ===
        dataset.cases.find((c) => c.input.subject === r.input.subject)!.expected
          .wikidataId &&
      r.identity.countryCode === r.input.countryCode &&
      r.identity.placeKind === r.input.placeKind,
  );
  const identities = resolved.filter(
    (r) => r.identityReview.identityCorrect !== "uncertain",
  );
  const all = live.flatMap((r) => r.candidates);
  const visuallyReviewed = all.filter((c) => c.review.method === "visual");
  const relevance = visuallyReviewed.filter(
    (c) => c.review.imageRelevant !== "uncertain",
  );
  const good = visuallyReviewed.filter(
    (c) => c.review.imageRelevant === "yes" && c.review.roleFit === "yes",
  );
  const wrong = relevance.filter((c) => c.review.imageRelevant === "no");
  const reviewedRows = live.filter((r) =>
    r.candidates.some((c) => c.review.method === "visual"),
  );
  const useful = live.filter((r) =>
    r.candidates.some(
      (c) =>
        c.review.method === "visual" &&
        c.review.imageRelevant === "yes" &&
        c.review.roleFit === "yes",
    ),
  );
  return {
    destinationsProcessed: live.length,
    resolved: resolved.length,
    expectedResolutionOutcome: ratio(
      measuredIdentities.filter(
        (r) =>
          (dataset.cases.find((c) => c.input.subject === r.input.subject)!
            .expected.outcome ===
            "resolve") ===
          !!r.identity.external,
      ).length,
      measuredIdentities.length,
    ),
    expectedIdAgreement: ratio(expectedCorrect.length, expected.length),
    identityPrecision: ratio(
      identities.filter((r) => r.identityReview.identityCorrect === "yes")
        .length,
      identities.length,
    ),
    candidateCount: all.length,
    candidateCoverage: ratio(
      live.filter((r) => r.candidates.length).length,
      live.length,
    ),
    candidateCoverageSuccessfulDiscoveryOnly: ratio(
      completedDiscovery.filter((r) => r.candidates.length).length,
      completedDiscovery.length,
    ),
    candidatesPendingVisualReview: all.filter(
      (c) => c.review.method === "pending",
    ).length,
    candidateRelevancePrecision: ratio(
      relevance.filter((c) => c.review.imageRelevant === "yes").length,
      relevance.length,
    ),
    wrongImageRate: ratio(wrong.length, relevance.length),
    usefulCandidateCoverageReviewedOnly: ratio(
      useful.length,
      reviewedRows.length,
    ),
    confirmedUsefulDestinations: useful.length,
    falsePositiveCount: wrong.filter(
      (c) => c.candidate.decision === "pending-review",
    ).length,
    falseNegativeCount: good.filter((c) => c.candidate.decision === "rejected")
      .length,
    missedGoodImageNotes: live.flatMap((r) =>
      r.missedGoodImageNotes.map((note) => ({
        subject: r.input.subject,
        note,
      })),
    ),
    scoreDistribution: {
      relevantAndRoleFit: distribution(
        good.map((c) => c.candidate.evaluation.score),
      ),
      irrelevant: distribution(wrong.map((c) => c.candidate.evaluation.score)),
    },
    tiers: Object.fromEntries(
      ["T1", "T2", "T3"].map((t) => [
        t,
        {
          candidates: all.filter((c) => c.candidate.sourceTier === t).length,
          reviewedRelevant: relevance.filter(
            (c) =>
              c.candidate.sourceTier === t && c.review.imageRelevant === "yes",
          ).length,
          reviewedIrrelevant: wrong.filter((c) => c.candidate.sourceTier === t)
            .length,
        },
      ]),
    ),
    failureCategories: Object.fromEntries(
      [...new Set(live.flatMap((r) => r.failureCategories))].map((reason) => [
        reason,
        live.filter((r) => r.failureCategories.includes(reason)).length,
      ]),
    ),
  };
}
export function calibrationMetrics(
  report: CalibrationReport,
  dataset: CalibrationDataset,
) {
  return {
    ...summarize(report.rows, dataset),
    requests: {
      wikidata: report.rows.reduce((n, r) => n + r.requests.wikidata, 0),
      commons: report.rows.reduce((n, r) => n + r.requests.commons, 0),
    },
    failures: report.rows.flatMap((r) => r.failures).length,
    timeouts: report.rows
      .flatMap((r) => r.failures)
      .filter((f) => f.reason === "timeout").length,
    byPlaceKind: Object.fromEntries(
      PLACE_KINDS.map((kind) => [
        kind,
        summarize(
          report.rows.filter((r) => r.input.placeKind === kind),
          dataset,
        ),
      ]),
    ),
  };
}
