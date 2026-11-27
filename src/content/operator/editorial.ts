import {
  instant,
  keys,
  object,
  subjectId,
  text,
} from "../../domain/places/validation";

export const editorialChecks = [
  "identity",
  "sources",
  "englishCopy",
  "selectionAndOrder",
  "freshness",
] as const;
export type EditorialCheck = (typeof editorialChecks)[number];
export type CheckDecision = "pending" | "approved" | "changes-required";
export type EditorialDecision = CheckDecision | "withdrawn";
export type EditorialSnapshot = {
  contentVersion: number;
  contentDigest: string;
  identityDigest: string;
  evidenceDigest: string;
  decision: EditorialDecision;
  checks: Record<EditorialCheck, CheckDecision> & {
    albanianCopy?: CheckDecision;
  };
  warningsAcknowledged: { id: string; reason: string }[];
  reviewer: string;
  updatedAt: string;
  reviewedAt: string | null;
};
export type DestinationEditorialReview = {
  schemaVersion: 1;
  destinationId: string;
  current: EditorialSnapshot;
  history: {
    review: EditorialSnapshot;
    supersededAt: string;
    reason: string;
  }[];
};
export const sha256 = (value: unknown): value is string =>
  typeof value === "string" && /^[a-f0-9]{64}$/.test(value);
export const reviewerLabel = (value: unknown): value is string =>
  text(value, 80) &&
  /^[\p{L}\p{N}][\p{L}\p{N} ._-]*$/u.test(value) &&
  value.trim() === value;
export const pendingChecks = (): EditorialSnapshot["checks"] => ({
  identity: "pending",
  sources: "pending",
  englishCopy: "pending",
  selectionAndOrder: "pending",
  freshness: "pending",
});
const past = (value: unknown, now: number): value is string =>
  instant(value) && Date.parse(value) <= now;
function snapshot(value: unknown, now: number): value is EditorialSnapshot {
  if (
    !object(value) ||
    !keys(value, [
      "contentVersion",
      "contentDigest",
      "identityDigest",
      "evidenceDigest",
      "decision",
      "checks",
      "warningsAcknowledged",
      "reviewer",
      "updatedAt",
      "reviewedAt",
    ]) ||
    !Number.isSafeInteger(value.contentVersion) ||
    Number(value.contentVersion) < 1 ||
    Number(value.contentVersion) > 1_000_000 ||
    !sha256(value.contentDigest) ||
    !sha256(value.identityDigest) ||
    !sha256(value.evidenceDigest) ||
    !["pending", "approved", "changes-required", "withdrawn"].includes(
      String(value.decision),
    ) ||
    !object(value.checks) ||
    !keys(value.checks, [...editorialChecks, "albanianCopy"]) ||
    (value.checks.albanianCopy !== undefined &&
      !["pending", "approved", "changes-required"].includes(
        String(value.checks.albanianCopy),
      )) ||
    !editorialChecks.every((check) =>
      ["pending", "approved", "changes-required"].includes(
        String((value.checks as Record<string, unknown>)[check]),
      ),
    ) ||
    !reviewerLabel(value.reviewer) ||
    !past(value.updatedAt, now) ||
    !(
      value.reviewedAt === null ||
      (past(value.reviewedAt, now) &&
        Date.parse(value.reviewedAt) <= Date.parse(value.updatedAt))
    ) ||
    !Array.isArray(value.warningsAcknowledged) ||
    value.warningsAcknowledged.length > 100
  )
    return false;
  const seen = new Set<string>();
  for (const ack of value.warningsAcknowledged) {
    if (
      !object(ack) ||
      !keys(ack, ["id", "reason"]) ||
      !subjectId(ack.id) ||
      !text(ack.reason, 500) ||
      seen.has(ack.id)
    )
      return false;
    seen.add(ack.id);
  }
  return (
    value.decision !== "approved" ||
    (!!value.reviewedAt &&
      editorialChecks.every(
        (check) =>
          (value.checks as Record<string, unknown>)[check] === "approved",
      ))
  );
}

/** Structural validation; current content associations are checked separately for useful stale reports. */
export function isEditorialReview(
  value: unknown,
  now = Date.now(),
): value is DestinationEditorialReview {
  if (
    !Number.isFinite(now) ||
    !object(value) ||
    !keys(value, ["schemaVersion", "destinationId", "current", "history"]) ||
    value.schemaVersion !== 1 ||
    !subjectId(value.destinationId) ||
    !snapshot(value.current, now) ||
    !Array.isArray(value.history) ||
    value.history.length > 200
  )
    return false;
  let previous = -Infinity;
  for (const entry of value.history) {
    if (
      !object(entry) ||
      !keys(entry, ["review", "supersededAt", "reason"]) ||
      !snapshot(entry.review, now) ||
      !past(entry.supersededAt, now) ||
      Date.parse(entry.supersededAt) < Date.parse(entry.review.updatedAt) ||
      Date.parse(entry.supersededAt) < previous ||
      !text(entry.reason, 500)
    )
      return false;
    previous = Date.parse(entry.supersededAt);
  }
  return previous <= Date.parse(value.current.updatedAt);
}
