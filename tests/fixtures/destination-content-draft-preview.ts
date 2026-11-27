/**
 * Test/operator preview ONLY. Never import this module into src/ or content/.
 * A reviewed-shaped clone is required by the unchanged Phase 3B renderer.
 * This is not editorial approval and never modifies or persists the input.
 */
import type {
  DestinationContentResult,
  DestinationContentValidationContext,
  SourcedContent,
} from "../../src/domain/destination-content/types";
import { validateDestinationContentData } from "../../src/domain/destination-content/validation";
import { createReviewedDestinationContentStore } from "../../src/content/runtime/store";

export async function draftContentPreview(
  input: unknown,
  context: DestinationContentValidationContext,
  destinationId: string,
  now: number,
): Promise<DestinationContentResult> {
  if (!Number.isFinite(now)) throw Error("invalid-preview-clock");
  const checked = validateDestinationContentData(input, context);
  if (!checked.ok) throw Error("invalid-draft-data");
  const original = checked.data.records.find(
    (record) => record.destinationId === destinationId,
  );
  if (!original) throw Error("draft-not-found");
  const items: SourcedContent[] = [
    ...(original.overview ? [original.overview] : []),
    ...(original.highlights ?? []),
    ...(original.attractions ?? []),
    ...(original.areas ?? []),
    ...(original.transport ?? []),
    ...(original.practicalNotes ?? []),
    ...(original.dayTemplates ?? []),
  ];
  if (
    original.reviewStatus !== "draft" ||
    original.reviewedAt !== null ||
    items.some(
      (item) => item.reviewStatus !== "draft" || item.reviewedAt !== null,
    )
  )
    throw Error("preview-requires-all-draft-record");
  const record = structuredClone(original);
  record.reviewStatus = "reviewed";
  record.reviewedAt = new Date(now).toISOString();
  const cloneItems: SourcedContent[] = [
    ...(record.overview ? [record.overview] : []),
    ...(record.highlights ?? []),
    ...(record.attractions ?? []),
    ...(record.areas ?? []),
    ...(record.transport ?? []),
    ...(record.practicalNotes ?? []),
    ...(record.dayTemplates ?? []),
  ];
  for (const item of cloneItems) {
    item.reviewStatus = "reviewed";
    // A synthetic preview date within each item's validity allows the actual
    // runtime store to exclude expired/future facts using the real preview clock.
    const at =
      item.freshness.kind === "volatile"
        ? Date.parse(item.freshness.observedAt)
        : item.freshness.kind === "periodically-reviewed"
          ? Math.min(now, Date.parse(item.freshness.reviewBy) - 1)
          : now;
    item.reviewedAt = new Date(at).toISOString();
  }
  return createReviewedDestinationContentStore(
    { schemaVersion: 1, records: [record] },
    context,
    () => now,
  ).get(destinationId);
}
