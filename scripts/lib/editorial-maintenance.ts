import { contentItems } from "../../src/content/integrity";
import { assessEditorialReview } from "./editorial-review";
import type { EditorialWorkspace } from "./editorial-workspace";

export function editorialOverview(workspace: EditorialWorkspace) {
  return [...workspace.inputs].map(([id, input]) => ({
    ...assessEditorialReview(input, workspace.reviews.get(id)),
    publicationStatus: input.record.reviewStatus,
  }));
}
export function editorialMaintenance(
  workspace: EditorialWorkspace,
  withinDays = 30,
) {
  if (!Number.isInteger(withinDays) || withinDays < 0 || withinDays > 365)
    throw Error("within-days-must-be-0-to-365");
  const rows: {
    destinationId: string;
    item: string;
    kind: string;
    due: string;
    daysRemaining: number;
    expired: boolean;
  }[] = [];
  const summary = {
    reviewedDestinations: 0,
    reReviewDueSoon: 0,
    expiredSections: 0,
    withdrawnDestinations: 0,
    staleEditorialReviews: 0,
  };
  for (const row of editorialOverview(workspace)) {
    const input = workspace.inputs.get(row.destinationId)!;
    if (row.stale) summary.staleEditorialReviews++;
    if (input.record.reviewStatus === "withdrawn") {
      summary.withdrawnDestinations++;
      continue;
    }
    if (input.record.reviewStatus !== "reviewed") continue;
    summary.reviewedDestinations++;
    let dueSoon = false;
    for (const { id, item } of contentItems(input.record)) {
      if (item.reviewStatus !== "reviewed" || item.freshness.kind === "stable")
        continue;
      const due =
        item.freshness.kind === "periodically-reviewed"
          ? item.freshness.reviewBy
          : item.freshness.validUntil;
      const remaining = Date.parse(due) - input.now;
      const expired = remaining <= 0;
      if (expired) summary.expiredSections++;
      if (remaining <= withinDays * 86_400_000) {
        dueSoon = true;
        rows.push({
          destinationId: row.destinationId,
          item: id,
          kind: item.freshness.kind,
          due,
          daysRemaining: Math.ceil(remaining / 86_400_000),
          expired,
        });
      }
    }
    if (dueSoon) summary.reReviewDueSoon++;
  }
  rows.sort(
    (a, b) =>
      a.due.localeCompare(b.due) ||
      a.destinationId.localeCompare(b.destinationId),
  );
  return { withinDays, summary, rows, writes: 0, externalCalls: 0 };
}
