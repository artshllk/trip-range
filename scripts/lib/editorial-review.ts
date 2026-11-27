import type {
  DestinationContent,
  DestinationContentValidationContext,
} from "../../src/domain/destination-content/types";
import type { PlaceIdentity } from "../../src/domain/places/types";
import type { DestinationResearchRecord } from "../../src/content/operator/operations";
import {
  contentDigest,
  contentItems,
  digest,
  publicationReceiptMatches,
} from "../../src/content/integrity";
import {
  isEditorialReview,
  pendingChecks,
  type DestinationEditorialReview,
  type EditorialSnapshot,
} from "../../src/content/operator/editorial";
import { validateDestinationContentData } from "../../src/domain/destination-content/validation";
import { buildDestinationContentReview } from "./destination-content-review";
import type { EvidenceState } from "./destination-content-pipeline";

export type EditorialFinding = { id: string; message: string };
export type ReviewInputs = {
  record: DestinationContent;
  identity: PlaceIdentity;
  research?: DestinationResearchRecord;
  evidence: EvidenceState;
  evidenceText: string;
  findings: EditorialFinding[];
  now: number;
};
export type EditorialAssessment = ReturnType<typeof assessEditorialReview>;

export function reviewContext(
  identity: PlaceIdentity,
): DestinationContentValidationContext {
  return { identities: [identity], mediaSubjects: [identity.subject] };
}
export function reviewPins(input: ReviewInputs) {
  return {
    contentVersion: input.record.contentVersion,
    contentDigest: contentDigest(input.record),
    identityDigest: digest(input.identity),
    evidenceDigest: digest({
      research: input.research ?? null,
      report: input.evidenceText,
      findings: input.findings,
    }),
  };
}

/** One destination at a time; batch callers build indexed associations once. */
export function assessEditorialReview(
  input: ReviewInputs,
  review?: DestinationEditorialReview,
) {
  const { record, identity, now } = input;
  const pins = reviewPins(input);
  const blocking: string[] = [];
  const advisory: EditorialFinding[] = [...input.findings];
  const inactivePresentationIds = new Set<string>();
  if (!Number.isFinite(now)) throw Error("invalid-clock");
  const checked = validateDestinationContentData(
    { schemaVersion: 1, records: [record] },
    reviewContext(identity),
  );
  if (!checked.ok) blocking.push(...checked.errors);
  if (identity.confidence === "unresolved")
    blocking.push("unresolved-identity");
  if (input.evidence !== "available")
    blocking.push("research-evidence-not-available");
  const items = contentItems(record);
  if (!items.length) blocking.push("no-current-content");
  for (const { id, item } of items) {
    const freshness = item.freshness;
    if (
      freshness.kind === "periodically-reviewed" &&
      Date.parse(freshness.reviewBy) <= now
    )
      blocking.push(`overdue:${id}`);
    if (
      freshness.kind === "volatile" &&
      (Date.parse(freshness.validUntil) <= now ||
        Date.parse(freshness.observedAt) > now)
    )
      blocking.push(`expired-or-future:${id}`);
    if (item.reviewStatus !== record.reviewStatus)
      blocking.push(`mixed-review-state:${id}`);
  }
  if (
    record.sources.some((source) =>
      [source.observedAt, source.retrievedAt].some(
        (date) => date && Date.parse(date) > now,
      ),
    )
  )
    blocking.push("future-source-date");
  if (checked.ok) {
    const report = buildDestinationContentReview(
      { schemaVersion: 1, records: [record] },
      reviewContext(identity),
      record.destinationId,
      now,
    );
    for (const warning of report.warnings.filter((warning) =>
      /too long for the default presentation|only the first/.test(warning),
    )) {
      const id = `presentation:${digest(warning).slice(0, 20)}`;
      advisory.push({ id, message: warning });
      if (/\(sq\) too long for the default presentation/.test(warning))
        inactivePresentationIds.add(id);
    }
  }
  let stale = false;
  if (review) {
    if (
      !isEditorialReview(review, now) ||
      review.destinationId !== record.destinationId
    )
      blocking.push("invalid-editorial-review");
    for (const key of [
      "contentVersion",
      "contentDigest",
      "identityDigest",
      "evidenceDigest",
    ] as const) {
      if (review.current[key] !== pins[key]) {
        blocking.push(`stale-${key}`);
        stale = true;
      }
    }
    const ids = new Set(advisory.map((warning) => warning.id));
    if (review.current.warningsAcknowledged.some((ack) => !ids.has(ack.id)))
      blocking.push("unknown-advisory-acknowledgement");
  }
  const unacknowledged = advisory.filter(
    (warning) =>
      !inactivePresentationIds.has(warning.id) &&
      !review?.current.warningsAcknowledged.some(
        (ack) => ack.id === warning.id,
      ),
  );
  const decision =
    record.reviewStatus === "withdrawn"
      ? "withdrawn"
      : stale
        ? "stale"
        : (review?.current.decision ?? "pending");
  const eligible =
    decision === "approved" &&
    blocking.length === 0 &&
    unacknowledged.length === 0;
  return {
    ...pins,
    publicationPinned: publicationReceiptMatches(record, identity),
    destinationId: record.destinationId,
    name: identity.name,
    decision,
    stale,
    checks: review?.current.checks ?? pendingChecks(),
    blocking,
    advisory,
    unacknowledged,
    eligible,
  };
}

export function newReview(
  input: ReviewInputs,
  reviewer: string,
): DestinationEditorialReview {
  return {
    schemaVersion: 1,
    destinationId: input.record.destinationId,
    current: {
      ...reviewPins(input),
      decision: "pending",
      checks: pendingChecks(),
      warningsAcknowledged: [],
      reviewer,
      updatedAt: new Date(input.now).toISOString(),
      reviewedAt: null,
    },
    history: [],
  };
}
export function rememberReview(
  review: DestinationEditorialReview,
  next: EditorialSnapshot,
  reason: string,
): DestinationEditorialReview {
  if (review.history.length >= 200)
    throw Error("review-history-full-retain-and-review-manually");
  return {
    ...review,
    current: next,
    history: [
      ...review.history,
      { review: review.current, supersededAt: next.updatedAt, reason },
    ],
  };
}
