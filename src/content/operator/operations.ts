import type { PlaceIdentity } from "../../domain/places/types";
import {
  object,
  keys,
  subjectId,
  text,
  instant,
} from "../../domain/places/validation";

export type ResearchStatus =
  | "in-progress"
  | "available"
  | "needs-recheck"
  | "blocked";
export const researchFailureCategories = [
  "identity-ambiguous",
  "insufficient-official-sources",
  "source-inaccessible",
  "destination-too-broad",
  "model-limitation",
  "translation-uncertainty",
  "research-provider-unavailable",
  "other",
] as const;
export type ResearchFailureCategory =
  (typeof researchFailureCategories)[number];
export type DestinationResearchRecord = {
  destinationId: string;
  status: ResearchStatus;
  report: string | null;
  researchedAt: string | null;
  sourceCount: number;
  unresolvedIssues: string[];
  failureCategory?: ResearchFailureCategory;
};
export type DestinationResearchData = {
  schemaVersion: 1;
  records: DestinationResearchRecord[];
};
export type DestinationQueueRecord = {
  destinationId: string;
  identityState: "registered" | "unresolved-candidate";
  priority: "high" | "normal" | "low";
  reason: string;
  status: "queued" | "in-progress" | "blocked" | "done";
};
export type DestinationQueueData = {
  schemaVersion: 1;
  records: DestinationQueueRecord[];
};
export const evidenceFilename = (v: unknown): v is string =>
  typeof v === "string" && /^[a-zA-Z0-9][a-zA-Z0-9_-]{0,119}\.md$/.test(v);
function envelope(
  value: unknown,
): value is { schemaVersion: 1; records: unknown[] } {
  return (
    object(value) &&
    keys(value, ["schemaVersion", "records"]) &&
    value.schemaVersion === 1 &&
    Array.isArray(value.records)
  );
}
/** Operational metadata is never a publication input or source-fact approval. */
export function validateResearchData(
  value: unknown,
  identities: readonly PlaceIdentity[],
  queue: readonly DestinationQueueRecord[] = [],
): string[] {
  if (!envelope(value)) return ["invalid-research-registry"];
  const known = new Set(identities.map((p) => p.subject)),
    seen = new Set<string>(),
    errors: string[] = [];
  // Identity research can fail before registration. Only an explicit blocked
  // unresolved queue entry may retain such evidence; it cannot claim readiness.
  const blockedCandidates = new Set(
    queue
      .filter(
        (entry) =>
          entry.identityState === "unresolved-candidate" &&
          entry.status === "blocked",
      )
      .map((entry) => entry.destinationId),
  );
  for (const record of value.records) {
    if (
      !object(record) ||
      !keys(record, [
        "destinationId",
        "status",
        "report",
        "researchedAt",
        "sourceCount",
        "unresolvedIssues",
        "failureCategory",
      ]) ||
      !subjectId(record.destinationId) ||
      !(
        known.has(record.destinationId) ||
        (blockedCandidates.has(record.destinationId) &&
          record.status === "blocked")
      ) ||
      seen.has(record.destinationId) ||
      !["in-progress", "available", "needs-recheck", "blocked"].includes(
        String(record.status),
      ) ||
      !(record.report === null || evidenceFilename(record.report)) ||
      !(record.researchedAt === null || instant(record.researchedAt)) ||
      !Number.isSafeInteger(record.sourceCount) ||
      Number(record.sourceCount) < 0 ||
      Number(record.sourceCount) > 10000 ||
      !Array.isArray(record.unresolvedIssues) ||
      record.unresolvedIssues.length > 100 ||
      !record.unresolvedIssues.every((issue) => text(issue, 500)) ||
      (record.failureCategory !== undefined &&
        (!(researchFailureCategories as readonly unknown[]).includes(
          record.failureCategory,
        ) ||
          !["blocked", "needs-recheck"].includes(String(record.status)))) ||
      (record.status === "available" &&
        (!record.report || !record.researchedAt || !record.sourceCount))
    ) {
      if (errors.length < 100) errors.push("invalid-or-orphan-research-record");
    } else seen.add(record.destinationId);
  }
  return errors;
}
export function validateQueueData(
  value: unknown,
  identities: readonly PlaceIdentity[],
): string[] {
  if (!envelope(value)) return ["invalid-queue-registry"];
  const known = new Set(identities.map((p) => p.subject)),
    seen = new Set<string>(),
    errors: string[] = [];
  for (const record of value.records) {
    if (
      !object(record) ||
      !keys(record, [
        "destinationId",
        "identityState",
        "priority",
        "reason",
        "status",
      ]) ||
      !subjectId(record.destinationId) ||
      seen.has(record.destinationId) ||
      !(record.identityState === "registered"
        ? known.has(record.destinationId)
        : record.identityState === "unresolved-candidate" &&
          !known.has(record.destinationId)) ||
      !["high", "normal", "low"].includes(String(record.priority)) ||
      !text(record.reason, 500) ||
      !["queued", "in-progress", "blocked", "done"].includes(
        String(record.status),
      ) ||
      (record.status === "done" && record.identityState !== "registered")
    ) {
      if (errors.length < 100) errors.push("invalid-or-orphan-queue-record");
    } else seen.add(record.destinationId);
  }
  return errors;
}
