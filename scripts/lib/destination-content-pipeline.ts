import { lstatSync, readFileSync } from "node:fs";
import { join } from "node:path";
import type { DestinationContentValidationContext } from "../../src/domain/destination-content/types";
import { validateDestinationContentData } from "../../src/domain/destination-content/validation";
import { createPinnedDestinationContentStore } from "../../src/content/runtime/publication";
import { buildDestinationContentReview } from "./destination-content-review";

import type { DestinationResearchRecord } from "../../src/content/operator/operations";
import { evidenceFilename } from "../../src/content/operator/operations";
export type EvidenceState =
  | "available"
  | "missing"
  | "invalid"
  | "in-progress"
  | "needs-recheck"
  | "blocked";
export type ContentLifecycle =
  | "identity-missing"
  | "research-in-progress"
  | "research-missing"
  | "draft-missing"
  | "review-pending"
  | "reviewed"
  | "runtime-eligible"
  | "blocked"
  | "withdrawn"
  | "expired";
export type ContentPipelineReport = {
  destinationId: string;
  identity: "available" | "missing" | "unresolved";
  research: EvidenceState;
  draft: "exists" | "missing";
  validation: "valid" | "invalid" | "not-ready";
  review: "pending" | "reviewed" | "withdrawn" | "not-ready";
  publication:
    | "not-approved"
    | "runtime-eligible"
    | "no-current-content"
    | "blocked";
  lifecycle: ContentLifecycle;
  automaticApproval: false;
  writes: 0;
  externalCalls: 0;
  warnings: string[];
  next: string;
};

/** Metadata links stable IDs to local evidence, never a city support whitelist.
 * Presence is workflow evidence only, not validation of the source's factual claims.
 */
export function inspectDestinationEvidence(
  record: DestinationResearchRecord | undefined,
  directory: string,
): EvidenceState {
  if (!record) return "missing";
  if (record.report === null)
    return record.status === "available" ? "invalid" : record.status;
  if (!evidenceFilename(record.report)) return "invalid";
  try {
    const dir = lstatSync(directory);
    if (!dir.isDirectory() || dir.isSymbolicLink()) return "invalid";
    const path = join(directory, record.report);
    const file = lstatSync(path);
    if (!file.isFile() || file.isSymbolicLink() || file.size > 256_000)
      return "invalid";
    return readFileSync(path, "utf8").trim() ? record.status : "invalid";
  } catch {
    return "invalid";
  }
}

/** Derived status, not a transition mechanism. Only humans edit editorial review fields. */
export function contentLifecycle(
  report: Pick<
    ContentPipelineReport,
    "identity" | "research" | "draft" | "validation" | "review" | "publication"
  >,
): ContentLifecycle {
  if (
    report.validation === "invalid" ||
    ["invalid", "blocked"].includes(report.research)
  )
    return "blocked";
  if (report.review === "withdrawn") return "withdrawn";
  if (report.publication === "blocked") return "blocked";
  if (report.identity !== "available") return "identity-missing";
  if (report.publication === "runtime-eligible") return "runtime-eligible";
  if (report.publication === "no-current-content") return "expired";
  if (report.review === "reviewed") return "reviewed";
  if (report.review === "pending") return "review-pending";
  if (report.research === "missing") return "research-missing";
  if (report.research === "in-progress") return "research-in-progress";
  if (report.research === "needs-recheck") return "blocked";
  return report.draft === "missing" ? "draft-missing" : "review-pending";
}

/** Offline orchestration of existing validators, review and runtime policy. Never writes. */
export async function evaluateDestinationPipeline(input: {
  destinationId: string;
  data: unknown;
  context: DestinationContentValidationContext;
  evidence: EvidenceState;
  filesValid: boolean;
  now?: number;
}): Promise<ContentPipelineReport> {
  const {
    destinationId,
    data,
    context,
    evidence,
    filesValid,
    now = Date.now(),
  } = input;
  const identity = context.identities.find(
    (place) => place.subject === destinationId,
  );
  const checked = validateDestinationContentData(data, context);
  const record = checked.ok
    ? checked.data.records.find((item) => item.destinationId === destinationId)
    : undefined;
  // Presence is reported even if validation fails; invalid records are never consumed.
  const hasRecord =
    !!data &&
    typeof data === "object" &&
    "records" in data &&
    Array.isArray(data.records) &&
    data.records.some(
      (item: unknown) =>
        !!item &&
        typeof item === "object" &&
        "destinationId" in item &&
        item.destinationId === destinationId,
    );
  const report: ContentPipelineReport = {
    destinationId,
    identity: !identity
      ? "missing"
      : identity.confidence === "unresolved"
        ? "unresolved"
        : "available",
    research: evidence,
    draft: hasRecord ? "exists" : "missing",
    validation:
      !checked.ok || !filesValid ? "invalid" : record ? "valid" : "not-ready",
    review: record
      ? record.reviewStatus === "draft"
        ? "pending"
        : record.reviewStatus
      : "not-ready",
    publication: "not-approved",
    lifecycle: "identity-missing",
    automaticApproval: false,
    writes: 0,
    externalCalls: 0,
    warnings: [],
    next: "Register a normalized stable identity before research.",
  };
  if (!checked.ok || !filesValid) {
    report.publication = "blocked";
    report.next =
      "Repair source-controlled validation/file errors before review.";
    report.lifecycle = contentLifecycle(report);
    return report;
  }
  if (!identity || identity.confidence === "unresolved") {
    report.lifecycle = contentLifecycle(report);
    return report;
  }
  if (record) {
    report.warnings = buildDestinationContentReview(
      data,
      context,
      destinationId,
      now,
    ).warnings;
    const runtime = await createPinnedDestinationContentStore(
      data,
      context,
      () => now,
    ).get(destinationId);
    if (record.reviewStatus === "reviewed")
      report.publication =
        runtime.status === "reviewed"
          ? "runtime-eligible"
          : runtime.reason === "no-current-content"
            ? "no-current-content"
            : "blocked";
    if (record.reviewStatus === "withdrawn") report.publication = "blocked";
  }
  report.next =
    evidence !== "available"
      ? "Record or recheck sourced research in content/research/destinations. Live research is a separate explicit command."
      : !record
        ? "Author a sourced English draft and register its JSON import. No scaffold was written: evidence does not supply approved editorial prose."
        : record.reviewStatus === "draft"
          ? "Run review:destination-content and preview:destination-content. Human source/copy/selection approval is still required; validation never promotes a draft."
          : "Inspect the existing human review and freshness state. This command never publishes or changes SEO approval.";
  report.lifecycle = contentLifecycle(report);
  return report;
}
