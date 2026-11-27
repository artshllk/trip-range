import type { PlaceMediaData } from "../../src/domain/media/types";
import type {
  DestinationContentData,
  DestinationContentValidationContext,
} from "../../src/domain/destination-content/types";
import type { EvidenceState } from "./destination-content-pipeline";
import { evaluateDestinationPipeline } from "./destination-content-pipeline";
import { createReviewedMediaStore } from "../../src/media/runtime/store";
import { researchFailureCategories } from "../../src/content/operator/operations";
import type {
  DestinationQueueRecord,
  DestinationResearchRecord,
} from "../../src/content/operator/operations";

/** Summarize validated operational data without repeatedly evaluating the full store. */
export function destinationCoverageSummary(input: {
  ids: readonly string[];
  context: DestinationContentValidationContext;
  data: DestinationContentData;
  queue: readonly DestinationQueueRecord[];
  research: readonly DestinationResearchRecord[];
  evidence: ReadonlyMap<string, EvidenceState>;
}) {
  const identities = new Map(
    input.context.identities.map((p) => [p.subject, p]),
  );
  const records = new Map(input.data.records.map((r) => [r.destinationId, r]));
  const queue = new Map(input.queue.map((r) => [r.destinationId, r]));
  const research = new Map(input.research.map((r) => [r.destinationId, r]));
  const summary = {
    selected: input.ids.length,
    totalQueued: 0,
    identityReady: 0,
    evidenceReady: 0,
    draftReady: 0,
    blocked: 0,
    reviewPending: 0,
    reviewed: 0,
    failures: Object.fromEntries(
      researchFailureCategories.map((category) => [category, 0]),
    ),
  };
  for (const id of input.ids) {
    const task = queue.get(id),
      record = records.get(id),
      identity = identities.get(id);
    if (task) summary.totalQueued++;
    if (identity && identity.confidence !== "unresolved")
      summary.identityReady++;
    if (input.evidence.get(id) === "available") summary.evidenceReady++;
    if (record?.reviewStatus === "draft") {
      summary.draftReady++;
      summary.reviewPending++;
    }
    if (record?.reviewStatus === "reviewed") summary.reviewed++;
    if (
      task?.status === "blocked" ||
      ["blocked", "invalid", "needs-recheck"].includes(
        input.evidence.get(id) ?? "",
      )
    ) {
      summary.blocked++;
      summary.failures[research.get(id)?.failureCategory ?? "other"]++;
    }
  }
  return summary;
}

export async function destinationCoverage(input: {
  destinationId: string;
  data: DestinationContentData;
  context: DestinationContentValidationContext;
  evidence: EvidenceState;
  filesValid: boolean;
  media: PlaceMediaData;
  now?: number;
  seo: readonly { origin: { id: string }; path: string; approved: boolean }[];
}) {
  const pipeline = await evaluateDestinationPipeline(input);
  const store = createReviewedMediaStore(input.media);
  const roles = await Promise.all(
    (["destination.hero", "destination.card"] as const).map((role) =>
      store.get(input.destinationId, role),
    ),
  );
  const pages = input.seo
    .filter((page) => page.origin.id === input.destinationId)
    .map((page) => ({ path: page.path, approved: page.approved }));
  return {
    ...pipeline,
    contentDraft: pipeline.draft === "exists" && pipeline.review === "pending",
    contentReviewed: pipeline.review === "reviewed",
    mediaDestination: roles.some((role) => role.status === "approved")
      ? ("available" as const)
      : ("unavailable" as const),
    // V1 does not publish attraction media. A content reference is not an image approval.
    mediaAttractions: "unsupported" as const,
    seo: {
      state: pages.length ? "registered-separate-policy" : "not-registered",
      pages,
    },
  };
}
